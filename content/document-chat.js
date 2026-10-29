// Uses ChatGPT's file input and composer; never opens the OS picker or focuses UI.
globalThis.initializeSidebarDocumentChat = function ({ findInput, inputText, normalizeText, isGenerating, injectPageContext, hasOtherJob }) {
  let current, readyTimer, ownedAttachment, wasReady = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = (state, type, extra = {}) => chrome.runtime.sendMessage({ type, revisionId: state.revisionId, jobId: state.jobId, token: state.token, runId: state.runId, conversationUrl: location.href, ...extra });
  const matches = state => !state.referenceUrl || sidebarQuiz.conversationUrl(location.href) === state.referenceUrl;
  const active = state => !state.cancelled && matches(state);
  function fileInput(file) {
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    const candidates = [...document.querySelectorAll('input[type="file"]:not([disabled])')].filter(input => {
      const accepted = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      return !accepted.length || accepted.some(value => value === extension || value === file.mime || value === '*/*' || (value.endsWith('/*') && file.mime.startsWith(value.slice(0, -1))));
    });
    const form = findInput()?.closest('form');
    return candidates.find(input => form?.contains(input) && !input.accept.trim()) || candidates.find(input => form?.contains(input)) || candidates.find(input => !input.accept.trim()) || candidates[0];
  }
  function composerRoot() {
    const composer = findInput();
    return composer?.closest('form') || composer?.parentElement?.parentElement;
  }
  function composerAttachments() {
    const root = composerRoot(), composer = findInput();
    if (!root) return [];
    // Newer ChatGPT cards have neither a title nor a test ID. Nested icons
    // repeat this class, so retain the outer card rather than counting icons.
    const surfaces = [...root.querySelectorAll('.composer-attachment-surface')];
    const outerSurfaces = surfaces.filter(node => !surfaces.some(parent => parent !== node && parent.contains(node)));
    const named = node => /\.[a-z][a-z0-9]{0,11}$/i.test((node.getAttribute('title') || '').trim());
    const titles = [...root.querySelectorAll('[title]')].filter(named);
    const cards = [...root.querySelectorAll('[data-testid*="attachment"], [data-testid*="file-preview"], [data-testid*="file-card"]')].filter(node => !node.matches('input, label, button, [role="button"]') || named(node) || /\.[a-z][a-z0-9]{0,11}$/i.test(node.textContent.trim()));
    const candidates = [...new Set([...titles, ...cards])].filter(node => !composer.contains(node) && !node.contains(composer) && !outerSurfaces.some(surface => surface.contains(node) || node.contains(surface)));
    // A card and its filename title describe one attachment. Keep its innermost
    // marker so a wrapper does not look like another unknown file.
    return [...outerSurfaces, ...candidates.filter(node => !candidates.some(child => child !== node && node.contains(child)))];
  }
  function attachmentMatches(node, file, allowCollision = false) {
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dot = file.name.lastIndexOf('.');
    const pattern = allowCollision && dot > 0 ? new RegExp(`^${escape(file.name.slice(0, dot))}(?: ?\\([1-9]\\d*\\))?${escape(file.name.slice(dot))}$`) : null;
    return [node, ...node.querySelectorAll('[title], .truncate')].some(part => [part.getAttribute('title') || '', part.textContent.trim()].some(name => name === file.name || (pattern && pattern.test(name))));
  }
  function ownsUpload(state) {
    return state.kind === 'upload' && ownedAttachment?.fileId === state.file?.id && ownedAttachment.jobId === state.jobId;
  }
  function ownedCard(state, cards = composerAttachments()) {
    if (!ownsUpload(state) || cards.length !== 1) return null;
    const node = cards[0];
    if (!attachmentMatches(node, state.file, true) || ownedAttachment.before.has(node)) return null;
    if (ownedAttachment.card?.isConnected && ownedAttachment.card !== node) return null;
    // Filename collision suffixes are accepted only on a new card observed
    // after this bridge staged the exact bytes for the active upload job.
    ownedAttachment.card = node;
    return node;
  }
  function attachmentVisible(state) {
    const card = ownedCard(state);
    if (!card) return false;
    if (!card.matches('.composer-attachment-surface')) return true;
    const thumbnails = [...card.querySelectorAll('[data-attachment-thumbnail-state]')];
    // Office/text attachments can use an icon without thumbnail state. The
    // native enabled submit button remains the final upload-readiness gate.
    return !thumbnails.length || thumbnails.every(node => node.getAttribute('data-attachment-thumbnail-state') === 'ready');
  }
  function hasUnownedAttachments(state) {
    const root = composerRoot();
    if (!root) return false;
    const owned = ownsUpload(state);
    const cards = composerAttachments();
    if (cards.length && (!owned || !ownedCard(state, cards))) return true;
    return [...root.querySelectorAll('input[type="file"]')].some(input => [...input.files].some(file => !owned || file !== ownedAttachment.file));
  }
  function uploadError() {
    const root = findInput()?.closest('form');
    return [...(root?.querySelectorAll('[role="alert"], [data-testid*="error"]') || [])].map(node => node.textContent.trim()).filter(Boolean).join(' ').slice(0, 600);
  }
  async function waitForAttachment(state) {
    const deadline = Date.now() + 240000;
    while (active(state) && Date.now() < deadline) {
      const error = uploadError(); if (error) throw new Error(error);
      if (hasUnownedAttachments(state)) throw new Error('ChatGPT đang có tệp đính kèm khác chưa gửi. Giữ nguyên và xử lý trước khi thử lại.');
      if (attachmentVisible(state)) return;
      await pause(300);
    }
    if (active(state)) throw new Error('ChatGPT chưa nhận được tệp đính kèm. Kiểm tra cuộc chat rồi thử lại.');
  }
  async function attach(state) {
    const file = state.file;
    if (!file || !/^[a-f0-9]{64}$/.test(file.id) || file.size < 1 || file.size > 50 * 1024 * 1024) throw new Error('Thông tin tệp không hợp lệ.');
    // Only reuse an attachment this bridge actually staged for this job. A
    // matching filename alone says nothing about the bytes of a user's draft.
    if (!ownsUpload(state) && composerAttachments().some(node => attachmentMatches(node, file))) throw new Error('ChatGPT đang có tệp đính kèm chưa rõ nguồn. Giữ nguyên và xử lý trước khi thử lại.');
    if (hasUnownedAttachments(state)) throw new Error('ChatGPT đang có tệp đính kèm khác chưa gửi. Giữ nguyên và xử lý trước khi thử lại.');
    if (ownedCard(state)) return waitForAttachment(state);
    let input = fileInput(file);
    for (let count = 0; !input && count < 40 && active(state); count++) { await pause(250); input = fileInput(file); }
    if (!input) throw new Error('Không tìm thấy ô đính kèm ChatGPT. Mở ChatGPT để kiểm tra đăng nhập hoặc giới hạn tệp.');
    if (input.files?.length) throw new Error('ChatGPT đang có tệp đính kèm khác chưa gửi. Giữ nguyên và xử lý trước khi thử lại.');
    const chunks = [];
    for (let offset = 0; offset < file.size && active(state); offset += 256 * 1024) {
      const result = await report(state, 'DOC_FILE_CHUNK', { offset });
      if (!result?.success || typeof result.data !== 'string') throw new Error(result?.error || 'Không lấy được dữ liệu tệp. Thử lại tải tài liệu.');
      const text = atob(result.data), bytes = Uint8Array.from(text, character => character.charCodeAt(0));
      if (bytes.length !== Math.min(256 * 1024, file.size - offset)) throw new Error('Dữ liệu tệp không đầy đủ.');
      chunks.push(bytes);
    }
    if (!active(state)) return;
    if (hasUnownedAttachments(state)) throw new Error('ChatGPT đang có tệp đính kèm khác chưa gửi. Giữ nguyên và xử lý trước khi thử lại.');
    const transfer = new DataTransfer();
    transfer.items.add(new File(chunks, file.name, { type: file.mime }));
    input.files = transfer.files;
    ownedAttachment = { fileId: file.id, jobId: state.jobId, file: input.files[0], before: new Set(composerAttachments()) };
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await report(state, 'DOC_CHAT_UPLOADING');
    await waitForAttachment(state);
  }
  async function watch(state) {
    const deadline = Date.now() + 300000;
    let previous = '', changedAt = Date.now(), lastUrl = '';
    while (active(state) && Date.now() < deadline) {
      if (lastUrl !== location.href) { lastUrl = location.href; await report(state, 'DOC_CHAT_LOCATION').catch(() => {}); }
      const reply = sidebarQuizChatDOM.readReply(document, state.jobId, state.kind === 'quiz' ? 'QUIZ_JOB' : 'DOC_JOB');
      if (reply.changed) throw new Error('Cuộc chat có tin nhắn khác sau lượt này. Đọc lại trước khi gửi tiếp.');
      if (reply.text !== previous) { previous = reply.text; changedAt = Date.now(); }
      if (reply.text && !isGenerating() && Date.now() - changedAt > 1200) {
        if (state.kind === 'quiz' && !sidebarQuiz.parse(reply.text, state.questions)) throw new Error('ChatGPT trả lời sai định dạng đáp án. Đọc lại hoặc thử lại.');
        state.finished = true;
        const response = await report(state, 'DOC_CHAT_RESULT', { text: reply.text }).catch(() => null);
        if (response?.success || response?.stale) return;
        state.finished = false;
      }
      if (state.reading && !reply.found && Date.now() - state.startedAt > 90000 && !isGenerating()) throw new Error('Chưa tìm thấy lượt đã gửi trong cuộc chat. Có thể đọc lại hoặc chọn gửi lại.');
      await pause(500);
    }
    if (!state.cancelled) throw new Error(matches(state) ? 'Chưa đọc được phản hồi. Đọc lại để tiếp tục, không tự gửi trùng.' : 'Cuộc chat đã đổi địa chỉ; dừng để tránh lẫn bộ tài liệu.');
  }
  async function run(state) {
    try {
      if (!state.reading) {
        if (state.kind === 'upload') await attach(state);
        if (!active(state)) return;
        state.beforeSubmit = async () => {
          if (!active(state)) return false;
          const error = state.kind === 'upload' && uploadError(); if (error) throw new Error(error);
          if (hasUnownedAttachments(state)) throw new Error('ChatGPT đang có tệp đính kèm khác chưa gửi. Giữ nguyên và xử lý trước khi thử lại.');
          if (state.kind === 'upload' && !attachmentVisible(state)) throw new Error('Tệp đính kèm đã biến mất hoặc chưa sẵn sàng trước khi gửi.');
          return (await report(state, 'DOC_CHAT_WILL_SEND'))?.success === true;
        };
        const result = await injectPageContext(state.prompt, true, state);
        if (result.success && state.kind === 'upload') ownedAttachment = null;
        if (!state.cancelled && !result.success) throw new Error(result.error || 'Chưa gửi được lượt này.');
      }
      if (!state.cancelled) await watch(state);
    } catch (error) {
      if (!state.cancelled) await report(state, 'DOC_CHAT_ERROR', { error: error.message, definitelyUnsent: !state.reading && !state.submitted, reading: state.reading }).catch(() => {});
    } finally { state.finished = true; ready(); }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('DOC_CHAT_')) return;
    if (message.type === 'DOC_CHAT_CANCEL') {
      if (current?.jobId === message.jobId && current.token === message.token && current.runId === message.runId) current.cancelled = true;
      respond({ success: true }); return;
    }
    if (!['DOC_CHAT_START', 'DOC_CHAT_READ'].includes(message.type)) return;
    if (!['upload', 'chat', 'analysis', 'quiz'].includes(message.kind) || !['jobId', 'token', 'runId', 'revisionId', 'prompt'].every(key => typeof message[key] === 'string')) { respond({ success: false }); return; }
    if (!matches(message)) { respond({ success: false, error: 'Cuộc chat không thuộc bộ tài liệu hiện tại.' }); return; }
    if (current && !current.cancelled && !current.finished) { respond({ success: current.jobId === message.jobId && current.token === message.token && current.runId === message.runId, waiting: true }); return; }
    const reading = message.type === 'DOC_CHAT_READ';
    if (!reading && (!findInput() || isGenerating() || hasOtherJob())) { respond({ success: false, waiting: true }); return; }
    if (!reading && normalizeText(inputText(findInput())) && normalizeText(inputText(findInput())) !== normalizeText(message.prompt)) { respond({ success: false, waiting: true, draft: true }); return; }
    if (!reading && message.kind !== 'upload' && hasUnownedAttachments(message)) { respond({ success: false, waiting: true, draft: true }); return; }
    current = { ...message, reading, automatic: true, cancelled: false, finished: false, submitted: false, startedAt: Date.now(), sendWait: message.kind === 'upload' ? 240000 : 6000 };
    respond({ success: true }); run(current);
  });
  function ready() {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (!chrome.runtime?.id) return;
      const value = !!findInput() && !normalizeText(inputText(findInput())) && !hasUnownedAttachments({ kind: 'chat' }) && !isGenerating() && !hasOtherJob() && (!current || current.finished || current.cancelled);
      if (value && !wasReady) chrome.runtime.sendMessage({ type: 'DOC_CHAT_READY' }).catch(() => {});
      wasReady = value;
    }, 200);
  }
  new MutationObserver(ready).observe(document.documentElement, { childList: true, subtree: true });
  ready();
  return { isBusy: state => current && !current.finished && !current.cancelled && current !== state };
};
