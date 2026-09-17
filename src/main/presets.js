const crypto = require('node:crypto');
const { JsonStore, isPlainObject } = require('./store');

const PRESET_VERSION = 1;
const FILE_VERSION = 1;
const EXPORT_FORMAT = 'vidaro-preset';
const EXPORT_EXTENSION = 'vidaropreset';
const MAX_USER_PRESETS = 500;
const MAX_IMPORT_LENGTH = 256 * 1024;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const CONTAINERS = ['mp4', 'mkv', 'mov', 'webm', 'mp3', 'm4a', 'wav', 'flac', 'opus'];
const AUDIO_ONLY_CONTAINERS = ['mp3', 'm4a', 'wav', 'flac', 'opus'];
const FASTSTART_CONTAINERS = ['mp4', 'mov', 'm4a'];
const VIDEO_CODECS = ['h264', 'hevc', 'av1', 'vp9'];
const AUDIO_CODECS = ['aac', 'mp3', 'opus', 'ac3', 'pcm', 'flac', 'vorbis'];

const CONTAINER_CODECS = {
  mp4: { video: ['h264', 'hevc', 'av1', 'vp9'], audio: ['aac', 'mp3', 'opus', 'ac3', 'flac'] },
  mkv: { video: VIDEO_CODECS, audio: AUDIO_CODECS },
  mov: { video: ['h264', 'hevc'], audio: ['aac', 'mp3', 'ac3', 'pcm'] },
  webm: { video: ['vp9', 'av1'], audio: ['opus', 'vorbis'] },
  mp3: { video: [], audio: ['mp3'] },
  m4a: { video: [], audio: ['aac'] },
  wav: { video: [], audio: ['pcm'] },
  flac: { video: [], audio: ['flac'] },
  opus: { video: [], audio: ['opus'] }
};

const AUDIO_BITRATE_MAX = { aac: 512, mp3: 320, opus: 510, ac3: 640, pcm: 640, flac: 640, vorbis: 500 };
const AUDIO_BITRATE_MIN = { aac: 32, mp3: 32, opus: 32, ac3: 32, pcm: 32, flac: 32, vorbis: 48 };
const MONO_BITRATE_MAX = { opus: 256, vorbis: 240 };

const RESOLUTION_SIZES = {
  '480p': { width: 854, height: 480 },
  '576p': { width: 1024, height: 576 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 }
};

const VIDEO_PROFILES = {
  h264: ['auto', 'baseline', 'main', 'high'],
  hevc: ['auto', 'main'],
  av1: ['auto', 'main'],
  vp9: ['auto']
};

const VIDEO_LEVELS = {
  h264: ['auto', '3.1', '4.0', '4.1', '4.2', '5.1', '5.2'],
  hevc: ['auto', '3.1', '4.0', '4.1', '5.1', '5.2'],
  av1: ['auto', '3.1', '4.0', '4.1', '5.1', '5.2'],
  vp9: ['auto']
};

const SOFTWARE_ENCODERS = {
  h264: ['libx264', 'libopenh264'],
  hevc: ['libx265', 'libkvazaar'],
  av1: ['libsvtav1', 'libaom-av1', 'librav1e'],
  vp9: ['libvpx-vp9']
};

const NTSC_RATES = {
  '23.976': '24000/1001',
  '23.98': '24000/1001',
  '29.97': '30000/1001',
  '47.952': '48000/1001',
  '59.94': '60000/1001',
  '119.88': '120000/1001'
};

const CONTAINER_LABELS = {
  mp4: 'MP4',
  mkv: 'MKV',
  mov: 'MOV',
  webm: 'WebM',
  mp3: 'MP3',
  m4a: 'M4A',
  wav: 'WAV',
  flac: 'FLAC',
  opus: 'Opus'
};

const VIDEO_CODEC_LABELS = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
const AUDIO_CODEC_LABELS = { aac: 'AAC', mp3: 'MP3', opus: 'Opus', ac3: 'AC-3', pcm: 'PCM', flac: 'FLAC', vorbis: 'Vorbis' };
const LOUDNESS_LABELS = { ebu: 'EBU R128', atsc: 'ATSC A/85', streaming: '−14 LUFS' };
const FPS_LABELS = { '24000/1001': '23.976 fps', '30000/1001': '29.97 fps', '60000/1001': '59.94 fps' };

