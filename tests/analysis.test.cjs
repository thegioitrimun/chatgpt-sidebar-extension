const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, questions, pageText } = require('./support/analysis-harness.cjs');

test('short recognized questions go straight to the answer queue and retain every answer', async () => {
  const h = harness(), units = [{ number: 1, text: '2+2?', options: ['3', '4'] }, { number: 9, text: 'X?', options: ['Y', 'Z'] }];
  await h.start(); await h.capture({ questions: units, pageText: 'Câu 1: 2+2? A. 3 B. 4 Câu 9: X? A. Y B. Z' }); await h.flush(1000);
  assert.equal(h.task().stage, 'solve'); assert.equal(h.task().unitIds.length, 2); assert.equal([...h.stores.tasks.values()].filter(task => task.stage === 'normalize').length, 0);
  await h.answerAll(); const state = (await h.call('ANALYSIS_GET_STATE')).state;
  assert.equal(state.answers, '1B, 9B'); assert.equal(state.completedCount, 2); assert.equal(state.completed, true);
});

test('continuous page updates cannot postpone the initial answer queue indefinitely', async () => {
  const h = harness(), units = [{ number: 1, text: '2+2?', options: ['3', '4'] }]; await h.start();
  await h.capture({ questions: units, pageText: `00:59 ${pageText(units)}` });
  for (let tick = 58; tick >= 54; tick--) { await h.flush(300); await h.capture({ questions: units, pageText: `00:${tick} ${pageText(units)}` }); }
  assert(h.task(), 'a ticking page must still reach its first task'); assert.equal(h.task().stage, 'solve');
  assert.equal(h.stores.tasks.get(h.task().id).status, 'sending');
  await h.answerAll(); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '1B');
});

test('an unsent normalization survives page updates and its verified questions answer without restarting extraction', async () => {
  const h = harness(), raw = 'Câu 7: 2+2? A. Ba B. Bốn'; await h.start(); await h.capture({ pageText: `00:59 ${raw}` }); await h.flush(1000);
  const first = h.task(); assert.equal(first.stage, 'normalize');
  await h.capture({ pageText: `00:58 ${raw}` }); await h.flush(1000);
  assert.equal(h.task().id, first.id, 'new snapshots must not cancel a turn while ChatGPT is preparing it');
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ units: [{ number: 7, text: '2+2?', options: ['Ba', 'Bốn'], complete: true }] }) }); await h.flush();
  assert.equal(h.task().stage, 'solve', 'normalization must reach solving before a pending refresh rebuilds the queue');
  await h.answerAll(); await h.flush(1000);
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '7B');
  assert.equal([...h.stores.tasks.values()].filter(task => task.stage === 'normalize').length, 1);
  assert.equal(h.messages.filter(message => message.type === 'DOC_CHAT_START').length, 2);
});

test('the hotkey resumes an errored paused session instead of silently switching it off', async () => {
  const h = harness(), units = questions(1), payload = { questions: units, pageText: pageText(units) }; await h.start(); await h.capture(payload); await h.flush(1000);
  await h.chat('DOC_CHAT_ERROR', { error: 'Please log in', definitelyUnsent: true }); assert.equal(h.current().paused, true);
  const runId = h.current().runId; await h.context.analysisToggle(1, undefined, h.tabs.get(7));
  assert.equal(h.current().enabled, true); assert.equal(h.current().paused, false); assert.notEqual(h.current().runId, runId);
  await h.capture(payload); await h.flush(); await h.answerAll(); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '1B');
});

test('resuming unstructured questions still advances from normalization into solving', async () => {
 for (const alreadyNormalized of [false, true]) {
  const h = harness(), payload = { pageText: 'Câu 7: 2+2? A. Ba B. Bốn' }, reply = JSON.stringify({ units: [{ number: 7, text: '2+2?', options: ['Ba', 'Bốn'], complete: true }] });
  await h.start(); await h.capture(payload); await h.flush(1000); await h.chat('DOC_CHAT_WILL_SEND');
  if (alreadyNormalized) await h.chat('DOC_CHAT_RESULT', { text: reply });
  await h.call('ANALYSIS_STOP'); await h.context.analysisToggle(1, undefined, h.tabs.get(7)); await h.capture(payload); await h.flush();
  if (!alreadyNormalized) { await h.chat('DOC_CHAT_RESULT', { text: reply }); await h.flush(); }
  assert.equal(h.task()?.stage, 'solve', 'a recovered extraction must not be marked completed without solving');
  await h.answerAll(); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '7B');
 }
});

