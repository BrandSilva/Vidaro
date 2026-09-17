const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const presets = require('../src/main/presets');

process.removeAllListeners('warning');

const ROOT = path.join(__dirname, '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

let model;
const schema = structuredClone(presets.SCHEMA);

test.before(async () => {
  model = await load('src/renderer/components/preset/model.js');
});

function viewOf(preset) {
  return { ...structuredClone(preset), tags: presets.summarize(preset) };
}

function builtIn(id) {
  return viewOf(presets.BUILT_IN.find((preset) => preset.id === id));
}

function settings(preset) {
  const { container, video, picture, audio, subtitles, output } = preset;
  return structuredClone({ container, video, picture, audio, subtitles, output });
}

function mainNormalized(preset) {
  return settings(presets.validatePreset({ ...preset, name: preset.name || 'Test' }, { allowBuiltInId: true }));
}

function randomizer(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function enumPaths(group, prefix = '') {
  const paths = [];
  for (const [key, spec] of Object.entries(group)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof spec.type !== 'string') paths.push(...enumPaths(spec, full));
    else if (spec.type === 'enum' || spec.type === 'boolean') paths.push({ path: full, spec });
    else if (spec.type === 'integer' || spec.type === 'number') paths.push({ path: full, spec });
  }
  return paths;
}

function pickValue(spec, random) {
  if (spec.type === 'enum') return spec.values[Math.floor(random() * spec.values.length)];
  if (spec.type === 'boolean') return random() < 0.5;
  const span = spec.max - spec.min;
  let value = spec.min + random() * span;
  if (spec.type === 'integer') value = Math.round(value);
  else value = Math.round(value * 10) / 10;
  if (spec.even) value = Math.round(value / 2) * 2;
  if (spec.allowZero && random() < 0.3) value = 0;
  return Math.min(spec.max, Math.max(spec.allowZero ? 0 : spec.min, value));
}

test('applyRules leaves every built-in preset unchanged', () => {
  for (const preset of presets.BUILT_IN) {
    const view = viewOf(preset);
    assert.equal(model.applyRules(view, schema), view, preset.id);
  }
});

test('presetTags matches the main summarize for built-ins', () => {
  for (const preset of presets.BUILT_IN) {
    assert.deepEqual(model.presetTags(viewOf(preset), schema), presets.summarize(preset), preset.id);
  }
});

test('random editor changes always produce presets the main validator keeps as they are', () => {
  const random = randomizer(20260916);
  const fields = enumPaths(schema.fields).filter((item) => !['name', 'description'].includes(item.path));
  const encoderNames = ['auto', 'libx264', 'h264_qsv', 'h264_nvenc', 'libx265', 'hevc_amf', 'libaom-av1', 'libvpx-vp9'];
  for (const start of presets.BUILT_IN) {
    let preset = viewOf(start);
    for (let step = 0; step < 400; step += 1) {
      const roll = random();
      let next;
      if (roll < 0.05) next = model.changePreset(preset, 'video.encoder', encoderNames[Math.floor(random() * encoderNames.length)], schema);
      else if (roll < 0.08) next = model.changePreset(preset, 'picture.customFps', ['15', '29.97', '30000/1001', '12.5'][Math.floor(random() * 4)], schema);
      else if (roll < 0.1) next = model.changeKind(preset, random() < 0.5 ? 'audio' : 'video', schema);
      else {
        const field = fields[Math.floor(random() * fields.length)];
        const value = pickValue(field.spec, random);
        if (field.path === 'video.mode' || field.path === 'audio.mode') {
          const options = field.path === 'video.mode' ? model.videoModeOptions(preset, schema) : model.audioModeOptions(preset, schema);
          const option = options.find((item) => item.value === value);
          if (option && option.disabled) continue;
        }
        if (field.path === 'picture.fps' && value === 'custom' && !model.normalizeRate(preset.picture.customFps)) continue;
        next = model.changePreset(preset, field.path, value, schema);
      }
      assert.equal(model.encoderFits(schema, next.video.codec, next.video.encoder), true, `${start.id} encoder step ${step}`);
      const expected = mainNormalized(next);
      const actual = settings(next);
      if (actual.picture.customFps) actual.picture.customFps = model.normalizeRate(actual.picture.customFps);
      assert.deepEqual(actual, expected, `${start.id} step ${step}`);
      assert.deepEqual(model.presetTags(next, schema), presets.summarize(presets.validatePreset({ ...next, name: 'x' })), `${start.id} tags step ${step}`);
      preset = next;
    }
  }
});

test('switching to an audio format and back restores a normal video preset', () => {
  const mp4 = builtIn('mp4-universal');
  const mp3 = model.changePreset(mp4, 'container', 'mp3', schema);
  assert.equal(mp3.video.mode, 'none');
  assert.equal(mp3.audio.codec, 'mp3');
  assert.equal(mp3.audio.tracks, 'first');
  assert.equal(mp3.subtitles, 'drop');
  assert.equal(mp3.output.faststart, false);
  const back = model.changePreset(mp3, 'container', 'mp4', schema);
  assert.equal(back.video.mode, 'encode');
  assert.equal(back.audio.codec, 'mp3');
  assert.equal(back.output.faststart, true);
  const kind = model.changeKind(back, 'audio', schema);
  assert.equal(kind.container, 'mp3');
  assert.equal(model.changeKind(kind, 'audio', schema), kind);
});

test('wav to mp4 picks a codec the container accepts', () => {
  const wav = builtIn('wav-48k');
  const mp4 = model.changePreset(wav, 'container', 'mp4', schema);
  assert.equal(mp4.audio.codec, 'aac');
  assert.equal(mp4.video.mode, 'encode');
  const webm = model.changePreset(mp4, 'container', 'webm', schema);
  assert.equal(webm.video.codec, 'vp9');
  assert.equal(webm.audio.codec, 'opus');
  assert.equal(webm.audio.sampleRate, 48000);
  assert.equal(webm.video.profile, 'auto');
});

test('changing the codec resets a forced encoder and profile', () => {
  const base = model.changePreset(builtIn('flowair-1080p'), 'video.encoder', 'h264_qsv', schema);
  assert.equal(base.video.encoder, 'h264_qsv');
  const hevc = model.changePreset(base, 'video.codec', 'hevc', schema);
  assert.equal(hevc.video.encoder, 'auto');
  assert.equal(hevc.video.profile, 'auto');
});

test('changePreset returns the same object when nothing changes', () => {
  const preset = builtIn('mp4-universal');
  assert.equal(model.changePreset(preset, 'container', 'mp4', schema), preset);
  assert.equal(model.changePreset(preset, 'video.quality', preset.video.quality, schema), preset);
});

test('changePreset never mutates its input', () => {
  const preset = builtIn('flowair-720p');
  const frozen = structuredClone(preset);
  model.changePreset(preset, 'container', 'wav', schema);
  model.changePreset(preset, 'picture.crop.top', 8, schema);
  assert.deepEqual(preset, frozen);
});

test('mode options block removing both tracks', () => {
  const noAudio = model.changePreset(builtIn('mp4-universal'), 'audio.mode', 'none', schema);
  const video = model.videoModeOptions(noAudio, schema);
  assert.equal(video.find((item) => item.value === 'none').disabled, true);
  const noVideo = model.changePreset(builtIn('mp4-universal'), 'video.mode', 'none', schema);
  assert.equal(model.audioModeOptions(noVideo, schema).find((item) => item.value === 'none').disabled, true);
  const mp3 = builtIn('mp3-320');
  assert.ok(model.videoModeOptions(mp3, schema).every((item) => item.disabled));
  assert.equal(model.audioModeOptions(mp3, schema).find((item) => item.value === 'none').disabled, true);
  assert.equal(model.audioModeOptions(mp3, schema).find((item) => item.value === 'copy').disabled, false);
});

test('custom resolution starts from the current size, rounded to even numbers', () => {
  const preset = builtIn('flowair-720p');
  const custom = model.changePreset(preset, 'picture.resolution', 'custom', schema);
  assert.equal(custom.picture.width, 1280);
  assert.equal(custom.picture.height, 720);
  assert.equal(model.evenNumber(1281, 16, 7680), 1282);
  assert.equal(model.evenNumber(3, 16, 7680), 16);
  assert.equal(model.evenNumber('x', 0, 100), 0);
});

test('presetProblems flags an invalid custom frame rate', () => {
  let preset = model.changePreset(builtIn('mp4-universal'), 'picture.fps', 'custom', schema);
  assert.equal(preset.picture.fps, 'custom');
  assert.equal(model.presetProblems(preset).length, 1);
  preset = model.changePreset(preset, 'picture.customFps', '29.97', schema);
  assert.deepEqual(model.presetProblems(preset), []);
  const copy = model.changePreset(preset, 'video.mode', 'copy', schema);
  assert.deepEqual(model.presetProblems(model.changePreset(copy, 'picture.customFps', 'abc', schema)), []);
});

test('normalizeRate matches the main implementation', () => {
  const inputs = ['', '0', '1', '15', '23.976', '23.98', '29.97', '59.94', '119.88', '25.0', '30000/1001', '60/2', '241', '0.5', '12.5', 'abc', '1/0', ' 24 ', '240', '1000000/1'];
  for (const input of inputs) assert.equal(model.normalizeRate(input), presets.normalizeRate(input), input);
  assert.equal(model.rateText('30000/1001'), '29.97');
  assert.equal(model.rateText('24000/1001'), '23.976');
  assert.equal(model.rateText('25'), '25');
  assert.equal(model.rateText(''), '');
});

test('mergeSettings keeps valid saved values and drops invalid ones', () => {
  const base = builtIn('mp4-universal');
  const saved = {
    container: 'mkv',
    video: { quality: 23, mode: 'bogus', speed: 'quality', extra: 1 },
    picture: { rotate: 90, crop: { top: 8, left: 'x' }, fps: '30000/1001' },
    audio: { sampleRate: 44100, bitrate: 9999, loudness: 'ebu' },
    subtitles: 'keep',
    output: { faststart: 'yes' },
    name: 'Ignored'
  };
  const merged = model.mergeSettings(base, saved, schema);
  assert.equal(merged.container, 'mkv');
  assert.equal(merged.video.quality, 23);
  assert.equal(merged.video.mode, base.video.mode);
  assert.equal(merged.video.speed, 'quality');
  assert.equal('extra' in merged.video, false);
  assert.equal(merged.picture.rotate, 90);
  assert.equal(merged.picture.crop.top, 8);
  assert.equal(merged.picture.crop.left, 0);
  assert.equal(merged.picture.fps, '30000/1001');
  assert.equal(merged.audio.sampleRate, 44100);
  assert.equal(merged.audio.bitrate, base.audio.bitrate);
  assert.equal(merged.audio.loudness, 'ebu');
  assert.equal(merged.subtitles, 'keep');
  assert.equal(merged.output.faststart, false);
  assert.equal(merged.name, base.name);
  assert.equal('tags' in merged, false);
  assert.deepEqual(settings(merged), mainNormalized(merged));
  const plain = model.mergeSettings(base, null, schema);
  assert.equal(model.sameSettings(plain, base), true);
  assert.notEqual(plain.video, base.video);
});

test('sameSettings ignores names, ids and tags', () => {
  const a = builtIn('mobile');
  const b = { ...structuredClone(a), id: 'u-1', name: 'Other', tags: [] };
  assert.equal(model.sameSettings(a, b), true);
  assert.equal(model.sameSettings(a, model.changePreset(a, 'audio.bitrate', 160, schema)), false);
  assert.equal(model.sameSettings(a, null), false);
});

test('setIn and getIn work immutably on nested paths', () => {
  const source = { a: { b: { c: 1 } }, d: 2 };
  const next = model.setIn(source, 'a.b.c', 5);
  assert.equal(source.a.b.c, 1);
  assert.equal(next.a.b.c, 5);
  assert.equal(next.d, 2);
  assert.equal(model.setIn(source, 'a.b.c', 1), source);
  assert.equal(model.getIn(next, ['a', 'b', 'c']), 5);
  assert.equal(model.getIn(next, 'a.x.y'), undefined);
  assert.equal(model.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(model.deepEqual({ a: [1] }, { a: [1, 2] }), false);
});

test('errorText strips the Electron IPC prefix', () => {
  const error = new Error("Error invoking remote method 'presets:save': Error: Give the preset a name.");
  assert.equal(model.errorText(error, 'x'), 'Give the preset a name.');
  assert.equal(model.errorText(new Error('Plain message'), 'x'), 'Plain message');
  assert.equal(model.errorText(null, 'Fallback'), 'Fallback');
  assert.equal(model.errorText(new Error("Error invoking remote method 'a': Error: "), 'Fallback'), 'Fallback');
});

test('quality slider runs from low to high quality and round-trips', () => {
  const field = schema.fields.video.quality;
  for (let quality = field.min; quality <= field.max; quality += 1) {
    const slider = model.sliderFromQuality(quality, field);
    assert.equal(model.qualityFromSlider(slider, field), quality);
  }
  assert.ok(model.sliderFromQuality(18, field) > model.sliderFromQuality(28, field));
  assert.equal(model.qualityLevel(16), 'veryHigh');
  assert.equal(model.qualityLevel(18), 'high');
  assert.equal(model.qualityLevel(23), 'good');
  assert.equal(model.qualityLevel(26), 'medium');
  assert.equal(model.qualityLevel(30), 'low');
  assert.equal(model.qualityLevel(40), 'veryLow');
  assert.equal(model.qualityText(18), '18 (high)');
});

test('encoder options list detected encoders and keep a forced missing one', () => {
  const view = {
    status: 'ready',
    available: { h264: ['h264_qsv', 'libx264'], hevc: ['libx265'], av1: [], vp9: [] },
    broken: ['h264_qsv'],
    encoders: { h264_qsv: { label: 'Intel Quick Sync', hardware: true }, libx264: { label: 'Software (x264)', hardware: false }, h264_nvenc: { label: 'NVIDIA NVENC', hardware: true } }
  };
  const options = model.encoderOptions(view, 'h264', 'h264_nvenc');
  assert.deepEqual(
    options.map((item) => item.value),
    ['auto', 'h264_qsv', 'libx264', 'h264_nvenc']
  );
  assert.match(options[1].label, /Intel Quick Sync/);
  assert.match(options[1].label, /failed/);
  assert.match(options[3].label, /not on this PC/);
  assert.deepEqual(model.encoderOptions(null, 'h264', 'auto').map((item) => item.value), ['auto']);
  assert.equal(model.isSoftwareEncoder(view, 'libx264'), true);
  assert.equal(model.isSoftwareEncoder(view, 'h264_qsv'), false);
  assert.equal(model.isSoftwareEncoder(null, 'libx265'), true);
  assert.equal(model.twoPassAvailable(builtIn('mp4-universal')), true);
  assert.equal(model.twoPassAvailable(model.changePreset(builtIn('mp4-universal'), 'video.encoder', 'h264_qsv', schema)), false);
});

test('option builders use the schema', () => {
  assert.deepEqual(
    model.resolutionOptions(schema).map((item) => item.value),
    schema.fields.picture.resolution.values
  );
  assert.match(model.resolutionOptions(schema).find((item) => item.value === '1080p').label, /1920×1080/);
  assert.deepEqual(
    model.fpsOptions(schema).map((item) => item.value),
    schema.fields.picture.fps.values
  );
  assert.match(model.fpsOptions(schema).find((item) => item.value === '30000/1001').label, /^29\.97/);
  assert.deepEqual(
    model.videoCodecOptions(schema, 'webm').map((item) => item.value),
    ['vp9', 'av1']
  );
  assert.deepEqual(
    model.audioCodecOptions(schema, 'wav').map((item) => item.value),
    ['pcm']
  );
  assert.deepEqual(
    model.containersOfKind(schema, 'audio'),
    schema.audioOnlyContainers
  );
  assert.equal(model.vbrOptions(schema).length, 10);
  assert.match(model.vbrOptions(schema)[1].label, /V0/);
  assert.deepEqual(
    model.profileOptions(schema, 'vp9').map((item) => item.value),
    ['auto']
  );
  assert.deepEqual(
    model.rotateOptions(schema).map((item) => item.value),
    [0, 90, 180, 270]
  );
});

test('audio bitrate options respect codec and mono limits', () => {
  const opusMono = model.audioBitrateOptions(schema, 'opus', 'mono', 192).map((item) => item.value);
  assert.equal(Math.max(...opusMono), 256);
  const mp3 = model.audioBitrateOptions(schema, 'mp3', 'stereo', 200).map((item) => item.value);
  assert.equal(Math.max(...mp3), 320);
  assert.ok(mp3.includes(200));
  assert.deepEqual(mp3, [...mp3].sort((a, b) => a - b));
  const vorbis = model.audioBitrateOptions(schema, 'vorbis', 'stereo', 192).map((item) => item.value);
  assert.equal(Math.min(...vorbis), 48);
});

test('preset lists keep built-ins first and user presets sorted by name', () => {
  const list = [builtIn('mp4-universal'), builtIn('mp3-320'), { ...builtIn('mobile'), id: 'u-b', name: 'beta', builtIn: false }];
  const added = model.upsertPreset(list, { ...builtIn('mobile'), id: 'u-a', name: 'Alpha', builtIn: false });
  assert.deepEqual(
    added.map((item) => item.id),
    ['mp4-universal', 'mp3-320', 'u-a', 'u-b']
  );
  const renamed = model.upsertPreset(added, { ...added[2], name: 'zulu' });
  assert.deepEqual(
    renamed.map((item) => item.id),
    ['mp4-universal', 'mp3-320', 'u-b', 'u-a']
  );
  assert.deepEqual(
    model.removePresetFrom(renamed, 'u-b').map((item) => item.id),
    ['mp4-universal', 'mp3-320', 'u-a']
  );
  assert.equal(model.removePresetFrom(renamed, 'mp4-universal'), renamed);
  const groups = model.groupPresets(renamed);
  assert.equal(groups.builtIn.length, 2);
  assert.equal(groups.user.length, 2);
});

test('section summaries describe the preset briefly', () => {
  const summaries = model.sectionSummaries(builtIn('flowair-1080p'), schema, null);
  assert.equal(summaries.format, 'MP4 · Fast start');
  assert.equal(summaries.video, 'H.264 · Quality 18');
  assert.equal(summaries.picture, '1080p · Pad · Original rate');
  assert.equal(summaries.audio, 'AAC 192 kbps · 48 kHz · Stereo');
  const archive = model.sectionSummaries(builtIn('archive-remux'), schema, null);
  assert.equal(archive.format, 'MKV · Subtitles');
  assert.equal(archive.video, 'Copy');
  assert.equal(archive.picture, 'Not used');
  assert.equal(archive.audio, 'Copy · All tracks');
  const mp3 = model.sectionSummaries(builtIn('mp3-vbr'), schema, null);
  assert.equal(mp3.format, 'MP3');
  assert.equal(mp3.video, 'No video');
  assert.equal(mp3.audio, 'MP3 VBR V0 · 44.1 kHz · Stereo');
  const extract = model.sectionSummaries(builtIn('extract-audio'), schema, null);
  assert.equal(extract.format, 'MKA');
  const forced = model.changePreset(builtIn('mp4-universal'), 'video.encoder', 'h264_qsv', schema);
  const view = { encoders: { h264_qsv: { label: 'Intel Quick Sync', hardware: true } } };
  assert.equal(model.sectionSummaries(forced, schema, view).video, 'H.264 · Quality 20 · Intel Quick Sync');
  assert.deepEqual(model.sectionSummaries(null, schema, null), { format: '', video: '', picture: '', audio: '' });
});

test('validField follows the schema field rules', () => {
  const video = schema.fields.video;
  assert.equal(model.validField(video.maxrate, 0), true);
  assert.equal(model.validField(video.maxrate, 50), false);
  assert.equal(model.validField(video.quality, 18.5), false);
  assert.equal(model.validField(video.keyframeSeconds, 2.5), true);
  assert.equal(model.validField(video.encoder, 'h264_qsv'), true);
  assert.equal(model.validField(schema.fields.audio.sampleRate, 'keep'), true);
  assert.equal(model.validField(schema.fields.audio.sampleRate, '48000'), false);
});
