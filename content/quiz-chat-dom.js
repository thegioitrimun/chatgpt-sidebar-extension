// ChatGPT has both the older role-marked renderer and the newer DIL renderer.
// Bind a reply to our exact user prompt before reading any assistant content.
(() => {
  const selector = '[data-message-author-role="user"], [data-user-message-bubble], [data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]';
  const role = node => node.matches('[data-message-author-role="user"], [data-user-message-bubble]') ? 'user' : 'assistant';
  function readReply(document, jobId) {
    const candidates = [...document.querySelectorAll(selector)];
    // New renderers can sit inside an older role wrapper. Read each message once.
    const messages = candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node) && role(parent) === role(node)));
    let index = -1;
    for (let cursor = 0; cursor < messages.length; cursor++) {
      if (role(messages[cursor]) === 'user' && messages[cursor].textContent.includes(`QUIZ_JOB:${jobId}`)) index = cursor;
    }
    if (index < 0) return { found: false };
    let reply;
    for (const message of messages.slice(index + 1)) {
      if (role(message) === 'user') return { found: true, changed: true };
      reply = message;
    }
    if (!reply) return { found: true, text: '' };
    const bodies = [...reply.querySelectorAll('.markdown, [data-markdown-text-style="assistant-message"]')];
    const roots = bodies.filter(node => !bodies.some(parent => parent !== node && parent.contains(node)));
    const text = roots.length ? roots.map(node => node.innerText || node.textContent).join('\n') : reply.innerText || reply.textContent || '';
    return { found: true, text: text.trim() };
  }
  globalThis.sidebarQuizChatDOM = { readReply };
})();
