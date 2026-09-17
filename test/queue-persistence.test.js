const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Queue, normalizeQueueFile } = require('../src/main/queue');
const { JobError } = require('../src/main/errors');

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function waitForFile(file, predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const data = readJson(file);
      if (predicate(data)) return data;
    } catch {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the queue file');
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the queue file');
    await delay(10);
  }
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
  const fileAt = (name) => path.join(dir, name);
  const writeJobs = (name, jobs) => {
    const file = fileAt(name);
    fs.writeFileSync(file, JSON.stringify({ version: 1, jobs }));
    return file;
  };
  return { dir, limits, make, fileAt, writeJobs };
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
    progress: { percent: 12, stage: 'download', speed: 5, eta: 3, detail: '12 MB' },
    result: null,
    error: null,
    ...extra
  };
}

const JOB_KEYS = [
  'id',
  'kind',
  'state',
  'title',
  'createdAt',
  'startedAt',
  'finishedAt',
  'attempts',
  'neverStarted',
  'groupId',
  'groupTitle',
  'parentId',
  'spec',
  'progress',
  'result',
  'error'
];

const states = (queue) => queue.list().map((job) => job.state);

test('jobs survive a crash with transient progress stripped and come back interrupted', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('session.json');
  const first = make({ file });
  first.queue.load();
  const [a, b, c, d] = first.queue.add([
    input('download', 'A', { groupId: 'PL1', groupTitle: 'List' }),
    input('download', 'B'),
    input('convert', 'C'),
    input('convert', 'D')
  ]);
  const [e] = first.queue.add([input('download', 'E')], { start: false });
  await flush();
  first.download.last(a).ctx.progress({ percent: 30, speed: 999, eta: 10, stage: 'download', detail: '3 of 10 MB' });
  first.convert.last(c).resolve({ path: 'C:\\out\\c.mp4', size: 5, warnings: ['upscaled'] });
  await flush();
  first.convert.last(d).reject(new JobError('encoder-failed', { detail: 'bad' }));
  await flush();
  const saved = await waitForFile(file, (data) => data.jobs.length === 5 && data.jobs[3].state === 'failed');
  assert.equal(saved.version, 1);
  assert.deepEqual(
    saved.jobs.map((job) => job.state),
    ['running', 'running', 'done', 'failed', 'paused']
  );
  assert.deepEqual(saved.jobs[0].progress, { percent: 30, stage: 'download', speed: null, eta: null, detail: '3 of 10 MB' });
  assert.ok(saved.jobs.every((job) => job.progress.speed === null && job.progress.eta === null));
  assert.deepEqual(Object.keys(saved.jobs[0]).sort(), [...JOB_KEYS].sort());
  const crashCopy = fileAt('crash-copy.json');
  fs.copyFileSync(file, crashCopy);
  const second = make({ file: crashCopy });
  const list = second.queue.load();
  await flush();
  assert.deepEqual(
    list.map((job) => job.id),
    [a, b, c, d, e]
  );
  assert.deepEqual(states(second.queue), ['interrupted', 'interrupted', 'done', 'failed', 'paused']);
  assert.deepEqual(list[0].progress, { percent: null, stage: null, speed: null, eta: null, detail: null });
  assert.equal(list[0].attempts, 1);
  assert.equal(list[0].groupId, 'PL1');
  assert.equal(list[0].groupTitle, 'List');
  assert.deepEqual(list[2].result, { path: 'C:\\out\\c.mp4', size: 5, warnings: ['upscaled'], skipped: false });
  assert.equal(list[2].progress.percent, 100);
  assert.equal(list[3].error.code, 'encoder-failed');
  assert.equal(list[3].error.detail, 'bad');
  assert.equal(list[4].neverStarted, true);
  assert.equal(second.download.runs.length, 0);
  assert.equal(second.convert.runs.length, 0);
  assert.equal(second.queue.recovered, false);
});

