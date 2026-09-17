const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SCHEMA,
  BUILT_IN,
  EXPORT_FORMAT,
  EXPORT_EXTENSION,
  MAX_USER_PRESETS,
  CONTAINER_LABELS,
  PresetError,
  PresetStore,
  validatePreset,
  summarize,
  uniqueName,
  parseExport,
  normalizeRate,
  lameVbrQuality,
  isBuiltInId,
  isAudioOnlyContainer
} = require('../src/main/presets');

const BUILT_IN_IDS = [
  'flowair-1080p',
  'flowair-720p',
  'mp4-universal',
  'smaller-file',
  'archive-remux',
  'youtube-upload',
  'mobile',
  'mp3-320',
  'mp3-vbr',
  'wav-48k',
  'extract-audio'
];

function builtIn(id) {
  return BUILT_IN.find((preset) => preset.id === id);
}

function draft(overrides = {}) {
  const base = structuredClone(builtIn('mp4-universal'));
  delete base.id;
  base.builtIn = false;
  base.name = 'My preset';
  return {
    ...base,
    ...overrides,
    video: { ...base.video, ...overrides.video },
    picture: { ...base.picture, ...overrides.picture },
    audio: { ...base.audio, ...overrides.audio },
    output: { ...base.output, ...overrides.output }
  };
}

function isDeepFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function assertPresetError(fn, code) {
  assert.throws(fn, (error) => error instanceof PresetError && error.code === code && error.message.length > 0);
}

describe('built-in presets', () => {
  test('exist with the contract ids in a stable order', () => {
    assert.deepEqual(
      BUILT_IN.map((preset) => preset.id),
      BUILT_IN_IDS
    );
    for (const id of BUILT_IN_IDS) assert.equal(isBuiltInId(id), true);
    assert.equal(isBuiltInId('u-123'), false);
  });

  test('have the names the product brief uses', () => {
    assert.deepEqual(
      BUILT_IN.map((preset) => preset.name),
      [
        'FlowAir Ready 1080p',
        'FlowAir Ready 720p',
        'MP4 Universal',
        'Smaller file',
        'Archive copy (remux only)',
        'YouTube upload',
        'WhatsApp / mobile',
        'MP3 320 kbps',
        'MP3 VBR high',
        'WAV 48 kHz',
        'Extract audio (copy)'
      ]
    );
  });

  test('are deeply frozen and flagged builtIn', () => {
    assert.equal(isDeepFrozen(BUILT_IN), true);
    for (const preset of BUILT_IN) {
      assert.equal(preset.builtIn, true);
      assert.equal(preset.version, 1);
      assert.ok(preset.description.length > 0 && preset.description.length <= 200);
    }
  });

  test('every built-in validates to itself and survives a JSON round trip', () => {
    for (const preset of BUILT_IN) {
      assert.deepEqual(validatePreset(preset, { allowBuiltInId: true }), preset);
      const copy = JSON.parse(JSON.stringify(preset));
      assert.deepEqual(validatePreset(copy, { allowBuiltInId: true }), preset);
    }
  });

  test('a built-in snapshot with changed settings keeps its id but is no longer builtIn', () => {
    const changed = structuredClone(builtIn('flowair-1080p'));
    changed.video.quality = 22;
    const result = validatePreset(changed, { allowBuiltInId: true });
    assert.equal(result.id, 'flowair-1080p');
    assert.equal(result.builtIn, false);
  });

  test('without allowBuiltInId a built-in id is dropped', () => {
    const result = validatePreset(builtIn('mobile'));
    assert.equal(result.id, null);
    assert.equal(result.builtIn, false);
  });

  test('FlowAir presets are broadcast safe', () => {
    for (const [id, resolution] of [
      ['flowair-1080p', '1080p'],
      ['flowair-720p', '720p']
    ]) {
      const preset = builtIn(id);
      assert.equal(preset.container, 'mp4');
      assert.equal(preset.video.mode, 'encode');
      assert.equal(preset.video.codec, 'h264');
      assert.equal(preset.video.profile, 'high');
      assert.equal(preset.video.rateControl, 'quality');
      assert.equal(preset.video.quality, 18);
      assert.equal(preset.picture.resolution, resolution);
      assert.equal(preset.picture.fit, 'pad');
      assert.equal(preset.picture.noUpscale, false);
      assert.equal(preset.picture.cfr, true);
      assert.equal(preset.picture.fps, 'keep');
      assert.equal(preset.picture.deinterlace, 'auto');
      assert.equal(preset.picture.deinterlaceRate, 'frame');
      assert.equal(preset.picture.ivtc, 'auto');
      assert.equal(preset.picture.squarePixels, true);
      assert.equal(preset.picture.colorConvert, 'auto');
      assert.deepEqual(
        { codec: preset.audio.codec, bitrate: preset.audio.bitrate, rate: preset.audio.sampleRate, channels: preset.audio.channels },
        { codec: 'aac', bitrate: 192, rate: 48000, channels: 'stereo' }
      );
      assert.equal(preset.audio.loudness, 'off');
      assert.equal(preset.subtitles, 'drop');
      assert.equal(preset.output.faststart, true);
    }
    assert.deepEqual([builtIn('flowair-720p').picture.width, builtIn('flowair-720p').picture.height], [1280, 720]);
  });

  test('general purpose presets keep H.264 and AAC in MP4', () => {
    for (const id of ['mp4-universal', 'smaller-file', 'youtube-upload', 'mobile']) {
      const preset = builtIn(id);
      assert.equal(preset.container, 'mp4', id);
      assert.equal(preset.video.codec, 'h264', id);
      assert.equal(preset.audio.codec, 'aac', id);
      assert.equal(preset.audio.sampleRate, 48000, id);
      assert.equal(preset.output.faststart, true, id);
    }
    assert.equal(builtIn('mp4-universal').picture.resolution, 'keep');
    assert.equal(builtIn('mp4-universal').audio.bitrate, 160);
    assert.equal(builtIn('smaller-file').video.quality, 26);
    assert.equal(builtIn('smaller-file').picture.resolution, '720p');
    assert.equal(builtIn('smaller-file').picture.fit, 'fit');
    assert.equal(builtIn('smaller-file').picture.noUpscale, true);
    assert.equal(builtIn('smaller-file').audio.bitrate, 96);
    assert.equal(builtIn('youtube-upload').video.quality, 18);
    assert.equal(builtIn('youtube-upload').picture.cfr, true);
    assert.equal(builtIn('youtube-upload').audio.bitrate, 320);
    assert.equal(builtIn('mobile').video.profile, 'main');
    assert.equal(builtIn('mobile').video.quality, 26);
    assert.equal(builtIn('mobile').picture.resolution, '720p');
    assert.equal(builtIn('mobile').audio.bitrate, 128);
  });

  test('copy presets never re-encode', () => {
    const archive = builtIn('archive-remux');
    assert.equal(archive.container, 'mkv');
    assert.equal(archive.video.mode, 'copy');
    assert.equal(archive.audio.mode, 'copy');
    assert.equal(archive.audio.tracks, 'all');
    assert.equal(archive.subtitles, 'keep');
    const extract = builtIn('extract-audio');
    assert.equal(extract.container, 'mkv');
    assert.equal(extract.video.mode, 'none');
    assert.equal(extract.audio.mode, 'copy');
    assert.equal(extract.audio.tracks, 'all');
    assert.equal(extract.output.faststart, false);
  });

  test('copy presets fall back to lossless FLAC when a track cannot be copied', () => {
    for (const id of ['archive-remux', 'extract-audio']) {
      const preset = builtIn(id);
      assert.equal(preset.audio.codec, 'flac', id);
      assert.equal(preset.audio.sampleRate, 'keep', id);
      assert.equal(preset.audio.channels, 'keep', id);
      assert.equal(preset.audio.loudness, 'off', id);
    }
    assert.doesNotMatch(builtIn('extract-audio').description, /any audio format/i);
  });

  test('sized presets carry the matching frame size', () => {
    assert.deepEqual(pickSize(builtIn('flowair-1080p')), ['1080p', 1920, 1080]);
    assert.deepEqual(pickSize(builtIn('flowair-720p')), ['720p', 1280, 720]);
    assert.deepEqual(pickSize(builtIn('smaller-file')), ['720p', 1280, 720]);
    assert.deepEqual(pickSize(builtIn('mobile')), ['720p', 1280, 720]);
  });

  test('picture options are neutral where no video is encoded', () => {
    for (const id of ['archive-remux', 'mp3-320', 'mp3-vbr', 'wav-48k', 'extract-audio']) {
      const { picture } = builtIn(id);
      assert.deepEqual([picture.deinterlace, picture.ivtc, picture.squarePixels, picture.colorConvert, picture.cfr], ['off', 'off', false, 'off', false], id);
    }
  });

  test('audio presets use the codec their container needs', () => {
    assert.deepEqual(pickAudio(builtIn('mp3-320')), ['mp3', 'none', 'mp3', 320, 0, 44100]);
    assert.deepEqual(pickAudio(builtIn('mp3-vbr')), ['mp3', 'none', 'mp3', 320, 1, 44100]);
    assert.deepEqual(pickAudio(builtIn('wav-48k')), ['wav', 'none', 'pcm', 192, 0, 48000]);
  });

  test('summaries are short readable tags', () => {
    const tags = Object.fromEntries(BUILT_IN.map((preset) => [preset.id, summarize(preset)]));
    assert.deepEqual(tags['flowair-1080p'], ['MP4', 'H.264', '1080p', 'AAC 192k']);
    assert.deepEqual(tags['flowair-720p'], ['MP4', 'H.264', '720p', 'AAC 192k']);
    assert.deepEqual(tags['mp4-universal'], ['MP4', 'H.264', 'AAC 160k']);
    assert.deepEqual(tags['archive-remux'], ['MKV', 'Video copy', 'Audio copy']);
    assert.deepEqual(tags['mp3-320'], ['MP3', '320k']);
    assert.deepEqual(tags['mp3-vbr'], ['MP3', 'VBR V0']);
    assert.deepEqual(tags['wav-48k'], ['WAV', 'PCM 16-bit', '48 kHz']);
    assert.deepEqual(tags['extract-audio'], ['MKA', 'Audio copy']);
  });
});

