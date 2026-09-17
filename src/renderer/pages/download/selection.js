export const ENTRY_LIMIT = 10000;

export function entryFlag(entry) {
  if (!entry) return null;
  if (entry.kind === 'playlist') return 'list';
  if (entry.liveStatus === 'is_upcoming') return 'upcoming';
  if (entry.liveStatus === 'is_live') return 'live';
  if (entry.availability === 'private') return 'private';
  if (entry.availability === 'premium_only' || entry.availability === 'subscriber_only') return 'members';
  if (entry.availability === 'needs_auth') return 'login';
  return null;
}

export function isSelectable(entry) {
  return Boolean(entry) && entry.kind !== 'playlist' && Boolean(entry.url);
}

export function defaultSelection(entries) {
  const selection = new Set();
  if (!Array.isArray(entries)) return selection;
  for (const entry of entries) {
    const flag = entryFlag(entry);
    if (isSelectable(entry) && flag !== 'upcoming' && flag !== 'private') selection.add(entry.index);
  }
  return selection;
}

export function selectableIndexes(entries) {
  return Array.isArray(entries) ? entries.filter(isSelectable).map((entry) => entry.index) : [];
}

export function selectAllState(entries, selection) {
  const indexes = selectableIndexes(entries);
  const count = indexes.filter((index) => selection.has(index)).length;
  return { all: indexes.length > 0 && count === indexes.length, some: count > 0 && count < indexes.length, total: indexes.length, count };
}

export function selectionFromRange(entries, indexes) {
  const allowed = new Set(selectableIndexes(entries));
  return new Set((indexes || []).filter((index) => allowed.has(index)));
}

export function toggleSelection(selection, entries, index, { anchor = null, shift = false } = {}) {
  const next = new Set(selection);
  const value = !selection.has(index);
  if (shift && anchor !== null && anchor !== index && Array.isArray(entries)) {
    const low = Math.min(anchor, index);
    const high = Math.max(anchor, index);
    const target = selection.has(anchor);
    for (const entry of entries) {
      if (entry.index >= low && entry.index <= high && isSelectable(entry)) {
        if (target) next.add(entry.index);
        else next.delete(entry.index);
      }
    }
    return next;
  }
  if (value) next.add(index);
  else next.delete(index);
  return next;
}

export function durationStats(entries, selection = null) {
  let seconds = 0;
  let count = 0;
  let unknown = 0;
  if (!Array.isArray(entries)) return { seconds, count, unknown };
  for (const entry of entries) {
    if (!isSelectable(entry)) continue;
    if (selection && !selection.has(entry.index)) continue;
    count += 1;
    if (Number.isFinite(entry.duration) && entry.duration > 0) seconds += entry.duration;
    else unknown += 1;
  }
  return { seconds, count, unknown };
}

export function selectedEntries(entries, selection) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => isSelectable(entry) && selection.has(entry.index));
}

export function firstSelectable(entries) {
  return Array.isArray(entries) ? entries.find(isSelectable) || null : null;
}

export function parseRange(text, maxIndex) {
  const value = String(text ?? '')
    .trim()
    .replace(/\s*-\s*/g, '-');
  if (!value) return { indexes: null, error: false };
  const limit = Number.isInteger(maxIndex) && maxIndex > 0 ? maxIndex : 0;
  const tokens = value.split(/[,;\s]+/).filter(Boolean);
  const indexes = new Set();
  for (const token of tokens) {
    const match = /^(\d+)?(-)?(\d+)?$/.exec(token);
    if (!match || (!match[1] && !match[3])) return { indexes: null, error: true };
    if (!match[2] && match[3]) return { indexes: null, error: true };
    const from = match[1] ? Number(match[1]) : 1;
    const to = match[2] ? (match[3] ? Number(match[3]) : limit) : from;
    if (from < 1 || to < from || from > limit) return { indexes: null, error: true };
    for (let index = from; index <= Math.min(to, limit); index += 1) indexes.add(index);
  }
  return { indexes: [...indexes].sort((a, b) => a - b), error: indexes.size === 0 };
}

export function windowRange(scrollTop, viewport, rowHeight, total, overscan = 6) {
  if (total <= 0) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start: first, end: Math.max(first, last) };
}