test('a pending page refresh preserves queued batches and their network retry backoff', async () => {
  const h = harness(), units = questions(10); await h.start(); await h.capture({ questions: units, pageText: `00:59 ${pageText(units)}` }); await h.flush(1000);
  const first = h.task(); await h.chat('DOC_CHAT_ERROR', { error: 'Network disconnected', definitelyUnsent: true });
  await h.capture({ questions: units, pageText: `00:58 ${pageText(units)}` }); await h.flush(1000);
  assert.notEqual(h.task().id, first.id); assert.equal(h.stores.tasks.get(first.id).attempts, 1); assert.equal(h.stores.tasks.get(first.id).status, 'queued');
  await h.answerAll(); await h.flush(1000); assert.equal(h.task().id, first.id); await h.answerAll(); await h.flush(1000);
  const state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.completedCount, 10); assert.equal(state.completed, true);
  assert.equal(h.messages.filter(message => message.type === 'DOC_CHAT_START').length, 3);
});

test('an earlier queued wake cannot swallow the timeout for a missing iframe during resume', async () => {
  const h = harness(), units = questions(1), payload = { questions: units, pageText: pageText(units) }; await h.start(); await h.capture(payload); await h.capture({ questions: questions(1, 30), pageText: pageText(questions(1, 30)) }, 5); await h.flush(1000);
  await h.call('ANALYSIS_STOP'); h.context.analysisLater(h.current().id, 100); await h.call('ANALYSIS_RESUME'); await h.capture(payload); await h.flush(100);
  assert.equal(h.current().resumeVerifying, true); await h.flush(30000);
  assert.equal(h.current().paused, true); assert.match(h.current().error, /iframe/);
});

for (const count of [10, 100, 500]) test(`durable capture keeps all ${count} questions on ${count * 2000}+ character pages`, async () => {
  const h = harness(), units = questions(count, 2000); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  assert.equal(h.current().activeUnitIds.length, count); assert.equal(h.task().stage, 'solve');
  assert.equal(h.stores.chunks.size, 0); assert.equal(h.stores.captures.values().next().value.payload.pageText, pageText(units));
  assert(JSON.stringify(h.session).length < 2000, 'Chrome storage must contain pointers only');
  for (let i = 0; i < Math.ceil(count / 5); i++) { assert(h.task().unitIds.length <= 5); const content = await h.context.analysisBuildTask(h.current().id, h.task().id); assert(content.prompt.length <= 14000); await h.answerAll(); }
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, count); assert.equal(h.current().phase, 'completed');
  assert(!h.mutations.some(value => value.kind === 'window' && (value.id === 1 || value.focused !== undefined)));
  assert(h.mutations.filter(value => value.kind === 'create').every(value => value.focused === false && value.url === 'about:blank'));
});

test('capture packets require order, integrity, sender and ACK, retaining partial progress across a worker restart', async () => {
  const h = harness(); await h.start(); const runId = h.current().runId, payload = JSON.stringify({ url: h.tabs.get(7).url, title: 'Synthetic questions', questions: [], pageText: 'Đây là nội dung. '.repeat(10000) }), bytes = Buffer.from(payload);
  const base = { runId, url: h.tabs.get(7).url, hash: await h.context.sidebarAnalysis.hash(payload), bytes: bytes.length };
  const begin = await h.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_BEGIN', ...base }, h.page(0));
  const packet = { type: 'ANALYSIS_CAPTURE_CHUNK', runId, captureId: begin.captureId, sequence: 0, data: bytes.subarray(0, 45000).toString('base64') };
  assert.equal((await h.context.analysisCapture(packet, h.page(0))).next, 1);
  assert.equal((await h.context.analysisCapture(packet, h.page(0))).next, 1);
  await assert.rejects(h.context.analysisCapture({ ...packet, sequence: 2 }, h.page(0)), /Thiếu gói/);
  await assert.rejects(h.context.analysisCapture({ ...packet, data: Buffer.from('wrong').toString('base64') }, h.page(0)), /nội dung khác/);
  assert.equal((await h.context.analysisCapture(packet, { ...h.page(0), tab: { id: 999, windowId: 1 } })).stale, true);
  await assert.rejects(h.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_COMMIT', runId, captureId: begin.captureId }, h.page(0)), /chưa nhận đủ/);
  const restarted = harness(h.snapshot()); await restarted.context.analysisInit();
  assert.equal((await restarted.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_BEGIN', ...base }, restarted.page(0))).next, 1);
  assert.equal((await restarted.capture(JSON.parse(payload))).success, true);
  assert.equal(restarted.stores.captures.get(begin.captureId).payload.pageText, JSON.parse(payload).pageText);
});

test('unknown layout is normalized first, and fabricated extraction gets exactly one repair', async () => {
  const h = harness(); await h.start(); await h.capture({ pageText: 'Câu 7: 2+2? A. Ba B. Bốn C. Năm' }); await h.flush(1000);
  assert.equal(h.task().stage, 'normalize');
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ units: [{ number: 7, text: 'invented', options: ['Ba', 'Bốn'], complete: true }] }) }); await h.flush();
  assert.equal(h.task().repaired, true); assert.equal(h.stores.units.size, 0);
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ units: [{ number: 7, text: '2+2?', options: ['Ba', 'Bốn', 'Năm'], complete: true }] }) }); await h.flush();
  assert.equal(h.task().stage, 'solve'); await h.answerAll();
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '7B');
});

