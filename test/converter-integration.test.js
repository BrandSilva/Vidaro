const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/main/processes');
const { parseProbe, probeArgs, rateValue } = require('../src/main/converter/media');
const { buildPlan, loudnessScanArgs, parseLoudnorm } = require('../src/main/converter/plan');
const { idetArgs, parseIdet } = require('../src/main/converter/analysis');
const { checkOutput } = require('../src/main/converter/verify');
const { createProgressParser } = require('../src/main/converter/progress');
const { encoderTestArgs } = require('../src/main/converter/encoders');
const { outputPathFor, partialPathFor } = require('../src/main/converter/names');

const BIN = path.join(__dirname, '..', 'bin');
const FFMPEG = path.join(BIN, 'ffmpeg.exe');
const FFPROBE = path.join(BIN, 'ffprobe.exe');
const available = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);

const FLOWAIR = {
  id: 'flowair-test',
  name: 'FlowAir test',
  builtIn: false,
  version: 1,
  container: 'mp4',
  video: {
    mode: 'encode',
    codec: 'h264',
    encoder: 'auto',
    rateControl: 'quality',
    quality: 23,
    bitrate: 8000,
    bitrateMode: 'vbr',
    maxrate: 0,
    bufsize: 0,
    twoPass: false,
    speed: 'fast',
    profile: 'high',
    level: 'auto',
    keyframeSeconds: 0
  },
  picture: {
    resolution: '1080p',
    width: 1920,
    height: 1080,
    fit: 'pad',
    noUpscale: false,
    cfr: true,
    fps: 'keep',
    customFps: '',
    deinterlace: 'auto',
    deinterlaceRate: 'frame',
    ivtc: 'auto',
    squarePixels: true,
    colorConvert: 'auto',
    rotate: 0,
    flipH: false,
    flipV: false,
    crop: { top: 0, bottom: 0, left: 0, right: 0 }
  },
  audio: { mode: 'encode', codec: 'aac', bitrate: 192, vbr: 0, sampleRate: 48000, channels: 'stereo', volumeDb: 0, loudness: 'off', tracks: 'first' },
  subtitles: 'drop',
  output: { faststart: true }
};

const MP3 = {
  ...FLOWAIR,
  id: 'mp3-test',
  container: 'mp3',
  video: { ...FLOWAIR.video, mode: 'none' },
  audio: { ...FLOWAIR.audio, codec: 'mp3', bitrate: 320, sampleRate: 44100 },
  output: { faststart: false }
};

const TONE = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'];

