const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createDownloadRunner, hasResumeData, findByName } = require('../src/main/downloader/runner');
const { OPTION_DEFAULTS } = require('../src/main/downloader/jobs');
const { abortError } = require('../src/main/processes');
const { JobError } = require('../src/main/errors');
const { fakeRun, lines, valueAfter, replaySteps } = require('./fixtures/downloader-runtime/fake-run');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const EXE = 'C:\\Users\\User\\AppData\\Local\\Vidaro\\bin\\yt-dlp.exe';
const FFMPEG_DIR = 'C:\\Program Files\\Vidaro\\resources\\bin';
const RUNTIME = { name: 'node', path: 'C:\\Program Files\\Vidaro\\Vidaro.exe', env: { ELECTRON_RUN_AS_NODE: '1' } };
const PRESET = { id: 'flowair-720p', name: 'FlowAir Ready 720p', container: 'mp4' };

let root;
let folder;
let tempDir;

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function fakeYtdlp({ ensureError = null } = {}) {
  const ytdlp = {
    ensureCalls: 0,
    invalidated: 0,
    tracked: [],
    jsRuntime: RUNTIME,
    async ensure({ signal } = {}) {
      ytdlp.ensureCalls += 1;
      if (ensureError) throw ensureError;
      if (signal?.aborted) throw abortError(signal);
      return EXE;
    },
    childEnv: () => ({ ELECTRON_RUN_AS_NODE: '1', TEMP: 'C:\\runtime', TMP: 'C:\\runtime' }),
    track(promise) {
      ytdlp.tracked.push(promise);
      promise.catch(() => undefined);
      return promise;
    },
    invalidate() {
      ytdlp.invalidated += 1;
    }
  };
  return ytdlp;
}

function makeRunner(script, options = {}) {
  const fake = fakeRun(script);
  const ytdlp = options.ytdlp ?? fakeYtdlp();
  const runner = createDownloadRunner({
    ytdlp,
    ffmpegDir: FFMPEG_DIR,
    tempDir,
    cacheDir: 'C:\\cache\\yt-dlp',
    jsRuntime: RUNTIME,
    run: fake.run,
    automaticRetries: options.automaticRetries ?? 0,
    retryDelayMs: options.retryDelayMs ?? 1
  });
  return { runner, fake, ytdlp };
}

function makeCtx() {
  const controller = new AbortController();
  const ctx = {
    controller,
    signal: controller.signal,
    updates: [],
    notes: [],
    progress: (patch) => ctx.updates.push(patch),
    note: (patch) => ctx.notes.push(patch),
    settings: () => ({})
  };
  return ctx;
}

function makeJob({ id = 'j1abc', options = {}, output = {}, after = null, info = {}, percent = null } = {}) {
  return {
    id,
    kind: 'download',
    state: 'running',
    title: output.name ?? 'Clip',
    progress: { percent, stage: null, speed: null, eta: null, detail: null },
    spec: {
      url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      info: { id: 'aqz-KE-bpKQ', title: 'Clip', channel: 'Blender', duration: 49, ...info },
      options: { ...OPTION_DEFAULTS, ...options },
      output: { folder, name: 'Clip', collision: 'rename', ...output },
      after
    }
  };
}

function jobTemp(id = 'j1abc') {
  return path.join(tempDir, 'download', id);
}

function printed(name, ext = 'mp4') {
  return `VIDARO-FILE ${JSON.stringify(path.join(folder, `${name}.${ext}`))}`;
}

function simpleSteps(name = 'Clip', { ext = 'mp4', bytes = 2048, extra = [] } = {}) {
  const file = path.join(folder, `${name}.${ext}`);
  return [
    { out: 'VIDARO-PARTS {"format":"18","protocol":"https","ext":"mp4","duration":49,"parts":[]}' },
    { out: 'VIDARO-DL {"status":"downloading","downloaded":1024,"total":4096,"speed":2048,"eta":2,"format":"18","file":"x.mp4"}' },
    ...extra,
    { out: 'VIDARO-DL {"status":"finished","downloaded":4096,"total":4096,"speed":4096,"eta":null,"format":"18","file":"x.mp4"}' },
    { out: 'VIDARO-PP {"status":"started","pp":"MoveFiles"}' },
    { effect: () => fs.writeFileSync(file, Buffer.alloc(bytes, 1)) },
    { out: printed(name, ext) }
  ];
}