test('a long individual question is attached intact before solving and chunk access is bound to its owner', async () => {
  const h = harness(), units = questions(2, 18000); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  assert.equal(h.task().stage, 'attach'); const attach = h.task(), file = h.stores.files.get(`${h.current().id}:${attach.file.id}`);
  assert((await file.blob.text()).includes(units[0].text));
  assert.equal((await h.chat('DOC_FILE_CHUNK', { offset: 0 })).size, file.blob.size);
  assert.equal((await h.chat('DOC_FILE_CHUNK', { offset: 1 })).success, false);
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: `DOC_READY:${attach.id}` }); await h.flush();
  assert.equal(h.task().stage, 'solve'); assert.equal(h.task().fileName, attach.file.name); await h.answerAll();
  const answers = (await h.call('ANALYSIS_GET_STATE')).state.answers; assert.equal(answers, '1B'); assert.equal(h.task().stage, 'attach');
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: 'cannot read file' }); await h.flush();
  const state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.answers, '1B'); assert.equal(state.failedCount, 1);
});

test('partial answers survive one format repair and the next batch still runs', async () => {
  const h = harness(), units = questions(10); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  const first = h.task(); await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ answers: [{ id: first.unitIds[0], choices: ['B'], basis: 'supplemental' }] }) }); await h.flush();
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '1B');
  // Existing queued complete batches can run before the repair.
  await h.answerAll(); assert.equal(h.task().stage, 'repair');
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: 'bad reply' }); await h.flush();
  const state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.completedCount, 6); assert.equal(state.failedCount, 1); assert(state.answers.includes('10B'));
});

test('definitely-unsent network failures retry after 2, 5 and 15 seconds then continue other batches', async () => {
  const h = harness(), units = questions(10); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  const failedId = h.task().id;
  await h.chat('DOC_CHAT_ERROR', { error: 'Network disconnected', definitelyUnsent: true });
  // The second batch is eligible while the first backs off.
  await h.context.analysisPump(h.current().id); await h.answerAll();
  for (const wait of [2000, 5000, 15000]) {
    await h.flush(wait); assert.equal(h.task().id, failedId);
    await h.chat('DOC_CHAT_ERROR', { error: 'Network disconnected', definitelyUnsent: true }); await h.flush();
  }
  assert.equal(h.stores.tasks.get(failedId).attempts, 3); assert.equal(h.stores.tasks.get(failedId).status, 'failed');
  const state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.completedCount, 5); assert.equal(state.failedCount, 1);
});

test('uncertain send is READ after worker restart, never blindly resent, and late/wrong-source results are rejected', async () => {
  const h = harness(), units = questions(5); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000); await h.chat('DOC_CHAT_WILL_SEND');
  const restarted = harness(h.snapshot()); await restarted.context.analysisPump(h.current().id, true);
  assert(restarted.messages.some(message => message.type === 'DOC_CHAT_READ')); assert(!restarted.messages.some(message => message.type === 'DOC_CHAT_START'));
  assert.equal((await restarted.chat('DOC_CHAT_RESULT', { token: 'wrong', text: '{}' })).stale, true);
  await restarted.chat('DOC_CHAT_ERROR', { error: 'Cannot find matching turn', reading: true }); assert.equal(restarted.current().paused, true);
  const previous = restarted.task(); await restarted.call('ANALYSIS_STOP');
  assert.equal((await restarted.context.analysisTransportEvent(restarted.current().id, previous.id, 'result', { text: '{}' })).stale, true);
  assert.equal(restarted.stores.results.size, 0);
});

