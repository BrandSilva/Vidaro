const CANDIDATES = Object.freeze({
  h264: Object.freeze(['h264_qsv', 'h264_nvenc', 'h264_amf', 'h264_mf', 'libx264']),
  hevc: Object.freeze(['hevc_qsv', 'hevc_nvenc', 'hevc_amf', 'hevc_mf', 'libx265']),
  av1: Object.freeze(['av1_qsv', 'av1_nvenc', 'av1_amf', 'libaom-av1']),
  vp9: Object.freeze(['libvpx-vp9'])
});

const SOFTWARE = Object.freeze({ h264: 'libx264', hevc: 'libx265', av1: 'libaom-av1', vp9: 'libvpx-vp9' });

const SOFTWARE_LABELS = {
  libx264: 'Software (x264)',
  libx265: 'Software (x265)',
  'libaom-av1': 'Software (AOM AV1)',
  libsvtav1: 'Software (SVT-AV1)',
  'libvpx-vp9': 'Software (VP9)'
};

const FAMILY_LABELS = {
  qsv: 'Intel Quick Sync',
  nvenc: 'NVIDIA NVENC',
  amf: 'AMD AMF',
  mf: 'Windows Media Foundation'
};

const HARDWARE_FAMILIES = new Set(['qsv', 'nvenc', 'amf', 'mf']);
const HEADER_FIRST_CONTAINERS = new Set(['mkv', 'webm']);

const SPEEDS = {
  libx264: { fast: 'veryfast', balanced: 'medium', quality: 'slow' },
  libx265: { fast: 'veryfast', balanced: 'fast', quality: 'medium' },
  nvenc: { fast: 'p2', balanced: 'p4', quality: 'p6' },
  qsv: { fast: 'veryfast', balanced: 'medium', quality: 'slow' },
  amf: { fast: 'speed', balanced: 'balanced', quality: 'quality' },
  'libaom-av1': { fast: '8', balanced: '7', quality: '6' },
  'libvpx-vp9': { fast: '4', balanced: '3', quality: '2' }
};

const H264_PROFILE_IDS = { baseline: '66', main: '77', high: '100' };

function familyOf(name) {
  const match = /_(qsv|nvenc|amf|mf)$/.exec(String(name || ''));
  if (match) return match[1];
  if (SOFTWARE_LABELS[name] || /^lib/.test(String(name || ''))) return 'software';
  return null;
}

function codecOf(name) {
  for (const [codec, list] of Object.entries(CANDIDATES)) {
    if (list.includes(name)) return codec;
  }
  if (/^h264_/.test(name)) return 'h264';
  if (/^hevc_/.test(name)) return 'hevc';
  if (/^av1_/.test(name) || name === 'libsvtav1') return 'av1';
  if (/^vp9_/.test(name)) return 'vp9';
  return null;
}

function isHardware(name) {
  return HARDWARE_FAMILIES.has(familyOf(name));
}

function label(name) {
  if (name === 'copy') return 'Copy';
  if (SOFTWARE_LABELS[name]) return SOFTWARE_LABELS[name];
  const family = familyOf(name);
  return FAMILY_LABELS[family] || String(name || '');
}

function supportsTenBit(name) {
  return codecOf(name) !== 'h264' && familyOf(name) !== 'mf';
}

function pixFmtFor(name, tenBit = false) {
  const family = familyOf(name);
  if (tenBit && supportsTenBit(name)) return HARDWARE_FAMILIES.has(family) ? 'p010le' : 'yuv420p10le';
  if (family === 'qsv' || family === 'mf') return 'nv12';
  return 'yuv420p';
}

function testExtras(name) {
  const family = familyOf(name);
  if (family === 'mf') return ['-hw_encoding', '1'];
  if (name === 'libx264') return ['-preset', 'ultrafast'];
  if (name === 'libx265') return ['-preset', 'ultrafast', '-x265-params', 'log-level=error'];
  if (name === 'libaom-av1') return ['-cpu-used', '8', '-row-mt', '1'];
  if (name === 'libvpx-vp9') return ['-deadline', 'realtime', '-cpu-used', '8'];
  return [];
}

