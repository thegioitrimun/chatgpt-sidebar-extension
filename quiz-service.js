// The worker owns the queue; neither the side panel nor an open UI is required.
const quizKey = windowId => `quizSession:${windowId}`;
const quizQueues = new Map();
const quizChatBridgeVersion = 3;
const quizReferenceKey = 'quizReference';
const quizHost = url => { try { return new URL(url).origin === 'https://elearning.vinmec.com'; } catch { return false; } };
const chatHost = url => { try { return ['https://chatgpt.com', 'https://chat.openai.com'].includes(new URL(url).origin); } catch { return false; } };
const quizGet = async windowId => (await chrome.storage.session.get(quizKey(windowId)))[quizKey(windowId)];

async function quizReferenceGet() {
  const value = (await chrome.storage.local.get(quizReferenceKey))[quizReferenceKey];
  return { enabled: value?.enabled === true, url: sidebarQuiz.conversationUrl(value?.url), name: typeof value?.name === 'string' ? value.name.slice(0, 120) : '', revision: value?.revision || '' };
}

async function quizReferenceSet(value) {
  const previous = await quizReferenceGet();
  const next = { enabled: value?.enabled === true, url: sidebarQuiz.conversationUrl(value?.url), name: typeof value?.name === 'string' ? value.name.trim().slice(0, 120) : '' };
  if (next.enabled && !next.url) throw new Error('Dán địa chỉ cuộc chat đã đính kèm PDF: https://chatgpt.com/c/…');
  // Editing a saved reference takes effect on the next activation. Running
  // batches retain their source snapshot, including across worker restarts.
  next.revision = previous.enabled === next.enabled && previous.url === next.url && previous.name === next.name && value?.refresh !== true ? previous.revision : crypto.randomUUID();
  await chrome.storage.local.set({ [quizReferenceKey]: next });
  return next;
}

function quizConversationMatches(mode, url) {
  return !mode.reference?.enabled || sidebarQuiz.conversationUrl(url) === mode.reference.url;
}

function quizSerial(windowId, operation) {
  const task = (quizQueues.get(windowId) || Promise.resolve()).catch(() => {}).then(operation);
  quizQueues.set(windowId, task);
  task.finally(() => { if (quizQueues.get(windowId) === task) quizQueues.delete(windowId); }).catch(() => {});
  return task;
}

function quizView(mode) {
  if (!mode) return { enabled: false };
  const answers = mode.questions.filter(question => mode.answers[question.id]).map(question => ({ number: question.number, answer: mode.answers[question.id] })).sort((a, b) => a.number - b.number);
  const count = answers.length;
  return {
    enabled: mode.enabled, runId: mode.runId, tabId: mode.tabId, pageUrl: mode.sourceUrl, collapsed: mode.collapsed,
    answers: answers.map(item => `${item.number}${item.answer}`).join(', '), referenceName: mode.reference?.enabled ? mode.reference.name || 'PDF đã đính kèm' : '',
    status: mode.error || mode.waiting || (mode.job ? `Đã có ${count}/${mode.questions.length} • Đang xử lý ${mode.job.questions.map(question => question.number).join(', ')}` : mode.questions.length ? `Đã có ${count}/${mode.questions.length} đáp án • Đang theo dõi câu mới` : 'Đang chờ câu hỏi…'),
    error: !!mode.error, retryLabel: mode.job?.mayHaveSent && !mode.job.readAttempted ? 'Đọc lại ChatGPT' : 'Thử lại câu thiếu'
  };
}

async function quizSave(mode) {
  // Save before notifying a UI or dispatching anything that may send a prompt.
  await chrome.storage.session.set({ [quizKey(mode.windowId)]: mode });
  await chrome.tabs.sendMessage(mode.tabId, { type: 'QUIZ_PAGE_STATE', state: quizView(mode) }).catch(() => {});
}

async function quizAttach(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/quiz-extract.js', 'content/quiz-page.js'] });
}

async function quizRestoreDiscard(mode) {
  if (mode.chatTabId) await chrome.tabs.update(mode.chatTabId, { autoDiscardable: true }).catch(() => {});
}

