// Lazy, isolated-world form adapter. Never submits forms or executes AI-provided code.
(() => {
  if (globalThis.sidebarFormAdapter) return;
  let fields = new Map();
  let undo = [];
  const read = (element) => element.isContentEditable ? element.innerText : element.value;
  function editable(element) {
    if (!element.isConnected || element.disabled || element.matches(':disabled') || element.readOnly || element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"], [aria-readonly="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }
  function labelFor(element) {
    const root = element.getRootNode();
    const labelText = node => {
      if (!node) return '';
      if (!node.querySelector('[data-sidebar-ai-annotation]')) return node.innerText || node.textContent || '';
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[data-sidebar-ai-annotation]').forEach(annotation => annotation.remove());
      return copy.textContent || '';
    };
    const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => labelText(root.getElementById?.(id))).join(' ').trim();
    const label = [...(element.labels || [])].map(labelText).join(' ').trim();
    return (label || labelled || element.getAttribute('aria-label') || element.placeholder || element.name || element.id || 'Ô nhập không có nhãn').replace(/\s+/g, ' ').slice(0, 240);
  }
  function discover(root, found) {
    // Remove badges left on the page by earlier extension versions.
    root.querySelectorAll('[data-sidebar-ai-annotation]').forEach(node => node.remove());
    for (const element of root.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')) {
      if (!editable(element)) continue;
      if (element.tagName === 'INPUT' && !['text', 'email', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'search'].includes(element.type)) continue;
      if (!['INPUT', 'TEXTAREA'].includes(element.tagName) && !element.isContentEditable) continue;
      if (element.isContentEditable && element.parentElement?.isContentEditable) continue;
      if (found.length >= 300) break;
      found.push(element);
    }
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && found.length < 300) discover(element.shadowRoot, found);
    }
  }
  function scan() {
    const found = [];
    discover(document, found);
    fields = new Map();
    const result = found.map(element => {
      const id = crypto.randomUUID();
      const initial = read(element) || '';
      const currentValue = initial.slice(0, 500);
      const field = { id, label: labelFor(element), name: (element.name || '').slice(0, 160), type: element.type || 'contenteditable',
        placeholder: (element.placeholder || '').slice(0, 240), required: element.required || element.getAttribute('aria-required') === 'true',
        maxLength: element.maxLength > 0 ? element.maxLength : null, min: (element.min || '').slice(0, 32), max: (element.max || '').slice(0, 32),
        currentValue, section: element.closest('fieldset')?.querySelector('legend')?.innerText?.slice(0, 160) || '' };
      fields.set(id, { element, initial });
      return field;
    });
    return { url: location.href, title: document.title, fields: result };
  }
  function write(element, value, validate = false) {
    const original = read(element);
    if (element.isContentEditable) {
      element.focus();
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) return false;
    } else {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(element, value);
      if (validate && (element.value !== value || (element.willValidate && !element.validity.valid))) {
        setter.call(element, original); return false;
      }
    }
    if (!element.isContentEditable) element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return read(element).replace(/\s+/g, ' ').trim() === value.replace(/\s+/g, ' ').trim();
  }
  function apply(values, overwrite) {
    const results = [];
    // Retain the previous undo batch until at least one new write succeeds.
    const changes = [];
    for (const item of values) {
      const field = fields.get(item.id);
      if (!field || !editable(field.element)) { results.push({ id: item.id, success: false, error: 'Ô đã thay đổi hoặc không còn hiển thị. Quét lại trang.' }); continue; }
      const { element, initial } = field;
      const before = read(element) || '';
      if (before !== initial) { results.push({ id: item.id, success: false, error: 'Bạn hoặc trang đã sửa ô này sau khi quét. Quét lại để tiếp tục.' }); continue; }
      if (before.trim() && !overwrite) { results.push({ id: item.id, success: false, error: 'Ô đã có nội dung; chưa bật ghi đè.' }); continue; }
      if (typeof item.value !== 'string' || !item.value.trim() || item.value.length > 20000) { results.push({ id: item.id, success: false, error: 'Giá trị trống hoặc quá dài.' }); continue; }
      if (element.maxLength > 0 && item.value.length > element.maxLength) { results.push({ id: item.id, success: false, error: `Vượt giới hạn ${element.maxLength} ký tự.` }); continue; }
      if (element.minLength > 0 && item.value.length < element.minLength) { results.push({ id: item.id, success: false, error: `Cần ít nhất ${element.minLength} ký tự.` }); continue; }
      const success = write(element, item.value, true);
      if (!success) {
        if (read(element) !== before) write(element, before);
        results.push({ id: item.id, success: false, error: 'Không khớp định dạng hoặc trang không nhận giá trị.' });
        continue;
      }
      const after = read(element);
      changes.push({ element, before, after });
      field.initial = after;
      results.push({ id: item.id, success: true });
    }
    if (changes.length) undo = changes;
    return results;
  }
  function revert() {
    const results = undo.map(({ element, before, after }) => {
      if (!editable(element) || read(element) !== after) return { success: false, error: 'Ô đã thay đổi; giữ nguyên nội dung hiện tại.' };
      const success = write(element, before);
      for (const field of fields.values()) if (field.element === element && success) field.initial = before;
      return { success };
    });
    undo = [];
    return results;
  }
  globalThis.sidebarFormAdapter = { scan, apply, revert };
})();
