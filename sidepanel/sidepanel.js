const CHATGPT_URL = 'https://chatgpt.com/';

document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const frame = $('chatgpt-frame');
  let windowId;
  let lastPrompt = '';
  let pending = null;
  let busy = false;
  let loadTimer;
  let toastTimer;
  let frameLoadId = 0;
  const requests = new Map();
  const handledPrompts = new Set();
  const status = document.querySelector('.status-text');
  const insertButton = $('btn-insert-page');
  const originalButton = insertButton.innerHTML;
  const send = (message) => chrome.runtime.sendMessage({ ...message, windowId });

  function toast(text) {
    clearTimeout(toastTimer);
    $('toast').textContent = text;
    $('toast').classList.remove('hidden');
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
  }

  function stopLoading() {
    clearTimeout(loadTimer);
    $('progress-bar').classList.add('hidden');
    $('reload-icon').classList.remove('spinning');
  }

  function showFallback() {
    stopLoading();
    status.textContent = 'Mở tab';
    $('error-overlay').classList.remove('hidden');
  }

  async function reloadFrame() {
    const loadId = ++frameLoadId;
    status.textContent = 'Đang tải';
    $('error-overlay').classList.add('hidden');
    $('progress-bar').classList.remove('hidden');
    $('reload-icon').classList.add('spinning');
    clearTimeout(loadTimer);
    loadTimer = setTimeout(showFallback, 15000);
    try {
      const response = await send({ type: 'PREPARE_CHATGPT_FRAME' });
      if (loadId !== frameLoadId) return;
      if (!response?.success) throw new Error(response?.error || 'Không chuẩn bị được sidebar.');
      frame.src = window.sidebarFormConversationUrl || CHATGPT_URL;
    } catch (error) {
      if (loadId !== frameLoadId) return;
      showFallback();
      toast(error.message);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function inject(text) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { requests.delete(id); resolve(false); }, 1800);
      requests.set(id, (success) => { clearTimeout(timer); requests.delete(id); resolve(success); });
      frame.contentWindow.postMessage({ type: 'SIDEBAR_INJECT_PAGE_CONTEXT', id, text }, 'https://chatgpt.com');
    });
  }

  async function acknowledgePrompt(text) {
    if (!pending || pending.text !== text) return;
    const delivered = pending;
    pending = null;
    await send({ type: 'ACK_PENDING_PROMPT', id: delivered.id }).catch(() => {});
  }

  async function deliver(text) {
    if (window.sidebarFormAnalysisRunning) { toast('AI đang phân tích form. Chờ xong hoặc hủy trước khi đưa nội dung khác vào chat.'); return false; }
    lastPrompt = text;
    $('prompt-preview').value = text;
    const [copied, inserted] = await Promise.all([copy(text), inject(text)]);
    if (lastPrompt !== text) return inserted;
    if (inserted) {
      toast('Đã điền vào ô chat. Bạn có thể sửa nội dung rồi bấm gửi.');
      await acknowledgePrompt(text);
    } else {
      showFallback();
      toast(copied ? 'Đã sao chép. Mở tab ChatGPT để điền hoặc dán nội dung.' : 'Nội dung đã giữ bên dưới. Bấm đưa vào tab ChatGPT hoặc sao chép.');
    }
    return inserted;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== 'https://chatgpt.com') return;
    if (event.data?.type === 'SIDEBAR_CHAT_READY') {
      stopLoading();
      status.textContent = 'Sẵn sàng';
      $('error-overlay').classList.add('hidden');
      if (lastPrompt) deliver(lastPrompt).catch((error) => toast(error.message));
    } else if (event.data?.type === 'SIDEBAR_INJECT_RESULT') {
      requests.get(event.data.id)?.(event.data.success === true);
    }
  });
  frame.addEventListener('error', showFallback);

  async function openTab() {
    const button = $('btn-error-open');
    const text = lastPrompt;
    button.disabled = true;
    try {
      const response = await send({ type: 'OPEN_CHATGPT_TAB', text });
      if (response?.success) {
        toast(text ? 'Đã điền nội dung vào tab ChatGPT.' : 'Đã mở tab ChatGPT.');
        if (text) await acknowledgePrompt(text);
      } else toast(response?.error || 'Không mở được ChatGPT.');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  async function updateActiveTabInfo() {
    try {
      const response = await send({ type: 'GET_ACTIVE_TAB_INFO' });
      const tab = response?.tab;
      $('active-page-title').textContent = tab?.title || tab?.url || 'Không có trang web đang mở';
      $('active-page-title').title = tab?.url || '';
      $('active-page-icon').textContent = '🌐';
      if (/^https?:\/\//.test(tab?.favIconUrl || '')) {
        const image = document.createElement('img');
        image.src = tab.favIconUrl;
        image.alt = '';
        image.addEventListener('error', () => { $('active-page-icon').textContent = '🌐'; });
        $('active-page-icon').replaceChildren(image);
      }
    } catch (error) { toast(error.message); }
  }

  async function insertPage(summarize = false) {
    if (busy) return;
    busy = true;
    insertButton.disabled = true;
    insertButton.classList.add('loading');
    insertButton.textContent = 'Đang đọc…';
    try {
      const response = await send({ type: 'GET_ACTIVE_PAGE_CONTENT' });
      if (!response?.success) throw new Error(response?.error || 'Không đọc được trang.');
      const { title, url, selectedText, content, isTruncated } = response.data;
      const prompt = [
        summarize ? 'Hãy tóm tắt ngắn gọn các ý chính của trang web sau bằng Tiếng Việt:' : 'Hãy phân tích các ý chính và thông tin hữu ích của trang web sau:',
        `Tiêu đề: ${title}`, `URL: ${url}`,
        selectedText ? `Đoạn đang chọn:\n${selectedText}` : '',
        `Nội dung trang:\n${content || selectedText}`,
        isTruncated ? '(Nội dung được giới hạn ở 12.000 ký tự đầu.)' : ''
      ].filter(Boolean).join('\n\n');
      await deliver(prompt);
      $('prompts-drawer').classList.add('hidden');
    } catch (error) { toast(error.message); }
    finally {
      busy = false;
      insertButton.disabled = false;
      insertButton.classList.remove('loading');
      insertButton.innerHTML = originalButton;
    }
  }

  async function receivePending(item) {
    if (!item?.id || !item.text || handledPrompts.has(item.id)) return;
    handledPrompts.add(item.id);
    pending = item;
    await deliver(item.text);
  }

  $('btn-insert-page').addEventListener('click', () => insertPage());
  $('btn-summarize-page').addEventListener('click', () => insertPage(true));
  for (const id of ['btn-reload', 'btn-home', 'btn-banner-reload', 'btn-error-retry']) $(id).addEventListener('click', reloadFrame);
  for (const id of ['btn-open-tab', 'btn-banner-login', 'btn-modal-open-login', 'btn-error-open']) $(id).addEventListener('click', openTab);
  $('btn-copy-prompt').addEventListener('click', async () => {
    const text = $('prompt-preview').value;
    if (!text) return toast('Hãy chọn nội dung trang hoặc một mẫu lệnh trước.');
    if (await copy(text)) toast('Đã sao chép. Dán vào ChatGPT bằng Cmd+V hoặc Ctrl+V.');
    else { $('prompt-preview').focus(); $('prompt-preview').select(); toast('Nhấn Cmd+C hoặc Ctrl+C để sao chép nội dung đã chọn.'); }
  });
  $('prompt-preview').addEventListener('input', () => { lastPrompt = $('prompt-preview').value; });
  $('btn-banner-close').addEventListener('click', () => {
    $('login-banner').classList.add('hidden');
    chrome.storage.local.set({ hideLoginBanner: true }).catch(() => {});
  });
  $('btn-prompts').addEventListener('click', () => $('prompts-drawer').classList.toggle('hidden'));
  $('btn-close-drawer').addEventListener('click', () => $('prompts-drawer').classList.add('hidden'));
  $('btn-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  for (const id of ['btn-close-modal', 'btn-modal-done']) $(id).addEventListener('click', () => $('help-modal').classList.add('hidden'));
  $('btn-modal-reload').addEventListener('click', () => { $('help-modal').classList.add('hidden'); reloadFrame(); });
  $('help-modal').addEventListener('click', (event) => { if (event.target === $('help-modal')) $('help-modal').classList.add('hidden'); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('help-modal').classList.add('hidden'); });
  document.querySelectorAll('.quick-template').forEach((button) => {
    button.addEventListener('click', () => {
      $('prompts-drawer').classList.add('hidden');
      deliver(button.dataset.template.replace(/\\n/g, '\n')).catch((error) => toast(error.message));
    });
  });

  try {
    windowId = (await chrome.windows.getCurrent()).id;
    chrome.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) updateActiveTabInfo(); });
    chrome.tabs.onUpdated.addListener((id, info, tab) => {
      if (tab.active && tab.windowId === windowId && (info.title || info.url || info.status === 'complete')) updateActiveTabInfo();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') receivePending(changes[`pendingPrompt:${windowId}`]?.newValue).catch((error) => toast(error.message));
    });
    const stored = await chrome.storage.local.get(['hideLoginBanner', `pendingPrompt:${windowId}`]);
    if (stored.hideLoginBanner) $('login-banner').classList.add('hidden');
    updateActiveTabInfo();
    reloadFrame();
    receivePending(stored[`pendingPrompt:${windowId}`]).catch((error) => toast(error.message));
  } catch (error) { showFallback(); toast(error.message); }
});
