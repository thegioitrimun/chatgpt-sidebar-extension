document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let windowId, selectedId, sessions = [], timer, request = 0, manuallySelected = false;
  const status = text => { $('analysis-saved-status').textContent = text; };
  async function send(message) {
    const result = await chrome.runtime.sendMessage({ ...message, windowId });
    if (!result?.success) throw Error(result?.error || 'Không thực hiện được thao tác phiên phân tích.');
    return result;
  }
  function render() {
    const select = $('analysis-session');
    select.replaceChildren(...sessions.map(session => {
      const option = document.createElement('option'); option.value = session.sessionId;
      option.textContent = `${session.title || 'Trang web'} · ${session.completedCount}/${session.totalCount} · ${new Date(session.createdAt).toLocaleString('vi-VN')}`;
      return option;
    }));
    const selected = (manuallySelected ? sessions.find(session => session.sessionId === selectedId) : sessions.find(session => session.enabled)) || sessions[0];
    selectedId = selected?.sessionId; select.value = selectedId || ''; select.disabled = !selected;
    status(selected ? `${selected.status} Hết hạn: ${new Date(selected.expiresAt).toLocaleString('vi-VN')}.` : 'Chưa có phiên đã lưu. Nhấn Shift + Option + Q trên trang cần phân tích.');
    $('analysis-resume').disabled = !selected || (selected.enabled && !selected.paused);
    $('analysis-retry').disabled = !selected || !selected.enabled || !(selected.failedCount || selected.error || selected.paused);
    $('analysis-stop').disabled = !selected?.enabled; $('analysis-delete').disabled = !selected;
  }
  async function refresh() {
    const version = ++request, result = await send({ type: 'ANALYSIS_LIST' });
    if (version === request) { sessions = result.sessions; render(); }
  }
  $('analysis-session').addEventListener('change', () => { manuallySelected = true; selectedId = $('analysis-session').value; render(); });
  for (const [id, type] of [['analysis-resume', 'ANALYSIS_RESUME'], ['analysis-retry', 'ANALYSIS_RETRY_FAILED'], ['analysis-stop', 'ANALYSIS_STOP'], ['analysis-delete', 'ANALYSIS_DELETE']]) {
    $(id).addEventListener('click', async () => {
      if (!selectedId) return;
      if (type === 'ANALYSIS_DELETE' && !window.confirm('Xóa bản chụp trang và tiến độ của phiên này trên máy? Hội thoại trên ChatGPT vẫn được giữ.')) return;
      $(id).disabled = true;
      try { await send({ type, sessionId: selectedId }); await refresh(); }
      catch (error) { status(error.message); $(id).disabled = false; }
    });
  }
  try {
    windowId = (await chrome.windows.getCurrent()).id;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.analysisTick) { clearTimeout(timer); timer = setTimeout(() => refresh().catch(error => status(error.message)), 200); }
    });
    await refresh();
  } catch (error) { status(error.message); }
});
