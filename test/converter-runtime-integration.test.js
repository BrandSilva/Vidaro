const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const processes = require('../src/main/processes');
const { BUILT_IN } = require('../src/main/presets');
const { probeMedia, createLru, createAnalyzer } = require('../src/main/converter/probe');
const { createConvertRunner } = require('../src/main/converter/runner');
const { buildConvertJobs } = require('../src/main/converter/jobs');
const { createEncoderProbe } = require('../src/main/converter/encoder-probe');
const { thumbnailDataUrl } = require('../src/main/converter/thumbnail');
const { loudnessScanArgs, parseLoudnorm } = require('../src/main/converter/plan');

const BIN = path.join(__dirname, '..', 'bin');
const FFMPEG = path.join(BIN, 'ffmpeg.exe');
const FFPROBE = path.join(BIN, 'ffprobe.exe');
const available = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);
const TONE = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'];

let root = null;
let sources = null;
let outDir = null;
let tempDir = null;
let sequence = 0;

function preset(id, patch = {}) {
  const base = structuredClone(BUILT_IN.find((item) => item.id === id));
  return {
    ...base,
    ...patch,
    video: { ...base.video, speed: 'fast', ...(patch.video || {}) },
    picture: { ...base.picture, ...(patch.picture || {}) },
    audio: { ...base.audio, ...(patch.audio || {}) }
  };
}

async function generate(name, args) {
  const file = path.join(sources, name);
  const handle = processes.run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args, `file:${file}`]);
  const result = await handle.result;
  assert.equal(result.code, 0, result.stderr);
  return file;
}

async function probe(file) {
  return probeMedia(file, { ffprobe: FFPROBE });
}

async function makeJob(file, jobPreset, output = {}, extra = {}) {
  const media = await probe(file);
  const { inputs, errors } = buildConvertJobs({
    files: [{ path: file, media, trim: extra.trim ?? null }],
    preset: jobPreset,
    output: { mode: 'folder', folder: outDir, collision: 'rename', ...output },
    deleteInputAfter: extra.deleteInputAfter === true
  });
  assert.deepEqual(errors, []);
  sequence += 1;
  return { id: `jtest${sequence}`, kind: 'convert', state: 'running', title: inputs[0].title, spec: inputs[0].spec };
}

function fakeContext({ settings = { convert: { hardware: 'software' } }, onProgress = null } = {}) {
  const controller = new AbortController();
  const progress = [];
  const notes = [];
  return {
    controller,
    progress,
    notes,
    ctx: {
      signal: controller.signal,
      progress: (patch) => {
        progress.push(patch);
        if (onProgress) onProgress(patch, controller);
      },
      note: (patch) => notes.push(patch),
      settings: () => settings
    }
  };
}

function createRunner(options = {}) {
  return createConvertRunner({ ffmpeg: FFMPEG, ffprobe: FFPROBE, tempDir, getSettings: () => ({ convert: { hardware: 'software' } }), ...options });
}

function jobTemp(job) {
  return path.join(tempDir, 'convert', job.id);
}

function listOut() {
  return fs.readdirSync(outDir).sort();
}

function assertDuration(media, expected) {
  assert.ok(Math.abs(media.duration - expected) <= 0.15, `duration ${media.duration} vs ${expected}`);
}

function stages(progress) {
  return [...new Set(progress.map((item) => item.stage).filter(Boolean))];
}

