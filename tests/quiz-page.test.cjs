const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch {}
(chromium ? test : test.skip)('hotkey page bridge submits an unstructured page, shows progress/errors and replaces them with only the answer', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><p>Câu 7: 2 + 2 bằng bao nhiêu? Các phương án theo thứ tự: 3 | 4 | 5.</p></main>');
    await page.evaluate(() => {
      window.snapshots = [];
      window.state = { enabled: true, runId: 'raw-run', pageUrl: location.href, status: 'Đang phân tích trang…', answers: '' };
      window.chrome = { runtime: { id: 'test', onMessage: { addListener(fn) { window.receive = fn; }, removeListener() {} }, async sendMessage(message) {
        if (message.type === 'QUIZ_PAGE_READY') return { success: true, state };
        if (message.type === 'QUIZ_SNAPSHOT') { snapshots.push(message); return { success: true }; }
      } } };
    });
    for (const name of ['quiz-extract.js', 'quiz-page.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content', name), 'utf8') });
    await page.waitForFunction(() => document.querySelector('#chatgpt-quiz-overlay')?.shadowRoot?.textContent.includes('Đang phân tích'));
    const snapshot = await page.evaluate(() => snapshots[0]);
    assert.equal(snapshot.questions.length, 0); assert(snapshot.pageText.includes('3 | 4 | 5'));
    await page.evaluate(() => receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, error: true, status: 'Cần đăng nhập ChatGPT để tiếp tục.' } }, {}, () => {}));
    assert(await page.locator('#chatgpt-quiz-overlay').evaluate(node => node.shadowRoot.querySelector('[role="alert"]').textContent.includes('đăng nhập')));
    await page.evaluate(() => receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, answers: '7B' } }, {}, () => {}));
    assert.equal(await page.locator('#chatgpt-quiz-overlay').evaluate(node => node.shadowRoot.querySelector('.answers').textContent), '7B');
    await page.evaluate(() => receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, enabled: false } }, {}, () => {}));
    assert.equal(await page.locator('#chatgpt-quiz-overlay').count(), 0);
  } finally { await browser.close(); }
});
