const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Queue } = require('../src/main/queue');
const { JobError, KNOWN_ERRORS } = require('../src/main/errors');
const { ProcessError } = require('../src/main/processes');

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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(queue, predicate, ms = 3000) {
  return new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const check = () => {
      if (!predicate()) return;
      clearTimeout(timer);
      queue.off('changed', check);
      resolve();
    };
    const timer = setTimeout(() => {
      queue.off('changed', check);
      reject(new Error('Timed out waiting for the queue'));
    }, ms);
    queue.on('changed', check);
  });
}

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
  return { dir, limits, make };
}

let counter = 0;
function input(kind, title = `${kind} ${(counter += 1)}`, extra = {}) {
  return { kind, title, spec: { title }, ...extra };
}

const states = (queue) => queue.list().map((job) => job.state);

test('starts queued jobs in order up to the per-kind limit', async (t) => {
  const { make } = setup(t);
  const { queue, convert, download } = make();
  queue.load();
  const ids = queue.add([
    input('download', 'd1'),
    input('download', 'd2'),
    input('download', 'd3'),
    input('convert', 'c1'),
    input('convert', 'c2')
  ]);
  await flush();
  assert.deepEqual(download.ids(), [ids[0], ids[1]]);
  assert.deepEqual(convert.ids(), [ids[3]]);
  assert.deepEqual(states(queue), ['running', 'running', 'queued', 'running', 'queued']);
  const job = queue.get(ids[0]);
  assert.equal(job.attempts, 1);
  assert.equal(typeof job.startedAt, 'number');
  assert.equal(job.neverStarted, false);
  assert.equal(download.runs[0].job.title, 'd1');
});

test('a waiting convert job does not block a download added after it', async (t) => {
  const { make } = setup(t);
  const { queue, convert, download } = make();
  const ids = queue.add([input('convert'), input('convert'), input('download')]);
  await flush();
  assert.deepEqual(convert.ids(), [ids[0]]);
  assert.deepEqual(download.ids(), [ids[2]]);
  assert.equal(queue.get(ids[1]).state, 'queued');
});

test('jobs from separate batches start in FIFO order', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  const [b, c] = queue.add([input('download'), input('download')]);
  await flush();
  download.last(a).resolve({ path: 'a' });
  await flush();
  download.last(b).resolve({ path: 'b' });
  await flush();
  assert.deepEqual(download.ids(), [a, b, c]);
});

test('waits for the ready promise before starting anything', async (t) => {
  const { make } = setup(t);
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const { queue, download } = make({ ready });
  const [id] = queue.add([input('download')]);
  await flush();
  await flush();
  assert.equal(download.runs.length, 0);
  assert.equal(queue.get(id).state, 'queued');
  release();
  await flush();
  assert.deepEqual(download.ids(), [id]);
});

test('a rejected ready promise does not block the queue forever', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make({ ready: Promise.reject(new Error('setup failed')) });
  queue.add([input('download')]);
  await flush();
  assert.equal(download.runs.length, 1);
});

test('a finished job frees its slot for the next queued job and emits job-finished', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make();
  const [a, b, c] = queue.add([input('convert'), input('convert'), input('convert')]);
  await flush();
  const finished = [];
  queue.on('job-finished', (job) => finished.push(job));
  convert.last(a).resolve({ path: 'C:\\out\\a.mp4', size: 1234, warnings: ['vfr-source', 7], skipped: false });
  await flush();
  assert.deepEqual(convert.ids(), [a, b]);
  const done = queue.get(a);
  assert.equal(done.state, 'done');
  assert.deepEqual(done.result, { path: 'C:\\out\\a.mp4', size: 1234, warnings: ['vfr-source'], skipped: false });
  assert.equal(done.progress.percent, 100);
  assert.equal(done.error, null);
  assert.equal(typeof done.finishedAt, 'number');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].id, a);
  assert.equal(finished[0].state, 'done');
  assert.equal(queue.get(c).state, 'queued');
});

test('a runner that resolves with nothing still completes the job', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make();
  const [a] = queue.add([input('convert')]);
  await flush();
  convert.last(a).resolve(undefined);
  await flush();
  assert.equal(queue.get(a).state, 'done');
  assert.deepEqual(queue.get(a).result, { path: null, size: null, warnings: [], skipped: false });
});

