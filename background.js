importScripts('form-json.js', 'form-service.js', 'quiz-common.js', 'background-chat.js', 'document-store.js', 'quiz-service.js', 'document-service.js');
// Manifest V3 service worker. Durable prompts survive a cold side panel.
const CHATGPT_URL = 'https://chatgpt.com/';
const pendingKey = (windowId) => `pendingPrompt:${windowId}`;
let frameRulesReady;

function prepareChatGPTFrame() {
  if (!frameRulesReady) {
    frameRulesReady = (async () => {
      const response = await fetch(chrome.runtime.getURL('rules/rules.json'));
      if (!response.ok) throw new Error('Không tải được quy tắc sidebar.');
      const rules = await response.json();
      // Dynamic rules live in the browser profile, so unpacked source stays free
      // of Chrome's reserved _metadata directory when indexing these rules.
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(rule => rule.id),
        addRules: rules
      });
      return { success: true };
    })().catch(error => { frameRulesReady = null; throw error; });
  }
  return frameRulesReady;
}

async function setupSidePanel() {
  try {
    await prepareChatGPTFrame();
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('[ChatGPT Sidebar]', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupSidePanel();
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of [
      ['chatgpt-summarize', 'ChatGPT: Tóm tắt đoạn này', ['selection']],
      ['chatgpt-translate', 'ChatGPT: Dịch sang Tiếng Việt', ['selection']],
      ['chatgpt-explain', 'ChatGPT: Giải thích nội dung này', ['selection']],
      ['chatgpt-open-sidebar', 'Mở ChatGPT Sidebar', ['page']]
    ]) chrome.contextMenus.create({ id, title, contexts });
  });
});
chrome.runtime.onStartup.addListener(setupSidePanel);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-quiz-mode' || !Number.isInteger(tab?.windowId)) return;
  quizToggle(tab.windowId, undefined, tab).then(() => {
    chrome.action.setBadgeText({ text: '', tabId: tab.id });
    chrome.action.setTitle({ title: 'Mở ChatGPT Sidebar (Cmd+Shift+Y)', tabId: tab.id });
  }).catch(error => {
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    chrome.action.setTitle({ title: error.message, tabId: tab.id });
    console.error('[Đáp án tự động]', error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.windowId == null) return;
  const selected = info.selectionText?.trim();
  const instructions = {
    'chatgpt-summarize': 'Hãy tóm tắt ngắn gọn các ý chính của đoạn văn bản sau:',
    'chatgpt-translate': 'Hãy dịch đoạn văn bản sau sang Tiếng Việt tự nhiên và chính xác:',
    'chatgpt-explain': 'Hãy giải thích nội dung sau một cách dễ hiểu cho người mới bắt đầu:'
  };
  // Both operations start within the click handler, preserving the user gesture.
  if (selected && instructions[info.menuItemId]) {
    chrome.storage.local.set({
      [pendingKey(tab.windowId)]: {
        id: crypto.randomUUID(),
        text: `${instructions[info.menuItemId]}\n\n${selected}`
      }
    }).catch(console.error);
  }
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});

async function getActiveTab(windowId) {
  const query = { active: true };
  if (Number.isInteger(windowId)) query.windowId = windowId;
  else query.currentWindow = true;
  const [tab] = await chrome.tabs.query(query);
  return tab;
}

// Executed in the page, so this function must be self-contained.
function extractPageContent() {
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  const selectedText = window.getSelection()?.toString().trim().slice(0, 12000) || '';
  if (!root) return { title: document.title, url: location.href, content: '', selectedText };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const excluded = 'script, style, noscript, nav, footer, iframe, aside, [hidden], [aria-hidden="true"], dialog:not([open]), [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .popup, .swal2-container, .toast';
  const visibility = new WeakMap();
  const chunks = [];
  let length = 0;
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text || !parent || parent.closest(excluded)) continue;
    if (!visibility.has(parent)) {
      const style = getComputedStyle(parent);
      visibility.set(parent, style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && parent.getClientRects().length > 0);
    }
    if (!visibility.get(parent)) continue;
    chunks.push(text);
    length += text.length + 1;
    if (length > 12000) break;
  }
  return {
    title: document.title || '', url: location.href, selectedText,
    content: chunks.join('\n').slice(0, 12000), isTruncated: length > 12000
  };
}

