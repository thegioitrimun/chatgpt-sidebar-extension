const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const common = () => { const context = vm.createContext({ URL }); vm.runInContext(fs.readFileSync(path.join(root, 'quiz-common.js'), 'utf8'), context); return context.sidebarQuiz; };
const question = (number, extra = {}) => ({ id: `q${number}`, number, text: `Câu ${number}?`, options: ['Một', 'Hai', 'Ba', 'Bốn', 'Năm'], multiple: false, hasMedia: false, ...extra });
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
function harness(stored = {}, referenceStore = {}) {
  let source = { id: 7, windowId: 1, active: true, url: 'https://elearning.vinmec.com/de-thu', status: 'complete' };
  const tabs = new Map([[7, source]]), messages = [], created = [], writes = [], reloads = [];
  const windows = new Map([[1, { id: 1, state: 'normal', focused: true }]]), windowUpdates = [];
  const session = structuredClone(stored);
  const local = structuredClone(referenceStore);
  let nextTabId = 21;
  const chrome = {
    runtime: { getURL: value => `chrome-extension://test/${value}` },
    storage: { local: {
      async get(key) { return structuredClone({ [key]: local[key] }); },
      async set(value) { Object.assign(local, structuredClone(value)); }
    }, session: {
      async get(key) { return structuredClone(key === null ? session : { [key]: session[key] }); },
      async set(value) { Object.assign(session, structuredClone(value)); writes.push(structuredClone(value)); }
    } },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw new Error('Tab closed'); return structuredClone(tabs.get(id)); },
      async create(options) { created.push(options); const tab = { id: nextTabId++, windowId: 1, status: 'complete', ...options }; tabs.set(tab.id, tab); return tab; },
      async query(query) { return [...tabs.values()].filter(tab => !query?.windowId || tab.windowId === query.windowId).map(tab => structuredClone(tab)); },
      async update(id, options) { const tab = tabs.get(id); if (!tab) throw new Error('Tab closed'); Object.assign(tab, options); return structuredClone(tab); },
      async reload(id) { reloads.push(id); },
      async sendMessage(id, message) { messages.push({ id, ...structuredClone(message) }); return { success: true }; },
      onRemoved: event(), onUpdated: event()
    },
    windows: {
      async create(options) {
        created.push(structuredClone(options));
        const id = 30 + created.length;
        const tab = options.tabId ? tabs.get(options.tabId) : { id: 21, url: options.url, status: 'complete' };
        tab.windowId = id; tab.active = true; tabs.set(tab.id, tab);
        const window = { id, state: options.state, focused: options.state === 'minimized' ? false : options.focused ?? true };
        windows.set(id, window);
        return { ...window, tabs: [structuredClone(tab)] };
      },
      async get(id) {
        if (!windows.has(id)) throw new Error('Window closed');
        return { ...structuredClone(windows.get(id)), tabs: [...tabs.values()].filter(tab => tab.windowId === id).map(tab => structuredClone(tab)) };
      },
      async update(id, values) {
        if (!windows.has(id)) throw new Error('Window closed');
        windowUpdates.push({ id, ...structuredClone(values) }); Object.assign(windows.get(id), values);
        return structuredClone(windows.get(id));
      }
    },
    commands: { async getAll() { return [{ name: 'toggle-quiz-mode', shortcut: 'Alt+Shift+Q' }]; } },
    scripting: { async executeScript({ files }) { return files ? [] : [{ documentId: 'doc1', result: source.url }]; } },
    alarms: { onAlarm: event(), create() {} }
  };
  const context = vm.createContext({ chrome, crypto: webcrypto, TextEncoder, Uint8Array, URL, console, setTimeout: () => 0, getActiveTab: async () => source });
  for (const file of ['quiz-common.js', 'quiz-service.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  const page = () => ({ id: 'test', tab: source, url: source.url, frameId: 0, documentId: 'doc1' });
  const chat = () => ({ id: 'test', tab: tabs.get(mode()?.chatTabId || 21), url: 'https://chatgpt.com/c/fixture', frameId: 0, documentId: 'chat1' });
  const mode = () => session['quizSession:1'];
  const panel = { url: 'chrome-extension://test/sidepanel/sidepanel.html' };
  return { context, chrome, session, local, tabs, windows, windowUpdates, panel, messages, created, writes, reloads, mode, page, chat, source, async snapshot(items, sender = page()) { return context.handleQuizMessage({ type: 'QUIZ_SNAPSHOT', runId: mode().runId, url: source.url, questions: items }, sender); }, async chatEvent(type, extra = {}, sender = chat()) { const job = mode().job; return context.handleQuizMessage({ type, jobId: job.id, token: job.token, runId: mode().runId, conversationUrl: 'https://chatgpt.com/c/fixture', ...extra }, sender); } };
}

test('compact answers preserve source numbering, multi-select, unknown and validate all choices', () => {
  const api = common(), items = [question(1), question(7, { multiple: true }), question(19)];
  const answers = api.parse('1A, 7E-B-D, 19?', items);
  assert.equal(JSON.stringify(answers.map(item => item.answer)), JSON.stringify(['A', 'B-D-E', '?']));
  for (const value of ['1A, 7B-D-E', '1A, 7B-D-E, 19F', '1A, 7B-B, 19C', '1A, 7B, 19C, 20A', '1A, 1B, 19C', 'Giải thích: 1A, 7B, 19C', '1A-D, 7B, 19C', '<img src=x>']) assert.equal(api.parse(value, items), null, value);
  assert.equal(api.parse('1A', [question(1, { hasMedia: true })])[0].answer, '?');
});

test('long exams batch at five questions/16k target without cutting one question', () => {
  const api = common(), items = Array.from({ length: 71 }, (_, index) => question(index + 1));
  const batches = [];
  while (items.length) { const batch = api.batch(items, 'job'); batches.push(batch); items.splice(0, batch.length); }
  assert.equal(batches.length, 15); assert.equal(batches.flat().length, 71);
  assert.equal(api.batch([question(1, { text: 'x'.repeat(14000) }), question(2, { text: 'x'.repeat(3000) })], 'job').length, 1);
  const long = question(1, { text: 'x'.repeat(24000) });
  assert.equal(api.batch([long, question(2)], 'job')[0].text.length, 24000);
  assert(api.prompt('job', [long]).includes(long.text));
});

test('background uses one inactive tab in the source window and persists before dispatch', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1), question(7)]);
  assert.equal(h.created.length, 1); assert.equal(h.created[0].active, false); assert.equal(h.created[0].windowId, 1);
  assert.equal(h.windows.size, 1); assert.deepEqual(h.windowUpdates, []);
  assert.equal(h.mode().chatWindowId, h.mode().windowId);
  assert.equal(h.chat().tab.windowId, h.mode().chatWindowId);
  assert.equal(h.mode().job.questions.length, 2);
  assert(h.writes.some(write => write['quizSession:1'].job?.id === h.mode().job.id));
  await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  assert(h.mode().attempted[h.mode().job.questions[0].id]);
  assert.equal((await h.chatEvent('QUIZ_CHAT_WILL_SEND')).success, false);
});

