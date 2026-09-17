const v = require('../validate');

const CHANGED_DELAY_MS = 60;
const PROGRESS_DELAY_MS = 250;

function downloadTarget(spec) {
  const options = spec.options || {};
  return {
    mode: options.mode || 'av',
    quality: options.quality || 'best',
    container: options.container || 'mp4',
    audioFormat: options.audioFormat || 'mp3',
    section: options.section || null
  };
}

function jobView(job) {
  const spec = job.spec || {};
  const isDownload = job.kind === 'download';
  const preset = spec.preset || spec.after?.preset || null;
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    title: job.title,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempts: job.attempts,
    neverStarted: Boolean(job.neverStarted),
    groupId: job.groupId || null,
    groupTitle: job.groupTitle || null,
    parentId: job.parentId || null,
    source: isDownload ? spec.url : spec.input?.path,
    thumbnail: isDownload ? spec.info?.thumbnail || null : null,
    duration: isDownload ? spec.info?.duration ?? null : spec.input?.duration ?? null,
    channel: isDownload ? spec.info?.channel || null : null,
    output: { folder: spec.output?.folder || '', name: spec.output?.name || '' },
    download: isDownload ? downloadTarget(spec) : null,
    preset: preset ? { id: preset.id, name: preset.name, container: preset.container } : null,
    chained: Boolean(isDownload && spec.after),
    trim: spec.trim || null,
    progress: job.progress || null,
    result: job.result || null,
    error: job.error || null
  };
}

function bridgeQueue(ctx) {
  const queue = ctx.queue;
  let changedTimer = null;
  let progressTimer = null;
  const pending = new Map();

  const flushChanged = () => {
    changedTimer = null;
    ctx.send('queue:changed', queue.list().map(jobView));
  };
  const onChanged = () => {
    if (!changedTimer) changedTimer = setTimeout(flushChanged, CHANGED_DELAY_MS);
  };
  const flushProgress = () => {
    progressTimer = null;
    if (pending.size === 0) return;
    const batch = Object.fromEntries(pending);
    pending.clear();
    ctx.send('queue:progress', batch);
  };
  const onProgress = (id, progress) => {
    pending.set(id, progress);
    if (!progressTimer) progressTimer = setTimeout(flushProgress, PROGRESS_DELAY_MS);
  };

  queue.on('changed', onChanged);
  queue.on('progress', onProgress);
  return () => {
    queue.off('changed', onChanged);
    queue.off('progress', onProgress);
    clearTimeout(changedTimer);
    clearTimeout(progressTimer);
  };
}

function registerQueue(ctx, handle) {
  const ids = (value) => v.idList(value);
  handle('queue:list', () => ctx.queue.list().map(jobView));
  handle('queue:pause', (value) => ctx.queue.pause(ids(value)));
  handle('queue:resume', (value) => ctx.queue.resume(ids(value)));
  handle('queue:cancel', (value) => ctx.queue.cancel(ids(value)));
  handle('queue:retry', (value) => ctx.queue.retry(ids(value)));
  handle('queue:remove', (value) => ctx.queue.remove(ids(value)));
  handle('queue:reorder', (value, beforeId) =>
    ctx.queue.reorder(ids(value), beforeId === null || beforeId === undefined ? null : v.text(beforeId, { min: 1, max: 64 }))
  );
  handle('queue:clear-finished', () => ctx.queue.clearFinished());
  handle('queue:start-all', () => ctx.queue.startAll());
  handle('queue:pause-all', () => ctx.queue.pauseAll());
}

module.exports = { registerQueue, bridgeQueue, jobView };
