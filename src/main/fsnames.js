const path = require('node:path');

const MAX_PATH_BUDGET = 250;
const DEFAULT_MAX_LENGTH = 180;
const MAX_COPIES = 9999;

const LOOK_ALIKES = {
  '<': '＜',
  '>': '＞',
  ':': '：',
  '"': '＂',
  '/': '⧸',
  '\\': '⧹',
  '|': '｜',
  '?': '？',
  '*': '＊'
};

const RESERVED_STEM = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const INVISIBLE = /[\x00-\x1f\x7f-\x9f\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/gu;
const EXTENSION = /^\.[A-Za-z0-9]{1,10}$/;
const ROOTED = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/])/;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return '';
  let result = '';
  for (const { segment } of segmenter.segment(text)) {
    if (result.length + segment.length > maxLength) break;
    result += segment;
  }
  return result;
}

function trimEdges(text) {
  return text.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
}

function isReservedName(name) {
  const stem = String(name).split('.')[0].trimEnd();
  return RESERVED_STEM.test(stem);
}

function sanitizeFileName(name, { fallback = 'download', maxLength = DEFAULT_MAX_LENGTH } = {}) {
  const limit = Number.isInteger(maxLength) && maxLength > 0 ? Math.min(maxLength, 255) : DEFAULT_MAX_LENGTH;
  let result = typeof name === 'string' || typeof name === 'number' ? String(name) : '';
  result = result.toWellFormed().normalize('NFC');
  result = result.replace(/[\t\n\r\v\f]/g, ' ').replace(INVISIBLE, '');
  result = result.replace(/[<>:"/\\|?*]/g, (char) => LOOK_ALIKES[char]);
  result = result.replace(/\s+/g, ' ');
  result = trimEdges(truncateText(trimEdges(result), limit));
  if (isReservedName(result)) result = trimEdges(`_${truncateText(result, limit - 1)}`);
  if (result) return result;
  if (fallback === null || fallback === undefined || fallback === '') return '';
  return sanitizeFileName(fallback, { fallback: 'download', maxLength: limit });
}

function splitExt(fileName) {
  const name = String(fileName ?? '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  const ext = name.slice(dot);
  if (!EXTENSION.test(ext)) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext };
}

function normalizeExt(ext) {
  if (ext === undefined || ext === null || ext === '') return '';
  const value = String(ext).startsWith('.') ? String(ext) : `.${ext}`;
  if (!EXTENSION.test(value)) throw new TypeError('Invalid file extension');
  return value;
}

function pathTooLong() {
  const error = new RangeError('The folder path is too long for a file name');
  error.code = 'path-too-long';
  return error;
}

function uniquePath(folder, base, ext, existsFn, { maxPath = MAX_PATH_BUDGET, reserve = 0, maxLength = DEFAULT_MAX_LENGTH } = {}) {
  if (typeof folder !== 'string' || !ROOTED.test(folder) || !path.win32.isAbsolute(folder)) throw new TypeError('Folder must be an absolute path');
  if (typeof existsFn !== 'function') throw new TypeError('existsFn must be a function');
  const extension = normalizeExt(ext);
  const cleanFolder = path.win32.normalize(folder);
  const clean = sanitizeFileName(base, { maxLength });
  const prefix = path.win32.join(cleanFolder, 'x').length - 1;
  const budget = Number.isFinite(maxPath) ? Math.floor(maxPath) : MAX_PATH_BUDGET;
  const room = budget - (Number.isFinite(reserve) && reserve > 0 ? Math.ceil(reserve) : 0) - prefix - extension.length;
  for (let copy = 1; copy <= MAX_COPIES; copy += 1) {
    const suffix = copy === 1 ? '' : ` (${copy})`;
    const limit = room - suffix.length;
    const fit = limit > 0 ? sanitizeFileName(clean, { fallback: '', maxLength: limit }) : '';
    if (!fit) throw pathTooLong();
    const candidate = path.win32.join(cleanFolder, `${fit}${suffix}${extension}`);
    if (!existsFn(candidate)) return candidate;
  }
  throw new RangeError('Too many files with the same name');
}

module.exports = {
  sanitizeFileName,
  splitExt,
  uniquePath,
  truncateText,
  isReservedName,
  MAX_PATH_BUDGET,
  DEFAULT_MAX_LENGTH
};
