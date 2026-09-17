const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const paths = require('./paths');

paths.configureDataPaths();

const processes = require('./processes');
const settingsSchema = require('./settings');
const { JsonStore } = require('./store');
const { PresetStore } = require('./presets');
const { Queue } = require('./queue');
const { AppUpdater } = require('./updater');
const { createMainWindow, flushWindowState } = require('./window');
const { registerIpc, unregisterIpc } = require('./ipc');
const { registerBasics } = require('./ipc/basics');
const { registerQueue, bridgeQueue } = require('./ipc/queue');
const { registerPresets, bridgePresets } = require('./ipc/presets');
const { registerUpdates, bridgeUpdates } = require('./ipc/updates');
const { registerConvert, bridgeConvert } = require('./ipc/convert');
const { registerDownload, bridgeDownload } = require('./ipc/download');
const { createConverterService } = require('./converter/service');
const { createDownloaderService } = require('./downloader/service');
const { outputExtension } = require('./converter/plan');
const { createNotices } = require('./notices');
const { createTray } = require('./tray');
const { createPowerManager, performFinishAction } = require('./power');
const { cleanupStaleFiles } = require('./cleanup');

const LABELS = {
  tray: { show: 'Show Vidaro', pauseAll: 'Pause all jobs', quit: 'Quit Vidaro' },
  finishedTitle: (s) => (s.failed > 0 ? 'Vidaro finished with errors' : 'Vidaro finished'),
  finishedBody: (s) => {
    const parts = [];
    if (s.downloads) parts.push(s.downloads === 1 ? '1 download' : `${s.downloads} downloads`);
    if (s.conversions) parts.push(s.conversions === 1 ? '1 conversion' : `${s.conversions} conversions`);
    if (s.failed) parts.push(s.failed === 1 ? '1 failed' : `${s.failed} failed`);
    return parts.join(' · ');
  },
  background: (n) => (n === 1 ? 'Vidaro · 1 job running' : `Vidaro · ${n} jobs running`)
};

const ctx = {
  window: null,
  settings: null,
  presets: null,
  queue: null,
  converter: null,
  downloader: null,
  updater: null,
  power: null,
  tray: null,
  notices: null,
  quitting: false,
  shutdownDone: false,
  shutdownPromise: null,
  pendingInputs: [],
  lastInputFolder: null,
  disposers: [],
  send(channel, payload) {
    const win = ctx.window;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  },
  showWindow(page) {
    const win = ctx.window;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    ctx.tray?.hide();
    if (page) ctx.send('app:navigate', page);
  },
  rendererReady() {
    const inputs = ctx.pendingInputs.splice(0);
    for (const payload of inputs) ctx.send('app:open-inputs', payload);
    return true;
  },
  activeJobs() {
    if (!ctx.queue) return 0;
    const counts = ctx.queue.counts();
    return counts.running + counts.queued;
  },
  handleCloseChoice(choice) {
    if (choice === 'stay') return true;
    if (choice === 'background') {
      ctx.window?.hide();
      try {
        ctx.tray?.show();
        ctx.tray?.setTooltip(LABELS.background(ctx.activeJobs()));
      } catch {
        ctx.showWindow();
      }
      return true;
    }
    ctx.requestQuit(choice === 'cancel' ? 'cancel' : 'pause');
    return true;
  },
  requestQuit(mode = 'pause') {
    shutdown(mode).finally(() => app.quit());
    return true;
  },
  async installUpdate() {
    if (!ctx.updater) return false;
    await shutdown('interrupt');
    const launched = await ctx.updater.launchInstaller();
    app.quit();
    return launched;
  }
};

function parseInputs(argv) {
  const files = [];
  const urls = [];
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (typeof arg !== 'string' || arg.startsWith('-') || arg === '.') continue;
    if (/^https?:\/\//i.test(arg)) urls.push(arg);
    else if (path.win32.isAbsolute(arg) && fs.existsSync(arg)) files.push(arg);
  }
  return files.length || urls.length ? { files, urls } : null;
}

function forwardInputs(payload) {
  if (!payload) return;
  if (ctx.window && !ctx.window.webContents.isLoading()) ctx.send('app:open-inputs', payload);
  else ctx.pendingInputs.push(payload);
}