test('without autoResume nothing starts after a restart', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('restart.json', [
    storedJob('r1', 'running'),
    storedJob('q1', 'queued'),
    storedJob('i1', 'interrupted'),
    storedJob('p1', 'paused', { neverStarted: true })
  ]);
  const { queue, download } = make({ file, autoResume: () => false });
  queue.load();
  await flush();
  assert.deepEqual(states(queue), ['interrupted', 'interrupted', 'interrupted', 'paused']);
  assert.ok(queue.list().every((job) => job.progress.percent === null && job.progress.stage === null));
  assert.equal(download.runs.length, 0);
  const saved = await waitForFile(file, (data) => data.jobs[0].state === 'interrupted');
  assert.deepEqual(
    saved.jobs.map((job) => job.state),
    ['interrupted', 'interrupted', 'interrupted', 'paused']
  );
});

test('autoResume requeues running, queued and interrupted jobs and starts them, paused stay paused', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('auto.json', [
    storedJob('r1', 'running'),
    storedJob('q1', 'queued'),
    storedJob('i1', 'interrupted'),
    storedJob('p1', 'paused'),
    storedJob('d1', 'done', { finishedAt: 5, result: { path: 'C:\\d1.mp4', size: 1 } }),
    storedJob('f1', 'failed', { finishedAt: 6, error: { code: 'stalled', message: 'Stalled.' } })
  ]);
  const { queue, download } = make({ file, autoResume: () => true });
  queue.load();
  await flush();
  assert.deepEqual(states(queue), ['running', 'running', 'queued', 'paused', 'done', 'failed']);
  assert.deepEqual(download.ids(), ['r1', 'q1']);
  assert.equal(queue.get('r1').attempts, 2);
  assert.deepEqual(queue.get('d1').progress, { percent: 12, stage: null, speed: null, eta: null, detail: '12 MB' });
});

test('a throwing autoResume source is treated as off', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('auto-throw.json', [storedJob('q1', 'queued')]);
  const { queue, download } = make({
    file,
    autoResume: () => {
      throw new Error('settings missing');
    }
  });
  queue.load();
  await flush();
  assert.deepEqual(states(queue), ['interrupted']);
  assert.equal(download.runs.length, 0);
});

test('a restored job whose runner is missing fails instead of hanging', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('no-runner.json', [storedJob('q1', 'queued')]);
  const { queue } = make({ file, autoResume: () => true, runners: { convert: createRunner() } });
  queue.load();
  await flush();
  assert.equal(queue.get('q1').state, 'failed');
  assert.equal(queue.get('q1').error.code, 'unexpected');
});

test('a corrupt queue file is kept as .bak and the queue starts empty', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('corrupt.json');
  fs.writeFileSync(file, '{"version":1,"jobs":[{"id":');
  const { queue } = make({ file });
  assert.deepEqual(queue.load(), []);
  assert.equal(queue.recovered, true);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '{"version":1,"jobs":[{"id":');
  queue.add([input('download', 'fresh')], { start: false });
  queue.dispose();
  const saved = readJson(file);
  assert.equal(saved.version, 1);
  assert.deepEqual(
    saved.jobs.map((job) => job.title),
    ['fresh']
  );
});

