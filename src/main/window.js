const path = require('node:path');
const { BrowserWindow, screen, shell, app } = require('electron');
const paths = require('./paths');
const { JsonStore } = require('./store');

const MIN_WIDTH = 880;
const MIN_HEIGHT = 560;
const DEV_URL = 'http://localhost:5173';
const BACKGROUND = '#0E0F14';

let stateStore = null;

function states() {
  if (!stateStore) {
    stateStore = new JsonStore({
      file: paths.userDataFile('window-state.json'),
      defaults: { bounds: null, maximized: false },
      debounceMs: 500
    });
    stateStore.load();
  }
  return stateStore;
}

function isVisibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX >= 120 && overlapY >= 80;
  });
}

function initialBounds() {
  const saved = states().get().bounds;
  const valid =
    saved &&
    [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) &&
    saved.width >= MIN_WIDTH &&
    saved.height >= MIN_HEIGHT;
  if (valid && isVisibleOnSomeDisplay(saved)) return saved;
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1280, Math.max(MIN_WIDTH, Math.round(workArea.width * 0.8)));
  const height = Math.min(820, Math.max(MIN_HEIGHT, Math.round(workArea.height * 0.85)));
  return {
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height),
    x: Math.round(workArea.x + (workArea.width - Math.min(width, workArea.width)) / 2),
    y: Math.round(workArea.y + (workArea.height - Math.min(height, workArea.height)) / 2)
  };
}

function trackState(win) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? states().get().bounds : win.getNormalBounds();
    states().update({ bounds, maximized });
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('maximize', save);
  win.on('unmaximize', save);
}

function isAllowedExternal(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function secure(win) {
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!app.isPackaged && url.startsWith(DEV_URL)) return;
    event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
}

function createMainWindow() {
  const bounds = initialBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'Vidaro',
    backgroundColor: BACKGROUND,
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#A3A5B8', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });
  secure(win);
  win.removeMenu();

  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    if (states().get().maximized) win.maximize();
    win.show();
  };
  win.once('ready-to-show', reveal);
  const fallback = setTimeout(reveal, 4000);
  win.once('closed', () => clearTimeout(fallback));
  const crashes = [];
  win.webContents.on('render-process-gone', () => {
    const now = Date.now();
    while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    crashes.push(now);
    if (crashes.length <= 3 && !win.isDestroyed()) win.reload();
  });

  trackState(win);

  if (app.isPackaged) win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  else win.loadURL(DEV_URL);
  return win;
}

function flushWindowState() {
  stateStore?.dispose();
}

module.exports = { createMainWindow, flushWindowState, isAllowedExternal };