async function clearCachesOnVersionChange() {
  const version = app.getVersion();
  if (ctx.settings.get().general.lastVersion === version) return;
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage', 'shadercache'] });
  } catch {
    return;
  } finally {
    updateSettings({ general: { lastVersion: version } });
  }
}

function updateSettings(patch) {
  const clean = settingsSchema.sanitizePatch(patch);
  return ctx.settings.update((current) => settingsSchema.applyPatch(current, clean));
}

function loadSettings() {
  settingsSchema.setDefaultFolders({ download: paths.defaultDownloadFolder(), convert: paths.defaultConvertFolder() });
  ctx.settings = new JsonStore({
    file: paths.userDataFile('settings.json'),
    defaults: settingsSchema.defaults(),
    normalize: settingsSchema.normalize
  });
  ctx.settings.load();
  if (ctx.settings.recovered) ctx.notices.add('settings-recovered', { tone: 'warning', code: 'settingsRecovered' });
  processes.setLowPriority(ctx.settings.get().general.lowPriority);
  ctx.disposers.push(
    ctx.settings.subscribe((data) => {
      processes.setLowPriority(data.general.lowPriority);
      ctx.queue?.reschedule();
      ctx.send('settings:changed', data);
    })
  );
  ctx.disposers.push(() => ctx.settings.dispose());
}

function loadPresets() {
  ctx.presets = new PresetStore({ file: paths.userDataFile('presets.json') });
  ctx.presets.load();
  if (ctx.presets.recovered) ctx.notices.add('presets-recovered', { tone: 'warning', code: 'presetsRecovered' });
  ctx.disposers.push(() => ctx.presets.dispose());
}

async function gpuSignature() {
  try {
    const info = await app.getGPUInfo('basic');
    const devices = (info.gpuDevice || []).map((d) => `${d.vendorId}:${d.deviceId}:${d.driverVersion || ''}`);
    return devices.sort().join('|');
  } catch {
    return 'unknown';
  }
}

function createServices(ready) {
  const getSettings = () => ctx.settings.get();
  ctx.converter = createConverterService({ paths, getSettings, appVersion: app.getVersion(), gpuInfo: gpuSignature });
  ctx.downloader = createDownloaderService({
    paths,
    getSettings,
    updateSettings,
    isBusy: () => (ctx.queue ? ctx.queue.list().some((job) => job.kind === 'download' && job.state === 'running') : false)
  });
  ctx.queue = new Queue({
    file: paths.userDataFile('queue.json'),
    runners: { convert: ctx.converter.runner, download: ctx.downloader.runner },
    limits: () => ({ convert: getSettings().convert.concurrency, download: getSettings().download.concurrency }),
    stallMs: () => getSettings().general.stallMinutes * 60 * 1000,
    autoResume: () => getSettings().general.autoResume,
    settings: getSettings,
    ready
  });
  ctx.queue.load();
  if (ctx.queue.recovered) ctx.notices.add('queue-recovered', { tone: 'warning', code: 'queueRecovered' });
  ctx.updater = new AppUpdater({
    currentVersion: app.getVersion(),
    updatesDir: paths.updatesDir(),
    getSettings,
    dismiss: (version) => updateSettings({ general: { dismissedUpdate: version } }),
    activeJobs: () => ctx.activeJobs()
  });

  ctx.disposers.push(
    () => ctx.queue.dispose(),
    () => ctx.converter.dispose(),
    () => ctx.downloader.dispose(),
    () => ctx.updater.dispose()
  );
}

function registerAll() {
  registerIpc(ctx, [registerBasics, registerQueue, registerPresets, registerUpdates, registerConvert, registerDownload]);
  ctx.disposers.push(bridgeQueue(ctx), bridgePresets(ctx), bridgeUpdates(ctx), bridgeConvert(ctx), bridgeDownload(ctx));
}

