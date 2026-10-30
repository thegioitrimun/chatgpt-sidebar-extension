// Durable analysis data is isolated from the user's document library.
(() => {
  const names = ['sessions', 'captures', 'chunks', 'units', 'tasks', 'results', 'files', 'events'];
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('sidebar-analysis-v1', 1);
      request.onupgradeneeded = () => {
        for (const name of names) {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          if (name !== 'sessions') store.createIndex('sessionId', 'sessionId');
        }
      };
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => { connection = null; reject(Error('Đóng sidebar cũ rồi mở lại để lưu phiên phân tích.')); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); connection = null; }; resolve(db); };
    });
    return connection;
  }
  const storageError = error => error?.name === 'QuotaExceededError' ? Error('Bộ nhớ trình duyệt không đủ. Phần đã nhận được giữ lại; dọn phiên cũ rồi thử lại.') : error || Error('Không lưu được tiến độ phân tích.');
  async function read(name, key, sessionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name), store = tx.objectStore(name);
      const request = key !== undefined ? store.get(key) : sessionId !== undefined ? store.index('sessionId').getAll(sessionId) : store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error));
    });
  }
  async function write(changes) {
    if (!changes.length) return;
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([...new Set(changes.map(change => change.store))], 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
      try {
        for (const change of changes) {
          if (change.remove !== undefined) tx.objectStore(change.store).delete(change.remove);
          else { if (!change.value?.id) throw Error('Thiếu mã bản ghi phân tích.'); tx.objectStore(change.store).put(change.value); }
        }
      } catch (error) { tx.abort(); reject(storageError(error)); }
    });
  }
  async function removeSession(id) {
    const changes = [{ store: 'sessions', remove: id }];
    for (const name of names.filter(name => name !== 'sessions')) for (const item of await read(name, undefined, id)) changes.push({ store: name, remove: item.id });
    await write(changes);
  }
  globalThis.sidebarAnalysisStore = {
    get: (name, id) => id ? read(name, id) : Promise.resolve(undefined),
    all: (name, sessionId) => read(name, undefined, sessionId),
    put: (name, value) => write([{ store: name, value }]), write, removeSession,
    CHUNK_BYTES: 45000, RETENTION_MS: 7 * 24 * 60 * 60 * 1000
  };
})();