function assertMonotonic(updates) {
  let last = -1;
  for (const update of updates) {
    if (update.percent === null) continue;
    assert.ok(update.percent >= last, `percent went back from ${last} to ${update.percent}`);
    last = update.percent;
  }
}

function missingDrive() {
  for (const letter of 'ZYXWVUTSRQPONMLKJIH') {
    if (!fs.existsSync(`${letter}:\\`)) return `${letter}:\\Videos`;
  }
  return null;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-dlrun-ñ🎬-'));
  folder = path.join(root, 'Videos', 'Vidaro ñ');
  tempDir = path.join(root, 'Local', 'Vidaro', 'temp');
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('a normal download', () => {
  test('replays a two part download from start to finish', async () => {
    const { runner, fake, ytdlp } = makeRunner(() => ({ steps: replaySteps(fixture('progress-two-parts.txt'), { folder }) }));
    const ctx = makeCtx();
    const result = await runner.run(makeJob(), ctx);
    const expected = path.join(folder, 'E2E： Reel ñ 🎬 100% [two parts].mp4');
    assert.deepEqual(result, { path: expected, size: 1234, warnings: [], skipped: false, followUps: [] });
    assert.equal(ytdlp.ensureCalls, 1);
    assert.equal(ytdlp.tracked.length, 1);
    const call = fake.calls[0];
    assert.equal(call.file, EXE);
    assert.equal(valueAfter(call.args, '-P', 'temp:'), jobTemp());
    assert.equal(valueAfter(call.args, '-P', 'home:'), folder);
    assert.equal(call.args[call.args.indexOf('-o') + 1], 'Clip.%(ext)s');
    assert.equal(call.args[call.args.indexOf('--ffmpeg-location') + 1], FFMPEG_DIR);
    assert.equal(call.args[call.args.indexOf('--js-runtimes') + 1], `node:${RUNTIME.path}`);
    assert.ok(!call.args.includes('--force-overwrites'));
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(call.options.signal, ctx.signal);
    assert.equal(typeof call.options.onStdoutLine, 'function');
    assert.equal(call.options.onStdoutLine, call.options.onStderrLine);
    assert.equal(fs.existsSync(jobTemp()), false);
    assert.equal(fs.existsSync(folder), true);
    assertMonotonic(ctx.updates);
    const stages = [...new Set(ctx.updates.map((update) => update.stage))];
    assert.deepEqual(stages, ['starting', 'downloading', 'merging', 'remuxing', 'embedding', 'moving', 'finished']);
    assert.equal(ctx.updates[0].percent, null);
    assert.equal(ctx.updates.at(-1).percent, 100);
    const details = new Set(ctx.updates.map((update) => update.detail));
    assert.ok(details.has('1/2') && details.has('2/2'));
    assert.ok(ctx.updates.some((update) => update.speed > 0 && update.eta !== null));
    assert.ok(ctx.updates.filter((update) => update.stage !== 'downloading').every((update) => update.speed === null && update.detail === null));
    assert.deepEqual(ctx.notes, []);
  });

  test('reports progress only when something moved', async () => {
    const same = { out: 'VIDARO-DL {"status":"downloading","downloaded":1024,"total":4096,"speed":999,"eta":2,"format":"18","file":"x.mp4"}' };
    const { runner } = makeRunner(() => ({ steps: simpleSteps('Clip', { extra: [same, same, same] }) }));
    const ctx = makeCtx();
    await runner.run(makeJob(), ctx);
    const downloading = ctx.updates.filter((update) => update.stage === 'downloading');
    assert.equal(downloading.length, 2);
  });

  test('ffmpeg section downloads report time based progress', async () => {
    const { runner } = makeRunner(() => ({ steps: replaySteps(fixture('progress-section-ffmpeg.txt'), { folder }) }));
    const ctx = makeCtx();
    const result = await runner.run(makeJob({ options: { section: { start: 10, end: 12 } } }), ctx);
    assert.equal(result.path, path.join(folder, 'default#E2E BBB section.mp4'));
    assertMonotonic(ctx.updates);
    assert.ok(ctx.updates.filter((update) => update.stage === 'downloading').length >= 2);
  });

  test('fragment downloads and audio extraction', async () => {
    const { runner } = makeRunner(() => ({ steps: replaySteps(fixture('progress-hls-fragments.txt'), { folder }) }));
    const ctx = makeCtx();
    const result = await runner.run(makeJob({ options: { mode: 'audio', audioFormat: 'm4a' } }), ctx);
    assert.equal(result.path, path.join(folder, 'E2E hls audio.m4a'));
    assert.ok(ctx.updates.some((update) => update.stage === 'converting-audio'));
    assertMonotonic(ctx.updates);
  });

  test('warnings never fail a job and are summarized', async () => {
    const steps = [{ err: fixture('warning-no-js-runtime.txt').trim() }, { err: 'WARNING: [youtube] Some formats may be missing' }, ...simpleSteps()];
    const { runner } = makeRunner(() => ({ steps }));
    const result = await runner.run(makeJob(), makeCtx());
    assert.deepEqual(result.warnings, ['no-js-runtime']);
    assert.equal(result.size, 2048);
  });
});

describe('collisions', () => {
  test('rename picks a free name and notes it', async () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Clip.mp4'), 'old');
    fs.writeFileSync(path.join(folder, 'clip (2).MKV'), 'old');
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps('Clip (3)') }));
    const ctx = makeCtx();
    const result = await runner.run(makeJob(), ctx);
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('-o') + 1], 'Clip (3).%(ext)s');
    assert.deepEqual(ctx.notes, [{ output: { name: 'Clip (3)' } }]);
    assert.equal(result.path, path.join(folder, 'Clip (3).mp4'));
    assert.equal(fs.readFileSync(path.join(folder, 'Clip.mp4'), 'utf8'), 'old');
  });

  test('audio downloads only collide with the same audio extension', async () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Clip.mp4'), 'video');
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps('Clip', { ext: 'mp3' }) }));
    const ctx = makeCtx();
    await runner.run(makeJob({ options: { mode: 'audio', audioFormat: 'mp3' } }), ctx);
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('-o') + 1], 'Clip.%(ext)s');
    assert.deepEqual(ctx.notes, []);
  });

  test('skip leaves an existing file alone without starting yt-dlp', async () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Clip.mp4'), 'existing');
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const result = await runner.run(makeJob({ output: { collision: 'skip' } }), makeCtx());
    assert.deepEqual(result, { path: path.join(folder, 'Clip.mp4'), size: 8, warnings: [], skipped: true, followUps: [] });
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.existsSync(jobTemp()), false);
    assert.equal(fs.readFileSync(path.join(folder, 'Clip.mp4'), 'utf8'), 'existing');
  });

  test('skip downloads when nothing is there', async () => {
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const result = await runner.run(makeJob({ output: { collision: 'skip', name: 'Clip' }, after: { preset: PRESET, keepOriginal: true } }), makeCtx());
    assert.equal(result.skipped, false);
    assert.equal(fake.calls.length, 1);
    assert.equal(result.followUps.length, 1);
  });

  test('overwrite forces a fresh download the first time and resumes later', async () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Clip.mp4'), 'old');
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    await runner.run(makeJob({ output: { collision: 'overwrite' } }), makeCtx());
    assert.ok(fake.calls[0].args.includes('--force-overwrites'));
    assert.equal(fs.readFileSync(path.join(folder, 'Clip.mp4')).length, 2048);

    fs.mkdirSync(jobTemp('j2'), { recursive: true });
    fs.writeFileSync(path.join(jobTemp('j2'), 'Clip.f134.mp4.part'), 'partial');
    fs.writeFileSync(path.join(jobTemp('j2'), 'Clip.webp'), 'thumb');
    await runner.run(makeJob({ id: 'j2', output: { collision: 'overwrite' } }), makeCtx());
    assert.ok(!fake.calls[1].args.includes('--force-overwrites'));
    assert.equal(fs.existsSync(jobTemp('j2')), false);
  });

  test('a resumed overwrite that finds the file already downloaded succeeds', async () => {
    fs.mkdirSync(jobTemp(), { recursive: true });
    fs.writeFileSync(path.join(jobTemp(), 'Blender.f133.mp4'), 'done part');
    const steps = replaySteps(fixture('progress-already-downloaded.txt'), { folder });
    const { runner, fake } = makeRunner(() => ({ steps }));
    const result = await runner.run(makeJob({ output: { collision: 'overwrite', name: 'Blender 5.2 – Reel ñ 🎬 100%' } }), makeCtx());
    assert.ok(!fake.calls[0].args.includes('--force-overwrites'));
    assert.equal(result.path, path.join(folder, 'Blender 5.2 – Reel ñ 🎬 100%.mp4'));
    assert.equal(result.skipped, false);
  });

  test('temp data made only of thumbnails and subtitles is not a resume', async () => {
    fs.mkdirSync(jobTemp(), { recursive: true });
    fs.writeFileSync(path.join(jobTemp(), 'Clip.en.vtt'), 'x');
    fs.writeFileSync(path.join(jobTemp(), 'Clip.jpg'), 'x');
    assert.equal(await hasResumeData(jobTemp()), false);
    fs.writeFileSync(path.join(jobTemp(), 'Clip.mp4.ytdl'), 'x');
    assert.equal(await hasResumeData(jobTemp()), true);
    assert.equal(await hasResumeData(path.join(root, 'missing')), false);
  });

  test('two running jobs never share a target', async () => {
    let releaseFirst;
    const gate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const { runner, fake } = makeRunner(async (call) => {
      const name = call.args[call.args.indexOf('-o') + 1].replace('.%(ext)s', '');
      if (fake.calls.length === 1) await gate;
      return { steps: simpleSteps(name) };
    });
    const first = runner.run(makeJob({ id: 'ja', output: { collision: 'overwrite' } }), makeCtx());
    await delay(20);
    const secondCtx = makeCtx();
    const second = await runner.run(makeJob({ id: 'jb', output: { collision: 'overwrite' } }), secondCtx);
    assert.equal(second.path, path.join(folder, 'Clip (2).mp4'));
    const skipped = await runner.run(makeJob({ id: 'jc', output: { collision: 'skip' } }), makeCtx());
    assert.equal(skipped.skipped, true);
    releaseFirst();
    assert.equal((await first).path, path.join(folder, 'Clip.mp4'));
    const third = await runner.run(makeJob({ id: 'jd', output: { collision: 'overwrite' } }), makeCtx());
    assert.equal(third.path, path.join(folder, 'Clip.mp4'));
  });

  test('a folder too deep for the name fails clearly', async () => {
    const deep = `C:\\${'d'.repeat(120)}\\${'e'.repeat(125)}`;
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const job = makeJob();
    job.spec.output.folder = deep;
    const original = fs.promises.mkdir;
    fs.promises.mkdir = async (target, options) => (target === deep ? undefined : original(target, options));
    try {
      await assert.rejects(runner.run(job, makeCtx()), (error) => error instanceof JobError && error.code === 'path-too-long' && error.retryable === false);
    } finally {
      fs.promises.mkdir = original;
    }
    assert.equal(fake.calls.length, 0);
  });

  test('long names are shortened to fit and noted', async () => {
    const long = 'n'.repeat(180);
    const { runner, fake } = makeRunner((call) => {
      const name = call.args[call.args.indexOf('-o') + 1].replace('.%(ext)s', '');
      return { steps: simpleSteps(name) };
    });
    const ctx = makeCtx();
    const result = await runner.run(makeJob({ output: { name: long } }), ctx);
    const used = fake.calls[0].args[fake.calls[0].args.indexOf('-o') + 1].replace('.%(ext)s', '');
    assert.ok(used.length < long.length);
    assert.ok(path.join(jobTemp(), `${used}.f000.webm.part`).length <= 250 + 48);
    assert.deepEqual(ctx.notes, [{ output: { name: used } }]);
    assert.equal(result.path, path.join(folder, `${used}.mp4`));
  });
});

