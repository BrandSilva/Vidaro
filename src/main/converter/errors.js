const MAX_DETAIL = 300;

const MESSAGES = {
  'input-missing': {
    message: 'The source file could not be found.',
    hint: 'It may have been moved, renamed or deleted, or its drive is disconnected. Add it again or reconnect the drive.'
  },
  'input-unreadable': {
    message: 'The source file could not be read. It may be damaged or incomplete.',
    hint: 'Check that the file plays in a media player. If it is still being copied or downloaded, wait and retry.'
  },
  'input-locked': {
    code: 'input-unreadable',
    message: 'The source file could not be opened.',
    hint: 'Close any program that is using the file, then retry. Antivirus software can also block it.'
  },
  'disk-full': {
    message: 'There is not enough free space on the disk.',
    hint: 'Free some space on the target drive or choose another folder, then retry.'
  },
  'access-denied': {
    message: 'Vidaro could not write the output file.',
    hint: 'Choose another output folder, or close any program that is using the file. Antivirus software can also block writes.'
  },
  'output-folder-missing': {
    message: 'The output folder is not available.',
    hint: 'Reconnect the drive or choose another output folder, then retry.'
  },
  'encoder-failed': {
    message: 'The video encoder could not start.',
    hint: 'Update the graphics driver, or switch hardware encoding to Software in Settings.',
    action: 'retry-software'
  },
  'encoder-settings': {
    code: 'encoder-failed',
    message: 'The encoder did not accept these settings.',
    hint: 'Try another preset, or lower the quality or bitrate settings.',
    retryable: false
  },
  'unsupported-codec': {
    message: 'This file uses a format Vidaro cannot decode.',
    hint: 'Try another copy of the file, or the Archive copy preset, which keeps the tracks as they are.',
    retryable: false
  },
  'unsupported-copy': {
    message: 'A track cannot be copied into the chosen format.',
    hint: 'Choose MKV, or a preset that re-encodes the tracks.',
    retryable: false
  },
  'verify-duration': {
    message: 'The converted file does not have the expected length.',
    hint: 'Retry. If it happens again, the source may be damaged: try another preset or the Archive copy preset.'
  },
  'verify-streams': {
    message: 'The converted file is missing its video or audio.',
    hint: 'Retry, or try another preset.'
  },
  'verify-failed': {
    message: 'The converted file could not be checked.',
    hint: 'Retry. If it keeps failing, choose another output folder.'
  },
  'path-too-long': {
    message: 'The output path is too long for Windows.',
    hint: 'Choose a shorter name template or a folder closer to the drive root.',
    retryable: false
  },
  'invalid-job': {
    message: 'This job cannot run because its settings are damaged.',
    hint: 'Remove it and add the file again.',
    retryable: false
  },
  unknown: {
    code: 'convert-failed',
    message: 'The conversion failed.',
    hint: 'Retry. If it keeps failing, try another preset or check that the source file plays.'
  }
};

