// Runs in ChatGPT's isolated content-script world, including the sidebar frame.
(() => {
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  const findInput = () => document.querySelector('#prompt-textarea, .ProseMirror[contenteditable="true"], textarea[data-id="root"], main form textarea');

  function insertText(text) {
    const input = findInput();
    if (!input || input.disabled || input.getAttribute('contenteditable') === 'false') {
      return { success: false, reason: 'INPUT_NOT_FOUND' };
    }
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      // Native setter also updates React-controlled textareas.
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: input.value === text };
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    // Editing through the browser keeps ProseMirror's document state in sync.
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      try {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', text);
        input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
      } catch { /* Caller retains the text for copying. */ }
    }
    const normalize = (value) => value.replace(/\s+/g, ' ').trim();
    const actual = normalize(input.innerText);
    input.scrollTop = input.scrollHeight;
    return { success: actual === normalize(text), reason: 'EDITOR_RESULT' };
  }

  const formRuns = new Map();
  const readers = new Map();
  const sleep = (duration) => new Promise(resolve => setTimeout(resolve, duration));
  const reportForm = (message, result) => window.parent.postMessage({ ...result, type: 'SIDEBAR_FORM_AI_EVENT', eventType: result.type, jobId: message.jobId, bridgeToken: message.bridgeToken, conversationUrl: location.href }, extensionOrigin);

  function readFormReply(message) {
    // ChatGPT uses several code/message renderers. Match the actual job and field IDs,
    // rather than relying on role attributes, a visible user prompt, or one code tag.
    const containers = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-testid^="conversation-turn"], .markdown, pre, [data-testid="code-block"], [data-testid="code-block-content"], [data-is-streaming], [role="article"], [role="log"], main article')].slice(-60).reverse();
    containers.push(document.querySelector('main') || document.body);
    for (const container of containers) {
      if (!container) continue;
      for (const text of [container.textContent, container.innerText]) {
        const data = globalThis.sidebarFormJSON.extract((text || '').slice(-200000), message.jobId, message.fieldIds);
        if (data) return { data, container };
      }
    }
    return null;
  }

  function watchFormReply(message, reportTimeout = false) {
    const existing = readers.get(message.jobId);
    if (existing && existing.bridgeToken === message.bridgeToken && !existing.cancelled && (!existing.finished || existing.delivered)) {
      existing.reportTimeout ||= reportTimeout;
      return existing.task;
    }
    const state = { bridgeToken: message.bridgeToken, cancelled: false, delivered: false, finished: false, reportTimeout };
    readers.set(message.jobId, state);
    state.task = (async () => {
      const deadline = Date.now() + (message.mode === 'complete' ? 300000 : 180000);
      let previous = '', changedAt = Date.now(), sentAt = 0, conversationUrl = location.href;
      while (!state.cancelled && !state.delivered && Date.now() < deadline) {
        if (location.href !== conversationUrl) {
          conversationUrl = location.href;
          reportForm(message, { type: 'FORM_AI_LOCATION' });
        }
        const reply = readFormReply(message);
        const text = reply ? JSON.stringify(reply.data) : '';
        if (text !== previous) { previous = text; changedAt = Date.now(); }
        const turn = reply?.container.closest('[data-message-author-role="assistant"], [data-testid^="conversation-turn"], article') || reply?.container;
        const generating = document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Dừng tạo"], button[aria-label="Dừng tạo câu trả lời"]') || turn?.matches('[data-is-streaming="true"]') || turn?.querySelector('[data-is-streaming="true"]');
        if (text && !generating && Date.now() - changedAt > 1800 && Date.now() - sentAt > 1200) {
          reportForm(message, { type: 'FORM_AI_RESULT', text });
          sentAt = Date.now();
        }
        await sleep(400);
      }
      if (!state.cancelled && !state.delivered && state.reportTimeout) reportForm(message, { type: 'FORM_AI_RESULT', error: 'Chưa đọc được kết quả JSON của phiên này. Extension vẫn tự kiểm tra lại câu trả lời; bạn có thể bấm Đọc lại kết quả AI.' });
    })().catch(error => { if (!state.cancelled) reportForm(message, { type: 'FORM_AI_RESULT', error: error.message }); }).finally(() => { state.finished = true; });
    return state.task;
  }

  async function analyzeForm(message, state) {
    try {
      if (document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Dừng tạo"], button[aria-label="Dừng tạo câu trả lời"]')) throw new Error('ChatGPT đang trả lời. Chờ trả lời xong rồi Thử lại AI.');
      const input = findInput();
      const draft = input instanceof HTMLTextAreaElement ? input.value : input?.innerText;
      const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
      if (normalize(draft) && normalize(draft) !== normalize(message.prompt)) throw new Error('Ô ChatGPT đang có bản nháp. Giữ hoặc xóa bản nháp trong sidebar rồi Thử lại AI.');
      if (!insertText(message.prompt).success) throw new Error('Không điền được yêu cầu phân tích vào ChatGPT.');
      let button;
      for (let attempt = 0; attempt < 30 && !state.cancelled; attempt++) {
        button = document.querySelector('button[data-testid="send-button"], button[data-testid="composer-submit-button"], button#composer-submit-button, button[aria-label="Send"], button[aria-label="Gửi"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Gửi tin nhắn"], form button[type="submit"]');
        if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') break;
        button = null; await sleep(200);
      }
      if (state.cancelled) return;
      if (!button) throw new Error('Không tìm được nút gửi ChatGPT. Xem AI trong sidebar để kiểm tra, rồi Thử lại AI.');
      button.click();
      reportForm(message, { type: 'FORM_AI_PROGRESS' });
      await watchFormReply(message, true);
    } catch (error) {
      if (!state.cancelled) reportForm(message, { type: 'FORM_AI_RESULT', error: error.message });
    } finally { state.finished = true; }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'INJECT_PAGE_CONTEXT' || typeof message.text !== 'string') return;
    sendResponse(insertText(message.text));
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== extensionOrigin) return;
    if (event.data?.type === 'SIDEBAR_FORM_AI_RESULT_ACK') {
      const reader = readers.get(event.data.jobId);
      if (reader && reader.bridgeToken === event.data.bridgeToken && event.data.success === true) reader.delivered = true;
      return;
    }
    if (event.data?.type === 'SIDEBAR_FORM_AI_CANCEL') {
      const state = formRuns.get(event.data.jobId);
      const reader = readers.get(event.data.jobId);
      if (reader && reader.bridgeToken === event.data.bridgeToken) reader.cancelled = true;
      if (state && state.bridgeToken === event.data.bridgeToken) {
        state.cancelled = true;
        if (!state.finished) document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"]')?.click();
      }
      return;
    }
    if (event.data?.type === 'SIDEBAR_FORM_AI_READ') {
      const message = event.data;
      if (typeof message.jobId === 'string' && typeof message.bridgeToken === 'string' && Array.isArray(message.fieldIds)) watchFormReply(message, true);
      return;
    }
    if (event.data?.type === 'SIDEBAR_FORM_AI_START') {
      const message = event.data;
      if (typeof message.prompt !== 'string' || typeof message.jobId !== 'string' || typeof message.bridgeToken !== 'string' || !Array.isArray(message.fieldIds)) return;
      const acknowledge = success => window.parent.postMessage({ type: 'SIDEBAR_FORM_AI_ACK', jobId: message.jobId, bridgeToken: message.bridgeToken, success }, extensionOrigin);
      if (!findInput()) { acknowledge(false); return; }
      const existing = formRuns.get(message.jobId);
      if (existing && !existing.finished && !existing.cancelled) { acknowledge(existing.bridgeToken === message.bridgeToken); return; }
      const active = [...formRuns.values()].some(state => !state.finished && !state.cancelled);
      if (active) { acknowledge(false); return; }
      const state = { cancelled: false, finished: false, bridgeToken: message.bridgeToken };
      formRuns.set(message.jobId, state);
      acknowledge(true);
      analyzeForm(message, state);
      return;
    }
    if (event.data?.type === 'SIDEBAR_INJECT_PAGE_CONTEXT' && typeof event.data.text === 'string') {
      const result = insertText(event.data.text);
      window.parent.postMessage({ type: 'SIDEBAR_INJECT_RESULT', id: event.data.id, ...result }, extensionOrigin);
    }
  });

  if (window.parent !== window) {
    let reported = false;
    const observer = new MutationObserver(reportReady);
    function reportReady() {
      if (reported || !findInput()) return;
      reported = true;
      window.parent.postMessage({ type: 'SIDEBAR_CHAT_READY' }, extensionOrigin);
      observer.disconnect();
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    reportReady();
    setTimeout(() => observer.disconnect(), 30000);
  }
})();
