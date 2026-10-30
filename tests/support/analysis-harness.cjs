const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const clone = value => structuredClone(value);
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function harness(saved = {}) {
  const stores = saved.stores || Object.fromEntries(['sessions', 'captures', 'chunks', 'units', 'tasks', 'results', 'files', 'events'].map(name => [name, new Map()]));
  const documents = saved.documents || Object.fromEntries(['collections', 'revisions', 'files', 'messages'].map(name => [name, new Map()]));
  const local = saved.local || {}, session = saved.session || {}, timers = new Map(), messages = [], mutations = [];
  const tabs = saved.tabs || new Map([[7, { id: 7, windowId: 1, url: 'https://fixture.example/test', title: 'Synthetic questions', status: 'complete', active: true }]]);
  const windows = saved.windows || new Map([[1, { id: 1, state: 'fullscreen', focused: true }]]);
  let now = saved.now || Date.now(), next = Math.max(40, ...windows.keys()), timerId = 0;
  const area = values => ({ async get(keys) { return clone(keys === null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))); }, async set(items) { Object.assign(values, clone(items)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; } });
  const chrome = {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}` }, storage: { local: area(local), session: area(session) },
    tabs: { onUpdated: event(), onRemoved: event(), async get(id) { if (!tabs.has(id)) throw Error('Closed tab'); return clone(tabs.get(id)); }, async query(query) { return clone([...tabs.values()].filter(tab => !query.windowId || tab.windowId === query.windowId)); }, async update(id, values) { mutations.push({ kind: 'tab', id, ...values }); Object.assign(tabs.get(id), values); return clone(tabs.get(id)); }, async reload() {}, async sendMessage(id, message) { messages.push({ tabId: id, ...clone(message) }); return { success: true }; } },
    windows: { async create(options) { const id = ++next, tab = options.tabId ? tabs.get(options.tabId) : { id: id + 100, url: options.url, status: 'complete' }; Object.assign(tab, { windowId: id, active: true }); tabs.set(tab.id, tab); windows.set(id, { id, state: options.state, focused: options.focused }); mutations.push({ kind: 'create', ...options }); return { ...windows.get(id), tabs: [clone(tab)] }; }, async get(id) { if (!windows.has(id)) throw Error('Closed window'); return { ...windows.get(id), tabs: clone([...tabs.values()].filter(tab => tab.windowId === id)) }; }, async update(id, values) { mutations.push({ kind: 'window', id, ...values }); Object.assign(windows.get(id), values); return windows.get(id); } },
    scripting: { async executeScript({ files, target }) { return files ? [] : [{ documentId: `doc${target.frameIds?.[0] || 0}`, result: tabs.get(7).url }]; } }, commands: { async getAll() { return []; } }, alarms: { onAlarm: event(), create() {} }
  };
  const store = { CHUNK_BYTES: 45000, RETENTION_MS: 7 * 86400000, async get(name, id) { return clone(stores[name].get(id)); }, async all(name, id) { return clone([...stores[name].values()].filter(item => !id || item.sessionId === id).sort((a, b) => a.id.localeCompare(b.id))); }, async put(name, item) { stores[name].set(item.id, clone(item)); }, async write(changes) { const prepared = clone(changes); for (const item of prepared) { if (item.remove !== undefined) stores[item.store].delete(item.remove); else stores[item.store].set(item.value.id, item.value); } }, async removeSession(id) { for (const [name, map] of Object.entries(stores)) for (const [key, value] of map) if (name === 'sessions' ? key === id : value.sessionId === id) map.delete(key); } };
  const docStore = { MAX_SIZE: 50 * 1024 * 1024, MAX_FILES: 20, CHUNK_SIZE: 262144, types: { txt: 'text/plain' }, async get(name, id) { return clone(documents[name].get(id)); }, async all(name) { return clone([...documents[name].values()]); }, async put(name, item) { documents[name].set(item.id, clone(item)); }, async remove(name, id) { documents[name].delete(id); }, async saveRevision(collection, revision) { await this.put('collections', collection); await this.put('revisions', revision); } };
  class TestDate extends Date { static now() { return now; } }
  const context = vm.createContext({ chrome, sidebarDocuments: docStore, sidebarAnalysisStore: store, crypto: webcrypto, URL, TextEncoder, TextDecoder, Uint8Array, Blob, btoa, atob, console, Date: TestDate, setTimeout(fn, delay = 0) { const id = ++timerId; if (delay === 800) { setImmediate(fn); return id; } timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); }, getActiveTab: async () => tabs.get(7) });
  for (const file of ['quiz-common.js', 'background-chat.js', 'quiz-service.js', 'document-service.js', 'analysis-common.js', 'analysis-service.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), context, { filename: file });
  const panel = { id: 'test', url: 'chrome-extension://test/sidepanel/sidepanel.html' };
  const call = (type, extra = {}) => context.handleAnalysisMessage({ type, windowId: 1, ...extra }, panel);
  const pointer = () => session['quizSession:1'];
  const current = () => clone(stores.sessions.get(pointer()?.sessionId));
  const task = () => clone(stores.tasks.get(current()?.currentTaskId));
  const page = frameId => ({ id: 'test', tab: clone(tabs.get(7)), url: tabs.get(7).url, frameId, documentId: `doc${frameId}` });
  async function flush(ms = 0) { now += ms; for (let loops = 0; loops < 200; loops++) { await new Promise(resolve => setImmediate(resolve)); await vm.runInContext('Promise.all([...analysisLocks.values(), ...docLocks.values()])', context); const due = [...timers.entries()].filter(([, value]) => value.at <= now); if (!due.length) return; for (const [id, value] of due) if (timers.delete(id)) await value.fn(); } throw Error('Timer loop'); }
  async function start() { return context.analysisToggle(1, true, tabs.get(7)); }
  async function capture(payload, frameId = 0) {
    payload = { url: tabs.get(7).url, title: 'Synthetic questions', questions: [], ...payload };
    const encoded = JSON.stringify(payload), bytes = Buffer.from(encoded), hash = await context.sidebarAnalysis.hash(encoded), runId = current().runId;
    const send = (type, extra) => context.handleAnalysisMessage({ type, runId, ...extra }, page(frameId));
    const begin = await send('ANALYSIS_CAPTURE_BEGIN', { url: payload.url, bytes: bytes.length, hash });
    if (!begin.success || begin.duplicate) return begin;
    for (let sequence = begin.next; sequence * 45000 < bytes.length; sequence++) {
      const result = await send('ANALYSIS_CAPTURE_CHUNK', { captureId: begin.captureId, sequence, data: bytes.subarray(sequence * 45000, (sequence + 1) * 45000).toString('base64') });
      if (!result.success) throw Error(JSON.stringify(result));
    }
    return send('ANALYSIS_CAPTURE_COMMIT', { captureId: begin.captureId });
  }
  async function chat(type, extra = {}, override) {
    const s = current(), t = task(), runtime = s.sourceRef && session[`docRuntime:${s.sourceRef.revisionId}`], tab = tabs.get(runtime?.chatTabId || s.chatTabId);
    const job = runtime?.current || t;
    return context.handleDocumentMessage({ type, revisionId: runtime?.revisionId || s.id, runId: runtime?.runId || s.runId, jobId: job.id, token: job.token, conversationUrl: tab.url, ...extra }, override || { id: 'test', tab: clone(tab), url: tab.url, frameId: 0 });
  }
  async function answerAll() { const t = task(); await chat('DOC_CHAT_WILL_SEND'); await chat('DOC_CHAT_RESULT', { text: JSON.stringify({ answers: t.unitIds.map(id => ({ id, choices: ['B'], basis: 'supplemental' })) }) }); await flush(); }
  async function source(name = 'Source') { await context.docInit(); const id = await context.docCreate(name), collection = await docStore.get('collections', id), revision = await docStore.get('revisions', collection.revisionId); Object.assign(revision, { ready: true, legacy: true, conversationUrl: `https://chatgpt.com/c/${id}` }); await docStore.put('revisions', revision); await context.handleDocumentMessage({ type: 'DOC_SELECT', collectionId: id }, panel); return { id, revisionId: revision.id }; }
  return { context, stores, documents, store, docStore, chrome, local, session, tabs, windows, mutations, messages, timers, panel, call, pointer, current, task, page, flush, start, capture, chat, answerAll, source, snapshot: () => ({ stores, documents, local, session, tabs, windows, now }) };
}
function questions(count, size = 20) { return Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `Question ${i + 1}: ${'x'.repeat(size)}?`, options: [`first-${i}`, `second-${i}`], multiple: false })); }
const pageText = units => units.map(unit => `${unit.text} ${unit.options.join(' ')}`).join(' ');
module.exports = { harness, questions, pageText };
