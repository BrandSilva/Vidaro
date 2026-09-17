const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Queue } = require('../src/main/queue');

function abortError(reason) {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  error.reason = reason;
  return error;
}

function createRunner({ honorAbort = true } = {}) {
  const runner = {
    honorAbort,
    runs: [],
    cleaned: [],
    run(job, ctx) {
      return new Promise((resolve, reject) => {
        const run = { job, ctx, resolve, reject, reason: null };
        ctx.signal.addEventListener(
          'abort',
          () => {
            run.reason = ctx.signal.reason;
            if (runner.honorAbort) reject(abortError(ctx.signal.reason));
          },
          { once: true }
        );
        runner.runs.push(run);
      });
    },
    cleanup(job) {
      runner.cleaned.push(job.id);
    },
    last(id) {
      return runner.runs.filter((run) => run.job.id === id).at(-1);
    },
    ids() {
      return runner.runs.map((run) => run.job.id);
    }
  };
  return runner;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-queue-'));
  const queues = [];
  t.after(() => {
    for (const queue of queues) queue.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const limits = { convert: 1, download: 2 };
  let clock = 1000000;
  const make = (overrides = {}) => {
    const runners = overrides.runners ?? { convert: createRunner(), download: createRunner() };
    const queue = new Queue({
      file: path.join(dir, `queue-${queues.length}.json`),
      runners,
      limits: () => limits,
      stallMs: () => 60000,
      now: () => (clock += 1),
      progressMs: 0,
      debounceMs: 5,
      abortGraceMs: 2000,
      shutdownTimeoutMs: 2000,
      ...overrides
    });
    queues.push(queue);
    return { queue, runners, convert: runners.convert, download: runners.download };
  };
  const writeJobs = (name, jobs) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ version: 1, jobs }));
    return file;
  };
  return { dir, limits, make, writeJobs };
}

let counter = 0;
function input(kind, title = `${kind} ${(counter += 1)}`, extra = {}) {
  return { kind, title, spec: { title }, ...extra };
}

function storedJob(id, state, extra = {}) {
  return {
    id,
    kind: 'download',
    state,
    title: id,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    attempts: 1,
    neverStarted: false,
    groupId: null,
    groupTitle: null,
    parentId: null,
    spec: { url: `https://example.com/${id}` },
    progress: null,
    result: null,
    error: null,
    ...extra
  };
}

const states = (queue) => queue.list().map((job) => job.state);
const titles = (queue) => queue.list().map((job) => job.title);

test('pause stops a running job and resume starts it again', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  await flush();
  download.last(a).ctx.progress({ percent: 40, speed: 1000, eta: 30, stage: 'download' });
  assert.deepEqual(queue.pause([a]), [a]);
  await flush();
  assert.equal(download.last(a).reason, 'pause');
  const paused = queue.get(a);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.progress.percent, 40);
  assert.equal(paused.progress.stage, null);
  assert.equal(paused.progress.speed, null);
  assert.equal(paused.progress.eta, null);
  assert.equal(paused.finishedAt, null);
  assert.equal(paused.error, null);
  assert.equal(paused.neverStarted, false);
  assert.deepEqual(download.cleaned, []);
  assert.deepEqual(queue.resume([a]), [a]);
  await flush();
  const resumed = queue.get(a);
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.attempts, 2);
  assert.equal(resumed.progress.percent, null);
  assert.equal(download.runs.length, 2);
  assert.equal(download.last(a).reason, null);
});

test('pause moves queued and interrupted jobs to paused and ignores finished ones', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 1;
  const file = writeJobs('pause.json', [
    storedJob('i1', 'interrupted'),
    storedJob('d1', 'done', { finishedAt: 5 }),
    storedJob('f1', 'failed', { finishedAt: 6, error: { code: 'x', message: 'x' } }),
    storedJob('c1', 'canceled', { finishedAt: 7 })
  ]);
  const { queue, download } = make({ file });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  assert.deepEqual(queue.pause([b, 'i1', 'd1', 'f1', 'c1']), [b, 'i1']);
  await flush();
  assert.deepEqual(states(queue), ['paused', 'done', 'failed', 'canceled', 'running', 'paused']);
  assert.deepEqual(download.ids(), [a]);
  assert.deepEqual(download.cleaned, []);
});

test('jobs added as Ready stay paused until resumed', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const ids = queue.add([input('download'), input('download')], { start: false });
  await flush();
  assert.equal(download.runs.length, 0);
  assert.deepEqual(states(queue), ['paused', 'paused']);
  assert.ok(queue.list().every((job) => job.neverStarted));
  assert.deepEqual(queue.resume([ids[1]]), [ids[1]]);
  await flush();
  assert.deepEqual(download.ids(), [ids[1]]);
  assert.equal(queue.get(ids[1]).neverStarted, false);
  assert.equal(queue.get(ids[0]).neverStarted, true);
});

