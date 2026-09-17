const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../src/main/converter/plan');
const { parseProbe } = require('../src/main/converter/media');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');
const OUT = 'C:\\Out\\result.mp4.partial';

function media(name, patch = null) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
  if (patch) patch(data);
  return parseProbe(data, { path: data.format.filename });
}

function text(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function basePreset() {
  return {
    id: 'test',
    name: 'Test',
    builtIn: false,
    version: 1,
    container: 'mp4',
    video: {
      mode: 'encode',
      codec: 'h264',
      encoder: 'auto',
      rateControl: 'quality',
      quality: 18,
      bitrate: 8000,
      bitrateMode: 'vbr',
      maxrate: 0,
      bufsize: 0,
      twoPass: false,
      speed: 'balanced',
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
}

function preset(patch = {}) {
  const base = basePreset();
  return {
    ...base,
    ...patch,
    video: { ...base.video, ...(patch.video || {}) },
    picture: { ...base.picture, ...(patch.picture || {}) },
    audio: { ...base.audio, ...(patch.audio || {}) },
    output: { ...base.output, ...(patch.output || {}) }
  };
}

const MP3 = { container: 'mp3', video: { mode: 'none' }, audio: { codec: 'mp3', bitrate: 320, sampleRate: 44100 } };

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesOf(args, flag) {
  return args.flatMap((item, index) => (item === flag ? [args[index + 1]] : []));
}

describe('containers', () => {
  test('extensions and muxers', () => {
    assert.equal(plan.outputExtension(preset()), 'mp4');
    assert.equal(plan.outputExtension(preset({ container: 'mkv', video: { mode: 'none' } })), 'mka');
    assert.equal(plan.outputExtension(preset({ container: 'mkv' })), 'mkv');
    assert.equal(plan.muxerFor(preset({ container: 'mkv' })), 'matroska');
    assert.equal(plan.muxerFor(preset({ container: 'm4a' })), 'ipod');
    assert.equal(plan.muxerFor(preset({ container: 'opus' })), 'opus');
    assert.equal(plan.muxerFor(preset({ container: 'wav' })), 'wav');
    assert.equal(plan.muxerFor(preset({ container: 'nope' })), null);
  });

  test('audio-only outputs', () => {
    assert.equal(plan.isAudioOnlyOutput(preset(MP3)), true);
    assert.equal(plan.isAudioOnlyOutput(preset({ container: 'mkv', video: { mode: 'none' } })), true);
    assert.equal(plan.isAudioOnlyOutput(preset()), false);
  });

  test('copy compatibility tables', () => {
    assert.equal(plan.canCopyVideo('mp4', { codec: 'mpeg4' }), true);
    assert.equal(plan.canCopyVideo('mp4', { codec: 'dvvideo' }), false);
    assert.equal(plan.canCopyVideo('mkv', { codec: 'dvvideo' }), true);
    assert.equal(plan.canCopyVideo('webm', { codec: 'h264' }), false);
    assert.equal(plan.canCopyAudio('mp4', { codec: 'pcm_s16le' }), false);
    assert.equal(plan.canCopyAudio('mov', { codec: 'pcm_s16le' }), true);
    assert.equal(plan.canCopyAudio('m4a', { codec: 'mp3' }), false);
    assert.equal(plan.canCopyAudio('mkv', { codec: 'pcm_dvd' }), false);
    assert.equal(plan.canCopyAudio('mkv', { codec: 'mp2' }), true);
  });

  test('subtitle codecs per container', () => {
    const srt = { codec: 'subrip', textBased: true };
    const movText = { codec: 'mov_text', textBased: true };
    const pgs = { codec: 'hdmv_pgs_subtitle', textBased: false };
    assert.equal(plan.subtitleCodecFor('mp4', srt), 'mov_text');
    assert.equal(plan.subtitleCodecFor('mp4', movText), 'copy');
    assert.equal(plan.subtitleCodecFor('mp4', pgs), null);
    assert.equal(plan.subtitleCodecFor('mkv', movText), 'srt');
    assert.equal(plan.subtitleCodecFor('mkv', pgs), 'copy');
    assert.equal(plan.subtitleCodecFor('webm', srt), 'webvtt');
    assert.equal(plan.subtitleCodecFor('mp3', srt), null);
  });
});

describe('buildPlan input and output arguments', () => {
  test('FlowAir style plan for NTSC DV', () => {
    const result = plan.buildPlan({ media: media('ntsc-dv'), preset: preset(), encoder: 'libx264', outputPath: OUT });
    assert.deepEqual(result.errors, []);
    const { args } = result;
    assert.deepEqual(args.slice(0, 8), ['-hide_banner', '-nostdin', '-y', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1']);
    assert.equal(valueOf(args, '-fflags'), '+genpts');
    assert.equal(valueOf(args, '-i'), 'file:C:\\Media\\ntsc.dv');
    assert.deepEqual(valuesOf(args, '-map'), ['0:0', '0:1']);
    assert.equal(valueOf(args, '-map_metadata'), '0');
    assert.equal(valueOf(args, '-map_chapters'), '0');
    assert.ok(args.includes('-dn'));
    assert.equal(valueOf(args, '-max_muxing_queue_size'), '9999');
    assert.equal(valueOf(args, '-avoid_negative_ts'), 'make_zero');
    assert.equal(valueOf(args, '-filter:v:0'), 'bwdif=mode=send_frame:parity=bff:deint=all,scale=1440:1080:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709,pad=1920:1080:240:0:black,setsar=1,fps=30000/1001,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709');
    assert.equal(valueOf(args, '-fps_mode:v:0'), 'cfr');
    assert.equal(valueOf(args, '-c:v'), 'libx264');
    assert.equal(valueOf(args, '-crf'), '18');
    assert.equal(valueOf(args, '-profile:v'), 'high');
    assert.equal(valueOf(args, '-g'), '60');
    assert.equal(valueOf(args, '-colorspace'), 'bt709');
    assert.equal(valueOf(args, '-color_trc'), 'bt709');
    assert.equal(valueOf(args, '-color_primaries'), 'bt709');
    assert.equal(valueOf(args, '-color_range'), 'tv');
    assert.equal(valueOf(args, '-filter:a:0'), 'aresample=48000');
    assert.equal(valueOf(args, '-c:a:0'), 'aac');
    assert.equal(valueOf(args, '-b:a:0'), '192k');
    assert.equal(valueOf(args, '-ar:a:0'), '48000');
    assert.equal(args.includes('-ac:a:0'), false);
    assert.ok(args.includes('-sn'));
    assert.equal(valueOf(args, '-movflags'), '+faststart');
    assert.deepEqual(args.slice(-3), ['-f', 'mp4', `file:${OUT}`]);
    assert.equal(result.expectedDuration, 2.969633);
    assert.deepEqual(result.steps, [{ type: 'encode', pass: null }]);
    assert.deepEqual(result.expect, { video: true, audio: true, width: 1920, height: 1080, fps: { num: 30000, den: 1001 }, progressive: true });
  });

  test('the output muxer is explicit even for a .partial path and can be overridden', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), outputPath: OUT, format: 'mov' });
    assert.deepEqual(result.args.slice(-3), ['-f', 'mov', `file:${OUT}`]);
  });

  test('program streams get a deeper probe', () => {
    const { args } = plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(), outputPath: OUT });
    assert.equal(valueOf(args, '-analyzeduration'), '100M');
    assert.equal(valueOf(args, '-probesize'), '100M');
    assert.ok(args.indexOf('-probesize') < args.indexOf('-i'));
    assert.deepEqual(valuesOf(args, '-map'), ['0:1', '0:2']);
  });

  test('modern containers skip genpts and negative timestamp fixes', () => {
    const { args } = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT });
    assert.equal(args.includes('-fflags'), false);
    assert.equal(args.includes('-avoid_negative_ts'), false);
    assert.equal(args.includes('-analyzeduration'), false);
  });

  test('AVI audio gets the sync repair', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), outputPath: OUT });
    assert.equal(valueOf(args, '-filter:a:0'), 'aresample=48000:async=1:min_hard_comp=0.100000:first_pts=0');
  });

  test('without the default encoder name the software encoder is used', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), outputPath: OUT });
    assert.equal(result.summary.video.encoder, 'libx264');
  });

  test('an encoder for another codec is replaced and reported', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), encoder: 'hevc_qsv', outputPath: OUT });
    assert.equal(result.summary.video.encoder, 'libx264');
    assert.ok(result.warnings.includes('encoder-mismatch'));
  });

  test('Media Foundation asked for MKV falls back to software and says so', () => {
    const mkv = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ container: 'mkv' }), encoder: 'h264_mf', outputPath: OUT });
    assert.equal(mkv.summary.video.encoder, 'libx264');
    assert.ok(mkv.warnings.includes('encoder-container'));
    assert.match(valueOf(mkv.args, '-filter:v:0'), /format=yuv420p/);
    const mp4 = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), encoder: 'h264_mf', outputPath: OUT });
    assert.equal(mp4.summary.video.encoder, 'h264_mf');
    assert.equal(mp4.warnings.includes('encoder-container'), false);
  });

  test('faststart can be turned off', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ output: { faststart: false } }), outputPath: OUT });
    assert.equal(args.includes('-movflags'), false);
  });

  test('HEVC in MP4 is tagged hvc1', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ video: { codec: 'hevc', profile: 'auto' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-tag:v:0'), 'hvc1');
    assert.equal(valueOf(args, '-c:v'), 'libx265');
  });

  test('HEVC 10-bit sources stay 10-bit on x265', () => {
    const result = plan.buildPlan({ media: media('hevc10-mkv'), preset: preset({ container: 'mkv', video: { codec: 'hevc', profile: 'auto' } }), outputPath: OUT });
    assert.equal(result.summary.video.pixFmt, 'yuv420p10le');
    assert.equal(valueOf(result.args, '-profile:v'), 'main10');
    assert.equal(result.args.includes('-tag:v:0'), false);
  });

  test('10-bit sources become 8-bit for H.264', () => {
    const result = plan.buildPlan({ media: media('hevc10-mkv'), preset: preset(), outputPath: OUT });
    assert.equal(result.summary.video.pixFmt, 'yuv420p');
    assert.equal(result.summary.video.bitDepth, 8);
  });

  test('HDR sources are tone mapped for H.264', () => {
    const result = plan.buildPlan({ media: media('hdr10-mp4'), preset: preset(), outputPath: OUT });
    assert.equal(result.summary.video.tonemap, true);
    assert.match(valueOf(result.args, '-filter:v:0'), /tonemap=tonemap=hable/);
  });

  test('Quick Sync uses nv12 and a VFR source drops B-frames with passthrough timing', () => {
    const result = plan.buildPlan({ media: media('vfr-mp4'), preset: preset({ picture: { cfr: false } }), encoder: 'h264_qsv', outputPath: OUT });
    const { args } = result;
    assert.match(valueOf(args, '-filter:v:0'), /format=nv12/);
    assert.equal(valueOf(args, '-bf'), '0');
    assert.equal(valueOf(args, '-fps_mode:v:0'), 'passthrough');
    assert.equal(result.summary.video.constantRate, false);
  });

  test('a VFR source made constant uses the cfr timing mode and keeps B-frames', () => {
    const { args } = plan.buildPlan({ media: media('vfr-mp4'), preset: preset(), encoder: 'h264_nvenc', outputPath: OUT });
    assert.equal(valueOf(args, '-fps_mode:v:0'), 'cfr');
    assert.equal(args.includes('-bf'), false);
    assert.match(valueOf(args, '-filter:v:0'), /fps=24000\/1001/);
  });

  test('keyframe interval follows the output rate after field rate deinterlacing', () => {
    const { args } = plan.buildPlan({ media: media('ntsc-dv'), preset: preset({ picture: { deinterlaceRate: 'field' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-g'), '120');
    assert.match(valueOf(args, '-filter:v:0'), /send_field/);
  });

  test('inverse telecine from analysis', () => {
    const result = plan.buildPlan({ media: media('telecine-mpeg2'), preset: preset(), outputPath: OUT, analysis: { verdict: 'tff', telecine: true } });
    assert.equal(result.summary.video.interlace, 'ivtc');
    assert.equal(result.summary.video.fpsLabel, '23.976');
    assert.equal(valueOf(result.args, '-g'), '48');
    assert.equal(result.expectedDuration, 6.006);
  });
});

describe('buildPlan audio', () => {
  test('MP3 CBR from a video file', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(MP3), outputPath: 'C:\\Out\\a.mp3.partial' });
    const { args } = result;
    assert.ok(args.includes('-vn'));
    assert.equal(args.includes('-filter:v:0'), false);
    assert.deepEqual(valuesOf(args, '-map'), ['0:1']);
    assert.equal(valueOf(args, '-c:a:0'), 'libmp3lame');
    assert.equal(valueOf(args, '-b:a:0'), '320k');
    assert.equal(valueOf(args, '-ar:a:0'), '44100');
    assert.equal(valueOf(args, '-id3v2_version'), '3');
    assert.equal(args.includes('-movflags'), false);
    assert.equal(valueOf(args, '-f'), 'mp3');
    assert.equal(result.expectedDuration, 3.056327);
    assert.deepEqual(result.expect, { video: false, audio: true, width: null, height: null, fps: null, progressive: null });
  });

  test('MP3 VBR uses the LAME quality scale', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ ...MP3, audio: { ...MP3.audio, vbr: 1 } }), outputPath: OUT });
    assert.equal(valueOf(args, '-q:a:0'), '0');
    assert.equal(args.includes('-b:a:0'), false);
  });

  test('MP3 caps 5.1 at stereo and 96 kHz at 48 kHz', () => {
    const item = media('surround-mkv', (data) => {
      data.streams[1].sample_rate = '96000';
    });
    const { args } = plan.buildPlan({ media: item, preset: preset({ ...MP3, audio: { ...MP3.audio, channels: 'keep', sampleRate: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-ac:a:0'), '2');
    assert.equal(valueOf(args, '-ar:a:0'), '48000');
  });

  test('AC-3 keeps 5.1 and snaps the bitrate', () => {
    const result = plan.buildPlan({ media: media('surround-mkv'), preset: preset({ container: 'mkv', audio: { codec: 'ac3', bitrate: 400, channels: 'keep' } }), outputPath: OUT });
    const { args } = result;
    assert.equal(valueOf(args, '-c:a:0'), 'ac3');
    assert.equal(valueOf(args, '-b:a:0'), '384k');
    assert.equal(args.includes('-ac:a:0'), false);
    assert.equal(result.summary.audio[0].channels, 6);
  });

  test('-ac is only passed when the channel count changes, so a kept layout is never remixed', () => {
    const keep = plan.buildPlan({ media: media('surround-mkv'), preset: preset({ container: 'mkv', audio: { channels: 'keep' } }), outputPath: OUT });
    assert.equal(keep.args.includes('-ac:a:0'), false);
    const stereo = plan.buildPlan({ media: media('surround-mkv'), preset: preset({ container: 'mkv' }), outputPath: OUT });
    assert.equal(valueOf(stereo.args, '-ac:a:0'), '2');
    const upmix = plan.buildPlan({ media: media('xvid-avi'), preset: preset(), outputPath: OUT });
    assert.equal(valueOf(upmix.args, '-ac:a:0'), '2');
    const sevenOne = media('surround-mkv', (data) => {
      data.streams[1].channels = 8;
      data.streams[1].channel_layout = '7.1';
    });
    const ac3 = plan.buildPlan({ media: sevenOne, preset: preset({ container: 'mkv', audio: { codec: 'ac3', channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(ac3.args, '-ac:a:0'), '6');
  });

  test('a source with an unknown channel count still gets an explicit one', () => {
    const item = media('xvid-avi', (data) => {
      delete data.streams[1].channels;
      delete data.streams[1].channel_layout;
    });
    const { args } = plan.buildPlan({ media: item, preset: preset({ audio: { channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-ac:a:0'), '2');
  });

  test('Opus multichannel pins the layout with aformat and leaves -ac out', () => {
    const item = media('surround-mkv', (data) => {
      data.streams[1].channels = 4;
      data.streams[1].channel_layout = '4.0';
    });
    const { args } = plan.buildPlan({ media: item, preset: preset({ container: 'opus', video: { mode: 'none' }, audio: { codec: 'opus', channels: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-filter:a:0'), 'aresample=48000,aformat=channel_layouts=quad');
    assert.equal(args.includes('-ac:a:0'), false);
  });

  test('loudness downmix pins stereo itself', () => {
    const { args } = plan.buildPlan({ media: media('surround-mkv'), preset: preset({ container: 'mkv', audio: { loudness: 'ebu' } }), outputPath: OUT });
    assert.match(valueOf(args, '-filter:a:0'), /^aformat=channel_layouts=stereo,loudnorm=/);
    assert.equal(args.includes('-ac:a:0'), false);
  });

  test('WAV switches to RF64 only when the file can pass the RIFF size limit', () => {
    const wav = { container: 'wav', video: { mode: 'none' }, audio: { codec: 'pcm' } };
    const short = plan.buildPlan({ media: media('ntsc-dv'), preset: preset(wav), outputPath: OUT });
    assert.equal(short.args.includes('-rf64'), false);
    const long = media('ntsc-dv', (data) => {
      data.format.duration = '43200.000000';
      for (const stream of data.streams) stream.duration = '43200.000000';
      delete data.streams[0].nb_frames;
    });
    const big = plan.buildPlan({ media: long, preset: preset(wav), outputPath: OUT });
    assert.equal(valueOf(big.args, '-rf64'), 'auto');
    assert.ok(big.args.indexOf('-rf64') < big.args.indexOf('-f'));
    const unknown = media('truncated-avi');
    assert.equal(unknown.durationReliable, false);
    const guessed = plan.buildPlan({ media: unknown, preset: preset(wav), outputPath: OUT });
    assert.equal(valueOf(guessed.args, '-rf64'), 'auto');
    const mp3 = plan.buildPlan({ media: long, preset: preset(MP3), outputPath: OUT });
    assert.equal(mp3.args.includes('-rf64'), false);
  });

  test('Opus is 48 kHz with a libopus friendly layout', () => {
    const { args } = plan.buildPlan({ media: media('surround-mkv'), preset: preset({ container: 'opus', video: { mode: 'none' }, audio: { codec: 'opus', bitrate: 256, channels: 'keep', sampleRate: 'keep' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-c:a:0'), 'libopus');
    assert.equal(valueOf(args, '-ar:a:0'), '48000');
    assert.equal(valueOf(args, '-filter:a:0'), 'aresample=48000,aformat=channel_layouts=5.1');
    assert.equal(valueOf(args, '-vbr:a:0'), 'on');
    assert.equal(valueOf(args, '-f'), 'opus');
  });

  test('WAV picks 16-bit PCM and has no bitrate', () => {
    const { args } = plan.buildPlan({ media: media('ntsc-dv'), preset: preset({ container: 'wav', video: { mode: 'none' }, audio: { codec: 'pcm' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-c:a:0'), 'pcm_s16le');
    assert.equal(args.includes('-b:a:0'), false);
    assert.equal(valueOf(args, '-f'), 'wav');
  });

  test('WAV stays 16-bit PCM even from a 24-bit source, as the preset promises', () => {
    const item = media('ntsc-dv', (data) => {
      data.streams[1].bits_per_raw_sample = '24';
    });
    const { args } = plan.buildPlan({ media: item, preset: preset({ container: 'wav', video: { mode: 'none' }, audio: { codec: 'pcm' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-c:a:0'), 'pcm_s16le');
  });

  test('all audio tracks are mapped and encoded one by one', () => {
    const { args } = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset({ container: 'mkv', audio: { tracks: 'all' } }), outputPath: OUT });
    assert.deepEqual(valuesOf(args, '-map'), ['0:0', '0:1', '0:2']);
    assert.equal(valueOf(args, '-c:a:1'), 'aac');
    assert.equal(valueOf(args, '-ar:a:1'), '48000');
  });

  test('first track prefers the default flagged one', () => {
    const item = media('multi-track-mkv', (data) => {
      data.streams[1].disposition.default = 0;
      data.streams[2].disposition.default = 1;
    });
    const { args } = plan.buildPlan({ media: item, preset: preset(), outputPath: OUT });
    assert.deepEqual(valuesOf(args, '-map'), ['0:0', '0:2']);
  });

  test('audio-only containers use a single track even when all are asked for', () => {
    const { args } = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset({ ...MP3, audio: { ...MP3.audio, tracks: 'all' } }), outputPath: OUT });
    assert.deepEqual(valuesOf(args, '-map'), ['0:1']);
  });

  test('audio copy of every track into MKA', () => {
    const result = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset({ container: 'mkv', video: { mode: 'none' }, audio: { mode: 'copy', tracks: 'all' } }), outputPath: OUT });
    assert.deepEqual(valuesOf(result.args, '-map'), ['0:1', '0:2']);
    assert.deepEqual(valuesOf(result.args, '-c:a:0'), ['copy']);
    assert.deepEqual(valuesOf(result.args, '-c:a:1'), ['copy']);
    assert.equal(result.args.includes('-filter:a:0'), false);
    assert.equal(valueOf(result.args, '-f'), 'matroska');
  });

  test('PCM that cannot be copied into MP4 is re-encoded with the preset codec', () => {
    const result = plan.buildPlan({ media: media('ntsc-dv'), preset: preset({ audio: { mode: 'copy' } }), outputPath: OUT });
    assert.deepEqual(result.errors, []);
    assert.equal(valueOf(result.args, '-c:a:0'), 'aac');
    assert.ok(result.warnings.includes('audio-reencoded'));
    assert.equal(result.summary.audio[0].reencoded, true);
  });

  test('audio none drops audio', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ audio: { mode: 'none' } }), outputPath: OUT });
    assert.ok(result.args.includes('-an'));
    assert.deepEqual(valuesOf(result.args, '-map'), ['0:0']);
    assert.equal(result.expect.audio, false);
  });

  test('a video file without audio still converts and warns', () => {
    const result = plan.buildPlan({ media: media('no-audio-mp4'), preset: preset(), outputPath: OUT });
    assert.deepEqual(result.errors, []);
    assert.ok(result.warnings.includes('no-audio'));
    assert.ok(result.args.includes('-an'));
    assert.equal(result.expect.audio, false);
  });

  test('volume is applied when loudness is off', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ audio: { volumeDb: 3 } }), outputPath: OUT });
    assert.match(valueOf(args, '-filter:a:0'), /^volume=3dB,aresample=48000/);
  });
});

describe('loudness normalization', () => {
  test('the plan asks for a scan of each mapped track', () => {
    const result = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset({ container: 'mkv', audio: { loudness: 'ebu', tracks: 'all' } }), outputPath: OUT });
    assert.deepEqual(result.steps, [
      { type: 'loudness-scan', streamIndex: 1, target: 'ebu' },
      { type: 'loudness-scan', streamIndex: 2, target: 'ebu' },
      { type: 'encode', pass: null }
    ]);
    assert.match(valueOf(result.args, '-filter:a:0'), /loudnorm=I=-23:TP=-2:LRA=11:print_format=none/);
  });

  test('measurements switch to linear two-pass mode after the mono to stereo upmix', () => {
    const measured = plan.parseLoudnorm(text('loudnorm.txt'));
    const result = plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset({ audio: { loudness: 'atsc' } }), outputPath: OUT, loudness: { 2: measured } });
    assert.deepEqual(result.steps, [{ type: 'encode', pass: null }]);
    assert.equal(valueOf(result.args, '-filter:a:0'), 'aformat=channel_layouts=stereo,loudnorm=I=-24:TP=-2:LRA=11:measured_I=-41.61:measured_TP=-31.04:measured_LRA=2.8:measured_thresh=-53.86:offset=-0.11:linear=true:print_format=none,aresample=48000');
    assert.equal(result.summary.audio[0].twoPassLoudness, true);
  });

  test('a silent track is not normalized', () => {
    const silent = plan.parseLoudnorm(text('loudnorm-silent.txt'));
    const result = plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset({ audio: { loudness: 'ebu' } }), outputPath: OUT, loudness: { 2: silent } });
    assert.equal(valueOf(result.args, '-filter:a:0'), 'aresample=48000');
    assert.equal(result.summary.audio[0].loudness, 'off');
  });

  test('loudnessScanArgs measures one stream with the JSON report and the same downmix', () => {
    const args = plan.loudnessScanArgs({ media: media('surround-mkv'), preset: preset({ audio: { loudness: 'streaming' } }), streamIndex: 1, trim: { start: 1, end: 2 } });
    assert.equal(valueOf(args, '-loglevel'), 'info');
    assert.equal(valueOf(args, '-progress'), 'pipe:1');
    assert.equal(valueOf(args, '-ss'), '1');
    assert.equal(valueOf(args, '-t'), '1');
    assert.equal(valueOf(args, '-map'), '0:1');
    assert.equal(valueOf(args, '-filter:a:0'), 'aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1:LRA=11:print_format=json');
    assert.deepEqual(args.slice(-3), ['-f', 'null', 'NUL']);
    for (const flag of ['-vn', '-sn', '-dn']) assert.ok(args.includes(flag));
  });

  test('loudnessScanArgs without audio returns null', () => {
    assert.equal(plan.loudnessScanArgs({ media: media('no-audio-mp4'), preset: preset({ audio: { loudness: 'ebu' } }), streamIndex: 1 }), null);
  });

  test('parseLoudnorm reads real ffmpeg output', () => {
    assert.deepEqual(plan.parseLoudnorm(text('loudnorm.txt')), { inputI: -41.61, inputTp: -31.04, inputLra: 2.8, inputThresh: -53.86, targetOffset: -0.11, silent: false });
  });

  test('parseLoudnorm flags silence and handles missing reports', () => {
    assert.equal(plan.parseLoudnorm(text('loudnorm-silent.txt')).silent, true);
    assert.equal(plan.parseLoudnorm(['nothing here']), null);
    assert.equal(plan.parseLoudnorm(['[Parsed_loudnorm_0 @ 1] ', '{', '"broken"', '}']), null);
  });
});

describe('two-pass encoding', () => {
  const twoPass = { video: { rateControl: 'bitrate', bitrate: 5000, twoPass: true } };

  test('steps describe both passes for libx264', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(twoPass), outputPath: OUT });
    assert.equal(result.twoPass, true);
    assert.deepEqual(result.steps, [{ type: 'pass', pass: 1 }, { type: 'encode', pass: 2 }]);
  });

  test('pass one writes only video statistics to the null muxer', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset(twoPass), outputPath: OUT, pass: 1, passLogFile: 'C:\\Temp\\job1' });
    assert.equal(valueOf(args, '-pass'), '1');
    assert.equal(valueOf(args, '-passlogfile'), 'C:\\Temp\\job1');
    assert.deepEqual(valuesOf(args, '-map'), ['0:0']);
    assert.ok(args.includes('-an'));
    assert.ok(args.includes('-sn'));
    assert.equal(valueOf(args, '-map_metadata'), '-1');
    assert.deepEqual(args.slice(-3), ['-f', 'null', 'NUL']);
    assert.equal(args.includes('-movflags'), false);
  });

  test('pass two writes the real file', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset(twoPass), outputPath: OUT, pass: 2, passLogFile: 'C:\\Temp\\job1' });
    assert.equal(valueOf(args, '-pass'), '2');
    assert.deepEqual(valuesOf(args, '-map'), ['0:0', '0:1']);
    assert.deepEqual(args.slice(-3), ['-f', 'mp4', `file:${OUT}`]);
  });

  test('a pass without a log file is an error', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(twoPass), outputPath: OUT, pass: 1 });
    assert.equal(result.errors[0].code, 'pass-log-missing');
  });

  test('hardware encoders ignore two-pass', () => {
    const result = plan.buildPlan({ media: media('xvid-avi'), preset: preset(twoPass), encoder: 'h264_qsv', outputPath: OUT, pass: 1, passLogFile: 'x' });
    assert.equal(result.twoPass, false);
    assert.equal(result.args.includes('-pass'), false);
    assert.ok(result.warnings.includes('two-pass-unavailable'));
    assert.deepEqual(result.steps, [{ type: 'encode', pass: null }]);
  });
});

