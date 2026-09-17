export const SECTION_IDS = ['general', 'downloads', 'conversions', 'ytdlp', 'shortcuts', 'updates', 'diagnostics', 'about'];

export const LOCAL_DEFAULTS = Object.freeze({
  general: Object.freeze({
    closeBehavior: 'ask',
    autoResume: false,
    notifyOnFinish: true,
    onQueueFinish: 'nothing',
    checkUpdates: true,
    lowPriority: true,
    clipboardChip: true,
    stallMinutes: 5
  }),
  download: Object.freeze({
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
    ytdlpAutoUpdate: true
  }),
  convert: Object.freeze({
    outputMode: 'folder',
    nameTemplate: '{name}',
    collision: 'rename',
    defaultPreset: 'mp4-universal',
    concurrency: 1,
    keepDate: false,
    hardware: 'auto'
  })
});

export const FOLDER_KEYS = ['download.folder', 'convert.folder'];

export const OPTIONS = Object.freeze({
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
  'convert.hardware': ['auto', 'software']
});

export const RANGES = Object.freeze({
  'general.stallMinutes': [1, 60],
  'download.concurrentFragments': [1, 16],
  'download.concurrency': [1, 5],
  'convert.concurrency': [1, 3]
});

export const LOSSLESS_AUDIO = new Set(['wav', 'flac']);

export const FORMAT_LABELS = Object.freeze({
  mp4: 'MP4',
  mkv: 'MKV',
  webm: 'WebM',
  mp3: 'MP3',
  m4a: 'M4A',
  opus: 'Opus',
  wav: 'WAV',
  flac: 'FLAC'
});

export const RESERVED_ACCELERATORS = new Set(['Escape', 'Tab', 'Shift+Tab', 'Alt+F4', 'Ctrl+C', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z']);

export const SHORTCUT_GROUP_ORDER = ['general', 'download', 'convert', 'queue', 'navigation'];

export const CODEC_ORDER = ['h264', 'hevc', 'av1', 'vp9'];

export const LINKS = Object.freeze({
  repository: 'https://github.com/BrandSilva/Vidaro',
  releases: 'https://github.com/BrandSilva/Vidaro/releases',
  website: 'https://tridentsky.net/software'
});

export function valueAt(data, key) {
  if (!data) return undefined;
  const [section, field] = key.split('.');
  const group = data[section];
  return group && typeof group === 'object' ? group[field] : undefined;
}

export function splitKey(key) {
  const [section, field] = key.split('.');
  return { section, field };
}

export function mergeDefaults(remote) {
  const result = {};
  for (const [section, values] of Object.entries(LOCAL_DEFAULTS)) result[section] = { ...values };
  if (!remote || typeof remote !== 'object') return result;
  for (const key of FOLDER_KEYS) {
    const value = valueAt(remote, key);
    if (typeof value === 'string' && value.trim()) {
      const { section, field } = splitKey(key);
      result[section][field] = value;
    }
  }
  return result;
}

function samePath(a, b) {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
}

export function isDefault(settings, defaults, key) {
  const expected = valueAt(defaults, key);
  if (expected === undefined) return true;
  const actual = valueAt(settings, key);
  if (FOLDER_KEYS.includes(key) && typeof actual === 'string') return samePath(actual, expected);
  return Object.is(actual, expected);
}

export function differsFromDefault(settings, defaults, keys) {
  return keys.some((key) => !isDefault(settings, defaults, key));
}

export function resetAllKeys() {
  const keys = [];
  for (const [section, values] of Object.entries(LOCAL_DEFAULTS)) {
    for (const field of Object.keys(values)) keys.push(`${section}.${field}`);
  }
  keys.push(...FOLDER_KEYS, 'shortcuts');
  return keys;
}

export function validateRateLimit(text) {
  const value = String(text ?? '').trim();
  if (!value) return { ok: true, value: '' };
  const match = /^(\d+(?:\.\d+)?)\s*([KMG])?(?:i?B?)?$/i.exec(value);
  if (!match) return { ok: false };
  const unit = (match[2] || '').toUpperCase();
  const factor = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[unit] ?? 1;
  if (Number(match[1]) * factor < 1024) return { ok: false };
  const normalized = `${match[1]}${unit}`;
  return normalized.length <= 16 ? { ok: true, value: normalized } : { ok: false };
}

const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

export function validateProxy(text) {
  const value = String(text ?? '').trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > 512 || /\s/.test(value)) return { ok: false };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false };
  }
  if (!PROXY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return { ok: false };
  return { ok: true, value };
}