async function quizToggle(windowId, enabled, sourceTab, expectedRunId) {
  return quizSerial(windowId, async () => {
    let mode = await quizGet(windowId);
    if (expectedRunId && mode?.runId !== expectedRunId) return { success: false, stale: true };
    if (enabled === undefined && mode?.enabled && mode.collapsed && mode.tabId === sourceTab?.id) {
      // The keyboard shortcut restores a fully hidden popup without restarting
      // its background job or resending questions.
      mode.collapsed = false;
      await quizSave(mode);
      await quizAttach(mode.tabId);
      return { success: true, state: quizView(mode) };
    }
    const next = enabled === undefined ? !mode?.enabled : enabled === true;
    if (!next) {
      if (!mode) return { success: true, state: { enabled: false } };
      mode.enabled = false;
      await quizSave(mode);
      if (mode.job && mode.chatTabId) await chrome.tabs.sendMessage(mode.chatTabId, { type: 'QUIZ_CHAT_CANCEL', jobId: mode.job.id, token: mode.job.token }, { frameId: 0 }).catch(() => {});
      await quizRestoreDiscard(mode);
      return { success: true, state: quizView(mode) };
    }
    const tab = sourceTab || await getActiveTab(windowId);
    if (!tab?.id || !quizHost(tab.url)) throw new Error('Mở đề trên elearning.vinmec.com rồi nhấn Shift + Option + Q.');
    const sameTab = mode?.tabId === tab.id;
    const reference = await quizReferenceGet();
    if (reference.enabled && !reference.url) throw new Error('Nguồn PDF chưa có cuộc chat hợp lệ. Kiểm tra Cài đặt → Tài liệu tham khảo.');
    const changedReference = (mode?.reference?.enabled ? mode.reference.revision : '') !== (reference.enabled ? reference.revision : '');
    if (mode && (!sameTab || changedReference)) {
      if (mode.job && mode.chatTabId) await chrome.tabs.sendMessage(mode.chatTabId, { type: 'QUIZ_CHAT_CANCEL', jobId: mode.job.id, token: mode.job.token }, { frameId: 0 }).catch(() => {});
      await quizRestoreDiscard(mode);
    }
    mode = sameTab && !changedReference ? mode : { windowId, tabId: tab.id, frames: {}, questions: [], answers: {}, attempted: {} };
    mode.reference = reference;
    if (reference.enabled) mode.conversationUrl = reference.url;
    mode.enabled = true;
    mode.runId = crypto.randomUUID();
    mode.collapsed = false;
    mode.error = '';
    mode.waiting = '';
    mode.sourceUrl = tab.url;
    if (mode.job) { mode.job.runId = mode.runId; mode.job.dispatched = false; }
    await quizSave(mode);
    try { await quizAttach(tab.id); }
    catch { mode.error = 'Chưa đọc được trang. Tải lại đề rồi bật lại chế độ.'; await quizSave(mode); }
    if (mode.chatTabId) await chrome.tabs.update(mode.chatTabId, { autoDiscardable: false }).catch(() => {});
    if (mode.job && !mode.error) await quizDispatch(mode, mode.job.mayHaveSent);
    return { success: true, state: quizView(mode) };
  });
}

async function quizEnsureChat(mode) {
  if (mode.chatTabId) {
    const tab = await chrome.tabs.get(mode.chatTabId).catch(() => null);
    if (tab && chatHost(tab.url)) {
      if (!quizConversationMatches(mode, tab.url)) throw new Error('Tab ChatGPT đã rời cuộc chat chứa PDF. Mở lại đúng cuộc chat tài liệu rồi bấm thử lại.');
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      if (mode.chatBridgeVersion !== quizChatBridgeVersion) {
        // Reload only our own tab once after a reader upgrade. An already open
        // ChatGPT tab otherwise keeps the previous content script indefinitely.
        mode.chatBridgeVersion = quizChatBridgeVersion;
        await quizSave(mode);
        await chrome.tabs.reload(tab.id);
        return { ...tab, status: 'loading' };
      }
      return tab;
    }
    if (tab) throw new Error('Tab xử lý đã đổi địa chỉ. Mở lại ChatGPT rồi bấm thử lại.');
  }
  const tab = await chrome.tabs.create({ windowId: mode.windowId, url: chatHost(mode.conversationUrl) ? mode.conversationUrl : 'https://chatgpt.com/', active: false });
  mode.chatTabId = tab.id;
  mode.chatBridgeVersion = quizChatBridgeVersion;
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  await quizSave(mode);
  return tab;
}