test('worker restart reads a journaled prompt instead of resending it', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  const restarted = harness(h.session); await restarted.context.quizWake(1);
  assert(restarted.messages.some(message => message.type === 'QUIZ_CHAT_READ'));
  assert(!restarted.messages.some(message => message.type === 'QUIZ_CHAT_START'));
});

test('stale source documents, foreign tabs, tokens and invalid output cannot update answers', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source);
  assert.equal((await h.snapshot([question(1)], { ...h.page(), documentId: 'old-doc' })).stale, true);
  assert.equal(h.mode().questions.length, 0);
  await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  assert.equal((await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A', token: 'wrong' })).stale, true);
  assert.equal((await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A' }, { ...h.chat(), tab: { ...h.chat().tab, id: 99 } })).stale, true);
  assert.equal((await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1Z' })).success, false);
  assert.equal(Object.keys(h.mode().answers).length, 0);
  await h.context.quizToggle(1, false);
  assert.equal((await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A' })).stale, true);
});

test('same questions reuse answers while option order creates a new request', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND'); await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1B' });
  await h.snapshot([question(1)]); assert.equal(h.mode().job, null); assert.equal(h.context.quizView(h.mode()).answers, '1B');
  await h.snapshot([question(1, { options: ['Hai', 'Một', 'Ba', 'Bốn', 'Năm'] })]);
  assert(h.mode().job); assert.equal(h.context.quizView(h.mode()).answers, '');
});

test('explicit retry reads an uncertain send before enabling resend', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND'); await h.chatEvent('QUIZ_CHAT_ERROR', { error: 'Connection lost' });
  const id = h.mode().job.id;
  await h.context.handleQuizMessage({ type: 'QUIZ_RETRY', runId: h.mode().runId }, h.page());
  assert.equal(h.messages.at(-1).type, 'QUIZ_PAGE_STATE');
  assert(h.messages.some(message => message.type === 'QUIZ_CHAT_READ' && message.jobId === id));
  assert.equal(h.mode().job.id, id);
});

test('off/on resumes a pending answer immediately using READ', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  const id = h.mode().job.id;
  await h.context.quizToggle(1, false);
  const index = h.messages.length;
  await h.context.quizToggle(1, true, h.source);
  assert(h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_READ' && message.jobId === id));
  assert(!h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_START'));
});

test('reader upgrade refreshes its owned ChatGPT tab and automatically recovers a paused reply', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  await h.chatEvent('QUIZ_CHAT_ERROR', { error: 'Old renderer could not find the prompt', reading: true });
  h.mode().chatBridgeVersion = 1;
  const id = h.mode().job.id, index = h.messages.length;
  await h.context.quizWake(1, 21); await h.context.quizWake(1, 21);
  assert.deepEqual(h.reloads, [21]); assert.equal(h.mode().error, '');
  assert(h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_READ' && message.jobId === id));
  assert(!h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_START'));
});

test('reference addresses accept only private ChatGPT conversations', () => {
  const api = common();
  assert.equal(api.conversationUrl('https://chat.openai.com/c/source-123/?utm_source=test#x'), 'https://chatgpt.com/c/source-123');
  for (const url of ['https://chatgpt.com/', 'https://chatgpt.com.evil.test/c/source', 'https://chatgpt.com@evil.test/c/source', 'https://user:secret@chatgpt.com/c/source', 'http://chatgpt.com/c/source', 'https://chatgpt.com/share/source', 'javascript:alert(1)']) assert.equal(api.conversationUrl(url), '', url);
});

test('only extension settings can save references and invalid enabled sources are rejected', async () => {
  const h = harness();
  const message = { type: 'QUIZ_SET_REFERENCE', windowId: 1, reference: { enabled: true, url: 'https://chatgpt.com/c/fixture', name: ' Ôn thi ' } };
  assert.equal((await h.context.handleQuizMessage(message, h.page())).success, false);
  assert.equal(h.local.quizReference, undefined);
  await assert.rejects(h.context.handleQuizMessage({ ...message, reference: { enabled: true, url: 'https://other.test/c/source' } }, h.panel), /Dán địa chỉ/);
  const saved = await h.context.handleQuizMessage(message, h.panel);
  assert.equal(saved.reference.name, 'Ôn thi');
  assert(saved.reference.revision);
  assert.equal((await h.context.handleQuizMessage({ type: 'QUIZ_GET_REFERENCE', windowId: 1 }, h.panel)).reference.url, message.reference.url);
});

test('PDF mode routes every batch to its source conversation and keeps snapshot across worker restart', async () => {
  const reference = { enabled: true, url: 'https://chatgpt.com/c/fixture', name: 'Da liễu', revision: 'source-v1' };
  const h = harness({}, { quizReference: reference });
  await h.context.quizToggle(1, true, h.source); await h.snapshot(Array.from({ length: 9 }, (_, i) => question(i + 1)));
  assert.equal(h.created[0].url, reference.url); assert.equal(h.created[0].active, false);
  assert.equal(h.created[0].windowId, 1); assert.deepEqual(h.windowUpdates, []);
  assert.equal(h.mode().job.questions.length, 5); assert(h.mode().job.prompt.includes('NGUỒN TÀI LIỆU'));
  assert(h.mode().job.prompt.includes('không chép số câu hoặc chữ đáp án'));
  assert.equal(h.messages.find(m => m.type === 'QUIZ_CHAT_START').referenceUrl, reference.url);
  await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A, 2B, 3C, 4D, 5E' });
  await h.context.quizWake(1);
  assert.equal(h.mode().job.questions.length, 4); assert.equal(h.created.length, 1);
  assert(h.mode().job.prompt.includes('NGUỒN TÀI LIỆU'));
  await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  const restarted = harness(h.session, { quizReference: { ...reference, url: 'https://chatgpt.com/c/new-source', revision: 'source-v2' } });
  await restarted.context.quizWake(1);
  assert.equal(restarted.created[0].url, reference.url);
  assert(restarted.messages.some(m => m.type === 'QUIZ_CHAT_READ' && m.referenceUrl === reference.url));
  assert.equal(restarted.mode().reference.revision, 'source-v1');
});

test('changing or refreshing PDF sources clears previous answers only on next activation', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]);
  await h.chatEvent('QUIZ_CHAT_WILL_SEND'); await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1B' });
  const oldRun = h.mode().runId;
  await h.context.handleQuizMessage({ type: 'QUIZ_SET_REFERENCE', windowId: 1, reference: { enabled: true, url: 'https://chatgpt.com/c/fixture', name: 'PDF', refresh: true } }, h.panel);
  assert.equal(h.context.quizView(h.mode()).answers, '1B'); assert.equal(h.mode().runId, oldRun);
  await h.context.quizToggle(1, false); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]);
  assert.equal(h.context.quizView(h.mode()).answers, ''); assert(h.mode().job.prompt.includes('NGUỒN TÀI LIỆU'));
  const firstRevision = h.mode().reference.revision;
  await h.context.handleQuizMessage({ type: 'QUIZ_SET_REFERENCE', windowId: 1, reference: { ...h.mode().reference, refresh: true } }, h.panel);
  assert.equal(h.mode().reference.revision, firstRevision);
  await h.context.quizToggle(1, false); await h.context.quizToggle(1, true, h.source);
  assert.notEqual(h.mode().reference.revision, firstRevision); assert.equal(h.mode().job, undefined);
});

