export const FILTERS = ['all', 'active', 'finished', 'failed'];
export const WINDOW_THRESHOLD = 200;
export const CHUNK_SIZE = 40;
export const ROW_HEIGHT = 36;
export const FAILURE_ESTIMATE = 58;

const PENDING = new Set(['queued', 'paused', 'interrupted']);
const FINISHED = new Set(['done', 'failed', 'canceled']);

export const EMPTY_SELECTION = Object.freeze({ ids: new Set(), anchor: null, cursor: null });

export function isPending(job) {
  return PENDING.has(job.state);
}

export function isReady(job) {
  return job.state === 'paused' && job.neverStarted;
}

export function canPause(job) {
  return job.state === 'running' || job.state === 'queued';
}

export function canResume(job) {
  return job.state === 'paused' || job.state === 'interrupted';
}

export function canRetry(job) {
  return job.state === 'failed' || job.state === 'canceled';
}

export function canCancel(job) {
  return job.state === 'running' || PENDING.has(job.state);
}

export function canOpen(job) {
  return job.state === 'done' && Boolean(job.result?.path);
}

export function revealTarget(job) {
  if (job.result?.path) return { file: job.result.path };
  if (job.output?.folder) return { folder: job.output.folder };
  return null;
}

export function needsRemoveConfirm(job) {
  return job.state === 'running' || PENDING.has(job.state);
}

export function rowActions(job, stopping = false) {
  switch (job.state) {
    case 'running':
      return stopping ? ['cancel'] : ['pause', 'cancel'];
    case 'queued':
      return ['pause', 'cancel'];
    case 'paused':
      return job.neverStarted ? ['start', 'remove'] : ['resume', 'cancel'];
    case 'interrupted':
      return ['resume', 'cancel'];
    case 'done':
      return job.result?.path ? ['open', 'show', 'remove'] : ['show', 'remove'];
    case 'failed':
    case 'canceled':
      return ['retry', 'remove'];
    default:
      return ['remove'];
  }
}

export function togglePlan(jobs) {
  const pause = jobs.filter(canPause).map((job) => job.id);
  if (pause.length) return { action: 'pause', ids: pause };
  const resume = jobs.filter(canResume).map((job) => job.id);
  if (resume.length) return { action: 'resume', ids: resume };
  return null;
}

export function bulkPlan(jobs) {
  return {
    pause: jobs.filter(canPause).map((job) => job.id),
    resume: jobs.filter(canResume).map((job) => job.id),
    retry: jobs.filter(canRetry).map((job) => job.id),
    cancel: jobs.filter(canCancel).map((job) => job.id),
    remove: jobs.map((job) => job.id),
    confirm: jobs.filter(needsRemoveConfirm).length
  };
}

export function matchesFilter(job, filter) {
  if (filter === 'active') return !FINISHED.has(job.state);
  if (filter === 'finished') return job.state === 'done' || job.state === 'canceled';
  if (filter === 'failed') return job.state === 'failed';
  return true;
}