function enumField(values, fallback) {
  return { type: 'enum', values, default: fallback };
}

function integerField(min, max, fallback, extra = {}) {
  return { type: 'integer', min, max, default: fallback, ...extra };
}

function numberField(min, max, fallback, extra = {}) {
  return { type: 'number', min, max, default: fallback, ...extra };
}

function booleanField(fallback) {
  return { type: 'boolean', default: fallback };
}

function textField(maxLength, fallback, extra = {}) {
  return { type: 'text', maxLength, default: fallback, ...extra };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const SCHEMA = deepFreeze({
  version: PRESET_VERSION,
  containers: CONTAINERS,
  audioOnlyContainers: AUDIO_ONLY_CONTAINERS,
  containerCodecs: CONTAINER_CODECS,
  videoProfiles: VIDEO_PROFILES,
  videoLevels: VIDEO_LEVELS,
  audioBitrateMax: AUDIO_BITRATE_MAX,
  audioBitrateMin: AUDIO_BITRATE_MIN,
  audioBitrateMaxMono: MONO_BITRATE_MAX,
  resolutionSizes: RESOLUTION_SIZES,
  fields: {
    name: textField(NAME_MAX, '', { truncate: true }),
    description: textField(DESCRIPTION_MAX, '', { truncate: true }),
    container: enumField(CONTAINERS, 'mp4'),
    video: {
      mode: enumField(['encode', 'copy', 'none'], 'encode'),
      codec: enumField(VIDEO_CODECS, 'h264'),
      encoder: textField(32, 'auto', { pattern: '^(auto|[a-z0-9][a-z0-9_-]*)$' }),
      rateControl: enumField(['quality', 'bitrate'], 'quality'),
      quality: integerField(1, 51, 20),
      bitrate: integerField(100, 200000, 8000),
      bitrateMode: enumField(['vbr', 'cbr'], 'vbr'),
      maxrate: integerField(100, 400000, 0, { allowZero: true }),
      bufsize: integerField(100, 800000, 0, { allowZero: true }),
      twoPass: booleanField(false),
      speed: enumField(['fast', 'balanced', 'quality'], 'balanced'),
      profile: enumField(['auto', 'baseline', 'main', 'high'], 'auto'),
      level: enumField(['auto', '3.1', '4.0', '4.1', '4.2', '5.1', '5.2'], 'auto'),
      keyframeSeconds: numberField(0.5, 10, 0, { decimals: 1, allowZero: true })
    },
    picture: {
      resolution: enumField(['keep', '480p', '576p', '720p', '1080p', '1440p', '2160p', 'custom'], 'keep'),
      width: integerField(16, 7680, 1920, { even: true }),
      height: integerField(16, 4320, 1080, { even: true }),
      fit: enumField(['pad', 'crop', 'stretch', 'fit'], 'pad'),
      noUpscale: booleanField(false),
      cfr: booleanField(false),
      fps: enumField(['keep', '24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60', 'custom'], 'keep'),
      customFps: textField(16, ''),
      deinterlace: enumField(['auto', 'off', 'on'], 'auto'),
      deinterlaceRate: enumField(['frame', 'field'], 'frame'),
      ivtc: enumField(['auto', 'off', 'on'], 'auto'),
      squarePixels: booleanField(true),
      colorConvert: enumField(['auto', 'off'], 'auto'),
      rotate: enumField([0, 90, 180, 270], 0),
      flipH: booleanField(false),
      flipV: booleanField(false),
      crop: {
        top: integerField(0, 4320, 0, { even: true }),
        bottom: integerField(0, 4320, 0, { even: true }),
        left: integerField(0, 7680, 0, { even: true }),
        right: integerField(0, 7680, 0, { even: true })
      }
    },
    audio: {
      mode: enumField(['encode', 'copy', 'none'], 'encode'),
      codec: enumField(AUDIO_CODECS, 'aac'),
      bitrate: integerField(32, 640, 192),
      vbr: integerField(0, 9, 0),
      sampleRate: enumField(['keep', 44100, 48000], 48000),
      channels: enumField(['keep', 'stereo', 'mono'], 'stereo'),
      volumeDb: numberField(-20, 20, 0, { decimals: 1 }),
      loudness: enumField(['off', 'ebu', 'atsc', 'streaming'], 'off'),
      tracks: enumField(['first', 'all'], 'first')
    },
    subtitles: enumField(['drop', 'keep'], 'drop'),
    output: {
      faststart: booleanField(true)
    }
  }
});

const BUILT_IN_IDS = new Set([
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
]);

class PresetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PresetError';
    this.code = code;
  }
}

