// tauri-bridge.js — connects the screen to the Windows app (Tauri).
// In the iPhone/web version this file does nothing.
(function () {
  const T = window.__TAURI__;
  if (!T || window.api) return;
  const { invoke } = T.core;
  const win = T.window.getCurrentWindow();
  const CACHE_KEY = 'task-timer-latest-save';

  // Every save goes straight to the file. A copy is also kept in the page's own
  // storage, so a page reload never shows older data than what was last saved.
  let pending = Promise.resolve();
  function save(data) {
    const stamped = { ...data, savedAt: Date.now() };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(stamped)); } catch {}
    pending = invoke('save_data', { data: stamped }).catch((e) => console.error('Could not save', e));
    return pending;
  }
  function load() {
    const fromFile = window.__TASK_TIMER_DATA__ || null;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch {}
    if (cached && (!fromFile || (cached.savedAt || 0) > (fromFile.savedAt || 0))) return cached;
    return fromFile;
  }

  window.api = {
    load,
    save,
    saveNow: save,
    setAlwaysOnTop: (on) => win.setAlwaysOnTop(!!on).catch(() => {}),
    setTheme: (theme) => {
      try { win.setTheme(theme === 'system' ? null : theme).catch(() => {}); } catch {}
    },
    async notify(title, body) {
      invoke('notify', { title, body }).catch(() => {});
      // Also flash the taskbar button, in case the pop-up is missed.
      try { if (!(await win.isFocused())) await win.requestUserAttention(2); } catch {}
    },
    async checkForUpdate() {
      const res = await fetch(window.__TASK_TIMER_UPDATE_URL__, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('GitHub answered ' + res.status);
      const rel = await res.json();
      const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
      return {
        version: String(rel.tag_name || '').replace(/^v/i, ''),
        downloadUrl: asset ? asset.browser_download_url : null,
        pageUrl: rel.html_url,
      };
    },
    async installUpdate(info) {
      if (!info || !info.downloadUrl) throw new Error('No download found for this version');
      await invoke('install_update', { url: info.downloadUrl });
      return { mode: 'restarting' };
    },
    onUpdateProgress() {},
  };

  // Keep the window's title in step with the list name.
  document.addEventListener('DOMContentLoaded', () => {
    const titleEl = document.querySelector('title');
    const sync = () => win.setTitle(document.title).catch(() => {});
    if (titleEl) new MutationObserver(sync).observe(titleEl, { childList: true });
    sync();
  });

  // Before the window closes, make sure the latest changes are saved.
  win.onCloseRequested(async () => {
    try { if (typeof saveNow === 'function') saveNow(); } catch {}
    await pending;
  });
})();
