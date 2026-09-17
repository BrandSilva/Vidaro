const MARKERS = Object.freeze({
  download: 'VIDARO-DL ',
  postprocess: 'VIDARO-PP ',
  parts: 'VIDARO-PARTS ',
  file: 'VIDARO-FILE '
});

const STAGES = Object.freeze([
  'starting',
  'downloading',
  'merging',
  'remuxing',
  'converting-audio',
  'embedding',
  'fixing',
  'cutting',
  'moving',
  'processing',
  'finished'
]);

const DOWNLOAD_FIELDS = [
  ['status', 'progress.status'],
  ['downloaded', 'progress.downloaded_bytes'],
  ['total', 'progress.total_bytes'],
  ['estimate', 'progress.total_bytes_estimate'],
  ['speed', 'progress.speed'],
  ['eta', 'progress.eta'],
  ['frag', 'progress.fragment_index'],
  ['frags', 'progress.fragment_count'],
  ['format', 'info.format_id'],
  ['file', 'progress.filename']
];

const PART_FIELDS = 'format_id,vcodec,acodec,filesize,filesize_approx,protocol';

function jsonTemplate(fields) {
  return `{${fields.map(([name, field]) => `"${name}":%(${field}|null)j`).join(',')}}`;
}

const DOWNLOAD_TEMPLATE = `download:${MARKERS.download}${jsonTemplate(DOWNLOAD_FIELDS)}`;
const POSTPROCESS_TEMPLATE = `postprocess:${MARKERS.postprocess}${jsonTemplate([
  ['status', 'progress.status'],
  ['pp', 'progress.postprocessor']
])}`;
const PARTS_TEMPLATE = `video:${MARKERS.parts}${jsonTemplate([
  ['format', 'format_id'],
  ['protocol', 'protocol'],
  ['ext', 'ext'],
  ['duration', 'duration'],
  ['sectionStart', 'section_start'],
  ['sectionEnd', 'section_end']
]).slice(0, -1)},"parts":%(requested_formats.:.{${PART_FIELDS}}|null)j}`;
const FILE_TEMPLATE = `after_move:${MARKERS.file}%(filepath)j`;
const PROGRESS_DELTA_SECONDS = '0.5';
const FFMPEG_PROGRESS = 'ffmpeg:-progress pipe:1 -nostats';

function progressArgs() {
  return [
    '--newline',
    '--progress',
    '--progress-delta',
    PROGRESS_DELTA_SECONDS,
    '--progress-template',
    DOWNLOAD_TEMPLATE,
    '--progress-template',
    POSTPROCESS_TEMPLATE,
    '--print',
    PARTS_TEMPLATE,
    '--print',
    FILE_TEMPLATE,
    '--no-simulate',
    '--downloader-args',
    FFMPEG_PROGRESS
  ];
}

const PP_STAGES = {
  Merger: 'merging',
  VideoRemuxer: 'remuxing',
  VideoConvertor: 'processing',
  ExtractAudio: 'converting-audio',
  EmbedThumbnail: 'embedding',
  EmbedSubtitle: 'embedding',
  Metadata: 'embedding',
  FixupM4a: 'fixing',
  FixupM3u8: 'fixing',
  FixupTimestamp: 'fixing',
  FixupDuration: 'fixing',
  FixupStretched: 'fixing',
  FixupDuplicateMoov: 'fixing',
  CopyStream: 'fixing',
  ModifyChapters: 'cutting',
  SplitChapters: 'cutting',
  SponsorBlock: null,
  MoveFiles: 'moving',
  ThumbnailsConvertor: null,
  SubtitlesConvertor: null,
  Exec: null
};

const FFMPEG_KEYS = new Set([
  'frame',
  'fps',
  'bitrate',
  'total_size',
  'out_time_us',
  'out_time_ms',
  'out_time',
  'dup_frames',
  'drop_frames',
  'speed',
  'progress'
]);

const POST_STAGES = new Set(['merging', 'remuxing', 'converting-audio', 'embedding', 'fixing', 'cutting', 'moving']);
const FFMPEG_PROTOCOLS = new Set(['m3u8', 'rtmp_ffmpeg']);
const DOWNLOAD_SCALE = 99;
const ESTIMATE_CAP = 0.95;

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value ? value : null;
}

