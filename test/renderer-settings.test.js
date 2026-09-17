const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const schema = require('../src/main/settings');

const ROOT = path.join(__dirname, '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

let model;
let strings;

test.before(async () => {
  model = await load('src/renderer/pages/settings/model.js');
  strings = await load('src/renderer/strings/index.js');
});

const INTERNAL = new Set(['general.dismissedUpdate', 'general.lastVersion', 'download.ytdlpLastCheck', 'convert.lastPreset']);

function keysOf(data, sections) {
  const keys = [];
  for (const section of sections) for (const field of Object.keys(data[section])) keys.push(`${section}.${field}`);
  return keys;
}

test('local defaults match the main settings schema', () => {
  const main = schema.defaults();
  const expected = keysOf(main, ['general', 'download', 'convert']).filter((key) => !INTERNAL.has(key) && !model.FOLDER_KEYS.includes(key));
  const local = keysOf(model.LOCAL_DEFAULTS, ['general', 'download', 'convert']);
  assert.deepEqual([...local].sort(), [...expected].sort());
  for (const key of local) assert.equal(model.valueAt(model.LOCAL_DEFAULTS, key), model.valueAt(main, key), key);
});

test('every offered option survives normalization', () => {
  for (const [key, values] of Object.entries(model.OPTIONS)) {
    for (const value of values) {
      const data = schema.defaults();
      const { section, field } = model.splitKey(key);
      data[section][field] = value;
      assert.equal(schema.normalize(data)[section][field], value, `${key}=${value}`);
    }
  }
});

test('ranges match normalization limits', () => {
  for (const [key, [min, max]] of Object.entries(model.RANGES)) {
    const { section, field } = model.splitKey(key);
    const low = schema.defaults();
    low[section][field] = min - 1;
    assert.equal(schema.normalize(low)[section][field], min, key);
    const high = schema.defaults();
    high[section][field] = max + 1;
    assert.equal(schema.normalize(high)[section][field], max, key);
  }
});

test('every option has a label', () => {
  const s = strings.t.settings;
  const labels = {
    'general.closeBehavior': s.general.closeOptions,
    'general.onQueueFinish': s.general.onFinishOptions,
    'download.nameTemplate': s.downloads.nameOptions,
    'download.collision': s.downloads.collisionOptions,
    'download.mode': s.downloads.modeOptions,
    'download.quality': s.downloads.qualityOptions,
    'download.container': model.FORMAT_LABELS,
    'download.audioFormat': model.FORMAT_LABELS,
    'download.audioQuality': s.downloads.audioQualityOptions,
    'download.cookiesMode': s.downloads.cookiesOptions,
    'download.cookiesBrowser': s.downloads.browsers,
    'download.ytdlpChannel': s.ytdlp.channelOptions,
    'convert.outputMode': s.conversions.outputOptions,
    'convert.collision': s.downloads.collisionOptions,
    'convert.hardware': s.conversions.hardwareOptions
  };
  for (const [key, values] of Object.entries(model.OPTIONS)) {
    assert.ok(labels[key], key);
    for (const value of values) assert.equal(typeof labels[key][value], 'string', `${key}=${value}`);
  }
  for (const id of model.SECTION_IDS) assert.equal(typeof s.sections[id], 'string', id);
});

test('reset-all keys are accepted by resetKeys and restore defaults', () => {
  schema.setDefaultFolders({ download: 'C:\\Users\\A\\Videos\\Vidaro', convert: 'C:\\Users\\A\\Videos\\Vidaro\\Converted' });
  try {
    const keys = model.resetAllKeys();
    assert.ok(keys.length <= 64);
    const changed = schema.defaults();
    changed.general.closeBehavior = 'cancel';
    changed.general.lastVersion = '0.1.0';
    changed.download.folder = 'D:\\Media';
    changed.download.ytdlpLastCheck = 123;
    changed.convert.concurrency = 3;
    changed.shortcuts = { quit: 'Ctrl+W' };
    const reset = schema.resetKeys(changed, keys);
    assert.equal(reset.general.closeBehavior, 'ask');
    assert.equal(reset.download.folder, 'C:\\Users\\A\\Videos\\Vidaro');
    assert.equal(reset.convert.concurrency, 1);
    assert.deepEqual(reset.shortcuts, {});
    assert.equal(reset.general.lastVersion, '0.1.0');
    assert.equal(reset.download.ytdlpLastCheck, 123);
  } finally {
    schema.setDefaultFolders({ download: '', convert: '' });
  }
});

test('isDefault compares values and folders', () => {
  const defaults = model.mergeDefaults({ download: { folder: 'C:\\Videos\\Vidaro\\' }, convert: { folder: '' } });
  const settings = { general: { stallMinutes: 5, closeBehavior: 'pause' }, download: { folder: 'c:\\videos\\vidaro', afterPreset: null }, convert: { folder: 'D:\\Out' } };
  assert.equal(model.isDefault(settings, defaults, 'general.stallMinutes'), true);
  assert.equal(model.isDefault(settings, defaults, 'general.closeBehavior'), false);
  assert.equal(model.isDefault(settings, defaults, 'download.folder'), true);
  assert.equal(model.isDefault(settings, defaults, 'convert.folder'), true);
  assert.equal(model.isDefault(settings, defaults, 'download.afterPreset'), true);
  assert.equal(model.differsFromDefault(settings, defaults, ['general.stallMinutes', 'general.closeBehavior']), true);
  assert.equal(model.mergeDefaults(null).download.folder, undefined);
});

test('rate limit validation mirrors yt-dlp rules', () => {
  assert.deepEqual(model.validateRateLimit(''), { ok: true, value: '' });
  assert.deepEqual(model.validateRateLimit('  '), { ok: true, value: '' });
  assert.deepEqual(model.validateRateLimit('500k'), { ok: true, value: '500K' });
  assert.deepEqual(model.validateRateLimit('2 MB'), { ok: true, value: '2M' });
  assert.deepEqual(model.validateRateLimit('1.5M'), { ok: true, value: '1.5M' });
  assert.deepEqual(model.validateRateLimit('4096'), { ok: true, value: '4096' });
  assert.equal(model.validateRateLimit('100').ok, false);
  assert.equal(model.validateRateLimit('fast').ok, false);
  assert.equal(model.validateRateLimit('-2M').ok, false);
  assert.equal(model.validateRateLimit('12345678901234567K').ok, false);
});

test('text values accepted here are accepted by the download argument builder', () => {
  const { buildDownloadArgs } = require('../src/main/downloader/args');
  const env = { ffmpegDir: 'C:\\Vidaro\\bin', tempDir: 'C:\\Vidaro\\temp' };
  const build = (options) =>
    buildDownloadArgs({ url: 'https://example.com/video', options: { ...schema.defaults().download, ...options }, output: { folder: 'C:\\Videos', name: 'clip' } }, env);
  for (const text of ['500k', '2 MB', '1.5M', '4096', '3G']) {
    const { ok, value } = model.validateRateLimit(text);
    assert.equal(ok, true, text);
    const args = build({ rateLimit: value });
    assert.equal(args[args.indexOf('-r') + 1], value);
  }
  for (const text of ['100', 'fast', '0.5K']) {
    assert.equal(model.validateRateLimit(text).ok, false, text);
    assert.throws(() => build({ rateLimit: text }), undefined, text);
  }
  for (const text of ['http://proxy.local:8080', 'socks5h://10.0.0.1:1080']) {
    const { value } = model.validateProxy(text);
    const args = build({ proxy: value });
    assert.equal(args[args.indexOf('--proxy') + 1], value);
  }
  for (const text of ['ftp://proxy.local', 'proxy.local:8080']) {
    assert.equal(model.validateProxy(text).ok, false, text);
    assert.throws(() => build({ proxy: text }), undefined, text);
  }
  const langs = model.validateSubtitleLangs('en.*, pt-BR');
  const args = build({ subtitles: true, subtitleLangs: langs.value });
  assert.equal(args[args.indexOf('--sub-langs') + 1], 'en.*,pt-BR');
});

test('proxy validation', () => {
  assert.deepEqual(model.validateProxy(''), { ok: true, value: '' });
  assert.deepEqual(model.validateProxy(' socks5://127.0.0.1:1080 '), { ok: true, value: 'socks5://127.0.0.1:1080' });
  assert.equal(model.validateProxy('http://proxy.local:8080').ok, true);
  assert.equal(model.validateProxy('ftp://proxy.local').ok, false);
  assert.equal(model.validateProxy('proxy.local:8080').ok, false);
  assert.equal(model.validateProxy('http://a b').ok, false);
});

test('subtitle languages, custom and conversion templates', () => {
  assert.deepEqual(model.validateSubtitleLangs(' en.* , es.* '), { ok: true, value: 'en.*,es.*' });
  assert.equal(model.validateSubtitleLangs('').ok, false);
  assert.equal(model.validateSubtitleLangs('en;rm').ok, false);
  assert.deepEqual(model.validateCustomTemplate('  %(title)s '), { ok: true, value: '%(title)s' });
  assert.equal(model.validateCustomTemplate('   ').ok, false);
  assert.equal(model.validateCustomTemplate('x'.repeat(513)).ok, false);
  assert.deepEqual(model.validateConvertTemplate('{name}_{resolution}'), { ok: true, value: '{name}_{resolution}' });
  assert.equal(model.validateConvertTemplate('{preset}').ok, false);
  assert.equal(model.validateConvertTemplate(`{name}${'x'.repeat(260)}`).ok, false);
});

test('conversion name preview fills every token', () => {
  const now = new Date(2026, 8, 16, 12).getTime();
  const sample = { name: 'holiday', preset: 'MP4 Universal', resolution: '720p' };
  assert.equal(model.convertNamePreview('{name} [{preset}] {resolution} {date}', sample, now), 'holiday [MP4 Universal] 720p 2026-09-16');
  assert.equal(model.convertNamePreview('', sample, now), 'holiday');
  assert.equal(model.convertNamePreview('{name}:{NAME}', sample, now), 'holiday_holiday');
});

test('download extension follows the default mode', () => {
  assert.equal(model.downloadExtension({ mode: 'av', container: 'mkv', audioFormat: 'mp3' }), 'mkv');
  assert.equal(model.downloadExtension({ mode: 'audio', container: 'mkv', audioFormat: 'flac' }), 'flac');
  assert.equal(model.downloadExtension(null), 'mp4');
});

const SHORTCUTS = [
  { id: 'paste', group: 'download', accelerator: 'Ctrl+V' },
  { id: 'start', group: 'general', accelerator: 'Ctrl+Enter' },
  { id: 'quit', group: 'general', accelerator: 'Ctrl+Q' },
  { id: 'extra', group: 'custom', accelerator: 'F2' }
];

test('shortcut groups keep the preferred order and unknown groups last', () => {
  const groups = model.groupShortcuts(SHORTCUTS);
  assert.deepEqual(
    groups.map((group) => group.id),
    ['general', 'download', 'custom']
  );
  assert.deepEqual(
    groups[0].items.map((item) => item.id),
    ['start', 'quit']
  );
});

test('assigning shortcuts keeps the overrides map minimal', () => {
  let overrides = model.assignShortcut({}, SHORTCUTS, 'quit', 'Ctrl+W');
  assert.deepEqual(overrides, { quit: 'Ctrl+W' });
  overrides = model.assignShortcut(overrides, SHORTCUTS, 'quit', 'Ctrl+Q');
  assert.deepEqual(overrides, {});
  overrides = model.assignShortcut({}, SHORTCUTS, 'start', 'Ctrl+V', 'paste');
  assert.deepEqual(overrides, { start: 'Ctrl+V', paste: '' });
  overrides = model.assignShortcut(overrides, SHORTCUTS, 'paste', '');
  assert.deepEqual(overrides, { start: 'Ctrl+V', paste: '' });
  assert.deepEqual(model.resetShortcut(overrides, 'paste'), { start: 'Ctrl+V' });
  assert.equal(model.shortcutValue({ paste: '' }, SHORTCUTS[0]), '');
  assert.equal(model.shortcutValue({}, SHORTCUTS[0]), 'Ctrl+V');
  assert.equal(model.isShortcutDefault({ paste: '' }, SHORTCUTS[0]), false);
  assert.equal(model.isShortcutDefault({ paste: 'Ctrl+V' }, SHORTCUTS[0]), true);
});

test('assigned overrides pass the main shortcut normalization', () => {
  const overrides = model.assignShortcut({}, SHORTCUTS, 'start', 'Ctrl+Shift+ArrowRight', 'quit');
  const data = schema.defaults();
  data.shortcuts = overrides;
  assert.deepEqual(schema.normalize(data).shortcuts, overrides);
});

test('capture actions', () => {
  const key = (props) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...props });
  assert.deepEqual(model.captureAction(key({ key: 'Escape' }), 'Escape'), { type: 'cancel' });
  assert.deepEqual(model.captureAction(key({ key: 'Backspace' }), 'Backspace'), { type: 'clear' });
  assert.deepEqual(model.captureAction(key({ key: 'Backspace', ctrlKey: true }), 'Ctrl+Backspace'), { type: 'assign', accelerator: 'Ctrl+Backspace' });
  assert.deepEqual(model.captureAction(key({ key: 'Tab' }), 'Tab'), { type: 'leave' });
  assert.deepEqual(model.captureAction(key({ key: 'Control', ctrlKey: true }), null), { type: 'wait' });
  assert.deepEqual(model.captureAction(key({ key: 'c', ctrlKey: true }), 'Ctrl+C'), { type: 'reserved', accelerator: 'Ctrl+C' });
  assert.deepEqual(model.captureAction(key({ key: 'F4', altKey: true }), 'Alt+F4'), { type: 'reserved', accelerator: 'Alt+F4' });
  assert.deepEqual(model.captureAction(key({ key: 'k', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K'), { type: 'assign', accelerator: 'Ctrl+Shift+K' });
  assert.deepEqual(model.acceleratorParts('Ctrl+Shift+K'), ['Ctrl', 'Shift', 'K']);
  assert.deepEqual(model.acceleratorParts(''), []);
});

test('every registered shortcut has a label', async () => {
  const source = require('node:fs').readFileSync(path.join(ROOT, 'src/renderer/lib/shortcuts.js'), 'utf8');
  const ids = [...source.matchAll(/\{ id: '([^']+)', group: '([^']+)'/g)];
  assert.ok(ids.length > 0);
  const labels = strings.t.settings.shortcuts;
  for (const [, id, group] of ids) {
    assert.equal(typeof labels.labels[id], 'string', id);
    assert.equal(typeof labels.groups[group], 'string', group);
  }
});

test('yt-dlp result mapping', () => {
  assert.equal(model.ytdlpResultKey(null), null);
  assert.equal(model.ytdlpResultKey({ outcome: 'deferred' }), 'deferred');
  assert.equal(model.ytdlpResultKey({ outcome: 'current' }), 'current');
  assert.equal(model.ytdlpResultKey({ outcome: 'updated' }), 'updated');
  assert.equal(model.ytdlpResultKey({ outcome: 'failed', error: 'offline' }), 'offline');
  assert.equal(model.ytdlpResultKey({ outcome: 'failed', error: null }), 'failed');
  assert.deepEqual(model.ytdlpStatusResult({ lastResult: 'current' }), { outcome: 'current', error: null });
  assert.equal(model.ytdlpStatusResult({ lastResult: 'failed', error: null }), null);
  assert.deepEqual(model.ytdlpStatusResult({ lastResult: 'failed', error: 'timeout' }), { outcome: 'failed', error: 'timeout' });
  assert.equal(model.ytdlpStatusResult({ lastResult: null }), null);
  assert.equal(model.ytdlpBusy({ checking: true }), true);
  assert.equal(model.ytdlpBusy(null), false);
  const results = strings.t.settings.ytdlp.results;
  for (const code of ['deferred', 'offline', 'write-failed', 'not-updatable', 'timeout', 'canceled', 'failed']) assert.equal(typeof results[code], 'string', code);
});

test('yt-dlp status merge keeps a verified runtime', () => {
  const verified = { version: '2026.08.19', jsRuntime: { name: 'node', version: '24.21.0', ok: true } };
  const event = { version: '2026.08.19', checking: true, jsRuntime: { name: 'node', version: null, ok: null } };
  assert.deepEqual(model.mergeYtdlpStatus(verified, event), { ...event, jsRuntime: verified.jsRuntime });
  const broken = { version: '2026.08.19', jsRuntime: { name: 'node', version: null, ok: false } };
  assert.equal(model.mergeYtdlpStatus(verified, broken), broken);
  assert.equal(model.mergeYtdlpStatus(null, event), event);
  assert.equal(model.mergeYtdlpStatus(verified, null), verified);
});

test('runtime state and short versions', () => {
  assert.equal(model.runtimeState(null), 'none');
  assert.equal(model.runtimeState({ name: 'node', ok: null }), 'checking');
  assert.equal(model.runtimeState({ name: 'node', ok: true }), 'ok');
  assert.equal(model.runtimeState({ name: 'node', ok: false }), 'broken');
  assert.equal(model.shortVersion('24.21.0'), '24.21');
  assert.equal(model.shortVersion(null), null);
  assert.equal(strings.t.settings.ytdlp.runtimeBuiltIn(model.shortVersion('24.21.0')), 'Built-in (Node 24.21)');
});

test('update phases', () => {
  assert.equal(model.updatePhase(null), 'unknown');
  assert.equal(model.updatePhase({ phase: 'idle', available: false }), 'idle');
  assert.equal(model.updatePhase({ phase: 'idle', available: false, upToDate: true }), 'current');
  assert.equal(model.updatePhase({ phase: 'idle', available: false, error: 'check-failed' }), 'check-failed');
  assert.equal(model.updatePhase({ phase: 'available', available: true, error: 'check-failed' }), 'available');
  assert.equal(model.updatePhase({ phase: 'checking', available: true }), 'checking');
  assert.equal(model.updatePhase({ phase: 'downloading', available: true }), 'downloading');
  assert.equal(model.updatePhase({ phase: 'ready', available: true }), 'ready');
});

test('encoder rows follow codec order and flag broken encoders', () => {
  const view = {
    status: 'ready',
    available: { vp9: ['libvpx-vp9'], h264: ['h264_qsv', 'libx264'], hevc: [] },
    encoders: { h264_qsv: { label: 'Intel Quick Sync', hardware: true }, libx264: { label: 'Software (x264)', hardware: false } },
    broken: ['h264_qsv']
  };
  const rows = model.encoderRows(view);
  assert.deepEqual(
    rows.map((row) => row.codec),
    ['h264', 'hevc', 'vp9']
  );
  assert.deepEqual(rows[0].encoders[0], { name: 'h264_qsv', label: 'Intel Quick Sync', hardware: true, broken: true });
  assert.deepEqual(rows[2].encoders[0], { name: 'libvpx-vp9', label: 'libvpx-vp9', hardware: false, broken: false });
  assert.deepEqual(model.encoderRows(null), []);
});

test('diagnostics text summarizes the environment', () => {
  const text = model.diagnosticsText({
    info: { version: '0.1.0', packaged: true, electron: '44.4.1', chrome: '152.0.1', node: '24.21.0', platform: 'win32 10.0.26200', userData: 'C:\\Users\\A\\AppData\\Roaming\\Vidaro' },
    diag: { tools: { ffmpeg: '9.0.1' }, folders: { data: 'C:\\Users\\A\\AppData\\Local\\Vidaro' }, system: { cpu: 'Intel N97', cores: 4, memory: 16 * 1024 ** 3, gpu: ['Intel UHD'] } },
    ytdlp: { version: '2026.08.19', channel: 'stable', targetChannel: 'stable', usingBundled: false, jsRuntime: { name: 'node', version: '24.21.0', ok: true } },
    encoders: { status: 'ready', available: { h264: ['h264_qsv', 'libx264'] }, encoders: {}, broken: [] },
    settings: schema.defaults(),
    now: Date.UTC(2026, 8, 16)
  });
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'Vidaro 0.1.0 (installed)');
  assert.ok(lines.includes('CPU: Intel N97 (4 threads)'));
  assert.ok(lines.includes('Memory: 16 GB'));
  assert.ok(lines.includes('FFmpeg: 9.0.1'));
  assert.ok(lines.includes('yt-dlp: 2026.08.19 (stable)'));
  assert.ok(lines.includes('JavaScript runtime: node 24.21.0 · ok'));
  assert.ok(lines.includes('  h264: h264_qsv, libx264'));
  assert.ok(lines.includes('Proxy: none'));
  assert.ok(lines.includes('App data folder: C:\\Users\\A\\AppData\\Local\\Vidaro'));
  const empty = model.diagnosticsText({ info: null, diag: null, ytdlp: null, encoders: null, settings: null });
  assert.match(empty, /^Vidaro unknown \(unknown\)/);
  assert.match(empty, /FFmpeg: unknown/);
  assert.match(empty, /Encoders: unknown/);
});