function pickAudio(preset) {
  return [preset.container, preset.video.mode, preset.audio.codec, preset.audio.bitrate, preset.audio.vbr, preset.audio.sampleRate];
}

function pickSize(preset) {
  return [preset.picture.resolution, preset.picture.width, preset.picture.height];
}

describe('SCHEMA', () => {
  test('is frozen, JSON serializable and lists every container', () => {
    assert.equal(isDeepFrozen(SCHEMA), true);
    assert.deepEqual(JSON.parse(JSON.stringify(SCHEMA)), SCHEMA);
    assert.deepEqual(SCHEMA.containers, ['mp4', 'mkv', 'mov', 'webm', 'mp3', 'm4a', 'wav', 'flac', 'opus']);
    assert.deepEqual(SCHEMA.audioOnlyContainers, ['mp3', 'm4a', 'wav', 'flac', 'opus']);
    for (const container of SCHEMA.audioOnlyContainers) assert.equal(isAudioOnlyContainer(container), true);
    assert.equal(isAudioOnlyContainer('mkv'), false);
  });

  test('describes exactly the preset fields', () => {
    const preset = builtIn('flowair-1080p');
    const settingKeys = Object.keys(SCHEMA.fields).filter((key) => !['name', 'description'].includes(key));
    assert.deepEqual(Object.keys(preset), ['id', 'name', 'description', 'builtIn', 'version', ...settingKeys]);
    for (const group of ['video', 'picture', 'audio', 'output']) {
      assert.deepEqual(Object.keys(preset[group]), Object.keys(SCHEMA.fields[group]));
    }
    assert.deepEqual(Object.keys(preset.picture.crop), ['top', 'bottom', 'left', 'right']);
  });

  test('lists a 16:9 frame size for every named resolution', () => {
    const named = SCHEMA.fields.picture.resolution.values.filter((value) => !['keep', 'custom'].includes(value));
    assert.deepEqual(Object.keys(SCHEMA.resolutionSizes), named);
    for (const [resolution, { width, height }] of Object.entries(SCHEMA.resolutionSizes)) {
      assert.equal(`${height}p`, resolution);
      assert.equal(width % 2, 0, resolution);
      assert.ok(Math.abs(width / height - 16 / 9) < 0.01, resolution);
    }
  });

  test('audio bitrate limits cover every codec and stay inside the field range', () => {
    const { min, max } = SCHEMA.fields.audio.bitrate;
    for (const codec of SCHEMA.fields.audio.codec.values) {
      assert.ok(SCHEMA.audioBitrateMin[codec] >= min, codec);
      assert.ok(SCHEMA.audioBitrateMax[codec] <= max, codec);
      assert.ok(SCHEMA.audioBitrateMin[codec] < SCHEMA.audioBitrateMax[codec], codec);
    }
    for (const [codec, limit] of Object.entries(SCHEMA.audioBitrateMaxMono)) assert.ok(limit < SCHEMA.audioBitrateMax[codec], codec);
  });

  test('every container allows at least one audio codec and its first choices are valid', () => {
    for (const container of SCHEMA.containers) {
      const codecs = SCHEMA.containerCodecs[container];
      assert.ok(codecs.audio.length > 0, container);
      for (const codec of codecs.audio) assert.ok(SCHEMA.fields.audio.codec.values.includes(codec), `${container} ${codec}`);
      for (const codec of codecs.video) assert.ok(SCHEMA.fields.video.codec.values.includes(codec), `${container} ${codec}`);
      assert.equal(codecs.video.length === 0, isAudioOnlyContainer(container), container);
    }
  });
});

