// Runtime transport for the dedicated normal ChatGPT tab. Never depends on a
// parent frame, side panel DOM, or the worker remaining in memory.
globalThis.initializeSidebarQuizChat = function ({ findInput, inputText, normalizeText, isGenerating, injectPageContext, hasOtherJob }) {
  let current;
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = (state, type, extra = {}) => chrome.runtime.sendMessage({ type, jobId: state.jobId, token: state.token, runId: state.runId, conversationUrl: location.href, ...extra });
  function replyFor(state) {
    return globalThis.sidebarQuizChatDOM.readReply(document, state.jobId);
  }
  const hasReference = state => !state.referenceUrl || sidebarQuiz.conversationUrl(location.href) === state.referenceUrl;
  async function watch(state) {
    const deadline = Date.now() + 300000;
    let previous = '', changedAt = Date.now(), lastUrl = '';
    while (!state.cancelled && Date.now() < deadline) {
      if (!hasReference(state)) throw new Error('Cuộc chat đã đổi địa chỉ; dừng đọc để tránh lẫn nguồn PDF.');
      if (lastUrl !== location.href) { lastUrl = location.href; await report(state, 'QUIZ_CHAT_LOCATION').catch(() => {}); }
      const reply = replyFor(state);
      if (reply.changed) throw new Error('Cuộc chat có tin nhắn khác sau lượt phân tích. Kiểm tra ChatGPT trước khi thử lại.');
      if (reply.text !== previous) { previous = reply.text; changedAt = Date.now(); }
      if (reply.text && !isGenerating() && Date.now() - changedAt > 1100) {
        if (!sidebarQuiz.parse(reply.text, state.questions)) throw new Error('ChatGPT trả lời khác định dạng đáp án. Bấm đọc lại hoặc thử lại câu thiếu.');
        // Release the local lock before RESULT: its acknowledgement may cause
        // the worker to dispatch the next batch immediately.
        state.finished = true;
        const response = await report(state, 'QUIZ_CHAT_RESULT', { text: reply.text }).catch(() => null);
        if (response?.success || response?.stale) return;
        state.finished = false;
      }
      if (state.reading && !reply.found && Date.now() - state.startedAt > 120000 && !isGenerating()) throw new Error('Chưa tải được lượt này trong cuộc chat. Kiểm tra kết nối hoặc đăng nhập ChatGPT để tiếp tục.');
      await pause(500);
    }
    if (!state.cancelled) throw new Error('ChatGPT chưa trả lời xong hoặc kết nối bị gián đoạn. Bấm đọc lại để tiếp tục.');
  }
  async function run(state) {
    try {
      if (!state.reading) {
        state.beforeSubmit = async () => {
          if (!hasReference(state)) return false;
          const response = await report(state, 'QUIZ_CHAT_WILL_SEND');
          return response?.success === true;
        };
        const result = await injectPageContext(state.prompt, true, state);
        if (state.cancelled) return;
        if (!result.success) throw new Error(result.error || 'Chưa gửi được câu hỏi. Mở ChatGPT để kiểm tra.');
        await report(state, 'QUIZ_CHAT_PROGRESS');
      }
      await watch(state);
    } catch (error) {
      if (!state.cancelled) await report(state, 'QUIZ_CHAT_ERROR', { error: error.message, definitelyUnsent: !state.reading && !state.submitted, reading: state.reading }).catch(() => {});
    } finally { state.finished = true; ready(); }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('QUIZ_CHAT_')) return;
    if (message.type === 'QUIZ_CHAT_CANCEL') {
      if (current?.jobId === message.jobId && current.token === message.token) current.cancelled = true;
      respond({ success: true }); return;
    }
    if (!['QUIZ_CHAT_START', 'QUIZ_CHAT_READ'].includes(message.type)) return;
    if (typeof message.jobId !== 'string' || typeof message.token !== 'string' || typeof message.runId !== 'string' || typeof message.prompt !== 'string' || !Array.isArray(message.questions) || !message.questions.length || message.questions.length > 5) { respond({ success: false }); return; }
    if (!hasReference(message)) { respond({ success: false, referenceMismatch: true }); return; }
    const reading = message.type === 'QUIZ_CHAT_READ';
    if (current?.jobId === message.jobId && current.token === message.token && current.runId === message.runId && !current.finished && !current.cancelled) { respond({ success: true }); return; }
    if (current && !current.finished && !current.cancelled) { respond({ success: false, ready: false }); return; }
    if (!reading && (!findInput() || isGenerating() || hasOtherJob())) { respond({ success: false, ready: false, waiting: true }); return; }
    if (!reading && normalizeText(inputText(findInput())) && normalizeText(inputText(findInput())) !== normalizeText(message.prompt)) { respond({ success: false, ready: false, waiting: true, draft: true }); return; }
    const state = { ...message, reading, automatic: true, cancelled: false, finished: false, submitted: false, startedAt: Date.now() };
    current = state;
    respond({ success: true });
    run(state);
  });
  let wasReady = false, readyTimer;
  function ready() {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      const nowReady = !!findInput() && !normalizeText(inputText(findInput())) && !isGenerating() && !hasOtherJob() && (!current || current.finished || current.cancelled);
      if (nowReady && !wasReady) chrome.runtime.sendMessage({ type: 'QUIZ_CHAT_READY' }).catch(() => {});
      wasReady = nowReady;
    }, 200);
  }
  new MutationObserver(ready).observe(document.documentElement, { childList: true, subtree: true });
  ready();
  return { isBusy: state => current && !current.finished && !current.cancelled && current !== state };
};