test('browser restart requires manual resume and revalidates unchanged page before READ', async () => {
  const h = harness(), units = questions(5), payload = { questions: units, pageText: pageText(units) }; await h.start(); await h.capture(payload); await h.flush(1000); await h.chat('DOC_CHAT_WILL_SEND');
  const saved = h.snapshot(); saved.session = {}; const restarted = harness(saved); await restarted.context.analysisInit();
  const id = h.current().id; assert.equal(restarted.stores.sessions.get(id).enabled, false); assert.equal(restarted.messages.length, 0);
  await restarted.call('ANALYSIS_RESUME', { sessionId: id }); await restarted.context.analysisPump(id); assert(!restarted.messages.some(value => ['DOC_CHAT_START', 'DOC_CHAT_READ'].includes(value.type)));
  await restarted.capture(payload); await restarted.flush(); assert(restarted.messages.some(value => value.type === 'DOC_CHAT_READ'));
});

test('input limits shrink 5 to 2 to 1, then attach a single full question', async () => {
  const h = harness(), units = questions(5); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  await h.chat('DOC_CHAT_ERROR', { error: 'Input too long', definitelyUnsent: true }); await h.flush(); assert.equal(h.task().unitIds.length, 2);
  await h.chat('DOC_CHAT_ERROR', { error: 'Input too long', definitelyUnsent: true }); await h.flush();
  // Any existing queued work stays ordered; find the split single task without solving it twice.
  while (h.task().unitIds.length > 1) await h.answerAll();
  await h.chat('DOC_CHAT_ERROR', { error: 'Input too long', definitelyUnsent: true }); await h.flush();
  assert([...h.stores.tasks.values()].some(task => task.stage === 'attach'));
  assert.equal(h.current().batchSize, 1);
});

test('source is pinned for the session, direct chat takes priority between batches, and deletion stops late answers', async () => {
  const h = harness(), source = await h.source('A'), units = questions(10); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  await h.source('B'); assert.equal(h.current().sourceRef.revisionId, source.revisionId);
  await h.context.handleDocumentMessage({ type: 'DOC_ASK', collectionId: source.id, text: 'Direct question', requestId: 'priority' }, h.panel);
  await h.answerAll(); await h.flush(); assert.equal(h.session[`docRuntime:${source.revisionId}`].current.id, 'priority');
  const runtime = h.session[`docRuntime:${source.revisionId}`], tab = h.tabs.get(runtime.chatTabId), job = runtime.current;
  await h.context.handleDocumentMessage({ type: 'DOC_CHAT_WILL_SEND', revisionId: source.revisionId, runId: runtime.runId, jobId: job.id, token: job.token, conversationUrl: tab.url }, { id: 'test', tab, url: tab.url, frameId: 0 });
  await h.context.handleDocumentMessage({ type: 'DOC_CHAT_RESULT', revisionId: source.revisionId, runId: runtime.runId, jobId: job.id, token: job.token, conversationUrl: tab.url, text: 'Direct reply' }, { id: 'test', tab, url: tab.url, frameId: 0 }); await h.flush();
  assert.equal(h.task().stage, 'solve');
  await h.context.handleDocumentMessage({ type: 'DOC_DELETE', collectionId: source.id }, h.panel); await h.flush(); assert.equal(h.current().enabled, false);
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, 5);
});

test('stable identities reuse answers after timers/selection/reload and distinguish duplicate numbers', async () => {
  const h = harness(), units = questions(2); units[1].number = 1; await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000); await h.answerAll();
  const state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.answers, 'Khối 1 · 1B, Khối 2 · 1B');
  const requestCount = h.messages.filter(value => value.type === 'DOC_CHAT_START').length;
  await h.capture({ questions: units, pageText: `00:50 ${pageText(units)}` }); await h.flush(1000);
  await h.capture({ questions: units, pageText: `Thời gian còn lại: 00:49 ${pageText(units)}` }); await h.flush(1000);
  // Tiny timer prefix is not a new question or context.
  assert.equal(h.messages.filter(value => value.type === 'DOC_CHAT_START').length, requestCount);
});

test('local expiry removes only analysis records and leaves document library and ChatGPT intact', async () => {
  const h = harness(), units = questions(2); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000); await h.answerAll();
  const chatId = h.current().chatTabId; await h.flush(7 * 86400000 + 1);
  for (const listener of h.chrome.alarms.onAlarm.listeners) await listener({ name: 'analysis-reconcile' });
  assert.equal(h.stores.sessions.size, 0); assert.equal(h.stores.units.size, 0); assert.equal(h.stores.results.size, 0); assert(h.tabs.has(chatId));
});

