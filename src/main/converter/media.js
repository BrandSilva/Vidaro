const path = require('node:path');

const STANDARD_RATES = [
  [12, 1],
  [15, 1],
  [24000, 1001],
  [24, 1],
  [25, 1],
  [30000, 1001],
  [30, 1],
  [48000, 1001],
  [48, 1],
  [50, 1],
  [60000, 1001],
  [60, 1],
  [90, 1],
  [100, 1],
  [120000, 1001],
  [120, 1],
  [240, 1]
].map(([num, den]) => ({ num, den }));

const RATE_LABELS = {
  '24000/1001': '23.976',
  '30000/1001': '29.97',
  '48000/1001': '47.952',
  '60000/1001': '59.94',
  '120000/1001': '119.88'
};

const CONTAINER_LABELS = {
  mp4: 'MP4',
  mov: 'MOV',
  m4a: 'M4A',
  m4v: 'M4V',
  '3gp': '3GP',
  mkv: 'MKV',
  mka: 'MKA',
  webm: 'WebM',
  avi: 'AVI',
  mpeg: 'MPEG-PS',
  vob: 'VOB',
  ts: 'MPEG-TS',
  m2ts: 'M2TS',
  dv: 'DV',
  flv: 'FLV',
  asf: 'ASF',
  wmv: 'WMV',
  wma: 'WMA',
  mp3: 'MP3',
  wav: 'WAV',
  flac: 'FLAC',
  ogg: 'Ogg',
  opus: 'Opus',
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  mxf: 'MXF',
  gxf: 'GXF',
  rm: 'RealMedia',
  m2v: 'MPEG-2 video',
  m4ves: 'MPEG-4 video stream',
  h264: 'H.264 stream',
  hevc: 'HEVC stream',
  aiff: 'AIFF',
  w64: 'WAV',
  caf: 'CAF',
  nut: 'NUT'
};

const VIDEO_CODEC_LABELS = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  dvvideo: 'DV',
  mjpeg: 'Motion JPEG',
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  wmv1: 'WMV 7',
  wmv2: 'WMV 8',
  wmv3: 'WMV 9',
  vc1: 'VC-1',
  msmpeg4v1: 'MS MPEG-4 v1',
  msmpeg4v2: 'MS MPEG-4 v2',
  msmpeg4v3: 'MS MPEG-4 v3',
  flv1: 'Sorenson Spark',
  h263: 'H.263',
  h263p: 'H.263+',
  svq1: 'Sorenson Video',
  svq3: 'Sorenson Video 3',
  theora: 'Theora',
  rawvideo: 'Uncompressed',
  huffyuv: 'HuffYUV',
  ffvhuff: 'HuffYUV',
  ffv1: 'FFV1',
  cinepak: 'Cinepak',
  indeo3: 'Indeo 3',
  indeo4: 'Indeo 4',
  indeo5: 'Indeo 5',
  rv10: 'RealVideo 1',
  rv20: 'RealVideo 2',
  rv30: 'RealVideo 3',
  rv40: 'RealVideo 4',
  vp6: 'VP6',
  vp6f: 'VP6',
  cfhd: 'CineForm',
  hap: 'HAP',
  utvideo: 'Ut Video',
  magicyuv: 'MagicYUV',
  qtrle: 'QuickTime Animation',
  png: 'PNG',
  gif: 'GIF',
  vvc: 'VVC'
};

const MPEG4_TAG_LABELS = {
  xvid: 'Xvid',
  divx: 'DivX',
  dx50: 'DivX',
  div4: 'DivX',
  div5: 'DivX',
  div6: 'DivX',
  dxgm: 'DivX',
  fmp4: 'MPEG-4',
  mp4v: 'MPEG-4',
  mp4s: 'MPEG-4',
  m4s2: 'MPEG-4',
  '3iv2': '3ivx',
  '3ivx': '3ivx'
};

const MSMPEG4_TAG_LABELS = { div3: 'DivX 3', mp43: 'MS MPEG-4 v3', div4: 'DivX 3' };

