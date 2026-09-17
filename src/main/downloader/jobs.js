const path = require('node:path');
const crypto = require('node:crypto');
const { sanitizeFileName } = require('../fsnames');
const { renderTemplate, applyNumbering, NAME_TEMPLATES, MAX_TEMPLATE_LENGTH } = require('./templates');
const { buildDownloadArgs, MODES, QUALITIES, CONTAINERS, AUDIO_FORMATS, AUDIO_QUALITIES, BROWSERS } = require('./args');

const COLLISIONS = ['rename', 'overwrite', 'skip'];
const COOKIE_MODES = ['none', 'browser', 'file'];
const MAX_ITEMS = 5000;
const MAX_TEXT = 1024;
const MAX_URL = 8192;
const MAX_PATH = 32767;
const CHECK_ENV = Object.freeze({ ffmpegDir: 'C:\\Vidaro\\bin', tempDir: 'C:\\Vidaro\\temp' });

const OPTION_DEFAULTS = Object.freeze({
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
  section: null
});

const BOOLEAN_OPTIONS = ['compatible', 'subtitles', 'embedSubtitles', 'autoSubtitles', 'embedThumbnail', 'embedMetadata', 'embedChapters', 'sponsorBlock'];

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(value, allowed, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value)) fail(`${name} is not supported`);
  return value;
}

function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function webUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL) fail('The link is invalid');
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail('The link is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail('The link must start with http or https');
  return parsed.toString();
}

function optionalWebUrl(value, { secure = false } = {}) {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  try {
    const parsed = new URL(value);
    if (secure ? parsed.protocol !== 'https:' : parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function absoluteFolder(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > MAX_PATH || value.includes('\0')) fail('Output folder is invalid');
  if (!path.win32.isAbsolute(value) || !/^([a-zA-Z]:[\\/]|\\\\[^\\/])/.test(value)) fail('Output folder must be an absolute path');
  return path.win32.normalize(value);
}

function normalizeQuality(value) {
  const text = typeof value === 'number' ? String(value) : value;
  return pick(text, QUALITIES, OPTION_DEFAULTS.quality, 'Quality');
}

function normalizeSection(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) fail('Section is invalid');
  const start = value.start === undefined || value.start === null ? 0 : value.start;
  const end = value.end === undefined ? null : value.end;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) fail('Section start is invalid');
  if (end !== null && (typeof end !== 'number' || !Number.isFinite(end) || end <= start)) fail('Section end must be after the start');
  if (start === 0 && end === null) return null;
  return { start, end };
}

function normalizeOptions(raw = {}) {
  if (!isPlainObject(raw)) fail('Options are invalid');
  const options = {
    mode: pick(raw.mode, MODES, OPTION_DEFAULTS.mode, 'Mode'),
    quality: normalizeQuality(raw.quality),
    container: pick(raw.container, CONTAINERS, OPTION_DEFAULTS.container, 'Container'),
    audioFormat: pick(raw.audioFormat, AUDIO_FORMATS, OPTION_DEFAULTS.audioFormat, 'Audio format'),
    audioQuality: pick(raw.audioQuality, AUDIO_QUALITIES, OPTION_DEFAULTS.audioQuality, 'Audio quality')
  };
  for (const key of BOOLEAN_OPTIONS) options[key] = typeof raw[key] === 'boolean' ? raw[key] : OPTION_DEFAULTS[key];
  options.subtitleLangs = typeof raw.subtitleLangs === 'string' && raw.subtitleLangs.trim() ? raw.subtitleLangs.replace(/\s+/g, '') : OPTION_DEFAULTS.subtitleLangs;
  if (typeof raw.rateLimit === 'number') options.rateLimit = raw.rateLimit;
  else options.rateLimit = typeof raw.rateLimit === 'string' ? raw.rateLimit.trim() : '';
  options.concurrentFragments = raw.concurrentFragments ?? OPTION_DEFAULTS.concurrentFragments;
  options.cookiesMode = pick(raw.cookiesMode, COOKIE_MODES, OPTION_DEFAULTS.cookiesMode, 'Cookies mode');
  options.cookiesBrowser = pick(raw.cookiesBrowser, BROWSERS, OPTION_DEFAULTS.cookiesBrowser, 'Browser');
  options.cookiesFile = options.cookiesMode === 'file' ? raw.cookiesFile : '';
  options.proxy = typeof raw.proxy === 'string' ? raw.proxy.trim() : '';
  options.section = normalizeSection(raw.section);
  return options;
}

