const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFileName, splitExt, uniquePath } = require('../fsnames');

const PARTIAL_SUFFIX = '.partial';
const TOKEN = /\{(name|preset|resolution|date)\}/gi;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateText(date) {
  if (!date) return '';
  if (typeof date === 'string') return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function resolutionToken(width, height) {
  if (!(width > 0) || !(height > 0)) return '';
  return `${Math.min(width, height)}p`;
}

const EMPTY_MARK = '\x00';
const MARK_RUN = /\x00(?:[\s_-]*\x00)+/g;
const EMPTY_BRACKETS = /\[[\s_-]*\x00[\s_-]*\]|\([\s_-]*\x00[\s_-]*\)/g;

function collapseMarks(text) {
  let current = text;
  let previous = null;
  while (current !== previous) {
    previous = current;
    current = current.replace(MARK_RUN, EMPTY_MARK).replace(EMPTY_BRACKETS, EMPTY_MARK);
  }
  return current;
}

function tidy(text) {
  if (!text.includes(EMPTY_MARK)) return text.trim();
  return collapseMarks(text)
    .replace(/([[(])[\s_-]*\x00[\s_-]*/g, '$1')
    .replace(/[\s_-]*\x00[\s_-]*([\])])/g, '$1')
    .replace(/[\s_-]*\x00[\s_-]*/g, (match, offset, whole) => {
      if (offset === 0 || offset + match.length === whole.length) return '';
      const mark = match.indexOf(EMPTY_MARK);
      const before = match.slice(0, mark);
      const after = match.slice(mark + 1);
      if (match.replace(/[\s\x00]/g, '')) return before.trim() ? before : after;
      return /\s/.test(match) ? ' ' : '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function renderOutputName(template, { name = '', preset = '', resolution = '', date = null } = {}) {
  const clean = (value) => String(value || '').replaceAll(EMPTY_MARK, '');
  const values = { name: clean(name), preset: clean(preset), resolution: clean(resolution), date: dateText(date) };
  const source = typeof template === 'string' && template.trim() ? template : '{name}';
  const rendered = tidy(source.replace(TOKEN, (match, key) => values[key.toLowerCase()] || EMPTY_MARK));
  const fallback = sanitizeFileName(values.name, { fallback: 'video' });
  return sanitizeFileName(rendered, { fallback });
}

function samePath(a, b) {
  return path.win32.resolve(a).normalize('NFC').toLowerCase() === path.win32.resolve(b).normalize('NFC').toLowerCase();
}

function partialPathFor(finalPath) {
  return `${finalPath}${PARTIAL_SUFFIX}`;
}

function outputPathFor({
  inputPath,
  folder = null,
  useSourceFolder = false,
  template = '{name}',
  baseName = null,
  preset = '',
  resolution = '',
  date = null,
  extension,
  collision = 'rename',
  exists = fs.existsSync,
  reserved = [],
  replaceInput = false
}) {
  const targetFolder = useSourceFolder || !folder ? path.win32.dirname(inputPath) : folder;
  const sourceName = splitExt(path.win32.basename(inputPath)).base;
  const literal = typeof baseName === 'string' ? sanitizeFileName(baseName, { fallback: '' }) : '';
  const base = literal || renderOutputName(template, { name: sourceName, preset, resolution, date });
  const taken = new Set([...reserved].map((item) => path.win32.resolve(item).normalize('NFC').toLowerCase()));
  const isInput = (candidate) => !replaceInput && samePath(candidate, inputPath);
  const occupied = (candidate) => !(replaceInput && samePath(candidate, inputPath)) && exists(candidate);
  const isReserved = (candidate) => taken.has(path.win32.resolve(candidate).normalize('NFC').toLowerCase());
  const options = { reserve: PARTIAL_SUFFIX.length };
  if (collision === 'overwrite' || collision === 'skip') {
    const direct = uniquePath(targetFolder, base, extension, (candidate) => isInput(candidate) || isReserved(candidate), options);
    const present = occupied(direct);
    if (collision === 'skip' && present) return { path: direct, skip: true, overwrite: false };
    return { path: direct, skip: false, overwrite: present };
  }
  const free = uniquePath(
    targetFolder,
    base,
    extension,
    (candidate) => isInput(candidate) || isReserved(candidate) || occupied(candidate) || exists(partialPathFor(candidate)),
    options
  );
  return { path: free, skip: false, overwrite: false };
}

module.exports = { renderOutputName, outputPathFor, partialPathFor, samePath, resolutionToken, dateText, PARTIAL_SUFFIX };