test('raising a limit starts more jobs on reschedule', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  const ids = queue.add([input('download'), input('download'), input('download')]);
  await flush();
  assert.equal(download.runs.length, 1);
  limits.download = 3;
  queue.reschedule();
  await flush();
  assert.deepEqual(download.ids(), ids);
  assert.ok(download.runs.every((run) => run.reason === null));
});

test('lowering a limit never stops running jobs and holds new starts until below the limit', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 3;
  const { queue, download } = make();
  const ids = queue.add([input('download'), input('download'), input('download'), input('download')]);
  await flush();
  assert.equal(download.runs.length, 3);
  limits.download = 1;
  queue.reschedule();
  await flush();
  assert.deepEqual(states(queue), ['running', 'running', 'running', 'queued']);
  assert.ok(download.runs.every((run) => run.reason === null));
  download.last(ids[0]).resolve({ path: 'a' });
  await flush();
  assert.equal(queue.get(ids[3]).state, 'queued');
  download.last(ids[1]).resolve({ path: 'b' });
  await flush();
  assert.equal(queue.get(ids[3]).state, 'queued');
  download.last(ids[2]).resolve({ path: 'c' });
  await flush();
  assert.equal(queue.get(ids[3]).state, 'running');
  assert.equal(download.runs.length, 4);
});

test('invalid or throwing limits fall back to one job per kind', async (t) => {
  const { make } = setup(t);
  const broken = make({
    limits: () => {
      throw new Error('settings not ready');
    }
  });
  broken.queue.add([input('download'), input('download'), input('convert'), input('convert')]);
  const odd = make({ limits: () => ({ download: 'many', convert: -3 }) });
  odd.queue.add([input('download'), input('download'), input('convert'), input('convert')]);
  const huge = make({ limits: () => ({ download: 1e9, convert: 2.9 }) });
  const hugeIds = huge.queue.add(Array.from({ length: 20 }, () => input('download')));
  huge.queue.add([input('convert'), input('convert'), input('convert')]);
  await flush();
  assert.equal(broken.download.runs.length, 1);
  assert.equal(broken.convert.runs.length, 1);
  assert.equal(odd.download.runs.length, 1);
  assert.equal(odd.convert.runs.length, 1);
  assert.equal(huge.download.runs.length, 16);
  assert.equal(huge.convert.runs.length, 2);
  assert.equal(huge.queue.get(hugeIds[19]).state, 'queued');
});

test('never starts the same job twice', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [id] = queue.add([input('download')]);
  for (let i = 0; i < 10; i += 1) {
    queue.reschedule();
    queue.resume([id]);
    queue.retry([id]);
  }
  await flush();
  await flush();
  queue.reschedule();
  await flush();
  assert.deepEqual(download.ids(), [id]);
  assert.equal(queue.get(id).attempts, 1);
});

test('follow-up jobs are inserted right after the parent and inherit its group', async (t) => {
  const { make } = setup(t);
  const { queue, download, convert } = make();
  const [d1, d2] = queue.add([
    input('download', 'd1', { groupId: 'PL123', groupTitle: 'Playlist' }),
    input('download', 'd2', { groupId: 'PL123', groupTitle: 'Playlist' })
  ]);
  await flush();
  download.last(d1).resolve({
    path: 'C:\\v\\d1.mp4',
    size: 10,
    followUps: [
      input('convert', 'd1 convert', { spec: { source: 'C:\\v\\d1.mp4' }, parentId: 'ignored' }),
      input('convert', 'd1 extra', { groupId: 'other', groupTitle: 'Other' })
    ]
  });
  await flush();
  const list = queue.list();
  assert.deepEqual(
    list.map((job) => job.title),
    ['d1', 'd1 convert', 'd1 extra', 'd2']
  );
  assert.equal(list[1].parentId, d1);
  assert.equal(list[1].groupId, 'PL123');
  assert.equal(list[1].groupTitle, 'Playlist');
  assert.equal(list[2].parentId, d1);
  assert.equal(list[2].groupId, 'other');
  assert.equal(list[2].groupTitle, 'Other');
  assert.equal(list[1].state, 'running');
  assert.equal(list[1].neverStarted, false);
  assert.equal(list[2].state, 'queued');
  assert.deepEqual(convert.ids(), [list[1].id]);
  assert.deepEqual(convert.runs[0].job.spec, { source: 'C:\\v\\d1.mp4' });
  assert.equal(list[3].id, d2);
});