function encoderTestArgs(name, { tenBit = false } = {}) {
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30',
    '-t',
    '1',
    '-vf',
    `format=${pixFmtFor(name, tenBit)}`,
    '-c:v',
    name,
    ...testExtras(name),
    '-f',
    'null',
    'NUL'
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function kbps(value) {
  return `${Math.round(value)}k`;
}

function scaleQuality(quality, max) {
  return String(clamp(Math.round((quality * max) / 51), 1, max));
}

function rateLimits(video) {
  const bitrate = Math.max(0, Number(video.bitrate) || 0);
  const maxrate = Math.max(0, Number(video.maxrate) || 0);
  const bufsize = Math.max(0, Number(video.bufsize) || 0);
  return { bitrate, maxrate, bufsize };
}

function capArgs(maxrate, bufsize) {
  if (!maxrate) return [];
  return ['-maxrate', kbps(maxrate), '-bufsize', kbps(bufsize || maxrate * 2)];
}

function bitrateArgs(video, { cbrMin = false } = {}) {
  const { bitrate, maxrate, bufsize } = rateLimits(video);
  if (video.bitrateMode === 'cbr') {
    const args = ['-b:v', kbps(bitrate)];
    if (cbrMin) args.push('-minrate', kbps(bitrate));
    args.push('-maxrate', kbps(bitrate), '-bufsize', kbps(bufsize || bitrate * 2));
    return args;
  }
  return ['-b:v', kbps(bitrate), ...capArgs(maxrate, bufsize)];
}

function quality(video) {
  return clamp(Math.round(Number(video.quality) || 23), 1, 51);
}

function speedOf(video) {
  return ['fast', 'balanced', 'quality'].includes(video.speed) ? video.speed : 'balanced';
}

function keyframeArgs(name, video, fps) {
  const seconds = Number(video.keyframeSeconds) > 0 ? Number(video.keyframeSeconds) : 2;
  const rate = fps > 0 ? fps : 30;
  const gop = Math.max(1, Math.round(rate * seconds));
  const args = ['-g', String(gop)];
  if (name === 'libx264') args.push('-keyint_min', String(Math.max(1, Math.min(Math.round(rate), Math.floor(gop / 2) + 1))));
  return args;
}

function h264Profile(name, profile) {
  const family = familyOf(name);
  if (family === 'mf') return ['-profile:v', H264_PROFILE_IDS[profile] || H264_PROFILE_IDS.high];
  if (!['baseline', 'main', 'high'].includes(profile)) return [];
  if (family === 'amf' && profile === 'baseline') return ['-profile:v', 'constrained_baseline'];
  return ['-profile:v', profile];
}

function h264Level(name, level) {
  if (!/^\d\.\d$/.test(String(level || ''))) return [];
  const family = familyOf(name);
  if (family === 'mf') return [];
  if (family === 'qsv') return ['-level', String(Math.round(Number(level) * 10))];
  if (name === 'libx264') return ['-level:v', level];
  return ['-level', level];
}

function hevcProfile(name, profile, tenBit) {
  if (familyOf(name) === 'mf') return [];
  const deep = tenBit && supportsTenBit(name);
  if (profile !== 'main' && !deep) return [];
  return ['-profile:v', deep ? 'main10' : 'main'];
}

function hevcLevel(name, level) {
  if (!/^\d\.\d$/.test(String(level || ''))) return [];
  if (name === 'libx265') return ['-x265-params', `level-idc=${level}`];
  if (name === 'hevc_nvenc') return ['-level', level];
  return [];
}

function profileArgs(name, video, tenBit) {
  const codec = codecOf(name);
  if (codec === 'h264') return [...h264Profile(name, video.profile), ...h264Level(name, video.level)];
  if (codec === 'hevc') return [...hevcProfile(name, video.profile, tenBit), ...hevcLevel(name, video.level)];
  return [];
}

function rateControlArgs(name, video) {
  const family = familyOf(name);
  const codec = codecOf(name);
  const useBitrate = video.rateControl === 'bitrate';
  const q = quality(video);
  const { maxrate, bufsize } = rateLimits(video);
  if (name === 'libx264' || name === 'libx265') {
    return useBitrate ? bitrateArgs(video) : ['-crf', String(q), ...capArgs(maxrate, bufsize)];
  }
  if (name === 'libaom-av1' || name === 'libvpx-vp9') {
    if (useBitrate) return bitrateArgs(video, { cbrMin: true });
    return ['-crf', scaleQuality(q, 63), '-b:v', '0'];
  }
  if (family === 'nvenc') {
    if (useBitrate) return ['-rc', video.bitrateMode === 'cbr' ? 'cbr' : 'vbr', ...bitrateArgs(video)];
    return ['-rc', 'vbr', '-cq', codec === 'av1' ? scaleQuality(q, 63) : String(q), '-b:v', '0', ...capArgs(maxrate, bufsize)];
  }
  if (family === 'qsv') {
    if (useBitrate) return bitrateArgs(video);
    return ['-global_quality', String(q)];
  }
  if (family === 'amf') {
    if (useBitrate) {
      if (video.bitrateMode === 'cbr') return ['-rc', 'cbr', ...bitrateArgs(video)];
      const { bitrate } = rateLimits(video);
      return ['-rc', 'vbr_peak', '-b:v', kbps(bitrate), '-maxrate', kbps(maxrate || bitrate * 1.5), '-bufsize', kbps(bufsize || (maxrate || bitrate * 1.5) * 2)];
    }
    const qp = codec === 'av1' ? scaleQuality(q, 255) : String(q);
    const args = ['-rc', 'cqp', '-qp_i', qp, '-qp_p', qp];
    if (codec === 'h264') args.push('-qp_b', qp);
    return args;
  }
  if (family === 'mf') {
    if (useBitrate) {
      const { bitrate } = rateLimits(video);
      return ['-rate_control', video.bitrateMode === 'cbr' ? 'cbr' : 'u_vbr', '-b:v', kbps(bitrate)];
    }
    return ['-rate_control', 'quality', '-quality', String(clamp(Math.round(100 - (q - 1) * 2), 1, 100))];
  }
  return useBitrate ? bitrateArgs(video) : [];
}

function speedArgs(name, video) {
  const family = familyOf(name);
  const speed = speedOf(video);
  if (name === 'libx264' || name === 'libx265') return ['-preset', SPEEDS[name][speed]];
  if (name === 'libaom-av1') return ['-cpu-used', SPEEDS[name][speed], '-row-mt', '1'];
  if (name === 'libvpx-vp9') return ['-deadline', 'good', '-cpu-used', SPEEDS[name][speed], '-row-mt', '1'];
  if (family === 'nvenc') return ['-preset', SPEEDS.nvenc[speed], '-tune', 'hq'];
  if (family === 'qsv') return ['-preset', SPEEDS.qsv[speed]];
  if (family === 'amf') return ['-quality', SPEEDS.amf[speed]];
  if (family === 'mf') return ['-hw_encoding', '1'];
  return [];
}

function encoderArgs(name, video, { fps = 0, vfr = false, tenBit = false } = {}) {
  const args = ['-c:v', name];
  args.push(...speedArgs(name, video));
  args.push(...rateControlArgs(name, video));
  args.push(...profileArgs(name, video, tenBit));
  args.push(...keyframeArgs(name, video, fps));
  if (vfr && isHardware(name)) args.push('-bf', '0');
  if (name === 'libx265') {
    const index = args.indexOf('-x265-params');
    if (index >= 0) args[index + 1] = `log-level=error:${args[index + 1]}`;
    else args.push('-x265-params', 'log-level=error');
  }
  return args;
}

function supportsTwoPass(name) {
  return name === 'libx264';
}

function normalizeAvailable(available) {
  if (!available) return new Set();
  if (available instanceof Set) return available;
  if (Array.isArray(available)) return new Set(available);
  if (typeof available === 'object') return new Set(Object.keys(available).filter((key) => available[key]));
  return new Set();
}

function supportsContainer(name, container) {
  return !(familyOf(name) === 'mf' && HEADER_FIRST_CONTAINERS.has(container));
}

function pickEncoder(codec, available, hardwarePref = 'auto', forced = 'auto', container = null) {
  const list = CANDIDATES[codec];
  if (!list) return null;
  const working = normalizeAvailable(available);
  const software = SOFTWARE[codec];
  const usable = (name) => working.has(name) && supportsContainer(name, container);
  if (forced && forced !== 'auto') {
    if (forced === software || (codecOf(forced) === codec && usable(forced))) return forced;
  }
  if (hardwarePref === 'software') return software;
  return list.find((name) => name !== software && usable(name)) || software;
}

module.exports = {
  CANDIDATES,
  SOFTWARE,
  isHardware,
  label,
  familyOf,
  codecOf,
  pixFmtFor,
  supportsTenBit,
  encoderTestArgs,
  encoderArgs,
  pickEncoder,
  supportsContainer,
  supportsTwoPass
};