test('answer validation rejects invalid, duplicate and single-select multi answers while preserving uncertainty', async () => {
  const h = harness(), units = [{ unitId: 'a', options: ['1', '2', '3', '4'], multiple: false }, { unitId: 'b', options: ['1', '2', '3', '4'], multiple: true }, { unitId: 'c', options: ['1', '2'] }];
  const parse = values => h.context.sidebarAnalysis.answers(JSON.stringify({ answers: values }), units, true);
  const rows = [{ id: 'a', choices: ['D'], basis: 'supplemental' }, { id: 'b', choices: ['D', 'B'], basis: 'supplemental' }, { id: 'c', choices: [], basis: 'unknown' }];
  assert.deepEqual(Array.from(parse(rows).valid, value => value.answer), ['D?', 'B-D?', '?']);
  for (const choices of [['F'], ['A', 'B'], ['A', 'A'], ['AB'], ['']]) assert.equal(parse([{ ...rows[0], choices }]).valid.length, 0);
  assert.equal(parse([rows[0], rows[0]]).valid.length, 0);
});

test('shared case context and boundary fragments are preserved, with long fragments recovered through TXT quotes', async () => {
  const h = harness(), text = `Câu 8: ${'Bệnh cảnh đầy đủ. '.repeat(1100)} Kết luận? A. Một B. Hai`;
  await h.start(); await h.capture({ pageText: text }); await h.flush(1000); const normalize = h.task();
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ units: [{ number: 8, text: 'Bệnh cảnh đầy đủ.', options: [], complete: false }] }) }); await h.flush();
  // Other overlapping segments are processed before the wider boundary file.
  while (h.task()?.stage === 'normalize' && !h.task().boundary) { await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: '{"units":[]}' }); await h.flush(); }
  assert.equal(h.task().stage, 'attach'); const attach = h.task();
  const file = await h.stores.files.get(`${h.current().id}:${attach.file.id}`).blob.text(); assert(file.includes('Kết luận? A. Một B. Hai'));
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: `DOC_READY:${attach.id}` }); await h.flush();
  assert.equal(h.task().boundary, true);
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ units: [{ number: 8, startQuote: file.slice(0, 65), endQuote: file.slice(-65), options: ['Một', 'Hai'], complete: true }] }) }); await h.flush();
  const full = [...h.stores.units.values()].find(unit => unit.complete && unit.text.includes('Kết luận?'));
  assert(full); assert(full.text.length > 17000);
  const plan = h.context.sidebarAnalysis.planCapture({ pageText: 'Bệnh nhân nam 45 tuổi bị sốt. Câu 1: Chọn gì? Một Hai Câu 3: Chọn gì nữa? Ba Bốn', questions: [{ number: 1, text: 'Chọn gì?', options: ['Một', 'Hai'] }, { number: 3, text: 'Chọn gì nữa?', options: ['Ba', 'Bốn'] }] });
  assert.equal(plan.units[0].context, 'Bệnh nhân nam 45 tuổi bị sốt.'); assert.equal(plan.units[1].context, plan.units[0].context);
});

test('a failed confirmed format reply retries under a new marker; completed answers are never requested again', async () => {
  const h = harness(), units = questions(5); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000);
  const old = h.task(); await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ answers: [{ id: old.unitIds[0], choices: ['B'], basis: 'supplemental' }] }) }); await h.flush();
  await h.chat('DOC_CHAT_WILL_SEND'); await h.chat('DOC_CHAT_RESULT', { text: 'invalid format' }); await h.flush(); const failed = [...h.stores.tasks.values()].find(task => task.status === 'failed');
  await h.call('ANALYSIS_RETRY_FAILED'); await h.flush(); assert.notEqual(h.task().id, failed.id); assert.equal(h.task().sent, false); assert.equal(h.task().unitIds.length, 4); assert(!h.task().unitIds.includes(old.unitIds[0])); await h.answerAll();
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, 5);
});

