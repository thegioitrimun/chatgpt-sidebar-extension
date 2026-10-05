// Shared by the background worker and ChatGPT frame; never evaluates AI output as code.
(() => {
  function extract(text, jobId, fieldIds) {
    if (typeof text !== 'string' || text.length > 200000) return null;
    const known = new Set(fieldIds);
    const valid = data => data && data.jobId === jobId && Array.isArray(data.fields) &&
      (!data.fields.length || data.fields.some(item => item && known.has(item.id)));
    try { const data = JSON.parse(text); if (valid(data)) return data; } catch { /* Markdown/prose may surround the JSON. */ }
    const starts = [];
    let quoted = false, escaped = false;
    let result = null;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"' && starts.length) quoted = true;
      else if (char === '{') {
        if (starts.length >= 100) return null;
        starts.push(index);
      }
      else if (char === '}' && starts.length) {
        const start = starts.pop();
        const candidate = text.slice(start, index + 1);
        if (!candidate.includes(jobId) || !candidate.includes('"fields"')) continue;
        try { const data = JSON.parse(candidate); if (valid(data)) result = data; } catch { /* Keep looking for a complete result. */ }
      }
    }
    return result;
  }
  globalThis.sidebarFormJSON = { extract };
})();