const SOURCES = [
  {
    name: 'ntsc.dv',
    interlaced: true,
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=60000/1001,gblur=sigma=1', ...TONE, '-t', '3', '-vf', 'tinterlace=mode=interleave_bottom,setfield=bff', '-target', 'ntsc-dv', '-ac', '2']
  },
  {
    name: 'dvd.mpg',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=30000/1001', ...TONE, '-t', '3', '-target', 'ntsc-dvd', '-ac', '2']
  },
  {
    name: 'xvid mp3 [ñ].avi',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30000/1001', ...TONE, '-t', '3', '-c:v', 'mpeg4', '-vtag', 'XVID', '-bf', '2', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'avi']
  },
  {
    name: 'mjpeg pcm.avi',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', ...TONE, '-t', '3', '-c:v', 'mjpeg', '-q:v', '5', '-c:a', 'pcm_s16le', '-ac', '2', '-f', 'avi']
  },
  {
    name: 'telecine.mpg',
    interlaced: true,
    telecine: true,
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=24000/1001,gblur=sigma=1.5', ...TONE, '-t', '3', '-vf', 'telecine=first_field=top:pattern=23,setfield=tff', '-c:v', 'mpeg2video', '-b:v', '8M', '-flags', '+ilme+ildct', '-c:a', 'mp2', '-b:a', '192k', '-f', 'vob']
  },
  {
    name: 'hevc10.mkv',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', ...TONE, '-t', '2', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-c:a', 'libopus', '-f', 'matroska']
  },
  {
    name: 'vfr.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', ...TONE, '-t', '3', '-vf', "select='lt(n\\,30)+not(mod(n\\,3))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mp4']
  },
  {
    name: 'hd5994.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60000/1001', ...TONE, '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mp4']
  },
  {
    name: 'pal anamorphic.vob',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=720x576:rate=25', ...TONE, '-t', '3', '-vf', 'setsar=64/45', '-c:v', 'mpeg2video', '-b:v', '5M', '-c:a', 'mp2', '-b:a', '192k', '-f', 'vob']
  },
  {
    name: 'no audio.mp4',
    noAudio: true,
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mp4']
  },
  {
    name: 'surround 5.1.mkv',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', ...TONE, '-t', '2', '-filter_complex', '[1:a]pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3', '-b:a', '384k', '-f', 'matroska']
  },
  {
    name: 'dropped frames.avi',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', ...TONE, '-t', '3', '-vf', "select='not(between(n\\,20\\,30))*not(between(n\\,50\\,52))'", '-fps_mode', 'passthrough', '-c:v', 'mpeg4', '-vtag', 'XVID', '-q:v', '5', '-c:a', 'libmp3lame', '-ac', '2', '-f', 'avi']
  },
  {
    name: 'delayed audio.mkv',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-itsoffset', '0.6', ...TONE, '-t', '2', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'matroska']
  },
  {
    name: 'rgb animation.mov',
    args: ['-f', 'lavfi', '-i', 'color=c=0x30C040:size=1280x720:rate=25', ...TONE, '-t', '2', '-c:v', 'qtrle', '-pix_fmt', 'rgb24', '-c:a', 'pcm_s16le', '-f', 'mov']
  },
  {
    name: 'hdr10 🎬.mp4',
    noAudio: true,
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '1', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-f', 'mp4']
  }
];

let workDir = null;
const probed = new Map();

async function ffmpeg(args, options = {}) {
  const handle = run(FFMPEG, args, { tailLines: 200, ...options });
  return handle.result;
}

async function probe(file) {
  const handle = run(FFPROBE, probeArgs(file), { captureStdout: true });
  const result = await handle.result;
  assert.equal(result.code, 0, result.stderr);
  return parseProbe(result.stdout, { path: file, size: fs.statSync(file).size });
}

async function convert(media, preset, extra = {}) {
  const outputPath = partialPathFor(path.join(workDir, 'out', `${media.name}.${preset.id}.${preset.container}`));
  const plan = buildPlan({ media, preset, encoder: 'libx264', outputPath, ...extra });
  assert.deepEqual(plan.errors, []);
  const parser = createProgressParser();
  let snapshots = 0;
  const result = await ffmpeg(plan.args, {
    onStdoutLine: (line) => {
      if (parser.push(line)) snapshots += 1;
    }
  });
  assert.equal(result.code, 0, `${media.name}: ${result.stderr}`);
  assert.ok(snapshots > 0, 'progress was reported');
  const output = await probe(outputPath);
  const check = checkOutput(output, {
    expectedDuration: plan.expectedDuration,
    expectVideo: plan.expect.video,
    expectAudio: plan.expect.audio,
    sourceDurationReliable: media.durationReliable,
    encodedDuration: parser.lastOutTime(),
    durationSlack: plan.durationSlack
  });
  return { plan, output, check, outputPath };
}

let pixelCount = 0;

async function centerPixel(file, matrix) {
  pixelCount += 1;
  const target = path.join(workDir, `pixel-${pixelCount}.rgb`);
  const filter = `crop=16:16:(iw-16)/2:(ih-16)/2,scale=in_color_matrix=${matrix}:in_range=tv:out_range=pc,format=rgb24`;
  const result = await ffmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', `file:${file}`, '-frames:v', '1', '-vf', filter, '-f', 'rawvideo', `file:${target}`]);
  assert.equal(result.code, 0, result.stderr);
  const data = fs.readFileSync(target);
  const offset = (8 * 16 + 8) * 3;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function assertColor(actual, expected, tolerance, label) {
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= tolerance, `${label}: got ${actual.join(',')} for ${expected.join(',')}`);
  }
}