test('a different conversation cannot authorize a send or return a PDF answer', async () => {
  const h = harness({}, { quizReference: { enabled: true, url: 'https://chatgpt.com/c/fixture', revision: 'source' } });
  await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]);
  const sender = { ...h.chat(), url: 'https://chatgpt.com/c/wrong' };
  assert.equal((await h.chatEvent('QUIZ_CHAT_WILL_SEND', {}, sender)).stale, true);
  assert.equal(h.mode().job.mayHaveSent, false);
  assert.equal((await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A', conversationUrl: sender.url })).stale, true);
  assert.equal(Object.keys(h.mode().answers).length, 0);
  h.tabs.get(21).url = sender.url;
  const index = h.messages.length; await h.context.quizWake(1, 21);
  assert(!h.messages.slice(index).some(m => m.type === 'QUIZ_CHAT_START'));
  assert.match(h.mode().error, /cuộc chat chứa PDF/);
  const opened = await h.context.handleQuizMessage({ type: 'QUIZ_OPEN_CHAT', windowId: 1 }, h.panel);
  assert.equal(opened.success, true);
  assert.equal(h.windows.get(h.mode().chatWindowId).state, 'normal');
  assert.equal(h.tabs.get(21).url, sender.url);
  assert.equal(h.created.length, 1);
  assert(!h.messages.slice(index).some(m => m.type === 'QUIZ_CHAT_START'));
});

