const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const common = () => { const context = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(root, 'quiz-common.js'), 'utf8'), context); return context.sidebarQuiz; };
const question = (number, extra = {}) => ({ id: `q${number}`, number, text: `Câu ${number}?`, options: ['Một', 'Hai', 'Ba', 'Bốn', 'Năm'], multiple: false, hasMedia: false, ...extra });
const event = () => ({ addListener() {} });
function harness(stored = {}) {
  let source = { id: 7, windowId: 1, url: 'https://elearning.vinmec.com/de-thu', status: 'complete' };
  const tabs = new Map([[7, source]]), messages = [], created = [], writes = [], reloads = [];
  const session = structuredClone(stored);
  const chrome = {
    runtime: { getURL: value => `chrome-extension://test/${value}` },
    storage: { session: {
      async get(key) { return structuredClone(key === null ? session : { [key]: session[key] }); },
      async set(value) { Object.assign(session, structuredClone(value)); writes.push(structuredClone(value)); }
    } },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw new Error('Tab closed'); return structuredClone(tabs.get(id)); },
      async create(options) { created.push(options); const tab = { id: 21, windowId: 1, status: 'complete', ...options }; tabs.set(tab.id, tab); return tab; },
      async update(id, options) { const tab = tabs.get(id); if (!tab) throw new Error('Tab closed'); Object.assign(tab, options); return structuredClone(tab); },
      async reload(id) { reloads.push(id); },
      async sendMessage(id, message) { messages.push({ id, ...structuredClone(message) }); return { success: true }; },
      onRemoved: event(), onUpdated: event()
    },
    commands: { async getAll() { return [{ name: 'toggle-quiz-mode', shortcut: 'Alt+Shift+Q' }]; } },
    scripting: { async executeScript({ files }) { return files ? [] : [{ documentId: 'doc1', result: source.url }]; } },
    alarms: { onAlarm: event(), create() {} }
  };
  const context = vm.createContext({ chrome, crypto: webcrypto, TextEncoder, Uint8Array, URL, console, setTimeout: () => 0, getActiveTab: async () => source });
  for (const file of ['quiz-common.js', 'quiz-service.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  const page = () => ({ id: 'test', tab: source, url: source.url, frameId: 0, documentId: 'doc1' });
  const chat = () => ({ id: 'test', tab: tabs.get(21), url: 'https://chatgpt.com/c/fixture', frameId: 0, documentId: 'chat1' });
  const mode = () => session['quizSession:1'];
  return { context, session, messages, created, writes, reloads, mode, page, chat, source, async snapshot(items, sender = page()) { return context.handleQuizMessage({ type: 'QUIZ_SNAPSHOT', runId: mode().runId, url: source.url, questions: items }, sender); }, async chatEvent(type, extra = {}, sender = chat()) { const job = mode().job; return context.handleQuizMessage({ type, jobId: job.id, token: job.token, runId: mode().runId, conversationUrl: 'https://chatgpt.com/c/fixture', ...extra }, sender); } };
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

test('background uses one inactive dedicated tab and persists before dispatch', async () => {
  const h = harness(); await h.context.quizToggle(1, true, h.source); await h.snapshot([question(1), question(7)]);
  assert.equal(h.created.length, 1); assert.equal(h.created[0].active, false);
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