test('follow-ups of a run that finished while being paused are added as Ready', async (t) => {
  const { make } = setup(t);
  const { queue, download, convert } = make();
  const [d] = queue.add([input('download')]);
  await flush();
  download.honorAbort = false;
  queue.pause([d]);
  download.last(d).resolve({ path: 'C:\\v\\a.mp4', followUps: [input('convert', 'after')] });
  await flush();
  const list = queue.list();
  assert.equal(list[0].state, 'done');
  assert.equal(list[1].title, 'after');
  assert.equal(list[1].state, 'paused');
  assert.equal(list[1].neverStarted, true);
  assert.equal(convert.runs.length, 0);
});

test('invalid follow-ups are ignored', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [d] = queue.add([input('download', 'parent')]);
  await flush();
  download.last(d).resolve({
    path: 'x',
    followUps: [
      null,
      { kind: 'bogus', title: 'x', spec: {} },
      { kind: 'convert', title: 5, spec: {} },
      { kind: 'convert', title: 'bad spec', spec: 'nope' },
      input('convert', 'valid')
    ]
  });
  await flush();
  assert.deepEqual(
    queue.list().map((job) => job.title),
    ['parent', 'valid']
  );
});

test('runner failures become failed jobs with serializable errors', async (t) => {
  const { make, limits } = setup(t);
  limits.convert = 3;
  const { queue, convert } = make();
  const finished = [];
  queue.on('job-finished', (job) => finished.push(job.state));
  const [a, b, c] = queue.add([input('convert'), input('convert'), input('convert')]);
  await flush();
  convert.last(a).reject(
    new JobError('encoder-failed', {
      message: 'The video encoder failed.',
      detail: 'Error while opening encoder',
      action: 'retry-software'
    })
  );
  convert.last(b).reject(new Error('kaput'));
  convert.last(c).reject(new ProcessError('spawn ffmpeg.exe ENOENT', { spawnFailed: true }));
  await flush();
  assert.deepEqual(queue.get(a).error, {
    code: 'encoder-failed',
    message: 'The video encoder failed.',
    detail: 'Error while opening encoder',
    hint: null,
    action: 'retry-software',
    retryable: true
  });
  assert.equal(queue.get(a).state, 'failed');
  assert.equal(typeof queue.get(a).finishedAt, 'number');
  assert.equal(queue.get(b).error.code, 'unexpected');
  assert.equal(queue.get(b).error.detail, 'kaput');
  assert.equal(queue.get(c).error.code, 'tool-missing');
  assert.deepEqual(finished, ['failed', 'failed', 'failed']);
  assert.deepEqual(convert.cleaned, []);
  assert.doesNotThrow(() => JSON.stringify(queue.list()));
});

test('a runner that throws synchronously fails the job and the queue continues', async (t) => {
  const { make } = setup(t);
  const runners = {
    convert: {
      run() {
        throw new Error('sync boom');
      }
    },
    download: createRunner()
  };
  const { queue } = make({ runners });
  const [a, b] = queue.add([input('convert'), input('convert')]);
  await flush();
  assert.equal(queue.get(a).state, 'failed');
  assert.equal(queue.get(a).error.detail, 'sync boom');
  assert.equal(queue.get(b).state, 'failed');
});

test('an abort error the queue did not request is reported as unexpected', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make();
  const [a] = queue.add([input('convert')]);
  await flush();
  convert.last(a).reject(abortError('internal'));
  await flush();
  assert.equal(queue.get(a).state, 'failed');
  assert.equal(queue.get(a).error.code, 'unexpected');
});

test('no progress within stallMs fails the job as stalled and retryable', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make({ stallMs: () => 20 });
  const [a, b] = queue.add([input('convert'), input('convert')]);
  await flush();
  await waitFor(queue, () => queue.get(a).state === 'failed');
  assert.equal(convert.last(a).reason, 'stall');
  assert.deepEqual(queue.get(a).error, {
    code: 'stalled',
    message: KNOWN_ERRORS.stalled.message,
    detail: null,
    hint: KNOWN_ERRORS.stalled.hint,
    action: null,
    retryable: true
  });
  assert.equal(queue.get(a).progress.stage, null);
  assert.deepEqual(convert.ids(), [a, b]);
  assert.deepEqual(convert.cleaned, []);
  queue.retry([a]);
  assert.equal(queue.get(a).state, 'queued');
  assert.equal(queue.get(a).error, null);
});

