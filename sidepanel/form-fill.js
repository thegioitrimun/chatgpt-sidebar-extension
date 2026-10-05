document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let windowId;
  let scan = null;
  let job = null;
  let rendered = '';
  let busy = false;
  let rows = [];
  const frame = $('chatgpt-frame');
  const acknowledgements = new Map();
  const launching = new Set();
  const relaying = new Set();
  let recoveryUntil = Date.now() + 600000;
  const sleep = duration => new Promise(resolve => setTimeout(resolve, duration));
  const send = async message => {
    const result = await chrome.runtime.sendMessage({ ...message, windowId });
    if (!result?.success) throw new Error(result?.error || 'Không thực hiện được thao tác.');
    return result;
  };
  const setStatus = text => { $('form-status').textContent = text; };
  function controls() {
    const running = ['connecting', 'running', 'filling'].includes(job?.status);
    $('btn-analyze-form').disabled = busy || running || !scan?.fields.length || !$('form-source').value.trim();
    $('btn-scan-forms').disabled = busy || running || !Number.isInteger(windowId);
    $('form-source').disabled = running;
    $('form-instructions').disabled = running;
    $('form-auto-fill').disabled = running || busy;
    $('form-overwrite').disabled = running || busy;
    $('form-mode-exact').disabled = running || busy;
    $('form-mode-complete').disabled = running || busy;
    $('btn-open-form-ai').classList.toggle('hidden', !job || job.status === 'cancelled');
    $('btn-read-form-ai').classList.toggle('hidden', !job || !['connecting', 'running', 'needs_login', 'error'].includes(job.status));
    $('btn-retry-form-ai').classList.toggle('hidden', !['needs_login', 'error'].includes(job?.status) || !job?.prompt);
    $('btn-cancel-form-ai').disabled = job?.status === 'filling';
    $('btn-cancel-form-ai').classList.toggle('hidden', !running && job?.status !== 'needs_login');
    $('btn-apply-form').disabled = busy || !rows.some(row => row.check.checked && row.input.value.trim());
    window.sidebarFormAnalysisRunning = running;
  }
  function showTarget() {
    $('form-target').textContent = scan ? `${scan.fields.length} ô nhập • ${scan.title || scan.url}` : 'Mở trang có form cần điền, rồi bấm quét.';
    $('form-target').title = scan?.url || '';
  }
  function modeHint() {
    const complete = $('form-mode-complete').checked;
    $('form-mode-hint').textContent = complete ? 'Nhập vài thông tin chính. AI sẽ suy luận và tạo nội dung mẫu, rồi điền thẳng vào các ô, kể cả số/ngày. Căn cứ và nguồn được hiển thị trong kết quả bên dưới.' : 'Chỉ dùng dữ kiện bạn nhập. Các phần thiếu thông tin sẽ để trống.';
    $('form-source').placeholder = complete ? 'Ví dụ: Sản phẩm là bình giữ nhiệt 500 ml, màu xanh, giá 250.000 đồng. Hãy hoàn thiện các phần mô tả còn thiếu…' : 'Nhập hoặc dán thông tin bạn muốn dùng để điền form…';
  }
  function renderProposals() {
    const signature = `${job.id}:${JSON.stringify(job.proposals)}`;
    if (signature === rendered) return;
    rendered = signature;
    rows = [];
    $('form-proposals').replaceChildren();
    const proposed = new Map((job.proposals || []).map(item => [item.id, item]));
    for (const field of job.scan.fields) {
      const proposal = proposed.get(field.id);
      const container = document.createElement('div'); container.className = 'form-proposal';
      const label = document.createElement('label'); label.className = 'form-check';
      const check = document.createElement('input'); check.type = 'checkbox';
      const title = document.createElement('span'); title.textContent = `${field.label}${field.section ? ` · ${field.section}` : ''}`;
      label.append(check, title);
      const input = document.createElement('textarea'); input.className = 'form-value';
      input.value = job.mode === 'complete' && proposal?.kind !== 'source' ? (proposal?.value || '').replace(/^\s*AI (?:đề xuất\s*[—–-]\s*cần xác nhận|tra cứu\s*[—–-]\s*cần kiểm tra nguồn)\s*:\s*/i, '') : proposal?.value || '';
      input.setAttribute('aria-label', `Giá trị: ${field.label}`);
      input.placeholder = 'Nguồn chưa đủ thông tin — để trống hoặc nhập giá trị bạn xác nhận.';
      const evidence = document.createElement('p'); evidence.className = 'form-evidence';
      const kindLabels = { inferred: 'AI suy luận', sample: 'Nội dung mẫu', research: 'AI tra cứu — cần kiểm tra nguồn' };
      evidence.textContent = proposal?.supported ? (proposal.kind && proposal.kind !== 'source' ? `${kindLabels[proposal.kind]}: ${proposal.reason}${proposal.warning ? ` ${proposal.warning}` : ''}` : `Dữ liệu nguồn: “${proposal.evidence}”`) : (proposal?.warning || proposal?.reason || 'Chưa có dữ kiện xác nhận trong nguồn.');
      if (!proposal?.supported || (proposal.kind && proposal.kind !== 'source')) evidence.classList.add('form-warning');
      container.append(label, input, evidence);
      if (proposal?.kind === 'research' && proposal.sources?.length) {
        const links = document.createElement('div'); links.className = 'form-sources';
        for (const source of proposal.sources) {
          const link = document.createElement('a'); link.href = source.url; link.textContent = source.title || source.url;
          link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
        }
        container.append(links);
      }
      if (field.currentValue.trim()) {
        const existing = document.createElement('p'); existing.className = 'form-muted';
        existing.textContent = `Ô hiện có: ${field.currentValue.slice(0, 300)}`; container.append(existing);
      }
      const row = { field, input, check };
      check.disabled = !!field.currentValue.trim() && !$('form-overwrite').checked;
      check.checked = !!input.value.trim() && !check.disabled;
      input.addEventListener('input', () => { check.checked = !!input.value.trim() && !check.disabled; controls(); });
      check.addEventListener('change', controls);
      rows.push(row); $('form-proposals').append(container);
    }
  }
  function renderJob(value) {
    const previous = job;
    job = value;
    window.sidebarFormConversationUrl = job?.surface === 'sidebar' && ['connecting', 'running', 'needs_login', 'error'].includes(job.status) ? job.conversationUrl : undefined;
    if (job && previous?.id !== job.id) {
      recoveryUntil = Date.now() + 600000;
      $(job.mode === 'complete' ? 'form-mode-complete' : 'form-mode-exact').checked = true;
      modeHint();
    }
    if (job && job.status !== 'cancelled') { scan = job.scan; showTarget(); }
    const states = {
      connecting: 'Đang kết nối ChatGPT ngay trong sidebar…',
      running: job?.mode === 'complete' ? 'ChatGPT đang tìm hiểu và hoàn thiện các phần còn thiếu…' : 'ChatGPT đang đối chiếu nội dung với các ô nhập…',
      needs_login: job?.error,
      error: job?.error,
      filling: 'AI đã trả kết quả. Đang tự điền vào form…',
      review: job?.autoFillError || 'Đã có đề xuất. Bạn có thể kiểm tra và điền các ô đã chọn.',
      applied: job?.lastFill ? fillSummary(job.lastFill) : 'Đã thực hiện điền. Xem kết quả trên trang form.',
      cancelled: 'Đã hủy phiên phân tích và xóa nội dung nguồn của phiên khỏi bộ nhớ extension.'
    };
    if (job) setStatus(states[job.status] || '');
    const review = job && ['review', 'applied'].includes(job.status);
    $('form-review').classList.toggle('hidden', !review);
    if (review) renderProposals();
    if (job?.lastFill && job.status === 'applied') $('btn-undo-form').disabled = job.lastFill.count === 0;
    $('form-ai-banner').classList.toggle('hidden', !job || job.status === 'cancelled');
    $('form-ai-banner-status').textContent = job ? (states[job.status] || '') : '';
    if (job?.status === 'cancelled' && previous?.id === job.id) cancelFrame(previous);
    if (previous && job && previous.id === job.id && ['connecting', 'running', 'filling', 'needs_login', 'error'].includes(previous.status) && ['review', 'applied', 'error', 'needs_login'].includes(job.status)) {
      $('form-fill-panel').classList.remove('hidden');
      $('form-status').scrollIntoView({ block: 'start' });
    }
    controls();
    if (job && ['review', 'filling', 'applied', 'cancelled'].includes(job.status)) {
      frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_RESULT_ACK', jobId: job.id, bridgeToken: job.bridgeToken, success: true }, 'https://chatgpt.com');
    }
  }
  function cancelFrame(value) {
    if (value?.bridgeToken) frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_CANCEL', jobId: value.id, bridgeToken: value.bridgeToken }, 'https://chatgpt.com');
  }
  function requestAnalysis(value) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { acknowledgements.delete(value.id); resolve(false); }, 900);
      acknowledgements.set(value.id, success => { clearTimeout(timer); acknowledgements.delete(value.id); resolve(success); });
      frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_START', jobId: value.id, bridgeToken: value.bridgeToken, prompt: value.prompt, mode: value.mode, fieldIds: value.scan.fields.map(field => field.id) }, 'https://chatgpt.com');
    });
  }
  function readExistingReply() {
    if (!job?.bridgeToken || job.surface !== 'sidebar' || !['connecting', 'running', 'needs_login', 'error'].includes(job.status)) return;
    frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_READ', jobId: job.id, bridgeToken: job.bridgeToken, mode: job.mode, fieldIds: job.scan.fields.map(field => field.id) }, 'https://chatgpt.com');
  }
  async function beginAnalysis(value) {
    if (launching.has(value.id)) return;
    launching.add(value.id);
    $('form-fill-panel').classList.add('hidden');
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && job?.id === value.id && job.status === 'connecting') {
        if (await requestAnalysis(value)) return;
        await sleep(350);
      }
      if (job?.id === value.id && job.status === 'connecting') {
        await send({ type: 'FORM_AI_UNAVAILABLE', jobId: value.id, bridgeToken: value.bridgeToken });
      }
    } catch (error) { setStatus(error.message); $('form-fill-panel').classList.remove('hidden'); }
    finally { launching.delete(value.id); }
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== 'https://chatgpt.com' || !job || event.data?.jobId !== job.id || event.data.bridgeToken !== job.bridgeToken) return;
    const message = event.data;
    if (message.type === 'SIDEBAR_FORM_AI_ACK') {
      acknowledgements.get(job.id)?.(message.success === true);
    } else if (message.type === 'SIDEBAR_FORM_AI_EVENT' && ['FORM_AI_PROGRESS', 'FORM_AI_LOCATION', 'FORM_AI_RESULT'].includes(message.eventType)) {
      const value = job;
      if (message.eventType === 'FORM_AI_RESULT' && ['review', 'filling', 'applied', 'cancelled'].includes(value.status)) {
        frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_RESULT_ACK', jobId: value.id, bridgeToken: value.bridgeToken, success: true }, 'https://chatgpt.com');
        return;
      }
      if (relaying.has(value.id)) return;
      relaying.add(value.id);
      send({ type: message.eventType, jobId: value.id, bridgeToken: value.bridgeToken, text: message.text, error: message.error, conversationUrl: message.conversationUrl }).then(() => {
        if (message.eventType === 'FORM_AI_RESULT' && !message.error) frame.contentWindow.postMessage({ type: 'SIDEBAR_FORM_AI_RESULT_ACK', jobId: value.id, bridgeToken: value.bridgeToken, success: true }, 'https://chatgpt.com');
      }).catch(error => {
        if (message.eventType === 'FORM_AI_RESULT' && job?.id === value.id && !['review', 'filling', 'applied', 'cancelled'].includes(job.status)) setStatus(`Đang thử nhận lại kết quả AI: ${error.message}`);
      }).finally(() => relaying.delete(value.id));
    }
  });
  frame.addEventListener('load', () => {
    readExistingReply();
  });
  async function action(callback) {
    if (busy) return;
    busy = true; controls();
    try { await callback(); }
    catch (error) { setStatus(error.message); }
    finally { busy = false; controls(); }
  }
  $('btn-form-fill').addEventListener('click', () => $('form-fill-panel').classList.remove('hidden'));
  $('btn-close-form').addEventListener('click', () => $('form-fill-panel').classList.add('hidden'));
  $('form-source').addEventListener('input', controls);
  $('form-mode-exact').addEventListener('change', modeHint);
  $('form-mode-complete').addEventListener('change', modeHint);
  $('btn-scan-forms').addEventListener('click', () => action(async () => {
    const response = await send({ type: 'SCAN_FORMS' });
    scan = response.scan; job = null; rendered = ''; rows = [];
    $('form-review').classList.add('hidden'); $('btn-undo-form').disabled = true;
    showTarget(); setStatus(scan.fields.length ? `Tìm thấy ${scan.fields.length} ô. Nhập nội dung rồi bấm phân tích.` : 'Không tìm thấy ô nhập văn bản đang hiển thị. Mở phần form hoặc chuyển trang rồi quét lại.');
  }));
  $('btn-analyze-form').addEventListener('click', () => action(async () => {
    $('btn-undo-form').disabled = true;
    const response = await send({ type: 'START_FORM_AI', record: $('form-source').value, instructions: $('form-instructions').value, mode: $('form-mode-complete').checked ? 'complete' : 'exact', autoFill: $('form-auto-fill').checked, overwrite: $('form-overwrite').checked });
    renderJob(response.job);
    beginAnalysis(response.job);
  }));
  $('btn-open-form-ai').addEventListener('click', () => $('form-fill-panel').classList.add('hidden'));
  $('btn-read-form-ai').addEventListener('click', () => {
    recoveryUntil = Date.now() + 600000;
    readExistingReply(); setStatus('Đang đọc lại câu trả lời trong sidebar để tự điền form…');
  });
  $('btn-return-form').addEventListener('click', () => $('form-fill-panel').classList.remove('hidden'));
  $('btn-retry-form-ai').addEventListener('click', () => action(async () => {
    const response = await send({ type: 'RETRY_FORM_AI' });
    renderJob(response.job); beginAnalysis(response.job);
  }));
  $('btn-cancel-form-ai').addEventListener('click', () => action(() => send({ type: 'CANCEL_FORM_AI' })));
  $('form-overwrite').addEventListener('change', () => {
    for (const row of rows) if (row.field.currentValue.trim()) {
      row.check.disabled = !$('form-overwrite').checked;
      row.check.checked = !row.check.disabled && !!row.input.value.trim();
    }
    controls();
  });
  function fillSummary(fill) {
    const errors = fill.results.filter(item => !item.success).map(item => item.error);
    const text = fill.automatic ? (fill.count ? `Đã tự điền ${fill.count} ô vào form.` : 'Chưa điền ô nào: không có ô trống với dữ liệu đủ căn cứ hoặc ô không nhận được giá trị.') : `Đã điền ${fill.count} ô.`;
    const missing = job?.scan.fields.filter(field => !job.proposals?.some(item => item.id === field.id && item.value.trim())).length || 0;
    return `${text}${missing ? ` ${missing} ô chưa đủ thông tin.` : ''}${errors.length ? ` ${errors.length} ô chưa điền: ${[...new Set(errors)].join(' ')}` : ''}`;
  }
  function showResults(results, verb) {
    const count = results.filter(item => item.success).length;
    const errors = results.filter(item => !item.success).map(item => item.error);
    setStatus(`${verb} ${count} ô.${errors.length ? ` ${errors.length} ô chưa thực hiện: ${[...new Set(errors)].join(' ')}` : ''}`);
    return count;
  }
  $('btn-apply-form').addEventListener('click', () => action(async () => {
    const values = rows.filter(row => row.check.checked && row.input.value.trim()).map(row => ({ id: row.field.id, value: row.input.value }));
    if (!values.length) throw new Error('Chọn ít nhất một ô có giá trị để điền.');
    const result = await send({ type: 'APPLY_FORM_VALUES', scanId: scan.id, values, overwrite: $('form-overwrite').checked });
    if (showResults(result.results, 'Đã điền')) $('btn-undo-form').disabled = false;
  }));
  $('btn-undo-form').addEventListener('click', () => action(async () => {
    const result = await send({ type: 'UNDO_FORM_VALUES', scanId: scan.id });
    showResults(result.results, 'Đã hoàn tác'); $('btn-undo-form').disabled = true;
  }));
  try {
    windowId = (await chrome.windows.getCurrent()).id;
    const stored = await chrome.storage.session.get([`formJob:${windowId}`, `formScan:${windowId}`]);
    scan = stored[`formScan:${windowId}`] || null; showTarget();
    renderJob(stored[`formJob:${windowId}`] || null);
    if (job && ['connecting', 'running', 'needs_login', 'error'].includes(job.status)) {
      if (job.surface === 'sidebar') {
        const ready = await send({ type: 'PREPARE_CHATGPT_FRAME' });
        if (!ready?.success) throw new Error(ready?.error || 'Không chuẩn bị được sidebar.');
        if (job.conversationUrl) frame.src = job.conversationUrl;
        readExistingReply();
      } else await send({ type: 'CANCEL_FORM_AI' });
    }
    if (job?.status === 'applied') $('btn-undo-form').disabled = job.lastFill ? !job.lastFill.count : false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes[`formJob:${windowId}`]) renderJob(changes[`formJob:${windowId}`].newValue || null);
    });
    setInterval(() => { if (Date.now() < recoveryUntil) readExistingReply(); }, 1500);
  } catch (error) { setStatus(error.message); }
});
