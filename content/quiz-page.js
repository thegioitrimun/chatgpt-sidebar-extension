(() => {
  // A hotkey can reattach after an extension update. Replace an old bridge
  // instead of calling a closure whose chrome.runtime context was invalidated.
  try { globalThis.sidebarQuizPage?.dispose?.(); } catch {}
  document.getElementById('chatgpt-quiz-overlay')?.remove();
  let state = { enabled: false }, signature = '', timer, host, root, verified = false, typographyFrame;
  const topFrame = window.parent === window;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, runId: state.runId, ...extra });
  function syncTypography() {
    const section = root?.querySelector('section');
    if (!section) return;
    const visible = selector => [...document.querySelectorAll(selector)].filter(element => {
      const style = getComputedStyle(element);
      return element.textContent.trim() && element.getClientRects().length && style.visibility !== 'hidden';
    });
    let questions = visible('.qtext, .question-text, .question-title, .content-question, [data-question-text], legend');
    if (!questions.length) questions = visible('.question-content');
    const question = questions.find(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < innerHeight;
    }) || questions[0] || document.body || document.documentElement;
    const style = getComputedStyle(question);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color']) section.style[property] = style[property];
  }
  function scheduleTypography() {
    if (!host?.isConnected || typographyFrame) return;
    typographyFrame = requestAnimationFrame(() => { typographyFrame = null; syncTypography(); });
  }
  function render() {
    if (!topFrame) return;
    const currentPage = verified && state.pageUrl === location.href;
    if (!state.enabled || state.collapsed || !currentPage) { host?.remove(); host = root = null; return; }
    if (!host?.isConnected) {
      host = document.createElement('div'); host.id = 'chatgpt-quiz-overlay';
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:auto 12px 16px!important;z-index:2147483647!important;display:block!important;pointer-events:none!important;';
      root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        *{box-sizing:border-box}.panel{max-width:640px;margin:0 auto;padding:0;background:transparent;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;pointer-events:none}
        .answers{font:inherit;color:inherit;letter-spacing:inherit;overflow-wrap:anywhere}`;
      root.append(style, document.createElement('section'));
      (document.body || document.documentElement).append(host);
    }
    const section = root.querySelector('section'); section.replaceChildren();
    section.className = 'panel'; section.setAttribute('aria-label', 'Đáp án thử nghiệm');
    const answers = document.createElement('div'); answers.className = 'answers'; answers.textContent = state.error ? state.status : state.answers || state.status || 'Đang đọc trang để phân tích…';
    answers.setAttribute('role', state.error ? 'alert' : 'status');
    section.append(answers);
    syncTypography();
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
      const next = JSON.stringify([snapshot.url, snapshot.questions, snapshot.questions.length ? '' : snapshot.pageText]);
      if (next === signature) return;
      const response = await send('QUIZ_SNAPSHOT', snapshot);
      if (!response?.success && !response?.stale) throw new Error(response?.error || 'Chưa đọc được câu hỏi.');
      if (response?.success && state.runId === runId && location.href === snapshot.url) { signature = next; verified = true; render(); }
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
  window.addEventListener('resize', scheduleTypography);
  window.addEventListener('scroll', scheduleTypography, { passive: true });
  globalThis.sidebarQuizPage = { refresh, dispose() {
    state = { enabled: false }; clearTimeout(timer); clearInterval(interval); observer.disconnect(); host?.remove();
    cancelAnimationFrame(typographyFrame);
    window.removeEventListener('resize', scheduleTypography); window.removeEventListener('scroll', scheduleTypography);
    try { chrome.runtime.onMessage.removeListener(receiveState); } catch {}
  } };
  refresh();
})();