async function quizDispatch(mode, reading = false) {
  if (!mode.enabled || !mode.job) return;
  const job = mode.job;
  try {
    const tab = await quizEnsureChat(mode);
    if (tab.status === 'loading') return;
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: reading || job.mayHaveSent ? 'QUIZ_CHAT_READ' : 'QUIZ_CHAT_START',
      jobId: job.id, token: job.token, runId: mode.runId, prompt: job.prompt,
      questions: job.questions, createdAt: job.createdAt, referenceUrl: mode.reference?.enabled ? mode.reference.url : ''
    }, { frameId: 0 }).catch(() => null);
    if (result?.success) { job.dispatched = true; mode.waiting = ''; await quizSave(mode); }
    else if (result?.waiting) {
      mode.waiting = result.draft ? 'Đang chờ ô ChatGPT trống; giữ nguyên bản nháp của bạn.' : 'Đang chờ ChatGPT sẵn sàng; sẽ tự tiếp tục…';
      job.dispatched = false;
      await quizSave(mode);
    }
    else if (result?.referenceMismatch) {
      mode.error = 'ChatGPT chưa mở đúng cuộc chat chứa PDF. Mở ChatGPT để kiểm tra địa chỉ và tài liệu rồi bấm thử lại.';
      await quizSave(mode);
    }
    else if (result && !result.ready) {
      mode.error = 'ChatGPT chưa sẵn sàng. Mở tab ChatGPT nền để đăng nhập, sau đó bấm thử lại.';
      await quizSave(mode);
    }
  } catch (error) { mode.error = error.message; await quizSave(mode); }
}

async function quizPump(mode) {
  if (!mode.enabled || mode.error) return;
  if (mode.job) {
    if (!mode.job.dispatched) await quizDispatch(mode);
    return;
  }
  const missing = mode.questions.filter(question => !mode.answers[question.id] && !mode.attempted[question.id]);
  if (!missing.length) return;
  const id = crypto.randomUUID();
  const questions = sidebarQuiz.batch(missing, id, mode.reference);
  mode.job = { id, token: crypto.randomUUID(), runId: mode.runId, createdAt: Date.now(), questions, prompt: sidebarQuiz.prompt(id, questions, mode.reference), mayHaveSent: false, dispatched: false };
  await quizSave(mode);
  await quizDispatch(mode);
}

async function quizSnapshot(message, sender) {
  return quizSerial(sender.tab.windowId, async () => {
    const mode = await quizGet(sender.tab.windowId);
    if (!mode?.enabled || mode.tabId !== sender.tab.id || mode.runId !== message.runId) return { success: false, stale: true };
    if (!quizHost(sender.url) || !Array.isArray(message.questions)) return { success: false };
    const tab = await chrome.tabs.get(mode.tabId);
    if (!quizHost(tab.url) || (sender.frameId === 0 && message.url !== tab.url)) return { success: false, stale: true };
    if (mode.sourceUrl !== tab.url || (sender.frameId === 0 && mode.frames[0]?.documentId !== sender.documentId)) mode.frames = {};
    mode.sourceUrl = tab.url;
    const questions = [];
    for (const item of message.questions) {
      if (!Number.isSafeInteger(item.number) || item.number < 1 || typeof item.text !== 'string' || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 26 || item.options.some(text => typeof text !== 'string' || !text.trim())) continue;
      const question = { number: item.number, text: item.text, options: item.options, multiple: item.multiple === true, hasMedia: item.hasMedia === true };
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(question)));
      question.id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      questions.push(question);
    }
    const [document] = await chrome.scripting.executeScript({ target: { tabId: mode.tabId, frameIds: [sender.frameId] }, func: () => location.href });
    if (document?.documentId !== sender.documentId || document?.result !== message.url) return { success: false, stale: true };
    mode.frames[sender.frameId] = { documentId: sender.documentId, questions };
    const merged = new Map();
    for (const frame of Object.values(mode.frames)) for (const question of frame.questions) merged.set(question.id, question);
    mode.questions = [...merged.values()].sort((a, b) => a.number - b.number);
    const numbers = mode.questions.map(question => question.number);
    if (new Set(numbers).size !== numbers.length) mode.error = 'Có câu trùng số nhưng nội dung khác. Kiểm tra trang đề trước khi thử lại.';
    await quizSave(mode);
    await quizPump(mode);
    return { success: true };
  });
}

