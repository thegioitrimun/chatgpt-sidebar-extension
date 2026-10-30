const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function harness(snapshot) {
  const stores = snapshot?.stores || Object.fromEntries(['collections', 'revisions', 'files', 'messages'].map(name => [name, new Map()]));
  const local = snapshot?.local || {}, session = snapshot?.session || {}, messages = [], timers = [];
  const tabs = snapshot?.tabs || new Map([[7, { id: 7, windowId: 1, active: true, url: 'https://elearning.vinmec.com/de-thu', status: 'complete' }]]);
  const windows = snapshot?.windows || new Map([[1, { id: 1, state: 'fullscreen', focused: true }]]), windowUpdates = [];
  let next = 30;
  const area = values => ({ async get(keys) { return structuredClone(keys === null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))); }, async set(value) { Object.assign(values, structuredClone(value)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; } });
  const chrome = {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}` }, storage: { local: area(local), session: area(session) },
    tabs: { onUpdated: event(), onRemoved: event(), async get(id) { if (!tabs.has(id)) throw Error('Closed'); return structuredClone(tabs.get(id)); }, async query(query) { return [...tabs.values()].filter(tab => !query.windowId || tab.windowId === query.windowId); }, async update(id, values) { Object.assign(tabs.get(id), values); return structuredClone(tabs.get(id)); }, async reload() {}, async sendMessage(id, message) { messages.push({ tabId: id, ...structuredClone(message) }); return { success: true }; } },
    windows: { async create(options) { const id = ++next, tab = options.tabId ? tabs.get(options.tabId) : { id: id + 100, url: options.url, status: 'complete' }; Object.assign(tab, { windowId: id, active: true }); tabs.set(tab.id, tab); windows.set(id, { id, state: options.state, focused: options.focused }); return { ...windows.get(id), tabs: [structuredClone(tab)] }; }, async get(id) { return { ...windows.get(id), tabs: [...tabs.values()].filter(tab => tab.windowId === id) }; }, async update(id, values) { windowUpdates.push({ id, ...values }); Object.assign(windows.get(id), values); return windows.get(id); } },
    scripting: { async executeScript({ files }) { return files ? [] : [{ documentId: 'doc1', result: tabs.get(7).url }]; } }, commands: { async getAll() { return []; } }, alarms: { onAlarm: event(), create() {} }
  };
  const store = { MAX_SIZE: 50 * 1024 * 1024, MAX_FILES: 20, CHUNK_SIZE: 256 * 1024, types: { txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, async get(name, id) { return structuredClone(stores[name].get(id)); }, async all(name) { return structuredClone([...stores[name].values()]); }, async put(name, item) { stores[name].set(item.id, structuredClone(item)); }, async remove(name, id) { stores[name].delete(id); }, async saveRevision(collection, revision) { await this.put('collections', collection); await this.put('revisions', revision); } };
  const context = vm.createContext({ chrome, sidebarDocuments: store, crypto: webcrypto, URL, TextEncoder, Uint8Array, btoa, console, setTimeout: (fn, delay) => { if (delay >= 700 && delay <= 800) return setTimeout(fn, 0); timers.push(fn); return timers.length; }, getActiveTab: async () => tabs.get(7) });
  for (const file of ['quiz-common.js', 'background-chat.js', 'quiz-service.js', 'document-service.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  const panel = { id: 'test', url: 'chrome-extension://test/sidepanel/sidepanel.html' };
  const call = (type, extra = {}, sender = panel) => context.handleDocumentMessage({ type, windowId: 1, ...extra }, sender);
  const runtime = revisionId => session[`docRuntime:${revisionId}`];
  async function flush() { for (let count = 0; timers.length && count < 60; count++) await timers.shift()(); assert(timers.length < 60); }
  async function create(name = 'Nguồn mẫu', legacy = false) {
    await context.docInit(); const id = await context.docCreate(name), collection = await store.get('collections', id), revision = await store.get('revisions', collection.revisionId);
    if (legacy) { Object.assign(revision, { legacy: true, ready: true, conversationUrl: 'https://chatgpt.com/c/source' }); await store.put('revisions', revision); }
    await call('DOC_SELECT', { collectionId: id }); return { id, revisionId: revision.id };
  }
  async function file(text = 'Nội dung nguồn', name = 'sample.txt') { const id = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(text))).toString('hex'), blob = new Blob([text]); await store.put('files', { id, blob, stagedAt: Date.now() }); return { id, name, size: blob.size, mime: 'text/plain' }; }
  async function chat(type, revisionId, extra = {}, senderOverride) {
    const r = runtime(revisionId), job = r.current;
    const tab = tabs.get(r.chatTabId);
    return call(type, { revisionId, runId: r.runId, jobId: job.id, token: job.token, conversationUrl: tab.url, ...extra }, senderOverride || { id: 'test', tab, url: tab.url, frameId: 0 });
  }
  return { stores, local, session, tabs, windows, windowUpdates, messages, context, call, store, create, file, runtime, chat, flush, snapshot: () => ({ stores, local, session, tabs, windows }) };
}

test('migration preserves the linked reference without inventing local files and runs only once', async () => {
  const h = harness(); h.local.quizReference = { enabled: true, name: 'Tài liệu cũ', url: 'https://chatgpt.com/c/old' };
  const first = await h.call('DOC_GET'); assert.equal(first.collections.length, 1); assert.equal(first.revision.legacy, true); assert.equal(first.revision.files.length, 0); assert.equal(first.revision.conversationUrl, h.local.quizReference.url);
  await h.context.docInit(); assert.equal((await h.call('DOC_GET')).collections.length, 1);
  await h.call('DOC_SELECT', { collectionId: null }); assert.equal((await h.context.docReferenceGet()).enabled, false);
});

test('catalog actions reject foreign pages and invalid uploads before touching a collection', async () => {
  const h = harness(), source = await h.create();
  assert.equal((await h.call('DOC_DELETE', { collectionId: source.id }, { tab: h.tabs.get(7), url: h.tabs.get(7).url })).success, false);
  await assert.rejects(h.call('DOC_FILES', { collectionId: source.id, files: [{ id: 'missing', name: 'x.txt', size: 5 }] }), /không hợp lệ/);
  assert.equal((await h.call('DOC_GET')).collections.length, 1);
});

test('files deduplicate by bytes and each changed manifest gets an isolated revision', async () => {
  const h = harness(), source = await h.create(), file = await h.file();
  const first = await h.call('DOC_FILES', { collectionId: source.id, files: [file, file] });
  assert.notEqual(first.revisionId, source.revisionId); assert.equal((await h.store.get('revisions', first.revisionId)).files.length, 1);
  const duplicate = await h.call('DOC_FILES', { collectionId: source.id, files: [file] }); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.revisionId, first.revisionId);
  const removed = await h.call('DOC_FILES', { collectionId: source.id, removeId: file.id });
  assert.notEqual(removed.revisionId, first.revisionId); assert.equal((await h.store.get('revisions', removed.revisionId)).files.length, 0); assert.equal((await h.store.get('revisions', removed.revisionId)).conversationUrl, undefined);
});

test('upload data is chunked, authorized to its current tab and cannot read arbitrary files', async () => {
  const h = harness(), source = await h.create(), file = await h.file('x'.repeat(300000));
  const added = await h.call('DOC_FILES', { collectionId: source.id, files: [file] }); await h.flush();
  const r = h.runtime(added.revisionId), first = await h.chat('DOC_FILE_CHUNK', r.revisionId, { offset: 0 }), last = await h.chat('DOC_FILE_CHUNK', r.revisionId, { offset: 262144 });
  assert.equal(first.size, 262144); assert.equal(last.size, 37856); assert.equal(Buffer.from(first.data, 'base64').toString(), 'x'.repeat(262144));
  assert.equal((await h.chat('DOC_FILE_CHUNK', r.revisionId, { offset: 1 })).success, false);
  assert.equal((await h.chat('DOC_FILE_CHUNK', r.revisionId, { offset: 0 }, { id: 'test', tab: { id: 999 }, url: 'https://chatgpt.com/', frameId: 0 })).success, false);
  assert.equal(h.windows.get(r.chatWindowId).state, 'minimized'); assert(!h.windowUpdates.some(update => update.id === 1 || update.focused !== undefined));
});

test('a collection stays unready until every attachment receives its own exact acknowledgement', async () => {
  const h = harness(), source = await h.create(), files = [await h.file('A', 'a.txt'), await h.file('B', 'b.txt')];
  const { revisionId } = await h.call('DOC_FILES', { collectionId: source.id, files }); await h.flush();
  await h.chat('DOC_CHAT_WILL_SEND', revisionId); const firstId = h.runtime(revisionId).current.id;
  await h.chat('DOC_CHAT_RESULT', revisionId, { text: `DOC_READY:${firstId}` }); await h.flush();
  assert.equal((await h.store.get('revisions', revisionId)).ready, false);
  await h.chat('DOC_CHAT_WILL_SEND', revisionId); const secondId = h.runtime(revisionId).current.id;
  assert.notEqual(firstId, secondId); await h.chat('DOC_CHAT_RESULT', revisionId, { text: `DOC_READY:${secondId}` }); await h.flush();
  assert.equal((await h.store.get('revisions', revisionId)).ready, true); assert.equal(h.runtime(revisionId).current, null);
});

test('incorrect upload acknowledgements stop synchronization and leave the file in error', async () => {
  const h = harness(), source = await h.create(), file = await h.file(); const { revisionId } = await h.call('DOC_FILES', { collectionId: source.id, files: [file] }); await h.flush();
  await h.chat('DOC_CHAT_WILL_SEND', revisionId); await h.chat('DOC_CHAT_RESULT', revisionId, { text: 'Tôi không đọc được tệp' });
  const revision = await h.store.get('revisions', revisionId); assert.equal(revision.ready, false); assert.equal(revision.fileStates[file.id].state, 'error'); assert(h.runtime(revisionId).error);
});

test('direct chat is queued once and its history stays bound to its own collection', async () => {
  const h = harness(), source = await h.create('Bộ A', true), other = await h.create('Bộ B', true);
  const requestId = 'one-request'; await h.call('DOC_ASK', { collectionId: source.id, text: 'Giải thích tài liệu', requestId }); await h.call('DOC_ASK', { collectionId: source.id, text: 'Giải thích tài liệu', requestId }); await h.flush();
  const r = h.runtime(source.revisionId); assert.equal(r.current.id, requestId); assert.equal(r.queue.length, 0);
  await h.chat('DOC_CHAT_WILL_SEND', source.revisionId); await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: 'Theo tài liệu: nội dung.\nChatGPT bổ sung: nhận xét.' }); await h.flush();
  assert.equal((await h.call('DOC_GET', { collectionId: source.id })).messages.length, 2); assert.equal((await h.call('DOC_GET', { collectionId: other.id })).messages.length, 0);
});

test('restart recovers a sent turn with READ, and explicit resend is forbidden until a failed read', async () => {
  const h = harness(), source = await h.create('Nguồn', true); await h.call('DOC_ASK', { collectionId: source.id, text: 'Câu hỏi' }); await h.flush(); await h.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  const restarted = harness(h.snapshot()); await restarted.context.docPump(source.revisionId, true);
  assert(restarted.messages.some(message => message.type === 'DOC_CHAT_READ')); assert(!restarted.messages.some(message => message.type === 'DOC_CHAT_START'));
  await assert.rejects(restarted.call('DOC_RESEND', { revisionId: source.revisionId }), /Đọc lại/);
  await restarted.chat('DOC_CHAT_ERROR', source.revisionId, { error: 'Chưa thấy lượt', reading: true });
  await restarted.call('DOC_RESEND', { revisionId: source.revisionId }); await restarted.flush(); assert(restarted.messages.some(message => message.type === 'DOC_CHAT_START'));
});

test('deleting a collection cancels its queue and rejects late results', async () => {
  const h = harness(), source = await h.create('Nguồn', true); await h.call('DOC_ASK', { collectionId: source.id, text: 'Đang hỏi' }); await h.flush();
  const r = structuredClone(h.runtime(source.revisionId)), job = r.current, tab = structuredClone(h.tabs.get(r.chatTabId));
  await h.call('DOC_DELETE', { collectionId: source.id });
  const late = await h.call('DOC_CHAT_RESULT', { revisionId: source.revisionId, runId: r.runId, jobId: job.id, token: job.token, text: 'Kết quả cũ' }, { id: 'test', tab, url: tab.url, frameId: 0 });
  assert.equal(late.success, false); assert.equal((await h.call('DOC_GET')).collections.length, 0); assert.equal(h.stores.messages.size, 0);
});

test('quiz jobs use the document queue and keep their source snapshot after switching collections', async () => {
  const h = harness(), source = await h.create('Nguồn A', true);
  await h.context.quizToggle(1, true, h.tabs.get(7));
  const mode = h.session['quizSession:1'];
  await h.context.handleQuizMessage({ type: 'QUIZ_SNAPSHOT', runId: mode.runId, url: h.tabs.get(7).url, questions: [{ number: 3, text: 'Câu hỏi?', options: ['Một', 'Hai', 'Ba', 'Bốn'], multiple: false }] }, { id: 'test', tab: h.tabs.get(7), url: h.tabs.get(7).url, frameId: 0, documentId: 'doc1' });
  await h.flush(); await h.create('Nguồn B', true);
  assert.equal(h.session['quizSession:1'].reference.collectionId, source.id);
  await h.chat('DOC_CHAT_WILL_SEND', source.revisionId); await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: '3D?' }); await h.flush();
  assert.equal(h.context.quizView(h.session['quizSession:1']).answers, '3D?');
});

test('a fresh hotkey resumes an errored document queue by READ, then answers an unstructured page', async () => {
  const h = harness(), source = await h.create('Nguồn đang dùng', true);
  await h.call('DOC_ASK', { collectionId: source.id, text: 'Câu hỏi trước' }); await h.flush();
  await h.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  await h.chat('DOC_CHAT_ERROR', source.revisionId, { error: 'Cửa sổ ChatGPT đã đóng.', definitelyUnsent: false });
  const messageCount = h.messages.length;
  await h.context.quizToggle(1, true, h.tabs.get(7));
  await h.context.handleQuizMessage({ type: 'QUIZ_SNAPSHOT', runId: h.session['quizSession:1'].runId, url: h.tabs.get(7).url, questions: [], pageText: 'Câu 7: 2+2? Phương án theo thứ tự: 3 | 4 | 5.' }, { id: 'test', tab: h.tabs.get(7), url: h.tabs.get(7).url, frameId: 0, documentId: 'doc1' });
  await h.flush();
  assert.equal(h.runtime(source.revisionId).error, '');
  assert(h.messages.slice(messageCount).some(message => message.type === 'DOC_CHAT_READ'));
  assert(!h.messages.slice(messageCount).some(message => message.type === 'DOC_CHAT_START'));
  await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: 'Kết quả câu hỏi trước.' }); await h.flush();
  assert.equal(h.runtime(source.revisionId).current.kind, 'quiz');
  await h.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: '7B?' }); await h.flush();
  assert.equal(h.context.quizView(h.session['quizSession:1']).answers, '7B?');
});

test('no selected collection uses normal ChatGPT instead of looking up an undefined document revision', async () => {
  const h = harness(); await h.context.docInit(); h.local.documentActiveCollectionId = null;
  await h.context.quizToggle(1, true, h.tabs.get(7));
  let mode = h.session['quizSession:1'];
  assert.equal(mode.reference.enabled, false); assert.equal(mode.reference.provider, 'documents');
  await h.context.handleQuizMessage({ type: 'QUIZ_SNAPSHOT', runId: mode.runId, url: h.tabs.get(7).url, questions: [], pageText: 'Câu 7: 2+2? Phương án theo thứ tự: 3 | 4 | 5.' }, { id: 'test', tab: h.tabs.get(7), url: h.tabs.get(7).url, frameId: 0, documentId: 'doc1' });
  await h.flush(); mode = h.session['quizSession:1'];
  assert.equal(mode.error, ''); assert(Number.isInteger(mode.chatTabId));
  assert(!Object.keys(h.session).some(key => key.startsWith('docRuntime:')));
  await h.context.quizWake(1); assert(h.messages.some(message => message.type === 'QUIZ_CHAT_START'));
  const job = mode.job, sender = { id: 'test', tab: h.tabs.get(mode.chatTabId), url: h.tabs.get(mode.chatTabId).url, frameId: 0 };
  await h.context.handleQuizMessage({ type: 'QUIZ_CHAT_WILL_SEND', jobId: job.id, token: job.token, runId: mode.runId }, sender);
  await h.context.handleQuizMessage({ type: 'QUIZ_CHAT_RESULT', jobId: job.id, token: job.token, runId: mode.runId, text: '7B' }, sender);
  assert.equal(h.context.quizView(h.session['quizSession:1']).answers, '7B');
});

test('direct questions have priority between quiz batches, and stopping quiz rejects its late answer', async () => {
  const h = harness(), source = await h.create('Nguồn', true);
  await h.context.quizToggle(1, true, h.tabs.get(7));
  const mode = h.session['quizSession:1']; mode.job = { id: 'quiz-first', token: 'qtoken', questions: [{ id: 'q', number: 1, text: '?', options: ['A', 'B'] }], prompt: 'QUIZ_JOB:quiz-first', createdAt: 1 };
  await h.context.quizSave(mode); await h.context.docEnqueueQuiz(mode);
  await h.call('DOC_ASK', { collectionId: source.id, text: 'Ưu tiên hỏi trực tiếp', requestId: 'priority' }); await h.flush();
  assert.equal(h.runtime(source.revisionId).current.id, 'priority');
  await h.chat('DOC_CHAT_WILL_SEND', source.revisionId); await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: 'Theo tài liệu: có.' }); await h.flush();
  assert.equal(h.runtime(source.revisionId).current.id, 'quiz-first'); await h.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  await h.context.quizToggle(1, false); await h.flush(); assert.equal(h.runtime(source.revisionId).current, null); assert.equal(h.context.quizView(h.session['quizSession:1']).answers, '');
});

test('answer grammar accepts only trailing uncertainty and still validates option letters and multi-select', () => {
  const context = vm.createContext({ URL }); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'quiz-common.js'), 'utf8'), context);
  const questions = [{ id: 'a', number: 3, options: ['a', 'b', 'c', 'd'], multiple: false }, { id: 'b', number: 6, options: ['a', 'b', 'c', 'd'], multiple: true }, { id: 'c', number: 7, options: ['a', 'b'] }];
  assert.deepEqual(Array.from(context.sidebarQuiz.parse('3D?, 6D-B?, 7?', questions), item => item.answer), ['D?', 'B-D?', '?']);
  for (const text of ['3F?, 6B-D?, 7?', '3D??, 6B-D, 7?', '3D?, 6B?-D, 7?', '3A-B?, 6B, 7?', '3D?, 6B-B?, 7?']) assert.equal(context.sidebarQuiz.parse(text, questions), null);
});


test('SPA location is checked against the current browser tab and persisted for recovery', async () => {
  const h = harness(), source = await h.create(), file = await h.file();
  const { revisionId } = await h.call('DOC_FILES', { collectionId: source.id, files: [file] }); await h.flush();
  const runtime = h.runtime(revisionId), tab = h.tabs.get(runtime.chatTabId);
  tab.url = 'https://chatgpt.com/c/new-conversation';
  const sender = { id: 'test', tab, url: 'https://chatgpt.com/', frameId: 0 };
  assert.equal((await h.chat('DOC_CHAT_LOCATION', revisionId, {}, sender)).success, true);
  assert.equal((await h.store.get('revisions', revisionId)).conversationUrl, tab.url);
  assert.equal(h.runtime(revisionId).conversationUrl, tab.url);
  assert.equal((await h.chat('DOC_CHAT_RESULT', revisionId, { conversationUrl: 'https://chatgpt.com/c/foreign', text: 'DOC_READY:fake' }, sender)).stale, true);
});

test('retry repairs a message journaled before its runtime queue write without duplicating it', async () => {
  const h = harness(), source = await h.create('Recovery', true);
  const set = h.context.chrome.storage.session.set;
  h.context.chrome.storage.session.set = async () => { throw new Error('Queue write interrupted'); };
  const request = { collectionId: source.id, text: 'Câu hỏi cần phục hồi', requestId: 'interrupted-question' };
  await assert.rejects(h.call('DOC_ASK', request), /interrupted/);
  assert.equal(h.stores.messages.get(request.requestId).status, 'queued');
  assert.equal(h.runtime(source.revisionId), undefined);
  h.context.chrome.storage.session.set = set;
  await h.call('DOC_ASK', request); await h.call('DOC_ASK', request); await h.flush();
  assert.equal(h.runtime(source.revisionId).current.id, request.requestId);
  assert.equal(h.runtime(source.revisionId).queue.length, 0);
  assert.equal(h.messages.filter(message => message.type === 'DOC_CHAT_START').length, 1);
});

test('worker reconciliation restores current-session orphaned requests once, preserving their revision', async () => {
  const h = harness(), source = await h.create('Recovery', true);
  const set = h.context.chrome.storage.session.set;
  h.context.chrome.storage.session.set = async () => { throw new Error('Worker stopped'); };
  await assert.rejects(h.call('DOC_ASK', { collectionId: source.id, text: 'Phục hồi sau restart', requestId: 'restart-orphan', kind: 'analysis' }), /stopped/);
  h.context.chrome.storage.session.set = set;
  const restarted = harness(h.snapshot());
  await restarted.context.docReconcilePending(); await restarted.context.docReconcilePending(); await restarted.flush();
  const runtime = restarted.runtime(source.revisionId);
  assert.equal(runtime.current.id, 'restart-orphan'); assert.equal(runtime.current.kind, 'analysis');
  assert.equal(runtime.current.sent, false); assert.equal(runtime.queue.length, 0);
  assert.equal(runtime.windowId, 1); assert.equal(runtime.collectionId, source.id);
  await restarted.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  await restarted.context.docReconcilePending();
  assert.equal(restarted.runtime(source.revisionId).current.sent, true);
  assert.equal(restarted.runtime(source.revisionId).queue.length, 0);
});

test('a new browser session never automatically revives historical pending questions', async () => {
  const h = harness(), source = await h.create('Historical', true);
  await h.call('DOC_ASK', { collectionId: source.id, text: 'Câu hỏi của phiên trước', requestId: 'historical-question' });
  const snapshot = h.snapshot(); snapshot.session = {};
  const restarted = harness(snapshot);
  await restarted.call('DOC_GET'); await restarted.context.docReconcilePending(); await restarted.flush();
  assert.equal(restarted.runtime(source.revisionId), undefined);
  assert.equal(restarted.messages.filter(message => message.type === 'DOC_CHAT_START').length, 0);
  await assert.rejects(restarted.call('DOC_ASK', { collectionId: source.id, text: 'Câu hỏi của phiên trước', requestId: 'historical-question' }), /phiên trình duyệt trước/);
});

test('duplicate request IDs require the same collection, revision, kind and exact question', async () => {
  const h = harness(), source = await h.create('First', true), other = await h.create('Second', true);
  const request = { collectionId: source.id, text: 'Nội dung gốc', requestId: 'bound-request' };
  await h.call('DOC_ASK', request);
  for (const change of [{ collectionId: other.id }, { text: 'Nội dung khác' }, { kind: 'analysis' }]) await assert.rejects(h.call('DOC_ASK', { ...request, ...change }), /Mã yêu cầu đã được dùng/);
  const collection = await h.store.get('collections', source.id), previous = await h.store.get('revisions', source.revisionId);
  collection.revisionId = 'new-revision';
  await h.store.saveRevision(collection, { ...previous, id: collection.revisionId });
  await assert.rejects(h.call('DOC_ASK', request), /Mã yêu cầu đã được dùng/);
  assert.equal(h.runtime(source.revisionId).queue.length, 1);
  assert.equal(h.runtime(collection.revisionId), undefined);
});

test('completed duplicate requests stay complete and are never requeued by recovery', async () => {
  const h = harness(), source = await h.create('Complete', true), request = { collectionId: source.id, text: 'Một lần thôi', requestId: 'complete-request' };
  await h.call('DOC_ASK', request); await h.flush(); await h.chat('DOC_CHAT_WILL_SEND', source.revisionId);
  await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: 'Đã trả lời.' }); await h.flush();
  await h.call('DOC_ASK', request); await h.context.docReconcilePending(); await h.flush();
  assert.equal(h.runtime(source.revisionId).current, null); assert.equal(h.runtime(source.revisionId).queue.length, 0);
  assert.equal(h.messages.filter(message => message.type === 'DOC_CHAT_START').length, 1);
});

test('quiz requests reject an empty collection instead of waiting forever', async () => {
  const h = harness(), source = await h.create('Chưa có tệp');
  await assert.rejects(h.context.docEnqueueQuiz({ windowId: 1, runId: 'run', reference: { collectionId: source.id, revisionId: source.revisionId }, job: { id: 'empty', questions: [], prompt: 'QUIZ_JOB:empty' } }), /Thêm tài liệu.*đáp án tự động/);
  assert.equal(h.runtime(source.revisionId), undefined);
});

test('collection manifests reject over twenty files and stored blobs above fifty MiB', async () => {
  const h = harness(), source = await h.create(), files = [];
  for (let index = 0; index < 21; index++) files.push(await h.file(`Unique content ${index}`, `${index}.txt`));
  await assert.rejects(h.call('DOC_FILES', { collectionId: source.id, files }), /tối đa 20 tệp/);
  const id = 'f'.repeat(64), size = h.store.MAX_SIZE + 1;
  await h.store.put('files', { id, blob: new Blob([new Uint8Array(size)]), stagedAt: Date.now() });
  await assert.rejects(h.call('DOC_FILES', { collectionId: source.id, files: [{ id, name: 'too-large.pdf', size }] }), /vượt 50 MiB/);
  assert.equal((await h.store.get('collections', source.id)).revisionId, source.revisionId);
});

test('worker recovery starts file preparation committed before the first runtime write', async () => {
  const h = harness(), source = await h.create(), file = await h.file();
  const set = h.context.chrome.storage.session.set;
  h.context.chrome.storage.session.set = async () => { throw new Error('Runtime write interrupted'); };
  await assert.rejects(h.call('DOC_FILES', { collectionId: source.id, files: [file] }), /interrupted/);
  h.context.chrome.storage.session.set = set;
  const collection = await h.store.get('collections', source.id);
  assert.notEqual(collection.revisionId, source.revisionId); assert.equal(h.runtime(collection.revisionId), undefined);
  const restarted = harness(h.snapshot());
  await restarted.context.docReconcilePending(); await restarted.context.docReconcilePending(); await restarted.flush();
  const runtime = restarted.runtime(collection.revisionId);
  assert.equal(runtime.current.kind, 'upload'); assert.equal(runtime.current.file.id, file.id); assert.equal(runtime.windowId, 1);
  assert.equal(restarted.messages.filter(message => message.type === 'DOC_CHAT_START').length, 1);
});

test('worker recovery pumps a preparation runtime saved before its scheduling timer', async () => {
  const h = harness(), source = await h.create(), file = await h.file();
  const { revisionId } = await h.call('DOC_FILES', { collectionId: source.id, files: [file] });
  assert.equal(h.runtime(revisionId).current, null);
  const restarted = harness(h.snapshot());
  await restarted.context.docReconcilePending(); await restarted.flush();
  assert.equal(restarted.runtime(revisionId).current.kind, 'upload');
  assert.equal(restarted.messages.filter(message => message.type === 'DOC_CHAT_START').length, 1);
});

test('historical file preparation and superseded orphan revisions never upload automatically', async () => {
  const h = harness(), source = await h.create(), file = await h.file();
  const first = await h.call('DOC_FILES', { collectionId: source.id, files: [file] });
  // The next manifest supersedes an initial preparation that never started.
  delete h.session[`docRuntime:${first.revisionId}`];
  const second = await h.call('DOC_FILES', { collectionId: source.id, files: [await h.file('Second file', 'second.txt')] });
  const restarted = harness(h.snapshot()); await restarted.context.docReconcilePending(); await restarted.flush();
  assert.equal(restarted.runtime(first.revisionId), undefined);
  assert.equal(restarted.runtime(second.revisionId).current.kind, 'upload');
  const snapshot = restarted.snapshot(); snapshot.session = {};
  const browserRestart = harness(snapshot); await browserRestart.call('DOC_GET'); await browserRestart.flush();
  assert.equal(browserRestart.runtime(second.revisionId), undefined);
  assert.equal(browserRestart.messages.filter(message => message.type === 'DOC_CHAT_START').length, 0);
});

test('explicit quiz resend resets both journals and authorizes exactly one new send after a failed read', async () => {
  const h = harness(), source = await h.create('Quiz retry', true);
  await h.context.quizToggle(1, true, h.tabs.get(7));
  const mode = h.session['quizSession:1'];
  mode.job = { id: 'quiz-resend', questions: [{ id: 'resend-q', number: 1, text: 'Câu hỏi', options: ['A', 'B'] }], prompt: 'QUIZ_JOB:quiz-resend', createdAt: 1 };
  await h.context.quizSave(mode); await h.context.docEnqueueQuiz(mode); await h.flush();
  assert.equal((await h.chat('DOC_CHAT_WILL_SEND', source.revisionId)).success, true);
  assert.equal(h.session['quizSession:1'].job.mayHaveSent, true);
  await h.chat('DOC_CHAT_ERROR', source.revisionId, { error: 'Chưa tìm thấy lượt đã gửi', reading: true });
  await h.call('DOC_RESEND', { revisionId: source.revisionId }); await h.flush();
  assert.equal(h.runtime(source.revisionId).current.sent, false);
  assert.equal(h.session['quizSession:1'].job.mayHaveSent, false);
  assert.equal(h.session['quizSession:1'].attempted['resend-q'], undefined);
  assert.equal((await h.chat('DOC_CHAT_WILL_SEND', source.revisionId)).success, true);
  assert.equal((await h.chat('DOC_CHAT_WILL_SEND', source.revisionId)).stale, true);
  assert.equal(h.runtime(source.revisionId).current.sent, true);
  assert.equal(h.session['quizSession:1'].attempted['resend-q'], true);
  await h.chat('DOC_CHAT_RESULT', source.revisionId, { text: '1B?' }); await h.flush();
  assert.equal(h.session['quizSession:1'].answers['resend-q'], 'B?');
  assert.equal(h.runtime(source.revisionId).current, null);
});
