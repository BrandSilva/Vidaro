const path = require('node:path');
const { sanitizeFileName } = require('../fsnames');
const { ytDlpLiteral } = require('./templates');
const { progressArgs } = require('./progress');

const MODES = ['av', 'video', 'audio'];
const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
const CONTAINERS = ['mp4', 'mkv', 'webm'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac'];
const AUDIO_QUALITIES = ['best', '320', '256', '192', '128'];
const COLLISIONS = ['rename', 'overwrite', 'skip'];
const COOKIE_MODES = ['none', 'browser', 'file'];
const BROWSERS = ['edge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium', 'whale'];
const CHANNELS = ['stable', 'nightly'];
const JS_RUNTIMES = ['node', 'deno', 'quickjs', 'bun'];
const SPONSORBLOCK_CATEGORIES = 'sponsor,selfpromo,interaction';
const MAX_URL_LENGTH = 8192;
const MAX_FRAGMENTS = 16;
const TEMP_NAME_EXTRA = 48;

const COMPATIBLE_SORT = ['vcodec:h264', 'lang', 'quality', 'res', 'fps', 'hdr:12', 'acodec:aac'];

const REMUX_RULES = {
  mp4: 'mp4>mp4/m4v>mp4/mov>mp4/webm>mp4/flv>mp4/mkv',
  mkv: 'mkv',
  webm: 'webm>webm/mkv'
};

const MERGE_FORMATS = { mp4: 'mp4', mkv: 'mkv', webm: 'webm/mkv' };

const AUDIO_SELECTORS = {
  mp3: 'ba[acodec^=mp3]/ba/b',
  m4a: 'ba[ext=m4a]/ba/b',
  opus: 'ba[acodec^=opus]/ba/b',
  wav: 'ba/b',
  flac: 'ba/b'
};

const LOSSLESS_AUDIO = ['wav', 'flac'];
const THUMBNAIL_AUDIO = ['mp3', 'm4a', 'opus', 'flac'];

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) fail(`${name} is not supported`);
  return value;
}

function absolutePath(value, name) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 32767 || value.includes('\0')) fail(`${name} is invalid`);
  if (!path.win32.isAbsolute(value) || !/^([a-zA-Z]:[\\/]|\\\\[^\\/])/.test(value)) fail(`${name} must be an absolute path`);
  return path.win32.normalize(value);
}

function webUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL_LENGTH) fail('The link is invalid');
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail('The link is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail('The link must start with http or https');
  if (!parsed.hostname) fail('The link is invalid');
  return parsed.toString();
}

function quality(value) {
  const normalized = typeof value === 'number' ? String(value) : value ?? 'best';
  return oneOf(normalized, QUALITIES, 'Quality');
}

function rateLimit(value) {
  if (value === undefined || value === null || value === '' || value === 0) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1024) fail('Rate limit is invalid');
    return String(Math.round(value));
  }
  if (typeof value !== 'string') fail('Rate limit is invalid');
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMG])?\s*$/i.exec(value);
  if (!match) fail('Rate limit is invalid');
  const factor = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[(match[2] || '').toUpperCase()] ?? 1;
  if (Number(match[1]) * factor < 1024) fail('Rate limit is too low');
  return `${match[1]}${(match[2] || '').toUpperCase()}`;
}

function fragments(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_FRAGMENTS) fail('Concurrent fragments must be between 1 and 16');
  return value;
}

function subtitleLangs(value) {
  const langs = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9.*,_+-]{0,127}$/.test(langs)) fail('Subtitle languages are invalid');
  return langs;
}

function proxy(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('Proxy is invalid');
  const address = value.trim();
  if (!address) return null;
  if (address.length > 512 || /\s/.test(address)) fail('Proxy is invalid');
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    fail('Proxy is invalid');
  }
  if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) {
    fail('Proxy must be an http, https or socks address');
  }
  return address;
}

function seconds(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e7) fail(`${name} is invalid`);
  return value;
}

function millis(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function section(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) fail('Section is invalid');
  const start = millis(seconds(value.start, 'Section start') ?? 0);
  const end = millis(seconds(value.end, 'Section end'));
  if (end !== null && end <= start) fail('Section end must be after the start');
  if (start === 0 && end === null) return null;
  return { start, end };
}

function jsRuntimeArgs(runtime) {
  if (runtime === undefined || runtime === null) return [];
  if (!isPlainObject(runtime)) fail('JavaScript runtime is invalid');
  const name = oneOf(runtime.name, JS_RUNTIMES, 'JavaScript runtime');
  const location = absolutePath(runtime.path, 'JavaScript runtime path');
  return ['--no-js-runtimes', '--js-runtimes', `${name}:${location}`];
}

