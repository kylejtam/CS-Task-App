// main.js — the "behind the scenes" part of the app.
// It opens the window, saves/loads your tasks to a file on your computer,
// and shows Windows pop-up alerts. The screen itself lives in src/.

const { app, BrowserWindow, ipcMain, Notification, Menu, nativeTheme, screen, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { buildSwapScript } = require('./update-script');

// Where new versions are published.
const RELEASES_API = process.env.TASK_TIMER_UPDATE_URL || 'https://api.github.com/repos/kylejtam/CS-Task-App/releases/latest';
const RELEASES_PAGE = 'https://github.com/kylejtam/CS-Task-App/releases/latest';

// This name is what Windows shows as the source of pop-up alerts.
app.setAppUserModelId('Task Timer');

// Only allow one copy of the app to run at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');
  const windowFile = () => path.join(app.getPath('userData'), 'window.json');

  const readJson = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  };
  // Write to a temporary file first, then swap it in, so a crash mid-save can't corrupt your tasks.
  const writeJson = (file, obj) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Could not save', file, err);
    }
  };

  function onScreen(b) {
    return screen.getAllDisplays().some(({ workArea: w }) =>
      b.x < w.x + w.width - 50 && b.x + b.width > w.x + 50 &&
      b.y < w.y + w.height - 50 && b.y + b.height > w.y);
  }

  // The app used to be called "CS Task List". If tasks were saved under the old name,
  // copy them over the first time "Task Timer" starts so nothing is lost.
  function migrateOldData() {
    const oldDir = path.join(app.getPath('appData'), 'CS Task List');
    for (const name of ['tasks.json', 'window.json']) {
      const from = path.join(oldDir, name);
      const to = path.join(app.getPath('userData'), name);
      try {
        if (!fs.existsSync(to) && fs.existsSync(from)) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
        }
      } catch (err) { console.error('Could not copy old data', err); }
    }
  }

  function createWindow() {
    migrateOldData();
    const saved = readJson(windowFile());
    const data = readJson(dataFile());
    const settings = (data && data.settings) || {};
    const bounds = saved && onScreen(saved) ? saved : { width: 380, height: 680 };

    nativeTheme.themeSource = settings.theme || 'dark';

    win = new BrowserWindow({
      ...bounds,
      minWidth: 300,
      minHeight: 420,
      title: 'Task Timer',
      backgroundColor: '#16181d',
      alwaysOnTop: !!settings.alwaysOnTop,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    win.once('ready-to-show', () => win.show());

    // Remember window size and position.
    let t;
    const remember = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) writeJson(windowFile(), win.getBounds());
      }, 400);
    };
    win.on('resize', remember);
    win.on('move', remember);
    win.on('focus', () => win.flashFrame(false));
  }

  ipcMain.on('load-data', (e) => { e.returnValue = readJson(dataFile()); });
  ipcMain.on('save-data', (_e, data) => writeJson(dataFile(), data));
  ipcMain.on('save-data-sync', (e, data) => { writeJson(dataFile(), data); e.returnValue = true; });
  ipcMain.on('set-always-on-top', (_e, on) => { if (win) win.setAlwaysOnTop(!!on); });
  ipcMain.on('set-theme', (_e, theme) => {
    nativeTheme.themeSource = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  });
  ipcMain.on('notify', (_e, { title, body }) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on('click', () => { if (win) { win.show(); win.focus(); } });
      n.show();
    }
    // Also flash the taskbar button, in case Windows hides the pop-up.
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  // ---------- Updates ----------
  ipcMain.handle('check-update', async () => {
    const res = await net.fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Task-Timer' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('GitHub answered ' + res.status);
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    return {
      version: String(rel.tag_name || '').replace(/^v/i, ''),
      downloadUrl: asset ? asset.browser_download_url : null,
      pageUrl: rel.html_url || RELEASES_PAGE,
    };
  });

  ipcMain.handle('install-update', async (e, info) => {
    // The path of the .exe you double-clicked (set by the portable launcher).
    const target = process.env.PORTABLE_EXECUTABLE_FILE;
    if (process.platform !== 'win32' || !target || !info || !info.downloadUrl) {
      await shell.openExternal((info && info.pageUrl) || RELEASES_PAGE);
      return { mode: 'opened' };
    }
    const downloaded = target + '.download';
    const res = await net.fetch(info.downloadUrl, { headers: { 'User-Agent': 'Task-Timer' } });
    if (!res.ok || !res.body) throw new Error('Download failed: ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(downloaded);
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (total && !e.sender.isDestroyed()) e.sender.send('update-progress', got / total);
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (total && got !== total) throw new Error('Download incomplete');
      if (got < 1000000) throw new Error('Downloaded file is too small');
    } catch (err) {
      out.destroy();
      try { fs.unlinkSync(downloaded); } catch {}
      throw err;
    }
    const script = path.join(app.getPath('temp'), 'task-timer-update.cmd');
    fs.writeFileSync(script, buildSwapScript(target, downloaded));
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 400);
    return { mode: 'restarting' };
  });

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