test('cancel stops a running job and leaves its temp files to the runner', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const finished = [];
  queue.on('job-finished', (job) => finished.push([job.id, job.state]));
  const [a] = queue.add([input('download')]);
  await flush();
  assert.deepEqual(queue.cancel([a]), [a]);
  await flush();
  assert.equal(download.last(a).reason, 'cancel');
  assert.equal(queue.get(a).state, 'canceled');
  assert.equal(typeof queue.get(a).finishedAt, 'number');
  assert.equal(queue.get(a).error, null);
  assert.deepEqual(download.cleaned, []);
  assert.deepEqual(finished, [[a, 'canceled']]);
});

test('cancel of queued, paused and interrupted jobs runs cleanup without starting them', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 1;
  const file = writeJobs('cancel.json', [storedJob('i1', 'interrupted')]);
  const { queue, download } = make({ file });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  const [p] = queue.add([input('download')], { start: false });
  await flush();
  assert.deepEqual(queue.cancel(['i1', b, p]), ['i1', b, p]);
  await flush();
  assert.deepEqual(states(queue), ['canceled', 'running', 'canceled', 'canceled']);
  assert.deepEqual(download.cleaned.sort(), ['i1', b, p].sort());
  assert.deepEqual(download.ids(), [a]);
  assert.ok(queue.list().filter((job) => job.state === 'canceled').every((job) => typeof job.finishedAt === 'number'));
  assert.deepEqual(queue.cancel([b]), []);
});

test('cancel after a pause request upgrades the outcome and cleans up', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a] = queue.add([input('download')]);
  await flush();
  queue.pause([a]);
  assert.deepEqual(queue.cancel([a]), [a]);
  assert.equal(download.last(a).reason, 'pause');
  download.last(a).reject(abortError('pause'));
  await flush();
  assert.equal(queue.get(a).state, 'canceled');
  assert.deepEqual(download.cleaned, [a]);
});

test('a pause request never downgrades a pending cancel', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a] = queue.add([input('download')]);
  await flush();
  queue.cancel([a]);
  queue.pause([a]);
  download.last(a).reject(abortError('cancel'));
  await flush();
  assert.equal(queue.get(a).state, 'canceled');
  assert.deepEqual(download.cleaned, []);
});

test('resume while a pause is still stopping requeues the job', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a] = queue.add([input('download')]);
  await flush();
  queue.pause([a]);
  assert.deepEqual(queue.resume([a]), [a]);
  download.last(a).reject(abortError('pause'));
  await flush();
  assert.equal(queue.get(a).state, 'running');
  assert.equal(queue.get(a).attempts, 2);
  assert.equal(download.runs.length, 2);
});

test('pause, resume and pause again while stopping ends paused', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a] = queue.add([input('download')]);
  await flush();
  queue.pause([a]);
  queue.resume([a]);
  assert.deepEqual(queue.pause([a]), [a]);
  download.last(a).reject(abortError('pause'));
  await flush();
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(download.runs.length, 1);
});

test('shutdown turns a pending resume-after-pause into the shutdown outcome', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 2;
  const pausing = make();
  pausing.download.honorAbort = false;
  const [a] = pausing.queue.add([input('download')]);
  const interrupting = make();
  interrupting.download.honorAbort = false;
  const [b] = interrupting.queue.add([input('download')]);
  await flush();
  for (const [{ queue }, id] of [
    [pausing, a],
    [interrupting, b]
  ]) {
    queue.pause([id]);
    queue.resume([id]);
  }
  const pausingDone = pausing.queue.shutdown('pause');
  const interruptingDone = interrupting.queue.shutdown('interrupt');
  pausing.download.last(a).reject(abortError('pause'));
  interrupting.download.last(b).reject(abortError('pause'));
  await Promise.all([pausingDone, interruptingDone]);
  assert.equal(pausing.queue.get(a).state, 'paused');
  assert.equal(interrupting.queue.get(b).state, 'interrupted');
  assert.equal(pausing.download.runs.length, 1);
  assert.equal(interrupting.download.runs.length, 1);
});

test('a user pause is kept when an interrupt shutdown follows', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  queue.pause([a]);
  const done = queue.shutdown('interrupt');
  download.last(a).reject(abortError('pause'));
  download.last(b).reject(abortError('shutdown'));
  await done;
  assert.deepEqual(states(queue), ['paused', 'interrupted']);
});

test('retry does nothing once the queue is shutting down', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('retry-closed.json', [storedJob('f1', 'failed', { finishedAt: 3, error: { code: 'x', message: 'x' } })]);
  const { queue, download } = make({ file });
  queue.load();
  await queue.shutdown('pause');
  assert.deepEqual(queue.retry(['f1']), []);
  await flush();
  assert.equal(queue.get('f1').state, 'failed');
  assert.equal(download.runs.length, 0);
});

