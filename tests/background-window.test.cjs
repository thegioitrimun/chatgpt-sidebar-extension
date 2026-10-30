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

function fullscreenHarness(legacy = false) {
  let state = 'fullscreen', creates = 0;
  const journal = [], updates = [], mode = { windowId: 1 }, tab = { id: 21, windowId: 1, url: 'about:blank', status: 'complete', active: false };
  if (legacy) Object.assign(mode, { chatTabId: 21, chatStartUrl: 'https://chatgpt.com/' });
  const context = vm.createContext({ URL, Date, setTimeout, chrome: {
    windows: {
      async get(id) { return { id, state, tabs: [{ id: 7 }, { ...tab }] }; },
      async create() { throw Error('A fullscreen shortcut must never create a native window'); },
      async update() { throw Error('A fullscreen shortcut must never minimize or activate the source window'); }
    },
    tabs: {
      async create(options) { creates++; assert.equal(options.active, false); assert.equal(options.windowId, 1); assert.equal(options.url, 'about:blank'); return { ...tab }; },
      async get() { return { ...tab }; },
      async update(id, options) { assert(!Object.hasOwn(options, 'active')); if (options.url) assert(journal.some(row => row.chatTabId === id && row.chatBackgroundTab)); updates.push(options); Object.assign(tab, options); return { ...tab }; }
    }
  } });
  const run = () => context.sidebarBackgroundChat.ensure(mode, async value => journal.push(structuredClone(value)), { matches: () => true, version: 8 });
  const load = () => vm.runInContext(fs.readFileSync(path.join(__dirname, '../background-chat.js'), 'utf8'), context);
  load();
  return { mode, tab, journal, updates, run, load, leaveFullscreen() { state = 'normal'; }, get creates() { return creates; } };
}
test('fullscreen analysis journals an inactive tab and never creates, activates or minimizes a window', async () => {
  const h = fullscreenHarness(); await h.run(); assert.equal(h.creates, 1); assert.equal(h.tab.url, 'https://chatgpt.com/'); assert.equal(h.mode.chatWindowId, null); assert.equal(h.tab.active, false);
});
test('fullscreen fallback survives worker reload and leaving fullscreen without detaching or resending navigation', async () => {
  const h = fullscreenHarness(); await h.run(); h.leaveFullscreen(); h.load(); await h.run(); assert.equal(h.creates, 1); assert.equal(h.updates.filter(value => value.url).length, 1); assert.equal(h.mode.chatBackgroundTab, true);
});
test('a legacy tab already sharing the fullscreen source is retained without creating a native popup', async () => {
  const h = fullscreenHarness(true); await h.run(); assert.equal(h.creates, 0); assert.equal(h.mode.chatTabId, 21); assert.equal(h.mode.chatBackgroundTab, true); assert.equal(h.tab.active, false);
});