async function quizChatEvent(message, sender) {
  return quizSerial(sender.tab.windowId, async () => {
    const mode = await quizGet(sender.tab.windowId);
    const job = mode?.job;
    if (!mode?.enabled || !job || mode.chatTabId !== sender.tab.id || sender.frameId !== 0 || !chatHost(sender.url) || job.id !== message.jobId || job.token !== message.token || mode.runId !== message.runId) return { success: false, stale: true };
    if (!quizConversationMatches(mode, sender.url) || (mode.reference?.enabled && !quizConversationMatches(mode, message.conversationUrl))) {
      mode.error = 'Tab ChatGPT đã rời cuộc chat chứa PDF. Không nhận đáp án từ cuộc chat khác.';
      job.dispatched = false;
      await quizSave(mode);
      return { success: false, stale: true };
    }
    if (/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\//.test(message.conversationUrl || '')) mode.conversationUrl = message.conversationUrl;
    if (message.type === 'QUIZ_CHAT_WILL_SEND') {
      if (job.mayHaveSent) return { success: false, stale: true };
      job.mayHaveSent = true;
      for (const question of job.questions) mode.attempted[question.id] = true;
    } else if (message.type === 'QUIZ_CHAT_RESULT') {
      const answers = sidebarQuiz.parse(message.text, job.questions);
      if (!answers) return { success: false, error: 'Định dạng đáp án không hợp lệ.' };
      for (const answer of answers) mode.answers[answer.id] = answer.answer;
      mode.job = null;
      mode.error = '';
    } else if (message.type === 'QUIZ_CHAT_ERROR') {
      mode.error = typeof message.error === 'string' ? message.error.slice(0, 600) : 'Chưa đọc được đáp án. Bấm đọc lại hoặc thử lại.';
      if (message.definitelyUnsent === true) {
        for (const question of job.questions) delete mode.attempted[question.id];
        job.mayHaveSent = false;
      }
      job.dispatched = false;
      if (message.reading) job.readAttempted = true;
    }
    await quizSave(mode);
    if (!mode.job) {
      // Do not dispatch inside the RESULT acknowledgement: the content script
      // must release its previous job before accepting another one.
      setTimeout(() => quizWake(mode.windowId).catch(console.error), 0);
    }
    return { success: true };
  });
}

async function quizWake(windowId, tabId) {
  return quizSerial(windowId, async () => {
    const mode = await quizGet(windowId);
    if (!mode?.enabled || (tabId && mode.chatTabId !== tabId)) return;
    // A freshly ready bridge can recover an answer already sent, including
    // sessions paused by an older renderer. READ never submits another prompt.
    if (mode.error && (tabId || mode.job?.mayHaveSent)) mode.error = '';
    if (mode.error) return;
    if (mode.job) await quizDispatch(mode, mode.job.mayHaveSent);
    else await quizPump(mode);
  });
}

async function handleQuizMessage(message, sender) {
  const fromPage = sender.tab && quizHost(sender.url);
  const fromChat = sender.tab && chatHost(sender.url) && sender.frameId === 0;
  const fromPanel = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (message.type === 'QUIZ_CHAT_READY' && fromChat) { await quizWake(sender.tab.windowId, sender.tab.id); return { success: true }; }
  if (message.type.startsWith('QUIZ_CHAT_') && fromChat) return quizChatEvent(message, sender);
  if (!fromPage && !fromPanel) return { success: false };
  const windowId = fromPage ? sender.tab.windowId : message.windowId;
  if (!Number.isInteger(windowId)) return { success: false };
  if (message.type === 'QUIZ_GET_REFERENCE' && fromPanel) return { success: true, reference: await quizReferenceGet() };
  if (message.type === 'QUIZ_SET_REFERENCE' && fromPanel) return { success: true, reference: await quizReferenceSet(message.reference) };
  if (message.type === 'QUIZ_SET_MODE' && fromPanel) return quizToggle(windowId, message.enabled);
  if (message.type === 'QUIZ_SNAPSHOT' && fromPage) return quizSnapshot(message, sender);
  if (message.type === 'QUIZ_GET_STATE' || message.type === 'QUIZ_PAGE_READY') {
    const mode = await quizGet(windowId);
    const commands = await chrome.commands.getAll();
    return { success: true, state: mode && (!fromPage || mode.tabId === sender.tab.id) ? quizView(mode) : { enabled: false }, shortcut: commands.find(command => command.name === 'toggle-quiz-mode')?.shortcut || '' };
  }
  if (message.type === 'QUIZ_STOP' && fromPage) {
    const mode = await quizGet(windowId);
    if (mode?.tabId === sender.tab.id && mode.runId === message.runId) return quizToggle(windowId, false, undefined, message.runId);
    return { success: false, stale: true };
  }
  return quizSerial(windowId, async () => {
    const mode = await quizGet(windowId);
    if (!mode?.enabled || (fromPage && (mode.tabId !== sender.tab.id || mode.runId !== message.runId))) return { success: false, stale: true };
    if (message.type === 'QUIZ_COLLAPSE') { mode.collapsed = message.collapsed === true; await quizSave(mode); }
    if (message.type === 'QUIZ_OPEN_CHAT' && mode.chatTabId) await chrome.tabs.update(mode.chatTabId, { active: true });
    if (message.type === 'QUIZ_RETRY') {
      mode.error = '';
      if (mode.job?.mayHaveSent && !mode.job.readAttempted) {
        mode.job.readAttempted = true;
        mode.job.dispatched = false;
        await quizSave(mode);
        await quizDispatch(mode, true);
      } else {
        if (mode.job && mode.chatTabId) await chrome.tabs.sendMessage(mode.chatTabId, { type: 'QUIZ_CHAT_CANCEL', jobId: mode.job.id, token: mode.job.token }, { frameId: 0 }).catch(() => {});
        for (const question of mode.questions) if (!mode.answers[question.id]) delete mode.attempted[question.id];
        mode.job = null;
        await quizSave(mode);
        await quizPump(mode);
      }
    }
    return { success: true, state: quizView(mode) };
  });
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const sessions = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(sessions)) {
    if (!key.startsWith('quizSession:') || !value.enabled || (value.tabId !== tabId && value.chatTabId !== tabId)) continue;
    await quizSerial(value.windowId, async () => {
      const mode = await quizGet(value.windowId);
      if (mode.tabId === tabId) { mode.enabled = false; await quizRestoreDiscard(mode); }
      else { mode.chatTabId = null; mode.error = 'Tab ChatGPT nền đã đóng. Bấm thử lại để mở lại và đọc tiếp.'; if (mode.job) mode.job.dispatched = false; }
      await quizSave(mode);
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && chatHost(tab.url)) quizWake(tab.windowId, tabId).catch(console.error);
});

// Results and DOM changes wake the worker. The alarm only reconciles a lost
// connection/restarted worker and never blindly resubmits an attempted prompt.
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'quiz-reconcile') return;
  const sessions = await chrome.storage.session.get(null);
  for (const [key, mode] of Object.entries(sessions)) if (key.startsWith('quizSession:') && mode.enabled) await quizWake(mode.windowId).catch(console.error);
});
chrome.alarms.create('quiz-reconcile', { periodInMinutes: 1 });