export function validateSubtitleLangs(text) {
  const value = String(text ?? '').replace(/\s+/g, '');
  return /^[A-Za-z0-9][A-Za-z0-9.*,_+-]{0,127}$/.test(value) ? { ok: true, value } : { ok: false };
}

export function validateCustomTemplate(text) {
  const value = String(text ?? '').trim();
  return value && value.length <= 512 ? { ok: true, value } : { ok: false };
}

export function validateConvertTemplate(text) {
  const value = String(text ?? '').trim();
  return value.includes('{name}') && value.length <= 256 ? { ok: true, value } : { ok: false };
}

function isoDate(now) {
  const date = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function convertNamePreview(template, sample, now = Date.now()) {
  const values = { ...sample, date: isoDate(now) };
  const source = String(template ?? '').trim() || '{name}';
  return source.replace(/\{(name|preset|resolution|date)\}/gi, (match, key) => values[key.toLowerCase()] ?? match).replace(/[<>:"/\\|?*]/g, '_');
}

export function downloadExtension(download) {
  if (!download) return 'mp4';
  return download.mode === 'audio' ? download.audioFormat : download.container;
}

export function acceleratorParts(accelerator) {
  if (!accelerator) return [];
  return accelerator.split('+').filter(Boolean);
}

export function groupShortcuts(shortcuts) {
  const groups = new Map();
  for (const id of SHORTCUT_GROUP_ORDER) groups.set(id, []);
  for (const shortcut of shortcuts) {
    if (!groups.has(shortcut.group)) groups.set(shortcut.group, []);
    groups.get(shortcut.group).push(shortcut);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 0).map(([id, items]) => ({ id, items }));
}

export function shortcutValue(overrides, shortcut) {
  return overrides && Object.hasOwn(overrides, shortcut.id) ? overrides[shortcut.id] : shortcut.accelerator;
}

export function assignShortcut(overrides, shortcuts, id, accelerator, conflictId = null) {
  const next = { ...(overrides || {}) };
  const byId = new Map(shortcuts.map((item) => [item.id, item]));
  const write = (targetId, value) => {
    const shortcut = byId.get(targetId);
    if (shortcut && shortcut.accelerator === value) delete next[targetId];
    else next[targetId] = value;
  };
  write(id, accelerator);
  if (conflictId && conflictId !== id) write(conflictId, '');
  return next;
}

export function resetShortcut(overrides, id) {
  const next = { ...(overrides || {}) };
  delete next[id];
  return next;
}

export function isShortcutDefault(overrides, shortcut) {
  return shortcutValue(overrides, shortcut) === shortcut.accelerator;
}

export function captureAction(event, accelerator) {
  const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  if (plain && (event.key === 'Escape' || event.key === 'Esc')) return { type: 'cancel' };
  if (plain && event.key === 'Backspace') return { type: 'clear' };
  if (event.key === 'Tab') return { type: 'leave' };
  if (!accelerator) return { type: 'wait' };
  if (RESERVED_ACCELERATORS.has(accelerator) || event.metaKey) return { type: 'reserved', accelerator };
  return { type: 'assign', accelerator };
}

export function shortVersion(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  return match ? `${match[1]}.${match[2]}` : null;
}

export function runtimeState(runtime) {
  if (!runtime || !runtime.name) return 'none';
  if (runtime.ok === null || runtime.ok === undefined) return 'checking';
  return runtime.ok ? 'ok' : 'broken';
}

export function ytdlpBusy(status) {
  return Boolean(status && (status.checking || status.updating));
}

export function ytdlpResultKey(result) {
  if (!result) return null;
  if (result.outcome === 'deferred') return 'deferred';
  if (result.outcome === 'current' || result.outcome === 'updated') return result.outcome;
  return result.error || 'failed';
}

export function ytdlpStatusResult(status) {
  if (!status || !status.lastResult) return null;
  if (status.lastResult === 'failed') return status.error ? { outcome: 'failed', error: status.error } : null;
  return { outcome: status.lastResult, error: null };
}

export function mergeYtdlpStatus(previous, next) {
  if (!next) return previous;
  if (!previous) return next;
  const keepRuntime = next.jsRuntime && (next.jsRuntime.ok === null || next.jsRuntime.ok === undefined) && previous.jsRuntime && typeof previous.jsRuntime.ok === 'boolean';
  return keepRuntime ? { ...next, jsRuntime: previous.jsRuntime } : next;
}

export function updatePhase(update) {
  if (!update) return 'unknown';
  if (update.phase === 'checking') return 'checking';
  if (update.phase === 'downloading') return 'downloading';
  if (update.phase === 'ready') return 'ready';
  if (update.available) return 'available';
  if (update.error === 'check-failed') return 'check-failed';
  if (update.upToDate) return 'current';
  return 'idle';
}

export function encoderRows(view) {
  const available = view && view.available ? view.available : {};
  const details = view && view.encoders ? view.encoders : {};
  const broken = new Set(view && Array.isArray(view.broken) ? view.broken : []);
  return CODEC_ORDER.filter((codec) => Array.isArray(available[codec])).map((codec) => ({
    codec,
    encoders: available[codec].map((name) => ({
      name,
      label: details[name]?.label || name,
      hardware: Boolean(details[name]?.hardware),
      broken: broken.has(name)
    }))
  }));
}

function line(label, value) {
  return `${label}: ${value === null || value === undefined || value === '' ? 'unknown' : value}`;
}

export function diagnosticsText({ info, diag, ytdlp, encoders, settings, now = Date.now() }) {
  const lines = [];
  const kind = info ? (info.packaged ? 'installed' : 'development') : 'unknown';
  lines.push(`Vidaro ${info?.version ?? 'unknown'} (${kind})`);
  lines.push(line('Generated', new Date(now).toISOString()));
  lines.push(line('System', info?.platform));
  if (diag?.system) {
    const system = diag.system;
    if (system.cpu) lines.push(line('CPU', system.cores ? `${system.cpu} (${system.cores} threads)` : system.cpu));
    if (Number.isFinite(system.memory)) lines.push(line('Memory', `${Math.round(system.memory / 1024 ** 3)} GB`));
    if (Array.isArray(system.gpu) && system.gpu.length) lines.push(line('Graphics', system.gpu.join('; ')));
  }
  lines.push(`Electron ${info?.electron ?? '?'} · Chromium ${info?.chrome ?? '?'} · Node ${info?.node ?? '?'}`);
  lines.push('');
  lines.push(line('FFmpeg', diag?.tools?.ffmpeg));
  if (diag?.tools?.ffprobe) lines.push(line('FFprobe', diag.tools.ffprobe));
  if (ytdlp) {
    const extra = [ytdlp.channel, ytdlp.usingBundled ? 'bundled copy' : null].filter(Boolean).join(', ');
    lines.push(line('yt-dlp', ytdlp.version ? `${ytdlp.version}${extra ? ` (${extra})` : ''}` : null));
    lines.push(line('yt-dlp update channel', ytdlp.targetChannel));
    const runtime = ytdlp.jsRuntime;
    const state = runtimeState(runtime);
    lines.push(line('JavaScript runtime', runtime?.name ? `${runtime.name} ${runtime.version ?? ''}`.trim() + ` · ${state}` : 'none'));
  } else {
    lines.push(line('yt-dlp', null));
  }
  lines.push('');
  if (encoders && encoders.status === 'ready') {
    lines.push('Encoders:');
    for (const row of encoderRows(encoders)) {
      const names = row.encoders.map((item) => (item.broken ? `${item.name} (failed)` : item.name));
      lines.push(`  ${row.codec}: ${names.length ? names.join(', ') : 'none'}`);
    }
  } else {
    lines.push(line('Encoders', encoders?.status === 'detecting' ? 'detecting' : null));
  }
  if (settings) {
    lines.push('');
    lines.push(line('Hardware acceleration', settings.convert?.hardware));
    lines.push(line('Low priority', settings.general?.lowPriority ? 'on' : 'off'));
    lines.push(line('Downloads at once', settings.download?.concurrency));
    lines.push(line('Conversions at once', settings.convert?.concurrency));
    lines.push(line('Compatible downloads', settings.download?.compatible ? 'on' : 'off'));
    lines.push(line('Cookies', settings.download?.cookiesMode));
    lines.push(line('Proxy', settings.download?.proxy ? 'set' : 'none'));
  }
  lines.push('');
  lines.push(line('Settings folder', info?.userData));
  if (diag?.folders?.data) lines.push(line('App data folder', diag.folders.data));
  return lines.join('\r\n');
}
