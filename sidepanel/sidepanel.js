const CHATGPT_URL = 'https://chatgpt.com/';

document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const frame = $('chatgpt-frame');
  let windowId;
  let lastPrompt = '';
  let lastPromptAutoSend = false;
  let pending = null;
  let busy = false;
  let loadTimer;
  let toastTimer;
  let frameLoadId = 0;
  let chatReady = false;
  let autoAnalyzeEnabled = false;
  let quizMode = null;
  let quizStateSequence = 0;
  let activeTab = null;
  let tabInfoSequence = 0;
  let pageRevision = 0;
  let handledRevision = -1;
  let automaticJob = null;
  let automaticTimer;
  let automaticRunning = false;
  let automaticRequestId = null;
  let lastAutomaticPage = '';
  const requests = new Map();
  const handledPrompts = new Set();
  const status = document.querySelector('.status-text');
  const insertButton = $('btn-insert-page');
  const analyzeButton = $('btn-analyze-page');
  const send = (message) => chrome.runtime.sendMessage({ ...message, windowId });

  function autoStatus(text) {
    $('auto-analysis-status').textContent = text;
    $('auto-analysis-status').classList.toggle('hidden', !autoAnalyzeEnabled);
  }

  function cancelAutomaticRequest(frameReload = false) {
    if (!automaticRequestId) return;
    const id = automaticRequestId;
    automaticRequestId = null;
    frame.contentWindow.postMessage({ type: 'SIDEBAR_CANCEL_PAGE_CONTEXT', id }, 'https://chatgpt.com');
    // Wait for the frame to confirm cancellation: it may already have clicked Send.
    if (frameReload) requests.get(id)?.({ success: false, cancelled: true, uncertain: true });
  }

  function invalidateAutomaticPage() {
    pageRevision++;
    automaticJob = null;
    clearTimeout(automaticTimer);
    automaticTimer = null;
    cancelAutomaticRequest();
  }

  const currentAutomaticJob = job => autoAnalyzeEnabled && !(quizMode?.enabled && quizMode.tabId === job.tabId) && automaticJob === job && job.revision === pageRevision;

  function scheduleAutomaticAnalysis(delay = 800) {
    if (automaticTimer && delay > 0) return;
    clearTimeout(automaticTimer);
    automaticTimer = null;
    if (!autoAnalyzeEnabled || !activeTab) return;
    if (quizMode?.enabled && quizMode.tabId === activeTab.id) {
      autoStatus('Đáp án tự động đang xử lý tab này ở nền.');
      return;
    }
    let url;
    try { url = new URL(activeTab.url); } catch { /* Browser pages have no readable URL. */ }
    if (!url || !/^https?:$/.test(url.protocol) || ['chatgpt.com', 'chat.openai.com', 'auth.openai.com', 'chromewebstore.google.com'].includes(url.hostname) || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) {
      automaticJob = null;
      autoStatus('Tự động phân tích: chờ một trang web có nội dung.');
      return;
    }
    if (activeTab.status === 'loading') {
      autoStatus('Tự động phân tích: đang chờ trang tải xong…');
      return;
    }
    if (handledRevision === pageRevision) return;
    automaticJob ||= { revision: pageRevision, tabId: activeTab.id, url: activeTab.url };
    automaticTimer = setTimeout(runAutomaticAnalysis, delay);
  }

  function requestChatState() {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { requests.delete(id); resolve({ ready: false }); }, 2000);
      requests.set(id, result => { clearTimeout(timer); requests.delete(id); resolve(result); });
      frame.contentWindow.postMessage({ type: 'SIDEBAR_GET_CHAT_STATE', id }, 'https://chatgpt.com');
    });
  }

  async function runAutomaticAnalysis() {
    automaticTimer = null;
    if (automaticRunning || !automaticJob) return;
    const job = automaticJob;
    automaticRunning = true;
    try {
      if (!currentAutomaticJob(job)) return;
      const documentSource = await window.sidebarDocumentLibrary?.hasActive();
      if ((!documentSource && !chatReady) || busy || window.sidebarFormAnalysisRunning) {
        autoStatus('Tự động phân tích: đang chờ ChatGPT sẵn sàng…');
        return;
      }
      const state = documentSource ? { ready: true } : await requestChatState();
      if (!currentAutomaticJob(job)) return;
      if (!state.ready || state.busy || state.hasDraft) {
        autoStatus(state.hasDraft ? 'Tự động phân tích: đang chờ ô chat trống.' : 'Tự động phân tích: đang chờ ChatGPT sẵn sàng…');
        return;
      }
      autoStatus('Đang tự động đọc và phân tích trang…');
      const result = await insertPage(false, true, job);
      if (!currentAutomaticJob(job) || result?.retry) return;
      handledRevision = job.revision;
      automaticJob = null;
      autoStatus(result?.success ? 'Đã tự gửi trang để phân tích. Chờ trang tiếp theo.' : result?.skipped ? 'Trang này đã được xử lý. Chờ trang tiếp theo.' : `Tự động phân tích tạm dừng: ${result?.error || 'kiểm tra ChatGPT rồi bấm Phân tích ngay.'}`);
    } catch (error) {
      if (currentAutomaticJob(job)) {
        handledRevision = job.revision;
        automaticJob = null;
        autoStatus(`Tự động phân tích tạm dừng: ${error.message}`);
      }
    } finally {
      automaticRunning = false;
      if (autoAnalyzeEnabled && automaticJob) scheduleAutomaticAnalysis(1500);
    }
  }

  function applyAutomaticSetting(enabled) {
    autoAnalyzeEnabled = enabled === true;
    $('setting-auto-analyze').checked = autoAnalyzeEnabled;
    invalidateAutomaticPage();
    autoStatus('Tự động phân tích đang bật.');
    if (autoAnalyzeEnabled) scheduleAutomaticAnalysis();
  }

  function toast(text) {
    clearTimeout(toastTimer);
    $('toast').textContent = text;
    $('toast').classList.remove('hidden');
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
  }

  function stopLoading() {
    clearTimeout(loadTimer);
    $('progress-bar').classList.add('hidden');
    $('reload-icon').classList.remove('spinning');
  }

  function showFallback() {
    chatReady = false;
    stopLoading();
    status.textContent = 'Mở tab';
    $('error-overlay').classList.remove('hidden');
  }

  async function reloadFrame() {
    const loadId = ++frameLoadId;
    chatReady = false;
    cancelAutomaticRequest(true);
    status.textContent = 'Đang tải';
    $('error-overlay').classList.add('hidden');
    $('progress-bar').classList.remove('hidden');
    $('reload-icon').classList.add('spinning');
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      stopLoading();
      if (status.textContent === 'Đang tải') status.textContent = 'ChatGPT';
    }, 25000);
    try {
      const response = await send({ type: 'PREPARE_CHATGPT_FRAME' });
      if (loadId !== frameLoadId) return;
      if (!response?.success) throw new Error(response?.error || 'Không chuẩn bị được sidebar.');
      frame.src = window.sidebarFormConversationUrl || CHATGPT_URL;
    } catch (error) {
      if (loadId !== frameLoadId) return;
      stopLoading();
      toast(error.message);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function inject(text, autoSend = false, automatic = false) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        requests.delete(id);
        resolve({ success: false, error: autoSend ? 'Chưa xác nhận được yêu cầu phân tích. Kiểm tra ChatGPT trước khi bấm lại để tránh gửi trùng.' : '' });
      }, autoSend ? 10000 : 3500);
      requests.set(id, (result) => { clearTimeout(timer); requests.delete(id); resolve(result); });
      if (automatic) automaticRequestId = id;
      frame.contentWindow.postMessage({ type: 'SIDEBAR_INJECT_PAGE_CONTEXT', id, text, autoSend, automatic }, 'https://chatgpt.com');
    });
  }

  async function acknowledgePrompt(text) {
    if (!pending || pending.text !== text) return;
    const delivered = pending;
    pending = null;
    await send({ type: 'ACK_PENDING_PROMPT', id: delivered.id }).catch(() => {});
  }

  async function deliver(text, autoSend = false, automatic = false) {
    if (window.sidebarFormAnalysisRunning) {
      const error = 'AI đang phân tích form. Chờ xong hoặc hủy trước khi đưa nội dung khác vào chat.';
      if (!automatic) toast(error);
      return { success: false, retry: automatic, error };
    }
    lastPrompt = text;
    lastPromptAutoSend = autoSend;
    $('prompt-preview').value = text;
    const [copied, result] = await Promise.all([automatic ? false : copy(text), inject(text, autoSend, automatic)]);
    if (automatic) automaticRequestId = null;
    const inserted = result.success === true;
    if (lastPrompt !== text || automatic) return result;
    if (inserted) {
      toast(result.sent ? 'Đã gửi nội dung trang. ChatGPT đang phân tích.' : 'Đã điền vào ô chat. Bạn có thể sửa nội dung rồi bấm gửi.');
      await acknowledgePrompt(text);
    } else if (autoSend) {
      toast(result.error || 'Chưa gửi được yêu cầu. Mở ChatGPT trong sidebar, kiểm tra ô chat rồi bấm Phân tích ngay lần nữa.');
    } else {
      toast(copied ? 'Đã sao chép nội dung! Bạn chỉ cần nhấn Cmd+V (hoặc Ctrl+V) vào ô chat để dán.' : 'Vui lòng sao chép nội dung rồi dán vào ô chat.');
    }
    return result;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== 'https://chatgpt.com') return;
    if (event.data?.type === 'SIDEBAR_CHAT_READY') {
      chatReady = true;
      stopLoading();
      status.textContent = 'Sẵn sàng';
      $('error-overlay').classList.add('hidden');
      // An automatic send belongs to its click only; readiness/reloads must not replay it.
      if (lastPrompt && !lastPromptAutoSend) deliver(lastPrompt).catch((error) => toast(error.message));
      if (automaticJob) scheduleAutomaticAnalysis(0);
    } else if (['SIDEBAR_INJECT_RESULT', 'SIDEBAR_CHAT_STATE'].includes(event.data?.type)) {
      requests.get(event.data.id)?.(event.data);
    }
  });
  frame.addEventListener('error', showFallback);

  async function openTab() {
    const button = $('btn-error-open');
    const text = lastPrompt;
    button.disabled = true;
    try {
      const response = await send({ type: 'OPEN_CHATGPT_TAB', text });
      if (response?.success) {
        toast(text ? 'Đã điền nội dung vào tab ChatGPT.' : 'Đã mở tab ChatGPT.');
        if (text) await acknowledgePrompt(text);
      } else toast(response?.error || 'Không mở được ChatGPT.');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  async function updateActiveTabInfo() {
    const sequence = ++tabInfoSequence;
    try {
      const response = await send({ type: 'GET_ACTIVE_TAB_INFO' });
      if (sequence !== tabInfoSequence) return;
      const tab = response?.tab;
      if (tab?.id !== activeTab?.id || tab?.url !== activeTab?.url) invalidateAutomaticPage();
      activeTab = tab || null;
      $('active-page-title').textContent = tab?.title || tab?.url || 'Không có trang web đang mở';
      $('active-page-title').title = tab?.url || '';
      $('active-page-icon').textContent = '🌐';
      if (/^https?:\/\//.test(tab?.favIconUrl || '')) {
        const image = document.createElement('img');
        image.src = tab.favIconUrl;
        image.alt = '';
        image.addEventListener('error', () => { $('active-page-icon').textContent = '🌐'; });
        $('active-page-icon').replaceChildren(image);
      }
      scheduleAutomaticAnalysis();
    } catch (error) { toast(error.message); }
  }

  async function insertPage(summarize = false, autoSend = false, automatic = null) {
    if (busy) return { success: false, retry: true };
    if (window.sidebarFormAnalysisRunning) {
      if (!automatic) toast('AI đang phân tích form. Chờ xong hoặc hủy trước khi đưa nội dung khác vào chat.');
      return { success: false, retry: true };
    }
    if (!automatic) {
      handledRevision = pageRevision;
      automaticJob = null;
      clearTimeout(automaticTimer);
      automaticTimer = null;
    }
    busy = true;
    const button = autoSend ? analyzeButton : insertButton;
    const originalButton = button.innerHTML;
    insertButton.disabled = true;
    analyzeButton.disabled = true;
    button.classList.add('loading');
    button.textContent = 'Đang đọc…';
    let automaticPageKey;
    try {
      const response = await send({ type: 'GET_ACTIVE_PAGE_CONTENT', ...(automatic ? { tabId: automatic.tabId, pageUrl: automatic.url } : {}) });
      if (automatic && !currentAutomaticJob(automatic)) return { success: false, cancelled: true };
      if (!response?.success) throw new Error(response?.error || 'Không đọc được trang.');
      if (automatic) {
        const current = await send({ type: 'GET_ACTIVE_TAB_INFO' });
        if (!currentAutomaticJob(automatic)) return { success: false, cancelled: true };
        if (current.tab?.id !== automatic.tabId || current.tab?.url !== automatic.url || current.tab?.status === 'loading') {
          await updateActiveTabInfo();
          return { success: false, cancelled: true };
        }
        automaticPageKey = JSON.stringify([automatic.tabId, response.page?.documentId || automatic.revision, automatic.url]);
        if (lastAutomaticPage === automaticPageKey) return { success: false, skipped: true };
        // Record attempts before dispatch: an uncertain send must never be replayed on reopening.
        await chrome.storage.session.set({ [`lastAutomaticPage:${windowId}`]: automaticPageKey });
        lastAutomaticPage = automaticPageKey;
        if (!currentAutomaticJob(automatic)) {
          lastAutomaticPage = '';
          await chrome.storage.session.remove(`lastAutomaticPage:${windowId}`);
          return { success: false, cancelled: true };
        }
      }
      const { title, url, selectedText, content, isTruncated } = response.data;
      const prompt = selectedText
        ? [
            summarize ? 'Hãy tóm tắt và giải thích nội dung được chọn sau bằng Tiếng Việt:' : 'Hãy trả lời và giải thích chi tiết nội dung sau:',
            `Nội dung:\n${selectedText}`,
            `Nguồn: ${title} (${url})`
          ].join('\n\n')
        : [
            summarize ? 'Hãy tóm tắt ngắn gọn các ý chính của trang web sau bằng Tiếng Việt:' : 'Hãy phân tích các ý chính và thông tin hữu ích của trang web sau:',
            `Tiêu đề: ${title}`, `URL: ${url}`,
            `Nội dung trang:\n${content || selectedText}`,
            isTruncated ? '(Nội dung được giới hạn ở 12.000 ký tự đầu.)' : ''
          ].filter(Boolean).join('\n\n');
      if (autoSend) button.textContent = 'Đang gửi…';
      const documentResult = autoSend && await window.sidebarDocumentLibrary?.analyze(prompt, !!automatic);
      const result = documentResult || await deliver(prompt, autoSend, !!automatic);
      if (automatic && result.cancelled && !result.uncertain && lastAutomaticPage === automaticPageKey) {
        lastAutomaticPage = '';
        await chrome.storage.session.remove(`lastAutomaticPage:${windowId}`);
      }
      $('prompts-drawer').classList.add('hidden');
      return result;
    } catch (error) {
      if (!automatic) toast(error.message);
      return { success: false, error: error.message };
    }
    finally {
      busy = false;
      insertButton.disabled = false;
      analyzeButton.disabled = false;
      button.classList.remove('loading');
      button.innerHTML = originalButton;
    }
  }

  async function receivePending(item) {
    if (!item?.id || !item.text || handledPrompts.has(item.id)) return;
    handledPrompts.add(item.id);
    pending = item;
    await deliver(item.text);
  }

  $('btn-insert-page').addEventListener('click', () => insertPage());
  $('btn-analyze-page').addEventListener('click', () => insertPage(false, true));
  $('btn-summarize-page').addEventListener('click', () => insertPage(true));
  $('btn-settings').addEventListener('click', () => $('settings-modal').showModal());
  $('btn-close-sidebar').addEventListener('click', async () => {
    const result = await send({ type: 'CLOSE_SIDEBAR' }).catch(error => ({ error: error.message }));
    if (!result?.success) toast(result?.error || 'Dùng nút X ở thanh tiêu đề trình duyệt để đóng sidebar.');
  });
  function applyQuizState(next) {
    quizStateSequence++;
    const changedSource = quizMode?.enabled !== next?.enabled || quizMode?.tabId !== next?.tabId;
    quizMode = next;
    $('setting-quiz-mode').checked = next?.enabled === true;
    $('quiz-mode-status').textContent = next?.enabled ? next.status || 'Đang chờ câu hỏi…' : 'Đáp án tự động đang tắt.';
    $('quiz-mode-actions').hidden = !next?.enabled;
    $('btn-quiz-retry').hidden = !next?.error;
    $('btn-quiz-retry').textContent = next?.retryLabel || 'Thử lại câu thiếu';
    if (changedSource) { invalidateAutomaticPage(); scheduleAutomaticAnalysis(); }
  }
  async function refreshQuizState() {
    const sequence = ++quizStateSequence;
    const result = await send({ type: 'QUIZ_GET_STATE' });
    if (result?.success && sequence === quizStateSequence) applyQuizState(result.state);
  }
  for (const [id, type] of [['btn-quiz-open-chat', 'QUIZ_OPEN_CHAT'], ['btn-quiz-retry', 'QUIZ_RETRY']]) {
    $(id).addEventListener('click', async () => {
      const button = $(id); button.disabled = true;
      try {
        const result = await send({ type });
        if (!result?.success) throw new Error(result?.error || 'Chế độ đáp án đã dừng. Bật lại để tiếp tục.');
        await refreshQuizState();
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }
  function applyReference(reference) {
    $('reference-status').textContent = reference?.enabled ? `Đang dùng: ${reference.name || 'Tài liệu đã chọn'}. Thay bộ áp dụng từ lần bật đáp án tiếp theo.` : 'Chưa chọn bộ tài liệu. Phân tích dùng kiến thức ChatGPT.';
  }
  $('setting-quiz-mode').addEventListener('change', async () => {
    const input = $('setting-quiz-mode'); input.disabled = true;
    try {
      const result = await send({ type: 'QUIZ_SET_MODE', enabled: input.checked });
      if (!result?.success) throw new Error(result?.error || 'Chưa bật được chế độ đáp án.');
      applyQuizState(result.state);
    } catch (error) { input.checked = quizMode?.enabled === true; toast(error.message); }
    finally { input.disabled = false; }
  });
  for (const id of ['btn-close-settings', 'btn-done-settings']) $(id).addEventListener('click', () => $('settings-modal').close());
  $('setting-auto-analyze').addEventListener('change', async () => {
    const previous = autoAnalyzeEnabled;
    const enabled = $('setting-auto-analyze').checked;
    $('setting-auto-analyze').disabled = true;
    applyAutomaticSetting(enabled);
    try { await chrome.storage.local.set({ autoAnalyzeOnNavigation: enabled }); }
    catch (error) { applyAutomaticSetting(previous); toast(`Không lưu được cài đặt: ${error.message}`); }
    finally { $('setting-auto-analyze').disabled = false; }
  });
  for (const id of ['btn-reload', 'btn-home', 'btn-banner-reload', 'btn-error-retry']) $(id).addEventListener('click', reloadFrame);
  for (const id of ['btn-open-tab', 'btn-banner-login', 'btn-modal-open-login', 'btn-error-open']) $(id).addEventListener('click', openTab);
  $('btn-close-error')?.addEventListener('click', () => {
    $('error-overlay').classList.add('hidden');
    if (status.textContent === 'Mở tab') status.textContent = 'ChatGPT';
  });
  $('btn-copy-prompt').addEventListener('click', async () => {
    const text = $('prompt-preview').value;
    if (!text) return toast('Hãy chọn nội dung trang hoặc một mẫu lệnh trước.');
    if (await copy(text)) toast('Đã sao chép. Dán vào ChatGPT bằng Cmd+V hoặc Ctrl+V.');
    else { $('prompt-preview').focus(); $('prompt-preview').select(); toast('Nhấn Cmd+C hoặc Ctrl+C để sao chép nội dung đã chọn.'); }
  });
  $('prompt-preview').addEventListener('input', () => { lastPrompt = $('prompt-preview').value; lastPromptAutoSend = false; });
  $('btn-banner-close').addEventListener('click', () => {
    $('login-banner').classList.add('hidden');
    chrome.storage.local.set({ hideLoginBanner: true }).catch(() => {});
  });
  $('btn-prompts').addEventListener('click', () => $('prompts-drawer').classList.toggle('hidden'));
  $('btn-close-drawer').addEventListener('click', () => $('prompts-drawer').classList.add('hidden'));
  $('btn-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  for (const id of ['btn-close-modal', 'btn-modal-done']) $(id).addEventListener('click', () => $('help-modal').classList.add('hidden'));
  $('btn-modal-reload').addEventListener('click', () => { $('help-modal').classList.add('hidden'); reloadFrame(); });
  $('help-modal').addEventListener('click', (event) => { if (event.target === $('help-modal')) $('help-modal').classList.add('hidden'); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('help-modal').classList.add('hidden');
      $('error-overlay').classList.add('hidden');
    }
  });
  document.querySelectorAll('.quick-template').forEach((button) => {
    button.addEventListener('click', () => {
      $('prompts-drawer').classList.add('hidden');
      deliver(button.dataset.template.replace(/\\n/g, '\n')).catch((error) => toast(error.message));
    });
  });

  try {
    windowId = (await chrome.windows.getCurrent()).id;
    chrome.tabs.onActivated.addListener((info) => {
      if (info.windowId !== windowId) return;
      invalidateAutomaticPage();
      activeTab = null;
      updateActiveTabInfo();
    });
    chrome.tabs.onUpdated.addListener((id, info, tab) => {
      if (!tab.active || tab.windowId !== windowId) return;
      if (info.url || info.status === 'loading') {
        invalidateAutomaticPage();
        activeTab = null;
      }
      if (info.title || info.url || info.status) updateActiveTabInfo();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes[`quizSession:${windowId}`]) {
        refreshQuizState().catch(() => {});
      }
      if (area !== 'local') return;
      if (changes.analysisTick) refreshQuizState().catch(() => {});
      if (changes.documentLibraryTick || changes.documentActiveCollectionId) { send({ type: 'QUIZ_GET_REFERENCE' }).then(result => applyReference(result?.reference)).catch(() => {}); }
      receivePending(changes[`pendingPrompt:${windowId}`]?.newValue).catch((error) => toast(error.message));
      if (changes.autoAnalyzeOnNavigation && (changes.autoAnalyzeOnNavigation.newValue === true) !== autoAnalyzeEnabled) applyAutomaticSetting(changes.autoAnalyzeOnNavigation.newValue);
    });
    const [stored, session] = await Promise.all([
      chrome.storage.local.get(['hideLoginBanner', 'autoAnalyzeOnNavigation', `pendingPrompt:${windowId}`]),
      chrome.storage.session.get(`lastAutomaticPage:${windowId}`)
    ]);
    lastAutomaticPage = session[`lastAutomaticPage:${windowId}`] || '';
    const quiz = await send({ type: 'QUIZ_GET_STATE' });
    applyQuizState(quiz?.state);
    const reference = await send({ type: 'QUIZ_GET_REFERENCE' });
    applyReference(reference?.reference);
    $('quiz-shortcut').textContent = quiz?.shortcut ? `${quiz.shortcut}: bật/tắt trên trang web đang mở. Đóng sidebar vẫn tiếp tục.` : 'Chưa gán phím tắt. Mở brave://extensions/shortcuts và gán Shift + Option + Q cho “Bật/tắt đáp án tự động trên trang web”.';
    applyAutomaticSetting(stored.autoAnalyzeOnNavigation);
    if (stored.hideLoginBanner) $('login-banner').classList.add('hidden');
    updateActiveTabInfo();
    reloadFrame();
    receivePending(stored[`pendingPrompt:${windowId}`]).catch((error) => toast(error.message));
  } catch (error) { showFallback(); toast(error.message); }
});
