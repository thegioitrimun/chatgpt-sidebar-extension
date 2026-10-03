// Manifest V3 service worker. Durable prompts survive a cold side panel.
const CHATGPT_URL = 'https://chatgpt.com/';
const pendingKey = (windowId) => `pendingPrompt:${windowId}`;

async function setupSidePanel() {
  try {
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
  const excluded = 'script, style, noscript, nav, footer, iframe, aside, [hidden], [aria-hidden="true"]';
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
      visibility.set(parent, style.display !== 'none' && style.visibility !== 'hidden' && parent.getClientRects().length > 0);
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
  const types = ['OPEN_CHATGPT_TAB', 'GET_ACTIVE_TAB_INFO', 'GET_ACTIVE_PAGE_CONTENT', 'ACK_PENDING_PROMPT'];
  if (!types.includes(message?.type)) return;
  (async () => {
    if (message.type === 'OPEN_CHATGPT_TAB') return openChatGPT(message);
    if (message.type === 'ACK_PENDING_PROMPT') {
      const key = pendingKey(message.windowId);
      const stored = await chrome.storage.local.get(key);
      if (stored[key]?.id === message.id) await chrome.storage.local.remove(key);
      return { success: true };
    }
    const tab = await getActiveTab(message.windowId);
    if (message.type === 'GET_ACTIVE_TAB_INFO') {
      return tab ? { success: true, tab: { id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl } } : { success: false };
    }
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '') || /^https:\/\/chromewebstore.google.com\//i.test(tab.url)) {
      return { success: false, error: 'Hãy mở một trang web thông thường để đọc nội dung.' };
    }
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageContent });
    if (!result?.result?.content && !result?.result?.selectedText) {
      return { success: false, error: 'Trang này chưa có văn bản để đọc. Thử chọn một đoạn văn bản rồi bấm lại.' };
    }
    return { success: true, data: result.result };
  })().then(sendResponse).catch((error) => {
    sendResponse({ success: false, error: error.message });
  });
  return true;
});