function startSystemIntegration() {
  ctx.tray = createTray({
    labels: LABELS.tray,
    onShow: () => ctx.showWindow(),
    onPauseAll: () => ctx.queue.pauseAll(),
    onQuit: () => ctx.requestQuit('pause')
  });
  ctx.power = createPowerManager({
    queue: ctx.queue,
    getWindow: () => ctx.window,
    getSettings: () => ctx.settings.get(),
    send: ctx.send,
    showWindow: (page) => ctx.showWindow(page),
    labels: LABELS,
    onBackgroundIdle: () => ctx.requestQuit('pause'),
    onFinishAction: async (action) => {
      if (action !== 'shutdown') {
        performFinishAction(action);
        return;
      }
      await shutdown('pause');
      performFinishAction(action);
      app.quit();
    }
  });
  const onChanged = () => {
    if (ctx.tray.visible()) ctx.tray.setTooltip(LABELS.background(ctx.activeJobs()));
  };
  ctx.queue.on('changed', onChanged);
  ctx.disposers.push(
    () => ctx.queue.off('changed', onChanged),
    () => ctx.power.dispose(),
    () => ctx.tray.destroy()
  );
}

function openWindow() {
  const win = createMainWindow();
  ctx.window = win;
  win.on('close', (event) => {
    if (ctx.quitting) return;
    event.preventDefault();
    const active = ctx.activeJobs();
    if (active === 0) {
      ctx.requestQuit('pause');
      return;
    }
    const behavior = ctx.settings.get().general.closeBehavior;
    if (behavior === 'ask') {
      ctx.showWindow();
      ctx.send('app:close-requested', { active });
    } else {
      ctx.handleCloseChoice(behavior);
    }
  });
  win.on('session-end', () => {
    ctx.settings?.flush();
    ctx.presets?.flush();
    flushWindowState();
  });
  win.on('closed', () => {
    if (ctx.window === win) ctx.window = null;
  });
}

async function shutdown(mode) {
  if (ctx.shutdownPromise) return ctx.shutdownPromise;
  ctx.quitting = true;
  ctx.shutdownPromise = (async () => {
    if (ctx.queue) {
      const intent = mode === 'cancel' ? 'cancel' : mode === 'pause' ? 'pause' : 'interrupt';
      await ctx.queue.shutdown(intent).catch(() => {});
    }
    for (const dispose of ctx.disposers.splice(0).reverse()) {
      try {
        await dispose(mode);
      } catch {
        continue;
      }
    }
    await processes.killAll();
    flushWindowState();
    unregisterIpc();
    ctx.shutdownDone = true;
  })();
  return ctx.shutdownPromise;
}

async function prepareFileSystem() {
  await processes.sweepOrphans(paths.sweepDirs());
  await cleanupStaleFiles({ tempDir: paths.tempDir(), jobs: ctx.queue ? ctx.queue.list() : [], extensionFor: outputExtension }).catch(() => {});
}

function start() {
  const identity = paths.windowsIdentity();
  app.setAppUserModelId(identity.appUserModelId);
  app.setToastActivatorCLSID(identity.toastActivator);
  const initial = parseInputs(process.argv);
  if (initial) ctx.pendingInputs.push(initial);

  app.on('second-instance', (_event, argv) => {
    ctx.showWindow();
    forwardInputs(parseInputs(argv));
  });

  app.on('before-quit', (event) => {
    if (ctx.shutdownDone) return;
    event.preventDefault();
    ctx.requestQuit('interrupt');
  });

  app.on('window-all-closed', () => {
    if (ctx.shutdownDone) app.quit();
  });

  app.whenReady().then(async () => {
    ctx.notices = createNotices(ctx.send);
    loadSettings();
    loadPresets();
    let markReady;
    const ready = new Promise((resolve) => {
      markReady = resolve;
    });
    createServices(ready);
    registerAll();
    await clearCachesOnVersionChange();
    openWindow();
    startSystemIntegration();
    prepareFileSystem().finally(markReady);
    const timer = setTimeout(() => {
      ctx.downloader.start();
      ctx.updater.start();
      ready.then(() => ctx.converter.encoders()).catch(() => {});
    }, 1500);
    ctx.disposers.push(() => clearTimeout(timer));
  });
}

if (app.requestSingleInstanceLock()) start();
else app.exit(0);