test('ready and navigation events recover a sent answer in a legacy window without reloading or focusing it', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  h.windows.set(31, { id: 31, state: 'minimized', focused: false });
  h.tabs.get(21).windowId = 31; h.mode().chatWindowId = 31; h.mode().chatBridgeVersion = 3;
  h.mode().job.dispatched = false;
  let index = h.messages.length;
  assert.equal((await h.context.handleQuizMessage({ type: 'QUIZ_CHAT_READY' }, h.chat())).success, true);
  assert(h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_READ'));
  h.mode().job.dispatched = false; index = h.messages.length;
  h.chrome.tabs.onUpdated.listeners[0](21, { status: 'complete' }, h.chat().tab);
  await new Promise(resolve => setImmediate(resolve));
  assert(h.messages.slice(index).some(message => message.type === 'QUIZ_CHAT_READ'));
  await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1B' });
  assert.equal(h.context.quizView(h.mode()).answers, '1B');
  assert.deepEqual(h.reloads, []); assert.deepEqual(h.windowUpdates, []);
  assert.equal(h.session['quizSession:31'], undefined);
});

test('new sends migrate away from a legacy window without moving, revealing or closing it', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]);
  h.windows.set(31, { id: 31, state: 'minimized', focused: false });
  h.tabs.get(21).windowId = 31; h.tabs.get(21).url = 'https://chatgpt.com/c/fixture'; h.mode().chatWindowId = 31;
  const jobId = h.mode().job.id;
  await h.context.quizWake(1);
  assert.equal(h.created.at(-1).active, false); assert.equal(h.created.at(-1).windowId, 1);
  assert.equal(h.created.at(-1).url, 'https://chatgpt.com/c/fixture');
  assert.equal(h.mode().chatTabId, 22); assert.equal(h.mode().job.id, jobId);
  assert.equal(h.tabs.get(21).windowId, 31); assert.equal(h.tabs.get(21).autoDiscardable, true);
  assert.equal(h.windows.get(31).state, 'minimized'); assert.deepEqual(h.windowUpdates, []);
  assert(h.messages.some(message => message.id === 21 && message.type === 'QUIZ_CHAT_CANCEL'));
  assert(h.messages.some(message => message.id === 22 && message.type === 'QUIZ_CHAT_START'));
});

