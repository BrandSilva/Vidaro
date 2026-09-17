const { isPlainObject } = require('./store');

const folders = { download: '', convert: '' };

function setDefaultFolders({ download, convert }) {
  folders.download = download;
  folders.convert = convert;
}

const SCHEMA_VERSION = 1;

function defaults() {
  return {
    version: SCHEMA_VERSION,
    general: {
      closeBehavior: 'ask',
      autoResume: false,
      notifyOnFinish: true,
      onQueueFinish: 'nothing',
      checkUpdates: true,
      dismissedUpdate: null,
      lowPriority: true,
      clipboardChip: true,
      stallMinutes: 5,
      lastVersion: null
    },
    download: {
      folder: folders.download,
      nameTemplate: 'title',
      customTemplate: '%(title)s',
      collision: 'rename',
      mode: 'av',
      quality: 'best',
      compatible: true,
      container: 'mp4',
      audioFormat: 'mp3',
      audioQuality: 'best',
      subtitles: false,
      embedSubtitles: true,
      subtitleLangs: 'en.*,es.*',
      autoSubtitles: false,
      embedThumbnail: true,
      embedMetadata: true,
      embedChapters: true,
      sponsorBlock: false,
      rateLimit: '',
      concurrentFragments: 4,
      cookiesMode: 'none',
      cookiesBrowser: 'edge',
      cookiesFile: '',
      proxy: '',
      numberPlaylist: true,
      afterPreset: null,
      keepOriginalAfterConvert: true,
      concurrency: 2,
      ytdlpChannel: 'stable',
      ytdlpAutoUpdate: true,
      ytdlpLastCheck: 0
    },
    convert: {
      outputMode: 'folder',
      folder: folders.convert,
      nameTemplate: '{name}',
      collision: 'rename',
      defaultPreset: 'mp4-universal',
      concurrency: 1,
      keepDate: false,
      hardware: 'auto',
      lastPreset: null
    },
    shortcuts: {},
    ui: {
      lastPage: 'download'
    }
  };
}

const ENUMS = {
  'general.closeBehavior': ['ask', 'background', 'pause', 'cancel'],
  'general.onQueueFinish': ['nothing', 'sleep', 'shutdown'],
  'download.nameTemplate': ['title', 'channel-title', 'date-title', 'title-id', 'custom'],
  'download.collision': ['rename', 'overwrite', 'skip'],
  'download.mode': ['av', 'video', 'audio'],
  'download.quality': ['best', '2160', '1440', '1080', '720', '480', '360'],
  'download.container': ['mp4', 'mkv', 'webm'],
  'download.audioFormat': ['mp3', 'm4a', 'opus', 'wav', 'flac'],
  'download.audioQuality': ['best', '320', '256', '192', '128'],
  'download.cookiesMode': ['none', 'browser', 'file'],
  'download.cookiesBrowser': ['edge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'],
  'download.ytdlpChannel': ['stable', 'nightly'],
  'convert.outputMode': ['source', 'folder'],
  'convert.collision': ['rename', 'overwrite', 'skip'],
  'convert.hardware': ['auto', 'software'],
  'ui.lastPage': ['download', 'convert', 'queue', 'presets', 'settings']
};

const RANGES = {
  'general.stallMinutes': [1, 60],
  'download.concurrentFragments': [1, 16],
  'download.concurrency': [1, 5],
  'convert.concurrency': [1, 3]
};

const TEXT_LIMITS = {
  'download.folder': 1024,
  'download.customTemplate': 512,
  'download.subtitleLangs': 128,
  'download.rateLimit': 16,
  'download.cookiesFile': 1024,
  'download.proxy': 512,
  'convert.folder': 1024,
  'convert.nameTemplate': 256
};

function getAt(data, key) {
  const [section, field] = key.split('.');
  return data[section][field];
}

function setAt(data, key, value) {
  const [section, field] = key.split('.');
  data[section][field] = value;
}

function normalize(data) {
  const base = defaults();
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(getAt(data, key))) setAt(data, key, getAt(base, key));
  }
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Number(getAt(data, key));
    setAt(data, key, Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : getAt(base, key));
  }
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const value = getAt(data, key);
    if (typeof value !== 'string' || value.length > limit) setAt(data, key, getAt(base, key));
  }
  if (!data.download.folder.trim()) data.download.folder = base.download.folder;
  if (!data.convert.folder.trim()) data.convert.folder = base.convert.folder;
  if (!data.convert.nameTemplate.includes('{name}')) data.convert.nameTemplate = base.convert.nameTemplate;
  if (data.general.dismissedUpdate !== null && typeof data.general.dismissedUpdate !== 'string') data.general.dismissedUpdate = null;
  if (data.general.lastVersion !== null && typeof data.general.lastVersion !== 'string') data.general.lastVersion = null;
  if (data.download.afterPreset !== null && typeof data.download.afterPreset !== 'string') data.download.afterPreset = null;
  if (data.convert.lastPreset !== null && !isPlainObject(data.convert.lastPreset)) data.convert.lastPreset = null;
  data.shortcuts = normalizeShortcuts(data.shortcuts);
  data.version = SCHEMA_VERSION;
  return data;
}

function normalizeShortcuts(value) {
  const result = {};
  if (!isPlainObject(value)) return result;
  for (const [id, accelerator] of Object.entries(value).slice(0, 64)) {
    if (/^[a-z][a-zA-Z0-9.-]{0,40}$/.test(id) && typeof accelerator === 'string' && accelerator.length <= 40) {
      result[id] = accelerator;
    }
  }
  return result;
}

function sanitizePatch(patch) {
  if (!isPlainObject(patch)) throw new TypeError('Settings patch must be an object');
  const allowed = defaults();
  const clean = {};
  for (const [section, values] of Object.entries(patch)) {
    if (!Object.hasOwn(allowed, section) || section === 'version') continue;
    if (section === 'shortcuts') {
      clean.shortcuts = normalizeShortcuts(values);
      continue;
    }
    if (!isPlainObject(values)) continue;
    clean[section] = {};
    for (const [field, value] of Object.entries(values)) {
      if (Object.hasOwn(allowed[section], field)) clean[section][field] = value;
    }
  }
  return clean;
}

function applyPatch(current, patch) {
  const next = structuredClone(current);
  for (const [section, values] of Object.entries(patch)) {
    if (section === 'shortcuts') next.shortcuts = values;
    else Object.assign(next[section], values);
  }
  return next;
}

function resetKeys(current, keys) {
  const base = defaults();
  const next = structuredClone(current);
  for (const key of keys) {
    if (key === 'shortcuts') next.shortcuts = {};
    else if (typeof key === 'string' && /^[a-z]+\.[a-zA-Z]+$/.test(key)) {
      const [section, field] = key.split('.');
      if (Object.hasOwn(base, section) && isPlainObject(base[section]) && Object.hasOwn(base[section], field)) {
        next[section][field] = base[section][field];
      }
    }
  }
  return next;
}

module.exports = { setDefaultFolders, defaults, normalize, sanitizePatch, applyPatch, resetKeys, SCHEMA_VERSION };
