import { parseClock } from '../../lib/format.js';

export const QUALITY_CHIPS = ['best', '2160', '1440', '1080', '720', '480', '360'];
export const CONTAINERS = ['mp4', 'mkv', 'webm'];
export const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac'];
export const AUDIO_QUALITIES = ['best', '320', '256', '192', '128'];
export const COOKIE_MODES = ['none', 'browser', 'file'];
export const BROWSERS = ['edge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'];
export const TEMPLATES = ['title', 'channel-title', 'date-title', 'title-id', 'custom'];
export const MODES = ['av', 'video', 'audio'];
export const MAX_TEMPLATE = 512;
export const MAX_NAME = 180;
export const MIN_FRAGMENTS = 1;
export const MAX_FRAGMENTS = 16;
export const MAX_ITEMS = 5000;

export const DOWNLOAD_OPTION_KEYS = [
  'mode',
  'quality',
  'compatible',
  'container',
  'audioFormat',
  'audioQuality',
  'subtitles',
  'embedSubtitles',
  'subtitleLangs',
  'autoSubtitles',
  'embedThumbnail',
  'embedMetadata',
  'embedChapters',
  'sponsorBlock',
  'rateLimit',
  'concurrentFragments',
  'cookiesMode',
  'cookiesBrowser',
  'cookiesFile',
  'proxy'
];

export const OPTION_KEYS = [...DOWNLOAD_OPTION_KEYS, 'nameTemplate', 'customTemplate', 'numberPlaylist', 'afterPreset', 'keepOriginalAfterConvert'];

const HIGH_QUALITIES = new Set(['2160', '1440']);
const H264_YOUTUBE_MAX = 1080;
const LOSSLESS = new Set(['wav', 'flac']);
const AUDIO_ONLY_CONTAINERS = new Set(['mp3', 'm4a', 'wav', 'flac', 'opus']);
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);
const RATE_UNITS = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const SUBTITLE_LANGS = /^[A-Za-z0-9][A-Za-z0-9.*,_+-]{0,127}$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^[\w-]+(\.[\w-]+)+(:\d{1,5})?([/?#]|$)/;
const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;
const LIST_PATH = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/(videos|shorts|streams|playlists|featured))?\/?$/i;
const ELECTRON_PREFIX = /^Error invoking remote method '[^']*':\s*/;
const ERROR_NAME_PREFIX = /^(?:[A-Za-z]*Error):\s*/;

export function normalizeLink(text) {
  if (typeof text !== 'string') return null;
  let value = text.trim();
  if (!value || value.length > 8192 || /\s/.test(value)) return null;
  if (!SCHEME.test(value)) {
    if (!BARE_HOST.test(value)) return null;
    value = `https://${value}`;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function linkLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    return `${host}${rest}`;
  } catch {
    return String(url || '');
  }
}