test('a missing queue file starts empty without a backup', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('missing.json');
  const { queue } = make({ file });
  assert.deepEqual(queue.load(), []);
  assert.equal(queue.recovered, false);
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test('wrong top-level shapes load as an empty queue', async (t) => {
  const { make, fileAt } = setup(t);
  for (const [name, content] of [
    ['array.json', '[]'],
    ['jobs-text.json', '{"version":1,"jobs":"nope"}'],
    ['null.json', 'null'],
    ['future.json', '{"version":7,"jobs":[{"id":"x"}]}']
  ]) {
    const file = fileAt(name);
    fs.writeFileSync(file, content);
    const { queue } = make({ file });
    assert.deepEqual(queue.load(), [], name);
  }
});

test('malformed jobs are dropped and the valid ones are coerced', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('malformed.json', [
    storedJob('good1', 'paused', {
      attempts: -2,
      createdAt: 'yesterday',
      title: 't'.repeat(3000),
      progress: { percent: 150, stage: 5 },
      error: { code: 'x-y', message: 'm', action: 'rm-rf', retryable: false },
      groupId: 'g'.repeat(200),
      groupTitle: 9,
      parentId: 'bad id!',
      neverStarted: 'yes'
    }),
    null,
    'text',
    42,
    [],
    { ...storedJob('noid', 'paused'), id: undefined },
    storedJob('bad id', 'paused'),
    storedJob('i'.repeat(65), 'paused'),
    storedJob('badkind', 'paused', { kind: 'upload' }),
    storedJob('badstate', 'exploded'),
    storedJob('nospec', 'paused', { spec: null }),
    storedJob('arrayspec', 'paused', { spec: [] }),
    storedJob('notitle', 'paused', { title: 7 }),
    storedJob('good1', 'done'),
    storedJob('good2', 'done', {
      kind: 'convert',
      result: { path: 'C:\\x.mp4', size: -1, warnings: 'nope', skipped: 'yes' },
      error: [1],
      finishedAt: 'later',
      startedAt: 17
    })
  ]);
  const { queue } = make({ file });
  const list = queue.load();
  assert.deepEqual(
    list.map((job) => job.id),
    ['good1', 'good2']
  );
  const [good1, good2] = list;
  assert.equal(good1.attempts, 0);
  assert.equal(good1.createdAt, 0);
  assert.equal(good1.title.length, 1024);
  assert.deepEqual(good1.error, { code: 'x-y', message: 'm', detail: null, hint: null, action: null, retryable: false });
  assert.equal(good1.groupId, null);
  assert.equal(good1.groupTitle, null);
  assert.equal(good1.parentId, null);
  assert.equal(good1.neverStarted, false);
  assert.deepEqual(good1.progress, { percent: null, stage: null, speed: null, eta: null, detail: null });
  assert.equal(good2.kind, 'convert');
  assert.deepEqual(good2.result, { path: 'C:\\x.mp4', size: null, warnings: [], skipped: false });
  assert.equal(good2.error, null);
  assert.equal(good2.finishedAt, null);
  assert.equal(good2.startedAt, 17);
  const saved = await waitForFile(file, (data) => data.jobs.length === 2);
  assert.deepEqual(
    saved.jobs.map((job) => job.id),
    ['good1', 'good2']
  );
});

test('a failed job saved without an error gets a readable one', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('failed-no-error.json', [storedJob('f1', 'failed', { finishedAt: 2, error: null })]);
  const { queue } = make({ file });
  const [job] = queue.load();
  assert.equal(job.error.code, 'unexpected');
  assert.equal(typeof job.error.message, 'string');
  assert.ok(job.error.message.length > 0);
  assert.equal(job.error.retryable, true);
});

test('titles, names and paths with accents, emoji and other scripts survive a round trip', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('unicode.json');
  const title = 'Canción del año 🎬 — 東京 «live» ñandú';
  const first = make({ file });
  first.queue.load();
  const [a] = first.queue.add([
    { kind: 'download', title, spec: { url: 'https://example.com/ñ', output: { folder: 'C:\\Vídeos\\Año', name: title } } }
  ]);
  await flush();
  first.download.last(a).resolve({ path: `C:\\Vídeos\\Año\\${title}.mp4`, size: 3 });
  await flush();
  first.queue.dispose();
  const second = make({ file });
  const [job] = second.queue.load();
  assert.equal(job.title, title);
  assert.equal(job.spec.output.name, title);
  assert.equal(job.result.path, `C:\\Vídeos\\Año\\${title}.mp4`);
});

test('a queue file that cannot be read is never overwritten', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('locked.json');
  fs.writeFileSync(file, '{"version":1,"jobs":[');
  fs.mkdirSync(`${file}.tmp`);
  const before = fs.readFileSync(file, 'utf8');
  const { queue, download } = make({ file });
  assert.deepEqual(queue.load(), []);
  const [a] = queue.add([input('download', 'in memory')]);
  await flush();
  assert.deepEqual(download.ids(), [a]);
  download.last(a).resolve({ path: 'a' });
  await flush();
  await delay(30);
  await queue.shutdown('pause');
  queue.dispose();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('shutdown still writes the file when a changed listener throws', async (t) => {
  const { make, fileAt, limits } = setup(t);
  limits.download = 1;
  const file = fileAt('listener-throws.json');
  let armed = false;
  const download = createRunner();
  download.cleanup = () =>
    delay(10).then(() => {
      armed = true;
    });
  const { queue } = make({ file, debounceMs: 60000, runners: { convert: createRunner(), download } });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  queue.on('changed', () => {
    if (armed) throw new Error('window destroyed');
  });
  await assert.rejects(queue.shutdown('cancel'), /window destroyed/);
  assert.equal(download.last(a).reason, 'cancel');
  assert.deepEqual(
    readJson(file).jobs.map((job) => [job.id, job.state]),
    [
      [a, 'canceled'],
      [b, 'canceled']
    ]
  );
});

test('a throwing changed listener does not swallow the idle event', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  await flush();
  const idle = [];
  queue.on('idle', () => idle.push(true));
  queue.prependListener('changed', () => {
    if (queue.get(a)?.state === 'done') throw new Error('bridge failed');
  });
  const errors = [];
  const onUncaught = (error) => errors.push(error.message);
  const saved = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', onUncaught);
  t.after(() => {
    process.off('uncaughtException', onUncaught);
    for (const listener of saved) process.on('uncaughtException', listener);
  });
  download.last(a).resolve({ path: 'a' });
  await flush();
  await flush();
  assert.deepEqual(errors, ['bridge failed']);
  assert.equal(idle.length, 1);
  assert.equal(queue.counts().done, 1);
});

