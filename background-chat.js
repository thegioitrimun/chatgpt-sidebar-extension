// Shared background-window transport. Never restores focus except on explicit open.
(() => {
const isChat = url => { try { return ['https://chatgpt.com', 'https://chat.openai.com'].includes(new URL(url).origin); } catch { return false; } };
function create(content) {
  // Brave/macOS can inherit the active fullscreen Space even when a normal
  // window requests minimized/unfocused. An explicitly sized, inactive popup
  // avoids that transition; the caller journals it, then minimizes before work.
  return chrome.windows.create({ ...content, type: 'popup', state: 'normal', focused: false, width: 800, height: 600 });
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
      if (tab.windowId === mode.windowId || window.tabs?.length !== 1 || window.tabs[0].id !== tab.id) {
        // Migrate our legacy background tab, or detach it if the user moved it
        // into a shared window. Never minimize a window containing other tabs.
        const ownWindow = await create({ tabId: tab.id });
        if (!Number.isInteger(ownWindow?.id)) throw new Error('Chưa tạo được cửa sổ ChatGPT nền. Bấm thử lại.');
        mode.chatWindowId = ownWindow.id;
        mode.chatRevealed = false;
        await save(mode);
        // Enforce state only: focused:false would bring the next window in the
        // z-order forward. Creation can also return before state has settled.
        await chrome.windows.update(ownWindow.id, { state: 'minimized' });
        tab = await chrome.tabs.get(tab.id);
      } else {
        mode.chatWindowId = window.id;
        await save(mode);
        if (!mode.chatRevealed && window.state !== 'minimized') await chrome.windows.update(window.id, { state: 'minimized' });
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
  // Load ChatGPT only after the empty window is minimized. Opening the site
  // directly can run its initial autofocus while the new popup is still visible.
  const window = await create({ url: 'about:blank' });
  if (!Number.isInteger(window?.id)) throw new Error('Chưa tạo được cửa sổ ChatGPT nền. Bấm thử lại.');
  mode.chatWindowId = window.id;
  mode.chatStartUrl = isChat(mode.conversationUrl) ? mode.conversationUrl : 'https://chatgpt.com/';
  mode.chatTabId = null;
  mode.chatRevealed = false;
  await save(mode);
  await chrome.windows.update(window.id, { state: 'minimized' });
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