describe('copy and trim', () => {
  const remux = { container: 'mkv', video: { mode: 'copy' }, audio: { mode: 'copy', tracks: 'all' }, subtitles: 'keep' };

  test('Xvid copy unpacks B-frames', () => {
    const { args } = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ ...remux, picture: { resolution: 'keep', cfr: false, deinterlace: 'off', ivtc: 'off' } }), outputPath: OUT });
    assert.equal(valueOf(args, '-c:v:0'), 'copy');
    assert.equal(valueOf(args, '-bsf:v:0'), 'mpeg4_unpack_bframes');
    assert.equal(valueOf(args, '-avoid_negative_ts'), 'make_zero');
    assert.equal(args.includes('-filter:v:0'), false);
  });

  test('copy with picture changes warns that they are ignored', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(remux), outputPath: OUT });
    assert.ok(result.warnings.includes('copy-ignores-picture'));
    assert.equal(result.expect.width, 1920);
  });

  test('HEVC copied into MP4 or MOV is tagged hvc1, into MKV it is not', () => {
    const hevc = media('hevc10-mkv');
    const copy = { video: { mode: 'copy' }, audio: { mode: 'none' } };
    assert.equal(valueOf(plan.buildPlan({ media: hevc, preset: preset(copy), outputPath: OUT }).args, '-tag:v:0'), 'hvc1');
    assert.equal(valueOf(plan.buildPlan({ media: hevc, preset: preset({ ...copy, container: 'mov' }), outputPath: OUT }).args, '-tag:v:0'), 'hvc1');
    assert.equal(plan.buildPlan({ media: hevc, preset: preset({ ...copy, container: 'mkv' }), outputPath: OUT }).args.includes('-tag:v:0'), false);
    assert.equal(plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(copy), outputPath: OUT }).args.includes('-tag:v:0'), false);
  });

  test('DV cannot be copied into MP4', () => {
    const result = plan.buildPlan({ media: media('ntsc-dv'), preset: preset({ video: { mode: 'copy' } }), outputPath: OUT });
    assert.equal(result.errors[0].code, 'video-copy-incompatible');
    assert.equal(result.errors[0].detail, 'dvvideo');
  });

  test('subtitles are kept in MKV and converted for MP4', () => {
    const mkv = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset(remux), outputPath: OUT });
    assert.deepEqual(valuesOf(mkv.args, '-map'), ['0:0', '0:1', '0:2', '0:3']);
    assert.equal(valueOf(mkv.args, '-c:s:0'), 'copy');
    const mp4 = plan.buildPlan({ media: media('multi-track-mkv'), preset: preset({ subtitles: 'keep' }), outputPath: OUT });
    assert.equal(valueOf(mp4.args, '-c:s:0'), 'mov_text');
    assert.equal(mp4.args.includes('-sn'), false);
    assert.equal(mp4.summary.subtitles.length, 1);
  });

  test('bitmap subtitles are dropped from MP4 with a warning', () => {
    const item = media('multi-track-mkv', (data) => {
      data.streams[3].codec_name = 'dvd_subtitle';
    });
    const result = plan.buildPlan({ media: item, preset: preset({ subtitles: 'keep' }), outputPath: OUT });
    assert.ok(result.warnings.includes('subtitles-dropped'));
    assert.ok(result.args.includes('-sn'));
  });

  test('trim seeks before the input and limits the duration', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 0.5, end: 2.25 } });
    const { args } = result;
    assert.equal(valueOf(args, '-ss'), '0.5');
    assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
    assert.equal(valueOf(args, '-t'), '1.75');
    assert.ok(args.indexOf('-t') > args.indexOf('-i'));
    assert.equal(result.expectedDuration, 1.75);
    assert.equal(result.durationSlack, 0);
  });

  test('trim with only a start runs to the end', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 1, end: null } });
    assert.equal(result.args.includes('-t'), false);
    assert.equal(result.expectedDuration, 2.003);
  });

  test('trim with only an end', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 0, end: 1 } });
    assert.equal(result.args.includes('-ss'), false);
    assert.equal(valueOf(result.args, '-t'), '1');
    assert.equal(result.expectedDuration, 1);
  });

  test('an end past the file is ignored and a full-length trim is no trim', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 0, end: 99 } });
    assert.equal(result.args.includes('-t'), false);
    assert.equal(result.expectedDuration, 3.003);
  });

  test('an impossible trim is an error', () => {
    assert.equal(plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 10, end: 12 } }).errors[0].code, 'trim-invalid');
    assert.equal(plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT, trim: { start: 2, end: 1 } }).errors[0].code, 'trim-invalid');
  });

  test('an unreliable duration does not reject a trim past the estimate', () => {
    const result = plan.buildPlan({ media: media('truncated-avi'), preset: preset(), outputPath: OUT, trim: { start: 8, end: 12 } });
    assert.deepEqual(result.errors, []);
    assert.equal(valueOf(result.args, '-t'), '4');
  });

  test('copy with trim warns about keyframes and allows a longer output', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(remux), outputPath: OUT, trim: { start: 1, end: 2 } });
    assert.ok(result.warnings.includes('trim-keyframes'));
    assert.equal(result.durationSlack, 10);
  });

  test('normalizeTrim', () => {
    assert.deepEqual(plan.normalizeTrim(null, 10), { trim: null });
    assert.deepEqual(plan.normalizeTrim({ start: 0, end: null }, 10), { trim: null });
    assert.deepEqual(plan.normalizeTrim({ start: 2, end: 5 }, 10), { trim: { start: 2, end: 5, length: 3 } });
    assert.deepEqual(plan.normalizeTrim({ start: 2 }, null), { trim: { start: 2, end: null, length: null } });
    assert.deepEqual(plan.normalizeTrim({ start: -3, end: 'x' }, 10), { trim: null });
  });
});