test('normalizeQueueFile is idempotent', () => {
  const once = normalizeQueueFile({ version: 1, jobs: [storedJob('a1', 'done'), storedJob('a2', 'queued'), { bad: true }] });
  const twice = normalizeQueueFile(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
  assert.equal(once.jobs.length, 2);
  assert.deepEqual(normalizeQueueFile(undefined), { version: 1, jobs: [] });
});

test('jobs added before load are kept after the restored ones and load runs once', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('early.json', [storedJob('old1', 'paused')]);
  const { queue } = make({ file });
  const [early] = queue.add([input('download', 'early')], { start: false });
  await flush();
  await delay(30);
  assert.deepEqual(
    readJson(file).jobs.map((job) => job.id),
    ['old1']
  );
  const list = queue.load();
  assert.deepEqual(
    list.map((job) => job.id),
    ['old1', early]
  );
  fs.writeFileSync(file, JSON.stringify({ version: 1, jobs: [storedJob('other', 'paused')] }));
  assert.deepEqual(
    queue.load().map((job) => job.id),
    ['old1', early]
  );
});

test('a queue that was never loaded never writes over the saved file', async (t) => {
  const { make, writeJobs } = setup(t);
  const file = writeJobs('unloaded.json', [storedJob('keep', 'paused')]);
  const before = fs.readFileSync(file, 'utf8');
  const { queue } = make({ file });
  queue.add([input('download')]);
  await flush();
  await queue.shutdown('cancel');
  queue.dispose();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('finished jobs are capped at 500 on load, dropping the oldest first', async (t) => {
  const { make, writeJobs } = setup(t);
  const finished = Array.from({ length: 505 }, (_, index) =>
    storedJob(`f${index}`, index % 7 === 0 ? 'canceled' : 'done', { finishedAt: 1000 + index })
  ).reverse();
  const file = writeJobs('cap.json', [storedJob('p1', 'paused'), ...finished, storedJob('q1', 'queued')]);
  const { queue } = make({ file });
  const list = queue.load();
  assert.equal(list.length, 502);
  assert.equal(list.filter((job) => ['done', 'failed', 'canceled'].includes(job.state)).length, 500);
  const ids = new Set(list.map((job) => job.id));
  for (let index = 0; index < 5; index += 1) assert.equal(ids.has(`f${index}`), false);
  assert.ok(ids.has('f5'));
  assert.ok(ids.has('f504'));
  assert.equal(list[0].id, 'p1');
  assert.equal(list[1].id, 'f504');
  assert.equal(list.at(-1).id, 'q1');
  assert.equal(list.at(-1).state, 'interrupted');
});

test('the finished cap applies during a session and cleans up dropped failed jobs', async (t) => {
  const { make } = setup(t);
  const { queue, convert } = make({ maxFinished: 2 });
  const [a, b, c, d] = queue.add([input('convert'), input('convert'), input('convert'), input('convert')]);
  const [p] = queue.add([input('convert')], { start: false });
  await flush();
  convert.last(a).resolve({ path: 'a' });
  await flush();
  convert.last(b).reject(new Error('bad'));
  await flush();
  convert.last(c).resolve({ path: 'c' });
  await flush();
  assert.deepEqual(
    queue.list().map((job) => job.id),
    [b, c, d, p]
  );
  convert.last(d).resolve({ path: 'd' });
  await flush();
  assert.deepEqual(
    queue.list().map((job) => job.id),
    [c, d, p]
  );
  assert.deepEqual(convert.cleaned, [b]);
});

test('shutdown pause: running and queued jobs become paused and the file is written at once', async (t) => {
  const { make, fileAt, limits } = setup(t);
  limits.download = 1;
  const file = fileAt('shutdown-pause.json');
  const { queue, download } = make({ file, debounceMs: 60000 });
  queue.load();
  const [a, b, c] = queue.add([input('download'), input('download'), input('download')]);
  const [d] = queue.add([input('download')], { start: false });
  await flush();
  let finished = 0;
  let idle = 0;
  queue.on('job-finished', () => {
    finished += 1;
  });
  queue.on('idle', () => {
    idle += 1;
  });
  await queue.shutdown('pause');
  assert.equal(download.last(a).reason, 'shutdown');
  assert.deepEqual(states(queue), ['paused', 'paused', 'paused', 'paused']);
  assert.equal(queue.get(d).neverStarted, true);
  assert.equal(queue.get(b).neverStarted, false);
  assert.equal(download.runs.length, 1);
  assert.equal(finished, 0);
  assert.equal(idle, 0);
  assert.deepEqual(download.cleaned, []);
  const saved = readJson(file);
  assert.deepEqual(
    saved.jobs.map((job) => [job.id, job.state]),
    [
      [a, 'paused'],
      [b, 'paused'],
      [c, 'paused'],
      [d, 'paused']
    ]
  );
  assert.throws(() => queue.add([input('download')]), /closed/);
  assert.deepEqual(queue.resume([b]), []);
  assert.deepEqual(queue.startAll(), []);
  await flush();
  assert.equal(queue.get(b).state, 'paused');
  assert.equal(download.runs.length, 1);
  queue.dispose();
  assert.ok(readJson(file).jobs.every((job) => job.state === 'paused'));
});

test('shutdown interrupt: active jobs become interrupted and resume on the next start only with autoResume', async (t) => {
  const { make, fileAt, limits } = setup(t);
  limits.download = 1;
  const file = fileAt('shutdown-interrupt.json');
  const { queue, download } = make({ file });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  const [p] = queue.add([input('download')], { start: false });
  await flush();
  await queue.shutdown('interrupt');
  assert.equal(download.last(a).reason, 'shutdown');
  assert.deepEqual(states(queue), ['interrupted', 'interrupted', 'paused']);
  const plainCopy = fileAt('interrupt-plain.json');
  const autoCopy = fileAt('interrupt-auto.json');
  fs.copyFileSync(file, plainCopy);
  fs.copyFileSync(file, autoCopy);
  const plain = make({ file: plainCopy });
  plain.queue.load();
  const auto = make({ file: autoCopy, autoResume: () => true });
  auto.queue.load();
  await flush();
  assert.deepEqual(states(plain.queue), ['interrupted', 'interrupted', 'paused']);
  assert.equal(plain.download.runs.length, 0);
  assert.deepEqual(states(auto.queue), ['running', 'queued', 'paused']);
  assert.deepEqual(auto.download.ids(), [a]);
  assert.equal(auto.queue.get(b).state, 'queued');
  assert.equal(auto.queue.get(p).neverStarted, true);
});

test('shutdown cancel: running and queued jobs are canceled, paused and interrupted ones are kept', async (t) => {
  const { make, writeJobs, limits } = setup(t);
  limits.download = 1;
  const file = writeJobs('shutdown-cancel.json', [storedJob('i1', 'interrupted')]);
  const { queue, download } = make({ file });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  const [p] = queue.add([input('download')], { start: false });
  await flush();
  await queue.shutdown('cancel');
  assert.equal(download.last(a).reason, 'cancel');
  assert.deepEqual(states(queue), ['interrupted', 'canceled', 'canceled', 'paused']);
  assert.deepEqual(download.cleaned, [b]);
  assert.equal(queue.get(p).state, 'paused');
  const saved = readJson(file);
  assert.deepEqual(
    saved.jobs.map((job) => job.state),
    ['interrupted', 'canceled', 'canceled', 'paused']
  );
});

test('an unknown shutdown mode behaves like pause', async (t) => {
  const { make } = setup(t);
  const { queue, download } = make();
  const [a] = queue.add([input('download')]);
  await flush();
  await queue.shutdown('explode');
  assert.equal(download.last(a).reason, 'shutdown');
  assert.equal(queue.get(a).state, 'paused');
});

test('shutdown is bounded when a runner ignores the abort', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner(), download: createRunner({ honorAbort: false }) };
  const { queue, download } = make({ runners, shutdownTimeoutMs: 40, abortGraceMs: 60000 });
  const [a] = queue.add([input('download')]);
  await flush();
  const startedAt = Date.now();
  await queue.shutdown('interrupt');
  assert.ok(Date.now() - startedAt < 2000);
  assert.equal(queue.get(a).state, 'interrupted');
  download.last(a).resolve({ path: 'late' });
  await flush();
  assert.equal(queue.get(a).state, 'interrupted');
});