test('every progress report re-arms the stall watchdog and re-reads stallMs', async (t) => {
  const { make } = setup(t);
  let reads = 0;
  const { queue, convert } = make({
    stallMs: () => {
      reads += 1;
      return 60000;
    }
  });
  const [a] = queue.add([input('convert')]);
  await flush();
  assert.equal(reads, 1);
  const { ctx } = convert.last(a);
  ctx.progress({ percent: 10 });
  assert.equal(reads, 2);
  ctx.progress({ percent: 10 });
  assert.equal(reads, 3);
  ctx.progress();
  assert.equal(reads, 4);
  convert.honorAbort = false;
  queue.pause([a]);
  ctx.progress({ percent: 50 });
  assert.equal(reads, 4);
});

test('a job that keeps reporting progress is not treated as stalled', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make({ stallMs: () => 200 });
  const [a] = queue.add([input('convert')]);
  await flush();
  const { ctx } = convert.last(a);
  let percent = 0;
  const heartbeat = setInterval(() => ctx.progress({ percent: (percent += 1) }), 10);
  t.after(() => clearInterval(heartbeat));
  await delay(450);
  clearInterval(heartbeat);
  assert.equal(queue.get(a).state, 'running');
  assert.equal(convert.last(a).reason, null);
  await waitFor(queue, () => queue.get(a).state === 'failed');
  assert.equal(queue.get(a).error.code, 'stalled');
});

test('a runner that ignores abort is released after the grace period', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner({ honorAbort: false }), download: createRunner() };
  const { queue, convert } = make({ runners, abortGraceMs: 30 });
  const [a, b] = queue.add([input('convert'), input('convert')]);
  await flush();
  const finished = [];
  queue.on('job-finished', (job) => finished.push(job.id));
  queue.pause([a]);
  await flush();
  assert.equal(convert.last(a).reason, 'pause');
  assert.equal(queue.get(a).state, 'running');
  assert.equal(queue.get(a).progress.stage, 'stopping');
  assert.equal(convert.runs.length, 1);
  await waitFor(queue, () => queue.get(a).state === 'paused');
  assert.equal(queue.get(a).progress.stage, null);
  assert.deepEqual(convert.ids(), [a, b]);
  convert.last(a).resolve({ path: 'late' });
  await flush();
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(queue.get(a).result, null);
  assert.deepEqual(finished, []);
});

test('canceling a runner that ignores abort ends canceled and runs cleanup', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner({ honorAbort: false }), download: createRunner() };
  const { queue, convert } = make({ runners, abortGraceMs: 20 });
  const [a] = queue.add([input('convert')]);
  await flush();
  queue.cancel([a]);
  await waitFor(queue, () => queue.get(a).state === 'canceled');
  await flush();
  assert.deepEqual(convert.cleaned, [a]);
});

test('a stalled runner that ignores abort still ends failed as stalled', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner({ honorAbort: false }), download: createRunner() };
  const { queue, convert } = make({ runners, abortGraceMs: 20, stallMs: () => 20 });
  const [a] = queue.add([input('convert')]);
  await waitFor(queue, () => queue.get(a).state === 'failed');
  assert.equal(convert.last(a).reason, 'stall');
  assert.equal(queue.get(a).error.code, 'stalled');
});

test('synchronous bursts emit a single changed event', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  queue.load();
  await flush();
  let changes = 0;
  queue.on('changed', () => {
    changes += 1;
  });
  const ids = queue.add([input('download'), input('download'), input('download')], { start: false });
  queue.resume([ids[0]]);
  queue.reorder([ids[2]], ids[0]);
  queue.cancel([ids[1]]);
  await flush();
  assert.equal(changes, 1);
  await flush();
  assert.equal(changes, 1);
});

