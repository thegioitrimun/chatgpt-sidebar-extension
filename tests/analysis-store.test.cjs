const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch {}
(chromium ? test : test.skip)('real IndexedDB atomically journals sessions/results, retains full snapshots and purges only one session', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage(); await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Analysis store QA</title>' })); await page.goto('https://fixture.example/');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../analysis-store.js'), 'utf8') });
    const proof = await page.evaluate(async () => {
      const store = sidebarAnalysisStore;
      await store.write([{ store: 'sessions', value: { id: 'one', phase: 'waiting' } }, { store: 'results', value: { id: 'result-one', sessionId: 'one', answer: 'B' } }]);
      let failed = false; try { await store.write([{ store: 'sessions', value: { id: 'one', phase: 'must-rollback' } }, { store: 'results', value: { sessionId: 'one' } }]); } catch { failed = true; }
      await store.put('captures', { id: 'capture-one', sessionId: 'one', text: 'x'.repeat(1000000) + 'END' });
      const length = (await store.get('captures', 'capture-one')).text.length, phase = (await store.get('sessions', 'one')).phase;
      await store.put('sessions', { id: 'two' }); await store.put('results', { id: 'result-two', sessionId: 'two', answer: 'D' });
      await store.removeSession('one');
      return { failed, phase, length, sessions: await store.all('sessions'), results: await store.all('results'), captures: await store.all('captures'), noUndefinedKey: await store.get('sessions', undefined) === undefined };
    });
    assert.equal(proof.failed, true); assert.equal(proof.phase, 'waiting'); assert.equal(proof.length, 1000003); assert.equal(proof.sessions.length, 1); assert.equal(proof.sessions[0].id, 'two'); assert.equal(proof.results[0].answer, 'D'); assert.equal(proof.captures.length, 0); assert(proof.noUndefinedKey);
  } finally { await browser.close(); }
});