describe('pause, cancel and resume', () => {
  test('pause keeps partial data and resume never moves the bar back', async () => {
    const text = fixture('progress-resumed.txt');
    let run = 0;
    const { runner } = makeRunner(() => {
      run += 1;
      return { steps: replaySteps(text, { folder, stopAfter: run === 1 ? 12 : null, tempDir: run === 1 ? jobTemp() : null }) };
    });
    const firstCtx = makeCtx();
    const first = runner.run(makeJob(), firstCtx);
    await delay(40);
    firstCtx.controller.abort('pause');
    await assert.rejects(first, { name: 'AbortError' });
    assert.ok(fs.existsSync(path.join(jobTemp(), 'clip.f134.mp4.part')));
    const reached = Math.max(...firstCtx.updates.map((update) => update.percent ?? 0));
    assert.ok(reached > 50, `reached ${reached}`);

    const secondCtx = makeCtx();
    const result = await runner.run(makeJob(), secondCtx);
    assert.equal(result.path, path.join(folder, 'Resume test.mp4'));
    assert.equal(secondCtx.updates[0].percent, reached);
    assertMonotonic(secondCtx.updates);
    assert.equal(fs.existsSync(jobTemp()), false);

    const thirdCtx = makeCtx();
    await runner.run(makeJob(), thirdCtx);
    assert.equal(thirdCtx.updates[0].percent, null);
  });

  test('the stored job percent is respected too', async () => {
    const { runner } = makeRunner(() => ({ steps: simpleSteps() }));
    const ctx = makeCtx();
    await runner.run(makeJob({ percent: 42 }), ctx);
    assert.equal(ctx.updates[0].percent, 42);
    assert.ok(ctx.updates.every((update) => update.percent >= 42));
  });

  test('shutdown and stall keep partial data', async () => {
    for (const reason of ['shutdown', 'stall']) {
      const { runner } = makeRunner(() => ({ steps: replaySteps(fixture('progress-resumed.txt'), { folder, stopAfter: 5, tempDir: jobTemp() }) }));
      const ctx = makeCtx();
      const pending = runner.run(makeJob(), ctx);
      await delay(30);
      ctx.controller.abort(reason);
      await assert.rejects(pending, { name: 'AbortError' });
      assert.ok(fs.existsSync(path.join(jobTemp(), 'clip.f134.mp4.part')), reason);
    }
  });

  test('cancel removes the job temp folder', async () => {
    const { runner } = makeRunner(() => ({ steps: replaySteps(fixture('progress-resumed.txt'), { folder, stopAfter: 5, tempDir: jobTemp() }) }));
    const ctx = makeCtx();
    const pending = runner.run(makeJob(), ctx);
    await delay(30);
    ctx.controller.abort('cancel');
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(fs.existsSync(jobTemp()), false);
  });

  test('stopping while the file is being moved removes the half copied file', async () => {
    const target = path.join(folder, 'Clip.mp4');
    const steps = [
      ...simpleSteps().slice(0, 4),
      { effect: () => fs.writeFileSync(target, 'half') },
      { hang: true }
    ];
    for (const reason of ['pause', 'cancel']) {
      const { runner } = makeRunner(() => ({ steps }));
      const ctx = makeCtx();
      const pending = runner.run(makeJob(), ctx);
      await delay(30);
      assert.ok(fs.existsSync(target), reason);
      ctx.controller.abort(reason);
      await assert.rejects(pending, { name: 'AbortError' });
      assert.equal(fs.existsSync(target), false, reason);
    }
  });

  test('an abort before yt-dlp starts is handled', async () => {
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const ctx = makeCtx();
    ctx.controller.abort('cancel');
    await assert.rejects(runner.run(makeJob(), ctx), { name: 'AbortError' });
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.existsSync(jobTemp()), false);
  });

  test('cleanup removes only that job temp folder', async () => {
    fs.mkdirSync(jobTemp('j1abc'), { recursive: true });
    fs.mkdirSync(jobTemp('j2'), { recursive: true });
    fs.writeFileSync(path.join(jobTemp('j1abc'), 'x.part'), 'x');
    const { runner } = makeRunner(() => ({}));
    await runner.cleanup({ id: 'j1abc', kind: 'download', spec: {} });
    await runner.cleanup({ id: '..', kind: 'download', spec: {} });
    await runner.cleanup(null);
    assert.equal(fs.existsSync(jobTemp('j1abc')), false);
    assert.equal(fs.existsSync(jobTemp('j2')), true);
  });
});

