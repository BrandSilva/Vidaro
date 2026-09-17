const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const processes = require('../src/main/processes');
const { BUILT_IN } = require('../src/main/presets');
const { createConverterService, binarySignature } = require('../src/main/converter/service');

const BIN = path.join(__dirname, '..', 'bin');
const FFMPEG = path.join(BIN, 'ffmpeg.exe');
const FFPROBE = path.join(BIN, 'ffprobe.exe');
const available = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);
const VERSION = '9.9.9-test';

function preset(id) {
  return structuredClone(BUILT_IN.find((item) => item.id === id));
}

describe('converter service with the bundled tools', { skip: !available && 'bin/ffmpeg.exe is not present', timeout: 60000 }, () => {
  let root = null;
  let service = null;
  let settings = { convert: { hardware: 'auto' } };
  const files = {};

  async function generate(name, args) {
    const file = path.join(root, 'media ñ', name);
    const result = await processes.run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args, `file:${file}`]).result;
    assert.equal(result.code, 0, result.stderr);
    return file;
  }

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-service 🎬 '));
    fs.mkdirSync(path.join(root, 'media ñ'));
    files.dv = await generate('entrevista.dv', ['-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=60000/1001,gblur=sigma=1', '-f', 'lavfi', '-i', 'sine', '-t', '2', '-vf', 'tinterlace=mode=interleave_top,setfield=tff', '-target', 'ntsc-dv', '-ac', '2']);
    files.big = await generate('grande.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '25', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'matroska']);
    files.audio = await generate('solo audio.m4a', ['-f', 'lavfi', '-i', 'sine', '-t', '1', '-c:a', 'aac', '-f', 'ipod']);
    files.garbage = path.join(root, 'media ñ', 'roto.avi');
    fs.writeFileSync(files.garbage, Buffer.alloc(50000, 7));
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(cacheDir);
    const key = [VERSION, binarySignature(FFMPEG), 'gpu-a'].join('|');
    const cached = { version: 1, key, detectedAt: 1, available: { h264: ['h264_qsv', 'libx264'], hevc: ['libx265'], av1: [], vp9: [] }, tenBit: [] };
    fs.writeFileSync(path.join(cacheDir, 'encoders.json'), JSON.stringify(cached));
    const paths = {
      ffmpegPath: () => FFMPEG,
      ffprobePath: () => FFPROBE,
      tempDir: () => path.join(root, 'temp'),
      cacheDir: () => cacheDir
    };
    service = createConverterService({ paths, getSettings: () => settings, appVersion: VERSION, gpuInfo: async () => 'gpu-a' });
  });

  after(async () => {
    service?.dispose();
    await processes.killAll();
    if (root) await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    assert.equal(fs.existsSync(root), false);
    assert.equal(processes.liveCount(), 0);
  });

  test('probe keeps the request order and explains bad files', async () => {
    const missing = path.join(root, 'media ñ', 'no existe.avi');
    const results = await service.probe([files.dv, missing, files.dv.toUpperCase(), files.garbage]);
    assert.equal(results.length, 4);
    assert.equal(results[0].path, files.dv);
    assert.equal(results[0].media.video.fieldOrder, 'bff');
    assert.ok(Number.isFinite(results[0].media.mtimeMs));
    assert.deepEqual(Object.keys(results[1]), ['path', 'error']);
    assert.equal(results[1].error.code, 'input-missing');
    assert.equal(typeof results[1].error.message, 'string');
    assert.equal(results[2].media.path, files.dv.toUpperCase());
    assert.equal(results[3].error.code, 'input-unreadable');
    results[0].media.badges.push('changed');
    const again = await service.probe([files.dv]);
    assert.equal(again[0].media.badges.includes('changed'), false);
  });

  test('encoders come from the cache and changes are announced', async () => {
    const seen = [];
    const stop = service.onEncodersChanged((view) => seen.push(view));
    const first = service.encoders();
    assert.ok(first.encoders.h264_qsv.hardware);
    assert.equal(first.encoders.libx264.label, 'Software (x264)');
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!seen.some((view) => view.status === 'ready')) return;
        clearInterval(check);
        resolve();
      }, 10);
    });
    stop();
    const ready = service.encoders();
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.available.h264, ['h264_qsv', 'libx264']);
  });

  test('describe uses the detected encoder and the hardware setting', async () => {
    const [{ media }] = await service.probe([files.dv]);
    const auto = service.describe(preset('flowair-1080p'), media);
    assert.deepEqual(auto.encoder, { name: 'h264_qsv', label: 'Intel Quick Sync', hardware: true });
    assert.equal(auto.encodersReady, true);
    assert.ok(auto.estimateBytes > 0);
    assert.ok(auto.lines[1].includes('Deinterlace'));
    settings = { convert: { hardware: 'software' } };
    assert.equal(service.describe(preset('flowair-1080p'), media).encoder.name, 'libx264');
    settings = { convert: { hardware: 'auto' } };
    assert.equal(service.describe(preset('mp3-320'), media).encoder, null);
    const forced = { ...preset('mp4-universal'), video: { ...preset('mp4-universal').video, encoder: 'h264_nvenc' } };
    assert.deepEqual(service.describe(forced, media).warnings, ['encoder-unavailable']);
    const broken = service.describe(preset('mp4-universal'), { ...media, audio: [null] });
    assert.equal(broken.errors[0].code, 'input-unreadable');
  });

  test('analysis finds the real field order, can be shared and cancelled', async () => {
    const first = service.analyze(files.dv);
    assert.equal(service.analyze(files.dv), first);
    const analysis = await first;
    assert.equal(analysis.verdict, 'tff');
    assert.equal(analysis.telecine, false);
    assert.ok(analysis.frames > 20);
    assert.equal(await service.analyze(files.audio), null);
    await assert.rejects(service.analyze(files.garbage), (error) => error.expose === true && /could not be read/.test(error.message));
    assert.equal(service.cancelAnalyze(files.big), false);
    const slow = service.analyze(files.big);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(service.cancelAnalyze(files.big), true);
    assert.equal(await slow, null);
    assert.equal(processes.liveCount(), 0);
  });

  test('thumbnails are data URLs, or null when there is nothing to show', async () => {
    const thumb = await service.thumbnail(files.dv);
    assert.match(thumb, /^data:image\/jpeg;base64,/);
    assert.equal(await service.thumbnail(files.dv), thumb);
    assert.equal(await service.thumbnail(files.audio), null);
    assert.equal(await service.thumbnail(files.garbage), null);
    assert.deepEqual(fs.readdirSync(path.join(root, 'temp', 'thumbs')), []);
  });

  test('buildJobs is the pure job builder', async () => {
    const [{ media }] = await service.probe([files.dv]);
    const { inputs } = service.buildJobs({ files: [{ path: files.dv, media }], preset: preset('mp4-universal'), output: { mode: 'source' } });
    assert.equal(inputs[0].spec.output.folder, path.dirname(files.dv));
    assert.equal(typeof service.runner.run, 'function');
    assert.equal(typeof service.runner.cleanup, 'function');
  });
});
