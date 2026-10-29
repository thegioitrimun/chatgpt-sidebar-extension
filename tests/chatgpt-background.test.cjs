const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the real composer transport. Taking focus or changing Selection is
// forbidden here, including APIs that silently restored Brave's hidden window.
function composer({ textarea = false, draft = '' } = {}) {
  let api, submissions = [], events = [], focusCalls = [];
  class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.text = text; this.children = []; this.isConnected = true; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    get textContent() { return this.text + this.children.map(node => node.tag === 'br' ? '\n' : node.textContent).join(''); }
    get innerText() { return this.tag === 'editor' ? this.children.map(node => node.textContent).join('\n\n') : this.textContent; }
    getAttribute() { return null; }
    focus() { focusCalls.push('input.focus'); throw Error('Unexpected editor focus'); }
    dispatchEvent(event) { events.push(event); if (event.type === 'input') button.disabled = !(this.value || this.innerText).trim(); }
  }
  class TextArea extends Node {
    get value() { return this.text; }
    set value(value) { this.text = value; }
  }
  const input = textarea ? new TextArea('textarea', draft) : new Node('editor');
  if (!textarea && draft) input.append(new Node('p', draft));
  const button = { disabled: true, isConnected: true, getAttribute: () => null, click() {
    submissions.push(textarea ? input.value : input.innerText);
    if (textarea) input.value = ''; else input.replaceChildren();
  } };
  const document = {
    querySelector(selector) {
      if (selector.includes('stop-button')) return null;
      if (selector.includes('send-button')) return button;
      if (selector.includes('prompt-textarea')) return input;
      return null;
    },
    createElement: tag => new Node(tag), createTextNode: text => new Node('text', text),
    execCommand() { focusCalls.push('execCommand'); throw Error('Unexpected execCommand'); },
    createRange() { focusCalls.push('Selection'); throw Error('Unexpected Selection'); }
  };
  const window = { focus() { focusCalls.push('window.focus'); throw Error('Unexpected window focus'); },
    getSelection() { focusCalls.push('Selection'); throw Error('Unexpected Selection'); }, addEventListener() {} };
  window.parent = window;
  const context = vm.createContext({ window, document, HTMLTextAreaElement: TextArea, Event, InputEvent: Event, console, setTimeout,
    chrome: { runtime: { getURL: () => 'chrome-extension://test/', onMessage: { addListener() {} } } },
    initializeSidebarQuizChat(options) { api = options; return { isBusy: () => false }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/chatgpt-inject.js'), 'utf8'), context);
  return { api, input, submissions, events, focusCalls };
}

test('automatic contenteditable sends full multiline Unicode text without focusing or changing Selection', async () => {
  const h = composer(); let acknowledged = 0;
  const prompt = 'QUIZ_JOB:focus-check\n\nCâu hỏi 1: chọn nhiều đáp án?\nA. Một\nB. Hai\n\n[{"number":7}]';
  const state = { automatic: true, beforeSubmit: async () => { acknowledged++; return true; } };
  const result = await h.api.injectPageContext(prompt, true, state);
  assert.equal(result.sent, true); assert.equal(state.submitted, true); assert.equal(acknowledged, 1);
  assert.deepEqual(h.submissions, [prompt]); assert.deepEqual(h.focusCalls, []);
  assert(h.events.some(event => event.type === 'input' && event.inputType === 'insertText' && event.data === prompt));
});

test('automatic native textarea also preserves focus and sends once', async () => {
  const h = composer({ textarea: true });
  const result = await h.api.injectPageContext('Câu mẫu\n\n1 + 1?', true, { automatic: true });
  assert.equal(result.sent, true); assert.deepEqual(h.submissions, ['Câu mẫu\n\n1 + 1?']); assert.deepEqual(h.focusCalls, []);
});

test('background composer preserves another draft and never sends without worker authorization', async () => {
  const draft = composer({ draft: 'Bản nháp của người dùng' });
  assert.equal((await draft.api.injectPageContext('Prompt khác', true, { automatic: true })).success, false);
  assert.equal(draft.input.innerText, 'Bản nháp của người dùng'); assert.deepEqual(draft.submissions, []);
  const denied = composer();
  const result = await denied.api.injectPageContext('Chưa được cho phép gửi', true, { automatic: true, beforeSubmit: async () => false });
  assert.equal(result.cancelled, true); assert.deepEqual(denied.submissions, []); assert.deepEqual(denied.focusCalls, []);
});