describe('failures', () => {
  test('maps yt-dlp errors and keeps partial data for retry', async () => {
    const cases = [
      ['progress-access-denied.txt', 'access-denied', null],
      ['error-age-restricted.txt', 'age-restricted', 'cookies'],
      ['error-format-unavailable.txt', 'format-unavailable', null],
      ['error-dns.txt', 'network', null]
    ];
    for (const [name, code, action] of cases) {
      const { runner } = makeRunner(() => ({ code: 1, steps: replaySteps(fixture(name), { folder, tempDir: jobTemp() }) }));
      await assert.rejects(runner.run(makeJob(), makeCtx()), (error) => {
        assert.ok(error instanceof JobError, name);
        assert.equal(error.code, code, name);
        assert.equal(error.action, action, name);
        assert.ok(error.detail, name);
        return true;
      });
      assert.ok(fs.existsSync(path.join(jobTemp(), 'clip.f134.mp4.part')), name);
    }
  });

  test('HTTP 403 suggests updating yt-dlp', async () => {
    const { runner } = makeRunner(() => ({ code: 1, steps: [{ err: 'ERROR: unable to download video data: HTTP Error 403: Forbidden' }] }));
    await assert.rejects(runner.run(makeJob(), makeCtx()), { code: 'http-403', action: 'update-ytdlp' });
  });

  test('a momentary YouTube 403 from ffmpeg is retried once automatically', async () => {
    let calls = 0;
    const { runner, fake } = makeRunner(
      () => {
        calls += 1;
        return calls === 1 ? { code: 1, steps: [{ err: 'ERROR: ffmpeg exited with code 3436169992' }] } : { steps: simpleSteps() };
      },
      { automaticRetries: 1 }
    );
    const result = await runner.run(makeJob(), makeCtx());
    assert.equal(result.path, path.join(folder, 'Clip.mp4'));
    assert.equal(fake.calls.length, 2);
  });

  test('a 403 that keeps happening fails after the automatic retry', async () => {
    const { runner, fake } = makeRunner(() => ({ code: 1, steps: [{ err: 'ERROR: ffmpeg exited with code 3436169992' }] }), { automaticRetries: 1 });
    await assert.rejects(runner.run(makeJob(), makeCtx()), { code: 'http-403', action: 'update-ytdlp' });
    assert.equal(fake.calls.length, 2);
  });

  test('errors that are not transient are never retried automatically', async () => {
    const { runner, fake } = makeRunner(() => ({ code: 1, steps: replaySteps(fixture('error-age-restricted.txt'), { folder }) }), { automaticRetries: 1 });
    await assert.rejects(runner.run(makeJob(), makeCtx()), { code: 'age-restricted' });
    assert.equal(fake.calls.length, 1);
  });

  test('pausing while waiting to retry stops right away', async () => {
    const { runner, fake } = makeRunner(() => ({ code: 1, steps: [{ err: 'ERROR: ffmpeg exited with code 3436169992' }] }), {
      automaticRetries: 1,
      retryDelayMs: 60000
    });
    const ctx = makeCtx();
    const pending = runner.run(makeJob(), ctx);
    setTimeout(() => ctx.controller.abort('pause'), 50);
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(fake.calls.length, 1);
  });

  test('a SponsorBlock outage still delivers the file', async () => {
    const { runner } = makeRunner(() => ({ code: 1, steps: replaySteps(fixture('progress-sponsorblock-down.txt'), { folder }) }));
    const ctx = makeCtx();
    const result = await runner.run(makeJob({ options: { sponsorBlock: true } }), ctx);
    assert.equal(result.path, path.join(folder, 'E2E SponsorBlock down.mp4'));
    assert.deepEqual(result.warnings, ['sponsorblock-failed']);
    assert.equal(fs.existsSync(jobTemp()), false);
  });

  test('a SponsorBlock outage without a file is a failure', async () => {
    const steps = replaySteps(fixture('progress-sponsorblock-down.txt'), { folder }).filter((step) => !step.effect);
    const { runner } = makeRunner(() => ({ code: 1, steps }));
    await assert.rejects(runner.run(makeJob({ options: { sponsorBlock: true } }), makeCtx()), { code: 'sponsorblock-failed' });
  });

  test('finds the file by name when the printed path is missing', async () => {
    fs.mkdirSync(folder, { recursive: true });
    const steps = simpleSteps().filter((step) => !step.effect);
    steps.push({ effect: () => fs.writeFileSync(path.join(folder, 'Clip.mkv'), 'mkv file') });
    steps.push({ effect: () => fs.writeFileSync(path.join(folder, 'Clip.en.srt'), 'subs') });
    steps.push({ effect: () => fs.writeFileSync(path.join(folder, 'Clip.jpg'), 'cover') });
    const { runner } = makeRunner(() => ({ steps }));
    const result = await runner.run(makeJob(), makeCtx());
    assert.equal(result.path, path.join(folder, 'Clip.mkv'));
    assert.equal(result.size, 8);
  });

  test('fails when no file can be found', async () => {
    const steps = simpleSteps().filter((step) => !step.effect);
    const { runner } = makeRunner(() => ({ steps }));
    await assert.rejects(runner.run(makeJob(), makeCtx()), { code: 'output-missing', retryable: true });
  });

  test('findByName prefers the expected extension and ignores side files', async () => {
    fs.mkdirSync(folder, { recursive: true });
    for (const name of ['Clip.mkv', 'Clip.mp4', 'Clip.en.vtt', 'Clip.mp4.part', 'clip.webp', 'Clip 2.mp4']) fs.writeFileSync(path.join(folder, name), name);
    assert.equal((await findByName(folder, 'CLIP', ['mp4', 'mkv'])).path, path.join(folder, 'Clip.mp4'));
    assert.equal(await findByName(folder, 'Other', ['mp4']), null);
    assert.equal(await findByName(path.join(root, 'missing'), 'Clip', ['mp4']), null);
  });

  test('a yt-dlp that cannot start is reported and checked again', async () => {
    const { runner, ytdlp } = makeRunner(() => ({ spawnFailed: true }));
    await assert.rejects(runner.run(makeJob(), makeCtx()), { name: 'ProcessError', spawnFailed: true });
    assert.equal(ytdlp.invalidated, 1);
  });

  test('a missing yt-dlp is a tool error', async () => {
    const { runner, fake } = makeRunner(() => ({}), { ytdlp: fakeYtdlp({ ensureError: new Error('yt-dlp is missing') }) });
    await assert.rejects(runner.run(makeJob(), makeCtx()), { code: 'tool-missing', detail: 'yt-dlp is missing' });
    assert.equal(fake.calls.length, 0);
  });

  test('an unavailable output drive is explained', async (t) => {
    const drive = missingDrive();
    if (!drive) {
      t.skip('every drive letter is in use');
      return;
    }
    const { runner } = makeRunner(() => ({ steps: simpleSteps() }));
    const job = makeJob();
    job.spec.output.folder = drive;
    await assert.rejects(runner.run(job, makeCtx()), { code: 'output-folder-missing', retryable: true });
  });

  test('a missing cookies file is explained before starting', async () => {
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const job = makeJob({ options: { cookiesMode: 'file', cookiesFile: path.join(root, 'cookies.txt') } });
    await assert.rejects(runner.run(job, makeCtx()), { code: 'cookies-missing', action: 'cookies', retryable: false });
    assert.equal(fake.calls.length, 0);
    fs.writeFileSync(path.join(root, 'cookies.txt'), '# Netscape HTTP Cookie File\n');
    await runner.run(job, makeCtx());
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('--cookies') + 1], path.join(root, 'cookies.txt'));
  });

  test('invalid specs are not retried', async () => {
    const { runner, fake } = makeRunner(() => ({ steps: simpleSteps() }));
    const bad = [
      makeJob({ options: { mode: 'both' } }),
      makeJob({ options: { rateLimit: 'fast' } }),
      makeJob({ output: { folder: 'Videos' } }),
      makeJob({ output: { name: '' } }),
      { ...makeJob(), id: '../evil' },
      { ...makeJob(), spec: null }
    ];
    const badUrl = makeJob();
    badUrl.spec.url = 'file:///C:/Windows/win.ini';
    bad.push(badUrl);
    for (const job of bad) {
      await assert.rejects(runner.run(job, makeCtx()), (error) => error.code === 'invalid-options' && error.retryable === false);
    }
    assert.equal(fake.calls.length, 0);
  });
});

