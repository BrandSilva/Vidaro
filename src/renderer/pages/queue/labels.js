import { t } from '../../strings/index.js';
import { formatBytes, formatDuration, formatEta, formatPercent, formatSpeed } from '../../lib/format.js';
import { groupState, isReady, livePercent, subtitleParts } from './model.js';

const q = t.queue;

function upper(value) {
  return String(value || '').toUpperCase();
}

function isStopping(job, progress) {
  return job.state === 'running' && progress?.stage === 'stopping';
}

export function liveProgress(job, progress) {
  return job.state === 'running' ? progress || job.progress || null : job.progress || null;
}

export function badgeFor(job, progress) {
  const stage = job.state === 'running' ? progress?.stage || null : null;
  switch (job.state) {
    case 'running': {
      if (stage === 'stopping') return { label: q.states.stopping, tone: null, hint: q.stateHints.stopping };
      const hint = [stage ? q.stageHints[stage] : null, progress?.detail || null].filter(Boolean).join(' · ');
      return { label: (stage && q.stages[stage]) || q.states.running, tone: 'accent', hint: hint || null };
    }
    case 'queued':
      return { label: q.states.queued, tone: null, hint: q.stateHints.queued };
    case 'paused':
      return isReady(job)
        ? { label: q.states.ready, tone: null, hint: q.stateHints.ready }
        : { label: q.states.paused, tone: 'warning', hint: q.stateHints.paused };
    case 'interrupted':
      return { label: q.states.interrupted, tone: 'warning', hint: q.stateHints.interrupted };
    case 'done':
      return job.result?.skipped
        ? { label: q.states.skipped, tone: null, hint: q.stateHints.skipped }
        : { label: q.states.done, tone: 'success', hint: null };
    case 'failed':
      return { label: q.states.failed, tone: 'danger', hint: null };
    case 'canceled':
      return { label: q.states.canceled, tone: 'muted', hint: q.stateHints.canceled };
    default:
      return { label: String(job.state || ''), tone: null, hint: null };
  }
}

export function progressView(job, progress) {
  const stopping = isStopping(job, progress);
  const value = livePercent(job, progress);
  const active = job.state === 'running' && !stopping;
  let tone = 'muted';
  if (active) tone = undefined;
  else if (job.state === 'done') tone = job.result?.skipped ? 'muted' : 'success';
  else if (job.state === 'failed') tone = 'danger';
  const hidePercent = value === null || (value === 0 && !active);
  return {
    stopping,
    value: active ? value : value ?? 0,
    tone,
    text: hidePercent ? '' : formatPercent(value)
  };
}

export function speedText(job, progress) {
  if (job.state === 'done') return Number.isFinite(job.result?.size) ? formatBytes(job.result.size) : '';
  if (job.state !== 'running' || !progress || isStopping(job, progress)) return '';
  const speed = progress.speed;
  if (!Number.isFinite(speed) || speed <= 0) return '';
  if (job.kind === 'download') return formatSpeed(speed);
  return q.realtime(speed >= 10 ? String(Math.round(speed)) : speed.toFixed(1));
}

export function etaText(job, progress) {
  if (job.state !== 'running' || !progress || isStopping(job, progress)) return '';
  return formatEta(progress.eta);
}

function qualityLabel(download) {
  return !download.quality || download.quality === 'best' ? q.target.best : q.target.height(download.quality);
}

function rangeText(range, format) {
  if (!range) return null;
  const start = Number.isFinite(range.start) ? range.start : null;
  const end = Number.isFinite(range.end) ? range.end : null;
  if (start === null && end === null) return null;
  return format(
    start === null ? q.target.fromStart : formatDuration(start),
    end === null ? q.target.toEnd : formatDuration(end)
  );
}

export function targetLabel(job) {
  if (job.kind !== 'download') return job.preset?.name || '';
  const download = job.download;
  if (!download) return '';
  if (download.mode === 'audio') return upper(download.audioFormat);
  const parts = [upper(download.container), qualityLabel(download)];
  if (download.mode === 'video') parts.push(q.target.videoOnly);
  return parts.join(' · ');
}

export function targetLines(job) {
  const lines = [];
  if (job.kind === 'download' && job.download) {
    const download = job.download;
    if (download.mode === 'audio') lines.push(q.target.audioOnly(upper(download.audioFormat)));
    else lines.push([upper(download.container), qualityLabel(download)].join(' · '));
    if (download.mode === 'video') lines.push(q.target.videoOnlyHint);
    const section = rangeText(download.section, q.target.section);
    if (section) lines.push(section);
    if (job.chained && job.preset?.name) lines.push(q.target.thenConvert(job.preset.name));
  } else {
    if (job.preset?.name) lines.push(job.preset.name);
    const trim = rangeText(job.trim, q.target.trim);
    if (trim) lines.push(trim);
  }
  return lines;
}

export function nameLines(job) {
  const lines = [];
  if (job.groupTitle) lines.push(q.tip.playlist(job.groupTitle));
  if (job.source) lines.push(job.source);
  if (job.state === 'done' && job.result?.path) lines.push(q.tip.savedTo(job.result.path));
  else if (job.state !== 'done' && job.output?.folder) lines.push(q.tip.savesTo(job.output.folder));
  if (job.state === 'done' && Number.isFinite(job.result?.size)) lines.push(q.tip.size(formatBytes(job.result.size)));
  if (job.attempts > 1) lines.push(q.tip.attempts(job.attempts));
  return lines;
}

export function errorText(error) {
  if (!error) return { message: '', hint: null };
  const entry = t.errors[error.code];
  const known = entry && typeof entry.message === 'string' ? entry.variants?.[error.message] || entry : null;
  return {
    message: known?.message || error.message || t.errors.unexpected.message,
    hint: known?.hint ?? error.hint ?? null
  };
}

export function warningLines(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  const lines = [];
  for (const code of new Set(codes)) {
    const text = t.errors.warnings[code];
    if (text) lines.push(text);
  }
  return lines;
}

export function subtitleText(counts) {
  const parts = subtitleParts(counts);
  if (parts.length === 0) return q.subtitleEmpty;
  return parts.map(([key, value]) => q.counts[key](value)).join(' · ');
}

export function groupView(members) {
  const { state, counts } = groupState(members);
  const finished = counts.done + counts.canceled;
  const parts = [q.group.progress(counts.done, members.length)];
  if (counts.failed > 0 && state !== 'failed') parts.push(q.group.failed(counts.failed));
  const badges = {
    running: { label: q.group.running, tone: 'accent' },
    waiting: { label: q.group.waiting, tone: null },
    paused: { label: q.group.paused, tone: 'warning' },
    failed: { label: q.group.failed(counts.failed), tone: 'danger' },
    done: { label: q.group.done, tone: counts.done > 0 ? 'success' : 'muted' }
  };
  return { state, counts, finished, summary: parts.join(' · '), badge: badges[state] };
}
