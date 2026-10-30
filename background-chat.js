// Shared background-window transport. Never restores focus except on explicit open.
(() => {
const isChat = url => { try { return ['https://chatgpt.com', 'https://chat.openai.com'].includes(new URL(url).origin); } catch { return false; } };
function create(content) {
  // A fullscreen source uses an inactive tab instead: Brave/macOS may activate
  // a new native popup despite focused:false. Never create one in that case.
  return chrome.windows.create({ ...content, type: 'popup', state: 'normal', focused: false, width: 800, height: 600 });
}
async function fullscreenSource(mode) {
  const source = await chrome.windows.get(mode.windowId).catch(() => null);
  if (source?.state === 'fullscreen') return source;
  const focused = chrome.windows.getLastFocused && await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return focused?.state === 'fullscreen' ? focused : null;
}
async function minimize(mode, id) {
  // Brave/macOS can finish creating the native window AFTER create() resolves.
  // Minimizing during that transition briefly activates it. Keep about:blank
  // inactive until it settles; journal the deadline so a worker restart also
  // waits before minimizing or loading ChatGPT.
  const delay = (mode.chatWindowReadyAt || 0) - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  await chrome.windows.update(id, { state: 'minimized' });
  mode.chatWindowReadyAt = 0;
}

async function ensure(mode, save, { matches, version }) {
  // Recover a window journaled just before the worker stopped, without opening
  // another one. Only adopt the single ChatGPT tab in our recorded window.
  if (!mode.chatTabId && mode.chatWindowId) {
    const window = await chrome.windows.get(mode.chatWindowId, { populate: true }).catch(() => null);
    const tab = window?.tabs?.length === 1 ? window.tabs[0] : null;
    const url = tab?.pendingUrl || tab?.url;
    if (tab && ((mode.chatStartUrl && url === 'about:blank') || (isChat(url) && matches(url)))) {
      mode.chatTabId = tab.id;
      await save(mode);
    }
  }
  if (mode.chatTabId) {
    let tab = await chrome.tabs.get(mode.chatTabId).catch(() => null);
    const starting = tab && mode.chatStartUrl && (tab.pendingUrl || tab.url) === 'about:blank';
    if (tab && (starting || isChat(tab.pendingUrl || tab.url))) {
      if (!starting && !matches(tab.pendingUrl || tab.url)) throw new Error('Tab ChatGPT đã rời cuộc chat chứa PDF. Mở lại đúng cuộc chat tài liệu rồi bấm thử lại.');
      const window = await chrome.windows.get(tab.windowId, { populate: true });
      if (mode.chatBackgroundTab || tab.windowId === mode.windowId || window.tabs?.length !== 1 || window.tabs[0].id !== tab.id) {
        if (mode.chatBackgroundTab || await fullscreenSource(mode)) {
          // Keep this durable fallback across retries/restarts, including after
          // exiting fullscreen. Never minimize the window containing the page.
          mode.chatBackgroundTab = true;
          mode.chatWindowId = null;
          mode.chatWindowReadyAt = 0;
          await save(mode);
        } else {
          // Migrate our legacy background tab, or detach it if the user moved
          // it into a shared window. Never minimize a shared source window.
          const ownWindow = await create({ tabId: tab.id });
          if (!Number.isInteger(ownWindow?.id)) throw new Error('Chưa tạo được cửa sổ ChatGPT nền. Bấm thử lại.');
          mode.chatWindowId = ownWindow.id;
          mode.chatWindowReadyAt = Date.now() + 800;
          mode.chatRevealed = false;
          await save(mode);
          // Enforce state only: focused:false would bring the next window in
          // the z-order forward. Creation may return before state has settled.
          await minimize(mode, ownWindow.id);
          tab = await chrome.tabs.get(tab.id);
        }
      } else {
        mode.chatWindowId = window.id;
        await save(mode);
        if (!mode.chatRevealed && window.state !== 'minimized') await minimize(mode, window.id);
      }
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      if (starting) {
        mode.chatBridgeVersion = version;
        await save(mode);
        return navigate(mode, tab, save);
      }
      mode.chatStartUrl = null;
      if (mode.chatBridgeVersion !== version && !mode.job?.mayHaveSent && !mode.current?.sent) {
        // Keep an uncertain sent turn readable without a reload. Before a new
        // send, upgrade our own tab to the focus-free automatic editor bridge.
        mode.chatBridgeVersion = version;
        await save(mode);
        await chrome.tabs.reload(tab.id);
        return { ...tab, status: 'loading' };
      }
      return tab;
    }
    if (tab) throw new Error('Tab xử lý đã đổi địa chỉ. Mở lại ChatGPT rồi bấm thử lại.');
  }
  const fullscreen = await fullscreenSource(mode);
  if (fullscreen || mode.chatBackgroundTab) {
    const tab = await chrome.tabs.create({ windowId: fullscreen?.id || mode.windowId, url: 'about:blank', active: false });
    if (!Number.isInteger(tab?.id)) throw new Error('Chưa tạo được tab ChatGPT nền. Bấm thử lại.');
    mode.chatBackgroundTab = true;
    mode.chatWindowId = null;
    mode.chatTabId = tab.id;
    mode.chatWindowReadyAt = 0;
    mode.chatStartUrl = isChat(mode.conversationUrl) ? mode.conversationUrl : 'https://chatgpt.com/';
    mode.chatRevealed = false;
    mode.chatBridgeVersion = version;
    await save(mode);
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    return navigate(mode, tab, save);
  }
  // Load ChatGPT only after the empty window is minimized. Opening the site
  // directly can run its initial autofocus while the new popup is still visible.
  const window = await create({ url: 'about:blank' });
  if (!Number.isInteger(window?.id)) throw new Error('Chưa tạo được cửa sổ ChatGPT nền. Bấm thử lại.');
  mode.chatWindowId = window.id;
  mode.chatWindowReadyAt = Date.now() + 800;
  mode.chatStartUrl = isChat(mode.conversationUrl) ? mode.conversationUrl : 'https://chatgpt.com/';
  mode.chatTabId = null;
  mode.chatRevealed = false;
  await save(mode);
  await minimize(mode, window.id);
  const tab = window.tabs?.[0] || (await chrome.tabs.query({ windowId: window.id }))[0];
  if (!Number.isInteger(tab?.id)) throw new Error('Chưa tìm thấy tab trong cửa sổ ChatGPT nền. Bấm thử lại.');
  mode.chatTabId = tab.id;
  mode.chatBridgeVersion = version;
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  await save(mode);
  return navigate(mode, tab, save);
}

async function navigate(mode, tab, save) {
  const navigated = await chrome.tabs.update(tab.id, { url: mode.chatStartUrl });
  mode.chatStartUrl = null;
  await save(mode);
  return { ...navigated, status: navigated.status || 'loading' };
}

  globalThis.sidebarBackgroundChat = { ensure };
})();