const AUDIO_CODEC_LABELS = {
  aac: 'AAC',
  aac_latm: 'AAC',
  mp3: 'MP3',
  mp3float: 'MP3',
  mp2: 'MP2',
  mp1: 'MP1',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  truehd: 'TrueHD',
  mlp: 'MLP',
  dts: 'DTS',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  wmav1: 'WMA',
  wmav2: 'WMA',
  wmapro: 'WMA Pro',
  wmalossless: 'WMA Lossless',
  wmavoice: 'WMA Voice',
  amr_nb: 'AMR',
  amr_wb: 'AMR-WB',
  gsm: 'GSM',
  gsm_ms: 'GSM',
  speex: 'Speex',
  ra_144: 'RealAudio',
  ra_288: 'RealAudio',
  cook: 'RealAudio',
  pcm_mulaw: 'μ-law',
  pcm_alaw: 'A-law',
  dsd_lsbf: 'DSD',
  dsd_msbf: 'DSD',
  tta: 'TTA',
  wavpack: 'WavPack',
  ape: 'APE'
};

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
  'microdvd',
  'subviewer',
  'subviewer1',
  'sami',
  'realtext',
  'jacosub',
  'mpl2',
  'pjs',
  'vplayer',
  'stl',
  'eia_608'
]);

const PROGRESSIVE_ONLY_CODECS = new Set(['vp8', 'vp9', 'av1', 'theora', 'gif', 'png', 'apng', 'webp', 'flv1', 'vp6', 'vp6f', 'vp6a', 'cinepak', 'qtrle', 'hap', 'vvc']);
const RAW_STREAM_CONTAINERS = new Set(['h264', 'hevc', 'm2v', 'aac', 'ac3', 'eac3', 'dts', 'm4ves', 'truehd', 'mlp']);
const CHECKED_DURATION_CONTAINERS = new Set(['avi', 'mpeg', 'vob', 'ts', 'm2ts', 'flv', 'asf', 'wmv', 'wma', 'rm', 'nut']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const MAX_REAL_RATE = 300;
const INTERLACE_HEIGHTS = [
  [400, 610],
  [1080, 1088]
];
const PAL_HEIGHTS = new Set([576, 288, 578]);
const NTSC_HEIGHTS = new Set([480, 486, 240, 508, 512]);

const ASPECTS = [
  { label: '4:3', value: 4 / 3, tolerance: 0.025 },
  { label: '16:9', value: 16 / 9, tolerance: 0.025 },
  { label: '3:2', value: 3 / 2, tolerance: 0.01 },
  { label: '5:4', value: 5 / 4, tolerance: 0.01 },
  { label: '1:1', value: 1, tolerance: 0.01 },
  { label: '1.85:1', value: 1.85, tolerance: 0.008 },
  { label: '2.35:1', value: 2.35, tolerance: 0.006 },
  { label: '2.39:1', value: 2.39, tolerance: 0.006 },
  { label: '21:9', value: 64 / 27, tolerance: 0.006 },
  { label: '2:1', value: 2, tolerance: 0.01 },
  { label: '9:16', value: 9 / 16, tolerance: 0.025 },
  { label: '3:4', value: 3 / 4, tolerance: 0.025 },
  { label: '2:3', value: 2 / 3, tolerance: 0.01 },
  { label: '4:5', value: 4 / 5, tolerance: 0.01 }
];

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function reduce(num, den) {
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

function parseRational(value) {
  if (value && typeof value === 'object' && Number.isFinite(value.num) && Number.isFinite(value.den)) {
    return value.num > 0 && value.den > 0 ? reduce(value.num, value.den) : null;
  }
  if (typeof value === 'number') return value > 0 ? rationalFromNumber(value) : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[/:]\s*(\d+(?:\.\d+)?))?\s*$/.exec(value);
  if (!match) return null;
  const num = Number(match[1]);
  const den = match[2] === undefined ? 1 : Number(match[2]);
  if (!(num > 0) || !(den > 0)) return null;
  if (Number.isInteger(num) && Number.isInteger(den)) return reduce(num, den);
  return rationalFromNumber(num / den);
}

function rationalFromNumber(value) {
  return snapRate({ num: Math.round(value * 1e6), den: 1e6 });
}

function rateValue(rate) {
  return rate ? rate.num / rate.den : 0;
}

function rateString(rate) {
  return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

function snapRate(rate) {
  if (!rate) return null;
  const value = rateValue(rate);
  for (const standard of STANDARD_RATES) {
    const target = rateValue(standard);
    if (Math.abs(value - target) / target < 0.0005) return { ...standard };
  }
  return reduce(rate.num, rate.den);
}

function rateLabel(rate, decimals = 3) {
  if (!rate) return '';
  const known = RATE_LABELS[rateString(rate)];
  if (known) return known;
  return String(Number(rateValue(rate).toFixed(decimals)));
}

function sameRate(a, b, tolerance = 0.002) {
  if (!a || !b) return false;
  return Math.abs(rateValue(a) - rateValue(b)) / rateValue(b) <= tolerance;
}

function nearestStandardRate(rate, candidates) {
  const list = (candidates || ['24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60']).map(parseRational);
  const value = rateValue(rate);
  let best = list[0];
  for (const candidate of list) {
    if (Math.abs(rateValue(candidate) - value) < Math.abs(rateValue(best) - value)) best = candidate;
  }
  return best;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
}

function known(value) {
  return typeof value === 'string' && value && value !== 'unknown' && value !== 'unspecified' && value !== 'reserved' ? value : null;
}

function parseClock(text) {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(String(text || '').trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 ? seconds : null;
}

function tag(stream, name) {
  const tags = stream.tags || {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(tags)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function streamDuration(stream) {
  const direct = positive(stream.duration);
  if (direct !== null) return direct;
  const entries = Object.entries(stream.tags || {});
  const exact = entries.filter(([key]) => /^duration$/i.test(key));
  const localized = entries.filter(([key]) => /^duration-[\w-]+$/i.test(key));
  for (const [, value] of [...exact, ...localized]) {
    const parsed = parseClock(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function containerOf(formatName, filePath) {
  const names = String(formatName || '')
    .toLowerCase()
    .split(',')
    .filter(Boolean);
  const ext = path.extname(filePath || '').slice(1).toLowerCase();
  const first = names[0] || '';
  if (names.includes('mp4') || names.includes('mov')) {
    if (ext === 'mov' || ext === 'qt') return 'mov';
    if (ext === 'm4a' || ext === 'm4b') return 'm4a';
    if (ext === '3gp' || ext === '3g2') return '3gp';
    if (ext === 'm4v') return 'm4v';
    return 'mp4';
  }
  if (names.includes('matroska') || names.includes('webm')) {
    if (ext === 'webm') return 'webm';
    if (ext === 'mka') return 'mka';
    return 'mkv';
  }
  if (first === 'mpeg') return ext === 'vob' ? 'vob' : 'mpeg';
  if (first === 'mpegts') return ext === 'm2ts' || ext === 'mts' ? 'm2ts' : 'ts';
  if (first === 'asf') return ext === 'wmv' ? 'wmv' : ext === 'wma' ? 'wma' : 'asf';
  if (first === 'ogg') return ext === 'opus' ? 'opus' : 'ogg';
  if (first === 'mpegvideo') return 'm2v';
  if (first === 'm4v') return 'm4ves';
  if (first === 'wav' && names.length === 1) return 'wav';
  if (first === 'rm') return 'rm';
  return first || ext || 'unknown';
}

function containerLabel(container) {
  return CONTAINER_LABELS[container] || container.toUpperCase();
}

function videoCodecLabel(stream) {
  const codec = stream.codec_name || '';
  const tagText = String(stream.codec_tag_string || '').toLowerCase();
  if (codec === 'mpeg4') return MPEG4_TAG_LABELS[tagText] || 'MPEG-4 Part 2';
  if (codec === 'msmpeg4v3') return MSMPEG4_TAG_LABELS[tagText] || VIDEO_CODEC_LABELS.msmpeg4v3;
  if (codec === 'dvvideo') {
    const bitrate = positive(stream.bit_rate);
    if (tagText === 'dv50' || tagText === 'dv5n' || tagText === 'dv5p' || (bitrate && bitrate > 45e6 && bitrate < 70e6)) return 'DVCPRO 50';
    if (tagText.startsWith('dvh') || (bitrate && bitrate >= 70e6)) return 'DVCPRO HD';
    return 'DV';
  }
  if (codec === 'prores' && stream.profile && stream.profile !== 'unknown') return `ProRes ${stream.profile}`;
  return VIDEO_CODEC_LABELS[codec] || codec.toUpperCase() || 'Unknown';
}

function audioCodecLabel(stream) {
  const codec = stream.codec_name || '';
  if (codec === 'aac' && /HE-AAC/i.test(stream.profile || '')) return 'HE-AAC';
  if (codec === 'dts' && /DTS-HD MA/i.test(stream.profile || '')) return 'DTS-HD MA';
  if (codec.startsWith('pcm_') && !AUDIO_CODEC_LABELS[codec]) return 'PCM';
  if (codec.startsWith('adpcm_')) return 'ADPCM';
  return AUDIO_CODEC_LABELS[codec] || codec.toUpperCase() || 'Unknown';
}

function parseRatio(text) {
  const match = /^(\d+):(\d+)$/.exec(String(text || '').trim());
  if (!match) return null;
  const num = Number(match[1]);
  const den = Number(match[2]);
  return num > 0 && den > 0 ? reduce(num, den) : null;
}

function bitDepthOf(stream) {
  const raw = positive(stream.bits_per_raw_sample);
  if (raw) return raw;
  const fmt = String(stream.pix_fmt || '');
  const match = /p(\d{2})(?:le|be)$/.exec(fmt) || /^[pyv]\d(\d{2})(?:le|be)?$/.exec(fmt) || /^gray(\d{2})(?:le|be)$/.exec(fmt);
  if (match) {
    const depth = Number(match[1]);
    if (depth >= 9 && depth <= 16) return depth;
  }
  return 8;
}

function rotationOf(stream) {
  for (const item of stream.side_data_list || []) {
    if (item && item.rotation !== undefined && Number.isFinite(Number(item.rotation))) {
      return normalizeAngle(-Number(item.rotation));
    }
  }
  const rotate = toNumber(tag(stream, 'rotate'));
  return rotate === null ? 0 : normalizeAngle(rotate);
}

function normalizeAngle(value) {
  const snapped = Math.round(value / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function fieldOrderOf(stream, codec, width, height) {
  const order = String(stream.field_order || '').toLowerCase();
  if (order === 'progressive') return 'progressive';
  if (order === 'tt' || order === 'bt') return 'tff';
  if (order === 'bb' || order === 'tb') return 'bff';
  if (codec === 'dvvideo' && height <= 576) return 'bff';
  if (PROGRESSIVE_ONLY_CODECS.has(codec)) return 'progressive';
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (long > 2048) return 'progressive';
  if (INTERLACE_HEIGHTS.some(([min, max]) => short >= min && short <= max)) return 'unknown';
  return 'progressive';
}

function resolveFrameRate(stream, codec) {
  const real = snapRate(parseRational(stream.r_frame_rate));
  const avg = snapRate(parseRational(stream.avg_frame_rate));
  if (!real && !avg) return { fps: null, avgFps: null, vfr: false, softTelecine: false };
  if (!real) return { fps: avg, avgFps: avg, vfr: false, softTelecine: false };
  if (rateValue(real) > MAX_REAL_RATE) {
    if (!avg || rateValue(avg) > MAX_REAL_RATE) return { fps: null, avgFps: null, vfr: true, softTelecine: false };
    return { fps: avg, avgFps: avg, vfr: true, softTelecine: false };
  }
  if (!avg) return { fps: real, avgFps: real, vfr: false, softTelecine: false };
  if (sameRate(avg, real)) return { fps: real, avgFps: real, vfr: false, softTelecine: false };
  const ratio = rateValue(real) / rateValue(avg);
  if (Math.abs(ratio - 2) < 0.004) return { fps: avg, avgFps: avg, vfr: false, softTelecine: false };
  if (ratio < 0.5) return { fps: real, avgFps: real, vfr: false, softTelecine: false };
  const telecineCodecs = ['mpeg2video', 'mpeg1video', 'h264', 'vc1'];
  if (telecineCodecs.includes(codec) && sameRate(real, { num: 30000, den: 1001 }, 0.001) && sameRate(avg, { num: 24000, den: 1001 }, 0.005)) {
    return { fps: { num: 24000, den: 1001 }, avgFps: { num: 24000, den: 1001 }, vfr: false, softTelecine: true };
  }
  return { fps: real, avgFps: avg, vfr: true, softTelecine: false };
}

function aspectLabel(width, height) {
  if (!(width > 0) || !(height > 0)) return '';
  const ratio = width / height;
  let best = null;
  for (const aspect of ASPECTS) {
    const error = Math.abs(ratio - aspect.value) / aspect.value;
    if (error <= aspect.tolerance && (!best || error < best.error)) best = { label: aspect.label, error };
  }
  if (best) return best.label;
  return ratio >= 1 ? `${Number(ratio.toFixed(2))}:1` : `1:${Number((1 / ratio).toFixed(2))}`;
}

function standardOf(width, height, fps) {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (long > 768) return null;
  const value = rateValue(fps);
  const pal = Boolean(fps) && [25, 50, 12.5].some((rate) => Math.abs(value - rate) < 0.01);
  const ntsc = Boolean(fps) && [30000 / 1001, 60000 / 1001, 24000 / 1001, 30, 60, 15000 / 1001].some((rate) => Math.abs(value - rate) < 0.01);
  if (PAL_HEIGHTS.has(short) && (pal || !fps)) return 'PAL';
  if (NTSC_HEIGHTS.has(short) && (ntsc || !fps)) return 'NTSC';
  return null;
}

function resolutionLabel(width, height, fieldOrder) {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const byShort = [
    [4320, 4320],
    [2160, 2160],
    [1440, 1440],
    [1080, 1088],
    [720, 720],
    [576, 576],
    [480, 486],
    [360, 360],
    [240, 240]
  ].find(([min, max]) => short >= min && short <= max);
  const byLong = { 7680: 4320, 3840: 2160, 4096: 2160, 2560: 1440, 1920: 1080, 1280: 720 }[long];
  const lines = byShort ? byShort[0] : byLong && short < byLong ? byLong : null;
  if (!lines) return `${width}x${height}`;
  const suffix = fieldOrder === 'tff' || fieldOrder === 'bff' ? 'i' : fieldOrder === 'progressive' ? 'p' : '';
  return `${lines}${suffix}`;
}

function channelLayoutLabel(channels, layout) {
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (layout) return layout.replace(/\(side\)$/, '');
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return channels ? `${channels} ch` : '';
}

function defaultLayout(channels) {
  return { 1: 'mono', 2: 'stereo', 3: '2.1', 4: 'quad', 5: '4.1', 6: '5.1', 7: '6.1', 8: '7.1' }[channels] || null;
}

function audioBitDepth(stream) {
  const raw = positive(stream.bits_per_raw_sample);
  if (raw) return raw;
  const perSample = positive(stream.bits_per_sample);
  if (perSample) return perSample;
  const format = String(stream.sample_fmt || '');
  if (format.startsWith('s16')) return 16;
  if (format.startsWith('s32')) return 32;
  if (format.startsWith('u8')) return 8;
  if (format.startsWith('flt') || format.startsWith('dbl')) return null;
  return null;
}

function languageOf(stream) {
  const language = tag(stream, 'language');
  return typeof language === 'string' && language && language.toLowerCase() !== 'und' ? language : null;
}

function titleOf(stream) {
  const title = tag(stream, 'title');
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

function isAttachedPicture(stream) {
  return Boolean(stream.disposition && Number(stream.disposition.attached_pic) === 1);
}

function parseVideo(stream) {
  const codec = stream.codec_name || 'unknown';
  const width = positive(stream.width) || 0;
  const height = positive(stream.height) || 0;
  const sar = parseRatio(stream.sample_aspect_ratio) || { num: 1, den: 1 };
  const rotation = rotationOf(stream);
  const swap = rotation === 90 || rotation === 270;
  const storageDisplayWidth = width && Math.round((width * sar.num) / sar.den);
  const displayWidth = swap ? height : storageDisplayWidth;
  const displayHeight = swap ? storageDisplayWidth : height;
  const dar = displayWidth && displayHeight ? reduce(displayWidth, displayHeight) : { num: 1, den: 1 };
  const reportedDar = parseRatio(stream.display_aspect_ratio);
  const finalDar = !swap && reportedDar && Math.abs(reportedDar.num / reportedDar.den - dar.num / dar.den) < 0.01 ? reportedDar : dar;
  const rates = resolveFrameRate(stream, codec);
  const fieldOrder = rates.softTelecine ? 'progressive' : fieldOrderOf(stream, codec, width, height);
  const colorTransfer = known(stream.color_transfer);
  const colorPrimaries = known(stream.color_primaries);
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const isSD = Boolean(width && height) && short < 720 && long < 1280;
  return {
    index: stream.index,
    codec,
    codecLabel: videoCodecLabel(stream),
    codecTag: stream.codec_tag_string || null,
    profile: known(stream.profile),
    width,
    height,
    sar,
    dar: finalDar,
    displayWidth,
    displayHeight,
    aspectLabel: aspectLabel(displayWidth, displayHeight),
    fps: rates.fps,
    fpsLabel: rates.vfr ? `~${rateLabel(rates.avgFps, 2)}` : rateLabel(rates.fps),
    avgFps: rates.avgFps,
    vfr: rates.vfr,
    softTelecine: rates.softTelecine,
    fieldOrder,
    pixFmt: stream.pix_fmt || null,
    bitDepth: bitDepthOf(stream),
    colorSpace: known(stream.color_space),
    colorPrimaries,
    colorTransfer,
    colorRange: known(stream.color_range),
    rotation,
    bitrate: positive(stream.bit_rate),
    frames: positive(stream.nb_frames),
    duration: streamDuration(stream),
    startTime: toNumber(stream.start_time),
    standard: isSD ? standardOf(width, height, rates.fps) : null,
    isSD,
    isHDR: HDR_TRANSFERS.has(colorTransfer),
    resolutionLabel: resolutionLabel(width, height, fieldOrder)
  };
}

function parseAudio(stream) {
  const channels = positive(stream.channels) || 0;
  const disposition = stream.disposition || {};
  return {
    index: stream.index,
    codec: stream.codec_name || 'unknown',
    codecLabel: audioCodecLabel(stream),
    profile: known(stream.profile),
    channels,
    layout: known(stream.channel_layout) || defaultLayout(channels),
    sampleRate: positive(stream.sample_rate),
    sampleFormat: stream.sample_fmt || null,
    bitDepth: audioBitDepth(stream),
    bitrate: positive(stream.bit_rate),
    duration: streamDuration(stream),
    startTime: toNumber(stream.start_time),
    language: languageOf(stream),
    title: titleOf(stream),
    isDefault: Number(disposition.default) === 1
  };
}

function parseSubtitle(stream) {
  const codec = stream.codec_name || 'unknown';
  return {
    index: stream.index,
    codec,
    language: languageOf(stream),
    title: titleOf(stream),
    textBased: TEXT_SUBTITLE_CODECS.has(codec),
    isDefault: Number((stream.disposition || {}).default) === 1,
    forced: Number((stream.disposition || {}).forced) === 1
  };
}

function withinShare(a, b, share, floor) {
  return Math.abs(a - b) <= Math.max(floor, b * share);
}

function isDurationReliable(container, duration, video, audio) {
  if (!(duration > 0)) return false;
  if (RAW_STREAM_CONTAINERS.has(container)) return false;
  if (!CHECKED_DURATION_CONTAINERS.has(container)) return true;
  const streams = [video, ...audio].filter(Boolean);
  for (const stream of streams) {
    if (stream.duration && !withinShare(stream.duration, duration, 0.02, 0.5)) return false;
  }
  if (video && video.frames && video.fps && !video.vfr) {
    const fromFrames = video.frames / rateValue(video.fps);
    const reference = video.duration || duration;
    if (!withinShare(fromFrames, reference, 0.02, 0.5)) return false;
  }
  return true;
}

function probeArgs(filePath, { deep = false } = {}) {
  const args = ['-v', 'error', '-hide_banner'];
  if (deep) args.push('-analyzeduration', '100M', '-probesize', '100M');
  args.push('-show_format', '-show_streams', '-of', 'json', '-i', inputUrl(filePath));
  return args;
}

function inputUrl(filePath) {
  return `file:${filePath}`;
}

function needsDeepProbe(media) {
  return Boolean(media) && ['mpeg', 'vob', 'ts', 'm2ts'].includes(media.container);
}

function clampToContainerEnd(streams, format) {
  const total = positive(format.duration);
  if (!total) return;
  const starts = streams.map((stream) => stream.startTime).filter(Number.isFinite);
  const formatStart = toNumber(format.start_time) ?? (starts.length ? Math.min(...starts) : 0);
  const end = formatStart + total;
  for (const stream of streams) {
    if (!(stream.duration > 0) || !Number.isFinite(stream.startTime)) continue;
    const room = end - stream.startTime;
    if (room > 0 && stream.duration > room + 0.001) stream.duration = Math.round(room * 1e6) / 1e6;
  }
}

function parseProbe(json, { path: filePath = '', size = null } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json || {};
  const format = data.format || {};
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const container = containerOf(format.format_name, filePath || format.filename);
  const videoStream = streams.find((stream) => stream.codec_type === 'video' && !isAttachedPicture(stream));
  const coverStream = streams.find((stream) => stream.codec_type === 'video' && isAttachedPicture(stream));
  const video = videoStream ? parseVideo(videoStream) : null;
  const audio = streams.filter((stream) => stream.codec_type === 'audio').map(parseAudio);
  const subtitles = streams.filter((stream) => stream.codec_type === 'subtitle').map(parseSubtitle);
  clampToContainerEnd([video, ...audio].filter(Boolean), format);
  const streamDurations = [video, ...audio].filter(Boolean).map((stream) => stream.duration || 0);
  const duration = positive(format.duration) || (streamDurations.length ? Math.max(...streamDurations) : 0) || null;
  const media = {
    path: filePath || format.filename || '',
    name: path.basename(filePath || format.filename || ''),
    size: positive(size) || positive(format.size),
    container,
    containerLabel: containerLabel(container),
    formatName: format.format_name || null,
    duration,
    durationReliable: isDurationReliable(container, duration, video, audio),
    bitrate: positive(format.bit_rate),
    startTime: toNumber(format.start_time) || 0,
    title: typeof tag(format, 'title') === 'string' ? tag(format, 'title') : null,
    video,
    audio,
    subtitles,
    cover: coverStream ? { index: coverStream.index, codec: coverStream.codec_name || null } : null,
    chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
    badges: [],
    warnings: []
  };
  media.badges = badgesFor(media);
  media.warnings = warningsFor(media);
  return media;
}

function audioBadge(track) {
  if (!track) return null;
  if (track.channels > 2) return `${track.codecLabel} ${channelLayoutLabel(track.channels, track.layout)}`;
  return track.codecLabel;
}

function badgesFor(media) {
  const badges = [media.containerLabel];
  const { video } = media;
  const first = media.audio[0];
  if (video) {
    badges.push(video.codecLabel);
    if (video.bitDepth > 8) badges.push(`${video.bitDepth}-bit`);
    badges.push(video.standard ? `${video.resolutionLabel} ${video.standard}` : video.resolutionLabel);
    if (video.vfr) badges.push(`VFR ${video.fpsLabel}`);
    else if (video.fps) badges.push(video.fpsLabel);
    if (video.aspectLabel) badges.push(video.aspectLabel);
    if (video.isHDR) badges.push(video.colorTransfer === 'arib-std-b67' ? 'HLG' : 'HDR10');
    if (first) badges.push(audioBadge(first));
  } else if (first) {
    badges.push(first.codecLabel);
    const channels = channelLayoutLabel(first.channels, first.layout);
    if (channels) badges.push(channels);
    if (first.sampleRate) badges.push(`${Number((first.sampleRate / 1000).toFixed(1))} kHz`);
    if (first.bitrate) badges.push(`${Math.round(first.bitrate / 1000)} kbps`);
  }
  if (media.audio.length > 1) badges.push(`${media.audio.length} audio tracks`);
  return badges.filter(Boolean);
}

function warningsFor(media) {
  const warnings = [];
  const { video } = media;
  if (!video) warnings.push('no-video');
  if (media.audio.length === 0) warnings.push('no-audio');
  if (video) {
    if (video.vfr) warnings.push('vfr');
    if (video.fieldOrder === 'unknown') warnings.push('field-order-unknown');
    if (video.isHDR) warnings.push('hdr');
    if (video.sar.num !== video.sar.den) warnings.push('anamorphic');
    if (video.rotation !== 0) warnings.push('rotated');
  }
  if (!media.durationReliable) warnings.push('duration-estimated');
  if (media.subtitles.some((track) => !track.textBased)) warnings.push('bitmap-subtitles');
  return warnings;
}

module.exports = {
  probeArgs,
  parseProbe,
  badgesFor,
  inputUrl,
  needsDeepProbe,
  containerOf,
  containerLabel,
  parseRational,
  rateValue,
  rateString,
  rateLabel,
  snapRate,
  sameRate,
  nearestStandardRate,
  aspectLabel,
  resolutionLabel,
  channelLayoutLabel,
  reduce,
  TEXT_SUBTITLE_CODECS
};