test('calls that change nothing do not emit changed', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const [a, b] = queue.add([input('download'), input('download', 'b', {})], { start: true });
  await flush();
  let changes = 0;
  queue.on('changed', () => {
    changes += 1;
  });
  assert.deepEqual(queue.pause(['missing']), []);
  assert.deepEqual(queue.resume([a]), []);
  assert.deepEqual(queue.retry([b]), []);
  assert.equal(queue.reorder([a], b), false);
  assert.deepEqual(queue.clearFinished(), []);
  assert.deepEqual(queue.remove([]), []);
  await flush();
  assert.equal(changes, 0);
});

test('progress events carry sanitized values and stop after an abort request', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  await flush();
  const events = [];
  queue.on('progress', (id, progress) => events.push([id, progress]));
  const { ctx } = download.last(a);
  ctx.progress({ percent: 150, stage: 'download', speed: -5, eta: 12, detail: 'x'.repeat(300), bogus: 1 });
  assert.deepEqual(events, [[a, { percent: 100, stage: 'download', speed: null, eta: 12, detail: 'x'.repeat(200) }]]);
  ctx.progress({ percent: 100, stage: 'download' });
  assert.equal(events.length, 1);
  ctx.progress({ speed: 2048, eta: 'soon' });
  assert.equal(events.length, 2);
  assert.equal(events[1][1].speed, 2048);
  assert.equal(events[1][1].eta, 12);
  ctx.progress({ eta: null });
  assert.equal(events[2][1].eta, null);
  assert.equal(queue.get(a).progress.speed, 2048);
  events[2][1].percent = 1;
  assert.equal(queue.get(a).progress.percent, 100);
  download.honorAbort = false;
  queue.pause([a]);
  assert.deepEqual(events[3], [a, { percent: 100, stage: 'stopping', speed: null, eta: null, detail: 'x'.repeat(200) }]);
  ctx.progress({ percent: 5 });
  assert.equal(events.length, 4);
});

test('progress events are throttled to the latest value per job', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make({ progressMs: 30 });
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  const events = [];
  queue.on('progress', (id, progress) => events.push([id, progress.percent]));
  download.last(a).ctx.progress({ percent: 1 });
  download.last(a).ctx.progress({ percent: 2 });
  download.last(b).ctx.progress({ percent: 7 });
  download.last(a).ctx.progress({ percent: 3 });
  assert.equal(events.length, 0);
  await once(queue, 'progress');
  await flush();
  assert.deepEqual(events, [
    [a, 3],
    [b, 7]
  ]);
  download.last(a).ctx.progress({ percent: 50 });
  download.last(a).resolve({ path: 'a' });
  await flush();
  await delay(80);
  assert.equal(events.length, 2);
});

test('idle is emitted once when the last active job finishes, with counts', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const idle = [];
  queue.on('idle', (counts) => idle.push(counts));
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  download.last(a).resolve({ path: 'a' });
  await flush();
  assert.equal(idle.length, 0);
  download.last(b).reject(new Error('nope'));
  await flush();
  assert.equal(idle.length, 1);
  assert.equal(idle[0].done, 1);
  assert.equal(idle[0].failed, 1);
  assert.equal(idle[0].active, 0);
  await flush();
  queue.clearFinished();
  await flush();
  assert.equal(idle.length, 1);
  const [c] = queue.add([input('download')]);
  await flush();
  download.last(c).resolve({ path: 'c' });
  await flush();
  assert.equal(idle.length, 2);
});

test('pausing all work is not a finished queue and emits no idle', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const idle = [];
  queue.on('idle', (counts) => idle.push(counts));
  const [a, b, c] = queue.add([input('download'), input('download'), input('download')]);
  await flush();
  download.last(a).resolve({ path: 'a' });
  await flush();
  queue.pauseAll();
  await flush();
  assert.deepEqual(states(queue), ['done', 'paused', 'paused']);
  assert.equal(idle.length, 0);
  queue.resume([b, c]);
  await flush();
  download.last(b).resolve({ path: 'b' });
  download.last(c).resolve({ path: 'c' });
  await flush();
  assert.equal(idle.length, 1);
  assert.equal(idle[0].done, 3);
  assert.equal(idle[0].paused, 0);
});

test('a queued job paused by the user holds idle back until it runs', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const { queue, download } = make();
  const idle = [];
  queue.on('idle', () => idle.push(true));
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  queue.pause([b]);
  download.last(a).resolve({ path: 'a' });
  await flush();
  assert.equal(idle.length, 0);
  queue.resume([b]);
  await flush();
  download.last(b).resolve({ path: 'b' });
  await flush();
  assert.equal(idle.length, 1);
});

