(() => {
  // A hotkey can reattach after an extension update. Replace an old bridge
  // instead of calling a closure whose chrome.runtime context was invalidated.
  try { globalThis.sidebarQuizPage?.dispose?.(); } catch {}
  document.getElementById('chatgpt-quiz-overlay')?.remove();
  let state = { enabled: false }, signature = '', timer, host, root, verified = false, typographyFrame, scanning = false, rescan = false;
  const topFrame = window.parent === window;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, runId: state.runId, ...extra });
  function syncTypography() {
    const section = root?.querySelector('section');
    if (!section) return;
    let question;
    for (const selector of ['.qtext, .question-text, .question-title, .content-question, [data-question-text], legend', '.question-content']) {
      for (const element of document.querySelectorAll(selector)) {
        if (!element.textContent.trim() || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
        question ||= element;
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom > 0 && bounds.top < innerHeight) { question = element; break; }
      }
      if (question) break;
    }
    question ||= document.body || document.documentElement;
    const style = getComputedStyle(question);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color']) section.style[property] = style[property];
  }
  function scheduleTypography() {
    if (!host?.isConnected || typographyFrame) return;
    typographyFrame = requestAnimationFrame(() => { typographyFrame = null; syncTypography(); });
  }
  function render() {
    if (!topFrame) return;
    const currentPage = (verified || (state.engine === 'analysis' && state.error)) && state.pageUrl === location.href;
    if (!state.enabled || state.collapsed || !currentPage) { host?.remove(); host = root = null; return; }
    let created = false;
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
      created = true;
    }
    const section = root.querySelector('section');
    section.className = 'panel'; section.setAttribute('aria-label', 'Đáp án thử nghiệm');
    let answers = section.querySelector('.answers');
    if (!answers) { answers = document.createElement('div'); answers.className = 'answers'; answers.style.whiteSpace = 'pre-wrap'; section.append(answers); }
    const pageAnswers = verified ? state.answers : '';
    const text = state.engine === 'analysis' ? [pageAnswers, state.progress || (!pageAnswers ? state.status : '')].filter(Boolean).join('\n') : state.error ? state.status : state.answers || state.status || 'Đang đọc trang để phân tích…';
    if (answers.textContent !== text) answers.textContent = text;
    answers.setAttribute('role', state.error ? 'alert' : 'status');
    if (created) syncTypography();
  }
  function showError(error) {
    const message = error.message || 'Không kết nối được extension. Tải lại trang để tiếp tục.';
    state = { ...state, error: true, status: message, ...(state.engine === 'analysis' ? { progress: message } : {}) }; render();
  }
  function apply(next) {
    const changed = next.runId !== state.runId || next.enabled !== state.enabled;
    const resumed = state.paused && !next.paused;
    if (changed) { signature = ''; verified = false; }
    state = next; render();
    if ((changed || resumed) && state.enabled) schedule();
  }
  function schedule() {
    if (!state.enabled || state.paused) return;
    if (scanning) { rescan = true; return; }
    if (timer) return;
    timer = setTimeout(scan, 600);
  }
  async function scan() {
    timer = null;
    if (!state.enabled || state.paused) return;
    scanning = true;
    const runId = state.runId;
    try {
      const snapshot = extractQuizQuestions({ unlimited: state.engine === 'analysis' });
      const next = JSON.stringify([snapshot.url, snapshot.questions, state.engine === 'analysis' || !snapshot.questions.length ? snapshot.pageText : '']);
      if (next === signature) return;
      const response = state.engine === 'analysis' ? await transmit(snapshot, runId) : await send('QUIZ_SNAPSHOT', snapshot);
      if (!response?.success && !response?.stale) throw new Error(response?.error || 'Chưa đọc được câu hỏi.');
      if (response?.success && state.runId === runId && location.href === snapshot.url) { signature = next; verified = true; render(); scheduleTypography(); }
    } catch (error) { if (state.runId === runId) showError(error); }
    finally { scanning = false; if (rescan) { rescan = false; schedule(); } }
  }
  async function transmit(snapshot, runId) {
    const serialized = JSON.stringify(snapshot), bytes = new TextEncoder().encode(serialized);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (!state.enabled || state.runId !== runId || snapshot.url !== location.href) return { success: false, stale: true };
    const begin = await send('ANALYSIS_CAPTURE_BEGIN', { runId, url: snapshot.url, hash, bytes: bytes.length });
    if (!begin?.success || begin.duplicate) return begin;
    let sequence = begin.next || 0;
    while (sequence * 45000 < bytes.length && state.enabled && state.runId === runId && snapshot.url === location.href) {
      const chunk = bytes.subarray(sequence * 45000, (sequence + 1) * 45000);
      let binary = ''; for (let index = 0; index < chunk.length; index += 8192) binary += String.fromCharCode(...chunk.subarray(index, index + 8192));
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await send('ANALYSIS_CAPTURE_CHUNK', { runId, captureId: begin.captureId, sequence, data: btoa(binary) }); if (response?.success) break; }
        catch (error) { if (attempt === 2) throw error; }
      }
      if (!response?.success) throw Error(response?.error || 'Không lưu được gói trang. Phần đã nhận vẫn được giữ.');
      if (response.next <= sequence) throw Error('Không xác nhận được thứ tự gói trang.');
      sequence = response.next;
    }
    if (!state.enabled || state.runId !== runId || snapshot.url !== location.href) return { success: false, stale: true };
    return send('ANALYSIS_CAPTURE_COMMIT', { runId, captureId: begin.captureId });
  }
  async function refresh() {
    try { const response = await send('QUIZ_PAGE_READY'); if (response?.success) { signature = ''; apply(response.state); schedule(); } }
    catch (error) { if (state.enabled) showError(error); }
  }
  function receiveState(message, sender, respond) {
    if (message?.type !== 'QUIZ_PAGE_STATE') return;
    respond({ success: true }); apply(message.state);
  }
  chrome.runtime.onMessage.addListener(receiveState);
  // Only page-content changes can invalidate a snapshot. Progress/answer state
  // and ticking UI must not trigger another full DOM walk or a parallel upload.
  const ignored = 'script,style,noscript,nav,footer,[hidden],[aria-hidden="true"],[role="timer"],time,.timer,.countdown,.que .state,.que .grade,.questionflag,.question-flag,.flag,#chatgpt-quiz-overlay';
  const ignoredNode = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(ignored) || isQuizPlaybackTime(node);
  const observer = new MutationObserver(records => {
    if (!state.enabled) return;
    const changed = records.some(record => {
      if (ignoredNode(record.target)) return false;
      if (record.type === 'characterData') return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => !ignoredNode(node) && (node.nodeType === Node.ELEMENT_NODE || node.textContent.trim()));
    });
    if (changed) { schedule(); scheduleTypography(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  // SPA URL changes need not replace any DOM node.
  let previousUrl = location.href;
  const interval = setInterval(() => { if (previousUrl !== location.href) { previousUrl = location.href; signature = ''; verified = false; render(); schedule(); } }, 2000);
  window.addEventListener('resize', scheduleTypography);
  window.addEventListener('scroll', scheduleTypography, { passive: true });
  globalThis.sidebarQuizPage = { refresh, dispose() {
    state = { enabled: false }; rescan = false; clearTimeout(timer); clearInterval(interval); observer.disconnect(); host?.remove();
    cancelAnimationFrame(typographyFrame);
    window.removeEventListener('resize', scheduleTypography); window.removeEventListener('scroll', scheduleTypography);
    try { chrome.runtime.onMessage.removeListener(receiveState); } catch {}
  } };
  refresh();
})();