async function openChatGPT(message) {
  const windowId = Number.isInteger(message.windowId) ? message.windowId : undefined;
  const query = { url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] };
  if (windowId !== undefined) query.windowId = windowId;
  const tabs = await chrome.tabs.query(query);
  let tab = tabs.find((item) => item.active) || tabs[0];
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, ...(windowId === undefined ? {} : { windowId }) });
  }
  if (!message.text) return { success: true, tabId: tab.id };
  // A new tab may need to finish loading and render its composer.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_PAGE_CONTEXT', text: message.text
      }, { frameId: 0 });
      if (response?.success) return { ...response, tabId: tab.id };
    } catch { /* The content script has not loaded yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { success: false, tabId: tab.id, error: 'Đăng nhập ChatGPT rồi bấm đưa vào tab lần nữa, hoặc dán nội dung đã sao chép.' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type?.startsWith('DOC_')) {
    handleDocumentMessage(message, sender).then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message?.type?.startsWith('QUIZ_')) {
    handleQuizMessage(message, sender).then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message?.type === 'CLOSE_SIDEBAR' && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    if (!chrome.sidePanel.close) { sendResponse({ success: false, error: 'Dùng nút X ở thanh tiêu đề của trình duyệt để đóng sidebar. Phân tích đáp án vẫn tiếp tục.' }); return; }
    chrome.sidePanel.close({ windowId: message.windowId }).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  const formTypes = ['IMPORT_FORM_JSON', 'SCAN_FORMS', 'START_FORM_AI', 'FORM_AI_RESULT', 'FORM_AI_PROGRESS', 'FORM_AI_LOCATION', 'FORM_AI_UNAVAILABLE', 'CANCEL_FORM_AI', 'RETRY_FORM_AI', 'APPLY_FORM_VALUES', 'UNDO_FORM_VALUES'];
  if (formTypes.includes(message?.type)) {
    handleFormMessage(message, sender).then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  const types = ['PREPARE_CHATGPT_FRAME', 'OPEN_CHATGPT_TAB', 'GET_ACTIVE_TAB_INFO', 'GET_ACTIVE_PAGE_CONTENT', 'ACK_PENDING_PROMPT'];
  if (!types.includes(message?.type)) return;
  (async () => {
    if (message.type === 'PREPARE_CHATGPT_FRAME') return prepareChatGPTFrame();
    if (message.type === 'OPEN_CHATGPT_TAB') return openChatGPT(message);
    if (message.type === 'ACK_PENDING_PROMPT') {
      const key = pendingKey(message.windowId);
      const stored = await chrome.storage.local.get(key);
      if (stored[key]?.id === message.id) await chrome.storage.local.remove(key);
      return { success: true };
    }
    const tab = await getActiveTab(message.windowId);
    if (message.type === 'GET_ACTIVE_TAB_INFO') {
      return tab ? { success: true, tab: { id: tab.id, title: tab.title, url: tab.url, status: tab.status, favIconUrl: tab.favIconUrl } } : { success: false };
    }
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '') || /^https:\/\/chromewebstore.google.com\//i.test(tab.url)) {
      return { success: false, error: 'Hãy mở một trang web thông thường để đọc nội dung.' };
    }
    if (Number.isInteger(message.tabId) && (tab.id !== message.tabId || tab.url !== message.pageUrl)) {
      return { success: false, error: 'Trang đã thay đổi. Đang chờ trang hiện tại.' };
    }
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageContent });
    if (Number.isInteger(message.tabId)) {
      const current = await getActiveTab(message.windowId);
      if (current?.id !== tab.id || current?.url !== tab.url || result?.result?.url !== tab.url) {
        return { success: false, error: 'Trang đã thay đổi trong lúc đọc nội dung.' };
      }
    }
    if (!result?.result?.content && !result?.result?.selectedText) {
      return { success: false, error: 'Trang này chưa có văn bản để đọc. Thử chọn một đoạn văn bản rồi bấm lại.' };
    }
    return { success: true, data: result.result, page: { tabId: tab.id, documentId: result.documentId, url: result.result.url } };
  })().then(sendResponse).catch((error) => {
    sendResponse({ success: false, error: error.message });
  });
  return true;
});