function isField(spec) {
  return typeof spec.type === 'string';
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function pickEnum(spec, value) {
  if (spec.values.includes(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && spec.values.includes(Number(value))) return Number(value);
  if (typeof value === 'number') {
    const match = spec.values.find((item) => typeof item === 'string' && item !== '' && Number(item) === value);
    if (match !== undefined) return match;
  }
  return spec.default;
}

function pickNumber(spec, value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return spec.default;
  if (spec.allowZero && number <= 0) return 0;
  const factor = 10 ** (spec.decimals || 0);
  let result = spec.even ? Math.round(number / 2) * 2 : Math.round(number * factor) / factor;
  result = Math.min(spec.max, Math.max(spec.min, result));
  return Object.is(result, -0) ? 0 : result;
}

const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]+/g;
const HIDDEN_CHARS = new RegExp(`[${String.fromCodePoint(0x200b, 0x2060, 0xfeff)}\\p{Bidi_Control}]`, 'gu');
const VISIBLE_CHAR = /[^\s\p{Cf}\p{M}]/u;

function cleanText(value) {
  return value.replace(CONTROL_CHARS, ' ').replace(HIDDEN_CHARS, '').replace(/\s+/g, ' ').trim();
}

function hasVisibleText(value) {
  return VISIBLE_CHAR.test(value);
}

function truncate(text, max) {
  const chars = Array.from(text.slice(0, max * 2 + 1));
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text;
}

function pickText(spec, value) {
  if (typeof value !== 'string') return spec.default;
  const text = cleanText(value);
  if (spec.truncate) return truncate(text, spec.maxLength);
  if (text.length > spec.maxLength) return spec.default;
  if (spec.pattern && !new RegExp(spec.pattern).test(text)) return spec.default;
  return text;
}

function normalizeField(spec, value) {
  if (!isField(spec)) return normalizeGroup(spec, value);
  if (spec.type === 'enum') return pickEnum(spec, value);
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : spec.default;
  if (spec.type === 'text') return pickText(spec, value);
  return pickNumber(spec, value);
}

function normalizeGroup(group, value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  for (const [key, spec] of Object.entries(group)) {
    result[key] = normalizeField(spec, Object.hasOwn(source, key) ? source[key] : undefined);
  }
  return result;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function normalizeRate(value) {
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
  if (num / den < 1 || num / den > 240) return '';
  return den === 1 ? String(num) : `${num}/${den}`;
}

function rateLabel(rate) {
  const [num, den = '1'] = rate.split('/');
  return `${Number((Number(num) / Number(den)).toFixed(3))} fps`;
}

function encoderMatches(codec, encoder) {
  return SOFTWARE_ENCODERS[codec].includes(encoder) || encoder.startsWith(`${codec}_`);
}

function lameVbrQuality(vbr) {
  return Number.isInteger(vbr) && vbr >= 1 && vbr <= 9 ? vbr - 1 : null;
}

function isAudioOnlyContainer(container) {
  return AUDIO_ONLY_CONTAINERS.includes(container);
}

function audioBitrateLimits(codec, channels) {
  const monoMax = channels === 'mono' ? MONO_BITRATE_MAX[codec] : undefined;
  return { min: AUDIO_BITRATE_MIN[codec], max: monoMax || AUDIO_BITRATE_MAX[codec] };
}

function applyRules(preset) {
  const { container, video, picture, audio } = preset;
  const codecs = CONTAINER_CODECS[container];
  const audioOnly = isAudioOnlyContainer(container);
  if (audioOnly) {
    video.mode = 'none';
    audio.tracks = 'first';
    preset.subtitles = 'drop';
    if (audio.mode === 'none') {
      throw new PresetError('audio-required', `${CONTAINER_LABELS[container]} files need an audio track. Turn audio on or pick a video format.`);
    }
  } else if (!codecs.video.includes(video.codec)) {
    video.codec = codecs.video[0];
  }
  if (video.mode === 'none' && audio.mode === 'none') {
    throw new PresetError('nothing-to-keep', 'The preset must keep the video, the audio, or both.');
  }
  if (!codecs.audio.includes(audio.codec)) audio.codec = codecs.audio[0];
  if (video.encoder !== 'auto' && !encoderMatches(video.codec, video.encoder)) video.encoder = 'auto';
  if (!VIDEO_PROFILES[video.codec].includes(video.profile)) video.profile = 'auto';
  if (!VIDEO_LEVELS[video.codec].includes(video.level)) video.level = 'auto';
  if (video.rateControl !== 'bitrate') video.twoPass = false;
  if (video.maxrate === 0) video.bufsize = 0;
  const size = RESOLUTION_SIZES[picture.resolution];
  if (size) {
    picture.width = size.width;
    picture.height = size.height;
  }
  if (picture.fps === 'custom' || picture.customFps) {
    picture.customFps = normalizeRate(picture.customFps);
    if (picture.fps === 'custom' && !picture.customFps) picture.fps = 'keep';
  }
  if (audio.codec !== 'mp3') audio.vbr = 0;
  if (audio.codec === 'opus') audio.sampleRate = 48000;
  const limits = audioBitrateLimits(audio.codec, audio.channels);
  audio.bitrate = Math.min(limits.max, Math.max(limits.min, audio.bitrate));
  if (!FASTSTART_CONTAINERS.includes(container)) preset.output.faststart = false;
  return preset;
}

function pickId(value, allowBuiltInId) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return null;
  if (BUILT_IN_IDS.has(value) && !allowBuiltInId) return null;
  return value;
}

function settingsKey(preset) {
  const { container, video, picture, audio, subtitles, output } = preset;
  return JSON.stringify({ container, video, picture, audio, subtitles, output });
}

function buildPreset(input, id) {
  const fields = normalizeGroup(SCHEMA.fields, input);
  if (!hasVisibleText(fields.name)) throw new PresetError('name-required', 'Give the preset a name.');
  return applyRules({
    id,
    name: fields.name,
    description: fields.description,
    builtIn: false,
    version: PRESET_VERSION,
    container: fields.container,
    video: fields.video,
    picture: fields.picture,
    audio: fields.audio,
    subtitles: fields.subtitles,
    output: fields.output
  });
}

const BUILT_IN_BY_ID = new Map();

function validatePreset(input, { allowBuiltInId = false } = {}) {
  if (!isPlainObject(input)) throw new PresetError('invalid', 'This is not a valid preset.');
  const preset = buildPreset(input, pickId(input.id, allowBuiltInId));
  const original = BUILT_IN_BY_ID.get(preset.id);
  if (original) preset.builtIn = settingsKey(preset) === settingsKey(original);
  return preset;
}

const NEUTRAL_PICTURE = {
  cfr: false,
  deinterlace: 'off',
  ivtc: 'off',
  squarePixels: false,
  colorConvert: 'off'
};

const COPY_AUDIO = { mode: 'copy', codec: 'flac', sampleRate: 'keep', channels: 'keep', tracks: 'all' };

const BUILT_IN_DEFINITIONS = [
  {
    id: 'flowair-1080p',
    name: 'FlowAir Ready 1080p',
    description:
      'Broadcast-safe 1080p MP4 for FlowAir: H.264 High, AAC 48 kHz stereo, deinterlaced, square pixels, padded to 16:9, BT.709, original frame rate.',
    container: 'mp4',
    video: { profile: 'high', quality: 18, bitrate: 12000 },
    picture: { resolution: '1080p', fit: 'pad', cfr: true },
    audio: { bitrate: 192 }
  },
  {
    id: 'flowair-720p',
    name: 'FlowAir Ready 720p',
    description:
      'Broadcast-safe 720p MP4 for FlowAir: H.264 High, AAC 48 kHz stereo, deinterlaced, square pixels, padded to 16:9, BT.709, original frame rate.',
    container: 'mp4',
    video: { profile: 'high', quality: 18 },
    picture: { resolution: '720p', fit: 'pad', cfr: true },
    audio: { bitrate: 192 }
  },
  {
    id: 'mp4-universal',
    name: 'MP4 Universal',
    description: 'H.264 and AAC in an MP4 that plays on any TV, phone or computer. Keeps the original size and frame rate.',
    container: 'mp4',
    video: { profile: 'high', quality: 20 },
    picture: {},
    audio: { bitrate: 160 }
  },
  {
    id: 'smaller-file',
    name: 'Smaller file',
    description: 'A lighter H.264 MP4, at most 720p, for sharing and storage. Smaller videos are never enlarged.',
    container: 'mp4',
    video: { profile: 'high', quality: 26, bitrate: 2500 },
    picture: { resolution: '720p', fit: 'fit', noUpscale: true },
    audio: { bitrate: 96 }
  },
  {
    id: 'archive-remux',
    name: 'Archive copy (remux only)',
    description: 'Copies every video, audio and subtitle track into MKV without re-encoding. Fast and lossless.',
    container: 'mkv',
    video: { mode: 'copy' },
    picture: NEUTRAL_PICTURE,
    audio: COPY_AUDIO,
    subtitles: 'keep'
  },
  {
    id: 'youtube-upload',
    name: 'YouTube upload',
    description: 'High quality H.264 MP4 with AAC 320 kbps and progressive frames, as YouTube recommends for uploads.',
    container: 'mp4',
    video: { profile: 'high', quality: 18, keyframeSeconds: 2 },
    picture: { cfr: true, deinterlaceRate: 'field' },
    audio: { bitrate: 320 }
  },
  {
    id: 'mobile',
    name: 'WhatsApp / mobile',
    description: 'A light 720p MP4 that plays on phones and can be sent through WhatsApp.',
    container: 'mp4',
    video: { profile: 'main', quality: 26, bitrate: 2000 },
    picture: { resolution: '720p', fit: 'fit', noUpscale: true, cfr: true },
    audio: { bitrate: 128 }
  },
  {
    id: 'mp3-320',
    name: 'MP3 320 kbps',
    description: 'MP3 audio at 320 kbps constant bitrate, 44.1 kHz stereo.',
    container: 'mp3',
    video: { mode: 'none' },
    picture: NEUTRAL_PICTURE,
    audio: { codec: 'mp3', bitrate: 320, vbr: 0, sampleRate: 44100 }
  },
  {
    id: 'mp3-vbr',
    name: 'MP3 VBR high',
    description: 'MP3 audio with high quality variable bitrate (LAME V0), 44.1 kHz stereo.',
    container: 'mp3',
    video: { mode: 'none' },
    picture: NEUTRAL_PICTURE,
    audio: { codec: 'mp3', bitrate: 320, vbr: 1, sampleRate: 44100 }
  },
  {
    id: 'wav-48k',
    name: 'WAV 48 kHz',
    description: 'Uncompressed 16-bit PCM WAV at 48 kHz, stereo.',
    container: 'wav',
    video: { mode: 'none' },
    picture: NEUTRAL_PICTURE,
    audio: { codec: 'pcm', sampleRate: 48000 }
  },
  {
    id: 'extract-audio',
    name: 'Extract audio (copy)',
    description: 'Copies the audio tracks into an MKA file without re-encoding. Fast and lossless.',
    container: 'mkv',
    video: { mode: 'none' },
    picture: NEUTRAL_PICTURE,
    audio: COPY_AUDIO
  }
];

const BUILT_IN = deepFreeze(
  BUILT_IN_DEFINITIONS.map((definition) => {
    const preset = buildPreset(definition, definition.id);
    preset.builtIn = true;
    BUILT_IN_BY_ID.set(preset.id, preset);
    return preset;
  })
);

const BUILT_IN_NAMES = BUILT_IN.map((preset) => preset.name);

function isBuiltInId(id) {
  return BUILT_IN_IDS.has(id);
}

function audioTag(audio, audioOnly) {
  if (audio.mode === 'copy') return audioOnly ? 'Copy' : 'Audio copy';
  if (audio.mode === 'none') return 'No audio';
  const label = AUDIO_CODEC_LABELS[audio.codec];
  if (audio.codec === 'pcm') return audioOnly ? 'PCM 16-bit' : label;
  if (audio.codec === 'flac') return audioOnly ? 'Lossless' : label;
  if (audio.codec === 'mp3' && audio.vbr > 0) return audioOnly ? `VBR V${audio.vbr - 1}` : `${label} V${audio.vbr - 1}`;
  if (audioOnly && ['mp3', 'opus'].includes(audio.codec)) return `${audio.bitrate}k`;
  return `${label} ${audio.bitrate}k`;
}

function videoTags(preset) {
  const { container, video, picture } = preset;
  if (video.mode === 'copy') return ['Video copy'];
  if (video.mode === 'none') return container === 'mkv' ? [] : ['No video'];
  const tags = [VIDEO_CODEC_LABELS[video.codec]];
  if (picture.resolution === 'custom') tags.push(`${picture.width}×${picture.height}`);
  else if (picture.resolution !== 'keep') tags.push(picture.resolution);
  if (picture.fps === 'custom') tags.push(rateLabel(picture.customFps));
  else if (picture.fps !== 'keep') tags.push(FPS_LABELS[picture.fps] || `${picture.fps} fps`);
  return tags;
}

function summarize(preset) {
  const audioOnly = isAudioOnlyContainer(preset.container);
  const isAudioMatroska = preset.container === 'mkv' && preset.video.mode === 'none';
  const tags = [isAudioMatroska ? 'MKA' : CONTAINER_LABELS[preset.container]];
  if (!audioOnly) tags.push(...videoTags(preset));
  tags.push(audioTag(preset.audio, audioOnly));
  const { audio } = preset;
  if (audioOnly && audio.mode === 'encode' && ['pcm', 'flac'].includes(audio.codec) && audio.sampleRate !== 'keep') {
    tags.push(`${audio.sampleRate / 1000} kHz`);
  }
  if (audio.mode === 'encode' && audio.loudness !== 'off') tags.push(LOUDNESS_LABELS[audio.loudness]);
  return tags;
}

function lowerNames(names) {
  return new Set([...names].map((item) => item.toLowerCase()));
}

function uniqueName(name, takenNames) {
  return freeName(name, lowerNames(takenNames));
}

function freeName(name, taken) {
  if (!taken.has(name.toLowerCase())) return name;
  const numbered = /^(.*\S) \((\d{1,6})\)$/.exec(name);
  const base = numbered ? numbered[1] : name;
  for (let index = numbered ? Number(numbered[2]) + 1 : 2; ; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${truncate(base, NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function invalidFile() {
  return new PresetError('invalid-file', 'This file is not a Vidaro preset.');
}

function parseExport(input) {
  let data = input;
  if (Buffer.isBuffer(data)) {
    if (data.length > MAX_IMPORT_LENGTH * 3) throw invalidFile();
    data = data.toString('utf8');
  }
  if (typeof data === 'string') {
    if (data.length > MAX_IMPORT_LENGTH) throw invalidFile();
    try {
      data = JSON.parse(data.charCodeAt(0) === 0xfeff ? data.slice(1) : data);
    } catch {
      throw invalidFile();
    }
  }
  if (!isPlainObject(data) || data.format !== EXPORT_FORMAT || !isPlainObject(data.preset)) throw invalidFile();
  if (!Number.isInteger(data.version) || data.version < 1) throw invalidFile();
  if (data.version > PRESET_VERSION) {
    throw new PresetError('newer-version', 'This preset was made by a newer version of Vidaro. Update Vidaro to import it.');
  }
  return data;
}

function normalizeFile(data) {
  const presets = [];
  const ids = new Set();
  const names = lowerNames(BUILT_IN_NAMES);
  const items = Array.isArray(data.presets) ? data.presets : [];
  for (const item of items) {
    if (presets.length >= MAX_USER_PRESETS) break;
    let preset;
    try {
      preset = validatePreset(item);
    } catch {
      continue;
    }
    if (!preset.id || ids.has(preset.id)) preset.id = newUserId(ids);
    preset.name = freeName(preset.name, names);
    ids.add(preset.id);
    names.add(preset.name.toLowerCase());
    presets.push(preset);
  }
  return { version: FILE_VERSION, presets };
}

function newUserId(ids) {
  for (;;) {
    const id = `u-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    if (!ids.has(id)) return id;
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
}

function notFound() {
  return new PresetError('not-found', 'This preset no longer exists.');
}

class PresetStore {
  constructor({ file, debounceMs = 250 }) {
    this.store = new JsonStore({
      file,
      defaults: { version: FILE_VERSION, presets: [] },
      normalize: normalizeFile,
      debounceMs
    });
    this.loaded = false;
    this.disposed = false;
    this.listeners = new Set();
  }

  load() {
    this.store.load();
    this.loaded = true;
    return this.list();
  }

  get recovered() {
    return this.store.recovered;
  }

  userPresets() {
    if (!this.loaded) this.load();
    return this.store.get().presets;
  }

  list() {
    return [...BUILT_IN, ...this.userPresets().slice().sort(byName)].map((preset) => structuredClone(preset));
  }

  get(id) {
    const preset = BUILT_IN_BY_ID.get(id) || this.userPresets().find((item) => item.id === id);
    return preset ? structuredClone(preset) : null;
  }

  namesExcept(id) {
    const names = BUILT_IN.map((preset) => preset.name);
    for (const preset of this.userPresets()) if (preset.id !== id) names.push(preset.name);
    return names;
  }

  save(input) {
    const preset = validatePreset(input);
    const presets = this.userPresets().slice();
    const index = preset.id ? presets.findIndex((item) => item.id === preset.id) : -1;
    if (index < 0) {
      if (presets.length >= MAX_USER_PRESETS) {
        throw new PresetError('too-many', `You can keep up to ${MAX_USER_PRESETS} presets. Delete some first.`);
      }
      if (!preset.id) preset.id = newUserId(new Set(presets.map((item) => item.id)));
    }
    preset.name = uniqueName(preset.name, this.namesExcept(preset.id));
    if (index < 0) presets.push(preset);
    else presets[index] = preset;
    this.commit(presets);
    return structuredClone(preset);
  }

  duplicate(id, name) {
    const source = this.get(id);
    if (!source) throw notFound();
    const wanted = typeof name === 'string' && hasVisibleText(cleanText(name)) ? name : source.name;
    return this.save({ ...source, id: null, name: wanted });
  }

  rename(id, name) {
    if (isBuiltInId(id)) throw new PresetError('built-in', 'Built-in presets cannot be renamed. Duplicate it first.');
    const current = this.userPresets().find((item) => item.id === id);
    if (!current) throw notFound();
    return this.save({ ...structuredClone(current), name });
  }

  remove(id) {
    if (isBuiltInId(id)) throw new PresetError('built-in', 'Built-in presets cannot be deleted.');
    const presets = this.userPresets();
    const next = presets.filter((item) => item.id !== id);
    if (next.length === presets.length) return false;
    this.commit(next);
    return true;
  }

  exportData(id) {
    const preset = this.get(id);
    if (!preset) throw notFound();
    return { format: EXPORT_FORMAT, version: PRESET_VERSION, preset: { ...preset, builtIn: false } };
  }

  importData(input) {
    const data = parseExport(input);
    const preset = validatePreset(data.preset);
    return this.save({ ...preset, id: null });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  commit(presets) {
    this.store.update({ version: FILE_VERSION, presets });
    if (this.disposed) this.store.flush();
    if (this.listeners.size === 0) return;
    const list = this.list();
    for (const listener of [...this.listeners]) {
      try {
        listener(list);
      } catch {
        continue;
      }
    }
  }

  flush() {
    this.store.flush();
  }

  dispose() {
    this.disposed = true;
    this.store.dispose();
    this.listeners.clear();
  }
}

module.exports = {
  SCHEMA,
  BUILT_IN,
  PRESET_VERSION,
  EXPORT_FORMAT,
  EXPORT_EXTENSION,
  MAX_USER_PRESETS,
  CONTAINER_LABELS,
  AUDIO_ONLY_CONTAINERS,
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
};
