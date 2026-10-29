const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch {}
const browserTest = chromium ? test : test.skip;
let browser;
before(async () => { if (chromium) browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) }); });
after(async () => { await browser?.close(); });
const script = fs.readFileSync(path.join(__dirname, '../content/document-chat.js'), 'utf8');
async function fixture({ filename = 'a.txt', existing, malformed = false, resetExistingInput = false, kind = 'upload', reading = false, history = false, lateAttachment = false, surface = false, serverName, readyDelay = 0, iconOnly = false } = {}) {
  const page = await browser.newPage();
  await page.setContent('<main><form><span>ChatGPT Add Search</span><button type="button" title="GPT-4.1">Model</button><button type="button" title="Attach files">Add</button><div id="prompt-textarea" contenteditable="true"></div><input id="image-file" type="file" accept="image/*"><input id="document-file" type="file" multiple><div id="files"></div></form></main>');
  await page.evaluate(({ filename, existing, malformed, resetExistingInput, kind, reading, history, lateAttachment, surface, serverName, readyDelay, iconOnly }) => {
    window.events = [];
    window.responses = [];
    window.listener = null;
    window.focus = () => { throw Error('Unexpected window focus'); };
    HTMLElement.prototype.focus = () => { throw Error('Unexpected element focus'); };
    window.sidebarQuiz = { conversationUrl: () => '', parse: () => [] };
    window.sidebarQuizChatDOM = { readReply: () => ({ found: true, text: 'Recovered answer' }) };
    window.chrome = { runtime: { id: 'test', onMessage: { addListener(fn) { window.listener = fn; } }, async sendMessage(message) {
      events.push(message);
      if (message.type === 'DOC_CHAT_WILL_SEND') window.sentAt = Date.now();
      return message.type === 'DOC_FILE_CHUNK' ? { success: true, data: btoa(malformed ? 'x' : 'Source'), size: malformed ? 1 : 6 } : { success: true };
    } } };
    const input = document.querySelector('#document-file'), cards = document.querySelector('#files');
    const card = name => {
      const span = document.createElement('span');
      if (!surface) { span.title = name; span.textContent = name; }
      else {
        span.className = 'composer-attachment-surface';
        const filename = document.createElement('span'); filename.className = 'truncate'; filename.textContent = name;
        const thumbnail = document.createElement('span'); thumbnail.dataset.attachmentThumbnailSource = 'workspace'; thumbnail.dataset.attachmentThumbnailState = readyDelay ? 'loading' : 'ready';
        thumbnail.append(document.createElement('img'));
        for (let index = 0; index < 2; index++) { const icon = document.createElement('span'); icon.className = 'composer-attachment-surface'; span.append(icon); }
        span.append(filename); if (!iconOnly) span.append(thumbnail);
        if (readyDelay && !iconOnly) setTimeout(() => { window.sentWhilePending = events.some(event => event.type === 'DOC_CHAT_WILL_SEND'); window.readyAt = Date.now(); thumbnail.dataset.attachmentThumbnailState = 'ready'; }, readyDelay);
      }
      cards.append(span);
    };
    if (existing) { const transfer = new DataTransfer(); transfer.items.add(new File(['Source'], existing)); input.files = transfer.files; card(existing); }
    if (resetExistingInput) input.value = '';
    if (history) { const old = document.createElement('span'); old.title = 'history.pdf'; old.textContent = 'history.pdf'; document.body.append(old); }
    input.addEventListener('change', () => { for (const file of input.files) card(serverName || file.name); if (surface) input.value = ''; });
    if (surface) { const composer = document.querySelector('#prompt-textarea'); composer.removeAttribute('id'); composer.className = 'ProseMirror'; }
    window.start = () => {
      initializeSidebarDocumentChat({ findInput: () => document.querySelector('[contenteditable="true"]'), inputText: element => element.textContent, normalizeText: text => text.trim(), isGenerating: () => false, hasOtherJob: () => false, injectPageContext: async (text, auto, state) => { if (lateAttachment) card('late-user-draft.pdf'); await state.beforeSubmit(); state.cancelled = true; return { success: true }; } });
      listener({ type: reading ? 'DOC_CHAT_READ' : 'DOC_CHAT_START', kind, file: { id: 'a'.repeat(64), name: filename, size: 6, mime: 'text/plain' }, jobId: 'upload', token: 'token', runId: 'run', revisionId: 'revision', prompt: 'DOC_JOB:upload' }, { id: 'test' }, response => responses.push(response));
    };
  }, { filename, existing, malformed, resetExistingInput, kind, reading, history, lateAttachment, surface, serverName, readyDelay, iconOnly });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => start());
  await page.waitForFunction(() => events.some(event => ['DOC_CHAT_WILL_SEND', 'DOC_CHAT_ERROR', 'DOC_CHAT_RESULT'].includes(event.type)) || responses.some(response => response.waiting));
  return page;
}
browserTest('short filenames cannot match ordinary composer controls or skip attachment upload', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => ({ events, file: document.querySelector('#document-file').files[0]?.name }));
    assert.equal(result.file, 'a.txt');
    assert.equal(await page.locator('#image-file').evaluate(element => element.files.length), 0);
    assert(result.events.some(event => event.type === 'DOC_FILE_CHUNK'));
    assert(result.events.some(event => event.type === 'DOC_CHAT_WILL_SEND'));
  } finally { await page.close(); }
});
browserTest('same stem with another extension preserves the other draft attachment and blocks send', async () => {
  const page = await fixture({ filename: 'foo.txt', existing: 'foo.docx' });
  try {
    const result = await page.evaluate(() => ({ events, file: document.querySelector('#document-file').files[0]?.name }));
    assert.equal(result.file, 'foo.docx');
    assert(result.events.some(event => event.type === 'DOC_CHAT_ERROR' && event.error.includes('đính kèm khác')));
    assert(!result.events.some(event => event.type === 'DOC_CHAT_WILL_SEND'));
  } finally { await page.close(); }
});
browserTest('an unknown draft with the exact filename is preserved instead of assumed to be our upload', async () => {
  const page = await fixture({ filename: 'a.txt', existing: 'a.txt' });
  try { const events = await page.evaluate(() => events); assert(!events.some(event => event.type === 'DOC_FILE_CHUNK')); assert(!events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); assert(events.some(event => event.type === 'DOC_CHAT_ERROR' && event.error.includes('chưa rõ nguồn'))); }
  finally { await page.close(); }
});
browserTest('incomplete chunk data never reaches the file input or send authorization', async () => {
  const page = await fixture({ malformed: true });
  try { const result = await page.evaluate(() => ({ events, count: document.querySelector('#document-file').files.length })); assert.equal(result.count, 0); assert(result.events.some(event => event.type === 'DOC_CHAT_ERROR')); assert(!result.events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); }
  finally { await page.close(); }
});
browserTest('a different user attachment remains protected after ChatGPT resets its native file input', async () => {
  const page = await fixture({ filename: 'source.txt', existing: 'private-user-draft.pdf', resetExistingInput: true });
  try {
    const result = await page.evaluate(() => ({ events, titles: [...document.querySelectorAll('#files [title]')].map(node => node.title), count: document.querySelector('#document-file').files.length }));
    assert.deepEqual(result.titles, ['private-user-draft.pdf']); assert.equal(result.count, 0);
    assert(result.events.some(event => event.type === 'DOC_CHAT_ERROR' && event.error.includes('đính kèm khác')));
    assert(!result.events.some(event => ['DOC_FILE_CHUNK', 'DOC_CHAT_WILL_SEND'].includes(event.type)));
  } finally { await page.close(); }
});
for (const kind of ['chat', 'analysis', 'quiz']) browserTest(`${kind} START preserves an attachment-only user draft`, async () => {
  const page = await fixture({ existing: 'private-user-draft.pdf', resetExistingInput: true, kind });
  try { const result = await page.evaluate(() => ({ events, responses })); assert(result.responses.some(response => response.waiting && response.draft)); assert(!result.events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); }
  finally { await page.close(); }
});
browserTest('READ can recover a reply without changing an attachment-only user draft', async () => {
  const page = await fixture({ existing: 'private-user-draft.pdf', resetExistingInput: true, kind: 'chat', reading: true });
  try { const events = await page.evaluate(() => events); assert(events.some(event => event.type === 'DOC_CHAT_RESULT')); assert(!events.some(event => ['DOC_FILE_CHUNK', 'DOC_CHAT_WILL_SEND'].includes(event.type))); assert.equal(await page.locator('#files [title]').getAttribute('title'), 'private-user-draft.pdf'); }
  finally { await page.close(); }
});
browserTest('file cards from conversation history do not block composer uploads', async () => {
  const page = await fixture({ history: true });
  try { const events = await page.evaluate(() => events); assert(events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); assert(!events.some(event => event.type === 'DOC_CHAT_ERROR')); }
  finally { await page.close(); }
});
browserTest('an attachment added while preparing the prompt blocks final send authorization', async () => {
  const page = await fixture({ lateAttachment: true });
  try { const events = await page.evaluate(() => events); assert(events.some(event => event.type === 'DOC_FILE_CHUNK')); assert(events.some(event => event.type === 'DOC_CHAT_ERROR' && event.error.includes('đính kèm khác'))); assert(!events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); }
  finally { await page.close(); }
});
for (const serverName of ['a(2).pdf', 'a (2).pdf']) browserTest(`an owned title-free ChatGPT surface accepts server filename ${serverName}`, async () => {
  const page = await fixture({ filename: 'a.pdf', surface: true, serverName });
  try {
    const events = await page.evaluate(() => events);
    assert(events.some(event => event.type === 'DOC_FILE_CHUNK')); assert(events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); assert(!events.some(event => event.type === 'DOC_CHAT_ERROR'));
    assert.equal(await page.locator('#files .truncate').textContent(), serverName);
    assert.equal(await page.locator('#files [title], #files [data-testid]').count(), 0);
  } finally { await page.close(); }
});
browserTest('a pending owned surface waits for the workspace thumbnail ready state before sending', async () => {
  const page = await fixture({ filename: 'a.pdf', surface: true, serverName: 'a(2).pdf', readyDelay: 500 });
  try { const result = await page.evaluate(() => ({ sentAt, readyAt, sentWhilePending, events })); assert.equal(result.sentWhilePending, false); assert(result.sentAt >= result.readyAt); assert(!result.events.some(event => event.type === 'DOC_CHAT_ERROR')); }
  finally { await page.close(); }
});
browserTest('an owned icon-only Office surface can reach native submit without thumbnail attributes', async () => {
  const page = await fixture({ filename: 'reference.docx', surface: true, iconOnly: true });
  try {
    const events = await page.evaluate(() => events);
    assert.equal(await page.locator('#files [data-attachment-thumbnail-state]').count(), 0);
    assert(events.some(event => event.type === 'DOC_FILE_CHUNK')); assert(events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); assert(!events.some(event => event.type === 'DOC_CHAT_ERROR'));
  } finally { await page.close(); }
});
browserTest('an unknown renamed surface remains a user draft and cannot be claimed by matching its base name', async () => {
  const page = await fixture({ filename: 'a.pdf', surface: true, existing: 'a(2).pdf', resetExistingInput: true });
  try { const events = await page.evaluate(() => events); assert(events.some(event => event.type === 'DOC_CHAT_ERROR')); assert(!events.some(event => ['DOC_FILE_CHUNK', 'DOC_CHAT_WILL_SEND'].includes(event.type))); assert.equal(await page.locator('#files .truncate').textContent(), 'a(2).pdf'); }
  finally { await page.close(); }
});
for (const serverName of ['ab(2).pdf', 'a(2).docx']) browserTest(`an unexpected owned surface filename ${serverName} cannot authorize upload`, async () => {
  const page = await fixture({ filename: 'a.pdf', surface: true, serverName });
  try { const events = await page.evaluate(() => events); assert(events.some(event => event.type === 'DOC_CHAT_ERROR')); assert(!events.some(event => event.type === 'DOC_CHAT_WILL_SEND')); }
  finally { await page.close(); }
});
browserTest('removing an attachment-only draft wakes the queued job without waiting for the reconcile alarm', async () => {
  const page = await fixture({ existing: 'private-user-draft.pdf', resetExistingInput: true, kind: 'chat' });
  try {
    // Let the initial readiness debounce observe the attachment-only draft.
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => events.filter(event => event.type === 'DOC_CHAT_READY').length), 0);
    await page.locator('#files').evaluate(element => element.replaceChildren());
    await page.waitForFunction(() => events.some(event => event.type === 'DOC_CHAT_READY'));
    const events = await page.evaluate(() => events);
    assert.equal(events.filter(event => event.type === 'DOC_CHAT_READY').length, 1);
    assert(!events.some(event => event.type === 'DOC_CHAT_WILL_SEND'));
  } finally { await page.close(); }
});