test('quota failure retains ACKed chunks and a corrupt checksum never reaches the queue', async () => {
  const h = harness(); await h.start(); const runId = h.current().runId, data = JSON.stringify({ url: h.tabs.get(7).url, questions: [], pageText: 'x'.repeat(100000) }), bytes = Buffer.from(data);
  const begin = await h.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_BEGIN', runId, url: h.tabs.get(7).url, bytes: bytes.length, hash: '0'.repeat(64) }, h.page(0));
  const send = sequence => h.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_CHUNK', runId, captureId: begin.captureId, sequence, data: bytes.subarray(sequence * 45000, (sequence + 1) * 45000).toString('base64') }, h.page(0));
  await send(0); const write = h.store.write; h.store.write = async () => { throw Error('QuotaExceededError'); }; await assert.rejects(send(1), /Quota/);
  assert.equal(h.stores.captures.get(begin.captureId).next, 1); assert.equal(h.stores.chunks.size, 1); h.store.write = write;
  await send(1); await send(2); await assert.rejects(h.context.analysisCapture({ type: 'ANALYSIS_CAPTURE_COMMIT', runId, captureId: begin.captureId }, h.page(0)), /toàn vẹn/); assert.equal(h.stores.tasks.size, 0);
});

test('loaded iframe questions keep their order; blocked frames and media-only pages have an explicit status', async () => {
  const h = harness(), first = questions(1), second = questions(1, 25); await h.start();
  await h.capture({ questions: first, pageText: pageText(first), iframes: [{ url: 'https://fixture.example/test', readable: true }, { url: 'https://blocked.example/', readable: false }] });
  await h.capture({ questions: second, pageText: pageText(second) }, 5); await h.flush(1000); assert.equal(h.current().activeUnitIds.length, 2); await h.answerAll();
  let state = (await h.call('ANALYSIS_GET_STATE')).state; assert.equal(state.completedCount, 2); assert(state.progress.includes('iframe')); assert(state.answers.includes('Khối 2'));
  await h.capture({ pageText: '', mediaCount: 1 }); await h.flush(1000); state = (await h.call('ANALYSIS_GET_STATE')).state; assert(state.progress.includes('canvas'));
});

test('navigation during a sent batch reads it once for cache but never displays its answer on a different page', async () => {
  const h = harness(), units = questions(5); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000); await h.chat('DOC_CHAT_WILL_SEND');
  h.tabs.get(7).url = 'https://fixture.example/next'; await h.capture({ questions: [], pageText: 'Trang tiếp theo không có câu hỏi.' });
  const task = h.task(); await h.chat('DOC_CHAT_RESULT', { text: JSON.stringify({ answers: task.unitIds.map(id => ({ id, choices: ['B'], basis: 'supplemental' })) }) }); await h.flush();
  assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, ''); await h.flush(1000); assert.equal(h.task().stage, 'normalize');
});

test('login/quota errors pause the shared conversation, preserving received answers and requiring action', async () => {
  const h = harness(), source = await h.source(), units = questions(10); await h.start(); await h.capture({ questions: units, pageText: pageText(units) }); await h.flush(1000); await h.answerAll();
  await h.chat('DOC_CHAT_ERROR', { error: 'Please log in', definitelyUnsent: true }); await h.flush();
  assert.equal(h.current().paused, true); assert(h.session[`docRuntime:${source.revisionId}`].error); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, 5);
});

test('a late event already awaiting the session lock cannot cross a resume token boundary', async () => {
  const h = harness(), units = questions(2), payload = { questions: units, pageText: pageText(units) }; await h.start(); await h.capture(payload); await h.flush(1000); const session = h.current(), task = h.task();
  await h.call('ANALYSIS_STOP'); await h.call('ANALYSIS_RESUME'); await h.capture(payload); await h.flush();
  const late = await h.context.analysisTransportEvent(session.id, task.id, 'result', { expectedRunId: session.runId, expectedToken: task.token, text: JSON.stringify({ answers: task.unitIds.map(id => ({ id, choices: ['B'], basis: 'supplemental' })) }) });
  assert.equal(late.stale, true); assert.equal(h.stores.results.size, 0); await h.answerAll(); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, 2);
});

test('QUIZ aliases use the durable runner and refuse legacy truncated snapshots', async () => {
  const h = harness(), units = questions(2); await h.start();
  const message = { type: 'QUIZ_SNAPSHOT', runId: h.current().runId, url: h.tabs.get(7).url, questions: units, pageText: pageText(units) };
  assert.equal((await h.context.handleQuizMessage(message, h.page(0))).success, true); await h.flush(1000); await h.answerAll();
  await h.context.quizWake(1); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.answers, '1B, 2B');
  assert.equal((await h.context.handleQuizMessage({ ...message, pageTooLong: true }, h.page(0))).success, false); assert.equal(h.current().paused, true); assert.equal((await h.call('ANALYSIS_GET_STATE')).state.completedCount, 2);
});