test('shutdown waits for runners that stop in time', async (t) => {
  const { make } = setup(t);
  const runners = { convert: createRunner(), download: createRunner({ honorAbort: false }) };
  const { queue, download } = make({ runners });
  const [a] = queue.add([input('download')]);
  await flush();
  const pending = queue.shutdown('pause');
  await delay(20);
  assert.equal(queue.get(a).state, 'running');
  download.last(a).reject(abortError('shutdown'));
  await pending;
  assert.equal(queue.get(a).state, 'paused');
});

test('shutdown waits for pending cleanups', async (t) => {
  const { make, limits } = setup(t);
  limits.download = 1;
  const download = createRunner();
  let cleaned = false;
  download.cleanup = () =>
    delay(30).then(() => {
      cleaned = true;
    });
  const { queue } = make({ runners: { convert: createRunner(), download } });
  queue.add([input('download'), input('download')]);
  await flush();
  await queue.shutdown('cancel');
  assert.equal(cleaned, true);
});

test('a failing cleanup never breaks the queue', async (t) => {
  const { make } = setup(t);
  const download = createRunner();
  download.cleanup = () => {
    throw new Error('file locked');
  };
  const { queue } = make({ runners: { convert: createRunner(), download } });
  const [a] = queue.add([input('download')], { start: false });
  queue.cancel([a]);
  await flush();
  assert.equal(queue.get(a).state, 'canceled');
  await queue.shutdown('pause');
});

