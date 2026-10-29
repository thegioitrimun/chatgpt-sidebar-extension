(() => {
  // A hotkey can reattach after an extension update. Replace an old bridge
  // instead of calling a closure whose chrome.runtime context was invalidated.
  try { globalThis.sidebarQuizPage?.dispose?.(); } catch {}
  document.getElementById('chatgpt-quiz-overlay')?.remove();
  let state = { enabled: false }, signature = '', timer, host, root, verified = false;
  const topFrame = window.parent === window;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, runId: state.runId, ...extra });
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }
  function render() {
    if (!topFrame) return;
    if (!state.enabled || state.collapsed) { host?.remove(); host = root = null; return; }
    if (!host?.isConnected) {
      host = document.createElement('div'); host.id = 'chatgpt-quiz-overlay';
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:auto 12px 16px!important;z-index:2147483647!important;display:block!important;pointer-events:none!important;';
      root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host{color-scheme:light}*{box-sizing:border-box}.panel{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#162b29;background:rgba(255,255,255,.64);border:1px solid rgba(255,255,255,.85);box-shadow:0 4px 24px #102a2414;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);pointer-events:auto}
        .panel{max-width:640px;margin:0 auto;border-radius:14px;padding:11px 15px}.line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.status{flex:1;min-width:100px;font-size:11px;color:#47615b}.answers{font-size:18px;font-weight:650;letter-spacing:.15px;overflow-wrap:anywhere;max-height:28vh;overflow:auto;margin-top:5px}.controls{display:flex;gap:4px;flex-wrap:wrap}button{font:inherit;cursor:pointer;background:#ffffff8c;border:1px solid #294d3f20;color:#274e43;border-radius:7px;padding:3px 8px}button:hover{background:#fff}button:focus-visible{outline:2px solid #08785e;outline-offset:2px}.error{color:#9e381e}@media(max-width:400px){.panel{padding:9px 11px}.answers{font-size:16px}.status{flex-basis:100%}}`;
      root.append(style, document.createElement('section'));
      (document.body || document.documentElement).append(host);
    }
    const section = root.querySelector('section'); section.replaceChildren();
    section.className = '';
    section.className = 'panel'; section.setAttribute('aria-label', 'Đáp án thử nghiệm');
    const line = document.createElement('div'); line.className = 'line';
    const status = document.createElement('span'); status.className = `status${state.error ? ' error' : ''}`;
    const currentPage = verified && state.pageUrl === location.href;
    status.textContent = state.error || currentPage ? state.status || 'Đang chờ câu hỏi…' : 'Đang đọc câu hỏi…'; status.setAttribute('role', 'status');
    const controls = document.createElement('div'); controls.className = 'controls';
    if (state.error) {
      controls.append(button(state.retryLabel || 'Thử lại', () => send('QUIZ_RETRY').catch(showError)));
      controls.append(button('Mở ChatGPT', () => send('QUIZ_OPEN_CHAT').catch(showError)));
    }
    controls.append(button('Ẩn', () => send('QUIZ_COLLAPSE', { collapsed: true }).catch(showError)), button('Dừng', () => send('QUIZ_STOP').catch(showError)));
    line.append(status, controls); section.append(line);
    if (state.referenceName) {
      const source = document.createElement('div'); source.className = 'status'; source.textContent = `Nguồn: ${state.referenceName}`;
      source.style.overflowWrap = 'anywhere'; section.append(source);
    }
    if (currentPage && state.answers) {
      const answers = document.createElement('div'); answers.className = 'answers'; answers.textContent = state.answers;
      section.append(answers);
    }
  }
  function showError(error) { state = { ...state, error: true, status: error.message || 'Không kết nối được extension. Tải lại trang để tiếp tục.' }; render(); }
  function apply(next) {
    if (next.runId !== state.runId || next.enabled !== state.enabled) { signature = ''; verified = false; }
    state = next; render();
    if (state.enabled) schedule();
  }
  function schedule() {
    if (!state.enabled || timer) return;
    timer = setTimeout(scan, 600);
  }
  async function scan() {
    timer = null;
    if (!state.enabled) return;
    const runId = state.runId;
    try {
      const snapshot = extractQuizQuestions();
      const next = JSON.stringify([snapshot.url, snapshot.questions]);
      if (next === signature) return;
      signature = next;
      const response = await send('QUIZ_SNAPSHOT', snapshot);
      if (!response?.success && !response?.stale) throw new Error(response?.error || 'Chưa đọc được câu hỏi.');
      if (response?.success && state.runId === runId && location.href === snapshot.url) { verified = true; render(); }
    } catch (error) { if (state.runId === runId) showError(error); }
  }
  async function refresh() {
    try { const response = await send('QUIZ_PAGE_READY'); if (response?.success) { signature = ''; apply(response.state); } }
    catch (error) { if (state.enabled) showError(error); }
  }
  function receiveState(message, sender, respond) {
    if (message?.type !== 'QUIZ_PAGE_STATE') return;
    respond({ success: true }); apply(message.state);
  }
  chrome.runtime.onMessage.addListener(receiveState);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  // SPA URL changes need not replace any DOM node.
  let previousUrl = location.href;
  const interval = setInterval(() => { if (previousUrl !== location.href) { previousUrl = location.href; signature = ''; verified = false; render(); schedule(); } }, 2000);
  globalThis.sidebarQuizPage = { refresh, dispose() {
    state = { enabled: false }; clearTimeout(timer); clearInterval(interval); observer.disconnect(); host?.remove();
    try { chrome.runtime.onMessage.removeListener(receiveState); } catch {}
  } };
  refresh();
})();
