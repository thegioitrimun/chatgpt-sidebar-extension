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

async function analysisFixture(options = {}) {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: '<main><fieldset><legend>Câu 1: 2+2?</legend><label><input type="radio" name="q">3</label><label><input type="radio" name="q">4</label></fieldset><span role="timer">00:59</span><div class="player"><video></video><span id="media-time">00:59 / 22:12</span></div><div class="que"><span class="state">Not yet answered</span></div><div hidden id="hidden-status"></div></main>' }));
  await page.goto('https://fixture.example/');
  await page.evaluate(options => {
    window.scans = 0; window.captures = 0; window.inflight = 0; window.maxInflight = 0; window.hold = options.hold === true;
    window.state = { enabled: true, engine: 'analysis', runId: 'short-run', pageUrl: location.href, answers: '', progress: 'Đang phân tích…' };
    window.chrome = { runtime: { id: 'test', onMessage: { addListener(fn) { window.receive = fn; }, removeListener() {} }, async sendMessage(message) {
      if (message.type === 'QUIZ_PAGE_READY') return { success: true, state };
      if (message.type === 'ANALYSIS_CAPTURE_BEGIN') {
        captures++; inflight++; maxInflight = Math.max(maxInflight, inflight);
        if (!hold) { inflight--; return { success: true, duplicate: true }; }
        receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, progress: 'Đang lưu bản chụp…' } }, {}, () => {});
        return { success: true, captureId: `capture-${captures}`, next: 0 };
      }
      if (message.type === 'ANALYSIS_CAPTURE_CHUNK') return { success: true, next: message.sequence + 1 };
      if (message.type === 'ANALYSIS_CAPTURE_COMMIT') { if (hold) await new Promise(resolve => { window.releaseCapture = resolve; }); inflight--; return { success: true }; }
    } } };
  }, options);
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content/quiz-extract.js'), 'utf8') });
  await page.evaluate(() => { const read = extractQuizQuestions; window.extractQuizQuestions = (...args) => { scans++; return read(...args); }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content/quiz-page.js'), 'utf8') });
  return { browser, page };
}

(chromium ? test : test.skip)('short-question page stays quiet during timer, grading and progress updates but captures a real edit', async () => {
  const { browser, page } = await analysisFixture();
  try {
    await page.waitForFunction(() => captures === 1);
    await page.waitForTimeout(1000);
    const before = await page.evaluate(() => scans);
    await page.evaluate(async () => {
      for (let tick = 0; tick < 40; tick++) {
        document.querySelector('[role=timer]').textContent = `00:${tick}`;
        document.querySelector('#media-time').textContent = `00:${String(tick).padStart(2, '0')} / 22:12`;
        document.querySelector('.que .state').textContent = `Đã đánh dấu ${tick}`;
        document.querySelector('#hidden-status').textContent = `Hidden ${tick}`;
        receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, answers: '1B', progress: `Đang chờ ${tick}` } }, {}, () => {});
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => scans), before, 'irrelevant UI updates must not repeatedly scan the page');
    assert.equal(await page.evaluate(() => captures), 1);
    await page.locator('legend').evaluate(element => { element.textContent = 'Câu 1: 3+3?'; });
    await page.waitForFunction(() => captures === 2);
    assert((await page.locator('#chatgpt-quiz-overlay').evaluate(node => node.shadowRoot.querySelector('.answers').textContent)).includes('1B'));
  } finally { await browser.close(); }
});

(chromium ? test : test.skip)('slow captures never overlap and a question edit during transmission is captured afterward', async () => {
  const { browser, page } = await analysisFixture({ hold: true });
  try {
    await page.waitForFunction(() => typeof releaseCapture === 'function');
    await page.locator('legend').evaluate(element => { element.textContent = 'Câu 1: 3+3?'; });
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => maxInflight), 1, 'one page must never transmit simultaneous snapshots');
    await page.evaluate(() => { hold = false; releaseCapture(); });
    await page.waitForFunction(() => captures === 2);
    assert.equal(await page.evaluate(() => maxInflight), 1);
  } finally { await browser.close(); }
});

(chromium ? test : test.skip)('a paused analysis stops scanning until resume, then captures content changed while paused', async () => {
  const { browser, page } = await analysisFixture();
  try {
    await page.waitForFunction(() => captures === 1); const before = await page.evaluate(() => scans);
    await page.evaluate(() => {
      receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, paused: true, error: true, progress: 'Cửa sổ ChatGPT đã đóng.' } }, {}, () => {});
      document.querySelector('legend').textContent = 'Câu 1: 3+3?';
    });
    await page.waitForTimeout(900); assert.equal(await page.evaluate(() => scans), before); assert.equal(await page.evaluate(() => captures), 1);
    await page.evaluate(() => receive({ type: 'QUIZ_PAGE_STATE', state: { ...state, paused: false } }, {}, () => {}));
    await page.waitForFunction(() => captures === 2);
  } finally { await browser.close(); }
});

(chromium ? test : test.skip)('capture errors replace old progress while keeping answers already received', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage(); await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: '<main><p>Câu 7: Câu hỏi mới?</p></main>' })); await page.goto('https://fixture.example/');
    await page.evaluate(() => {
      const state = { enabled: true, engine: 'analysis', runId: 'capture-run', pageUrl: location.href, answers: '1B', progress: 'Đang chờ…' };
      window.chrome = { runtime: { id: 'test', onMessage: { addListener() {}, removeListener() {} }, async sendMessage(message) {
        if (message.type === 'QUIZ_PAGE_READY') return { success: true, state };
        return { success: false, error: 'Không đủ dung lượng. Phần đã nhận vẫn được giữ.' };
      } } };
    });
    for (const name of ['quiz-extract.js', 'quiz-page.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content', name), 'utf8') });
    // An initial error is visible, but unverified historical answers stay hidden.
    await page.waitForFunction(() => document.querySelector('#chatgpt-quiz-overlay')?.shadowRoot?.textContent.includes('Không đủ dung lượng'));
    assert(!(await page.locator('#chatgpt-quiz-overlay').innerText()).includes('1B'));
    // Verify the rendering path directly through a successful capture first.
    await page.evaluate(() => { chrome.runtime.sendMessage = async message => message.type === 'QUIZ_PAGE_READY' ? { success: true, state: { enabled: true, engine: 'analysis', runId: 'next-run', pageUrl: location.href, answers: '1B', progress: 'Đang chờ…' } } : { success: true, duplicate: true }; sidebarQuizPage.refresh(); });
    await page.waitForFunction(() => document.querySelector('#chatgpt-quiz-overlay')?.shadowRoot?.textContent.includes('1B'));
    await page.evaluate(() => { chrome.runtime.sendMessage = async () => ({ success: false, error: 'Không đủ dung lượng. Phần đã nhận vẫn được giữ.' }); document.querySelector('p').textContent += ' nội dung mới'; });
    await page.waitForFunction(() => document.querySelector('#chatgpt-quiz-overlay')?.shadowRoot?.querySelector('[role=alert]')?.textContent.includes('Không đủ dung lượng'));
    const text = await page.locator('#chatgpt-quiz-overlay').evaluate(node => node.shadowRoot.querySelector('.answers').textContent);
    assert(text.includes('1B')); assert(!text.includes('Đang chờ'));
  } finally { await browser.close(); }
});
