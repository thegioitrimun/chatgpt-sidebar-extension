// Read only the rendered question/choice content. Never clicks an exam control.
function extractQuizQuestions() {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
    if (!element.getClientRects().length) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  };
  const choicesIn = root => [...root.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')].filter(input => {
    const label = input.labels?.[0] || input.closest('label') || input.parentElement;
    return visible(label) && !/^(?:đánh dấu|đánh dấu câu hỏi|mark|flag)(?:\s|$)/i.test(clean(label.innerText));
  });
  const roots = new Set();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!/^\s*(?:câu\s*hỏi|question)\s*[:#.]?\s*\d+\s*[:.)]?\s*$/i.test(node.textContent)) continue;
    let root = node.parentElement;
    if (!visible(root)) continue;
    for (let depth = 0; root && depth < 10; depth++, root = root.parentElement) {
      if (choicesIn(root).length >= 2) { roots.add(root); break; }
    }
  }
  // Fallback for Moodle and ordinary radio groups without a "Câu hỏi: N" header.
  if (!roots.size) {
    const controls = [...document.querySelectorAll('input[type="radio"], [role="radio"]')];
    for (const input of controls) {
      if (!visible(input.labels?.[0] || input.parentElement)) continue;
      const explicit = input.closest('.que, .question, .question-item, .question-container, [data-question-id], fieldset, [role="radiogroup"]');
      if (explicit && choicesIn(explicit).length >= 2) { roots.add(explicit); continue; }
      let root = input.parentElement;
      for (let depth = 0; root && depth < 9; depth++, root = root.parentElement) {
        if (choicesIn(root).length < 2) continue;
        const text = clean(root.innerText);
        if (text.length > 15 && text.length < 16000) { roots.add(root); break; }
      }
    }
  }
  const questions = [];
  for (const root of roots) {
    if (!visible(root) || [...roots].some(other => other !== root && root.contains(other))) continue;
    const inputs = choicesIn(root);
    const wrappers = inputs.map(input => {
      let wrapper = input.labels?.[0] || input.closest('label') || input.parentElement;
      while (wrapper && wrapper !== root && !clean(wrapper.innerText) && wrapper.parentElement !== root) wrapper = wrapper.parentElement;
      return wrapper;
    });
    const options = wrappers.map((wrapper, index) => clean(wrapper?.innerText || inputs[index].getAttribute('aria-label')));
    if (options.length < 2 || options.length > 26 || options.some(option => !option)) continue;
    const copy = root.cloneNode(true);
    const originals = [...root.querySelectorAll('*')];
    const clones = [...copy.querySelectorAll('*')];
    for (const wrapper of wrappers) {
      const index = originals.indexOf(wrapper);
      if (index >= 0) clones[index]?.remove();
    }
    copy.querySelectorAll('script, style, button, input, audio, video, [hidden], [role="dialog"], .modal, .flag, .question-flag').forEach(element => element.remove());
    const explicit = copy.querySelector('.qtext, .question-text, .question-title, .content-question') || copy.querySelector('.question-content');
    const raw = clean(explicit?.textContent || copy.textContent);
    const wholeText = clean(root.innerText);
    const label = clean(wholeText.match(/(?:câu\s*hỏi|question)\s*[:#.]?\s*\d+/i)?.[0]) || `Câu hỏi ${questions.length + 1}`;
    let text = clean(raw.replace(/(?:câu\s*hỏi|question)\s*[:#.]?\s*\d+/i, '').replace(/đánh dấu(?: câu hỏi)?/gi, '').replace(/thông báo\s*bấm vào tải lại để tiếp tục nghe audio\??/gi, ''));
    const instruction = clean(wholeText.match(/\((?:Chọn|Choose)[^)]{0,160}\)/i)?.[0]);
    if (instruction && !text.includes(instruction)) text += ` ${instruction}`;
    if (text.length < 5) continue;
    const number = Number(label.match(/\d+/)?.[0]);
    const mediaScope = root.querySelector('.qtext, .question-text, .question-title, .content-question') || root;
    const hasMedia = !!mediaScope.querySelector('img, canvas, video, audio, .MathJax svg');
    questions.push({ number, text, options, multiple: inputs.some(input => input.matches('input[type=checkbox], [role=checkbox]')) || /nhiều|multiple/i.test(instruction), hasMedia });
  }
  return { url: location.href, title: document.title, questions };
}