describe('source problems', () => {
  test('a video preset on an audio file is an error', () => {
    const result = plan.buildPlan({ media: media('cover-art-mp3'), preset: preset(), outputPath: OUT });
    assert.equal(result.errors[0].code, 'source-has-no-video');
    assert.equal(result.args, null);
  });

  test('an audio preset on a silent video is an error', () => {
    assert.equal(plan.buildPlan({ media: media('no-audio-mp4'), preset: preset(MP3), outputPath: OUT }).errors[0].code, 'source-has-no-audio');
  });

  test('nothing to keep is an error', () => {
    assert.equal(plan.buildPlan({ media: media('xvid-avi'), preset: preset({ container: 'mkv', video: { mode: 'none' }, audio: { mode: 'none' } }), outputPath: OUT }).errors[0].code, 'nothing-to-convert');
  });

  test('an unknown container is an error', () => {
    assert.equal(plan.buildPlan({ media: media('xvid-avi'), preset: preset({ container: 'avi' }), outputPath: OUT }).errors[0].code, 'unsupported-container');
  });

  test('inverse telecine forced on PAL is reported', () => {
    const result = plan.buildPlan({ media: media('pal-anamorphic-vob'), preset: preset({ picture: { ivtc: 'on' } }), outputPath: OUT });
    assert.ok(result.warnings.includes('ivtc-not-applicable'));
  });
});

