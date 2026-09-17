import { t } from '../../strings/index.js';

const s = t.presets.editor;

export const FASTSTART_CONTAINERS = ['mp4', 'mov', 'm4a'];
export const COMMON_AUDIO_BITRATES = [32, 48, 64, 96, 128, 160, 192, 224, 256, 320, 384, 448, 512, 640];
export const SETTING_KEYS = ['container', 'video', 'picture', 'audio', 'subtitles', 'output'];
export const SOFTWARE_ENCODERS = {
  h264: ['libx264', 'libopenh264'],
  hevc: ['libx265', 'libkvazaar'],
  av1: ['libsvtav1', 'libaom-av1', 'librav1e'],
  vp9: ['libvpx-vp9']
};

const RATE_LIMIT_MIN = 1;
const RATE_LIMIT_MAX = 240;
const NTSC_RATES = {
  '23.976': '24000/1001',
  '23.98': '24000/1001',
  '29.97': '30000/1001',
  '47.952': '48000/1001',
  '59.94': '60000/1001',
  '119.88': '120000/1001'
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorText(error, fallback) {
  const raw = error && typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : '';
  const match = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?([\s\S]*)$/.exec(raw);
  const text = (match ? match[1] : raw).trim();
  return text || fallback;
}

export function byName(a, b) {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
}

export function groupPresets(list) {
  const builtIn = [];
  const user = [];
  for (const preset of list || []) (preset.builtIn ? builtIn : user).push(preset);
  return { builtIn, user };
}

export function upsertPreset(list, preset) {
  const { builtIn, user } = groupPresets(list);
  const rest = user.filter((item) => item.id !== preset.id);
  return [...builtIn, ...[...rest, preset].sort(byName)];
}

export function removePresetFrom(list, id) {
  const next = (list || []).filter((item) => item.id !== id || item.builtIn);
  return next.length === (list || []).length ? list : next;
}

export function stripView(preset) {
  if (!isObject(preset)) return preset;
  const { tags, ...rest } = preset;
  return structuredClone(rest);
}

function isFieldSpec(spec) {
  return isObject(spec) && typeof spec.type === 'string';
}

export function validField(spec, value) {
  if (spec.type === 'enum') return spec.values.includes(value);
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'text') return typeof value === 'string' && value.length <= spec.maxLength;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.allowZero && value === 0) return true;
  if (spec.type === 'integer' && !Number.isInteger(value)) return false;
  return value >= spec.min && value <= spec.max;
}

function mergeGroup(group, base, saved) {
  const result = { ...base };
  for (const [key, spec] of Object.entries(group)) {
    if (!Object.hasOwn(saved, key) || !Object.hasOwn(base, key)) continue;
    if (isFieldSpec(spec)) {
      if (validField(spec, saved[key])) result[key] = saved[key];
    } else if (isObject(base[key]) && isObject(saved[key])) {
      result[key] = mergeGroup(spec, base[key], saved[key]);
    }
  }
  return result;
}

