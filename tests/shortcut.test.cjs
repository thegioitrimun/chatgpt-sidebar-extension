const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('native command events without a tab still analyze the active page', async () => {
  let shortcut; const calls = [];
  const event = { addListener() {} };
  const source = { id: 7, windowId: 1, url: 'https://example.org/plain' };
  const context = vm.createContext({ importScripts() {}, console,
    quizToggle: async (...args) => calls.push(args),
    chrome: { runtime: { onInstalled: event, onStartup: event, onMessage: event }, contextMenus: { onClicked: event },
      commands: { onCommand: { addListener(fn) { shortcut = fn; } } }, tabs: { async query(options) { assert.equal(options.active, true); assert.equal(options.lastFocusedWindow, true); return [source]; } },
      action: { setBadgeText() {}, setTitle() {} } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  shortcut('toggle-quiz-mode'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 1); assert.equal(calls[0][1], undefined); assert.equal(calls[0][2].id, 7);
});
