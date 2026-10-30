// Read rendered questions and choices without changing any page controls.
function extractQuizQuestions(settings = {}) {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const controlSelector = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]';
  const questionSelector = '.que, .question, .question-item, .question-container, .quiz-question, .quiz_question, [data-question-id], [data-question-number]';
  const textSelector = '.qtext, .question-text, .question-title, .content-question, [data-question-text]';
  const ignoredSelector = 'script, style, noscript, nav, header, footer, [role="navigation"], [role="dialog"], [role="menu"], [hidden], [aria-hidden="true"], .modal, .flag, .question-flag, #chatgpt-quiz-overlay';
  const styles = new WeakMap();
  const styleFor = element => {
    if (!styles.has(element)) styles.set(element, getComputedStyle(element));
    return styles.get(element);
  };
  const visible = element => {
    if (!element || element.closest(ignoredSelector) || (!element.getClientRects().length && styleFor(element).display !== 'contents')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = styleFor(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  };
  const labelledText = element => {
    const ids = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return clean(ids.map(id => document.getElementById(id)?.innerText || '').join(' ')) || clean(element.getAttribute('aria-label'));
  };
  const wrapperFor = input => {
    const label = [...(input.labels || [])].find(visible) || input.closest('label');
    if (label) return label;
    if (input.matches('[role="radio"], [role="checkbox"]')) return input;
    const namedLabel = (input.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)).find(element => element && visible(element));
    if (namedLabel) return namedLabel;
    if (input.getAttribute('aria-label') && visible(input)) return input;
    let wrapper = input.parentElement;
    // Custom widgets often put a hidden native input beside the rendered label.
    for (let depth = 0; wrapper && depth < 3 && !clean(wrapper.innerText); depth++) wrapper = wrapper.parentElement;
    return wrapper;
  };
  const choicesIn = root => [...root.querySelectorAll(controlSelector)].filter(input => {
    const wrapper = wrapperFor(input);
    return visible(wrapper) && !/^(?:đánh dấu|đánh dấu câu hỏi|mark|flag)(?:\s|$)/i.test(clean(wrapper.innerText) || labelledText(input));
  });
  const questionNumber = value => {
    const match = clean(value).match(/^(?:(?:câu(?:\s*hỏi)?|question|q)\s*[:#.]?\s*(\d{1,5})(?!\d)(?:\s*(?:of|\/)\s*\d+)?\s*[:.)]?\s*|(?:\((\d{1,5})\)|(\d{1,5})[.):])\s*)/i);
    return match ? { number: Number(match[1] || match[2] || match[3]), prefix: match[0] } : null;
  };
  const hasQuestionCue = value => /[?？]|(?:^|\s)(?:which|what|who|when|where|why|how|choose|select|identify|calculate|chọn|câu hỏi|câu nào|đúng|sai|bao nhiêu|ở đâu|vì sao)(?:\s|[?:])/i.test(value);
  const roots = new Set();
  const allControls = [...document.querySelectorAll(controlSelector)].filter(input => visible(wrapperFor(input)));

  // Explicit question containers are independent: a page can mix platforms/widgets.
  for (const root of document.querySelectorAll(questionSelector)) {
    if (visible(root) && choicesIn(root).length >= 2) roots.add(root);
  }
  // Number-only headers are common on Vinmec. Find the smallest enclosing question.
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!/^\s*(?:câu(?:\s*hỏi)?|question)\s*[:#.]?\s*\d+\s*[:.)]?\s*$/i.test(node.textContent)) continue;
    let root = node.parentElement;
    if (!visible(root)) continue;
    for (let depth = 0; root && root !== document.body && depth < 10; depth++, root = root.parentElement) {
      if (choicesIn(root).length >= 2) { roots.add(root); break; }
    }
  }
  // Native and ARIA groups need a real question cue; do not treat arbitrary
  // preference/consent forms as an exam simply because they contain radios.
  for (const input of allControls) {
    if ([...roots].some(root => root.contains(input))) continue;
    const explicit = input.closest('fieldset, [role="radiogroup"], [role="group"]');
    const groupName = input.getAttribute('name');
    const sameGroup = candidate => {
      if (!groupName || !input.matches('input[type="radio"]')) return true;
      return choicesIn(candidate).every(other => other.getAttribute('name') === groupName);
    };
    let root = explicit || input.parentElement;
    for (let depth = 0; root && root !== document.body && depth < 9; depth++, root = root.parentElement) {
      const count = choicesIn(root).length;
      if (count < 2) continue;
      if (count > 26 || !sameGroup(root)) break;
      const text = clean(root.innerText);
      const title = clean(root.querySelector('legend, h1, h2, h3, h4, h5, h6')?.innerText) || labelledText(root);
      if (text.length < 8 || text.length > 100000) continue;
      if (root.matches(questionSelector) || questionNumber(text) || hasQuestionCue(title || text)) { roots.add(root); break; }
    }
  }

  const questions = [];
  const acceptedRoots = new Set();
  const sourceElements = new WeakMap();
  const addQuestion = (question, element) => { questions.push(question); sourceElements.set(question, element); };
  const choiceText = (value, index) => clean(value).replace(new RegExp(`^\\(?${String.fromCharCode(65 + index)}[).:\\-]\\s*`, 'i'), '').trim();
  for (const root of [...roots].sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) {
    if (!visible(root) || [...roots].some(other => other !== root && root.contains(other))) continue;
    const inputs = choicesIn(root);
    const wrappers = inputs.map(wrapperFor);
    if (new Set(wrappers).size !== inputs.length) continue;
    const options = wrappers.map((wrapper, index) => {
      const media = wrapper.querySelector('img, canvas, video, audio, .MathJax svg, math');
      const value = clean(wrapper.innerText) || labelledText(inputs[index]) || clean(media?.getAttribute('alt')) || (media ? `[Lựa chọn ${String.fromCharCode(65 + index)} có dữ kiện hình/âm thanh]` : '');
      return choiceText(value, index);
    });
    if (options.length < 2 || options.length > 26 || options.some(option => !option)) continue;
    const copy = root.cloneNode(true);
    const originals = [...root.querySelectorAll('*')];
    const clones = [...copy.querySelectorAll('*')];
    for (const wrapper of wrappers) {
      const index = originals.indexOf(wrapper);
      if (index >= 0) clones[index]?.remove();
    }
    copy.querySelectorAll(`${ignoredSelector}, button, input, .info, .questionflag, .state, .grade, .question-number, .qno`).forEach(element => element.remove());
    copy.querySelectorAll('br, p, div, li, legend, h1, h2, h3, h4, h5, h6').forEach(element => { element.before(document.createTextNode(' ')); element.after(document.createTextNode(' ')); });
    const explicit = copy.querySelector(textSelector) || copy.querySelector('legend') || copy.querySelector('.question-content');
    const raw = clean(explicit?.textContent || copy.textContent) || labelledText(root);
    const wholeText = clean(root.innerText);
    const header = root.querySelector('.qno, .question-number, .info h3, legend, h1, h2, h3, h4, h5, h6');
    const headerText = clean(header?.innerText);
    const numberInfo = questionNumber(headerText) || (header?.matches('.qno, .question-number') && /^\d{1,5}$/.test(headerText) ? { number: Number(headerText) } : null) || questionNumber(wholeText) || questionNumber(labelledText(root));
    const attributeNumber = Number(root.getAttribute('data-question-number'));
    const number = numberInfo?.number || (attributeNumber > 0 ? attributeNumber : questions.length + 1);
    let text = clean(raw.replace(/^(?:câu(?:\s*hỏi)?|question)\s*[:#.]?\s*\d+(?:\s*(?:of|\/)\s*\d+)?\s*[:.)]?/i, '').replace(/đánh dấu(?: câu hỏi)?/gi, '').replace(/thông báo\s*bấm vào tải lại để tiếp tục nghe audio\??/gi, ''));
    if (questionNumber(text)?.number === number) text = clean(text.slice(questionNumber(text).prefix.length));
    const instruction = clean(wholeText.match(/\((?:Chọn|Choose|Select)[^)]{0,160}\)/i)?.[0]);
    if (instruction && !text.includes(instruction)) text += ` ${instruction}`;
    if (text.length < 5) continue;
    const mediaScope = root.querySelector(textSelector) || root;
    const hasMedia = !!mediaScope.querySelector('img, canvas, video, audio, .MathJax svg, math') || wrappers.some(wrapper => !!wrapper.querySelector('img, canvas, video, audio, .MathJax svg, math'));
    addQuestion({ number, text, options, multiple: inputs.some(input => input.matches('input[type="checkbox"], [role="checkbox"]')) || /nhiều|multiple|all that apply|more than one/i.test(instruction), hasMedia }, root);
    acceptedRoots.add(root);
  }

  // Text-only question sheets: require an explicit question number and an
  // ordered A/B/... choice sequence. Never infer answers from ordinary prose.
  const lines = [];
  let line = '';
  let lineHasMedia = false;
  let lineElement;
  const finishLine = () => { const value = clean(line); if (value || lineHasMedia) lines.push({ value, hasMedia: lineHasMedia, element: lineElement }); line = ''; lineHasMedia = false; lineElement = null; };
  const readLines = element => {
    if (acceptedRoots.has(element) || !visible(element)) return;
    if (element.matches('button, input, select, textarea') || element.matches(controlSelector)) return;
    if (element.tagName === 'BR') { finishLine(); return; }
    if (element.matches('img, canvas, video, audio, .MathJax svg, math')) { lineHasMedia = true; lineElement ||= element; }
    const display = styleFor(element).display;
    const block = /^(?:block|list-item|table-row|flex|grid|flow-root)$/.test(display);
    if (block) finishLine();
    if (element.tagName === 'LI' && element.parentElement?.matches('ol[type="A"], ol[type="a"]')) {
      const offset = Number(element.parentElement.getAttribute('start') || 1) - 1;
      const index = [...element.parentElement.children].indexOf(element) + offset;
      if (index >= 0 && index < 26 && !/^\(?[A-Z][).:\-]/i.test(clean(element.innerText))) { line += `${String.fromCharCode(65 + index)}. `; lineElement ||= element; }
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (clean(child.textContent)) lineElement ||= element;
        if (styleFor(element).whiteSpace.startsWith('pre')) {
          const parts = child.textContent.split(/\r?\n/);
          parts.forEach((part, index) => { if (index) finishLine(); line += part; });
        } else line += child.textContent.replace(/\s+/g, ' ');
      } else if (child.nodeType === Node.ELEMENT_NODE) readLines(child);
    }
    if (block) finishLine();
  };
  if (document.body) readLines(document.body);
  finishLine();
  let current = null;
  const flush = () => {
    if (current && current.options.length >= 2 && current.options.length <= 26 && current.options.every(Boolean) && current.text.length >= 5) {
      addQuestion({ number: current.number, text: current.text, options: current.options, multiple: /chọn nhiều|multiple|all that apply|more than one/i.test(current.text), hasMedia: current.hasMedia }, current.element);
    }
    current = null;
  };
  for (const { value, hasMedia, element } of lines) {
    const numbered = questionNumber(value);
    if (numbered) {
      flush();
      current = { number: numbered.number, text: clean(value.slice(numbered.prefix.length)), options: [], hasMedia, element };
      continue;
    }
    if (!current) continue;
    current.hasMedia ||= hasMedia;
    const choice = value.match(/^\(?([A-Z])[).:\-]\s*(.*)$/i);
    if (choice && choice[1].toUpperCase().charCodeAt(0) - 65 === current.options.length) {
      current.options.push(clean(choice[2]));
    } else if (choice && current.options.length) {
      flush();
    } else if (!current.options.length) current.text = clean(`${current.text} ${value}`);
    else current.options[current.options.length - 1] = clean(`${current.options[current.options.length - 1]} ${value}`);
  }
  flush();
  questions.sort((left, right) => {
    const a = sourceElements.get(left), b = sourceElements.get(right);
    if (!a || !b || a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return { url: location.href, title: document.title, questions, ...extractQuizPageText(settings) };
}

// A page need not expose radio buttons or a recognizable quiz layout. Keep a
// text fallback so the hotkey still submits it for the model to read.
function extractQuizPageText(settings = {}) {
  const root = settings.unlimited ? document.body || document.documentElement : document.querySelector('main, article, [role="main"]') || document.body;
  if (!root) return { pageText: '' };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), lines = [];
  const excluded = 'script,style,noscript,input,textarea,select,nav,footer,[hidden],[aria-hidden="true"],[role="timer"],time,.timer,.countdown,.que .state,.que .grade,.questionflag,.question-flag,.flag,#chatgpt-quiz-overlay';
  const visibility = new WeakMap();
  const visible = element => {
    if (!element) return true;
    if (!visibility.has(element)) {
      const style = getComputedStyle(element);
      visibility.set(element, element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0' && visible(element.parentElement));
    }
    return visibility.get(element);
  };
  let node, length = 0;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement, value = node.textContent.replace(/\s+/g, ' ').trim();
    if (!value || !parent || parent.closest(excluded)) continue;
    if (!visible(parent)) continue;
    lines.push(value); length += value.length + 1;
    if (!settings.unlimited && length > 200000) return { pageText: lines.join('\n').slice(0, 200000), pageTooLong: true };
  }
  const media = [...root.querySelectorAll('canvas,video,audio,img')].filter(element => !element.closest(excluded) && visible(element) && (element.tagName !== 'IMG' || !element.getAttribute('alt'))).length;
  const iframes = [...document.querySelectorAll('iframe')].filter(element => visible(element)).map(element => ({ url: element.src || 'about:blank', readable: !element.hasAttribute('sandbox') || element.sandbox.contains('allow-same-origin') }));
  return { pageText: lines.join('\n'), pageTooLong: false, ...(settings.unlimited ? { mediaCount: media, iframes } : {}) };
}
