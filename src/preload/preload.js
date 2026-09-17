const { contextBridge, ipcRenderer, webUtils } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('vidaro', {
  app: {
    info: () => invoke('app:info'),
    notices: () => invoke('app:notices'),
    dismissNotice: (id) => invoke('app:dismiss-notice', id),
    diagnostics: () => invoke('app:diagnostics'),
    respondClose: (choice) => invoke('app:close-choice', choice),
    quit: () => invoke('app:quit'),
    rendererReady: () => invoke('app:renderer-ready'),
    cancelFinishAction: () => invoke('app:cancel-finish-action'),
    onFinishCountdown: subscribe('app:finish-countdown'),
    onCloseRequested: subscribe('app:close-requested'),
    onOpenInputs: subscribe('app:open-inputs'),
    onNotice: subscribe('app:notice'),
    onNavigate: subscribe('app:navigate')
  },
  settings: {
    get: () => invoke('settings:get'),
    defaults: () => invoke('settings:defaults'),
    update: (patch) => invoke('settings:update', patch),
    reset: (keys) => invoke('settings:reset', keys),
    onChanged: subscribe('settings:changed')
  },
  presets: {
    list: () => invoke('presets:list'),
    schema: () => invoke('presets:schema'),
    save: (preset) => invoke('presets:save', preset),
    duplicate: (id, name) => invoke('presets:duplicate', id, name),
    rename: (id, name) => invoke('presets:rename', id, name),
    remove: (id) => invoke('presets:remove', id),
    importFile: () => invoke('presets:import'),
    exportFile: (id) => invoke('presets:export', id),
    onChanged: subscribe('presets:changed')
  },
  dialogs: {
    pickFolder: (defaultPath) => invoke('dialogs:pick-folder', defaultPath),
    pickFiles: () => invoke('dialogs:pick-files'),
    pickCookiesFile: () => invoke('dialogs:pick-cookies')
  },
  files: {
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
    openPath: (filePath) => invoke('files:open', filePath),
    openFolder: (folder) => invoke('files:open-folder', folder),
    showInFolder: (filePath) => invoke('files:show', filePath),
    diskSpace: (folder) => invoke('files:disk-space', folder),
    expandInputs: (paths) => invoke('files:expand', paths)
  },
  convert: {
    probe: (paths) => invoke('convert:probe', paths),
    analyze: (filePath) => invoke('convert:analyze', filePath),
    cancelAnalyze: (filePath) => invoke('convert:cancel-analyze', filePath),
    thumbnail: (filePath) => invoke('convert:thumbnail', filePath),
    describe: (preset, media, options) => invoke('convert:describe', preset, media, options),
    encoders: () => invoke('convert:encoders'),
    detectEncoders: () => invoke('convert:detect-encoders'),
    enqueue: (request) => invoke('convert:enqueue', request),
    onEncodersChanged: subscribe('encoders:changed')
  },
  download: {
    fetchInfo: (url, options) => invoke('download:fetch-info', url, options),
    cancelFetch: () => invoke('download:cancel-fetch'),
    suggestName: (request) => invoke('download:suggest-name', request),
    enqueue: (request) => invoke('download:enqueue', request)
  },
  queue: {
    list: () => invoke('queue:list'),
    pause: (ids) => invoke('queue:pause', ids),
    resume: (ids) => invoke('queue:resume', ids),
    cancel: (ids) => invoke('queue:cancel', ids),
    retry: (ids) => invoke('queue:retry', ids),
    remove: (ids) => invoke('queue:remove', ids),
    reorder: (ids, beforeId) => invoke('queue:reorder', ids, beforeId),
    clearFinished: () => invoke('queue:clear-finished'),
    startAll: () => invoke('queue:start-all'),
    pauseAll: () => invoke('queue:pause-all'),
    onChanged: subscribe('queue:changed'),
    onProgress: subscribe('queue:progress')
  },
  ytdlp: {
    status: () => invoke('ytdlp:status'),
    update: () => invoke('ytdlp:update'),
    onStatus: subscribe('ytdlp:status')
  },
  updates: {
    status: () => invoke('updates:status'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    install: () => invoke('updates:install'),
    dismiss: (version) => invoke('updates:dismiss', version),
    onStatus: subscribe('updates:status')
  },
  clipboard: {
    readUrl: () => invoke('clipboard:read-url'),
    writeText: (text) => invoke('clipboard:write', text)
  },
  shell: {
    openExternal: (url) => invoke('shell:open-external', url)
  }
});