test('Ready jobs that were never started do not hold idle back', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const idle = [];
  queue.on('idle', (counts) => idle.push(counts));
  queue.add([input('download')], { start: false });
  const [a] = queue.add([input('download')]);
  await flush();
  download.last(a).resolve({ path: 'a' });
  await flush();
  assert.equal(idle.length, 1);
  assert.equal(idle[0].paused, 1);
});

test('canceling or removing all work emits no idle', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const idle = [];
  queue.on('idle', () => idle.push(true));
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  queue.cancel([a]);
  queue.remove([b]);
  await flush();
  await flush();
  assert.equal(queue.counts().active, 0);
  assert.equal(idle.length, 0);
  const [c, d] = queue.add([input('download'), input('download')]);
  await flush();
  queue.cancel([c]);
  download.last(d).reject(new Error('broken'));
  await flush();
  assert.equal(idle.length, 1);
});

test('ctx.note only updates whitelisted fields', async (t) => {
  const { make } = setup(t);
  const { queue, download, convert } = make();
  const spec = {
    url: 'https://example.com/v',
    info: { id: 'x', title: 'old' },
    output: { folder: 'C:\\Videos', name: 'old', collision: 'rename' },
    options: { mode: 'av' }
  };
  const [d] = queue.add([{ kind: 'download', title: 'old', spec }]);
  const [c] = queue.add([{ kind: 'convert', title: 'clip', spec: { output: { name: 'clip' } } }]);
  await flush();
  let changes = 0;
  queue.on('changed', () => {
    changes += 1;
  });
  const { ctx } = download.last(d);
  ctx.note({
    title: '  New title  ',
    state: 'done',
    kind: 'convert',
    attempts: 99,
    spec: { url: 'https://evil.example' },
    output: { name: 'New title', collision: 'overwrite', folder: 5 },
    info: { title: 'New title', channel: 'Chan', duration: 12.5, thumbnail: 'http://insecure/x.jpg', id: 'hacked' }
  });
  await flush();
  assert.equal(changes, 1);
  const job = queue.get(d);
  assert.equal(job.title, 'New title');
  assert.equal(job.state, 'running');
  assert.equal(job.kind, 'download');
  assert.equal(job.attempts, 1);
  assert.equal(job.spec.url, 'https://example.com/v');
  assert.deepEqual(job.spec.output, { folder: 'C:\\Videos', name: 'New title', collision: 'rename' });
  assert.deepEqual(job.spec.info, { id: 'x', title: 'New title', channel: 'Chan', duration: 12.5 });
  assert.deepEqual(job.spec.options, { mode: 'av' });
  ctx.note({ info: { thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg' }, output: { name: 'n'.repeat(256) } });
  assert.equal(queue.get(d).spec.info.thumbnail, 'https://i.ytimg.com/vi/x/hq.jpg');
  assert.equal(queue.get(d).spec.output.name, 'New title');
  ctx.note('nope');
  ctx.note({ title: '   ' });
  assert.equal(queue.get(d).title, 'New title');
  convert.last(c).ctx.note({ info: { title: 'x' }, output: { name: 'clip (2)' } });
  assert.equal(queue.get(c).spec.info, undefined);
  assert.equal(queue.get(c).spec.output.name, 'clip (2)');
  convert.last(c).job.spec.output.name = 'mutated by runner';
  assert.equal(queue.get(c).spec.output.name, 'clip (2)');
  convert.last(c).resolve({ path: 'x' });
  await flush();
  convert.last(c).ctx.note({ title: 'too late' });
  assert.equal(queue.get(c).title, 'clip');
});

test('ctx.settings returns the injected settings and survives a throwing source', async (t) => {
  const { make } = setup(t);
  const good = make({ settings: () => ({ general: { stallMinutes: 5 } }) });
  const bad = make({
    settings: () => {
      throw new Error('no settings');
    }
  });
  good.queue.add([input('convert')]);
  bad.queue.add([input('convert')]);
  await flush();
  assert.deepEqual(good.convert.runs[0].ctx.settings(), { general: { stallMinutes: 5 } });
  assert.equal(bad.convert.runs[0].ctx.settings(), null);
});

test('counts and activeSummary describe the queue', async (t) => {
  const { make } = setup(t);
  const { queue, download, convert } = make();
  assert.deepEqual(queue.activeSummary(), { downloads: 0, conversions: 0, speedBytes: 0, percent: null });
  const [d1, d2] = queue.add([input('download'), input('download'), input('download'), input('convert'), input('convert')]);
  queue.add([input('download')], { start: false });
  await flush();
  download.last(d1).ctx.progress({ percent: 50, speed: 1000 });
  download.last(d2).ctx.progress({ speed: 500 });
  convert.runs[0].ctx.progress({ percent: 20, speed: 3.5 });
  assert.deepEqual(queue.activeSummary(), { downloads: 2, conversions: 1, speedBytes: 1500, percent: 35 });
  assert.deepEqual(queue.counts(), {
    running: 3,
    queued: 2,
    paused: 1,
    interrupted: 0,
    done: 0,
    failed: 0,
    canceled: 0,
    active: 5
  });
  download.last(d1).resolve({ path: 'a' });
  await flush();
  const counts = queue.counts();
  assert.equal(counts.done, 1);
  assert.equal(counts.running, 3);
  assert.equal(counts.queued, 1);
});

test('add validates every input and inserts nothing when one is invalid', async (t) => {
  const { make } = setup(t);
  const { queue } = make({ runners: { download: createRunner() } });
  assert.throws(() => queue.add([input('download'), { kind: 'download', title: 'x' }]), TypeError);
  assert.throws(() => queue.add({ kind: 'nope', title: 'x', spec: {} }), TypeError);
  assert.throws(() => queue.add({ kind: 'download', title: 'x', spec: {}, groupId: 5 }), TypeError);
  assert.throws(() => queue.add({ kind: 'download', title: null, spec: {} }), TypeError);
  assert.throws(() => queue.add([null]), TypeError);
  assert.throws(() => queue.add(input('convert')), TypeError);
  assert.equal(queue.list().length, 0);
  assert.deepEqual(queue.add([]), []);
  await flush();
  assert.equal(queue.list().length, 0);
});

test('add copies the spec, trims long titles and creates unique ids', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const spec = { output: { name: 'a' }, skip: undefined };
  const ids = queue.add([{ kind: 'download', title: 't'.repeat(2000), spec }], { start: false });
  spec.output.name = 'changed';
  const job = queue.get(ids[0]);
  assert.equal(job.spec.output.name, 'a');
  assert.equal('skip' in job.spec, false);
  assert.equal(job.title.length, 1024);
  assert.equal(job.state, 'paused');
  assert.equal(job.neverStarted, true);
  assert.equal(job.attempts, 0);
  assert.equal(job.parentId, null);
  assert.equal(job.groupId, null);
  assert.equal(job.result, null);
  assert.equal(job.error, null);
  assert.deepEqual(job.progress, { percent: null, stage: null, speed: null, eta: null, detail: null });
  const many = queue.add(Array.from({ length: 300 }, () => input('download')), { start: false });
  assert.equal(new Set([...ids, ...many]).size, 301);
  assert.ok([...ids, ...many].every((id) => /^j[a-z0-9]+$/.test(id) && id.length <= 64));
  const single = queue.add(input('download'), { start: false });
  assert.equal(single.length, 1);
  job.spec.output.name = 'mutated copy';
  assert.equal(queue.get(ids[0]).spec.output.name, 'a');
});

test('a follow-up with a bogus parentId is still linked to its real parent', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [d] = queue.add([input('download', 'parent')]);
  await flush();
  download.last(d).resolve({ path: 'x', followUps: [input('convert', 'child', { parentId: 42 })] });
  await flush();
  const list = queue.list();
  assert.deepEqual(
    list.map((job) => job.title),
    ['parent', 'child']
  );
  assert.equal(list[1].parentId, d);
});

test('ctx.note with values that are already set does not emit changed', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const spec = { url: 'https://example.com/v', info: { title: 'Same', duration: 5 }, output: { name: 'Same', folder: 'C:\\V' } };
  const [d] = queue.add([{ kind: 'download', title: 'Same', spec }]);
  await flush();
  let changes = 0;
  queue.on('changed', () => {
    changes += 1;
  });
  download.last(d).ctx.note({ title: 'Same', output: { name: 'Same', folder: 'C:\\V' }, info: { title: 'Same', duration: 5 } });
  await flush();
  assert.equal(changes, 0);
  download.last(d).ctx.note({ info: { duration: 6 } });
  await flush();
  assert.equal(changes, 1);
  assert.deepEqual(queue.get(d).spec.info, { title: 'Same', duration: 6 });
});