describe('validatePreset', () => {
  test('rejects input that is not a preset', () => {
    for (const input of [null, undefined, 'x', 42, [], [draft()]]) assertPresetError(() => validatePreset(input), 'invalid');
  });

  test('requires a name and trims it to 60 characters', () => {
    assertPresetError(() => validatePreset(draft({ name: '   ' })), 'name-required');
    assertPresetError(() => validatePreset(draft({ name: 5 })), 'name-required');
    assert.equal(validatePreset(draft({ name: '  Tape\tarchive\n  ' })).name, 'Tape archive');
    const long = validatePreset(draft({ name: 'x'.repeat(80) })).name;
    assert.equal(long.length, 60);
    const emoji = validatePreset(draft({ name: `${'🎬'.repeat(70)}` })).name;
    assert.equal(Array.from(emoji).length, 60);
    assert.equal(emoji, '🎬'.repeat(60));
  });

  test('a name made only of invisible characters is not a name', () => {
    const invisible = [
      String.fromCodePoint(0x200b, 0x200b),
      String.fromCodePoint(0x200d),
      String.fromCodePoint(0x301, 0x302),
      String.fromCodePoint(0xfeff, 0x202e),
      String.fromCodePoint(0x85, 0xa0, 0x3000),
      String.fromCodePoint(0x2028, 0x2029)
    ];
    for (const name of invisible) assertPresetError(() => validatePreset(draft({ name })), 'name-required');
  });

  test('names lose control, zero-width and direction characters but keep emoji joiners', () => {
    const spoofed = `${String.fromCodePoint(0x202e)}Tape${String.fromCodePoint(0x200b)} ${String.fromCodePoint(0x2066)}archive${String.fromCodePoint(0x9b, 0x2069)}`;
    assert.equal(validatePreset(draft({ name: spoofed })).name, 'Tape archive');
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    assert.equal(validatePreset(draft({ name: `Family ${family}` })).name, `Family ${family}`);
    const accented = `Cafe${String.fromCodePoint(0x301)} n${String.fromCodePoint(0x303)}`;
    assert.equal(validatePreset(draft({ name: accented })).name, accented);
    assert.equal(validatePreset(draft({ name: 'Canción – 日本 🎬' })).name, 'Canción – 日本 🎬');
  });

  test('truncation never splits a surrogate pair and handles huge names quickly', () => {
    const mixed = `a${'🎬'.repeat(100)}`;
    const result = validatePreset(draft({ name: mixed })).name;
    assert.equal(Array.from(result).length, 60);
    assert.equal(result, `a${'🎬'.repeat(59)}`);
    assert.equal(validatePreset(draft({ name: `${'🎬'.repeat(60)}x` })).name, '🎬'.repeat(60));
    assert.equal(validatePreset(draft({ name: `${'x'.repeat(59)}🎬🎬` })).name, `${'x'.repeat(59)}🎬`);
    const started = process.hrtime.bigint();
    const huge = validatePreset(draft({ name: 'n'.repeat(5 * 1024 * 1024), description: 'd'.repeat(5 * 1024 * 1024) }));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(huge.name.length, 60);
    assert.equal(huge.description.length, 200);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs} ms`);
  });

  test('keeps descriptions up to 200 characters and defaults them to empty', () => {
    assert.equal(validatePreset(draft({ description: 'd'.repeat(300) })).description.length, 200);
    assert.equal(validatePreset(draft({ description: null })).description, '');
  });

  test('returns a deep copy with unknown fields dropped', () => {
    const input = draft({ extra: true, video: { hack: 1 }, audio: { filter: 'x' } });
    input.picture.crop.extra = 3;
    const result = validatePreset(input);
    assert.equal('extra' in result, false);
    assert.equal('hack' in result.video, false);
    assert.equal('filter' in result.audio, false);
    assert.equal('extra' in result.picture.crop, false);
    result.video.quality = 40;
    assert.equal(input.video.quality, 20);
    assert.notEqual(result.picture.crop, input.picture.crop);
  });

  test('ignores prototype keys and groups of the wrong type', () => {
    const input = JSON.parse(
      '{"name":"Proto","__proto__":{"container":"mkv"},"video":{"__proto__":{"mode":"copy"},"constructor":{"x":1}},"picture":null,"audio":[1,2],"output":"yes"}'
    );
    const result = validatePreset(input);
    assert.equal(result.container, 'mp4');
    assert.equal(result.video.mode, 'encode');
    assert.equal(Object.hasOwn(result.video, 'constructor'), false);
    assert.equal(result.picture.resolution, 'keep');
    assert.equal(result.audio.codec, 'aac');
    assert.equal(result.output.faststart, true);
    assert.equal({}.container, undefined);
    assert.equal({}.mode, undefined);
    const inherited = Object.create({ name: 'Inherited', container: 'mkv' });
    assert.throws(() => validatePreset(inherited), PresetError);
  });

  test('enum and number fields reject booleans, objects and odd strings', () => {
    const result = validatePreset(
      draft({
        container: true,
        video: { quality: true, bitrate: [9000], mode: ['copy'], level: '' },
        picture: { rotate: '', width: '12px', fps: 25.5, crop: { top: {} } },
        audio: { sampleRate: true, bitrate: '  ', volumeDb: 'NaN', vbr: '-Infinity' }
      })
    );
    assert.equal(result.container, 'mp4');
    assert.deepEqual([result.video.quality, result.video.bitrate, result.video.mode, result.video.level], [20, 8000, 'encode', 'auto']);
    assert.deepEqual([result.picture.rotate, result.picture.width, result.picture.fps, result.picture.crop.top], [0, 1920, 'keep', 0]);
    assert.deepEqual([result.audio.sampleRate, result.audio.bitrate, result.audio.volumeDb, result.audio.vbr], [48000, 192, 0, 0]);
  });

  test('keeps valid ids and drops invalid ones', () => {
    assert.equal(validatePreset(draft({ id: 'u-abc123' })).id, 'u-abc123');
    for (const id of ['U-ABC', '../x', '', 'a'.repeat(41), 12, 'a b']) assert.equal(validatePreset(draft({ id })).id, null);
  });

  test('always marks presets as version 1 and not built-in', () => {
    const result = validatePreset(draft({ version: 7, builtIn: true }));
    assert.equal(result.version, 1);
    assert.equal(result.builtIn, false);
  });

  test('falls back to defaults for unknown enum values', () => {
    const result = validatePreset(
      draft({
        container: 'avi',
        subtitles: 'burn',
        video: { mode: 'transcode', codec: 'mpeg2', rateControl: 'crf', speed: 'placebo', profile: 'high10', level: '6.2' },
        picture: { resolution: '4k', fit: 'zoom', fps: '29.97', deinterlace: 'yes', rotate: 45 },
        audio: { mode: 'x', codec: 'dts', sampleRate: 96000, channels: '5.1', loudness: 'loud', tracks: 'some' }
      })
    );
    assert.equal(result.container, 'mp4');
    assert.equal(result.subtitles, 'drop');
    assert.deepEqual(
      [result.video.mode, result.video.codec, result.video.rateControl, result.video.speed, result.video.profile, result.video.level],
      ['encode', 'h264', 'quality', 'balanced', 'auto', 'auto']
    );
    assert.deepEqual(
      [result.picture.resolution, result.picture.fit, result.picture.fps, result.picture.deinterlace, result.picture.rotate],
      ['keep', 'pad', 'keep', 'auto', 0]
    );
    assert.deepEqual(
      [result.audio.mode, result.audio.codec, result.audio.sampleRate, result.audio.channels, result.audio.loudness, result.audio.tracks],
      ['encode', 'aac', 48000, 'stereo', 'off', 'first']
    );
  });

  test('accepts numeric strings and numbers for enum values', () => {
    const result = validatePreset(draft({ picture: { rotate: '90', fps: 25 }, audio: { sampleRate: '44100' }, video: { level: 4 } }));
    assert.equal(result.picture.rotate, 90);
    assert.equal(result.picture.fps, '25');
    assert.equal(result.audio.sampleRate, 44100);
    assert.equal(result.video.level, '4.0');
  });

  test('clamps and rounds numbers', () => {
    const result = validatePreset(
      draft({
        video: { quality: 0, bitrate: 10, maxrate: -5, bufsize: 999999999, keyframeSeconds: 0.2 },
        picture: { width: 1001, height: 99999, crop: { top: 3, bottom: -2, left: '7', right: 'x' } },
        audio: { bitrate: 1000, vbr: 12, volumeDb: 3.14159 }
      })
    );
    assert.equal(result.video.quality, 1);
    assert.equal(result.video.bitrate, 100);
    assert.equal(result.video.maxrate, 0);
    assert.equal(result.video.keyframeSeconds, 0.5);
    assert.equal(result.picture.width, 1002);
    assert.equal(result.picture.height, 4320);
    assert.deepEqual(result.picture.crop, { top: 4, bottom: 0, left: 8, right: 0 });
    assert.equal(result.audio.bitrate, 512);
    assert.equal(result.audio.vbr, 0);
    assert.equal(result.audio.volumeDb, 3.1);
    const high = validatePreset(draft({ video: { quality: 99, keyframeSeconds: 30 }, audio: { volumeDb: -80 } }));
    assert.equal(high.video.quality, 51);
    assert.equal(high.video.keyframeSeconds, 10);
    assert.equal(high.audio.volumeDb, -20);
    const zero = validatePreset(draft({ video: { keyframeSeconds: 0, maxrate: 50 } }));
    assert.equal(zero.video.keyframeSeconds, 0);
    assert.equal(zero.video.maxrate, 100);
  });

  test('uses defaults for non-finite or wrongly typed numbers and booleans', () => {
    const result = validatePreset(
      draft({ video: { quality: 'best', bitrate: null, twoPass: 'yes' }, picture: { width: Infinity, noUpscale: 1 }, output: { faststart: 'true' } })
    );
    assert.equal(result.video.quality, 20);
    assert.equal(result.video.bitrate, 8000);
    assert.equal(result.video.twoPass, false);
    assert.equal(result.picture.width, 1920);
    assert.equal(result.picture.noUpscale, false);
    assert.equal(result.output.faststart, true);
  });

  test('never returns negative zero', () => {
    const result = validatePreset(draft({ audio: { volumeDb: -0.01 } }));
    assert.equal(Object.is(result.audio.volumeDb, -0), false);
    assert.equal(result.audio.volumeDb, 0);
  });

  test('audio-only containers turn video and subtitles off', () => {
    const result = validatePreset(draft({ container: 'mp3', subtitles: 'keep', video: { mode: 'copy' }, audio: { codec: 'aac', tracks: 'all' } }));
    assert.equal(result.video.mode, 'none');
    assert.equal(result.subtitles, 'drop');
    assert.equal(result.audio.codec, 'mp3');
    assert.equal(result.audio.tracks, 'first');
    assert.equal(result.output.faststart, false);
  });

  test('audio-only containers force their codec', () => {
    const expected = { mp3: 'mp3', m4a: 'aac', wav: 'pcm', flac: 'flac', opus: 'opus' };
    for (const [container, codec] of Object.entries(expected)) {
      for (const input of ['aac', 'mp3', 'opus', 'ac3', 'pcm', 'flac', 'vorbis']) {
        const result = validatePreset(draft({ container, audio: { codec: input } }));
        assert.equal(result.audio.codec, codec, `${container} with ${input}`);
        assert.equal(result.video.mode, 'none');
      }
    }
    assert.equal(validatePreset(draft({ container: 'm4a' })).output.faststart, true);
  });

  test('audio-only containers keep audio copy', () => {
    const result = validatePreset(draft({ container: 'm4a', audio: { mode: 'copy' } }));
    assert.equal(result.audio.mode, 'copy');
    assert.equal(result.audio.codec, 'aac');
  });

  test('an audio-only container without audio is an error', () => {
    assertPresetError(() => validatePreset(draft({ container: 'wav', audio: { mode: 'none' } })), 'audio-required');
  });

  test('a preset that keeps nothing is an error', () => {
    assertPresetError(() => validatePreset(draft({ video: { mode: 'none' }, audio: { mode: 'none' } })), 'nothing-to-keep');
    assert.equal(validatePreset(draft({ video: { mode: 'none' } })).video.mode, 'none');
    assert.equal(validatePreset(draft({ audio: { mode: 'none' } })).audio.mode, 'none');
  });

  test('webm needs VP9 or AV1 with Opus or Vorbis', () => {
    const corrected = validatePreset(draft({ container: 'webm', video: { codec: 'h264' }, audio: { codec: 'aac' } }));
    assert.equal(corrected.video.codec, 'vp9');
    assert.equal(corrected.audio.codec, 'opus');
    assert.equal(corrected.output.faststart, false);
    const kept = validatePreset(draft({ container: 'webm', video: { codec: 'av1' }, audio: { codec: 'vorbis' } }));
    assert.equal(kept.video.codec, 'av1');
    assert.equal(kept.audio.codec, 'vorbis');
  });

  test('mp4 accepts modern codecs and corrects the rest', () => {
    for (const codec of ['h264', 'hevc', 'av1', 'vp9']) assert.equal(validatePreset(draft({ video: { codec } })).video.codec, codec);
    for (const codec of ['aac', 'mp3', 'opus', 'ac3', 'flac']) assert.equal(validatePreset(draft({ audio: { codec } })).audio.codec, codec);
    assert.equal(validatePreset(draft({ audio: { codec: 'pcm' } })).audio.codec, 'aac');
    assert.equal(validatePreset(draft({ audio: { codec: 'vorbis' } })).audio.codec, 'aac');
  });

  test('mov keeps H.264 and HEVC and allows PCM', () => {
    const mov = validatePreset(draft({ container: 'mov', video: { codec: 'vp9' }, audio: { codec: 'pcm' } }));
    assert.equal(mov.video.codec, 'h264');
    assert.equal(mov.audio.codec, 'pcm');
    assert.equal(mov.output.faststart, true);
    assert.equal(validatePreset(draft({ container: 'mov', audio: { codec: 'opus' } })).audio.codec, 'aac');
  });

  test('mkv accepts every codec and has no faststart', () => {
    for (const codec of ['h264', 'hevc', 'av1', 'vp9']) {
      assert.equal(validatePreset(draft({ container: 'mkv', video: { codec } })).video.codec, codec);
    }
    for (const codec of ['aac', 'mp3', 'opus', 'ac3', 'pcm', 'flac', 'vorbis']) {
      assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec } })).audio.codec, codec);
    }
    assert.equal(validatePreset(draft({ container: 'mkv', output: { faststart: true } })).output.faststart, false);
  });

  test('profiles and levels must exist for the codec', () => {
    assert.equal(validatePreset(draft({ video: { profile: 'baseline', level: '3.1' } })).video.profile, 'baseline');
    const hevc = validatePreset(draft({ video: { codec: 'hevc', profile: 'high', level: '4.2' } }));
    assert.equal(hevc.video.profile, 'auto');
    assert.equal(hevc.video.level, 'auto');
    const hevcMain = validatePreset(draft({ video: { codec: 'hevc', profile: 'main', level: '5.1' } }));
    assert.equal(hevcMain.video.profile, 'main');
    assert.equal(hevcMain.video.level, '5.1');
    const vp9 = validatePreset(draft({ container: 'webm', video: { codec: 'vp9', profile: 'main', level: '4.1' } }));
    assert.equal(vp9.video.profile, 'auto');
    assert.equal(vp9.video.level, 'auto');
  });

  test('a forced encoder must belong to the codec', () => {
    const cases = [
      ['h264', 'h264_qsv', 'h264_qsv'],
      ['h264', 'libx264', 'libx264'],
      ['h264', 'hevc_nvenc', 'auto'],
      ['hevc', 'libx265', 'libx265'],
      ['hevc', 'hevc_amf', 'hevc_amf'],
      ['av1', 'libaom-av1', 'libaom-av1'],
      ['av1', 'av1_nvenc', 'av1_nvenc'],
      ['av1', 'libx264', 'auto'],
      ['h264', 'H264_QSV', 'auto'],
      ['h264', 'h264_qsv; rm', 'auto'],
      ['h264', '-h264_qsv', 'auto'],
      ['h264', 'x'.repeat(40), 'auto']
    ];
    for (const [codec, encoder, expected] of cases) {
      const container = codec === 'vp9' ? 'webm' : 'mkv';
      assert.equal(validatePreset(draft({ container, video: { codec, encoder } })).video.encoder, expected, `${codec} ${encoder}`);
    }
    assert.equal(validatePreset(draft({ container: 'webm', video: { codec: 'vp9', encoder: 'libvpx-vp9' } })).video.encoder, 'libvpx-vp9');
  });

  test('two-pass only applies to bitrate mode', () => {
    assert.equal(validatePreset(draft({ video: { twoPass: true } })).video.twoPass, false);
    assert.equal(validatePreset(draft({ video: { rateControl: 'bitrate', twoPass: true } })).video.twoPass, true);
  });

  test('bufsize is cleared when there is no maxrate', () => {
    assert.equal(validatePreset(draft({ video: { maxrate: 0, bufsize: 4000 } })).video.bufsize, 0);
    const capped = validatePreset(draft({ video: { maxrate: 6000, bufsize: 12000 } }));
    assert.deepEqual([capped.video.maxrate, capped.video.bufsize], [6000, 12000]);
  });

  test('audio rules: vbr only for mp3, opus is 48 kHz, bitrate capped per codec', () => {
    assert.equal(validatePreset(draft({ audio: { codec: 'aac', vbr: 3 } })).audio.vbr, 0);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'mp3', vbr: 3 } })).audio.vbr, 3);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'opus', sampleRate: 44100 } })).audio.sampleRate, 48000);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'opus', sampleRate: 'keep' } })).audio.sampleRate, 48000);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'mp3', bitrate: 480 } })).audio.bitrate, 320);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'opus', bitrate: 640 } })).audio.bitrate, 510);
    assert.equal(validatePreset(draft({ container: 'mkv', audio: { codec: 'ac3', bitrate: 640 } })).audio.bitrate, 640);
    assert.equal(validatePreset(draft({ audio: { codec: 'aac', sampleRate: 'keep' } })).audio.sampleRate, 'keep');
  });

  test('audio bitrates respect what each encoder accepts', () => {
    const bitrate = (audio, container = 'mkv') => validatePreset(draft({ container, audio })).audio.bitrate;
    assert.equal(bitrate({ codec: 'opus', channels: 'mono', bitrate: 510 }), 256);
    assert.equal(bitrate({ codec: 'opus', channels: 'stereo', bitrate: 510 }), 510);
    assert.equal(bitrate({ codec: 'opus', channels: 'keep', bitrate: 510 }), 510);
    assert.equal(bitrate({ codec: 'vorbis', channels: 'mono', bitrate: 320 }), 240);
    assert.equal(bitrate({ codec: 'vorbis', channels: 'stereo', bitrate: 320 }), 320);
    assert.equal(bitrate({ codec: 'vorbis', channels: 'stereo', bitrate: 32 }), 48);
    assert.equal(bitrate({ codec: 'vorbis', channels: 'mono', bitrate: 32 }), 48);
    assert.equal(bitrate({ codec: 'aac', channels: 'mono', bitrate: 512 }), 512);
    assert.equal(bitrate({ codec: 'mp3', channels: 'mono', bitrate: 32 }), 32);
    assert.equal(bitrate({ codec: 'opus', channels: 'mono', bitrate: 400 }, 'opus'), 256);
    assert.equal(bitrate({ codec: 'vorbis', channels: 'mono', bitrate: 500 }, 'webm'), 240);
  });

  test('named resolutions set the frame size and custom keeps its own', () => {
    const size = (picture) => pickSize(validatePreset(draft({ picture })));
    assert.deepEqual(size({ resolution: '480p', width: 1920, height: 1080 }), ['480p', 854, 480]);
    assert.deepEqual(size({ resolution: '576p' }), ['576p', 1024, 576]);
    assert.deepEqual(size({ resolution: '720p', width: 640, height: 360 }), ['720p', 1280, 720]);
    assert.deepEqual(size({ resolution: '1440p' }), ['1440p', 2560, 1440]);
    assert.deepEqual(size({ resolution: '2160p' }), ['2160p', 3840, 2160]);
    assert.deepEqual(size({ resolution: 'custom', width: 720, height: 576 }), ['custom', 720, 576]);
    assert.deepEqual(size({ resolution: 'keep', width: 720, height: 576 }), ['keep', 720, 576]);
    const summary = summarize(validatePreset(draft({ picture: { resolution: '480p', width: 3, height: 3 } })));
    assert.deepEqual(summary, ['MP4', 'H.264', '480p', 'AAC 160k']);
  });

  test('custom frame rates are stored as exact rationals', () => {
    const rate = (customFps) => validatePreset(draft({ picture: { fps: 'custom', customFps } })).picture;
    assert.deepEqual(pickRate(rate('29.97')), ['custom', '30000/1001']);
    assert.deepEqual(pickRate(rate('23.976')), ['custom', '24000/1001']);
    assert.deepEqual(pickRate(rate('59.940')), ['custom', '60000/1001']);
    assert.deepEqual(pickRate(rate('12.5')), ['custom', '25/2']);
    assert.deepEqual(pickRate(rate('120/2')), ['custom', '60']);
    assert.deepEqual(pickRate(rate(' 48 ')), ['custom', '48']);
    for (const bad of ['', 'fast', '0', '1/0', '0/5', '500', '-30', '30fps', 29.97]) {
      assert.deepEqual(pickRate(rate(bad)), ['keep', ''], String(bad));
    }
    assert.deepEqual(pickRate(validatePreset(draft({ picture: { fps: '25', customFps: '29.97' } })).picture), ['25', '30000/1001']);
  });

  test('frame rate normalization keeps every standard NTSC rate exact', () => {
    assert.equal(normalizeRate('23.98'), '24000/1001');
    assert.equal(normalizeRate('47.952'), '48000/1001');
    assert.equal(normalizeRate('119.88'), '120000/1001');
    assert.equal(normalizeRate('30000/1001'), '30000/1001');
    assert.equal(normalizeRate('2997/100'), '2997/100');
    assert.equal(normalizeRate('240'), '240');
    assert.equal(normalizeRate('241'), '');
    assert.equal(normalizeRate('1/2'), '');
    assert.equal(normalizeRate(null), '');
  });

  test('frame rate normalization reduces fractions and rejects odd text', () => {
    assert.equal(normalizeRate('60000/2002'), '30000/1001');
    assert.equal(normalizeRate('1001/1001'), '1');
    assert.equal(normalizeRate('50/1'), '50');
    assert.equal(normalizeRate('240.000'), '240');
    assert.equal(normalizeRate('025'), '25');
    assert.equal(normalizeRate('0.5'), '');
    assert.equal(normalizeRate('1.0'), '1');
    for (const bad of ['1e2', '0x19', '25.', '.5', '25/', '/25', '1234567/1', '30 000/1001', '29,97', 'NaN', 'Infinity', undefined, 30, {}]) {
      assert.equal(normalizeRate(bad), '', String(bad));
    }
  });

  test('is idempotent', () => {
    const inputs = [
      draft({ container: 'webm', video: { codec: 'hevc', encoder: 'h264_qsv' }, audio: { codec: 'aac', bitrate: 700 } }),
      draft({ container: 'flac', audio: { sampleRate: 44100 } }),
      draft({ picture: { resolution: 'custom', width: 1281, height: 721, fps: 'custom', customFps: '59.94' } })
    ];
    for (const input of inputs) {
      const once = validatePreset(input);
      assert.deepEqual(validatePreset(once), once);
    }
  });
});

function pickRate(picture) {
  return [picture.fps, picture.customFps];
}

describe('mp3 vbr mapping', () => {
  test('vbr 0 is CBR and vbr N maps to LAME -q:a N-1', () => {
    assert.equal(lameVbrQuality(0), null);
    assert.equal(lameVbrQuality(1), 0);
    assert.equal(lameVbrQuality(3), 2);
    assert.equal(lameVbrQuality(9), 8);
    assert.equal(lameVbrQuality(10), null);
    assert.equal(lameVbrQuality(-1), null);
    assert.equal(lameVbrQuality(1.5), null);
    assert.equal(lameVbrQuality(builtIn('mp3-vbr').audio.vbr), 0);
    assert.equal(lameVbrQuality(builtIn('mp3-320').audio.vbr), null);
  });
});

describe('summarize', () => {
  test('describes custom pictures, frame rates and loudness', () => {
    const preset = validatePreset(
      draft({
        container: 'mkv',
        video: { codec: 'hevc' },
        picture: { resolution: 'custom', width: 1440, height: 1080, fps: '30000/1001' },
        audio: { codec: 'ac3', bitrate: 384, loudness: 'ebu' }
      })
    );
    assert.deepEqual(summarize(preset), ['MKV', 'HEVC', '1440×1080', '29.97 fps', 'AC-3 384k', 'EBU R128']);
    const custom = validatePreset(draft({ picture: { fps: 'custom', customFps: '12.5' }, audio: { loudness: 'streaming' } }));
    assert.deepEqual(summarize(custom), ['MP4', 'H.264', '12.5 fps', 'AAC 160k', '−14 LUFS']);
    const integer = validatePreset(draft({ picture: { fps: '25' }, audio: { loudness: 'atsc' } }));
    assert.deepEqual(summarize(integer), ['MP4', 'H.264', '25 fps', 'AAC 160k', 'ATSC A/85']);
  });

  test('covers missing tracks and lossless audio', () => {
    assert.deepEqual(summarize(validatePreset(draft({ video: { mode: 'none' } }))), ['MP4', 'No video', 'AAC 160k']);
    assert.deepEqual(summarize(validatePreset(draft({ audio: { mode: 'none' } }))), ['MP4', 'H.264', 'No audio']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'flac', audio: { sampleRate: 'keep' } }))), ['FLAC', 'Lossless']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'flac', audio: { sampleRate: 44100 } }))), ['FLAC', 'Lossless', '44.1 kHz']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'opus', audio: { bitrate: 96 } }))), ['Opus', '96k']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'm4a', audio: { bitrate: 256 } }))), ['M4A', 'AAC 256k']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'm4a', audio: { mode: 'copy', loudness: 'ebu' } }))), ['M4A', 'Copy']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'mkv', audio: { codec: 'pcm' } }))), ['MKV', 'H.264', 'PCM']);
    assert.deepEqual(summarize(validatePreset(draft({ container: 'mkv', audio: { codec: 'mp3', vbr: 3 } }))), ['MKV', 'H.264', 'MP3 V2']);
  });
});

describe('uniqueName', () => {
  test('keeps free names and numbers taken ones case-insensitively', () => {
    assert.equal(uniqueName('Tape', ['Other']), 'Tape');
    assert.equal(uniqueName('Tape', ['tape']), 'Tape (2)');
    assert.equal(uniqueName('Tape', ['Tape', 'Tape (2)', 'TAPE (3)']), 'Tape (4)');
    assert.equal(uniqueName('Tape (2)', ['Tape', 'Tape (2)']), 'Tape (3)');
    assert.equal(uniqueName('(2)', ['(2)']), '(2) (2)');
  });

  test('never exceeds 60 characters', () => {
    const long = 'n'.repeat(60);
    const result = uniqueName(long, [long]);
    assert.equal(result.length, 60);
    assert.ok(result.endsWith(' (2)'));
    assert.equal(uniqueName(result, [long, result]), `${'n'.repeat(56)} (3)`);
  });
});

describe('parseExport', () => {
  const valid = { format: EXPORT_FORMAT, version: 1, preset: draft() };

  test('accepts objects, strings, buffers and a UTF-8 BOM', () => {
    const text = JSON.stringify(valid);
    assert.equal(parseExport(valid).format, 'vidaro-preset');
    assert.equal(parseExport(text).preset.name, 'My preset');
    assert.equal(parseExport(Buffer.from(text)).preset.name, 'My preset');
    assert.equal(parseExport(String.fromCharCode(0xfeff) + text).preset.name, 'My preset');
  });

  test('rejects anything else with a plain message', () => {
    const bad = [
      'not json',
      '[]',
      JSON.stringify({ ...valid, format: 'other' }),
      JSON.stringify({ ...valid, preset: [] }),
      JSON.stringify({ ...valid, version: 0 }),
      JSON.stringify({ ...valid, version: '1' }),
      { format: EXPORT_FORMAT, version: 1 },
      `${JSON.stringify(valid)}${' '.repeat(300 * 1024)}`,
      null,
      42
    ];
    for (const input of bad) {
      assert.throws(
        () => parseExport(input),
        (error) => error instanceof PresetError && error.code === 'invalid-file' && error.message === 'This file is not a Vidaro preset.'
      );
    }
  });

  test('explains when a preset comes from a newer Vidaro', () => {
    assertPresetError(() => parseExport({ ...valid, version: 2 }), 'newer-version');
  });

  test('rejects an oversized buffer before decoding it', () => {
    const huge = Buffer.alloc(4 * 1024 * 1024, 0x20);
    assertPresetError(() => parseExport(huge), 'invalid-file');
    const multibyte = Buffer.from(`{"format":"vidaro-preset","version":1,"preset":{"name":"${'ñ'.repeat(1000)}"}}`);
    assert.equal(parseExport(multibyte).preset.name.length, 1000);
  });

  test('uses a stable file format name and extension', () => {
    assert.equal(EXPORT_FORMAT, 'vidaro-preset');
    assert.equal(EXPORT_EXTENSION, 'vidaropreset');
    assert.deepEqual(Object.keys(CONTAINER_LABELS), SCHEMA.containers);
  });
});

describe('PresetStore', () => {
  let dir;
  let file;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-test-presets-'));
    file = path.join(dir, 'presets.json');
    store = new PresetStore({ file, debounceMs: 5 });
  });

  afterEach(() => {
    store.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function reopen() {
    store.dispose();
    store = new PresetStore({ file, debounceMs: 5 });
    return store;
  }

  function writeFile(data) {
    fs.writeFileSync(file, JSON.stringify(data));
  }

  test('starts with only the built-ins and loads lazily', () => {
    const list = store.list();
    assert.deepEqual(
      list.map((preset) => preset.id),
      BUILT_IN_IDS
    );
    assert.deepEqual(list.slice(0, BUILT_IN.length), BUILT_IN);
    assert.notEqual(list[0], BUILT_IN[0]);
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.recovered, false);
  });

  test('save assigns a user id, persists and lists user presets sorted by name after built-ins', () => {
    const b = store.save(draft({ name: 'beta' }));
    const a = store.save(draft({ name: 'Alpha' }));
    const c = store.save(draft({ name: 'Gamma 10' }));
    const d = store.save(draft({ name: 'gamma 9' }));
    for (const preset of [a, b, c, d]) {
      assert.match(preset.id, /^u-[a-z0-9]+$/);
      assert.equal(preset.builtIn, false);
    }
    assert.equal(new Set([a.id, b.id, c.id, d.id]).size, 4);
    const names = store.list().map((preset) => preset.name);
    assert.deepEqual(names.slice(0, BUILT_IN.length), BUILT_IN.map((preset) => preset.name));
    assert.deepEqual(names.slice(BUILT_IN.length), ['Alpha', 'beta', 'gamma 9', 'Gamma 10']);
    store.flush();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.presets.length, 4);
    assert.deepEqual(reopen().get(a.id), a);
  });

  test('save updates an existing preset in place', () => {
    const created = store.save(draft({ name: 'Tape' }));
    const updated = store.save({ ...created, video: { ...created.video, quality: 24 } });
    assert.equal(updated.id, created.id);
    assert.equal(updated.name, 'Tape');
    assert.equal(updated.video.quality, 24);
    assert.equal(store.list().length, BUILT_IN.length + 1);
  });

  test('save keeps an unknown but valid id', () => {
    const saved = store.save(draft({ id: 'u-imported1', name: 'Kept id' }));
    assert.equal(saved.id, 'u-imported1');
    assert.equal(store.get('u-imported1').name, 'Kept id');
  });

  test('saving over a built-in creates a new user preset and leaves the built-in untouched', () => {
    const original = structuredClone(builtIn('flowair-1080p'));
    const edited = structuredClone(builtIn('flowair-1080p'));
    edited.video.quality = 30;
    const saved = store.save(edited);
    assert.match(saved.id, /^u-/);
    assert.equal(saved.name, 'FlowAir Ready 1080p (2)');
    assert.equal(saved.video.quality, 30);
    assert.deepEqual(store.get('flowair-1080p'), original);
    assert.deepEqual(builtIn('flowair-1080p'), original);
  });

  test('returned presets are copies', () => {
    const saved = store.save(draft({ name: 'Copy check' }));
    saved.video.quality = 50;
    store.get(saved.id).video.quality = 49;
    store.list().at(-1).video.quality = 48;
    assert.equal(store.get(saved.id).video.quality, 20);
  });

  test('built-ins come out as editable copies that never change the originals', () => {
    const copy = store.get('mp3-320');
    assert.deepEqual(copy, builtIn('mp3-320'));
    assert.equal(Object.isFrozen(copy), false);
    copy.name = 'Changed';
    copy.audio.bitrate = 128;
    store.list()[BUILT_IN.findIndex((preset) => preset.id === 'mp3-320')].audio.bitrate = 96;
    assert.equal(store.get('mp3-320').name, 'MP3 320 kbps');
    assert.equal(store.get('mp3-320').audio.bitrate, 320);
    assert.equal(builtIn('mp3-320').audio.bitrate, 320);
    assert.equal(store.get('no-such-id'), null);
    assert.equal(store.get(undefined), null);
  });

  test('built-ins are immutable through the store', () => {
    assert.equal(isDeepFrozen(builtIn('mp3-320')), true);
    assertPresetError(() => store.remove('mp3-320'), 'built-in');
    assertPresetError(() => store.rename('mp3-320', 'Other'), 'built-in');
    assert.equal(store.get('mp3-320').name, 'MP3 320 kbps');
  });

  test('names are unique across built-in and user presets', () => {
    assert.equal(store.save(draft({ name: 'mp4 universal' })).name, 'mp4 universal (2)');
    assert.equal(store.save(draft({ name: 'MP4 Universal' })).name, 'MP4 Universal (3)');
    const own = store.save(draft({ name: 'Own' }));
    assert.equal(store.save({ ...own }).name, 'Own');
  });

  test('duplicate copies built-in and user presets', () => {
    const copy = store.duplicate('flowair-720p');
    assert.equal(copy.name, 'FlowAir Ready 720p (2)');
    assert.equal(copy.builtIn, false);
    assert.equal(copy.picture.resolution, '720p');
    const again = store.duplicate('flowair-720p');
    assert.equal(again.name, 'FlowAir Ready 720p (3)');
    const named = store.duplicate(copy.id, '  Station 720p  ');
    assert.equal(named.name, 'Station 720p');
    assert.notEqual(named.id, copy.id);
    assert.equal(store.duplicate(copy.id, '   ').name, 'FlowAir Ready 720p (4)');
    assertPresetError(() => store.duplicate('u-missing'), 'not-found');
  });

  test('rename changes only the name and validates it', () => {
    const created = store.save(draft({ name: 'Before' }));
    const other = store.save(draft({ name: 'Taken' }));
    const renamed = store.rename(created.id, '  After  ');
    assert.equal(renamed.id, created.id);
    assert.equal(renamed.name, 'After');
    assert.deepEqual({ ...renamed, name: 'Before' }, created);
    assert.equal(store.rename(created.id, 'taken').name, 'taken (2)');
    assert.equal(store.rename(other.id, 'Taken').name, 'Taken');
    assertPresetError(() => store.rename(created.id, ''), 'name-required');
    assertPresetError(() => store.rename('u-missing', 'x'), 'not-found');
  });

  test('remove deletes user presets only', () => {
    const created = store.save(draft({ name: 'Temp' }));
    assert.equal(store.remove(created.id), true);
    assert.equal(store.get(created.id), null);
    assert.equal(store.remove(created.id), false);
    assert.equal(store.remove('u-nothing'), false);
  });

  test('export and import round trip with a new id and a de-duplicated name', () => {
    const created = store.save(draft({ name: 'Station', audio: { loudness: 'ebu' } }));
    const exported = store.exportData(created.id);
    assert.equal(exported.format, 'vidaro-preset');
    assert.equal(exported.version, 1);
    assert.deepEqual(exported.preset, created);
    const imported = store.importData(JSON.stringify(exported));
    assert.notEqual(imported.id, created.id);
    assert.equal(imported.name, 'Station (2)');
    assert.deepEqual({ ...imported, id: created.id, name: created.name }, created);
    const third = store.importData(exported);
    assert.equal(third.name, 'Station (3)');
  });

  test('exporting a built-in produces a user preset on import', () => {
    const exported = store.exportData('youtube-upload');
    assert.equal(exported.preset.builtIn, false);
    assert.equal(exported.preset.id, 'youtube-upload');
    exported.preset.video.quality = 1;
    assert.equal(builtIn('youtube-upload').video.quality, 18);
    const imported = store.importData(JSON.stringify(store.exportData('youtube-upload')));
    assert.match(imported.id, /^u-/);
    assert.equal(imported.name, 'YouTube upload (2)');
    assert.equal(imported.builtIn, false);
    assert.equal(imported.video.quality, 18);
    assertPresetError(() => store.exportData('u-missing'), 'not-found');
  });

  test('import validates and corrects the preset', () => {
    const imported = store.importData({
      format: 'vidaro-preset',
      version: 1,
      preset: { id: 'flowair-1080p', name: 'Odd', container: 'wav', builtIn: true, audio: { codec: 'mp3' }, extra: 1 }
    });
    assert.match(imported.id, /^u-/);
    assert.equal(imported.builtIn, false);
    assert.equal(imported.audio.codec, 'pcm');
    assert.equal(imported.video.mode, 'none');
    assert.equal('extra' in imported, false);
    assertPresetError(() => store.importData('{"format":"vidaro-preset","version":1,"preset":{"name":""}}'), 'name-required');
    assertPresetError(() => store.importData('garbage'), 'invalid-file');
    assert.equal(store.list().length, BUILT_IN.length + 1);
  });

  test('import ignores prototype tricks in the file', () => {
    const text =
      '{"format":"vidaro-preset","version":1,"__proto__":{"polluted":true},"preset":{"name":"Tricky","__proto__":{"builtIn":true},"audio":{"__proto__":{"mode":"none"}}}}';
    const imported = store.importData(text);
    assert.equal(imported.name, 'Tricky');
    assert.equal(imported.builtIn, false);
    assert.equal(imported.audio.mode, 'encode');
    assert.equal({}.polluted, undefined);
    assert.equal({}.builtIn, undefined);
    assert.equal(Object.hasOwn(imported, '__proto__'), false);
  });

  test('subscribe notifies with the full list and unsubscribe stops it', () => {
    const calls = [];
    const unsubscribe = store.subscribe((list) => calls.push(list));
    const created = store.save(draft({ name: 'Watched' }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, BUILT_IN.length + 1);
    assert.equal(calls[0].at(-1).id, created.id);
    store.rename(created.id, 'Watched 2');
    store.remove(created.id);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].length, BUILT_IN.length);
    store.remove(created.id);
    assert.equal(calls.length, 3);
    unsubscribe();
    store.save(draft({ name: 'Silent' }));
    assert.equal(calls.length, 3);
  });

  test('a listener that throws does not break the save or other listeners', () => {
    const calls = [];
    store.subscribe(() => {
      throw new Error('window gone');
    });
    store.subscribe((list) => calls.push(list.length));
    const saved = store.save(draft({ name: 'Survives' }));
    assert.equal(saved.name, 'Survives');
    assert.deepEqual(calls, [BUILT_IN.length + 1]);
    assert.equal(store.get(saved.id).name, 'Survives');
  });

  test('a listener may unsubscribe itself while being notified', () => {
    const calls = [];
    const unsubscribe = store.subscribe(() => {
      calls.push('once');
      unsubscribe();
    });
    store.subscribe(() => calls.push('always'));
    store.save(draft({ name: 'One' }));
    store.save(draft({ name: 'Two' }));
    assert.deepEqual(calls, ['once', 'always', 'always']);
  });

  test('changes after dispose are written at once and leave no timer behind', () => {
    store.dispose();
    const saved = store.save(draft({ name: 'Late change' }));
    assert.equal(store.store.timer, null);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).presets[0].id, saved.id);
    store.remove(saved.id);
    assert.equal(store.store.timer, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).presets, []);
  });

  test('refuses more than the preset limit but still updates existing ones', () => {
    const base = validatePreset(draft({ name: 'Bulk' }));
    const presets = Array.from({ length: MAX_USER_PRESETS + 5 }, (_, index) => ({ ...base, id: `u-bulk${index}`, name: `Bulk ${index}` }));
    writeFile({ version: 1, presets });
    const list = reopen().list();
    assert.equal(list.length, BUILT_IN.length + MAX_USER_PRESETS);
    assert.equal(store.get(`u-bulk${MAX_USER_PRESETS}`), null);
    assertPresetError(() => store.save(draft({ name: 'One more' })), 'too-many');
    assertPresetError(() => store.duplicate('u-bulk0'), 'too-many');
    assertPresetError(() => store.importData(store.exportData('u-bulk0')), 'too-many');
    assert.equal(store.rename('u-bulk0', 'Renamed at the limit').name, 'Renamed at the limit');
    assert.equal(store.remove('u-bulk1'), true);
    assert.equal(store.save(draft({ name: 'Fits again' })).name, 'Fits again');
    assert.equal(store.list().length, BUILT_IN.length + MAX_USER_PRESETS);
  });

  test('dispose flushes pending writes and drops listeners', () => {
    const calls = [];
    store.subscribe(() => calls.push(1));
    const created = store.save(draft({ name: 'Flushed' }));
    store.dispose();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).presets[0].id, created.id);
    store.save(draft({ name: 'After dispose' }));
    assert.equal(calls.length, 1);
  });

  test('loading repairs a hand-edited file', () => {
    const good = validatePreset(draft({ id: 'u-good', name: 'Good' }));
    writeFile({
      version: 1,
      presets: [
        good,
        { ...good, name: 'Same id' },
        { ...good, id: undefined, name: 'No id' },
        { ...good, id: 'mp3-320', name: 'Built-in id' },
        { ...good, id: 'u-bad', name: '' },
        { ...good, id: 'u-empty', container: 'wav', audio: { mode: 'none' } },
        'junk',
        null
      ]
    });
    const list = reopen().list().slice(BUILT_IN.length);
    assert.deepEqual(
      list.map((preset) => preset.name),
      ['Built-in id', 'Good', 'No id', 'Same id']
    );
    assert.equal(list.find((preset) => preset.name === 'Good').id, 'u-good');
    for (const preset of list) assert.match(preset.id, /^u-/);
    assert.equal(new Set(list.map((preset) => preset.id)).size, 4);
  });

  test('loading makes hand-edited duplicate names unique, built-in names included', () => {
    const good = validatePreset(draft({ name: 'x' }));
    writeFile({
      version: 1,
      presets: [
        { ...good, id: 'u-a', name: 'Tape' },
        { ...good, id: 'u-b', name: 'TAPE' },
        { ...good, id: 'u-c', name: 'mp4 universal' },
        { ...good, id: 'u-d', name: 'Tape (2)' }
      ]
    });
    const names = Object.fromEntries(
      reopen()
        .list()
        .slice(BUILT_IN.length)
        .map((preset) => [preset.id, preset.name])
    );
    assert.deepEqual(names, { 'u-a': 'Tape', 'u-b': 'TAPE (2)', 'u-c': 'mp4 universal (2)', 'u-d': 'Tape (3)' });
    const lower = Object.values(names).map((name) => name.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });

  test('a saved preset with a non-ASCII name survives a reload', () => {
    const saved = store.save(draft({ name: 'Canción de año 🎬 日本' }));
    store.flush();
    assert.deepEqual(reopen().get(saved.id), saved);
  });

  test('a corrupt file keeps a backup and falls back to built-ins', () => {
    fs.writeFileSync(file, '{"version":1,"presets":[');
    const list = reopen().list();
    assert.equal(list.length, BUILT_IN.length);
    assert.equal(store.recovered, true);
    assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '{"version":1,"presets":[');
  });

  test('a file with a wrong shape is ignored', () => {
    writeFile({ version: 1, presets: { a: 1 } });
    assert.equal(reopen().list().length, BUILT_IN.length);
    writeFile([1, 2]);
    assert.equal(reopen().list().length, BUILT_IN.length);
  });

  test('explicit load returns the list', () => {
    store.save(draft({ name: 'Loaded' }));
    store.flush();
    const fresh = reopen();
    const list = fresh.load();
    assert.equal(list.at(-1).name, 'Loaded');
  });
});