describe('convert runner with the bundled ffmpeg', { skip: !available && 'bin/ffmpeg.exe is not present', timeout: 150000 }, () => {
  const files = {};

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-runner [ñ] 🎬 '));
    sources = path.join(root, 'fuentes ñ');
    outDir = path.join(root, 'salida 🎬');
    tempDir = path.join(root, 'temp ç');
    fs.mkdirSync(sources);
    files.dv = await generate('noticias ñ.dv', ['-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=60000/1001', ...TONE, '-t', '2', '-vf', 'tinterlace=mode=interleave_bottom,setfield=bff', '-target', 'ntsc-dv', '-ac', '2']);
    files.xvid = await generate('viejo xvid.avi', ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30000/1001,gblur=sigma=1', ...TONE, '-t', '2', '-c:v', 'mpeg4', '-vtag', 'XVID', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'avi']);
    files.hd = await generate('hd clip.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', ...TONE, '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mp4']);
    files.long = await generate('largo.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', ...TONE, '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mp4']);
    files.quiet = await generate('quiet.wav', ['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=6', '-af', 'volume=-35dB', '-c:a', 'pcm_s16le', '-f', 'wav']);
    files.cover = await generate('cover.mp3', ['-f', 'lavfi', '-i', 'sine=duration=1', '-f', 'lavfi', '-i', 'color=c=red:size=300x300', '-frames:v', '1', '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-f', 'mp3']);
  });

  after(async () => {
    if (!root) return;
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    assert.equal(fs.existsSync(root), false);
    assert.equal(processes.liveCount(), 0);
  });

  test('converts, verifies and renames an interlaced DV file', async () => {
    const runner = createRunner();
    const job = await makeJob(files.dv, preset('flowair-720p'));
    const { ctx, progress, notes } = fakeContext();
    const result = await runner.run(job, ctx);
    assert.equal(result.path, path.join(outDir, 'noticias ñ.mp4'));
    assert.equal(result.skipped, false);
    assert.deepEqual(result.followUps, []);
    assert.equal(result.size, fs.statSync(result.path).size);
    assert.deepEqual(notes, [{ output: { name: 'noticias ñ' } }]);
    assert.deepEqual(stages(progress), ['preparing', 'analyzing', 'encoding', 'verifying', 'finishing']);
    const percents = progress.map((item) => item.percent).filter((value) => typeof value === 'number');
    assert.deepEqual(percents, [...percents].sort((a, b) => a - b));
    assert.equal(percents[percents.length - 1], 100);
    assert.ok(progress.some((item) => item.stage === 'encoding' && item.detail === 'Software (x264)'));
    assert.ok(progress.some((item) => item.stage === 'encoding' && item.speed > 0));
    const output = await probe(result.path);
    assert.equal(output.video.width, 1280);
    assert.equal(output.video.height, 720);
    assert.equal(output.video.fieldOrder, 'progressive');
    assert.equal(output.audio[0].codec, 'aac');
    assertDuration(output, (await probe(files.dv)).duration);
    assert.deepEqual(listOut(), ['noticias ñ.mp4']);
    assert.equal(fs.existsSync(jobTemp(job)), false);
  });

  test('a second conversion to the same name is renamed, skip keeps the file, overwrite replaces it', async () => {
    const runner = createRunner();
    const renamed = await runner.run(await makeJob(files.dv, preset('flowair-720p')), fakeContext().ctx);
    assert.equal(path.basename(renamed.path), 'noticias ñ (2).mp4');
    const before = fs.statSync(path.join(outDir, 'noticias ñ.mp4'));
    const skipJob = await makeJob(files.dv, preset('flowair-720p'), { collision: 'skip' });
    const skipped = fakeContext();
    const skip = await runner.run(skipJob, skipped.ctx);
    assert.equal(skip.skipped, true);
    assert.equal(skip.path, path.join(outDir, 'noticias ñ.mp4'));
    assert.ok(skip.warnings.includes('skipped-existing'));
    assert.equal(stages(skipped.progress).includes('encoding'), false);
    fs.writeFileSync(path.join(outDir, 'noticias ñ.mp4'), 'old');
    const overwrite = await runner.run(await makeJob(files.dv, preset('flowair-720p'), { collision: 'overwrite' }), fakeContext().ctx);
    assert.equal(overwrite.path, path.join(outDir, 'noticias ñ.mp4'));
    assert.ok(fs.statSync(overwrite.path).size > 1000);
    assert.ok(before.size > 1000);
    assert.deepEqual(listOut(), ['noticias ñ (2).mp4', 'noticias ñ.mp4']);
    for (const name of listOut()) fs.unlinkSync(path.join(outDir, name));
  });

  test('two jobs running at once never pick the same output name', async () => {
    const runner = createRunner();
    const [a, b] = await Promise.all([makeJob(files.hd, preset('mp4-universal')), makeJob(files.hd, preset('mp4-universal'))]);
    const results = await Promise.all([runner.run(a, fakeContext().ctx), runner.run(b, fakeContext().ctx)]);
    assert.deepEqual(results.map((item) => path.basename(item.path)).sort(), ['hd clip (2).mp4', 'hd clip.mp4']);
    assert.deepEqual(runner.activeOutputs(), []);
    for (const name of listOut()) fs.unlinkSync(path.join(outDir, name));
  });

  test('canceling mid-encode stops ffmpeg and deletes the partial file', async () => {
    const runner = createRunner();
    const job = await makeJob(files.long, preset('flowair-1080p', { video: { speed: 'quality' } }));
    let sawPartial = false;
    const { ctx } = fakeContext({
      onProgress: (patch, controller) => {
        if (patch.stage === 'encoding' && patch.percent > 1 && !controller.signal.aborted) {
          sawPartial = fs.existsSync(path.join(outDir, 'largo.mp4.partial'));
          controller.abort('cancel');
        }
      }
    });
    await assert.rejects(runner.run(job, ctx), (error) => error.name === 'AbortError' && error.reason === 'cancel');
    assert.equal(sawPartial, true);
    assert.deepEqual(listOut(), []);
    assert.equal(fs.existsSync(jobTemp(job)), false);
    assert.equal(processes.liveCount(), 0);
  });

  test('pausing a two-pass encode deletes the partial and the pass logs', async () => {
    const runner = createRunner();
    const job = await makeJob(files.long, preset('mp4-universal', { video: { rateControl: 'bitrate', bitrate: 1500, twoPass: true } }));
    let logs = [];
    const { ctx, progress } = fakeContext({
      onProgress: (patch, controller) => {
        if (patch.stage === 'encoding' && patch.percent > 45 && !controller.signal.aborted) {
          logs = fs.existsSync(jobTemp(job)) ? fs.readdirSync(jobTemp(job)) : [];
          controller.abort('pause');
        }
      }
    });
    await assert.rejects(runner.run(job, ctx), (error) => error.name === 'AbortError' && error.reason === 'pause');
    assert.ok(stages(progress).includes('encoding-pass-1'));
    assert.ok(logs.includes('pass-0.log'), logs.join(','));
    assert.deepEqual(listOut(), []);
    assert.equal(fs.existsSync(jobTemp(job)), false);
  });

  test('a finished two-pass encode leaves nothing behind', async () => {
    const runner = createRunner();
    const job = await makeJob(files.hd, preset('mp4-universal', { video: { rateControl: 'bitrate', bitrate: 1200, twoPass: true } }));
    const { ctx, progress } = fakeContext();
    const result = await runner.run(job, ctx);
    assert.deepEqual(stages(progress), ['preparing', 'encoding-pass-1', 'encoding', 'verifying', 'finishing']);
    assertDuration(await probe(result.path), 2);
    assert.equal(fs.existsSync(jobTemp(job)), false);
    fs.unlinkSync(result.path);
  });

  test('a missing source fails with a plain input error', async () => {
    const runner = createRunner();
    const copy = path.join(sources, 'se borrará.mp4');
    fs.copyFileSync(files.hd, copy);
    const job = await makeJob(copy, preset('mp4-universal'));
    fs.unlinkSync(copy);
    await assert.rejects(runner.run(job, fakeContext().ctx), (error) => error.name === 'JobError' && error.code === 'input-missing' && error.retryable === true);
    assert.deepEqual(listOut(), []);
  });

  test('a source that changed since it was added is probed again', async () => {
    const runner = createRunner();
    const changing = path.join(sources, 'cambia.mp4');
    fs.copyFileSync(files.hd, changing);
    const job = await makeJob(changing, preset('mp3-320'));
    fs.copyFileSync(files.dv, changing);
    const result = await runner.run(job, fakeContext().ctx);
    assertDuration(await probe(result.path), (await probe(files.dv)).duration);
    fs.unlinkSync(result.path);
    fs.unlinkSync(changing);
  });

  test('a forced hardware encoder that is not available falls back to x264', async () => {
    const encoderProbe = createEncoderProbe({ ffmpeg: FFMPEG });
    const runner = createRunner({ encoderProbe });
    const job = await makeJob(files.hd, preset('mp4-universal', { video: { encoder: 'h264_nvenc' } }));
    const { ctx, progress } = fakeContext({ settings: { convert: { hardware: 'software' } } });
    const nvenc = await processes.run(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-t', '0.2', '-c:v', 'h264_nvenc', '-f', 'null', 'NUL']).result;
    const result = await runner.run(job, ctx);
    if (nvenc.code !== 0) {
      assert.ok(result.warnings.includes('encoder-unavailable'), result.warnings.join(','));
      assert.ok(progress.some((item) => item.detail === 'Software (x264)'));
    }
    assert.equal(encoderProbe.get().status, 'ready');
    fs.unlinkSync(result.path);
    encoderProbe.dispose();
  });

  test('a hardware encoder that fails at run time is marked broken and x264 finishes the job', async () => {
    const broken = [];
    const fakeProbe = {
      get: () => ({ status: 'ready', available: { h264: ['h264_nvenc', 'libx264'] }, tenBit: [], broken }),
      usable: () => ({ h264: ['h264_nvenc', 'libx264'].filter((name) => !broken.includes(name)), hevc: [], av1: [], vp9: [] }),
      detect: async () => fakeProbe.get(),
      on: () => () => {},
      markBroken: (name) => broken.push(name)
    };
    const nvenc = await processes.run(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-t', '0.2', '-c:v', 'h264_nvenc', '-f', 'null', 'NUL']).result;
    if (nvenc.code === 0) return;
    const runner = createRunner({ encoderProbe: fakeProbe });
    const job = await makeJob(files.hd, preset('mp4-universal'));
    const { ctx, progress } = fakeContext({ settings: { convert: { hardware: 'auto' } } });
    const result = await runner.run(job, ctx);
    assert.ok(result.warnings.includes('hardware-fallback'));
    assert.deepEqual(broken, ['h264_nvenc']);
    assert.ok(progress.some((item) => item.detail === 'NVIDIA NVENC'));
    assert.ok(progress.some((item) => item.detail === 'Software (x264)'));
    const output = await probe(result.path);
    assert.equal(output.video.codec, 'h264');
    assert.deepEqual(listOut(), ['hd clip.mp4']);
    fs.unlinkSync(result.path);
  });

  test('loudness normalization measures first and reaches EBU R128', async () => {
    const runner = createRunner();
    const loud = preset('mp3-320', { audio: { loudness: 'ebu' } });
    const job = await makeJob(files.quiet, loud);
    const { ctx, progress } = fakeContext();
    const result = await runner.run(job, ctx);
    assert.deepEqual(stages(progress), ['preparing', 'measuring-loudness', 'encoding', 'verifying', 'finishing']);
    const output = await probe(result.path);
    const lines = [];
    await processes.run(FFMPEG, loudnessScanArgs({ media: output, preset: loud, streamIndex: output.audio[0].index }), { onStderrLine: (line) => lines.push(line) }).result;
    const measured = parseLoudnorm(lines);
    assert.ok(Math.abs(measured.inputI + 23) <= 1.5, `integrated loudness ${measured.inputI}`);
    fs.unlinkSync(result.path);
  });

  test('a trimmed conversion lasts exactly the selected range and keeps the source date', async () => {
    const runner = createRunner();
    const past = new Date(2001, 0, 2, 3, 4, 5);
    fs.utimesSync(files.hd, past, past);
    const job = await makeJob(files.hd, preset('mp4-universal'), { keepDate: true }, { trim: { start: 0.5, end: 1.5 } });
    const result = await runner.run(job, fakeContext().ctx);
    assertDuration(await probe(result.path), 1);
    assert.equal(Math.round(fs.statSync(result.path).mtimeMs / 1000), Math.round(past.getTime() / 1000));
    fs.unlinkSync(result.path);
  });

  test('an old Xvid AVI is analyzed automatically and the result is cached', async () => {
    const analyzer = createAnalyzer({ ffmpeg: FFMPEG });
    const cache = createLru(10);
    const runner = createRunner({ analyzer, probe: (file, options) => probeMedia(file, { ffprobe: FFPROBE, cache, ...options }) });
    const media = await probe(files.xvid);
    assert.ok(media.warnings.includes('field-order-unknown'));
    const first = fakeContext();
    const result = await runner.run(await makeJob(files.xvid, preset('flowair-720p')), first.ctx);
    assert.ok(stages(first.progress).includes('analyzing'));
    const cached = analyzer.cached(files.xvid, media);
    assert.equal(cached.verdict, 'progressive');
    assert.equal(cached.telecine, false);
    assert.ok(cached.frames >= 50);
    const output = await probe(result.path);
    assert.equal(output.video.fieldOrder, 'progressive');
    fs.unlinkSync(result.path);
  });

  test('delete-after removes the source only after a verified success', async () => {
    const runner = createRunner();
    const copy = path.join(sources, 'descarga ñ.mp4');
    fs.copyFileSync(files.hd, copy);
    const job = await makeJob(copy, preset('mp3-320'), {}, { deleteInputAfter: true });
    const result = await runner.run(job, fakeContext().ctx);
    assert.equal(fs.existsSync(copy), false);
    assert.equal(fs.existsSync(result.path), true);
    fs.unlinkSync(result.path);
  });

  test('delete-after with the same name replaces the source in place instead of adding (2)', async () => {
    const runner = createRunner();
    const folder = path.join(root, 'en sitio ñ');
    fs.mkdirSync(folder);
    const copy = path.join(folder, 'bajado 🎬.mp4');
    fs.copyFileSync(files.hd, copy);
    const job = await makeJob(copy, preset('mp4-universal', { picture: { resolution: '480p', fit: 'fit' } }), { folder }, { deleteInputAfter: true });
    const result = await runner.run(job, fakeContext().ctx);
    assert.equal(result.path, copy);
    assert.deepEqual(fs.readdirSync(folder), ['bajado 🎬.mp4']);
    const output = await probe(copy);
    assert.equal(output.video.height, 480);
    assertDuration(output, 2);
  });

  test('cleanup removes the partial and temp data of a stopped job, but never another job’s partial', async () => {
    const runner = createRunner();
    const job = await makeJob(files.hd, preset('mp4-universal'));
    const partial = path.join(outDir, 'hd clip.mp4.partial');
    fs.writeFileSync(partial, 'x');
    fs.mkdirSync(jobTemp(job), { recursive: true });
    fs.writeFileSync(path.join(jobTemp(job), 'pass-0.log'), 'x');
    await runner.cleanup(job);
    assert.equal(fs.existsSync(partial), false);
    assert.equal(fs.existsSync(jobTemp(job)), false);
    await runner.cleanup({ id: '..\\..', spec: {} });
    await runner.cleanup({ id: 'jx', spec: { output: { folder: outDir, name: '..\\escape' }, preset: preset('mp4-universal') } });
    await runner.cleanup(null);

    const other = await makeJob(files.long, preset('flowair-1080p', { video: { speed: 'quality' } }));
    const { ctx, controller } = fakeContext();
    const stale = { ...job, id: 'jstale', spec: { ...job.spec, output: { ...job.spec.output, name: 'largo' } } };
    const running = runner.run(other, ctx);
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (!fs.existsSync(path.join(outDir, 'largo.mp4.partial'))) return;
        clearInterval(timer);
        resolve();
      }, 20);
    });
    await runner.cleanup(stale);
    assert.equal(fs.existsSync(path.join(outDir, 'largo.mp4.partial')), true);
    await runner.cleanup(other);
    assert.equal(fs.existsSync(path.join(outDir, 'largo.mp4.partial')), true);
    controller.abort('cancel');
    await assert.rejects(running, (error) => error.name === 'AbortError');
    assert.deepEqual(listOut(), []);
  });

  test('a damaged source fails with an unreadable input error', async () => {
    const runner = createRunner();
    const good = await makeJob(files.hd, preset('mp4-universal'));
    const damaged = path.join(sources, 'dañado.mp4');
    fs.writeFileSync(damaged, fs.readFileSync(files.hd).subarray(0, 4000));
    const stat = fs.statSync(damaged);
    const job = { ...good, id: 'jdamaged', spec: { ...good.spec, input: { ...good.spec.input, path: damaged, size: stat.size - 1 } } };
    await assert.rejects(runner.run(job, fakeContext().ctx), (error) => error.name === 'JobError' && error.code === 'input-unreadable');
    assert.deepEqual(listOut(), []);
  });

  test('an output folder on a missing drive is reported plainly', async () => {
    const runner = createRunner();
    const job = await makeJob(files.hd, preset('mp4-universal'));
    const letters = 'QRSTUVWXYZ'.split('').filter((letter) => !fs.existsSync(`${letter}:\\`));
    if (!letters.length) return;
    job.spec.output.folder = `${letters[0]}:\\Vidaro`;
    await assert.rejects(runner.run(job, fakeContext().ctx), (error) => error.name === 'JobError' && error.code === 'output-folder-missing');
  });

  test('thumbnails come from the video or the cover art', async () => {
    const thumbs = path.join(root, 'thumbs');
    const cache = createLru(10);
    const video = await thumbnailDataUrl(files.dv, await probe(files.dv), { ffmpeg: FFMPEG, tempDir: thumbs, cache });
    assert.match(video, /^data:image\/jpeg;base64,/);
    assert.ok(video.length < 40000, `${video.length} bytes`);
    const cover = await thumbnailDataUrl(files.cover, await probe(files.cover), { ffmpeg: FFMPEG, tempDir: thumbs, cache });
    assert.match(cover, /^data:image\/jpeg;base64,/);
    const none = await thumbnailDataUrl(files.quiet, await probe(files.quiet), { ffmpeg: FFMPEG, tempDir: thumbs, cache });
    assert.equal(none, null);
    assert.equal(cache.size, 2);
    assert.deepEqual(fs.readdirSync(thumbs), []);
  });
});
