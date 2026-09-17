const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { mapFfmpegError, errorFor, cleanDetail, isInputProblem, isEnvironmentProblem, MESSAGES } = require('../src/main/converter/errors');
const { ERROR_ACTIONS, JobError } = require('../src/main/errors');

const PATH = 'file:C:\\Users\\Brando\\Videos\\Archivo ñ\\clip.avi';
const OUT = 'file:C:\\Users\\Brando\\Videos\\Vidaro\\clip.mp4.partial';

const SAMPLES = {
  inputMissing: [
    '[in#0 @ 0000020705ea2140] Error opening input: No such file or directory',
    `Error opening input file ${PATH}.`,
    'Error opening input files: No such file or directory'
  ],
  probeMissing: [`${PATH}: No such file or directory`],
  garbage: [
    '[in#0 @ 000001c3b4382680] Error opening input: Invalid data found when processing input',
    `Error opening input file ${PATH}.`,
    'Error opening input files: Invalid data found when processing input'
  ],
  probeGarbage: [`${PATH}: Invalid data found when processing input`],
  truncatedMp4: [
    '[in#0 @ 0000019176771880] moov atom not found',
    '[in#0 @ 0000019176771640] Error opening input: Invalid data found when processing input',
    `Error opening input file ${PATH}.`,
    'Error opening input files: Invalid data found when processing input'
  ],
  probeTruncatedMp4: ['[mov,mp4,m4a,3gp,3g2,mj2 @ 0000028839525880] moov atom not found', `${PATH}: Invalid data found when processing input`],
  headlessMkv: [
    'Truncating packet of size 197682893 to 19993',
    '[in#0 @ 0000026c2bf42c40] EBML header parsing failed',
    '[in#0 @ 0000026c2bf429c0] Error opening input: Invalid data found when processing input',
    `Error opening input file ${PATH}.`,
    'Error opening input files: Invalid data found when processing input'
  ],
  folderMissing: [
    `[out#0/mp4 @ 000001d099986400] Error opening output ${OUT}: No such file or directory`,
    `Error opening output file ${OUT}.`,
    'Error opening output files: No such file or directory'
  ],
  permission: [
    '[out#0/mp4 @ 0000021d09586180] Error opening output file:C:/Windows/clip.mp4.partial: Permission denied',
    'Error opening output file file:C:/Windows/clip.mp4.partial.',
    'Error opening output files: Permission denied'
  ],
  diskFull: [
    '[out#0/mp4 @ 000001a2b3c4d5e6] Error submitting a packet to the muxer: No space left on device',
    '[out#0/mp4 @ 000001a2b3c4d5e6] Error writing trailer: No space left on device',
    'Conversion failed!'
  ],
  nvenc: [
    '[h264_nvenc @ 0000025817320dc0] Cannot load nvEncodeAPI64.dll',
    '[h264_nvenc @ 0000025817320dc0] The minimum required Nvidia driver for nvenc is 610.00 or newer',
    '[vost#0:0/h264_nvenc @ 0000025816e80f40] [enc:h264_nvenc @ 0000025816e562c0] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
    '[vf#0:0 @ 0000025817321180] Error sending frames to consumers: Operation not permitted',
    '[vf#0:0 @ 0000025817321180] Task finished with error code: -1 (Operation not permitted)',
    '[vf#0:0 @ 0000025817321180] Terminating thread with return code -1 (Operation not permitted)',
    '[vost#0:0/h264_nvenc @ 0000025816e80f40] [enc:h264_nvenc @ 0000025816e562c0] Could not open encoder before EOF',
    '[vost#0:0/h264_nvenc @ 0000025816e80f40] Task finished with error code: -22 (Invalid argument)',
    '[out#0/null @ 0000025816e730c0] Nothing was written into output file, because at least one of its streams received no packets.'
  ],
  amf: [
    '[AMF @ 00000273473b3ac0] DLL amfrt64.dll failed to open',
    '[h264_amf @ 0000027347170fc0] Failed to create  hardware device context (AMF) : Unknown error occurred',
    '[vost#0:0/h264_amf @ 00000273455e9d80] [enc:h264_amf @ 0000027345542800] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
    '[vf#0:0 @ 0000027347171140] Error sending frames to consumers: Unknown error occurred',
    '[vost#0:0/h264_amf @ 00000273455e9d80] [enc:h264_amf @ 0000027345542800] Could not open encoder before EOF'
  ],
  qsvAv1: [
    '[av1_qsv @ 000001a5b0fc0e80] Current codec type is unsupported',
    '[av1_qsv @ 000001a5b0fc0e80] some encoding parameters are not supported by the QSV runtime. Please double check the input parameters.',
    '[vost#0:0/av1_qsv @ 000001a5b0aa19c0] [enc:av1_qsv @ 000001a5b0a74900] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
    '[vf#0:0 @ 000001a5b0fc1ac0] Error sending frames to consumers: Function not implemented'
  ],
  qsvSession: [
    '[h264_qsv @ 000001f2c3d4e5f6] Error initializing an internal MFX session: unsupported (-3)',
    '[vost#0:0/h264_qsv @ 000001f2c3d4e600] [enc:h264_qsv @ 000001f2c3d4e700] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.'
  ],
  mfTenBit: [
    '[hevc_mf @ 000001b29d450f00] format negotiation failed (1/0)',
    '[vost#0:0/hevc_mf @ 000001b29d450cc0] [enc:hevc_mf @ 000001b29cef6480] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
    '[vf#0:0 @ 000001b29d4512c0] Error sending frames to consumers: Generic error in an external library'
  ],
  mfSize: [
    '[h264_mf @ 000001c427f43cc0] could not set output type (MF_E_INVALIDMEDIATYPE)',
    '[vost#0:0/h264_mf @ 000001c427f42580] [enc:h264_mf @ 000001c427f14b80] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.'
  ],
  mfInMkv: [
    '[out#0/matroska @ 0000024908065d80] Could not write header (incorrect codec parameters ?): Invalid data found when processing input',
    '[vf#0:0 @ 0000024908651340] Error sending frames to consumers: Invalid data found when processing input',
    '[vf#0:0 @ 0000024908651340] Task finished with error code: -1094995529 (Invalid data found when processing input)',
    '[out#0/matroska @ 0000024908065d80] Nothing was written into output file, because at least one of its streams received no packets.'
  ],
  noDecoder: [
    '[vist#0:0/none @ 000001aa1c719a40] Decoding requested, but no decoder found for: none',
    `Error opening output file ${OUT}.`,
    'Error opening output files: Invalid argument'
  ],
  webmCopy: [
    '[webm @ 0000025f164d9c80] Only VP8 or VP9 or AV1 video and Vorbis or Opus audio and WebVTT subtitles are supported for WebM.',
    '[out#0/webm @ 0000025f164d3f40] Could not write header (incorrect codec parameters ?): Invalid argument'
  ],
  mp4Tag: [
    '[mp4 @ 00000275bb492340] Could not find tag for codec dvvideo in stream #0, codec not currently supported in container',
    '[out#0/mp4 @ 00000275bb485dc0] Could not write header (incorrect codec parameters ?): Invalid argument',
    '[vf#0:0 @ 00000275bb4b8780] Error sending frames to consumers: Invalid argument'
  ],
  mkvAdpcm: [
    '[matroska @ 0000026603e5a200] No wav codec tag found for codec adpcm_ima_qt',
    '[out#0/matroska @ 0000026603e53940] Could not write header (incorrect codec parameters ?): Invalid argument'
  ],
  opusBitrate: [
    '[libopus @ 000002e66a1b3f80] The bit rate 320000 bps is unsupported. Please choose a value between 500 and 256000.',
    '[aost#0:0/libopus @ 000002e66a1b3d00] [enc:libopus @ 000002e66a173a40] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
    '[af#0:0 @ 000002e66a1b4400] Error sending frames to consumers: Invalid argument'
  ],
  vorbisSetup: [
    '[libvorbis @ 000002689fdc34c0] encoder setup failed',
    '[aost#0:0/libvorbis @ 000002689fdc31c0] [enc:libvorbis @ 000002689fd82940] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.'
  ],
  badOption: [
    "[libx264 @ 000002041662b900] [Eval @ 0000000e0a1fd6b0] Undefined constant or missing '(' in 'abc'",
    '[libx264 @ 000002041662b900] Unable to parse "crf" option value "abc"',
    '[libx264 @ 000002041662b900] Error setting option crf to value abc.',
    '[vost#0:0/libx264 @ 00000204166303c0] Error applying encoder options: Invalid argument',
    `Error opening output file ${OUT}.`,
    'Error opening output files: Invalid argument'
  ],
  filterError: [
    "[Parsed_scale_0 @ 000002a296782f00] Invalid size 'bogus'",
    '[AVFilterGraph @ 000002a296782e40] Error initializing filters',
    `Error opening output file ${OUT}.`,
    'Error opening output files: Invalid argument'
  ]
};