describe('download then convert', () => {
  test('returns one conversion job for the downloaded file', async () => {
    const { runner } = makeRunner(() => ({ steps: replaySteps(fixture('progress-sponsorblock-down.txt'), { folder }).filter((step) => !/^ERROR/.test(step.err ?? '')) }));
    const job = makeJob({ after: { preset: PRESET, keepOriginal: false } });
    job.title = 'My clip';
    const result = await runner.run(job, makeCtx());
    const file = path.join(folder, 'E2E SponsorBlock down.mp4');
    const stat = fs.statSync(file);
    assert.deepEqual(result.followUps, [
      {
        kind: 'convert',
        title: 'E2E SponsorBlock down.mp4',
        spec: {
          input: { path: file, size: stat.size, mtimeMs: stat.mtimeMs, duration: 49, media: null },
          preset: PRESET,
          output: { folder, name: 'E2E SponsorBlock down', baseName: 'E2E SponsorBlock down', collision: 'rename', keepDate: false },
          trim: null,
          deleteInputAfter: true
        }
      }
    ]);
  });

  test('keeps the original when asked and uses the section length', async () => {
    const { runner } = makeRunner(() => ({ steps: simpleSteps().filter((step) => !String(step.out ?? '').startsWith('VIDARO-PARTS')) }));
    const job = makeJob({ after: { preset: PRESET, keepOriginal: true }, options: { section: { start: 5, end: 20 } } });
    const [followUp] = (await runner.run(job, makeCtx())).followUps;
    assert.equal(followUp.spec.deleteInputAfter, false);
    assert.equal(followUp.spec.input.duration, 15);
  });

  test('no conversion without a preset', async () => {
    const { runner } = makeRunner(() => ({ steps: simpleSteps() }));
    assert.deepEqual((await runner.run(makeJob({ after: { keepOriginal: true } }), makeCtx())).followUps, []);
  });
});

describe('fixture sanity', () => {
  test('every progress fixture replays without errors in the parser', async () => {
    for (const name of fs.readdirSync(FIXTURES).filter((file) => file.startsWith('progress-'))) {
      const text = fixture(name);
      const hasFile = lines(text).some((line) => line.startsWith('VIDARO-FILE '));
      const { runner } = makeRunner(() => ({ code: hasFile ? 0 : 1, steps: replaySteps(text, { folder }) }));
      const ctx = makeCtx();
      const outcome = await runner.run(makeJob({ id: `j${name.length}` }), ctx).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      if (hasFile) assert.ok(outcome.value?.path, name);
      else assert.ok(outcome.error instanceof JobError, name);
      assertMonotonic(ctx.updates);
    }
  });
});