test('shutdown returns the same promise when called twice', async (t) => {
  const { make } = setup(t);
  const { queue } = make();
  const first = queue.shutdown('pause');
  const second = queue.shutdown('cancel');
  assert.equal(first, second);
  await first;
});

test('dispose aborts running jobs as interrupted and flushes the file', async (t) => {
  const { make, fileAt, limits } = setup(t);
  limits.download = 1;
  const file = fileAt('dispose.json');
  const { queue, download } = make({ file, debounceMs: 60000 });
  queue.load();
  const [a, b] = queue.add([input('download'), input('download')]);
  await flush();
  let changes = 0;
  queue.on('changed', () => {
    changes += 1;
  });
  queue.dispose();
  assert.equal(download.last(a).reason, 'shutdown');
  const saved = readJson(file);
  assert.deepEqual(
    saved.jobs.map((job) => [job.id, job.state]),
    [
      [a, 'interrupted'],
      [b, 'queued']
    ]
  );
  await flush();
  assert.equal(changes, 0);
  assert.equal(download.runs.length, 1);
  assert.equal(queue.listenerCount('changed'), 0);
});

test('state changes are written to disk without waiting for shutdown', async (t) => {
  const { make, fileAt } = setup(t);
  const file = fileAt('debounced.json');
  const { queue, download } = make({ file });
  queue.load();
  const [a] = queue.add([input('download', 'first')]);
  await flush();
  download.last(a).resolve({ path: 'C:\\v\\first.mp4', size: 42 });
  const saved = await waitForFile(file, (data) => data.jobs[0]?.state === 'done');
  assert.deepEqual(saved.jobs[0].result, { path: 'C:\\v\\first.mp4', size: 42, warnings: [], skipped: false });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