export function looksLikeList(url) {
  try {
    const parsed = new URL(url);
    if (!YOUTUBE_HOST.test(parsed.hostname)) return false;
    if (parsed.pathname === '/playlist') return true;
    if (parsed.pathname === '/watch') return parsed.searchParams.has('list') && !parsed.searchParams.has('v');
    return LIST_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function sameLink(a, b) {
  if (!a || !b) return false;
  return normalizeLink(a) === normalizeLink(b);
}

export function pickDefaults(download) {
  const source = download && typeof download === 'object' ? download : {};
  const result = {};
  for (const key of OPTION_KEYS) result[key] = source[key];
  return result;
}

export function effectiveOptions(download, overrides) {
  return { ...pickDefaults(download), ...(overrides || {}) };
}

export function changedKeys(download, overrides) {
  const defaults = pickDefaults(download);
  return Object.keys(overrides || {}).filter((key) => OPTION_KEYS.includes(key) && overrides[key] !== defaults[key]);
}

export function setOverride(overrides, download, key, value) {
  if (!OPTION_KEYS.includes(key)) return overrides;
  const next = { ...overrides };
  if (pickDefaults(download)[key] === value) delete next[key];
  else next[key] = value;
  return next;
}

export function defaultsPatch(options) {
  const patch = {};
  for (const key of OPTION_KEYS) {
    if (options[key] !== undefined) patch[key] = options[key];
  }
  const rate = parseRateLimit(options.rateLimit);
  if (rate.valid) patch.rateLimit = rate.value;
  else delete patch.rateLimit;
  if (validProxy(options.proxy)) patch.proxy = String(options.proxy ?? '').trim();
  else delete patch.proxy;
  if (validSubtitleLangs(options.subtitleLangs)) patch.subtitleLangs = compactLangs(options.subtitleLangs);
  else delete patch.subtitleLangs;
  if (!validFragments(options.concurrentFragments)) delete patch.concurrentFragments;
  if (typeof patch.customTemplate === 'string') patch.customTemplate = patch.customTemplate.slice(0, MAX_TEMPLATE);
  if (patch.nameTemplate === 'custom' && templateInvalid(options)) {
    delete patch.nameTemplate;
    delete patch.customTemplate;
  }
  return patch;
}

export function parseRateLimit(text) {
  const value = String(text ?? '').trim();
  if (!value) return { value: '', valid: true };
  const match = /^(\d+(?:\.\d+)?)\s*([KMG])?(?:i?B)?(?:\/s)?$/i.exec(value);
  if (!match) return { value: '', valid: false };
  const unit = (match[2] || '').toUpperCase();
  const bytes = Number(match[1]) * RATE_UNITS[unit];
  if (!Number.isFinite(bytes) || bytes < 1024) return { value: '', valid: false };
  return { value: `${match[1]}${unit}`, valid: true, bytes };
}

export function validProxy(text) {
  const value = String(text ?? '').trim();
  if (!value) return true;
  if (value.length > 512 || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return PROXY_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function compactLangs(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

export function validSubtitleLangs(text) {
  return SUBTITLE_LANGS.test(compactLangs(text));
}

export function validFragments(value) {
  return Number.isInteger(value) && value >= MIN_FRAGMENTS && value <= MAX_FRAGMENTS;
}

export function parseSection(startText, endText, duration) {
  const startRaw = String(startText ?? '').trim();
  const endRaw = String(endText ?? '').trim();
  const start = startRaw ? parseClock(startRaw) : 0;
  let end = endRaw ? parseClock(endRaw) : null;
  if (start === null || !Number.isFinite(start)) return { section: null, error: 'start' };
  if (endRaw && (end === null || !Number.isFinite(end))) return { section: null, error: 'end' };
  const known = Number.isFinite(duration) && duration > 0;
  if (known && start >= duration) return { section: null, error: 'beyond' };
  if (end !== null && end <= start) return { section: null, error: 'order' };
  if (known && end !== null && end >= duration) end = null;
  if (start === 0 && end === null) return { section: null, error: null };
  return { section: { start, end }, error: null };
}

export function qualityAvailable(chip, heights) {
  if (chip === 'best') return true;
  if (!Array.isArray(heights) || heights.length === 0) return true;
  return heights.includes(Number(chip));
}

export function effectiveQuality(quality, heights) {
  const wanted = QUALITY_CHIPS.includes(String(quality)) ? String(quality) : 'best';
  if (wanted === 'best' || qualityAvailable(wanted, heights)) return wanted;
  const available = QUALITY_CHIPS.filter((chip) => chip !== 'best' && qualityAvailable(chip, heights)).map(Number);
  const below = available.filter((height) => height <= Number(wanted));
  if (below.length > 0) return String(Math.max(...below));
  if (available.length > 0) return String(Math.min(...available));
  return 'best';
}

export function effectiveMode(mode, info) {
  if (info && info.hasVideo === false) return 'audio';
  return MODES.includes(mode) ? mode : 'av';
}

export function isLossless(format) {
  return LOSSLESS.has(format);
}

export function compatibleApplies(options) {
  return options.mode !== 'audio' && options.container !== 'webm';
}

export function qualityWarning(options, quality, extractor) {
  if (!compatibleApplies(options) || options.compatible === false || !HIGH_QUALITIES.has(quality)) return null;
  return isYoutube(extractor) ? 'youtube' : 'generic';
}

export function isYoutube(extractor) {
  return /youtube/i.test(String(extractor || ''));
}

export function fileExtension(options) {
  return options.mode === 'audio' ? options.audioFormat || 'mp3' : options.container || 'mp4';
}

export function stripExtension(name, extension) {
  const value = String(name ?? '');
  const suffix = `.${extension}`;
  return value.toLowerCase().endsWith(suffix.toLowerCase()) ? value.slice(0, -suffix.length) : value;
}

export function cleanName(name, extension) {
  return stripExtension(String(name ?? '').trim(), extension).trim().slice(0, MAX_NAME * 2);
}

export function isAudioPreset(preset) {
  if (!preset) return false;
  return AUDIO_ONLY_CONTAINERS.has(preset.container) || preset.video?.mode === 'none';
}

export function presetWarning(preset, mode) {
  if (!preset) return null;
  if (mode === 'audio' && !isAudioPreset(preset)) return 'needs-video';
  return null;
}

export function findPreset(presets, id) {
  if (!id || !Array.isArray(presets)) return null;
  return presets.find((preset) => preset.id === id) || null;
}

export function estimateBytes(info, { mode, quality, section, compatible = false } = {}) {
  if (!info || info.kind !== 'video' || mode === 'audio') return null;
  const sizes = Array.isArray(info.sizes) ? info.sizes : [];
  const capped = compatible && isYoutube(info.extractor) && (quality === 'best' || !quality || Number(quality) > H264_YOUTUBE_MAX);
  const target = capped ? String(H264_YOUTUBE_MAX) : quality;
  let bytes = null;
  if (target === 'best' || !target) bytes = (compatible ? sizes[0]?.bytes : info.filesizeApprox) ?? info.filesizeApprox ?? sizes[0]?.bytes ?? null;
  else {
    const fit = sizes.find((entry) => entry.height <= Number(target));
    bytes = (fit ?? sizes[sizes.length - 1])?.bytes ?? null;
  }
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (section && Number.isFinite(info.duration) && info.duration > 0) {
    const end = section.end ?? info.duration;
    const ratio = Math.max(0, Math.min(1, (end - section.start) / info.duration));
    bytes *= ratio;
  }
  return Math.round(bytes);
}

export function draftIssues(options, { kind, count = 0, selectable = 0, sectionError = null, drm = false }) {
  const issues = [];
  if (drm) issues.push('drm');
  if (kind === 'playlist' && selectable === 0) issues.push('lists-only');
  else if (kind === 'playlist' && count === 0) issues.push('selection');
  if (kind === 'playlist' && count > MAX_ITEMS) issues.push('too-many');
  if (kind === 'video' && sectionError) issues.push('section');
  if (templateInvalid(options)) issues.push('template');
  if (options.subtitles && !validSubtitleLangs(options.subtitleLangs)) issues.push('subtitle-langs');
  if (!parseRateLimit(options.rateLimit).valid) issues.push('rate-limit');
  if (!validFragments(options.concurrentFragments)) issues.push('fragments');
  if (options.cookiesMode === 'file' && !options.cookiesFile) issues.push('cookies-file');
  if (!validProxy(options.proxy)) issues.push('proxy');
  return issues;
}

export function templateInvalid(options) {
  if (options.nameTemplate !== 'custom') return false;
  const text = String(options.customTemplate ?? '').trim();
  return !text || text.length > MAX_TEMPLATE || !text.includes('%(');
}

export function remoteMessage(error) {
  const raw = typeof error === 'string' ? error : error?.message;
  if (typeof raw !== 'string' || !raw) return null;
  return raw.replace(ELECTRON_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim() || null;
}