export function mergeSettings(base, saved, schema) {
  if (!isObject(base)) return base;
  const result = stripView(base);
  if (!isObject(saved) || !schema || !schema.fields) return result;
  for (const key of SETTING_KEYS) {
    const spec = schema.fields[key];
    if (!spec || !Object.hasOwn(saved, key)) continue;
    if (isFieldSpec(spec)) {
      if (validField(spec, saved[key])) result[key] = saved[key];
    } else if (isObject(result[key]) && isObject(saved[key])) {
      result[key] = mergeGroup(spec, result[key], saved[key]);
    }
  }
  return applyRules(result, schema);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

export function setIn(target, path, value) {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  if (keys.length === 0) return value;
  const [head, ...rest] = keys;
  const base = isObject(target) ? target : {};
  const current = base[head];
  const next = rest.length ? setIn(current, rest, value) : value;
  if (Object.is(current, next) && Object.hasOwn(base, head)) return target;
  return { ...base, [head]: next };
}

export function getIn(target, path) {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  let current = target;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function settingsOf(preset) {
  const result = {};
  if (!isObject(preset)) return result;
  for (const key of SETTING_KEYS) result[key] = preset[key];
  return result;
}

export function sameSettings(a, b) {
  if (!a || !b) return false;
  return deepEqual(settingsOf(a), settingsOf(b));
}

export function isAudioOnly(schema, container) {
  return Boolean(schema && schema.audioOnlyContainers && schema.audioOnlyContainers.includes(container));
}

export function supportsFaststart(schema, container) {
  const list = (schema && schema.faststartContainers) || FASTSTART_CONTAINERS;
  return list.includes(container);
}

export function isAudioMatroska(preset) {
  return preset.container === 'mkv' && preset.video.mode === 'none';
}

export function audioBitrateLimits(schema, codec, channels) {
  const monoMax = channels === 'mono' && schema.audioBitrateMaxMono ? schema.audioBitrateMaxMono[codec] : undefined;
  const min = (schema.audioBitrateMin && schema.audioBitrateMin[codec]) || 32;
  const max = monoMax || (schema.audioBitrateMax && schema.audioBitrateMax[codec]) || 640;
  return { min, max };
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

export function normalizeRate(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  let num;
  let den;
  const fraction = /^(\d{1,6})\/(\d{1,6})$/.exec(text);
  if (fraction) {
    num = Number(fraction[1]);
    den = Number(fraction[2]);
  } else if (/^\d{1,3}(\.\d{1,3})?$/.test(text)) {
    const canonical = String(Number(text));
    if (NTSC_RATES[canonical]) return NTSC_RATES[canonical];
    const [whole, part = ''] = canonical.split('.');
    num = Number(whole + part);
    den = 10 ** part.length;
  } else {
    return '';
  }
  if (num === 0 || den === 0) return '';
  const divisor = gcd(num, den);
  num /= divisor;
  den /= divisor;
  if (num / den < RATE_LIMIT_MIN || num / den > RATE_LIMIT_MAX) return '';
  return den === 1 ? String(num) : `${num}/${den}`;
}

export function rateText(rate) {
  const [num, den = '1'] = String(rate || '').split('/');
  const value = Number(num) / Number(den);
  return Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(3))) : '';
}

export function evenNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return clamp(Math.round(number / 2) * 2, min, max);
}

export function encoderFits(schema, codec, encoder) {
  if (encoder === 'auto') return true;
  const software = (schema && schema.softwareEncoders) || SOFTWARE_ENCODERS;
  return (software[codec] || []).includes(encoder) || String(encoder).startsWith(`${codec}_`);
}

export function applyRules(input, schema) {
  if (!schema || !isObject(input) || !schema.containerCodecs) return input;
  const codecs = schema.containerCodecs[input.container];
  if (!codecs) return input;
  const preset = structuredClone(input);
  const { video, picture, audio } = preset;
  if (isAudioOnly(schema, preset.container)) {
    video.mode = 'none';
    audio.tracks = 'first';
    preset.subtitles = 'drop';
    if (audio.mode === 'none') audio.mode = 'encode';
  } else if (!codecs.video.includes(video.codec)) {
    video.codec = codecs.video[0];
    video.encoder = 'auto';
  }
  if (video.mode === 'none' && audio.mode === 'none') audio.mode = 'encode';
  if (!codecs.audio.includes(audio.codec)) audio.codec = codecs.audio[0];
  if (!encoderFits(schema, video.codec, video.encoder)) video.encoder = 'auto';
  const profiles = (schema.videoProfiles && schema.videoProfiles[video.codec]) || ['auto'];
  const levels = (schema.videoLevels && schema.videoLevels[video.codec]) || ['auto'];
  if (!profiles.includes(video.profile)) video.profile = 'auto';
  if (!levels.includes(video.level)) video.level = 'auto';
  if (video.rateControl !== 'bitrate') video.twoPass = false;
  if (!video.maxrate) video.bufsize = 0;
  const size = schema.resolutionSizes && schema.resolutionSizes[picture.resolution];
  if (size) {
    picture.width = size.width;
    picture.height = size.height;
  }
  if (audio.codec !== 'mp3') audio.vbr = 0;
  if (audio.codec === 'opus') audio.sampleRate = 48000;
  const limits = audioBitrateLimits(schema, audio.codec, audio.channels);
  audio.bitrate = clamp(Number(audio.bitrate) || limits.min, limits.min, limits.max);
  if (!supportsFaststart(schema, preset.container)) preset.output = { ...preset.output, faststart: false };
  return deepEqual(preset, input) ? input : preset;
}

export function changePreset(preset, path, value, schema) {
  const key = Array.isArray(path) ? path.join('.') : path;
  let next = setIn(preset, key, value);
  if (next === preset) return preset;
  if (key === 'container') {
    const wasAudioOnly = isAudioOnly(schema, preset.container);
    const nowAudioOnly = isAudioOnly(schema, value);
    if (wasAudioOnly && !nowAudioOnly && next.video.mode === 'none') next = setIn(next, 'video.mode', 'encode');
    if (!supportsFaststart(schema, preset.container) && supportsFaststart(schema, value)) next = setIn(next, 'output.faststart', true);
  }
  if (key === 'video.codec' && value !== preset.video.codec) next = setIn(next, 'video.encoder', 'auto');
  if (key === 'picture.fps' && value === 'custom' && !next.picture.customFps) next = setIn(next, 'picture.customFps', '');
  if (key === 'picture.resolution' && value === 'custom' && preset.picture.resolution !== 'custom') {
    next = setIn(next, 'picture.width', evenNumber(preset.picture.width, 16, 7680));
    next = setIn(next, 'picture.height', evenNumber(preset.picture.height, 16, 4320));
  }
  return applyRules(next, schema);
}