describe('mapFfmpegError with real ffmpeg 9 output', () => {
  test('a missing source file', () => {
    const result = mapFfmpegError(SAMPLES.inputMissing, { exitCode: 254 });
    assert.deepEqual(result, {
      code: 'input-missing',
      message: MESSAGES['input-missing'].message,
      hint: MESSAGES['input-missing'].hint,
      action: null,
      retryable: true,
      detail: '[in#0] Error opening input: No such file or directory'
    });
  });

  test('ffprobe reports a missing file with the path as prefix', () => {
    assert.equal(mapFfmpegError(SAMPLES.probeMissing, { exitCode: 1, stage: 'probe' }).code, 'input-missing');
  });

  test('garbage, truncated MP4 and headless MKV sources are unreadable', () => {
    for (const [lines, stage] of [
      [SAMPLES.garbage, 'convert'],
      [SAMPLES.probeGarbage, 'probe'],
      [SAMPLES.truncatedMp4, 'convert'],
      [SAMPLES.probeTruncatedMp4, 'probe'],
      [SAMPLES.headlessMkv, 'convert']
    ]) {
      const result = mapFfmpegError(lines, { exitCode: 1, stage });
      assert.equal(result.code, 'input-unreadable', lines.join('\n'));
      assert.equal(result.retryable, true);
    }
    assert.equal(mapFfmpegError(SAMPLES.truncatedMp4).detail, '[in#0] moov atom not found');
    assert.equal(mapFfmpegError(SAMPLES.headlessMkv).detail, '[in#0] EBML header parsing failed');
  });

  test('an unknown probe failure still counts as an unreadable input', () => {
    const result = mapFfmpegError(['something odd happened'], { exitCode: 1, stage: 'probe' });
    assert.equal(result.code, 'input-unreadable');
    assert.equal(result.detail, 'something odd happened');
  });

  test('a missing output folder is not a missing input', () => {
    const result = mapFfmpegError(SAMPLES.folderMissing, { exitCode: 254 });
    assert.equal(result.code, 'output-folder-missing');
    assert.match(result.detail, /^\[out#0\/mp4\] Error opening output/);
  });

  test('a protected output folder or read-only file', () => {
    const result = mapFfmpegError(SAMPLES.permission, { exitCode: 254 });
    assert.equal(result.code, 'access-denied');
    assert.match(result.hint, /another output folder/);
  });

  test('an input locked by another program', () => {
    const result = mapFfmpegError(['[in#0 @ 0000020705ea2140] Error opening input: Permission denied'], { exitCode: 254 });
    assert.equal(result.code, 'input-unreadable');
    assert.match(result.hint, /Close any program/);
  });

  test('a full disk wins over everything else', () => {
    const result = mapFfmpegError([...SAMPLES.diskFull, ...SAMPLES.nvenc], { exitCode: 228 });
    assert.equal(result.code, 'disk-full');
    assert.equal(result.detail, '[out#0/mp4] Error submitting a packet to the muxer: No space left on device');
  });

  test('NVIDIA, AMD and Intel driver failures are hardware encoder failures', () => {
    for (const lines of [SAMPLES.nvenc, SAMPLES.amf, SAMPLES.qsvAv1, SAMPLES.qsvSession, SAMPLES.mfTenBit, SAMPLES.mfSize]) {
      const result = mapFfmpegError(lines, { exitCode: 1, hardware: true });
      assert.equal(result.code, 'encoder-failed', lines[0]);
      assert.equal(result.action, 'retry-software');
      assert.equal(result.retryable, true);
    }
    assert.equal(mapFfmpegError(SAMPLES.nvenc).detail, '[h264_nvenc] Cannot load nvEncodeAPI64.dll');
    assert.equal(mapFfmpegError(SAMPLES.amf).detail, '[AMF] DLL amfrt64.dll failed to open');
    assert.equal(mapFfmpegError(SAMPLES.qsvAv1).detail, '[av1_qsv] Current codec type is unsupported');
  });

  test('driver failures are recognised even without the hardware hint', () => {
    for (const lines of [SAMPLES.nvenc, SAMPLES.amf, SAMPLES.qsvSession, SAMPLES.mfTenBit]) {
      assert.equal(mapFfmpegError(lines).code, 'encoder-failed', lines[0]);
    }
  });

  test('a Media Foundation stream refused by MKV is a hardware problem, not a broken input', () => {
    assert.equal(mapFfmpegError(SAMPLES.mfInMkv, { hardware: true }).code, 'encoder-failed');
    assert.equal(mapFfmpegError(SAMPLES.mfInMkv).code, 'unsupported-copy');
  });

  test('a stream with no decoder', () => {
    const result = mapFfmpegError(SAMPLES.noDecoder, { exitCode: 234 });
    assert.equal(result.code, 'unsupported-codec');
    assert.equal(result.retryable, false);
    assert.equal(result.detail, '[vist#0:0/none] Decoding requested, but no decoder found for: none');
  });

  test('tracks a container cannot hold', () => {
    for (const lines of [SAMPLES.webmCopy, SAMPLES.mp4Tag, SAMPLES.mkvAdpcm]) {
      const result = mapFfmpegError(lines, { exitCode: 234 });
      assert.equal(result.code, 'unsupported-copy', lines[0]);
      assert.equal(result.retryable, false);
    }
    assert.equal(mapFfmpegError(SAMPLES.mkvAdpcm).detail, '[matroska] No wav codec tag found for codec adpcm_ima_qt');
  });

  test('software encoders that reject their settings', () => {
    for (const lines of [SAMPLES.opusBitrate, SAMPLES.vorbisSetup, SAMPLES.badOption]) {
      const result = mapFfmpegError(lines, { exitCode: 234 });
      assert.equal(result.code, 'encoder-failed', lines[0]);
      assert.equal(result.action, null);
      assert.equal(result.retryable, false);
    }
    assert.equal(mapFfmpegError(SAMPLES.opusBitrate).detail, '[libopus] The bit rate 320000 bps is unsupported. Please choose a value between 500 and 256000.');
    assert.equal(mapFfmpegError(SAMPLES.vorbisSetup).detail, '[libvorbis] encoder setup failed');
  });

  test('anything else is unknown with the last meaningful line as detail', () => {
    const result = mapFfmpegError(SAMPLES.filterError, { exitCode: 234 });
    assert.equal(result.code, 'convert-failed');
    assert.equal(result.detail, 'Error opening output files: Invalid argument');
    assert.equal(result.retryable, true);
  });

  test('empty output falls back to the exit code', () => {
    assert.equal(mapFfmpegError([], { exitCode: 3 }).detail, 'ffmpeg exited with code 3');
    assert.equal(mapFfmpegError(undefined).detail, null);
    assert.equal(mapFfmpegError('Conversion failed!\n').code, 'convert-failed');
  });

  test('progress lines and noise are never picked as detail', () => {
    const result = mapFfmpegError(['frame=10', 'progress=continue', 'Conversion failed!'], { exitCode: 1 });
    assert.equal(result.detail, 'ffmpeg exited with code 1');
  });

  test('every mapped result can become a JobError with a valid action', () => {
    for (const lines of Object.values(SAMPLES)) {
      const mapped = mapFfmpegError(lines, { exitCode: 1 });
      assert.ok(mapped.action === null || ERROR_ACTIONS.includes(mapped.action));
      const error = JobError.from(mapped);
      assert.equal(error.code, mapped.code);
      assert.equal(error.message, mapped.message);
    }
  });

  test('messages are plain sentences', () => {
    for (const entry of Object.values(MESSAGES)) {
      assert.match(entry.message, /^[A-Z].*\.$/);
      assert.match(entry.hint, /^[A-Z].*\.$/);
    }
  });
});

describe('error helpers', () => {
  test('errorFor builds known errors and falls back to unknown', () => {
    assert.equal(errorFor('verify-duration', 'Expected 2 s').code, 'verify-duration');
    assert.equal(errorFor('verify-duration', 'Expected 2 s').detail, 'Expected 2 s');
    assert.equal(errorFor('input-locked').code, 'input-unreadable');
    assert.equal(errorFor('encoder-settings').code, 'encoder-failed');
    assert.equal(errorFor('invalid-job').retryable, false);
    assert.equal(errorFor('nope').code, 'convert-failed');
  });

  test('cleanDetail removes memory addresses and caps the length', () => {
    assert.equal(cleanDetail('[h264_qsv @ 000001f2c3d4e5f6] Error  here'), '[h264_qsv] Error here');
    assert.equal(cleanDetail('x'.repeat(400)).length, 300);
  });

  test('problem groups', () => {
    assert.equal(isInputProblem('input-missing'), true);
    assert.equal(isInputProblem('unsupported-codec'), true);
    assert.equal(isInputProblem('encoder-failed'), false);
    assert.equal(isEnvironmentProblem('disk-full'), true);
    assert.equal(isEnvironmentProblem('output-folder-missing'), true);
    assert.equal(isEnvironmentProblem('convert-failed'), false);
  });
});
