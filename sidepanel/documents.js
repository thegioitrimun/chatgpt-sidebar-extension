document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let windowId, catalog, viewedId, refreshTimer, sequence = 0, uploading = false;
  let confirmAction;
  const fileLabels = { preparing: 'Đang chuẩn bị', uploading: 'Đang tải lên ChatGPT', ready: 'Sẵn sàng', error: 'Lỗi tải tệp' };
  const feedback = text => { $('doc-feedback').textContent = text; };
  async function send(message) {
    const response = await chrome.runtime.sendMessage({ ...message, windowId });
    if (!response?.success) throw new Error(response?.error || 'Chưa thực hiện được thao tác.');
    return response;
  }
  function open() {
    $('documents-panel').hidden = false;
    $('form-fill-panel').classList.add('hidden');
    $('btn-documents').removeAttribute('data-unread');
    refresh().catch(error => feedback(error.message));
  }
  function confirm(title, text, action) {
    confirmAction = action; $('doc-confirm-title').textContent = title; $('doc-confirm-text').textContent = text; $('doc-confirm').showModal();
  }
  function render(data) {
    catalog = data; viewedId = data.selectedId;
    const select = $('doc-collection');
    select.replaceChildren(...data.collections.map(collection => { const option = document.createElement('option'); option.value = collection.id; option.textContent = collection.name + (collection.id === data.activeId ? ' · Đang dùng' : ''); return option; }));
    select.value = viewedId || ''; select.disabled = !data.collections.length;
    $('doc-details').hidden = !viewedId; $('doc-empty').hidden = !!viewedId;
    if (!viewedId) return;
    const collection = data.collections.find(item => item.id === viewedId), revision = data.revision;
    if (document.activeElement !== $('doc-name')) $('doc-name').value = collection.name;
    const active = viewedId === data.activeId;
    $('doc-active-label').textContent = active ? 'Đang dùng cho chat và phân tích' : '';
    $('doc-use').textContent = active ? 'Đang dùng bộ này' : 'Dùng bộ này'; $('doc-use').disabled = active;
    $('doc-disable').hidden = !active;
    $('doc-legacy').hidden = !revision?.legacy;
    $('doc-file-list').replaceChildren(...(revision?.files || []).map(file => {
      const li = document.createElement('li'), info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('span'), remove = document.createElement('button');
      const state = revision.fileStates[file.id]; title.textContent = file.name; title.title = file.name;
      detail.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MiB · ${fileLabels[state?.state] || 'Đang chuẩn bị'}`;
      if (state?.error) { detail.textContent += ` — ${state.error}`; detail.classList.add('doc-error'); }
      info.append(title, detail); remove.className = 'doc-text-button'; remove.type = 'button'; remove.textContent = 'Bỏ'; remove.setAttribute('aria-label', `Bỏ ${file.name}`);
      remove.addEventListener('click', () => confirm('Bỏ tài liệu?', `Tạo phiên bản mới không có “${file.name}”. Lượt phân tích đang chạy giữ nguồn cũ đến khi dừng.`, () => changeFiles([], file.id)));
      li.append(info, remove); return li;
    }));
    const runtime = data.runtime;
    $('doc-status').textContent = runtime?.error || runtime?.waiting || (runtime?.current ? (runtime.current.kind === 'upload' ? 'Đang chuẩn bị bộ tài liệu…' : 'ChatGPT đang trả lời…') : revision?.ready ? 'Sẵn sàng. Bạn có thể hỏi hoặc bật phân tích.' : revision?.files.length ? 'Đang chờ đồng bộ tài liệu…' : 'Thêm tài liệu để bắt đầu.');
    $('doc-status').classList.toggle('doc-error', !!runtime?.error);
    $('doc-retry').hidden = !runtime?.error; $('doc-retry').textContent = runtime?.current?.sent ? 'Đọc lại ChatGPT' : 'Thử lại';
    $('doc-resend').hidden = !(runtime?.error && runtime.current?.sent && runtime.current?.readAttempted);
    $('doc-open-chat').hidden = !runtime?.chatTabId;
    $('doc-ask').disabled = !revision?.legacy && !revision?.files.length;
    const history = $('doc-history'), nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    const signature = JSON.stringify([revision.id, data.messages]);
    if (history.dataset.signature !== signature) {
      history.dataset.signature = signature;
      history.replaceChildren(...data.messages.map(message => {
        const item = document.createElement('article'), label = document.createElement('div'), body = document.createElement('p');
        item.className = `doc-message doc-message-${message.role}`; label.className = 'doc-message-label';
        label.textContent = message.role === 'user' ? (message.kind === 'analysis' ? 'Phân tích trang' : 'Bạn') : 'ChatGPT';
        if (message.revisionId !== revision.id) label.textContent += ' · Phiên bản tài liệu trước';
        if (message.role === 'user' && message.status !== 'complete') label.textContent += ' · Đang chờ';
        body.textContent = message.text; item.append(label, body); return item;
      }));
      if (nearBottom) history.scrollTop = history.scrollHeight;
    }
  }
  async function refresh() {
    const current = ++sequence, data = await send({ type: 'DOC_GET', collectionId: viewedId });
    if (current === sequence) render(data);
    return data;
  }
  async function changeFiles(files, removeId) {
    const result = await send({ type: 'DOC_FILES', collectionId: viewedId, files, removeId });
    feedback(result.duplicate ? 'Các tệp này đã có trong bộ; không tải trùng.' : 'Đã tạo phiên bản mới. Tài liệu sẽ được tải lên ChatGPT ở nền.');
    await refresh();
  }
  async function addFiles(list) {
    if (uploading || !viewedId || !list.length) return;
    const target = viewedId;
    uploading = true; $('doc-files').disabled = true;
    try {
      if (list.length > sidebarDocuments.MAX_FILES) throw new Error('Chọn tối đa 20 tệp mỗi lần.');
      const files = [];
      for (const file of list) { feedback(`Đang lưu ${file.name} trên máy…`); files.push(await sidebarDocuments.stage(file)); }
      if (viewedId !== target) throw new Error('Bộ đang xem đã thay đổi. Chọn lại tệp cho đúng bộ.');
      await changeFiles(files);
    } catch (error) { feedback(error.message); }
    finally { uploading = false; $('doc-files').disabled = false; $('doc-files').value = ''; }
  }
  $('btn-documents').addEventListener('click', open);
  $('btn-manage-documents').addEventListener('click', () => { $('settings-modal').close(); open(); });
  $('doc-close').addEventListener('click', () => { $('documents-panel').hidden = true; });
  $('btn-form-fill').addEventListener('click', () => { $('documents-panel').hidden = true; });
  $('doc-collection').addEventListener('change', () => { viewedId = $('doc-collection').value; feedback(''); refresh().catch(error => feedback(error.message)); });
  $('doc-create-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; if (button) button.disabled = true;
    try { const result = await send({ type: 'DOC_CREATE', name: $('doc-create-name').value }); viewedId = result.collectionId; $('doc-create-name').value = ''; feedback('Đã tạo bộ. Thêm tài liệu để bắt đầu.'); await refresh(); }
    catch (error) { feedback(error.message); } finally { if (button) button.disabled = false; }
  });
  for (const [id, action] of [
    ['doc-rename', () => send({ type: 'DOC_RENAME', collectionId: viewedId, name: $('doc-name').value })],
    ['doc-use', () => send({ type: 'DOC_SELECT', collectionId: viewedId })],
    ['doc-disable', () => send({ type: 'DOC_SELECT', collectionId: null })],
    ['doc-open-chat', () => send({ type: 'DOC_OPEN_CHAT', revisionId: catalog.revision.id })],
    ['doc-retry', () => send({ type: 'DOC_RETRY', revisionId: catalog.revision.id })],
    ['doc-resend', () => send({ type: 'DOC_RESEND', revisionId: catalog.revision.id })]
  ]) $(id).addEventListener('click', async () => { $(id).disabled = true; try { await action(); await refresh(); } catch (error) { feedback(error.message); } finally { $(id).disabled = id === 'doc-use' && catalog?.activeId === viewedId; } });
  $('doc-delete').addEventListener('click', () => confirm('Xóa bộ tài liệu?', 'Dừng các lượt đang dùng bộ này và xóa bản lưu trong extension. Cuộc chat đã gửi trên ChatGPT vẫn được giữ.', async () => { await send({ type: 'DOC_DELETE', collectionId: viewedId }); viewedId = null; await refresh(); }));
  $('doc-confirm-cancel').addEventListener('click', () => { confirmAction = null; $('doc-confirm').close(); });
  $('doc-confirm-ok').addEventListener('click', async () => { const action = confirmAction; confirmAction = null; $('doc-confirm').close(); try { await action?.(); } catch (error) { feedback(error.message); } });
  $('doc-files').addEventListener('change', event => addFiles([...event.target.files]));
  const drop = $('doc-drop');
  drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('doc-files').click(); } });
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); addFiles([...event.dataTransfer.files]); });
  $('doc-ask-form').addEventListener('submit', async event => {
    event.preventDefault(); const text = $('doc-question').value.trim(); if (!text) return;
    $('doc-ask').disabled = true;
    try { await send({ type: 'DOC_ASK', collectionId: viewedId, text, requestId: crypto.randomUUID() }); $('doc-question').value = ''; feedback('Đã xếp hàng câu hỏi. Đóng sidebar vẫn tiếp tục xử lý.'); await refresh(); }
    catch (error) { feedback(error.message); } finally { $('doc-ask').disabled = false; }
  });
  window.sidebarDocumentLibrary = {
    hasActive: async () => !!(await send({ type: 'DOC_GET' })).activeId,
    analyze: async (text, automatic) => {
      const data = await send({ type: 'DOC_GET' });
      if (!data.activeId) return null;
      const result = await send({ type: 'DOC_ASK', collectionId: data.activeId, text, kind: 'analysis', requestId: crypto.randomUUID() });
      if (!automatic) { viewedId = data.activeId; open(); } else $('btn-documents').dataset.unread = 'true';
      return result;
    }
  };
  try {
    windowId = (await chrome.windows.getCurrent()).id;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.documentLibraryTick || changes.documentActiveCollectionId)) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(error => feedback(error.message)), 120); }
    });
    await refresh();
  } catch (error) { feedback(error.message); }
});