function baseArgs(env = {}) {
  if (!isPlainObject(env)) fail('Environment is invalid');
  const cache = env.cacheDir ? ['--cache-dir', absolutePath(env.cacheDir, 'Cache folder')] : ['--no-cache-dir'];
  return ['--ignore-config', '--no-plugin-dirs', '--color', 'never', '--encoding', 'utf-8', ...jsRuntimeArgs(env.jsRuntime), ...cache];
}

function networkArgs(options = {}, env = {}) {
  const args = [];
  const mode = oneOf(options.cookiesMode ?? 'none', COOKIE_MODES, 'Cookies mode');
  if (mode === 'browser') args.push('--cookies-from-browser', oneOf(options.cookiesBrowser, BROWSERS, 'Browser'));
  if (mode === 'file') args.push('--cookies', absolutePath(env.cookiesFile || options.cookiesFile, 'Cookies file'));
  const proxyUrl = proxy(options.proxy);
  if (proxyUrl) args.push('--proxy', proxyUrl);
  return args;
}

function sortArgs(cap, compatible) {
  if (compatible) {
    const order = cap === 'best' ? COMPATIBLE_SORT : [`res:${cap}`, ...COMPATIBLE_SORT.filter((field) => field !== 'res')];
    return ['-S', order.join(',')];
  }
  return cap === 'best' ? [] : ['-S', `res:${cap}`];
}

function formatArgs(options = {}) {
  if (!isPlainObject(options)) fail('Options are invalid');
  const mode = oneOf(options.mode ?? 'av', MODES, 'Mode');
  if (mode === 'audio') {
    const format = oneOf(options.audioFormat ?? 'mp3', AUDIO_FORMATS, 'Audio format');
    const level = oneOf(options.audioQuality ?? 'best', AUDIO_QUALITIES, 'Audio quality');
    const args = ['-f', AUDIO_SELECTORS[format], '-x', '--audio-format', format];
    if (!LOSSLESS_AUDIO.includes(format)) args.push('--audio-quality', level === 'best' ? '0' : `${level}K`);
    return args;
  }
  const cap = quality(options.quality);
  const container = oneOf(options.container ?? 'mp4', CONTAINERS, 'Container');
  const compatible = options.compatible !== false && container !== 'webm';
  let selector;
  if (container === 'webm') selector = mode === 'av' ? 'bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b' : 'bv[ext=webm]/bv/bv*';
  else selector = mode === 'av' ? 'bv*+ba/b' : 'bv/bv*';
  return [
    '-f',
    selector,
    ...sortArgs(cap, compatible),
    '--merge-output-format',
    MERGE_FORMATS[container],
    '--remux-video',
    REMUX_RULES[container]
  ];
}

function expectedExtension(options = {}) {
  const mode = oneOf(options.mode ?? 'av', MODES, 'Mode');
  if (mode === 'audio') return oneOf(options.audioFormat ?? 'mp3', AUDIO_FORMATS, 'Audio format');
  return oneOf(options.container ?? 'mp4', CONTAINERS, 'Container');
}

function subtitleArgs(options, mode, container) {
  if (options.subtitles !== true) return [];
  const args = ['--write-subs'];
  if (options.autoSubtitles === true) args.push('--write-auto-subs');
  args.push('--sub-langs', subtitleLangs(options.subtitleLangs ?? 'en.*,es.*'));
  if (options.embedSubtitles !== false && mode !== 'audio' && CONTAINERS.includes(container)) args.push('--embed-subs', '--compat-options', 'no-keep-subs');
  else args.push('--convert-subs', 'srt');
  return args;
}

function embedArgs(options, mode, extension) {
  const args = [];
  const thumbnailOk = mode === 'audio' ? THUMBNAIL_AUDIO.includes(extension) : extension !== 'webm';
  if (options.embedThumbnail === true && thumbnailOk) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
  if (options.embedMetadata === true) args.push('--embed-metadata', '--no-embed-info-json');
  args.push(options.embedChapters === true ? '--embed-chapters' : '--no-embed-chapters');
  return args;
}