export function normalizeQuery(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function haystack(job) {
  return [job.title, job.source, job.output?.name, job.groupTitle, job.channel, job.preset?.name, job.result?.path]
    .filter((value) => typeof value === 'string' && value)
    .join('\n')
    .toLowerCase();
}

export function matchesQuery(job, words) {
  if (!words || words.length === 0) return true;
  const text = haystack(job);
  return words.every((word) => text.includes(word));
}

export function filterJobs(jobs, filter, words) {
  if (filter === 'all' && (!words || words.length === 0)) return jobs;
  return jobs.filter((job) => matchesFilter(job, filter) && matchesQuery(job, words));
}

export function filterCounts(jobs) {
  const counts = { all: jobs.length, active: 0, finished: 0, failed: 0 };
  for (const job of jobs) {
    if (job.state === 'failed') counts.failed += 1;
    else if (job.state === 'done' || job.state === 'canceled') counts.finished += 1;
    else counts.active += 1;
  }
  return counts;
}

export function stateCounts(jobs) {
  const counts = { total: jobs.length, running: 0, queued: 0, ready: 0, paused: 0, interrupted: 0, done: 0, failed: 0, canceled: 0 };
  for (const job of jobs) {
    if (isReady(job)) counts.ready += 1;
    else if (Object.hasOwn(counts, job.state)) counts[job.state] += 1;
  }
  counts.startable = counts.ready + counts.paused + counts.interrupted;
  counts.pausable = counts.running + counts.queued;
  counts.clearable = counts.done + counts.canceled;
  return counts;
}

const SUBTITLE_PARTS = 3;

export function subtitleParts(counts) {
  const values = { ...counts, finished: counts.done + counts.canceled };
  const priority = ['running', 'queued', 'failed', 'interrupted', 'paused', 'ready', 'finished'];
  return priority
    .filter((key) => values[key] > 0)
    .slice(0, SUBTITLE_PARTS)
    .map((key) => [key, values[key]]);
}

export function buildEntries(jobs, collapsed) {
  const entries = [];
  const runs = new Map();
  let index = 0;
  while (index < jobs.length) {
    const job = jobs[index];
    let end = index + 1;
    if (job.groupId) {
      while (end < jobs.length && jobs[end].groupId === job.groupId) end += 1;
    }
    if (!job.groupId || end - index < 2) {
      for (let i = index; i < end; i += 1) entries.push({ type: 'job', key: jobs[i].id, job: jobs[i], groupKey: null });
      index = end;
      continue;
    }
    const run = jobs.slice(index, end);
    const number = runs.get(job.groupId) || 0;
    runs.set(job.groupId, number + 1);
    const key = `group:${job.groupId}:${number}`;
    const isCollapsed = Boolean(collapsed && collapsed.has(job.groupId));
    entries.push({
      type: 'group',
      key,
      groupId: job.groupId,
      title: run.find((member) => member.groupTitle)?.groupTitle || '',
      jobs: run,
      collapsed: isCollapsed
    });
    if (!isCollapsed) {
      run.forEach((member, position) =>
        entries.push({
          type: 'job',
          key: member.id,
          job: member,
          groupKey: key,
          groupId: job.groupId,
          first: position === 0,
          last: position === run.length - 1
        })
      );
    }
    index = end;
  }
  return entries;
}

export function entryIds(entry) {
  if (!entry) return [];
  return entry.type === 'group' ? entry.jobs.map((job) => job.id) : [entry.job.id];
}

export function isEntrySelected(entry, ids) {
  if (!entry || ids.size === 0) return false;
  if (entry.type === 'job') return ids.has(entry.job.id);
  return entry.jobs.every((job) => ids.has(job.id));
}

function indexOfKey(entries, key) {
  if (key === null || key === undefined) return -1;
  return entries.findIndex((entry) => entry.key === key);
}

function rangeIds(entries, from, to) {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const ids = [];
  for (let i = start; i <= end; i += 1) ids.push(...entryIds(entries[i]));
  return ids;
}

export function selectEntry(selection, entries, key, { toggle = false, range = false } = {}) {
  const target = indexOfKey(entries, key);
  if (target < 0) return selection;
  const entry = entries[target];
  const anchorIndex = indexOfKey(entries, selection.anchor);
  if (range && anchorIndex >= 0) {
    const ids = toggle ? new Set(selection.ids) : new Set();
    for (const id of rangeIds(entries, anchorIndex, target)) ids.add(id);
    return { ids, anchor: selection.anchor, cursor: key };
  }
  if (toggle) {
    const ids = new Set(selection.ids);
    const own = entryIds(entry);
    const all = own.every((id) => ids.has(id));
    for (const id of own) {
      if (all) ids.delete(id);
      else ids.add(id);
    }
    return { ids, anchor: key, cursor: key };
  }
  return { ids: new Set(entryIds(entry)), anchor: key, cursor: key };
}

export function selectAll(selection, entries) {
  const ids = new Set();
  for (const entry of entries) for (const id of entryIds(entry)) ids.add(id);
  const cursor = indexOfKey(entries, selection.cursor) >= 0 ? selection.cursor : entries[0]?.key ?? null;
  return { ids, anchor: selection.anchor ?? cursor, cursor };
}

export function moveCursor(selection, entries, move, { extend = false } = {}) {
  if (entries.length === 0) return selection;
  const current = indexOfKey(entries, selection.cursor);
  let next;
  if (move === 'home') next = 0;
  else if (move === 'end') next = entries.length - 1;
  else if (current < 0) next = move > 0 ? 0 : entries.length - 1;
  else next = Math.min(entries.length - 1, Math.max(0, current + move));
  const key = entries[next].key;
  if (extend) {
    const anchor = indexOfKey(entries, selection.anchor) >= 0 ? selection.anchor : selection.cursor ?? key;
    return selectEntry({ ...selection, anchor }, entries, key, { range: true });
  }
  return selectEntry(selection, entries, key);
}

export function pruneSelection(selection, entries, validIds) {
  let changed = false;
  const ids = new Set();
  for (const id of selection.ids) {
    if (validIds.has(id)) ids.add(id);
    else changed = true;
  }
  const keys = new Set(entries.map((entry) => entry.key));
  const anchor = selection.anchor !== null && !keys.has(selection.anchor) ? null : selection.anchor;
  const cursor = selection.cursor !== null && !keys.has(selection.cursor) ? null : selection.cursor;
  if (!changed && anchor === selection.anchor && cursor === selection.cursor) return selection;
  return { ids: changed ? ids : selection.ids, anchor, cursor };
}

export function selectedJobs(jobs, ids) {
  if (ids.size === 0) return [];
  return jobs.filter((job) => ids.has(job.id));
}

function nextStaying(jobs, fromIndex, moving) {
  for (let i = fromIndex; i < jobs.length; i += 1) {
    if (!moving.has(jobs[i].id)) return jobs[i].id;
  }
  return null;
}

export function resolveDrop({ jobs, entry, half, moving }) {
  if (!entry || !moving || moving.size === 0) return null;
  const position = new Map(jobs.map((job, index) => [job.id, index]));
  if (entry.type === 'group') {
    const members = entry.jobs.filter((job) => position.has(job.id));
    if (members.length === 0) return null;
    if (entry.collapsed && half === 'bottom') {
      const last = members[members.length - 1];
      return { beforeId: nextStaying(jobs, position.get(last.id) + 1, moving), indicator: { key: entry.key, edge: 'after' } };
    }
    const first = members.find((job) => !moving.has(job.id));
    if (!first) return null;
    return { beforeId: first.id, indicator: { key: entry.key, edge: 'before' } };
  }
  const id = entry.job.id;
  if (moving.has(id) || !position.has(id)) return null;
  if (half === 'top') {
    const sameGroup = Boolean(entry.groupId) && jobs.every((job) => !moving.has(job.id) || job.groupId === entry.groupId);
    const key = entry.first && entry.groupKey && !sameGroup ? entry.groupKey : entry.key;
    return { beforeId: id, indicator: { key, edge: 'before' } };
  }
  return { beforeId: nextStaying(jobs, position.get(id) + 1, moving), indicator: { key: entry.key, edge: 'after' } };
}

export function dragIds(jobs, selectionIds, id) {
  if (!selectionIds.has(id)) return [id];
  return jobs.filter((job) => selectionIds.has(job.id) && isPending(job)).map((job) => job.id);
}

export function livePercent(job, progress) {
  if (job.state === 'done') return 100;
  const value = (job.state === 'running' && progress ? progress.percent : job.progress?.percent) ?? null;
  return Number.isFinite(value) ? value : null;
}

export function groupPercent(members, progressMap) {
  let total = 0;
  let count = 0;
  for (const job of members) {
    if (job.state === 'canceled') continue;
    const value = livePercent(job, progressMap[job.id]);
    total += value ?? 0;
    count += 1;
  }
  if (count === 0) return 0;
  return Math.round((total / count) * 10) / 10;
}

export function groupSpeed(members, progressMap) {
  let total = 0;
  for (const job of members) {
    if (job.state !== 'running' || job.kind !== 'download') continue;
    const speed = progressMap[job.id]?.speed ?? job.progress?.speed;
    if (Number.isFinite(speed) && speed > 0) total += speed;
  }
  return total;
}

export function groupState(members) {
  const counts = stateCounts(members);
  let state = 'done';
  if (counts.running > 0) state = 'running';
  else if (counts.queued > 0) state = 'waiting';
  else if (counts.startable > 0) state = 'paused';
  else if (counts.failed > 0) state = 'failed';
  return { state, counts };
}

export function forgetMissingGroups(collapsed, jobs) {
  if (collapsed.size === 0) return collapsed;
  const present = new Set(jobs.map((job) => job.groupId).filter(Boolean));
  const kept = [...collapsed].filter((id) => present.has(id));
  return kept.length === collapsed.size ? collapsed : new Set(kept);
}

export function childIndex(jobs) {
  const map = new Map();
  for (const job of jobs) {
    if (job.parentId && !map.has(job.parentId)) map.set(job.parentId, job);
  }
  return map;
}

export function stabilizeJobs(previous, jobs) {
  const known = previous?.map;
  const map = new Map();
  const list = jobs.map((job) => {
    const signature = JSON.stringify(job);
    const entry = known?.get(job.id);
    const value = entry && entry.signature === signature ? entry.job : job;
    map.set(job.id, { signature, job: value });
    return value;
  });
  const before = previous?.list;
  const same = Boolean(before) && before.length === list.length && list.every((job, index) => job === before[index]);
  return { list: same ? before : list, map };
}

export function chunkEntries(entries, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < entries.length; i += size) chunks.push(entries.slice(i, i + size));
  return chunks;
}

export function estimateHeight(entries) {
  let height = 0;
  for (const entry of entries) {
    height += ROW_HEIGHT;
    if (entry.type === 'job' && entry.job.state === 'failed') height += FAILURE_ESTIMATE;
  }
  return height;
}

export function chunkSignature(entries) {
  return entries.map((entry) => `${entry.key}:${entry.type === 'job' ? entry.job.state : entry.collapsed}`).join('|');
}