export function presetProblems(preset) {
  const problems = [];
  if (!preset) return problems;
  if (preset.video.mode === 'encode' && preset.picture.fps === 'custom' && !normalizeRate(preset.picture.customFps)) {
    problems.push({ field: 'picture.customFps', message: s.customFpsInvalid });
  }
  return problems;
}

export function containerLabel(container) {
  return s.containers[container] || String(container || '').toUpperCase();
}

export function containerOptions(schema) {
  if (!schema) return [];
  return schema.containers.map((value) => ({ value, label: containerLabel(value) }));
}

export function kindOf(schema, container) {
  return isAudioOnly(schema, container) ? 'audio' : 'video';
}

export function containersOfKind(schema, kind) {
  if (!schema) return [];
  return schema.containers.filter((container) => kindOf(schema, container) === kind);
}

export function changeKind(preset, kind, schema) {
  if (kindOf(schema, preset.container) === kind) return preset;
  const [first] = containersOfKind(schema, kind);
  return first ? changePreset(preset, 'container', first, schema) : preset;
}

export function videoModeOptions(preset, schema) {
  const audioOnly = isAudioOnly(schema, preset.container);
  return ['encode', 'copy', 'none'].map((value) => ({
    value,
    label: s.modes[value],
    disabled: audioOnly || (value === 'none' && preset.audio.mode === 'none')
  }));
}

export function audioModeOptions(preset, schema) {
  const audioOnly = isAudioOnly(schema, preset.container);
  return ['encode', 'copy', 'none'].map((value) => ({
    value,
    label: s.modes[value],
    disabled: value === 'none' && (audioOnly || preset.video.mode === 'none')
  }));
}

export function videoCodecOptions(schema, container) {
  const codecs = (schema && schema.containerCodecs[container] && schema.containerCodecs[container].video) || [];
  return codecs.map((value) => ({ value, label: s.videoCodecs[value] || value }));
}

export function audioCodecOptions(schema, container) {
  const codecs = (schema && schema.containerCodecs[container] && schema.containerCodecs[container].audio) || [];
  return codecs.map((value) => ({ value, label: s.audioCodecs[value] || value }));
}

export function encoderLabel(view, name) {
  if (name === 'auto') return s.encoderAuto;
  return (view && view.encoders && view.encoders[name] && view.encoders[name].label) || name;
}

export function encoderOptions(view, codec, current) {
  const options = [{ value: 'auto', label: s.encoderAuto }];
  const list = (view && view.available && view.available[codec]) || [];
  const broken = new Set((view && view.broken) || []);
  for (const name of list) {
    const label = encoderLabel(view, name);
    options.push({ value: name, label: broken.has(name) ? s.encoderBroken(label) : label });
  }
  if (current && current !== 'auto' && !list.includes(current)) {
    options.push({ value: current, label: s.encoderMissing(encoderLabel(view, current)) });
  }
  return options;
}

export function isSoftwareEncoder(view, name) {
  if (!name || name === 'auto') return false;
  const info = view && view.encoders && view.encoders[name];
  if (info) return !info.hardware;
  return name.startsWith('lib');
}

export function twoPassAvailable(preset) {
  return preset.video.codec === 'h264' && (preset.video.encoder === 'auto' || preset.video.encoder === 'libx264');
}

export function profileOptions(schema, codec) {
  const list = (schema && schema.videoProfiles[codec]) || ['auto'];
  return list.map((value) => ({ value, label: s.profiles[value] || value }));
}

export function levelOptions(schema, codec) {
  const list = (schema && schema.videoLevels[codec]) || ['auto'];
  return list.map((value) => ({ value, label: value === 'auto' ? s.levelAuto : value }));
}

export function resolutionOptions(schema) {
  if (!schema) return [];
  const values = schema.fields.picture.resolution.values;
  return values.map((value) => {
    if (value === 'keep') return { value, label: s.resolutionKeep };
    if (value === 'custom') return { value, label: s.resolutionCustom };
    const size = schema.resolutionSizes[value];
    return { value, label: size ? s.resolutionOption(value, size.width, size.height) : value };
  });
}