function buildDownloadArgs(spec, env) {
  if (!isPlainObject(spec)) fail('Download spec is invalid');
  if (!isPlainObject(env)) fail('Environment is invalid');
  const url = webUrl(spec.url);
  const options = spec.options ?? {};
  if (!isPlainObject(options)) fail('Options are invalid');
  const output = spec.output;
  if (!isPlainObject(output)) fail('Output is invalid');
  const folder = absolutePath(output.folder, 'Output folder');
  if (typeof output.name !== 'string' || !output.name || sanitizeFileName(output.name, { fallback: '', maxLength: 255 }) !== output.name) {
    fail('Output name must be a clean file name');
  }
  const collision = oneOf(output.collision ?? 'rename', COLLISIONS, 'Collision policy');
  const ffmpegDir = absolutePath(env.ffmpegDir, 'ffmpeg folder');
  const tempDir = absolutePath(env.tempDir, 'Temporary folder');
  const mode = oneOf(options.mode ?? 'av', MODES, 'Mode');
  const extension = expectedExtension(options);
  const range = section(options.section);
  const rate = rateLimit(options.rateLimit);
  const fragmentCount = fragments(options.concurrentFragments);

  const args = [
    ...baseArgs(env),
    ...progressArgs(),
    '--ffmpeg-location',
    ffmpegDir,
    '--no-playlist',
    '--abort-on-error',
    '-P',
    `home:${folder}`,
    '-P',
    `temp:${tempDir}`,
    '-o',
    `${ytDlpLiteral(output.name)}.%(ext)s`,
    '--no-mtime',
    '--file-access-retries',
    '10'
  ];
  if (collision === 'overwrite' && env.resume !== true) args.push('--force-overwrites');
  args.push(...formatArgs(options));
  args.push(...subtitleArgs(options, mode, extension));
  args.push(...embedArgs(options, mode, extension));
  if (options.sponsorBlock === true && !range) args.push('--sponsorblock-remove', SPONSORBLOCK_CATEGORIES);
  if (range) args.push('--download-sections', `*${range.start}-${range.end === null ? 'inf' : range.end}`, '--force-keyframes-at-cuts');
  if (rate) args.push('-r', rate);
  if (fragmentCount) args.push('-N', String(fragmentCount));
  args.push(...networkArgs(options, env));
  args.push('--', url);
  return args;
}

function infoArgs(url, { playlist = false, env = {}, options = {}, maxEntries = null } = {}) {
  const link = webUrl(url);
  const args = [...baseArgs(env), '-J', '--no-download'];
  args.push(...(playlist ? ['--flat-playlist', '--yes-playlist'] : ['--no-playlist']));
  if (maxEntries !== null) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) fail('Entry limit is invalid');
    args.push('-I', `1:${maxEntries}`);
  }
  args.push(...networkArgs(options, env));
  args.push('--', link);
  return args;
}

function updateArgs(channel = 'stable') {
  oneOf(channel, CHANNELS, 'Update channel');
  return ['--ignore-config', '--no-plugin-dirs', '--color', 'never', '--encoding', 'utf-8', '--update-to', `${channel}@latest`];
}

function versionArgs() {
  return ['--ignore-config', '--no-plugin-dirs', '--version'];
}

function processEnv(env = {}) {
  const runtime = isPlainObject(env.jsRuntime) && isPlainObject(env.jsRuntime.env) ? env.jsRuntime.env : {};
  const result = {};
  for (const [key, value] of Object.entries(runtime)) {
    if (/^[A-Z_][A-Z0-9_]*$/.test(key) && typeof value === 'string') result[key] = value;
  }
  return result;
}

function folderPrefix(folder, name) {
  return path.win32.join(absolutePath(folder, name), 'x').length - 1;
}

function tempReserve({ folder, tempDir, extension = '' } = {}) {
  const ext = typeof extension === 'string' && extension ? extension.replace(/^\.?/, '.').length : 0;
  const home = folderPrefix(folder, 'Output folder');
  const temp = folderPrefix(tempDir, 'Temporary folder');
  return Math.max(0, temp + TEMP_NAME_EXTRA - home - ext);
}

function sectionDuration(options = {}, duration = null) {
  const range = section(options.section);
  const total = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null;
  if (!range) return total;
  const end = range.end ?? total;
  if (end === null) return null;
  const length = Math.min(end, total ?? end) - range.start;
  return length > 0 ? length : null;
}

module.exports = {
  buildDownloadArgs,
  formatArgs,
  infoArgs,
  updateArgs,
  versionArgs,
  processEnv,
  expectedExtension,
  sectionDuration,
  tempReserve,
  TEMP_NAME_EXTRA,
  MODES,
  QUALITIES,
  CONTAINERS,
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  BROWSERS,
  CHANNELS,
  SPONSORBLOCK_CATEGORIES
};