function parseJson(line, marker) {
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    return undefined;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stageForPostprocessor(name) {
  if (typeof name !== 'string' || !name) return 'processing';
  return Object.hasOwn(PP_STAGES, name) ? PP_STAGES[name] : 'processing';
}

function describeParts(list) {
  const parts = list
    .filter(isObject)
    .map((part) => ({
      id: text(part.format_id),
      size: number(part.filesize) ?? number(part.filesize_approx),
      video: typeof part.vcodec === 'string' ? part.vcodec !== 'none' : true
    }))
    .filter((part) => part.id);
  if (parts.length === 0) return [];
  const known = parts.every((part) => part.size > 0);
  const sum = parts.reduce((total, part) => total + (part.size || 0), 0);
  const raw = parts.map((part) => {
    if (known && sum > 0) return part.size / sum;
    if (parts.length > 1) return part.video ? 0.85 : 0.15;
    return 1;
  });
  const rawSum = raw.reduce((total, value) => total + value, 0);
  return parts.map((part, index) => ({ ...part, weight: raw[index] / rawSum }));
}

function isCombined(data) {
  if (number(data.sectionStart) !== null || number(data.sectionEnd) !== null) return true;
  const protocols = typeof data.protocol === 'string' ? data.protocol.split('+') : [];
  return protocols.length > 1 && protocols.every((protocol) => FFMPEG_PROTOCOLS.has(protocol));
}

function mediaLength(data) {
  const total = number(data.duration);
  const start = number(data.sectionStart);
  if (start === null) return total > 0 ? total : null;
  const end = number(data.sectionEnd) ?? total;
  return end !== null && end > start ? end - start : null;
}

function createDownloadParser({ duration = null, singlePart = false } = {}) {
  const given = number(duration) > 0 ? duration : null;
  let expected = given;
  let parts = [];
  let index = 0;
  let file = null;
  let finishedFile = null;
  let stage = 'starting';
  let percent = null;
  let finished = false;
  let block = {};
  let formatKnown = false;
  let doneBytes = new Map();

  function setStage(next) {
    if (finished || !next || next === stage) return null;
    stage = next;
    return { type: 'stage', stage };
  }

  function downloadStage() {
    if (!POST_STAGES.has(stage)) stage = 'downloading';
    return stage;
  }

  function raise(value) {
    if (value === null) return percent;
    const clamped = Math.min(DOWNLOAD_SCALE, Math.max(0, value));
    const rounded = Math.round(clamped * 10) / 10;
    percent = percent === null ? rounded : Math.max(percent, rounded);
    return percent;
  }

  function weighted(fraction) {
    if (fraction === null) return null;
    const weights = parts.length > 0 ? parts.map((part) => part.weight) : [1];
    const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
    return (before + weights[index] * fraction) * DOWNLOAD_SCALE;
  }

  function locate(format, name) {
    if (format && format.includes('+')) {
      parts = [];
      index = 0;
      return;
    }
    if (parts.length > 0 && format) {
      const found = parts.findIndex((part) => part.id === format);
      if (found !== -1) {
        index = found;
        return;
      }
    }
    if (parts.length > 1 && name && finishedFile && name !== finishedFile && index < parts.length - 1 && name !== file) {
      index += 1;
    }
  }

  function totals(current, currentTotal) {
    if (parts.length < 2) return { downloaded: current, total: currentTotal };
    let downloaded = 0;
    for (let i = 0; i < parts.length; i += 1) {
      if (i < index) downloaded += doneBytes.get(i) ?? parts[i].size ?? 0;
    }
    downloaded += current ?? 0;
    const sizes = parts.map((part, i) => (i === index && currentTotal ? currentTotal : doneBytes.get(i) ?? part.size));
    const total = sizes.every((size) => size > 0) ? sizes.reduce((sum, size) => sum + size, 0) : null;
    return { downloaded, total };
  }

  function onDownload(data) {
    if (finished || !isObject(data)) return null;
    const status = text(data.status);
    if (status !== 'downloading' && status !== 'finished') return null;
    const format = text(data.format);
    if (!format && formatKnown) return null;
    const name = text(data.file);
    locate(format, name);
    file = name ?? file;
    const current = number(data.downloaded);
    const exact = number(data.total);
    const estimate = number(data.estimate);
    const size = exact ?? estimate;
    const frags = number(data.frags);
    const frag = number(data.frag);
    let fraction = null;
    if (status === 'finished') fraction = 1;
    else if (exact > 0 && current !== null) fraction = Math.min(1, current / exact);
    else if (frags > 0 && frag !== null) fraction = Math.min(1, frag / frags);
    else if (estimate > 0 && current !== null) fraction = Math.min(ESTIMATE_CAP, current / estimate);
    const overall = weighted(fraction);
    if (status === 'finished') {
      doneBytes.set(index, exact ?? current ?? parts[index]?.size ?? 0);
      finishedFile = name;
    }
    const partBytes = status === 'finished' ? doneBytes.get(index) : current;
    const partTotal = status === 'finished' ? doneBytes.get(index) : size;
    const { downloaded, total } = totals(partBytes, partTotal);
    const speed = number(data.speed);
    let eta = number(data.eta);
    if (speed > 0 && total > 0 && downloaded !== null && (parts.length > 1 || (eta === null && exact > 0))) {
      eta = Math.max(0, Math.round((total - downloaded) / speed));
    }
    return {
      type: 'progress',
      stage: downloadStage(),
      percent: raise(overall),
      downloaded,
      total,
      speed,
      eta: status === 'finished' ? 0 : eta,
      fragment: frags > 0 ? { index: frag ?? 0, count: frags } : null,
      part: { index: index + 1, count: Math.max(1, parts.length) }
    };
  }

  function onParts(data) {
    if (!isObject(data)) return null;
    finished = false;
    parts = Array.isArray(data.parts) && singlePart !== true && !isCombined(data) ? describeParts(data.parts) : [];
    formatKnown = text(data.format) !== null;
    expected = given ?? mediaLength(data);
    index = 0;
    file = null;
    finishedFile = null;
    block = {};
    doneBytes = new Map();
    stage = 'starting';
    return { type: 'stage', stage, parts: Math.max(1, parts.length) };
  }

  function onPostprocess(data) {
    if (!isObject(data) || data.status !== 'started') return null;
    return setStage(stageForPostprocessor(data.pp));
  }

  function onFfmpeg(key, value) {
    block[key] = value;
    if (key !== 'progress') return null;
    const current = block;
    block = {};
    if (finished) return null;
    while (parts.length > 1 && index < parts.length - 1 && doneBytes.has(index)) index += 1;
    const micros = Number(current.out_time_us);
    const seconds = Number.isFinite(micros) && micros >= 0 ? micros / 1e6 : null;
    const size = Number(current.total_size);
    const factor = Number.parseFloat(current.speed);
    const realtime = Number.isFinite(factor) && factor > 0 ? factor : null;
    const frame = Number(current.frame);
    let fraction = null;
    if (value === 'end') fraction = 1;
    else if (expected && seconds !== null) fraction = Math.min(1, seconds / expected);
    const { downloaded, total } = totals(Number.isFinite(size) && size >= 0 ? size : null, null);
    return {
      type: 'progress',
      stage: downloadStage(),
      percent: raise(weighted(fraction)),
      downloaded,
      total,
      speed: null,
      eta: expected && seconds !== null && realtime ? Math.max(0, Math.round((expected - Math.min(seconds, expected)) / realtime)) : null,
      fragment: null,
      part: { index: index + 1, count: Math.max(1, parts.length) },
      time: seconds,
      frames: Number.isInteger(frame) && frame >= 0 ? frame : null,
      realtime
    };
  }

  function onFile(value) {
    if (typeof value !== 'string' || !value) return null;
    finished = true;
    stage = 'finished';
    percent = 100;
    return { type: 'filepath', path: value, stage, percent };
  }

  function push(input) {
    if (typeof input !== 'string') return null;
    const line = input.trim();
    if (!line) return null;
    if (line.startsWith(MARKERS.download)) {
      const data = parseJson(line, MARKERS.download);
      return data === undefined ? null : onDownload(data);
    }
    if (line.startsWith(MARKERS.postprocess)) {
      const data = parseJson(line, MARKERS.postprocess);
      return data === undefined ? null : onPostprocess(data);
    }
    if (line.startsWith(MARKERS.parts)) {
      const data = parseJson(line, MARKERS.parts);
      return data === undefined ? null : onParts(data);
    }
    if (line.startsWith(MARKERS.file)) {
      const value = parseJson(line, MARKERS.file);
      return value === undefined ? null : onFile(value);
    }
    if (line.startsWith('ERROR:')) return { type: 'error', text: line.slice(6).trim() };
    if (line.startsWith('WARNING:')) return { type: 'warning', text: line.slice(8).trim() };
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq);
      if (FFMPEG_KEYS.has(key) || /^stream_\d+_\d+_q$/.test(key)) return onFfmpeg(key, line.slice(eq + 1).trim());
    }
    return null;
  }

  return {
    push,
    get stage() {
      return stage;
    },
    get percent() {
      return percent;
    },
    get parts() {
      return Math.max(1, parts.length);
    },
    get duration() {
      return expected;
    }
  };
}

module.exports = {
  createDownloadParser,
  progressArgs,
  stageForPostprocessor,
  MARKERS,
  STAGES,
  DOWNLOAD_TEMPLATE,
  POSTPROCESS_TEMPLATE,
  PARTS_TEMPLATE,
  FILE_TEMPLATE
};