test('only explicit Open ChatGPT activates a tab; retries preserve the source fullscreen state', async () => {
  const h = harness(); h.windows.get(1).state = 'fullscreen';
  await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]);
  assert.deepEqual(h.windowUpdates, []); assert.equal(h.tabs.get(21).active, false);
  await h.context.handleQuizMessage({ type: 'QUIZ_OPEN_CHAT', runId: h.mode().runId }, h.page());
  assert.equal(h.tabs.get(21).active, true); assert.equal(h.windows.get(1).state, 'fullscreen');
  assert.deepEqual(h.windowUpdates, [{ id: 1, focused: true }]);
  await h.context.quizWake(1);
  await h.context.handleQuizMessage({ type: 'QUIZ_RETRY', runId: h.mode().runId }, h.page());
  assert.deepEqual(h.windowUpdates, [{ id: 1, focused: true }]);
  assert.equal(h.windows.get(1).state, 'fullscreen');
});

test('worker restart reads a journaled legacy window, and a closed tab recovers in the background', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1)]); await h.chatEvent('QUIZ_CHAT_WILL_SEND');
  h.windows.set(31, { id: 31, state: 'minimized', focused: false }); h.tabs.get(21).windowId = 31; h.mode().chatWindowId = 31;
  const id = h.mode().job.id; h.mode().chatTabId = null;
  const count = h.created.length;
  await h.context.quizWake(1);
  assert.equal(h.created.length, count); assert.equal(h.mode().chatTabId, 21);
  h.tabs.delete(21); h.windows.delete(31);
  await h.chrome.tabs.onRemoved.listeners[0](21);
  assert.match(h.mode().error, /Tab ChatGPT nền đã đóng/);
  await h.context.handleQuizMessage({ type: 'QUIZ_RETRY', runId: h.mode().runId }, h.page());
  assert.equal(h.mode().job.id, id); assert.equal(h.created.at(-1).active, false);
  assert(h.messages.some(message => message.type === 'QUIZ_CHAT_READ' && message.jobId === id));
  assert.deepEqual(h.windowUpdates, []);
});

test('automatic start, batches, retry, stop and restart never call a window mutation or activate a tab', async () => {
  const h = harness(); h.windows.get(1).state = 'fullscreen';
  h.chrome.windows.create = h.chrome.windows.update = async () => { throw Error('Automatic window mutation'); };
  const update = h.chrome.tabs.update;
  h.chrome.tabs.update = async (id, values) => { assert.equal(values.active, undefined); return update(id, values); };
  await h.context.quizToggle(1, true, h.source); await h.snapshot(Array.from({ length: 6 }, (_, i) => question(i + 1)));
  await h.chatEvent('QUIZ_CHAT_WILL_SEND'); await h.chatEvent('QUIZ_CHAT_RESULT', { text: '1A, 2B, 3C, 4D, 5E' });
  await h.context.quizWake(1);
  await h.chatEvent('QUIZ_CHAT_WILL_SEND'); await h.chatEvent('QUIZ_CHAT_ERROR', { error: 'Lost reply' });
  await h.context.handleQuizMessage({ type: 'QUIZ_RETRY', runId: h.mode().runId }, h.page());
  await h.chatEvent('QUIZ_CHAT_RESULT', { text: '6B' });
  await h.context.quizToggle(1, false); await h.context.quizToggle(1, true, h.source);
  assert.equal(h.created.length, 1); assert.equal(h.created[0].active, false);
  assert.equal(h.source.active, true); assert.equal(h.tabs.get(21).active, false);
  assert.equal(h.windows.get(1).state, 'fullscreen'); assert.equal(h.windows.get(1).focused, true);
  assert.equal(h.mode().error, ''); assert.equal(Object.keys(h.mode().answers).length, 6);
});