export function fpsOptions(schema) {
  if (!schema) return [];
  return schema.fields.picture.fps.values.map((value) => {
    if (value === 'keep') return { value, label: s.frameRateKeep };
    if (value === 'custom') return { value, label: s.frameRateCustom };
    return { value, label: `${rateText(value)} ${s.fps}` };
  });
}

export function fitOptions(schema) {
  const values = schema ? schema.fields.picture.fit.values : ['pad', 'crop', 'stretch', 'fit'];
  return values.map((value) => ({ value, label: s.fits[value] || value }));
}

export function triStateOptions(values = ['auto', 'off', 'on']) {
  return values.map((value) => ({ value, label: s.triState[value] || value }));
}

export function rotateOptions(schema) {
  const values = schema ? schema.fields.picture.rotate.values : [0, 90, 180, 270];
  return values.map((value) => ({ value, label: s.rotations[value] || `${value}°` }));
}

export function audioBitrateOptions(schema, codec, channels, current) {
  const limits = audioBitrateLimits(schema, codec, channels);
  const values = COMMON_AUDIO_BITRATES.filter((value) => value >= limits.min && value <= limits.max);
  if (Number.isFinite(current) && !values.includes(current)) {
    values.push(current);
    values.sort((a, b) => a - b);
  }
  return values.map((value) => ({ value, label: s.kbpsValue(value) }));
}

export function vbrOptions(schema) {
  const field = schema ? schema.fields.audio.vbr : { min: 0, max: 9 };
  const options = [];
  for (let value = field.min; value <= field.max; value += 1) {
    options.push({ value, label: value === 0 ? s.vbrOff : s.vbrLevel(value - 1) });
  }
  return options;
}

export function sampleRateOptions(schema) {
  const values = schema ? schema.fields.audio.sampleRate.values : ['keep', 44100, 48000];
  return values.map((value) => ({ value, label: s.sampleRates[value] || String(value) }));
}

export function channelOptions(schema) {
  const values = schema ? schema.fields.audio.channels.values : ['keep', 'stereo', 'mono'];
  return values.map((value) => ({ value, label: s.channelOptions[value] || value }));
}

export function loudnessOptions(schema) {
  const values = schema ? schema.fields.audio.loudness.values : ['off', 'ebu', 'atsc', 'streaming'];
  return values.map((value) => ({ value, label: s.loudnessOptions[value] || value }));
}

export function qualityLevel(quality) {
  if (quality <= 16) return 'veryHigh';
  if (quality <= 20) return 'high';
  if (quality <= 24) return 'good';
  if (quality <= 28) return 'medium';
  if (quality <= 34) return 'low';
  return 'veryLow';
}

export function qualityText(quality) {
  return s.qualityValue(quality, s.qualityLevels[qualityLevel(quality)]);
}

export function sliderFromQuality(quality, field) {
  return field.min + field.max - quality;
}

export function qualityFromSlider(value, field) {
  return clamp(Math.round(field.min + field.max - value), field.min, field.max);
}

function audioTag(audio, audioOnly) {
  const tags = s.summary;
  if (audio.mode === 'copy') return audioOnly ? tags.copy : tags.audioCopy;
  if (audio.mode === 'none') return tags.noAudio;
  const label = s.audioCodecTags[audio.codec] || audio.codec;
  if (audio.codec === 'pcm') return audioOnly ? tags.pcm : label;
  if (audio.codec === 'flac') return audioOnly ? tags.lossless : label;
  if (audio.codec === 'mp3' && audio.vbr > 0) return audioOnly ? tags.vbr(audio.vbr - 1) : `${label} V${audio.vbr - 1}`;
  if (audioOnly && (audio.codec === 'mp3' || audio.codec === 'opus')) return `${audio.bitrate}k`;
  return `${label} ${audio.bitrate}k`;
}

function videoTags(preset) {
  const { container, video, picture } = preset;
  if (video.mode === 'copy') return [s.summary.videoCopy];
  if (video.mode === 'none') return container === 'mkv' ? [] : [s.summary.noVideo];
  const tags = [s.videoCodecTags[video.codec] || video.codec];
  if (picture.resolution === 'custom') tags.push(`${picture.width}×${picture.height}`);
  else if (picture.resolution !== 'keep') tags.push(picture.resolution);
  const rate = picture.fps === 'custom' ? normalizeRate(picture.customFps) : picture.fps === 'keep' ? '' : picture.fps;
  if (rate) tags.push(s.summary.fpsTag(rateText(rate)));
  return tags;
}