test('resume does not undo a cancel that is still stopping', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  download.honorAbort = false;
  const [a] = queue.add([input('download')]);
  await flush();
  queue.cancel([a]);
  assert.deepEqual(queue.resume([a]), []);
  download.last(a).reject(abortError('cancel'));
  await flush();
  assert.equal(queue.get(a).state, 'canceled');
});

test('retry requeues failed, canceled and interrupted jobs and keeps attempts', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 5;
  const file = writeJobs('retry.json', [
    storedJob('f1', 'failed', {
      attempts: 3,
      finishedAt: 10,
      error: { code: 'http-403', message: 'Refused' },
      progress: { percent: 60, stage: null, speed: null, eta: null, detail: null }
    }),
    storedJob('c1', 'canceled', { attempts: 1, finishedAt: 11 }),
    storedJob('i1', 'interrupted', { attempts: 2 })
  ]);
  const { queue, download } = make({ file });
  queue.load();
  assert.deepEqual(queue.retry(['f1', 'c1', 'i1']), ['f1', 'c1', 'i1']);
  const failed = queue.get('f1');
  assert.equal(failed.state, 'queued');
  assert.equal(failed.error, null);
  assert.equal(failed.result, null);
  assert.equal(failed.finishedAt, null);
  assert.equal(failed.progress.percent, null);
  assert.equal(failed.attempts, 3);
  await flush();
  assert.deepEqual(download.ids(), ['f1', 'c1', 'i1']);
  assert.deepEqual(
    queue.list().map((job) => job.attempts),
    [4, 2, 3]
  );
});

test('retry ignores done, paused, queued and running jobs', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  const [a, b] = queue.add([input('download'), input('download')]);
  const [c] = queue.add([input('download')], { start: false });
  await flush();
  assert.deepEqual(queue.retry([a, b, c]), []);
  download.last(a).resolve({ path: 'a' });
  await flush();
  assert.deepEqual(queue.retry([a]), []);
  assert.equal(queue.get(a).state, 'done');
  assert.equal(queue.get(a).result.path, 'a');
});

test('remove drops a running job at once and frees its slot only after the runner stops', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  download.honorAbort = false;
  const finished = [];
  const progress = [];
  queue.on('job-finished', (job) => finished.push(job.id));
  queue.on('progress', (id) => progress.push(id));
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  assert.deepEqual(queue.remove([a]), [a]);
  assert.equal(queue.get(a), null);
  assert.deepEqual(
    queue.list().map((job) => job.id),
    [b]
  );
  assert.equal(download.last(a).reason, 'cancel');
  await flush();
  assert.deepEqual(download.ids(), [a]);
  assert.equal(queue.get(b).state, 'queued');
  assert.deepEqual(download.cleaned, []);
  download.last(a).reject(abortError('cancel'));
  await flush();
  assert.deepEqual(download.ids(), [a, b]);
  assert.deepEqual(download.cleaned, [a]);
  assert.deepEqual(finished, []);
  assert.deepEqual(progress, []);
  download.last(a).ctx.note({ title: 'ghost' });
  download.last(a).ctx.progress({ percent: 5 });
  assert.equal(queue.get(a), null);
});

test('remove cleans up paused, queued, interrupted and failed jobs but not done or canceled ones', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 1;
  const file = writeJobs('remove.json', [
    storedJob('i1', 'interrupted'),
    storedJob('f1', 'failed', { finishedAt: 3, error: { code: 'x', message: 'x' } }),
    storedJob('d1', 'done', { finishedAt: 4, result: { path: 'C:\\v.mp4' } }),
    storedJob('c1', 'canceled', { finishedAt: 5 }),
    storedJob('p1', 'paused')
  ]);
  const { queue, download } = make({ file });
  queue.load();
  const [a, q] = queue.add([input('download'), input('download')]);
  await flush();
  const removed = queue.remove(['i1', 'f1', 'd1', 'c1', 'p1', q, 'nope']);
  assert.deepEqual(removed, ['i1', 'f1', 'd1', 'c1', 'p1', q]);
  await flush();
  assert.deepEqual(download.cleaned.sort(), ['f1', 'i1', 'p1', q].sort());
  assert.deepEqual(
    queue.list().map((job) => job.id),
    [a]
  );
});

test('reorder moves only pending jobs and keeps their relative order', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue } = make();
  const [a, b, c, d, e] = queue.add([
    input('download', 'A'),
    input('download', 'B'),
    input('download', 'C'),
    input('download', 'D'),
    input('download', 'E')
  ]);
  await flush();
  assert.equal(queue.reorder([e, a, c], b), true);
  assert.deepEqual(titles(queue), ['A', 'C', 'E', 'B', 'D']);
  queue.pause([d]);
  assert.equal(queue.reorder([d, b], c), true);
  assert.deepEqual(titles(queue), ['A', 'B', 'D', 'C', 'E']);
  assert.equal(queue.get(a).state, 'running');
  assert.equal(queue.reorder([a], b), false);
  assert.deepEqual(titles(queue), ['A', 'B', 'D', 'C', 'E']);
  assert.equal(queue.reorder([e], a), true);
  assert.deepEqual(titles(queue), ['E', 'A', 'B', 'D', 'C']);
});

