const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseProbe } = require('../src/main/converter/media');
const plan = require('../src/main/converter/plan');
const names = require('../src/main/converter/names');
const { BUILT_IN } = require('../src/main/presets');
const runner = require('../src/main/converter/runner');
const { createEncoderProbe, parseEncoderList, readCacheFile } = require('../src/main/converter/encoder-probe');
const { thumbnailArgs, thumbnailSize, seekTime } = require('../src/main/converter/thumbnail');
const { createLru } = require('../src/main/converter/probe');
const { createLimiter } = require('../src/main/converter/service');
const { registerConvert, bridgeConvert } = require('../src/main/ipc/convert');
const { ValidationError } = require('../src/main/validate');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');

function media(name, patch = null) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
  if (patch) patch(data);
  return { ...parseProbe(data, { path: data.format.filename, size: 5000 }), mtimeMs: 1000 };
}

function preset(id, patch = {}) {
  const base = structuredClone(BUILT_IN.find((item) => item.id === id));
  return {
    ...base,
    ...patch,
    video: { ...base.video, ...(patch.video || {}) },
    picture: { ...base.picture, ...(patch.picture || {}) },
    audio: { ...base.audio, ...(patch.audio || {}) }
  };
}

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function monoSource() {
  return media('hevc10-mkv');
}

function channels(item, count, layout) {
  return {
    ...item,
    audio: item.audio.map((track) => ({ ...track, channels: count, layout }))
  };
}