export function presetTags(preset, schema) {
  if (!preset || !preset.video) return [];
  const audioOnly = isAudioOnly(schema, preset.container);
  const tags = [s.containerTags[isAudioMatroska(preset) ? 'mka' : preset.container] || preset.container];
  if (!audioOnly) tags.push(...videoTags(preset));
  const { audio } = preset;
  tags.push(audioTag(audio, audioOnly));
  if (audioOnly && audio.mode === 'encode' && (audio.codec === 'pcm' || audio.codec === 'flac') && audio.sampleRate !== 'keep') {
    tags.push(s.summary.khz(audio.sampleRate / 1000));
  }
  if (audio.mode === 'encode' && audio.loudness !== 'off') tags.push(s.loudnessTags[audio.loudness]);
  return tags;
}

function formatSummary(preset, schema) {
  const parts = [s.containerTags[isAudioMatroska(preset) ? 'mka' : preset.container] || preset.container];
  if (!isAudioOnly(schema, preset.container) && preset.subtitles === 'keep') parts.push(s.summary.subtitles);
  if (preset.output.faststart && supportsFaststart(schema, preset.container)) parts.push(s.summary.fastStart);
  return parts.join(' · ');
}

function videoSummary(preset, schema, view) {
  const { video } = preset;
  if (isAudioOnly(schema, preset.container) || video.mode === 'none') return s.summary.noVideo;
  if (video.mode === 'copy') return s.summary.copy;
  const parts = [s.videoCodecTags[video.codec] || video.codec];
  if (video.rateControl === 'bitrate') {
    parts.push(s.summary.kbps(video.bitrate));
    if (video.twoPass) parts.push(s.summary.twoPass);
  } else {
    parts.push(s.summary.quality(video.quality));
  }
  if (video.encoder !== 'auto') parts.push(encoderLabel(view, video.encoder));
  return parts.join(' · ');
}

function pictureSummary(preset, schema) {
  const { video, picture } = preset;
  if (isAudioOnly(schema, preset.container) || video.mode !== 'encode') return s.summary.notUsed;
  const parts = [];
  if (picture.resolution === 'keep') parts.push(s.summary.keepSize);
  else if (picture.resolution === 'custom') parts.push(`${picture.width}×${picture.height}`);
  else parts.push(picture.resolution);
  if (picture.resolution !== 'keep') parts.push(s.fits[picture.fit]);
  const rate = picture.fps === 'custom' ? normalizeRate(picture.customFps) : picture.fps === 'keep' ? '' : picture.fps;
  parts.push(rate ? s.summary.fpsTag(rateText(rate)) : s.summary.keepRate);
  if (picture.ivtc === 'on') parts.push(s.summary.ivtc);
  if (picture.deinterlace === 'on') parts.push(s.summary.deinterlace);
  if (Number(picture.rotate)) parts.push(s.summary.rotated(picture.rotate));
  if (picture.flipH || picture.flipV) parts.push(s.summary.flipped);
  const crop = picture.crop || {};
  if (crop.top || crop.bottom || crop.left || crop.right) parts.push(s.summary.cropped);
  return parts.join(' · ');
}

function audioSummary(preset, schema) {
  const { audio } = preset;
  if (audio.mode === 'none') return s.summary.noAudio;
  const parts = [];
  if (audio.mode === 'copy') {
    parts.push(s.summary.copy);
  } else {
    const label = s.audioCodecTags[audio.codec] || audio.codec;
    if (audio.codec === 'pcm' || audio.codec === 'flac') parts.push(label);
    else if (audio.codec === 'mp3' && audio.vbr > 0) parts.push(`${label} ${s.summary.vbr(audio.vbr - 1)}`);
    else parts.push(`${label} ${s.summary.kbps(audio.bitrate)}`);
    if (audio.sampleRate !== 'keep') parts.push(s.summary.khz(audio.sampleRate / 1000));
    if (audio.channels !== 'keep') parts.push(s.channelOptions[audio.channels]);
    if (audio.volumeDb) parts.push(s.volumeValue(audio.volumeDb));
    if (audio.loudness !== 'off') parts.push(s.loudnessTags[audio.loudness]);
  }
  if (audio.tracks === 'all' && !isAudioOnly(schema, preset.container)) parts.push(s.summary.allTracks);
  return parts.join(' · ');
}

export function sectionSummaries(preset, schema, view) {
  if (!preset || !schema) return { format: '', video: '', picture: '', audio: '' };
  return {
    format: formatSummary(preset, schema),
    video: videoSummary(preset, schema, view),
    picture: pictureSummary(preset, schema),
    audio: audioSummary(preset, schema)
  };
}