function normalizeInfo(info, url) {
  const source = isPlainObject(info) ? info : {};
  if (source.kind === 'playlist') fail('Open the playlist to choose its videos');
  const index = positive(source.playlistIndex) ?? positive(source.index);
  return {
    id: cleanText(source.id, 256),
    title: cleanText(source.title),
    channel: cleanText(source.channel, 512),
    duration: positive(source.duration),
    thumbnail: optionalWebUrl(source.thumbnail, { secure: true }),
    extractor: cleanText(source.extractor, 128),
    webpageUrl: optionalWebUrl(source.webpageUrl) ?? url,
    playlistIndex: index !== null && Number.isInteger(index) ? index : null
  };
}

function nameKey(name) {
  return name.normalize('NFC').toLowerCase();
}

function uniqueInBatch(name, used) {
  let candidate = name;
  for (let copy = 2; used.has(nameKey(candidate)); copy += 1) {
    const suffix = ` (${copy})`;
    candidate = `${sanitizeFileName(name, { fallback: 'download', maxLength: 180 - suffix.length })}${suffix}`;
  }
  used.add(nameKey(candidate));
  return candidate;
}

function normalizeAfter(after) {
  if (after === undefined || after === null) return null;
  if (!isPlainObject(after)) fail('The conversion after download is invalid');
  const preset = after.preset;
  if (!isPlainObject(preset) || typeof preset.id !== 'string' || typeof preset.name !== 'string' || typeof preset.container !== 'string') {
    fail('The conversion preset is invalid');
  }
  return { preset: structuredClone(preset), keepOriginal: after.keepOriginal !== false };
}

function defaultGroupId() {
  return `g${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function buildDownloadJobs({ items, options, output, after = null, group = null } = {}, { makeGroupId = defaultGroupId } = {}) {
  if (!Array.isArray(items) || items.length === 0) fail('Nothing to download');
  if (items.length > MAX_ITEMS) fail('Too many videos at once');
  if (!isPlainObject(output)) fail('Output is invalid');
  const folder = absoluteFolder(output.folder);
  const collision = pick(output.collision, COLLISIONS, 'rename', 'Collision policy');
  const cleanOptions = normalizeOptions(options ?? {});
  const chain = normalizeAfter(after);
  const groupTitle = isPlainObject(group) ? cleanText(group.title) : null;
  const groupId = isPlainObject(group) ? makeGroupId() : null;
  const used = new Set();
  return items.map((item) => {
    if (!isPlainObject(item)) fail('Download item is invalid');
    const url = webUrl(item.url);
    const info = normalizeInfo(item.info, url);
    const fallback = sanitizeFileName(info.title ?? '', { fallback: info.id ?? 'download' });
    const name = uniqueInBatch(sanitizeFileName(typeof item.name === 'string' ? item.name : '', { fallback }), used);
    const spec = { url, info, options: structuredClone(cleanOptions), output: { folder, name, collision }, after: chain ? structuredClone(chain) : null };
    buildDownloadArgs(spec, CHECK_ENV);
    const input = { kind: 'download', title: name, spec };
    if (groupId) {
      input.groupId = groupId;
      if (groupTitle) input.groupTitle = groupTitle;
    }
    return input;
  });
}

function templateId(template) {
  return typeof template === 'string' && Object.hasOwn(NAME_TEMPLATES, template) ? template : 'title';
}

function customText(custom) {
  return typeof custom === 'string' ? custom.slice(0, MAX_TEMPLATE_LENGTH) : null;
}

function suggestName({ info, template, custom, index = null, count = null } = {}) {
  const name = renderTemplate(templateId(template), isPlainObject(info) ? info : {}, customText(custom));
  if (!Number.isInteger(index) || index < 1) return name;
  return applyNumbering(name, index, Number.isInteger(count) && count > 0 ? count : index);
}

function suggestNames(request = {}) {
  if (!isPlainObject(request)) fail('Name request is invalid');
  if (!Array.isArray(request.items)) return suggestName(request);
  if (request.items.length > MAX_ITEMS) fail('Too many videos at once');
  const count = Number.isInteger(request.count) && request.count > 0 ? request.count : request.items.length;
  return request.items.map((item) =>
    suggestName({
      info: isPlainObject(item) ? item.info : null,
      template: request.template,
      custom: request.custom,
      index: request.numbered === true && isPlainObject(item) ? item.index : null,
      count
    })
  );
}

module.exports = { buildDownloadJobs, normalizeOptions, suggestName, suggestNames, OPTION_DEFAULTS };