async function generate(name, args) {
  const file = path.join(workDir, name);
  const result = await ffmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args, `file:${file}`]);
  assert.equal(result.code, 0, `${name}: ${result.stderr}`);
  return probe(file);
}

function assertDuration(output, expected) {
  const frame = output.video ? 1 / rateValue(output.video.avgFps || output.video.fps) : 0.05;
  assert.ok(Math.abs(output.duration - expected) <= 0.1 + frame, `duration ${output.duration} vs ${expected}`);
}

describe('converter integration with the bundled ffmpeg', { skip: !available && 'bin/ffmpeg.exe is not present', timeout: 180000 }, () => {
  before(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-convert [ñ] '));
    fs.mkdirSync(path.join(workDir, 'out'));
    for (const source of SOURCES) {
      const file = path.join(workDir, source.name);
      const result = await ffmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...source.args, `file:${file}`]);
      assert.equal(result.code, 0, `${source.name}: ${result.stderr}`);
      probed.set(source.name, await probe(file));
    }
  });

  after(async () => {
    if (!workDir) return;
    await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    assert.equal(fs.existsSync(workDir), false, 'temporary media was removed');
  });

  test('the generated sources look like the material they imitate', () => {
    assert.equal(probed.get('ntsc.dv').video.fieldOrder, 'bff');
    assert.equal(probed.get('ntsc.dv').video.standard, 'NTSC');
    assert.equal(probed.get('xvid mp3 [ñ].avi').video.codecLabel, 'Xvid');
    assert.equal(probed.get('telecine.mpg').video.fieldOrder, 'tff');
    assert.equal(probed.get('hevc10.mkv').video.bitDepth, 10);
    assert.equal(probed.get('vfr.mp4').video.vfr, true);
    assert.deepEqual(probed.get('pal anamorphic.vob').video.sar, { num: 64, den: 45 });
    assert.equal(probed.get('surround 5.1.mkv').audio[0].channels, 6);
    assert.equal(probed.get('hdr10 🎬.mp4').video.isHDR, true);
    assert.equal(probed.get('no audio.mp4').audio.length, 0);
    assert.equal(probed.get('dropped frames.avi').video.vfr, false);
    assert.equal(probed.get('rgb animation.mov').video.pixFmt, 'rgb24');
    const delayed = probed.get('delayed audio.mkv').audio[0];
    assert.ok(delayed.startTime >= 0.5, `audio starts at ${delayed.startTime}`);
    assert.ok(delayed.startTime + delayed.duration <= probed.get('delayed audio.mkv').duration + 0.01);
  });

  test('software encoders pass the real encoder probe, in 10-bit too where they can', async () => {
    for (const name of ['libx264', 'libx265', 'libvpx-vp9']) {
      const result = await ffmpeg(encoderTestArgs(name));
      assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    }
    for (const name of ['libx265', 'libvpx-vp9']) {
      const result = await ffmpeg(encoderTestArgs(name, { tenBit: true }));
      assert.equal(result.code, 0, `${name} 10-bit: ${result.stderr}`);
    }
  });

  test('a Media Foundation encoder, when this PC has one, writes MP4 and is kept away from MKV', async (t) => {
    const probeResult = await ffmpeg(encoderTestArgs('h264_mf'));
    if (probeResult.code !== 0) {
      t.skip('this PC has no working Media Foundation H.264 encoder');
      return;
    }
    const media = probed.get('hd5994.mp4');
    const mkvPlan = buildPlan({ media, preset: { ...FLOWAIR, container: 'mkv' }, encoder: 'h264_mf', outputPath: 'unused' });
    assert.equal(mkvPlan.summary.video.encoder, 'libx264');
    const outputPath = partialPathFor(path.join(workDir, 'out', 'media foundation.mp4'));
    const plan = buildPlan({ media, preset: FLOWAIR, encoder: 'h264_mf', outputPath });
    assert.equal(plan.summary.video.encoder, 'h264_mf');
    const result = await ffmpeg(plan.args);
    assert.equal(result.code, 0, result.stderr);
    const output = await probe(outputPath);
    const check = checkOutput(output, { expectedDuration: plan.expectedDuration, expectVideo: true, expectAudio: true, sourceDurationReliable: true });
    assert.equal(check.ok, true, check.problems.join(','));
    assert.equal(output.video.profile, 'High');
  });

  for (const source of SOURCES) {
    test(`FlowAir 1080p from ${source.name}`, async () => {
      const media = probed.get(source.name);
      const { output, check, plan } = await convert(media, FLOWAIR);
      assert.deepEqual(check.problems, []);
      assert.equal(check.ok, true);
      const video = output.video;
      assert.equal(video.codec, 'h264');
      assert.equal(video.width, 1920);
      assert.equal(video.height, 1080);
      assert.deepEqual(video.sar, { num: 1, den: 1 });
      assert.equal(video.pixFmt, 'yuv420p');
      assert.equal(video.colorRange, 'tv');
      assert.equal(video.colorSpace, 'bt709');
      assert.equal(video.colorPrimaries, 'bt709');
      assert.equal(video.colorTransfer, 'bt709');
      assert.equal(video.fieldOrder, 'progressive');
      assert.equal(video.vfr, false);
      assertDuration(output, plan.expectedDuration);
      if (source.noAudio) {
        assert.equal(output.audio.length, 0);
      } else {
        assert.equal(output.audio.length, 1);
        assert.equal(output.audio[0].codec, 'aac');
        assert.equal(output.audio[0].sampleRate, 48000);
        assert.equal(output.audio[0].channels, 2);
      }
      if (source.interlaced) assert.equal(plan.summary.video.interlace, 'deinterlace');
      if (media.video.isSD) assert.equal(plan.summary.video.colorConvert, true);
    });
  }

  test('MP3 320 from every source with audio', async () => {
    for (const source of SOURCES.filter((item) => !item.noAudio)) {
      const media = probed.get(source.name);
      const { output, check, plan } = await convert(media, MP3);
      assert.deepEqual(check.problems, [], source.name);
      assert.equal(output.video, null, source.name);
      assert.equal(output.audio[0].codec, 'mp3', source.name);
      assert.equal(output.audio[0].sampleRate, 44100, source.name);
      assert.equal(output.audio[0].channels, 2, source.name);
      assertDuration(output, plan.expectedDuration);
    }
  });

  test('analysis finds the telecine and inverse telecine restores 23.976 progressive frames', async () => {
    const media = probed.get('telecine.mpg');
    const result = await ffmpeg(idetArgs(media.path, media, { frames: 600 }));
    assert.equal(result.code, 0, result.stderr);
    const analysis = parseIdet(result.stderrLines);
    assert.equal(analysis.verdict, 'tff');
    assert.equal(analysis.telecine, true);
    const { output, check, plan } = await convert(media, FLOWAIR, { analysis });
    assert.equal(plan.summary.video.interlace, 'ivtc');
    assert.equal(check.ok, true, check.problems.join(','));
    assert.deepEqual(output.video.fps, { num: 24000, den: 1001 });
    assert.equal(output.video.fieldOrder, 'progressive');
  });

  test('analysis calls interlaced DV bottom field first', async () => {
    const media = probed.get('ntsc.dv');
    const result = await ffmpeg(idetArgs(media.path, media));
    const analysis = parseIdet(result.stderrLines);
    assert.equal(analysis.verdict, 'bff');
    assert.equal(analysis.telecine, false);
  });

  test('two-pass loudness normalization reaches EBU R128', async () => {
    const media = probed.get('dvd.mpg');
    const preset = { ...FLOWAIR, audio: { ...FLOWAIR.audio, loudness: 'ebu' } };
    const first = buildPlan({ media, preset, outputPath: 'unused' });
    const scans = first.steps.filter((step) => step.type === 'loudness-scan');
    assert.equal(scans.length, 1);
    const loudness = {};
    for (const step of scans) {
      const parser = createProgressParser();
      let reports = 0;
      const result = await ffmpeg(loudnessScanArgs({ media, preset, streamIndex: step.streamIndex }), {
        onStdoutLine: (line) => {
          if (parser.push(line)) reports += 1;
        }
      });
      assert.equal(result.code, 0, result.stderr);
      assert.ok(reports > 0, 'the scan reports progress for the stall watchdog');
      loudness[step.streamIndex] = parseLoudnorm(result.stderrLines);
      assert.ok(loudness[step.streamIndex] && !loudness[step.streamIndex].silent);
    }
    const { output, check, plan } = await convert(media, preset, { loudness });
    assert.equal(check.ok, true);
    assert.equal(plan.summary.audio[0].twoPassLoudness, true);
    const measure = await ffmpeg(loudnessScanArgs({ media: output, preset, streamIndex: output.audio[0].index }));
    const measured = parseLoudnorm(measure.stderrLines);
    assert.ok(Math.abs(measured.inputI + 23) <= 1.5, `integrated loudness ${measured.inputI}`);
  });

  test('a trimmed conversion lasts exactly the selected range', async () => {
    const media = probed.get('hd5994.mp4');
    const { output, check } = await convert(media, FLOWAIR, { trim: { start: 0.5, end: 1.5 } });
    assert.equal(check.ok, true, check.problems.join(','));
    assertDuration(output, 1);
  });

  test('an archive remux keeps DV and PCM untouched in MKV', async () => {
    const media = probed.get('ntsc.dv');
    const preset = { ...FLOWAIR, id: 'remux', container: 'mkv', video: { ...FLOWAIR.video, mode: 'copy' }, audio: { ...FLOWAIR.audio, mode: 'copy', tracks: 'all' } };
    const { output, check } = await convert(media, preset);
    assert.equal(check.ok, true, check.problems.join(','));
    assert.equal(output.video.codec, 'dvvideo');
    assert.deepEqual(output.video.sar, { num: 8, den: 9 });
    assert.equal(output.audio[0].codec, 'pcm_s16le');
  });

  test('an Xvid copy into MP4 unpacks B-frames and stays valid', async () => {
    const media = probed.get('xvid mp3 [ñ].avi');
    const preset = { ...FLOWAIR, id: 'copy', video: { ...FLOWAIR.video, mode: 'copy' }, audio: { ...FLOWAIR.audio, mode: 'copy' } };
    const { output, check, plan } = await convert(media, preset);
    assert.ok(plan.args.includes('mpeg4_unpack_bframes'));
    assert.equal(check.ok, true, check.problems.join(','));
    assert.equal(output.video.codec, 'mpeg4');
    assert.equal(output.audio[0].codec, 'mp3');
  });

  test('colors survive SD to HD conversion and RGB sources use the BT.709 matrix', async () => {
    const sd = await generate('solid sd.mpg', [
      '-f', 'lavfi', '-i', 'color=c=0xB43C28:size=720x480:rate=30000/1001', '-t', '1',
      '-vf', 'scale=out_color_matrix=bt601:out_range=tv,format=yuv420p',
      '-c:v', 'mpeg2video', '-q:v', '2', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-colorspace', 'smpte170m', '-f', 'vob'
    ]);
    const hd = await convert(sd, FLOWAIR);
    assert.equal(hd.check.ok, true, hd.check.problems.join(','));
    assertColor(await centerPixel(hd.outputPath, 'bt709'), [180, 60, 40], 4, 'SD to HD');
    const rgb = await convert(probed.get('rgb animation.mov'), FLOWAIR);
    assert.equal(rgb.output.video.colorSpace, 'bt709');
    assertColor(await centerPixel(rgb.outputPath, 'bt709'), [48, 192, 64], 7, 'RGB to HD');
    const keep = await convert(probed.get('rgb animation.mov'), { ...FLOWAIR, id: 'rgb-keep', picture: { ...FLOWAIR.picture, resolution: 'keep' } });
    assert.equal(keep.output.video.width, 1280);
    assertColor(await centerPixel(keep.outputPath, 'bt709'), [48, 192, 64], 7, 'RGB kept at 720p');
  });

  test('Opus keeps a quad layout and a 7.1 source becomes 5.1 AC-3', async () => {
    const quad = await generate('quad.wav', ['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=1', '-filter_complex', '[0:a]pan=quad|c0=c0|c1=0.5*c0|c2=0.25*c0|c3=0.125*c0[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-f', 'wav']);
    const opus = { ...MP3, id: 'opus-keep', container: 'opus', audio: { ...MP3.audio, codec: 'opus', bitrate: 256, sampleRate: 48000, channels: 'keep' } };
    const opusResult = await convert(quad, opus);
    assert.equal(opusResult.check.ok, true, opusResult.check.problems.join(','));
    assert.equal(opusResult.output.audio[0].channels, 4);
    const wide = await generate('seven one.wav', ['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=1', '-filter_complex', '[0:a]pan=7.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0|c6=c0|c7=c0[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-f', 'wav']);
    const ac3 = { ...FLOWAIR, id: 'ac3-keep', container: 'mkv', video: { ...FLOWAIR.video, mode: 'none' }, audio: { ...FLOWAIR.audio, codec: 'ac3', bitrate: 448, channels: 'keep' } };
    const ac3Result = await convert(wide, ac3);
    assert.equal(ac3Result.check.ok, true, ac3Result.check.problems.join(','));
    assert.equal(ac3Result.output.audio[0].channels, 6);
  });

  test('two-pass bitrate encoding works with a non-ASCII pass log folder', async () => {
    const media = probed.get('dvd.mpg');
    const preset = { ...FLOWAIR, id: 'two-pass', video: { ...FLOWAIR.video, rateControl: 'bitrate', bitrate: 2500, twoPass: true } };
    const logFolder = path.join(workDir, 'pass ñ 🎬');
    fs.mkdirSync(logFolder);
    const passLogFile = path.join(logFolder, 'job');
    const outputPath = partialPathFor(path.join(workDir, 'out', 'two pass.mp4'));
    const first = buildPlan({ media, preset, encoder: 'libx264', outputPath, pass: 1, passLogFile });
    assert.deepEqual(first.steps, [{ type: 'pass', pass: 1 }, { type: 'encode', pass: 2 }]);
    const passOne = await ffmpeg(first.args);
    assert.equal(passOne.code, 0, passOne.stderr);
    assert.deepEqual(fs.readdirSync(logFolder).sort(), ['job-0.log', 'job-0.log.mbtree']);
    const second = buildPlan({ media, preset, encoder: 'libx264', outputPath, pass: 2, passLogFile });
    const passTwo = await ffmpeg(second.args);
    assert.equal(passTwo.code, 0, passTwo.stderr);
    const output = await probe(outputPath);
    const check = checkOutput(output, { expectedDuration: second.expectedDuration, expectVideo: true, expectAudio: true, sourceDurationReliable: media.durationReliable });
    assert.equal(check.ok, true, check.problems.join(','));
  });

  test('the next output name never overwrites the file just written', async () => {
    const media = probed.get('no audio.mp4');
    const { outputPath } = await convert(media, FLOWAIR);
    const finalPath = outputPath.slice(0, -'.partial'.length);
    fs.renameSync(outputPath, finalPath);
    const next = outputPathFor({ inputPath: media.path, folder: path.dirname(finalPath), template: path.basename(finalPath, '.mp4'), extension: 'mp4' });
    assert.equal(path.basename(next.path), `${path.basename(finalPath, '.mp4')} (2).mp4`);
  });
});