describe('plan fixes for the runtime', () => {
  const OUT = 'C:\\Out\\a.partial';

  test('mono Opus and Vorbis bitrates are clamped to what the encoders accept', () => {
    const opus = plan.buildPlan({ media: monoSource(), preset: preset('mp3-320', { container: 'opus', audio: { codec: 'opus', bitrate: 320, channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(opus.args, '-b:a:0'), '256k');
    assert.equal(opus.summary.audio[0].bitrate, 256);
    const vorbis = plan.buildPlan({ media: monoSource(), preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'vorbis', bitrate: 320, channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(vorbis.args, '-b:a:0'), '240k');
    const stereo = plan.buildPlan({ media: monoSource(), preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'vorbis', bitrate: 320, channels: 'stereo' } }), outputPath: OUT });
    assert.equal(valueOf(stereo.args, '-b:a:0'), '320k');
  });

  test('surround Vorbis and AC-3 get a workable minimum bitrate', () => {
    const surround = media('surround-mkv');
    const vorbis = plan.buildPlan({ media: surround, preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'vorbis', bitrate: 64, channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(vorbis.args, '-b:a:0'), '84k');
    const eight = plan.buildPlan({ media: channels(surround, 8, '7.1'), preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'vorbis', bitrate: 128, channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(eight.args, '-b:a:0'), '256k');
    const ac3 = plan.buildPlan({ media: surround, preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'ac3', bitrate: 64, channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(ac3.args, '-b:a:0'), '192k');
  });

  test('Vorbis never keeps an unsupported sample rate', () => {
    const low = media('xvid-avi', (data) => {
      data.streams[1].sample_rate = '22050';
    });
    const result = plan.buildPlan({ media: low, preset: preset('mp4-universal', { container: 'mkv', audio: { codec: 'vorbis', sampleRate: 'keep', channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(result.args, '-ar:a:0'), '48000');
  });

  test('audio that cannot be copied is encoded with the preset codec instead of failing', () => {
    const item = media('ntsc-dv', (data) => {
      data.streams[1].codec_name = 'adpcm_ima_qt';
    });
    const result = plan.buildPlan({ media: item, preset: preset('archive-remux'), outputPath: OUT });
    assert.deepEqual(result.errors, []);
    assert.equal(valueOf(result.args, '-c:v:0'), 'copy');
    assert.equal(valueOf(result.args, '-c:a:0'), 'flac');
    assert.ok(result.warnings.includes('audio-reencoded'));
    assert.equal(result.summary.audio[0].codec, 'flac');
    assert.equal(result.summary.audio[0].reencoded, true);
    assert.equal(result.args.includes('-filter:a:0') && valueOf(result.args, '-filter:a:0').includes('loudnorm'), false);
    const extract = plan.buildPlan({ media: item, preset: preset('extract-audio'), outputPath: OUT });
    assert.equal(valueOf(extract.args, '-c:a:0'), 'flac');
    assert.equal(valueOf(extract.args, '-f'), 'matroska');
  });

  test('copyable tracks stay copies next to re-encoded ones', () => {
    const item = media('multi-track-mkv', (data) => {
      data.streams[2].codec_name = 'pcm_dvd';
    });
    const result = plan.buildPlan({ media: item, preset: preset('archive-remux'), outputPath: OUT });
    assert.equal(valueOf(result.args, '-c:a:0'), 'copy');
    assert.equal(valueOf(result.args, '-c:a:1'), 'flac');
    const described = plan.describe(preset('archive-remux'), item);
    assert.ok(described.lines.some((line) => line.startsWith('Audio copy')));
    assert.ok(described.lines.some((line) => line.startsWith('FLAC')));
  });

  test('the WAV preset is 16-bit PCM', () => {
    const result = plan.buildPlan({ media: media('ntsc-dv'), preset: preset('wav-48k'), outputPath: OUT });
    assert.equal(valueOf(result.args, '-c:a:0'), 'pcm_s16le');
    assert.equal(valueOf(result.args, '-ar:a:0'), '48000');
  });
});

describe('media and names additions', () => {
  test('attached cover art is recorded for thumbnails', () => {
    assert.deepEqual(media('cover-art-mp3').cover, { index: 1, codec: 'mjpeg' });
    assert.equal(media('ntsc-dv').cover, null);
  });

  test('outputPathFor can take an already rendered name literally', () => {
    const result = names.outputPathFor({
      inputPath: 'C:\\In\\clip.avi',
      folder: 'C:\\Out',
      baseName: '{name} [{preset}] ñ',
      template: '{name}_ignored',
      extension: 'mp4',
      exists: () => false
    });
    assert.equal(result.path, 'C:\\Out\\{name} [{preset}] ñ.mp4');
    const reserved = names.outputPathFor({ inputPath: 'C:\\In\\clip.avi', folder: 'C:\\Out', baseName: 'clip', extension: 'mp4', exists: () => false, reserved: ['C:\\Out\\clip.mp4'] });
    assert.equal(reserved.path, 'C:\\Out\\clip (2).mp4');
    const skip = names.outputPathFor({ inputPath: 'C:\\In\\clip.avi', folder: 'C:\\Out', baseName: 'clip', extension: 'mp4', collision: 'skip', exists: () => true });
    assert.deepEqual(skip, { path: 'C:\\Out\\clip.mp4', skip: true, overwrite: false });
  });
});

describe('runner decisions', () => {
  const usable = { h264: ['h264_qsv', 'h264_mf', 'libx264'], hevc: ['hevc_qsv', 'hevc_mf', 'libx265'], av1: ['libaom-av1'], vp9: ['libvpx-vp9'] };

  test('auto picks the best working hardware encoder', () => {
    const choice = runner.chooseEncoder({ preset: preset('mp4-universal'), media: media('ntsc-dv'), usable, state: { tenBit: [] } });
    assert.deepEqual(choice, { name: 'h264_qsv', warnings: [] });
  });

  test('the software setting keeps everything on the CPU', () => {
    const choice = runner.chooseEncoder({ preset: preset('mp4-universal'), media: media('ntsc-dv'), usable, hardware: 'software' });
    assert.equal(choice.name, 'libx264');
    assert.equal(runner.needsEncoderDetection(preset('mp4-universal'), media('ntsc-dv'), 'software'), false);
    assert.equal(runner.needsEncoderDetection(preset('mp4-universal', { video: { encoder: 'h264_qsv' } }), media('ntsc-dv'), 'software'), true);
    assert.equal(runner.needsEncoderDetection(preset('mp3-320'), media('ntsc-dv'), 'auto'), false);
    assert.equal(runner.needsEncoderDetection(preset('archive-remux'), media('ntsc-dv'), 'auto'), false);
  });

  test('a forced encoder that is not available falls back with a warning', () => {
    const choice = runner.chooseEncoder({ preset: preset('mp4-universal', { video: { encoder: 'h264_nvenc' } }), media: media('ntsc-dv'), usable });
    assert.deepEqual(choice, { name: 'h264_qsv', warnings: ['encoder-unavailable'] });
    const broken = runner.chooseEncoder({ preset: preset('mp4-universal', { video: { encoder: 'h264_qsv' } }), media: media('ntsc-dv'), usable: { h264: ['libx264'] } });
    assert.deepEqual(broken, { name: 'libx264', warnings: ['encoder-unavailable'] });
  });

  test('Media Foundation is kept away from MKV with its own warning', () => {
    const mkv = preset('mp4-universal', { container: 'mkv', video: { encoder: 'h264_mf' } });
    const choice = runner.chooseEncoder({ preset: mkv, media: media('ntsc-dv'), usable: { h264: ['h264_mf', 'libx264'] } });
    assert.deepEqual(choice, { name: 'libx264', warnings: ['encoder-container'] });
    const forcedOk = runner.chooseEncoder({ preset: preset('mp4-universal', { video: { encoder: 'h264_mf' } }), media: media('ntsc-dv'), usable });
    assert.deepEqual(forcedOk, { name: 'h264_mf', warnings: [] });
  });

  test('10-bit sources only use hardware encoders that passed the 10-bit probe', () => {
    const hevc = preset('mp4-universal', { video: { codec: 'hevc' } });
    const tenBit = media('hevc10-mkv');
    assert.equal(runner.chooseEncoder({ preset: hevc, media: tenBit, usable, state: { tenBit: [] } }).name, 'hevc_mf');
    assert.equal(runner.chooseEncoder({ preset: hevc, media: tenBit, usable, state: { tenBit: ['hevc_qsv'] } }).name, 'hevc_qsv');
    assert.equal(runner.chooseEncoder({ preset: preset('mp4-universal'), media: tenBit, usable, state: { tenBit: [] } }).name, 'h264_qsv');
  });

  test('no encoder is needed for copies, audio presets or files without video', () => {
    assert.equal(runner.chooseEncoder({ preset: preset('archive-remux'), media: media('ntsc-dv'), usable }).name, null);
    assert.equal(runner.chooseEncoder({ preset: preset('mp3-320'), media: media('ntsc-dv'), usable }).name, null);
    assert.equal(runner.chooseEncoder({ preset: preset('mp4-universal'), media: media('cover-art-mp3'), usable }).name, null);
  });

  test('field analysis runs only when the answer changes the result', () => {
    assert.equal(runner.needsAnalysis(media('xvid-avi'), preset('flowair-1080p')), true);
    assert.equal(runner.needsAnalysis(media('mjpeg-pcm-avi'), preset('mp4-universal')), true);
    assert.equal(runner.needsAnalysis(media('telecine-mpeg2'), preset('flowair-1080p')), true);
    assert.equal(runner.needsAnalysis(media('ntsc-dv'), preset('flowair-1080p')), true);
    assert.equal(runner.needsAnalysis(media('ntsc-dv'), preset('flowair-1080p', { picture: { ivtc: 'off' } })), false);
    assert.equal(runner.needsAnalysis(media('pal-anamorphic-vob'), preset('flowair-1080p')), false);
    assert.equal(runner.needsAnalysis(media('h264-1080p5994'), preset('flowair-1080p')), false);
    assert.equal(runner.needsAnalysis(media('xvid-avi'), preset('flowair-1080p', { picture: { deinterlace: 'on', ivtc: 'off' } })), false);
    assert.equal(runner.needsAnalysis(media('xvid-avi'), preset('flowair-1080p', { picture: { deinterlace: 'off', ivtc: 'off' } })), false);
    assert.equal(runner.needsAnalysis(media('xvid-avi'), preset('archive-remux')), false);
    assert.equal(runner.needsAnalysis(media('xvid-avi'), preset('mp3-320')), false);
    assert.equal(runner.needsAnalysis(media('vfr-mp4'), preset('flowair-1080p')), false);
  });

  test('overall progress is weighted across the steps', () => {
    const stages = runner.planStages({ analyze: true, scans: 1, twoPass: true });
    assert.deepEqual(stages, ['analyzing', 'measuring-loudness', 'encoding-pass-1', 'encoding', 'verifying']);
    const tracker = runner.createTracker(stages);
    assert.equal(tracker.percent(0.5), 0);
    assert.equal(tracker.begin('analyzing'), 0);
    const afterAnalysis = tracker.begin('measuring-loudness');
    assert.ok(afterAnalysis > 0 && afterAnalysis < 3);
    const pass1 = tracker.begin('encoding-pass-1');
    const half = tracker.percent(0.5);
    assert.ok(half > pass1);
    const encoding = tracker.begin('encoding');
    assert.ok(encoding > half);
    assert.ok(tracker.percent(1) > 98 && tracker.percent(1) < 100);
    assert.equal(tracker.percent(null), null);
    assert.equal(tracker.percent(7), tracker.percent(1));
    assert.equal(tracker.begin('encoding'), encoding);
    assert.ok(tracker.begin('verifying') > 98);
    assert.equal(tracker.begin('finishing'), 100);
  });

  test('a restarted encode goes back to the start of its step', () => {
    const tracker = runner.createTracker(runner.planStages({}));
    tracker.begin('encoding');
    const start = tracker.percent(0);
    assert.ok(tracker.percent(0.8) > start);
    assert.equal(tracker.begin('encoding'), start);
    assert.equal(tracker.begin('encoding-pass-1'), start);
    assert.deepEqual(runner.planStages({}), ['encoding', 'verifying']);
  });

  test('disk space is only refused when clearly insufficient', () => {
    const mb = 1024 * 1024;
    assert.equal(runner.diskShortfall({ free: 4 * mb, estimate: null }), true);
    assert.equal(runner.diskShortfall({ free: 100 * mb, estimate: null }), false);
    assert.equal(runner.diskShortfall({ free: 100 * mb, estimate: 150 * mb }), false);
    assert.equal(runner.diskShortfall({ free: 100 * mb, estimate: 250 * mb }), true);
    assert.equal(runner.diskShortfall({ free: 100 * mb, estimate: 110 * mb, exact: true }), true);
    assert.equal(runner.diskShortfall({ free: 100 * mb, estimate: 100 * mb, exact: true }), false);
    assert.equal(runner.diskShortfall({ free: Number.NaN, estimate: 1e12 }), false);
    assert.equal(runner.isExactEstimate(preset('archive-remux')), true);
    assert.equal(runner.isExactEstimate(preset('wav-48k')), true);
    assert.equal(runner.isExactEstimate(preset('mp4-universal')), false);
    assert.equal(runner.isExactEstimate(preset('mp4-universal', { video: { rateControl: 'bitrate' } })), true);
  });

  test('hardware failures fall back to software only when it can help', () => {
    const failure = (code, outTime = null) => new runner.StepFailure({ code, message: 'x' }, outTime, []);
    assert.equal(runner.shouldFallback(failure('encoder-failed', 50), 'h264_qsv'), true);
    assert.equal(runner.shouldFallback(failure('unknown', null), 'h264_qsv'), true);
    assert.equal(runner.shouldFallback(failure('unknown', 0.5), 'h264_nvenc'), true);
    assert.equal(runner.shouldFallback(failure('unknown', 30), 'h264_qsv'), false);
    assert.equal(runner.shouldFallback(failure('disk-full', null), 'h264_qsv'), false);
    assert.equal(runner.shouldFallback(failure('input-unreadable', null), 'h264_qsv'), false);
    assert.equal(runner.shouldFallback(failure('encoder-failed', null), 'libx264'), false);
    assert.equal(runner.shouldFallback(failure('encoder-failed', null), null), false);
    assert.equal(runner.shouldFallback(new Error('x'), 'h264_qsv'), false);
  });

  test('damaged or tampered specs are refused before anything runs', () => {
    const good = {
      id: 'jabc123',
      spec: {
        input: { path: 'C:\\In\\a.avi', size: 1, mtimeMs: 2, media: {} },
        preset: preset('mp4-universal'),
        output: { folder: 'C:\\Out', name: 'a', collision: 'rename', keepDate: false },
        trim: null,
        deleteInputAfter: false
      }
    };
    const spec = runner.readSpec(good);
    assert.equal(spec.output.baseName, 'a');
    assert.equal(spec.preset.id, 'mp4-universal');
    const withBase = runner.readSpec({ ...good, spec: { ...good.spec, output: { ...good.spec.output, name: 'a (2)', baseName: 'a' } } });
    assert.equal(withBase.output.baseName, 'a');
    assert.deepEqual(runner.readSpec({ ...good, spec: { ...good.spec, trim: { start: 1, end: null } } }).trim, { start: 1, end: null });
    assert.equal(runner.readSpec({ ...good, spec: { ...good.spec, trim: { start: 0, end: null } } }).trim, null);
    const broken = [
      { ...good, id: '../x' },
      { ...good, spec: { ...good.spec, input: { path: 'relative.avi' } } },
      { ...good, spec: { ...good.spec, output: { ...good.spec.output, folder: 'Out' } } },
      { ...good, spec: { ...good.spec, output: { ...good.spec.output, name: '..\\..\\evil' } } },
      { ...good, spec: { ...good.spec, output: { ...good.spec.output, name: '' } } },
      { ...good, spec: { ...good.spec, preset: { container: 'mp3', audio: { mode: 'none' }, name: 'x' } } },
      { ...good, spec: { ...good.spec, trim: { start: 'x' } } },
      { ...good, spec: { ...good.spec, trim: { start: 3, end: 2 } } },
      { ...good, spec: null }
    ];
    for (const job of broken) {
      assert.throws(() => runner.readSpec(job), (error) => error.name === 'JobError' && error.code === 'invalid-job' && error.retryable === false);
    }
  });
});

function fakeRun(behaviour) {
  const calls = [];
  const run = (file, args, options = {}) => {
    calls.push({ file, args });
    const outcome = behaviour(args, options);
    const result = Promise.resolve(outcome).then((value) => {
      if (options.signal && options.signal.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { code: 0, stderr: '', stderrLines: [], stdout: '', overflow: false, ...value };
    });
    return { pid: 1, kill: () => Promise.resolve(), result };
  };
  return { run, calls };
}

const ENCODER_LIST = [
  'Encoders:',
  ' V..... = Video',
  ' ------',
  ' V....D libx264              libx264 H.264',
  ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)',
  ' V..... h264_qsv             H.264 (Intel Quick Sync Video acceleration) (codec h264)',
  ' V....D h264_mf              H264 via MediaFoundation (codec h264)',
  ' V....D libx265              libx265 H.265 / HEVC (codec hevc)',
  ' V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)',
  ' V..... hevc_qsv             HEVC (Intel Quick Sync Video acceleration) (codec hevc)',
  ' V....D libaom-av1           libaom AV1 (codec av1)',
  ' V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)',
  ' A....D aac                  AAC (Advanced Audio Coding)'
].join('\n');

function machine({ tenBitQsv = true } = {}) {
  return fakeRun((args) => {
    if (args.includes('-encoders')) return { stdout: ENCODER_LIST };
    const name = valueOf(args, '-c:v');
    const format = valueOf(args, '-vf');
    if (name.endsWith('_nvenc')) return { code: 1, stderrLines: [`[${name} @ 0000025817320dc0] Cannot load nvEncodeAPI64.dll`] };
    if (name === 'hevc_qsv' && format === 'format=p010le' && !tenBitQsv) return { code: 1, stderrLines: ['[hevc_qsv @ 01] Current pixel format is unsupported'] };
    return { code: 0 };
  });
}

describe('encoder probe', () => {
  function tempFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-encoders-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    return path.join(dir, 'cache', 'encoders.json');
  }

  test('parses the ffmpeg encoder list', () => {
    const list = parseEncoderList(ENCODER_LIST);
    assert.ok(list.has('libx264'));
    assert.ok(list.has('h264_qsv'));
    assert.ok(list.has('aac'));
    assert.equal(list.has('Encoders:'), false);
  });

  test('detects working encoders in preference order, skipping a missing driver family', async (t) => {
    const { run, calls } = machine();
    const cacheFile = tempFile(t);
    const probe = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', cacheFile, cacheKey: 'v1|gpu', run });
    const events = [];
    const progress = [];
    probe.on('changed', (state) => events.push(state.status));
    probe.on('progress', (item) => progress.push(item.name));
    assert.equal(probe.get().status, 'unknown');
    const [first, second] = await Promise.all([probe.detect(), probe.detect()]);
    assert.deepEqual(first, second);
    assert.equal(first.status, 'ready');
    assert.deepEqual(first.available, { h264: ['h264_qsv', 'h264_mf', 'libx264'], hevc: ['hevc_qsv', 'libx265'], av1: ['libaom-av1'], vp9: [] });
    assert.deepEqual(first.tenBit, ['hevc_qsv']);
    assert.deepEqual(first.broken, []);
    assert.ok(first.detectedAt > 0);
    assert.deepEqual(events, ['detecting', 'ready']);
    assert.deepEqual(progress, ['h264_qsv', 'h264_nvenc', 'h264_mf', 'hevc_qsv']);
    const tested = calls.filter((call) => call.args.includes('lavfi')).map((call) => `${valueOf(call.args, '-c:v')} ${valueOf(call.args, '-vf')}`);
    assert.deepEqual(tested, ['h264_qsv format=nv12', 'h264_nvenc format=yuv420p', 'h264_mf format=nv12', 'hevc_qsv format=nv12', 'hevc_qsv format=p010le']);
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(saved.key, 'v1|gpu');
    probe.dispose();
  });

  test('the cache survives restarts and is ignored when the key changes', async (t) => {
    const cacheFile = tempFile(t);
    const first = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', cacheFile, cacheKey: async () => 'v1|gpu', run: machine().run });
    await first.detect();
    first.dispose();
    const again = machine();
    const second = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', cacheFile, cacheKey: async () => 'v1|gpu', run: again.run });
    const state = await second.detect();
    assert.equal(again.calls.length, 0);
    assert.deepEqual(state.available.h264, ['h264_qsv', 'h264_mf', 'libx264']);
    const updated = machine({ tenBitQsv: false });
    const third = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', cacheFile, cacheKey: () => 'v2|new driver', run: updated.run });
    const fresh = await third.detect();
    assert.ok(updated.calls.length > 0);
    assert.deepEqual(fresh.tenBit, []);
    assert.equal(readCacheFile(cacheFile, 'v1|gpu'), null);
    assert.deepEqual(readCacheFile(cacheFile, 'v2|new driver').tenBit, []);
  });

  test('a damaged cache file is ignored', async (t) => {
    const cacheFile = tempFile(t);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, '{"version":1,"key":"k","available":{"h264":["evil.exe","h264_qsv","hevc_qsv"]},"tenBit":"x"}');
    assert.deepEqual(readCacheFile(cacheFile, 'k').available.h264, ['h264_qsv']);
    assert.deepEqual(readCacheFile(cacheFile, 'k').tenBit, []);
    fs.writeFileSync(cacheFile, '{broken');
    assert.equal(readCacheFile(cacheFile, 'k'), null);
  });

  test('broken encoders are session only and cleared by a forced detection', async () => {
    const probe = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', run: machine().run });
    await probe.detect();
    let changes = 0;
    const off = probe.on('changed', () => {
      changes += 1;
    });
    probe.markBroken('h264_qsv');
    probe.markBroken('h264_qsv');
    probe.markBroken('libx264');
    assert.equal(changes, 1);
    assert.deepEqual(probe.get().broken, ['h264_qsv']);
    assert.deepEqual(probe.usable().h264, ['h264_mf', 'libx264']);
    assert.deepEqual(probe.get().available.h264, ['h264_qsv', 'h264_mf', 'libx264']);
    await probe.detect({ force: true });
    assert.deepEqual(probe.get().broken, []);
    off();
    probe.dispose();
  });

  test('a missing ffmpeg leaves software only and a failing key still detects', async () => {
    const failing = fakeRun(() => {
      throw Object.assign(new Error('spawn failed'), { name: 'ProcessError', spawnFailed: true });
    });
    const probe = createEncoderProbe({
      ffmpeg: 'missing.exe',
      cacheKey: () => {
        throw new Error('no gpu info');
      },
      run: failing.run
    });
    const state = await probe.detect();
    assert.equal(state.status, 'ready');
    assert.deepEqual(state.available.h264, []);
  });

  test('a hung test encode times out and counts as not available', async () => {
    const hanging = fakeRun((args, options) => {
      if (args.includes('-encoders')) return { stdout: ' V..... h264_qsv  x\n V....D libx264 x' };
      return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ code: 1 }), { once: true }));
    });
    const probe = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', timeoutMs: 30, run: hanging.run });
    const state = await probe.detect();
    assert.deepEqual(state.available.h264, ['libx264']);
  });

  test('dispose stops a running detection', async () => {
    const hanging = fakeRun((args, options) => {
      if (args.includes('-encoders')) return { stdout: ' V..... h264_qsv  x' };
      return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ code: 1 }), { once: true }));
    });
    const probe = createEncoderProbe({ ffmpeg: 'ffmpeg.exe', run: hanging.run });
    const pending = probe.detect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    probe.dispose();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(probe.get().status, 'unknown');
    assert.equal((await probe.detect()).status, 'unknown');
  });
});