const ADDRESS = /\s@\s(?:0x)?[0-9a-fA-F]{6,}\]/g;
const INPUT_LINE = /^(?:\[in#\d+|\[(?:[a-z0-9_]+,)+[a-z0-9_]+ @|Error opening input|file:.*:\s)/i;
const OUTPUT_LINE = /^(?:\[out#\d+|Error opening output|\[(?:mp4|mov|ipod|matroska|webm|mp3|wav|flac|opus|ogg|null|avi|image2) @)/i;
const HARDWARE_LINE = /^\[(?:[a-z0-9]+_(?:qsv|nvenc|amf|mf|d3d11va|d3d12va|vaapi|vulkan)|AMF|QSV|MFX|AVHWDeviceContext|hwcontext|vost#\d+:\d+\/[a-z0-9]+_(?:qsv|nvenc|amf|mf|d3d12va))\b/i;
const NOISE = [
  /^Conversion failed!?$/i,
  /Task finished with error code/i,
  /Terminating thread with return code/i,
  /Error sending frames to consumers/i,
  /Nothing was written into output file/i,
  /^Exiting normally/i,
  /^[a-z_0-9]+=\S*$/i,
  /^\s*$/
];

const DISK_FULL = /No space left on device|not enough space on the disk|ENOSPC|Disk quota exceeded/i;
const NOT_FOUND = /No such file or directory|cannot find the (?:file|path)|The system cannot find/i;
const DENIED = /Permission denied|Access is denied|Read-only file system|being used by another process|Operation not permitted$/i;
const DECODER_MISSING = /Decoding requested, but no decoder found|Decoder \(codec [^)]*\) not found|no decoder found for|Unsupported codec with id|Codec is not supported|Could not find codec parameters for stream .*unknown codec/i;
const HARDWARE_FAILURE =
  /Cannot load nvEncodeAPI|nvcuda\.dll|minimum required Nvidia driver|OpenEncodeSessionEx failed|No capable devices found|No NVENC capable devices|NVENC.*(?:not available|unsupported)|DLL amfrt\d*\.dll failed|AMF failed to initiali[sz]e|Failed to create +hardware device context|MFX session|not supported by the QSV runtime|Error initializing an internal MFX|could not find any MFT|could not set (?:input|output) type|format negotiation failed|Device creation failed|Failed to (?:create|initiali[sz]e) (?:a |the )?(?:D3D|DXGI|device|hardware)|hardware device (?:setup|creation) failed|driver does not support|unsupported \(-\d+\)|Current [a-z ]+ is unsupported/i;
const COPY_FAILURE =
  /codec not currently supported in container|Could not find tag for codec|No wav codec tag found|Only VP8 or VP9 or AV1 video and Vorbis or Opus audio|Exactly one MP3 audio stream is required|incompatible with output codec id|Tag \S+ incompatible|Could not write header/i;
const ENCODER_OPEN = /Error while opening encoder|Could not open encoder before EOF|encoder setup failed|Error initializing output stream|Error submitting (?:audio|video) frame to the encoder|Bit allocation failed|bit rate \d+ bps is unsupported/i;
const ENCODER_OPTIONS = /Error applying encoder options|Unable to parse "[^"]+" option value|Error setting option \S+ to value/i;
const INPUT_BROKEN = /Invalid data found when processing input|moov atom not found|EBML header parsing failed|Error opening input|End of file|could not find codec parameters|invalid as first byte of an EBML number|Format \S+ detected only with low score|stream \d+, offset \S+: partial file/i;
const HARD_INPUT_BROKEN = /moov atom not found|EBML header parsing failed|invalid as first byte of an EBML number|partial file/i;

function toLines(value) {
  if (Array.isArray(value)) return value.filter((line) => typeof line === 'string');
  if (typeof value === 'string') return value.split(/\r?\n/);
  return [];
}

function cleanDetail(line) {
  const text = String(line || '')
    .replace(ADDRESS, ']')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function isNoise(line) {
  return NOISE.some((pattern) => pattern.test(line));
}

function build(key, detail, overrides = {}) {
  const entry = MESSAGES[key];
  return {
    code: entry.code || key,
    message: entry.message,
    hint: entry.hint ?? null,
    action: overrides.action !== undefined ? overrides.action : entry.action ?? null,
    retryable: entry.retryable !== false,
    detail: detail ? cleanDetail(detail) : null
  };
}

function find(lines, predicate) {
  return lines.find(predicate) || null;
}

function classify(lines, { stage, hardware }) {
  const probing = stage === 'probe';
  const isInput = (line) => probing || INPUT_LINE.test(line);
  const isOutput = (line) => !probing && OUTPUT_LINE.test(line);
  let line = find(lines, (item) => DISK_FULL.test(item));
  if (line) return ['disk-full', line];
  line = find(lines, (item) => isInput(item) && NOT_FOUND.test(item));
  if (line) return ['input-missing', line];
  line = find(lines, (item) => isInput(item) && DENIED.test(item));
  if (line) return ['input-locked', line];
  line = find(lines, (item) => isOutput(item) && NOT_FOUND.test(item));
  if (line) return ['output-folder-missing', line];
  line = find(lines, (item) => isOutput(item) && DENIED.test(item));
  if (line) return ['access-denied', line];
  line = find(lines, (item) => DECODER_MISSING.test(item));
  if (line) return ['unsupported-codec', line];
  line = find(lines, (item) => HARD_INPUT_BROKEN.test(item));
  if (line) return ['input-unreadable', line];
  line = find(lines, (item) => HARDWARE_FAILURE.test(item) && (HARDWARE_LINE.test(item) || !/^\[/.test(item) || /nvEncodeAPI|amfrt|MFX|MFT/i.test(item)));
  if (line) return ['encoder-failed', line, 'retry-software'];
  line = find(lines, (item) => isInput(item) && INPUT_BROKEN.test(item));
  if (line) return ['input-unreadable', line];
  line = find(lines, (item) => COPY_FAILURE.test(item));
  if (line) return hardware ? ['encoder-failed', line, 'retry-software'] : ['unsupported-copy', line];
  line = find(lines, (item) => ENCODER_OPTIONS.test(item));
  if (line) return hardware ? ['encoder-failed', line, 'retry-software'] : ['encoder-settings', line];
  line = find(lines, (item) => ENCODER_OPEN.test(item));
  if (line) {
    const specific = lines[lines.indexOf(line) - 1];
    const detail = specific && !isNoise(specific) && !ENCODER_OPEN.test(specific) ? specific : line;
    return hardware || HARDWARE_LINE.test(line) ? ['encoder-failed', detail, 'retry-software'] : ['encoder-settings', detail];
  }
  if (probing) return ['input-unreadable', lines[lines.length - 1] || null];
  return null;
}

function mapFfmpegError(stderrLines, { exitCode = null, stage = 'convert', hardware = false } = {}) {
  const lines = toLines(stderrLines)
    .map((line) => line.trim())
    .filter((line) => !isNoise(line));
  const match = classify(lines, { stage, hardware: Boolean(hardware) });
  if (match) {
    const [key, line, action] = match;
    return build(key, line, action === undefined ? {} : { action });
  }
  const last = lines[lines.length - 1];
  const fallback = last || (exitCode !== null && exitCode !== undefined ? `ffmpeg exited with code ${exitCode}` : null);
  return build('unknown', fallback);
}

function errorFor(key, detail = null) {
  return build(Object.hasOwn(MESSAGES, key) ? key : 'unknown', detail);
}

function isInputProblem(code) {
  return code === 'input-missing' || code === 'input-unreadable' || code === 'unsupported-codec';
}

function isEnvironmentProblem(code) {
  return code === 'disk-full' || code === 'access-denied' || code === 'output-folder-missing';
}

module.exports = { mapFfmpegError, errorFor, cleanDetail, isInputProblem, isEnvironmentProblem, MESSAGES };