describe('expected duration', () => {
  test('uses the span of the mapped streams', () => {
    assert.equal(plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(), outputPath: OUT }).expectedDuration, 3.008334);
    const audioOnly = plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(MP3), outputPath: OUT });
    assert.equal(audioOnly.expectedDuration, 3.008);
    const videoOnly = plan.buildPlan({ media: media('xvid-avi'), preset: preset({ audio: { mode: 'none' } }), outputPath: OUT });
    assert.equal(videoOnly.expectedDuration, 3.003);
  });

  test('falls back to the container duration when a stream has none', () => {
    assert.equal(plan.buildPlan({ media: media('mjpeg-pcm-avi'), preset: preset(), outputPath: OUT }).expectedDuration, 3);
  });

  test('program and transport streams allow a longer output because their end is estimated from the last timestamp', () => {
    assert.equal(plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(), outputPath: OUT }).durationSlack, 1);
    assert.equal(plan.buildPlan({ media: media('pal-anamorphic-vob'), preset: preset(), outputPath: OUT }).durationSlack, 1);
    assert.equal(plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(), outputPath: OUT, trim: { start: 1, end: null } }).durationSlack, 1);
    assert.equal(plan.buildPlan({ media: media('xvid-avi'), preset: preset(), outputPath: OUT }).durationSlack, 0);
    assert.equal(plan.buildPlan({ media: media('h264-1080p5994'), preset: preset(), outputPath: OUT }).durationSlack, 0);
  });

  test('an exact trim end inside a program stream needs no slack', () => {
    const inside = plan.buildPlan({ media: media('dvd-mpeg2'), preset: preset(), outputPath: OUT, trim: { start: 0.5, end: 1.5 } });
    assert.equal(inside.expectedDuration, 1);
    assert.equal(inside.durationSlack, 0);
    const pastEstimate = plan.buildPlan({ media: media('truncated-mpeg'), preset: preset(), outputPath: OUT, trim: { start: 0, end: 500 } });
    assert.ok(pastEstimate.expectedDuration < 500);
    assert.equal(pastEstimate.durationSlack, 1);
  });

  test('frame rate changes keep the duration', () => {
    const result = plan.buildPlan({ media: media('h264-1080p5994'), preset: preset({ picture: { fps: '25' } }), outputPath: OUT });
    assert.equal(result.expectedDuration, 3.003);
  });
});