test('reorder to the end, to unknown targets and onto itself', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const [a, b, c] = queue.add([input('download', 'A'), input('download', 'B'), input('download', 'C')], { start: false });
  assert.equal(queue.reorder([a]), true);
  assert.deepEqual(titles(queue), ['B', 'C', 'A']);
  assert.equal(queue.reorder([b], null), true);
  assert.deepEqual(titles(queue), ['C', 'A', 'B']);
  assert.equal(queue.reorder([c], 'unknown'), false);
  assert.equal(queue.reorder([c, a], a), false);
  assert.equal(queue.reorder([c], 42), false);
  assert.equal(queue.reorder(['unknown'], a), false);
  assert.equal(queue.reorder([b], null), false);
  assert.deepEqual(titles(queue), ['C', 'A', 'B']);
});

test('reorder changes which queued job starts next', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  const [a, b, c] = queue.add([input('download'), input('download'), input('download')]);
  await flush();
  queue.reorder([c], b);
  download.last(a).resolve({ path: 'a' });
  await flush();
  assert.deepEqual(download.ids(), [a, c]);
});

test('clearFinished removes done and canceled jobs and keeps failed ones for retry', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 5;
  const { queue, download } = make();
  const [a, b, c, d] = queue.add([input('download'), input('download'), input('download'), input('download')]);
  const [p] = queue.add([input('download')], { start: false });
  await flush();
  download.last(a).resolve({ path: 'a' });
  download.last(b).reject(new Error('bad'));
  queue.cancel([c]);
  await flush();
  assert.deepEqual(queue.clearFinished().sort(), [a, c].sort());
  assert.deepEqual(
    queue.list().map((job) => job.id),
    [b, d, p]
  );
  assert.deepEqual(download.cleaned, []);
  assert.deepEqual(queue.clearFinished(), []);
});

test('pauseAll pauses running and queued jobs and startAll resumes paused and interrupted ones', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 1;
  const file = writeJobs('all.json', [storedJob('i1', 'interrupted'), storedJob('f1', 'failed', { finishedAt: 2 })]);
  const { queue, download } = make({ file });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  assert.deepEqual(queue.pauseAll().sort(), [a, b].sort());
  await flush();
  assert.deepEqual(states(queue), ['interrupted', 'failed', 'paused', 'paused']);
  assert.deepEqual(queue.startAll().sort(), ['i1', a, b].sort());
  await flush();
  assert.deepEqual(states(queue), ['running', 'failed', 'queued', 'queued']);
  assert.deepEqual(download.ids(), [a, 'i1']);
});

test('ids may be a single string; unknown, duplicate and non-string ids are ignored', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const [a, b] = queue.add([input('download'), input('download')], { start: false });
  assert.deepEqual(queue.resume(a), [a]);
  assert.deepEqual(queue.pause([a, a, 5, null, {}, 'nope', b]), [a]);
  assert.deepEqual(queue.cancel(undefined), []);
  assert.deepEqual(queue.remove([[b]]), []);
  assert.equal(queue.get('nope'), null);
  assert.equal(queue.get(undefined), null);
});

test('list and get return copies that cannot change the queue', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const [a] = queue.add([input('download', 'original')], { start: false });
  const listed = queue.list();
  listed[0].title = 'changed';
  listed[0].state = 'done';
  listed[0].spec.title = 'changed';
  listed.pop();
  const got = queue.get(a);
  got.progress.percent = 99;
  assert.equal(queue.get(a).title, 'original');
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(queue.get(a).spec.title, 'original');
  assert.equal(queue.get(a).progress.percent, null);
  assert.equal(queue.list().length, 1);
});

test('queue methods are safe no-ops after dispose', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')], { start: false });
  queue.dispose();
  assert.throws(() => queue.add([input('download')]), /closed/);
  assert.deepEqual(queue.resume([a]), []);
  assert.deepEqual(queue.pause([a]), []);
  assert.deepEqual(queue.cancel([a]), []);
  assert.deepEqual(queue.retry([a]), []);
  assert.deepEqual(queue.remove([a]), []);
  assert.equal(queue.reorder([a]), false);
  assert.deepEqual(queue.clearFinished(), []);
  assert.deepEqual(queue.startAll(), []);
  queue.reschedule();
  queue.dispose();
  await queue.shutdown('cancel');
  await flush();
  assert.equal(download.runs.length, 0);
});
