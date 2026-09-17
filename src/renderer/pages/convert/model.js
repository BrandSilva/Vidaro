import { t } from '../../strings/index.js';
import { baseName, formatClock, formatDuration, parseClock, stripExtension } from '../../lib/format.js';

export const MAX_FILES = 2000;
export const PREVIEW_LIMIT = 60;
export const TEMPLATE_MAX = 256;
export const NAME_TOKEN = '{name}';

const INFO_CHIPS = new Set(['interlaced', 'hdr', 'anamorphic', 'rotated', 'bitmap-subtitles', 'soft-telecine']);
const CHIP_ORDER = ['field-order-unknown', 'interlaced', 'soft-telecine', 'vfr', 'duration-estimated', 'no-audio', 'hdr', 'anamorphic', 'rotated', 'bitmap-subtitles'];
const TOKEN = /\{(name|preset|resolution|date)\}/gi;
const EMPTY_MARK = '\x00';
const MARK_RUN = /\x00(?:[\s_-]*\x00)+/g;
const EMPTY_BRACKETS = /\[[\s_-]*\x00[\s_-]*\]|\([\s_-]*\x00[\s_-]*\)/g;
const LOOK_ALIKES = { '<': '＜', '>': '＞', ':': '：', '"': '＂', '/': '⧸', '\\': '⧹', '|': '｜', '?': '？', '*': '＊' };
const INVISIBLE = /[\x00-\x1f\x7f-\x9f\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/gu;

export function fileKey(filePath) {
  return String(filePath || '')
    .replace(/\//g, '\\')
    .normalize('NFC')
    .toLowerCase();
}

export function mergePaths(existing, paths, max = MAX_FILES) {
  const known = new Set(existing);
  const accepted = [];
  let duplicates = 0;
  let overflow = 0;
  for (const filePath of paths || []) {
    if (typeof filePath !== 'string' || !filePath) continue;
    const key = fileKey(filePath);
    if (known.has(key)) {
      duplicates += 1;
      continue;
    }
    if (known.size >= max) {
      overflow += 1;
      continue;
    }
    known.add(key);
    accepted.push({ path: filePath, key });
  }
  return { accepted, duplicates, overflow };
}

export function effectiveDuration(media, trim) {
  const duration = media && media.duration > 0 ? media.duration : null;
  if (!trim) return duration;
  const start = trim.start > 0 ? trim.start : 0;
  const end = trim.end > 0 ? trim.end : duration;
  if (end === null) return null;
  return Math.max(0, end - start);
}

export function listTotals(files) {
  const totals = { count: files.length, ready: 0, probing: 0, failed: 0, size: 0, duration: 0 };
  for (const file of files) {
    if (file.status === 'probing') totals.probing += 1;
    else if (file.status === 'error') totals.failed += 1;
    else if (file.status === 'ready') {
      totals.ready += 1;
      totals.size += file.media && file.media.size > 0 ? file.media.size : 0;
      totals.duration += effectiveDuration(file.media, file.trim) || 0;
    }
  }
  return totals;
}

export function mediaChips(media, analysis) {
  if (!media) return [];
  const codes = new Set((media.warnings || []).filter((code) => code !== 'no-video'));
  const video = media.video;
  if (video && (video.fieldOrder === 'tff' || video.fieldOrder === 'bff')) codes.add('interlaced');
  if (video && video.softTelecine) codes.add('soft-telecine');
  if (!video) codes.delete('no-audio');
  const analyzed = analysis && analysis.status === 'done' && analysis.result;
  if (analyzed) {
    codes.delete('field-order-unknown');
    codes.delete('interlaced');
  }
  return CHIP_ORDER.filter((code) => codes.has(code)).map((code) => ({
    code,
    tone: INFO_CHIPS.has(code) ? 'info' : 'warning',
    analyze: code === 'field-order-unknown'
  }));
}

export function analysisView(result) {
  if (!result) return null;
  if (result.telecine) return { key: 'telecine', tone: 'accent' };
  if (result.verdict === 'progressive') return { key: 'progressive', tone: 'success' };
  if (result.verdict === 'tff' || result.verdict === 'bff') return { key: result.verdict, tone: 'info' };
  return { key: 'unknown', tone: 'warning' };
}

function readClock(text) {
  const value = String(text || '').trim();
  if (!value) return { value: null, ok: true };
  const seconds = parseClock(value);
  return Number.isFinite(seconds) && seconds >= 0 ? { value: seconds, ok: true } : { value: null, ok: false };
}

export function parseTrim(startText, endText, media) {
  const errors = t.convert.trimErrors;
  const start = readClock(startText);
  const end = readClock(endText);
  if (!start.ok || !end.ok) return { ok: false, error: errors.format, field: !start.ok ? 'start' : 'end' };
  const duration = media && media.durationReliable && media.duration > 0 ? media.duration : null;
  const from = start.value > 0 ? Math.round(start.value * 1000) / 1000 : null;
  let to = end.value !== null ? Math.round(end.value * 1000) / 1000 : null;
  if (duration !== null) {
    if (from !== null && from >= duration) return { ok: false, error: errors.beyond(formatDuration(duration)), field: 'start' };
    if (to !== null && to > duration + 0.0005) return { ok: false, error: errors.beyond(formatDuration(duration)), field: 'end' };
    if (to !== null && to >= duration - 0.0005) to = null;
  }
  if (to !== null && to <= (from || 0)) return { ok: false, error: errors.startAfterEnd, field: 'end' };
  if (from === null && to === null) return { ok: true, trim: null };
  return { ok: true, trim: { start: from, end: to } };
}

export function trimFields(trim) {
  return {
    start: trim && trim.start > 0 ? formatClock(trim.start, true) : '',
    end: trim && trim.end > 0 ? formatClock(trim.end, true) : ''
  };
}

export function trimText(trim) {
  if (!trim) return '';
  const start = formatClock(trim.start > 0 ? trim.start : 0);
  const end = trim.end > 0 ? formatClock(trim.end) : t.convert.trimToEnd;
  return t.convert.trimBadge(start, end);
}

export function isValidTemplate(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= TEMPLATE_MAX && text.includes(NAME_TOKEN);
}

function localDate(now) {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function collapseMarks(text) {
  let current = text;
  let previous = null;
  while (current !== previous) {
    previous = current;
    current = current.replace(MARK_RUN, EMPTY_MARK).replace(EMPTY_BRACKETS, EMPTY_MARK);
  }
  return current;
}

function joinAroundMark(match, offset, whole) {
  if (offset === 0 || offset + match.length === whole.length) return '';
  const mark = match.indexOf(EMPTY_MARK);
  const before = match.slice(0, mark);
  const after = match.slice(mark + 1);
  if (match.replace(/[\s\x00]/g, '')) return before.trim() ? before : after;
  return /\s/.test(match) ? ' ' : '';
}

function tidy(text) {
  if (!text.includes(EMPTY_MARK)) return text.trim();
  return collapseMarks(text)
    .replace(/([[(])[\s_-]*\x00[\s_-]*/g, '$1')
    .replace(/[\s_-]*\x00[\s_-]*([\])])/g, '$1')
    .replace(/[\s_-]*\x00[\s_-]*/g, joinAroundMark)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function trimEdges(text) {
  return text.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
}

export function safeName(text) {
  return trimEdges(
    String(text || '')
      .normalize('NFC')
      .replace(/[\t\n\r\v\f]/g, ' ')
      .replace(INVISIBLE, '')
      .replace(/[<>:"/\\|?*]/g, (char) => LOOK_ALIKES[char])
      .replace(/\s+/g, ' ')
  );
}

export function previewName(template, { name, preset = '', resolution = '', extension = '', now = Date.now() }) {
  const clean = (value) => String(value || '').replaceAll(EMPTY_MARK, '');
  const values = { name: clean(name), preset: clean(preset), resolution: clean(resolution), date: localDate(now) };
  const source = isValidTemplate(template) ? template : NAME_TOKEN;
  const rendered = tidy(source.replace(TOKEN, (_, key) => values[key.toLowerCase()] || EMPTY_MARK));
  const base = safeName(rendered) || safeName(values.name) || 'video';
  return extension ? `${base}.${extension}` : base;
}

export function outputExtension(preset) {
  if (!preset) return '';
  if (preset.container === 'mkv' && preset.video && preset.video.mode === 'none') return 'mka';
  return preset.container;
}

export function sourceBaseName(filePath) {
  return stripExtension(baseName(filePath));
}

export function planResolution(plan) {
  const line = plan && Array.isArray(plan.lines) ? plan.lines[0] : '';
  const match = /^(\d+)x(\d+)\b/.exec(line || '');
  if (!match) return '';
  return `${Math.min(Number(match[1]), Number(match[2]))}p`;
}

export function planProblem(plan) {
  if (!plan || !Array.isArray(plan.errors) || plan.errors.length === 0) return null;
  const [first] = plan.errors;
  return { message: first.message || t.convert.notConvertible, hint: first.hint || null };
}

export function planTotals(files, plans) {
  let sampledBytes = 0;
  let sampledSeconds = 0;
  let sampled = 0;
  let totalSeconds = 0;
  let ready = 0;
  let convertible = 0;
  for (const file of files) {
    if (file.status !== 'ready') continue;
    ready += 1;
    const plan = plans[file.id];
    if (plan && planProblem(plan)) continue;
    convertible += 1;
    const seconds = effectiveDuration(file.media, file.trim) || 0;
    totalSeconds += seconds;
    if (plan && Number.isFinite(plan.estimateBytes)) {
      sampled += 1;
      sampledBytes += plan.estimateBytes;
      sampledSeconds += seconds;
    }
  }
  if (sampled === 0) return { bytes: null, partial: false, ready, convertible };
  const partial = sampled < convertible;
  const bytes = partial && sampledSeconds > 0 ? Math.round((sampledBytes * totalSeconds) / sampledSeconds) : sampledBytes;
  return { bytes, partial, ready, convertible };
}

export function planSignature(files) {
  const parts = [];
  for (const file of files) {
    if (file.status !== 'ready') continue;
    const trim = file.trim ? `${file.trim.start ?? ''}-${file.trim.end ?? ''}` : '';
    const analysis = file.analysis && file.analysis.status === 'done' && file.analysis.result ? `${file.analysis.result.verdict}${file.analysis.result.telecine ? 't' : ''}` : '';
    parts.push(`${file.id}:${trim}:${analysis}`);
    if (parts.length >= PREVIEW_LIMIT) break;
  }
  return parts.join('|');
}

export function enqueueBlocker({ totals, problems, output }) {
  const c = t.convert;
  if (totals.probing > 0) return c.waitProbing;
  if (totals.ready === 0) return c.nothingReady;
  if (problems.length > 0) return c.fixSettings;
  if (output.mode === 'folder' && !output.folder) return c.needFolder;
  if (!isValidTemplate(output.nameTemplate)) return c.nameTemplateInvalid;
  return null;
}

export function enqueueOutcome(sent, errors) {
  const failed = new Map();
  for (const error of errors || []) {
    if (error && typeof error.path === 'string') failed.set(fileKey(error.path), error);
  }
  const done = [];
  const rejected = [];
  for (const file of sent) {
    const error = failed.get(file.key);
    if (error) rejected.push({ id: file.id, error: { message: error.message, hint: error.hint || null } });
    else done.push(file.id);
  }
  return { done, rejected, orphanErrors: (errors || []).filter((error) => !error || typeof error.path !== 'string') };
}
