const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function harness(recover = false) {
  let now = 100000, minimized = false;
  const waits = [], journal = [], operations = [], tab = { id: 21, windowId: 2, url: 'about:blank', status: 'complete' };
  const mode = recover ? { windowId: 1, chatWindowId: 2, chatWindowReadyAt: now + 500, chatStartUrl: 'https://chatgpt.com/' } : { windowId: 1 };
  class Clock extends Date { static now() { return now; } }
  const chrome = {
    windows: {
      async create(options) { assert.equal(options.focused, false); assert.equal(options.url, 'about:blank'); operations.push('create'); return { id: 2, tabs: [{ ...tab }] }; },
      async get(id) { return { id, state: 'normal', tabs: [{ ...tab }] }; },
      async update(id, values) { assert.equal(id, 2); assert.equal(values.state, 'minimized'); assert(!Object.hasOwn(values, 'focused')); assert(journal.some(entry => entry.chatWindowId === id && entry.chatWindowReadyAt > 0)); assert(now >= journal[0].chatWindowReadyAt); minimized = true; operations.push('minimize'); }
    },
    tabs: { async get() { return { ...tab }; }, async update(id, values) { if (values.url) { assert(minimized); operations.push('navigate'); } Object.assign(tab, values); return { ...tab }; }, async reload() {} }
  };
  const context = vm.createContext({ chrome, Date: Clock, URL, setTimeout(fn, delay) { waits.push(delay); now += delay; fn(); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background-chat.js'), 'utf8'), context);
  return { mode, waits, journal, operations, run: () => context.sidebarBackgroundChat.ensure(mode, async value => journal.push(structuredClone(value)), { matches: () => true, version: 8 }) };
}
test('native window creation is journaled, settles for 800ms, then minimizes before ChatGPT navigation', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.waits, [800]); assert.deepEqual(h.operations, ['create', 'minimize', 'navigate']);
});
test('worker recovery waits the remaining native-window settle deadline before navigating', async () => {
  const h = harness(true); await h.run(); assert.deepEqual(h.waits, [500]); assert.deepEqual(h.operations, ['minimize', 'navigate']);
});
