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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'INJECT_PAGE_CONTEXT' || typeof message.text !== 'string') return;
    sendResponse(insertText(message.text));
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== extensionOrigin) return;
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
