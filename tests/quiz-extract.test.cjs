const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Install Playwright for browser DOM coverage, or point PLAYWRIGHT_MODULE at an
// existing installation. No user browser profile is opened by these tests.
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch {}
const browserTest = chromium ? test : test.skip;
let browser;
before(async () => {
  if (chromium) browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
});

browserTest('plain page fallback retains unstructured questions and excludes hidden, timer and draft content', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><p>Which marker is in the document? Options in order: TOPAZ | SAPPHIRE | RUBY.</p><p hidden>hidden secret</p><span style="opacity:0"><b>invisible secret</b></span><span role="timer">00:59</span><textarea>private draft</textarea><div id="chatgpt-quiz-overlay">old popup answer</div></main>');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content/quiz-extract.js'), 'utf8') });
    const snapshot = await page.evaluate(() => extractQuizQuestions());
    assert.equal(snapshot.questions.length, 0);
    assert(snapshot.pageText.includes('TOPAZ | SAPPHIRE | RUBY'));
    for (const hidden of ['hidden secret', 'invisible secret', '00:59', 'private draft', 'old popup answer']) assert(!snapshot.pageText.includes(hidden));
  } finally { await page.close(); }
});
after(async () => { await browser?.close(); });
const source = fs.readFileSync(path.join(__dirname, '../content/quiz-extract.js'), 'utf8');
async function extract(html) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><title>Question fixture</title>${html}`);
    await page.addScriptTag({ content: source });
    const before = await page.locator('body').innerHTML();
    await page.evaluate(() => {
      window.controlEvents = 0;
      for (const event of ['click', 'input', 'change', 'submit']) document.addEventListener(event, () => window.controlEvents++);
    });
    const result = await page.evaluate(() => extractQuizQuestions());
    assert.equal(await page.locator('body').innerHTML(), before, 'extractor must leave the document unchanged');
    assert.equal(await page.evaluate(() => window.controlEvents), 0, 'extractor must not activate exam controls');
    return result.questions;
  } finally { await page.close(); }
}

browserTest('keeps Vinmec numbering, choice order and multiple-answer instructions', async () => {
  const questions = await extract(`<section class="question-item"><div>Câu hỏi: 7<label><input type="checkbox">Đánh dấu</label></div><div class="question-title">Chọn kết quả của 2 + 2?</div><i>(Chọn 1 đáp án đúng)</i><div class="question-content"><label><input type="radio" name="q7" checked>4</label><label><input type="radio" name="q7">5</label></div></section><section class="question-item"><div>Câu hỏi: 13</div><div class="question-title">Chọn tất cả số chẵn?</div><i>(Chọn nhiều đáp án đúng)</i><div class="question-content"><label><input type="checkbox">1</label><label><input type="checkbox">2</label><label><input type="checkbox">4</label></div></section>`);
  assert.deepEqual(questions.map(q => [q.number, q.options, q.multiple]), [[7, ['4', '5'], false], [13, ['1', '2', '4'], true]]);
  assert.match(questions[0].text, /^Chọn kết quả/);
  assert.doesNotMatch(questions[0].text, /Đánh dấu/);
});

browserTest('reads Moodle content without grading, flag or answer-letter chrome', async () => {
  const [question] = await extract(`<div class="que multichoice"><div class="info"><h3>Question <span class="qno">21</span></h3><div class="state">Not yet answered</div><div class="grade">Marked out of 1.00</div></div><div class="content"><div class="formulation"><div class="qtext"><p>Which number is even?</p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="diagram"></div><div class="answer"><div><input id="m1" type="radio" name="m"><label for="m1"><span class="answernumber">a. </span>Four</label></div><div><input id="m2" type="radio" name="m"><label for="m2"><span class="answernumber">b. </span>Five</label></div></div></div></div></div>`);
  assert.equal(question.number, 21);
  assert.equal(question.text, 'Which number is even?');
  assert.deepEqual(question.options, ['Four', 'Five']);
  assert.equal(question.hasMedia, true);
});

browserTest('discovers independent native radio and checkbox groups without platform classes', async () => {
  const questions = await extract(`<main><div><h3>4. What is 2 + 2?</h3><label><input type="radio" name="one">4</label><label><input type="radio" name="one">5</label></div><div><h3>11. Which values are even? Select all that apply.</h3><label><input type="checkbox" name="two">2</label><label><input type="checkbox" name="two">3</label><label><input type="checkbox" name="two">4</label></div></main>`);
  assert.deepEqual(questions.map(q => [q.number, q.options, q.multiple]), [[4, ['4', '5'], false], [11, ['2', '3', '4'], true]]);
  assert.equal(questions[0].text, 'What is 2 + 2?');
});

browserTest('reads fieldset legends and externally labelled ARIA question groups', async () => {
  const questions = await extract(`<fieldset><legend>Which option is correct?</legend><label><input type="radio" name="f">Alpha</label><label><input type="radio" name="f">Beta</label></fieldset><h3 id="aria-stem">Question 9: Select all prime numbers?</h3><div role="group" aria-labelledby="aria-stem"><div role="checkbox" aria-checked="false">Two</div><div role="checkbox" aria-checked="true">Three</div><div role="checkbox" aria-checked="false">Four</div></div>`);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map(q => q.options), [['Alpha', 'Beta'], ['Two', 'Three', 'Four']]);
  assert.equal(questions[1].number, 9);
  assert.equal(questions[1].multiple, true);
  assert.match(questions[1].text, /Select all prime/);
});

browserTest('reads numbered text questions with multiline ordered letter choices', async () => {
  const questions = await extract(`<main><p>Câu 8. Chọn một số chẵn?</p><p>A. Một</p><p>B. Hai</p><p>Câu 15. Chọn nhiều đáp án đúng?</p><p>A) Hai<br>và bốn</p><p>B) Ba</p><p>C) Sáu</p></main>`);
  assert.deepEqual(questions, [{ number: 8, text: 'Chọn một số chẵn?', options: ['Một', 'Hai'], multiple: false, hasMedia: false }, { number: 15, text: 'Chọn nhiều đáp án đúng?', options: ['Hai và bốn', 'Ba', 'Sáu'], multiple: true, hasMedia: false }]);
});

browserTest('short stems retain their full choices in containers, native groups and text sheets', async () => {
  const questions = await extract(`<div class="question"><h3>Câu 1</h3><div class="qtext">2+2?</div><label><input type="radio" name="q1">3</label><label><input type="radio" name="q1">4</label></div><fieldset><legend>3?</legend><label><input type="radio" name="q2">A</label><label><input type="radio" name="q2">B</label></fieldset><pre>Câu 9: X?\nA. Y\nB. Z</pre>`);
  assert.deepEqual(questions.map(question => [question.number, question.text, question.options]), [[1, '2+2?', ['3', '4']], [2, '3?', ['A', 'B']], [9, 'X?', ['Y', 'Z']]]);
});

browserTest('player timestamps are excluded while timestamps used as question choices remain intact', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><div><video></video><span>14:29 / 22:12</span></div><fieldset><legend>Câu 1: Chọn mốc thời gian?</legend><label><input type="radio" name="q">10:00 / 11:00</label><label><input type="radio" name="q">12:00 / 13:00</label></fieldset></main>');
    await page.addScriptTag({ content: source }); const result = await page.evaluate(() => extractQuizQuestions({ unlimited: true }));
    assert(!result.pageText.includes('14:29 / 22:12')); assert(result.pageText.includes('10:00 / 11:00'));
    assert.deepEqual(result.questions[0].options, ['10:00 / 11:00', '12:00 / 13:00']);
  } finally { await page.close(); }
});

browserTest('combines structured questions and text sheets without duplicating control questions', async () => {
  const questions = await extract(`<div class="question"><h3>Question 3</h3><p>Which planet is nearest?</p><label><input type="radio" name="q">Mercury</label><label><input type="radio" name="q">Mars</label></div><pre>12. What is five plus one?\nA. Six\nB. Seven</pre>`);
  assert.deepEqual(questions.map(q => q.number), [3, 12]);
  assert.equal(questions[0].options.length, 2);
});

browserTest('ignores navigation, hidden questions and unrelated preference/consent forms', async () => {
  const questions = await extract(`<nav><div class="question"><p>Question 1: Where should we go?</p><label><input type="radio" name="nav">Home</label><label><input type="radio" name="nav">About</label></div></nav><section hidden><p>2. Hidden question?</p><p>A. Yes</p><p>B. No</p></section><fieldset><legend>Theme preference</legend><label><input type="radio" name="theme">Light</label><label><input type="radio" name="theme">Dark</label></fieldset><fieldset><legend>Notifications</legend><label><input type="checkbox">Email</label><label><input type="checkbox">SMS</label></fieldset><footer><p>3. Footer?</p><p>A. One</p><p>B. Two</p></footer>`);
  assert.deepEqual(questions, []);
});

browserTest('keeps long question text intact for later queue batching', async () => {
  const stem = `Which answer is correct? ${'Long case description. '.repeat(900)}`.trim();
  const [question] = await extract(`<div class="question" data-question-number="42"><div class="question-text">${stem}</div><label><input type="radio" name="long">Alpha</label><label><input type="radio" name="long">Beta</label></div>`);
  assert.equal(question.number, 42);
  assert.equal(question.text, stem);
});

browserTest('unlimited analysis captures a million loaded characters below the viewport without scrolling', async () => {
  const page = await browser.newPage();
  try {
    const content = 'Dữ liệu kiểm tra. '.repeat(65000);
    await page.setContent(`<main><p>${content}</p><p>END_OF_LOADED_CONTENT</p><canvas width="20" height="20"></canvas><iframe sandbox src="https://blocked.example/test"></iframe></main>`);
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => ({ snapshot: extractQuizQuestions({ unlimited: true }), y: scrollY }));
    assert(result.snapshot.pageText.length > 1000000); assert(result.snapshot.pageText.endsWith('END_OF_LOADED_CONTENT')); assert.equal(result.y, 0);
    assert.equal(result.snapshot.pageTooLong, false); assert.equal(result.snapshot.mediaCount, 1); assert.equal(result.snapshot.iframes[0].readable, false);
    assert.equal((await page.evaluate(() => extractQuizQuestions())).pageTooLong, true, 'old snapshot compatibility remains explicit about its limit');
  } finally { await page.close(); }
});

browserTest('analysis snapshot includes all articles and questions outside the first main container', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><p>Câu 2: Câu đầu?</p><p>A. Một</p><p>B. Hai</p></main><article><p>Câu 9: Câu tiếp?</p><p>A. Ba</p><p>B. Bốn</p></article>');
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => extractQuizQuestions({ unlimited: true }));
    assert.equal(result.questions.length, 2); assert(result.pageText.includes('Câu đầu?')); assert(result.pageText.includes('Câu tiếp?'));
  } finally { await page.close(); }
});

browserTest('Moodle grading/selection status and a timer do not change the analysis snapshot', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><div class="que"><div class="info"><h3>Question 7</h3><p class="state">Not yet answered</p><p class="grade">Marked out of 1</p></div><div class="qtext">Which value is even?</div><label><input type="radio" name="q">One</label><label><input type="radio" name="q">Two</label></div><span role="timer">00:59</span></main>');
    await page.addScriptTag({ content: source });
    const before = await page.evaluate(() => extractQuizQuestions({ unlimited: true }));
    await page.evaluate(() => { document.querySelector('input').checked = true; document.querySelector('.state').textContent = 'Answer saved'; document.querySelector('[role=timer]').textContent = '00:54'; });
    assert.deepEqual(await page.evaluate(() => extractQuizQuestions({ unlimited: true })), before);
  } finally { await page.close(); }
});

browserTest('recognizes individually named checkboxes and choices labelled only through ARIA', async () => {
  const questions = await extract(`<fieldset><legend>18. Which values are even?</legend><label><input type="checkbox" name="even2">Two</label><label><input type="checkbox" name="even3">Three</label></fieldset><div class="question"><span class="question-number">23</span><p>Which direction is north?</p><input type="radio" name="directions" aria-label="Up"><input type="radio" name="directions" aria-label="Down"></div>`);
  assert.deepEqual(questions.map(q => [q.number, q.options]), [[18, ['Two', 'Three']], [23, ['Up', 'Down']]]);
});

browserTest('recognizes generated letter lists and marks text-only sheets containing images', async () => {
  const questions = await extract(`<article><p>Question 31: Which diagram shows the answer?</p><img alt="Missing visual data" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><ol type="A"><li>First choice</li><li>Second choice</li></ol></article>`);
  assert.deepEqual(questions, [{ number: 31, text: 'Which diagram shows the answer?', options: ['First choice', 'Second choice'], multiple: false, hasMedia: true }]);
});

browserTest('keeps page order when text questions appear before native controls', async () => {
  const questions = await extract(`<p>2. What is three plus one?</p><p>A. Four</p><p>B. Five</p><div class="question"><h3>Question 9</h3><p>Which value is odd?</p><label><input type="radio" name="odd">One</label><label><input type="radio" name="odd">Two</label></div>`);
  assert.deepEqual(questions.map(q => q.number), [2, 9]);
});

browserTest('preserves multiline stems and flags image-only answer choices', async () => {
  const [question] = await extract(`<div class="question"><h3>Question 17</h3><div class="qtext"><p>Which image matches?</p><p>Use the full description.</p></div><label><input type="radio" name="images"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></label><label><input type="radio" name="images"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></label></div>`);
  assert.equal(question.text, 'Which image matches? Use the full description.');
  assert.equal(question.options.length, 2);
  assert.equal(question.hasMedia, true);
});