describe('thumbnails', () => {
  test('sizes follow the display aspect with a 256 px long side', () => {
    assert.deepEqual(thumbnailSize(media('ntsc-dv')), { width: 256, height: 192 });
    assert.deepEqual(thumbnailSize(media('h264-1080p5994')), { width: 256, height: 144 });
    assert.deepEqual(thumbnailSize(media('rotated-mp4')), { width: 192, height: 256 });
    assert.deepEqual(thumbnailSize(media('pal-anamorphic-vob')), { width: 256, height: 144 });
  });

  test('the frame comes from 10% of the file, at most 30 seconds in', () => {
    assert.equal(seekTime({ duration: 3 }), 0.3);
    assert.equal(seekTime({ duration: 3600 }), 30);
    assert.equal(seekTime({ duration: null }), 0);
  });

  test('video thumbnails seek fast and deinterlace, audio uses the cover', () => {
    const dv = thumbnailArgs('C:\\In\\a ñ.dv', media('ntsc-dv'), 'C:\\T\\t.jpg');
    assert.ok(dv.includes('-noaccurate_seek'));
    assert.equal(valueOf(dv, '-skip_frame'), 'nokey');
    assert.equal(valueOf(dv, '-i'), 'file:C:\\In\\a ñ.dv');
    assert.equal(valueOf(dv, '-map'), '0:0');
    assert.match(valueOf(dv, '-vf'), /^yadif=deint=interlaced,scale=256:192:/);
    assert.equal(dv[dv.length - 1], 'file:C:\\T\\t.jpg');
    const slow = thumbnailArgs('C:\\In\\a.dv', media('ntsc-dv'), 'C:\\T\\t.jpg', { fast: false });
    assert.equal(slow.includes('-skip_frame'), false);
    assert.equal(slow.includes('-ss'), false);
    const hdr = thumbnailArgs('C:\\In\\a.mp4', media('hdr10-mp4'), 'C:\\T\\t.jpg');
    assert.match(valueOf(hdr, '-vf'), /tonemap=tonemap=hable/);
    const cover = thumbnailArgs('C:\\In\\a.mp3', media('cover-art-mp3'), 'C:\\T\\t.jpg');
    assert.equal(valueOf(cover, '-map'), '0:1');
    assert.equal(cover.includes('-ss'), false);
    const plain = media('cover-art-mp3');
    plain.cover = null;
    assert.equal(thumbnailArgs('C:\\In\\a.mp3', plain, 'C:\\T\\t.jpg'), null);
  });
});