test('a runner that reports and resolves synchronously completes normally', async (t) => {
  const { make } = setup(t);
  const events = [];
  const runners = {
    convert: {
      run(job, ctx) {
        ctx.progress({ percent: 50, stage: 'encode' });
        ctx.note({ title: 'renamed' });
        return { path: `C:\\out\\${job.id}.mp4`, size: 1 };
      }
    },
    download: createRunner()
  };
  const { queue } = make({ runners });
  queue.on('progress', (id, progress) => events.push(progress.percent));
  const [a, b] = queue.add([input('convert'), input('convert')]);
  await flush();
  await flush();
  assert.deepEqual(states(queue), ['done', 'done']);
  assert.equal(queue.get(a).title, 'renamed');
  assert.equal(queue.get(b).result.path, `C:\\out\\${b}.mp4`);
  assert.deepEqual(events, [50, 50]);
});

test('a runner that throws the abort reason itself still ends with the requested state', async (t) => {
  const { make } = setup(t);
  const runners = {
    convert: {
      run(job, ctx) {
        return new Promise((resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            try {
              ctx.signal.throwIfAborted();
            } catch (reason) {
              reject(reason);
            }
          });
        });
      }
    },
    download: createRunner()
  };
  const { queue } = make({ runners });
  const [a] = queue.add([input('convert')]);
  await flush();
  queue.pause([a]);
  await flush();
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(queue.get(a).error, null);
});