describe('describe', () => {
  test('summarizes the FlowAir result for DV', () => {
    const result = plan.describe(preset(), media('ntsc-dv'));
    assert.deepEqual(result.lines, [
      '1920x1080 · 29.97 fps · H.264',
      'Deinterlace · Square pixels · Padded · BT.601 → BT.709',
      'AAC · 192 kbps · 48 kHz · Stereo'
    ]);
    assert.ok(result.estimateBytes > 1e6 && result.estimateBytes < 1e7);
    assert.deepEqual(result.errors, []);
  });

  test('bitrate mode estimates from the bitrate', () => {
    const result = plan.describe(preset({ video: { rateControl: 'bitrate', bitrate: 8000 }, audio: { bitrate: 192 } }), media('h264-1080p5994'));
    const expected = ((8000000 + 192000) * 3.003 * 1.015) / 8;
    assert.ok(Math.abs(result.estimateBytes - expected) < 2);
  });

  test('copy estimates from the source bitrate', () => {
    const result = plan.describe(preset({ container: 'mkv', video: { mode: 'copy' }, audio: { mode: 'copy' } }), media('h264-1080p5994'));
    assert.deepEqual(result.lines, ['Video copy · H.264 · 1920x1080', 'Audio copy (AAC)']);
    assert.ok(Math.abs(result.estimateBytes - 10.6e6) < 0.3e6);
  });

  test('audio presets, loudness and multiple tracks', () => {
    assert.deepEqual(plan.describe(preset({ ...MP3, audio: { ...MP3.audio, loudness: 'ebu' } }), media('xvid-avi')).lines, ['MP3 · 320 kbps · 44.1 kHz · Stereo · EBU R128 −23 LUFS']);
    assert.deepEqual(plan.describe(preset({ container: 'mkv', video: { mode: 'none' }, audio: { mode: 'copy', tracks: 'all' } }), media('multi-track-mkv')).lines, ['Audio copy (AAC) · 2 tracks']);
    const wav = plan.describe(preset({ container: 'wav', video: { mode: 'none' }, audio: { codec: 'pcm' } }), media('ntsc-dv'));
    assert.deepEqual(wav.lines, ['PCM · 48 kHz · Stereo']);
    assert.equal(wav.estimateBytes, Math.round((48000 * 2 * 16 * 2.969633 * 1.015) / 8));
  });

  test('mentions missing audio, VFR and subtitles', () => {
    assert.deepEqual(plan.describe(preset(), media('no-audio-mp4')).lines.at(-1), 'No audio');
    assert.match(plan.describe(preset({ picture: { cfr: false, resolution: 'keep' } }), media('vfr-mp4')).lines[1], /Variable frame rate kept/);
    assert.equal(plan.describe(preset({ subtitles: 'keep' }), media('multi-track-mkv')).lines.at(-1), '1 subtitle track');
  });

  test('errors become the lines and there is no estimate', () => {
    const result = plan.describe(preset(), media('cover-art-mp3'));
    assert.deepEqual(result.lines, ['This file has no video.']);
    assert.equal(result.estimateBytes, null);
    assert.equal(result.errors[0].code, 'source-has-no-video');
  });
});

describe('built-in presets', () => {
  let presets = null;
  try {
    presets = require('../src/main/presets');
  } catch {
    presets = null;
  }

  test('every built-in preset plans cleanly for a typical archive file', { skip: !presets }, () => {
    for (const item of presets.BUILT_IN) {
      const result = plan.buildPlan({ media: media('xvid-avi'), preset: item, outputPath: OUT });
      assert.deepEqual(result.errors, [], item.id);
      assert.ok(result.args.length > 10, item.id);
      assert.equal(result.args.at(-2), plan.muxerFor(item), item.id);
      const text = plan.describe(item, media('xvid-avi'));
      assert.ok(text.lines.length > 0, item.id);
    }
  });
});