describe('small helpers', () => {
  test('LRU cache evicts the least recently used entry', () => {
    const cache = createLru(2);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    cache.set('c', 3);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.size, 2);
    cache.set('d', null);
    assert.equal(cache.has('d'), true);
    assert.equal(cache.get('d'), null);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  test('the limiter never runs more tasks than allowed', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (value === 3) throw new Error('boom');
      return value;
    };
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((value) => limit(() => task(value))));
    assert.equal(peak, 2);
    assert.deepEqual(results.map((item) => item.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });
});

describe('convert IPC', () => {
  function setup(overrides = {}) {
    const handlers = new Map();
    const sent = [];
    const added = [];
    let listener = null;
    const ctx = {
      send: (channel, payload) => sent.push({ channel, payload }),
      queue: {
        add: (inputs, options) => {
          added.push({ inputs, options });
          return inputs.map((_, index) => `j${index}`);
        }
      },
      converter: {
        probe: async (paths) => paths.map((item) => (item.endsWith('bad.avi') ? { path: item, error: { code: 'input-unreadable', message: 'Unreadable.', hint: null } } : { path: item, media: media('ntsc-dv') })),
        analyze: async (item) => ({ verdict: 'bff', path: item }),
        cancelAnalyze: (item) => item.length > 0,
        thumbnail: async () => 'data:image/jpeg;base64,xx',
        describe: (preset, item, options) => ({ preset: preset.id, container: item.container, options }),
        encoders: () => ({ status: 'ready' }),
        detectEncoders: async () => ({ status: 'ready', forced: true }),
        buildJobs: (request) => require('../src/main/converter/jobs').buildConvertJobs(request),
        onEncodersChanged: (fn) => {
          listener = fn;
          return () => {
            listener = null;
          };
        },
        ...overrides
      }
    };
    registerConvert(ctx, (channel, fn) => handlers.set(channel, fn));
    return { ctx, handlers, sent, added, emit: (view) => listener && listener(view), hasListener: () => listener !== null };
  }

  test('registers every preload channel', () => {
    const { handlers } = setup();
    assert.deepEqual([...handlers.keys()].sort(), [
      'convert:analyze',
      'convert:cancel-analyze',
      'convert:describe',
      'convert:detect-encoders',
      'convert:encoders',
      'convert:enqueue',
      'convert:probe',
      'convert:thumbnail'
    ]);
  });

  test('validates paths and arguments before calling the service', async () => {
    const { handlers } = setup();
    await assert.rejects(async () => handlers.get('convert:probe')('C:\\a.avi'), ValidationError);
    await assert.rejects(async () => handlers.get('convert:probe')(['relative.avi']), ValidationError);
    await assert.rejects(async () => handlers.get('convert:analyze')('..\\a.avi'), ValidationError);
    await assert.rejects(async () => handlers.get('convert:thumbnail')(42), ValidationError);
    await assert.rejects(async () => handlers.get('convert:describe')(null, {}), ValidationError);
    await assert.rejects(async () => handlers.get('convert:describe')(preset('mp4-universal'), { audio: 'x' }), ValidationError);
    await assert.rejects(
      async () => handlers.get('convert:describe')({ ...preset('mp3-320'), audio: { ...preset('mp3-320').audio, mode: 'none' } }, media('ntsc-dv')),
      (error) => error.expose === true
    );
    const probed = await handlers.get('convert:probe')(['C:/Videos/a.avi']);
    assert.equal(probed[0].path, 'C:\\Videos\\a.avi');
    assert.deepEqual(await handlers.get('convert:analyze')('C:\\Videos\\a.avi'), { verdict: 'bff', path: 'C:\\Videos\\a.avi' });
    assert.equal(await handlers.get('convert:cancel-analyze')('C:\\Videos\\a.avi'), true);
    assert.equal(await handlers.get('convert:thumbnail')('C:\\Videos\\a.avi'), 'data:image/jpeg;base64,xx');
    assert.deepEqual(await handlers.get('convert:describe')({ ...preset('mp4-universal'), name: '' }, media('ntsc-dv')), { preset: 'mp4-universal', container: 'dv', options: {} });
    assert.deepEqual((await handlers.get('convert:describe')(preset('mp4-universal'), media('ntsc-dv'), { trim: { start: 1, end: 2 } })).options, { trim: { start: 1, end: 2 } });
    await assert.rejects(async () => handlers.get('convert:describe')(preset('mp4-universal'), media('ntsc-dv'), { trim: { start: -3 } }), ValidationError);
    assert.deepEqual(await handlers.get('convert:encoders')(), { status: 'ready' });
    assert.deepEqual(await handlers.get('convert:detect-encoders')(), { status: 'ready', forced: true });
  });

  test('enqueue probes, builds and adds jobs, reporting per-file errors', async () => {
    const { handlers, added } = setup();
    const result = await handlers.get('convert:enqueue')({
      files: [{ path: 'D:\\In\\one.dv' }, { path: 'D:\\In\\bad.avi' }, { path: 'D:\\In\\two.dv', trim: { start: 10, end: null } }, { path: 'D:\\In\\three.dv', trim: { start: 0.5, end: 1 } }],
      preset: preset('flowair-720p'),
      output: { mode: 'folder', folder: 'E:\\Out', nameTemplate: '{name}_{resolution}', collision: 'rename', keepDate: true },
      start: true
    });
    assert.deepEqual(result.ids, ['j0', 'j1']);
    assert.deepEqual(
      result.errors.map((error) => [error.path, error.code]),
      [
        ['D:\\In\\bad.avi', 'input-unreadable'],
        ['D:\\In\\two.dv', 'trim-invalid']
      ]
    );
    assert.equal(added.length, 1);
    assert.deepEqual(added[0].options, { start: true });
    assert.equal(added[0].inputs[0].spec.output.name, 'one_720p');
    assert.equal(added[0].inputs[0].spec.output.keepDate, true);
    assert.deepEqual(added[0].inputs[1].spec.trim, { start: 0.5, end: 1 });
  });

  test('enqueue adds nothing when every file fails and defaults to Ready jobs', async () => {
    const { handlers, added } = setup();
    const none = await handlers.get('convert:enqueue')({ files: [{ path: 'D:\\bad.avi' }], preset: preset('mp4-universal'), output: { mode: 'source' } });
    assert.deepEqual(none.ids, []);
    assert.equal(added.length, 0);
    await handlers.get('convert:enqueue')({ files: [{ path: 'D:\\ok.dv' }], preset: preset('mp4-universal'), output: { mode: 'source' } });
    assert.deepEqual(added[0].options, { start: false });
  });

  test('enqueue rejects malformed requests', async () => {
    const { handlers } = setup();
    const enqueue = handlers.get('convert:enqueue');
    const base = { files: [{ path: 'D:\\a.dv' }], preset: preset('mp4-universal'), output: { mode: 'folder', folder: 'E:\\Out' } };
    for (const request of [
      null,
      { ...base, files: [] },
      { ...base, files: ['D:\\a.dv'] },
      { ...base, files: [{ path: 'D:\\a.dv', trim: { start: -1 } }] },
      { ...base, files: [{ path: 'D:\\a.dv', trim: { start: '1' } }] },
      { ...base, output: { mode: 'folder' } },
      { ...base, output: { mode: 'elsewhere' } },
      { ...base, output: { mode: 'source', collision: 'ask' } },
      { ...base, output: { mode: 'source', nameTemplate: 'x'.repeat(300) } },
      { ...base, preset: 'mp4-universal' }
    ]) {
      await assert.rejects(async () => enqueue(request), (error) => error instanceof ValidationError || error.expose === true);
    }
  });

  test('encoder changes are forwarded until disposed', () => {
    const { ctx, sent, emit, hasListener } = setup();
    const dispose = bridgeConvert(ctx);
    emit({ status: 'detecting' });
    assert.deepEqual(sent, [{ channel: 'encoders:changed', payload: { status: 'detecting' } }]);
    dispose();
    assert.equal(hasListener(), false);
  });
});