test('a real failure reported while pausing still leaves the job paused', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make();
  convert.honorAbort = false;
  const [a] = queue.add([input('convert')]);
  await flush();
  queue.pause([a]);
  convert.last(a).reject(new JobError('encoder-failed', { detail: 'killed' }));
  await flush();
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(queue.get(a).error, null);
});

test('a user pause while a stall is stopping wins over the stall', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner({ honorAbort: false }), download: createRunner() };
  const { queue, convert } = make({ runners, stallMs: () => 15 });
  const [a] = queue.add([input('convert')]);
  await flush();
  await delay(40);
  assert.equal(convert.last(a).reason, 'stall');
  assert.equal(queue.get(a).state, 'running');
  assert.deepEqual(queue.pause([a]), [a]);
  convert.last(a).reject(abortError('stall'));
  await flush();
  assert.equal(queue.get(a).state, 'paused');
  assert.equal(queue.get(a).error, null);
});

test('a throwing progress listener cannot leave a paused job stuck', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner({ honorAbort: false }), download: createRunner() };
  const { queue, convert } = make({ runners, abortGraceMs: 20 });
  const [a] = queue.add([input('convert')]);
  await flush();
  queue.on('progress', () => {
    throw new Error('renderer gone');
  });
  assert.throws(() => queue.pause([a]), /renderer gone/);
  assert.equal(convert.last(a).reason, 'pause');
  await waitFor(queue, () => queue.get(a).state === 'paused');
});

test('non-finite progress values are ignored', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  await flush();
  const { ctx } = download.last(a);
  ctx.progress({ percent: 25, speed: 100, eta: 4 });
  ctx.progress({ percent: NaN, speed: Infinity, eta: -1, stage: 12, detail: { text: 'x' } });
  ctx.progress({ percent: '50' });
  ctx.progress(null);
  ctx.progress([1, 2]);
  assert.deepEqual(queue.get(a).progress, { percent: 25, stage: null, speed: 100, eta: 4, detail: null });
  assert.equal(queue.activeSummary().speedBytes, 100);
});

test('a long queue keeps FIFO order per kind', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 2;
  const { queue, download } = make();
  const ids = queue.add(Array.from({ length: 2000 }, (_, index) => input('download', `item ${index}`)));
  await flush();
  for (let index = 0; index < 20; index += 1) {
    download.last(ids[index]).resolve({ path: `p${index}` });
    await flush();
  }
  assert.deepEqual(download.ids(), ids.slice(0, 22));
  assert.equal(queue.counts().done, 20);
  assert.equal(queue.counts().queued, 1978);
});
