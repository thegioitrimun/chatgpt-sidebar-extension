// Extension-origin storage only. File bytes never enter chrome.storage or Git.
(() => {
  const MAX_SIZE = 50 * 1024 * 1024, MAX_FILES = 20, CHUNK_SIZE = 256 * 1024;
  const types = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain' };
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('sidebar-document-library', 1);
      request.onupgradeneeded = () => {
        for (const name of ['collections', 'revisions', 'files', 'messages']) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => { connection = null; reject(new Error('Đóng các sidebar cũ rồi mở lại thư viện tài liệu.')); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    });
    return connection;
  }
  async function transaction(names, write, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, write ? 'readwrite' : 'readonly');
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Không lưu được tài liệu. Kiểm tra dung lượng trống của trình duyệt.'));
      try { operation(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  const get = (store, id) => transaction([store], false, (tx, done) => { tx.objectStore(store).get(id).onsuccess = event => done(event.target.result); });
  const all = store => transaction([store], false, (tx, done) => { tx.objectStore(store).getAll().onsuccess = event => done(event.target.result); });
  const put = (store, value) => transaction([store], true, tx => tx.objectStore(store).put(value));
  const remove = (store, id) => transaction([store], true, tx => tx.objectStore(store).delete(id));
  async function stage(file) {
    const extension = file.name?.split('.').pop().toLowerCase();
    if (!types[extension]) throw new Error(`${file.name}: chỉ hỗ trợ PDF, DOCX, PPTX và TXT.`);
    if (!file.size || file.size > MAX_SIZE) throw new Error(`${file.name}: tệp phải có nội dung và tối đa 50 MiB.`);
    const header = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (extension === 'pdf' && new TextDecoder().decode(header.slice(0, 5)) !== '%PDF-') throw new Error(`${file.name}: nội dung không phải PDF hợp lệ.`);
    if (['docx', 'pptx'].includes(extension) && (header[0] !== 80 || header[1] !== 75)) throw new Error(`${file.name}: nội dung không phải tài liệu Office hợp lệ.`);
    if (extension === 'txt' && header.includes(0)) throw new Error(`${file.name}: hãy dùng tệp văn bản UTF-8.`);
    const bytes = await file.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const metadata = { id: hash, name: file.name.slice(0, 240), size: file.size, mime: types[extension] };
    try { await put('files', { id: hash, blob: new Blob([bytes], { type: types[extension] }), stagedAt: Date.now() }); }
    catch (error) { throw new Error(error.name === 'QuotaExceededError' ? 'Bộ nhớ trình duyệt đã đầy. Xóa bớt tài liệu rồi thử lại.' : error.message); }
    return metadata;
  }
  async function saveRevision(collection, revision) {
    return transaction(['collections', 'revisions'], true, tx => {
      tx.objectStore('collections').put(collection);
      tx.objectStore('revisions').put(revision);
    });
  }
  globalThis.sidebarDocuments = { get, all, put, remove, stage, saveRevision, MAX_SIZE, MAX_FILES, CHUNK_SIZE, types };
})();
