const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const enc = require('../src/main/converter/encoders');

const VIDEO = {
  mode: 'encode',
  codec: 'h264',
  encoder: 'auto',
  rateControl: 'quality',
  quality: 20,
  bitrate: 8000,
  bitrateMode: 'vbr',
  maxrate: 0,
  bufsize: 0,
  twoPass: false,
  speed: 'balanced',
  profile: 'auto',
  level: 'auto',
  keyframeSeconds: 0
};

function video(patch = {}) {
  return { ...VIDEO, ...patch };
}

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe('candidates and labels', () => {
  test('hardware is tried before software, Quick Sync first', () => {
    assert.deepEqual(enc.CANDIDATES.h264, ['h264_qsv', 'h264_nvenc', 'h264_amf', 'h264_mf', 'libx264']);
    assert.deepEqual(enc.CANDIDATES.hevc, ['hevc_qsv', 'hevc_nvenc', 'hevc_amf', 'hevc_mf', 'libx265']);
    assert.deepEqual(enc.CANDIDATES.av1, ['av1_qsv', 'av1_nvenc', 'av1_amf', 'libaom-av1']);
    assert.deepEqual(enc.CANDIDATES.vp9, ['libvpx-vp9']);
  });

  test('isHardware knows every family', () => {
    for (const name of ['h264_qsv', 'hevc_nvenc', 'av1_amf', 'h264_mf']) assert.equal(enc.isHardware(name), true);
    for (const name of ['libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'copy', '']) assert.equal(enc.isHardware(name), false);
  });

  test('labels are plain words', () => {
    assert.equal(enc.label('h264_qsv'), 'Intel Quick Sync');
    assert.equal(enc.label('hevc_nvenc'), 'NVIDIA NVENC');
    assert.equal(enc.label('h264_amf'), 'AMD AMF');
    assert.equal(enc.label('h264_mf'), 'Windows Media Foundation');
    assert.equal(enc.label('libx264'), 'Software (x264)');
    assert.equal(enc.label('libx265'), 'Software (x265)');
    assert.equal(enc.label('copy'), 'Copy');
  });

  test('codecOf maps names to codecs', () => {
    assert.equal(enc.codecOf('hevc_qsv'), 'hevc');
    assert.equal(enc.codecOf('libaom-av1'), 'av1');
    assert.equal(enc.codecOf('libx264'), 'h264');
    assert.equal(enc.codecOf('mystery'), null);
  });
});

describe('encoderTestArgs', () => {
  test('encodes one second of 720p test pattern to the null muxer', () => {
    const args = enc.encoderTestArgs('h264_nvenc');
    assert.equal(valueOf(args, '-i'), 'testsrc2=size=1280x720:rate=30');
    assert.equal(valueOf(args, '-t'), '1');
    assert.equal(valueOf(args, '-c:v'), 'h264_nvenc');
    assert.equal(valueOf(args, '-vf'), 'format=yuv420p');
    assert.deepEqual(args.slice(-3), ['-f', 'null', 'NUL']);
    assert.equal(valueOf(args, '-loglevel'), 'error');
  });

  test('Quick Sync and Media Foundation get nv12, and MF is forced to hardware', () => {
    assert.equal(valueOf(enc.encoderTestArgs('h264_qsv'), '-vf'), 'format=nv12');
    const mf = enc.encoderTestArgs('hevc_mf');
    assert.equal(valueOf(mf, '-vf'), 'format=nv12');
    assert.equal(valueOf(mf, '-hw_encoding'), '1');
  });

  test('a 10-bit probe feeds the 10-bit format each family expects', () => {
    assert.equal(valueOf(enc.encoderTestArgs('hevc_qsv', { tenBit: true }), '-vf'), 'format=p010le');
    assert.equal(valueOf(enc.encoderTestArgs('hevc_nvenc', { tenBit: true }), '-vf'), 'format=p010le');
    assert.equal(valueOf(enc.encoderTestArgs('libx265', { tenBit: true }), '-vf'), 'format=yuv420p10le');
    assert.equal(valueOf(enc.encoderTestArgs('h264_qsv', { tenBit: true }), '-vf'), 'format=nv12');
  });

  test('slow software encoders use their fastest settings', () => {
    assert.equal(valueOf(enc.encoderTestArgs('libaom-av1'), '-cpu-used'), '8');
    assert.equal(valueOf(enc.encoderTestArgs('libx265'), '-preset'), 'ultrafast');
  });
});

describe('pixel formats', () => {
  test('8-bit formats per family', () => {
    assert.equal(enc.pixFmtFor('libx264'), 'yuv420p');
    assert.equal(enc.pixFmtFor('h264_nvenc'), 'yuv420p');
    assert.equal(enc.pixFmtFor('h264_amf'), 'yuv420p');
    assert.equal(enc.pixFmtFor('h264_qsv'), 'nv12');
    assert.equal(enc.pixFmtFor('h264_mf'), 'nv12');
  });

  test('10-bit only for codecs and encoders that support it', () => {
    assert.equal(enc.pixFmtFor('libx265', true), 'yuv420p10le');
    assert.equal(enc.pixFmtFor('hevc_qsv', true), 'p010le');
    assert.equal(enc.pixFmtFor('hevc_nvenc', true), 'p010le');
    assert.equal(enc.pixFmtFor('libx264', true), 'yuv420p');
    assert.equal(enc.pixFmtFor('hevc_mf', true), 'nv12');
    assert.equal(enc.supportsTenBit('hevc_mf'), false);
    assert.equal(enc.supportsTenBit('libvpx-vp9'), true);
  });
});

describe('encoderArgs for libx264', () => {
  test('quality mode is CRF with the balanced preset and a 2 second GOP', () => {
    const args = enc.encoderArgs('libx264', video(), { fps: 30000 / 1001 });
    assert.deepEqual(args, ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-g', '60', '-keyint_min', '30']);
  });

  test('speed presets map to veryfast, medium and slow', () => {
    assert.equal(valueOf(enc.encoderArgs('libx264', video({ speed: 'fast' }), { fps: 25 }), '-preset'), 'veryfast');
    assert.equal(valueOf(enc.encoderArgs('libx264', video({ speed: 'quality' }), { fps: 25 }), '-preset'), 'slow');
  });

  test('capped CRF adds maxrate and a default bufsize of twice the cap', () => {
    const args = enc.encoderArgs('libx264', video({ maxrate: 6000 }), { fps: 25 });
    assert.equal(valueOf(args, '-maxrate'), '6000k');
    assert.equal(valueOf(args, '-bufsize'), '12000k');
  });

  test('VBR bitrate mode', () => {
    const args = enc.encoderArgs('libx264', video({ rateControl: 'bitrate', bitrate: 5000, maxrate: 7000, bufsize: 10000 }), { fps: 25 });
    assert.equal(valueOf(args, '-b:v'), '5000k');
    assert.equal(valueOf(args, '-maxrate'), '7000k');
    assert.equal(valueOf(args, '-bufsize'), '10000k');
    assert.equal(args.includes('-crf'), false);
  });

  test('CBR pins maxrate to the bitrate', () => {
    const args = enc.encoderArgs('libx264', video({ rateControl: 'bitrate', bitrateMode: 'cbr', bitrate: 4000 }), { fps: 25 });
    assert.equal(valueOf(args, '-b:v'), '4000k');
    assert.equal(valueOf(args, '-maxrate'), '4000k');
    assert.equal(valueOf(args, '-bufsize'), '8000k');
  });

  test('profile and level', () => {
    const args = enc.encoderArgs('libx264', video({ profile: 'high', level: '4.1' }), { fps: 25 });
    assert.equal(valueOf(args, '-profile:v'), 'high');
    assert.equal(valueOf(args, '-level:v'), '4.1');
  });

  test('custom keyframe interval and a keyint_min capped to half the GOP', () => {
    const args = enc.encoderArgs('libx264', video({ keyframeSeconds: 0.5 }), { fps: 30 });
    assert.equal(valueOf(args, '-g'), '15');
    assert.equal(valueOf(args, '-keyint_min'), '8');
  });

  test('software encoders keep B-frames with VFR input', () => {
    assert.equal(enc.encoderArgs('libx264', video(), { fps: 30, vfr: true }).includes('-bf'), false);
  });
});

describe('encoderArgs for hardware', () => {
  test('NVENC quality uses VBR with cq and zero bitrate', () => {
    const args = enc.encoderArgs('h264_nvenc', video({ quality: 22, speed: 'quality' }), { fps: 25 });
    assert.equal(valueOf(args, '-rc'), 'vbr');
    assert.equal(valueOf(args, '-cq'), '22');
    assert.equal(valueOf(args, '-b:v'), '0');
    assert.equal(valueOf(args, '-preset'), 'p6');
    assert.equal(valueOf(args, '-tune'), 'hq');
  });

  test('NVENC CBR', () => {
    const args = enc.encoderArgs('hevc_nvenc', video({ codec: 'hevc', rateControl: 'bitrate', bitrateMode: 'cbr', bitrate: 6000 }), { fps: 25 });
    assert.equal(valueOf(args, '-rc'), 'cbr');
    assert.equal(valueOf(args, '-maxrate'), '6000k');
  });

  test('Quick Sync quality uses global_quality and a named preset', () => {
    const args = enc.encoderArgs('h264_qsv', video({ speed: 'fast' }), { fps: 25 });
    assert.equal(valueOf(args, '-global_quality'), '20');
    assert.equal(valueOf(args, '-preset'), 'veryfast');
  });

  test('Quick Sync level is sent as an integer', () => {
    const args = enc.encoderArgs('h264_qsv', video({ profile: 'main', level: '4.0' }), { fps: 25 });
    assert.equal(valueOf(args, '-level'), '40');
    assert.equal(valueOf(args, '-profile:v'), 'main');
  });

  test('AMF quality uses constant QP and baseline becomes constrained_baseline', () => {
    const args = enc.encoderArgs('h264_amf', video({ quality: 24, profile: 'baseline' }), { fps: 25 });
    assert.equal(valueOf(args, '-rc'), 'cqp');
    assert.equal(valueOf(args, '-qp_i'), '24');
    assert.equal(valueOf(args, '-qp_b'), '24');
    assert.equal(valueOf(args, '-profile:v'), 'constrained_baseline');
    assert.equal(valueOf(args, '-quality'), 'balanced');
  });

  test('AMF VBR uses peak constrained mode with a default peak', () => {
    const args = enc.encoderArgs('hevc_amf', video({ codec: 'hevc', rateControl: 'bitrate', bitrate: 4000 }), { fps: 25 });
    assert.equal(valueOf(args, '-rc'), 'vbr_peak');
    assert.equal(valueOf(args, '-maxrate'), '6000k');
  });

  test('Media Foundation maps quality to 0-100, forces hardware and asks for High profile', () => {
    const args = enc.encoderArgs('h264_mf', video({ quality: 23 }), { fps: 25 });
    assert.equal(valueOf(args, '-rate_control'), 'quality');
    assert.equal(valueOf(args, '-quality'), '56');
    assert.equal(valueOf(args, '-hw_encoding'), '1');
    assert.equal(valueOf(args, '-profile:v'), '100');
    assert.equal(args.includes('-level'), false);
  });

  test('Media Foundation bitrate modes', () => {
    assert.equal(valueOf(enc.encoderArgs('h264_mf', video({ rateControl: 'bitrate' }), { fps: 25 }), '-rate_control'), 'u_vbr');
    assert.equal(valueOf(enc.encoderArgs('h264_mf', video({ rateControl: 'bitrate', bitrateMode: 'cbr' }), { fps: 25 }), '-rate_control'), 'cbr');
  });

  test('hardware encoders drop B-frames for VFR input', () => {
    for (const name of ['h264_qsv', 'h264_nvenc', 'h264_amf', 'h264_mf']) {
      assert.equal(valueOf(enc.encoderArgs(name, video(), { fps: 30, vfr: true }), '-bf'), '0', name);
      assert.equal(enc.encoderArgs(name, video(), { fps: 30, vfr: false }).includes('-bf'), false, name);
    }
  });
});

describe('encoderArgs for HEVC, AV1 and VP9', () => {
  test('x265 quiets its log and uses main10 for 10-bit', () => {
    const args = enc.encoderArgs('libx265', video({ codec: 'hevc', profile: 'main', level: '4.1' }), { fps: 25, tenBit: true });
    assert.equal(valueOf(args, '-profile:v'), 'main10');
    assert.equal(valueOf(args, '-x265-params'), 'log-level=error:level-idc=4.1');
    assert.equal(valueOf(args, '-preset'), 'fast');
  });

  test('x265 without a level still gets a quiet log', () => {
    assert.equal(valueOf(enc.encoderArgs('libx265', video({ codec: 'hevc' }), { fps: 25 }), '-x265-params'), 'log-level=error');
  });

  test('Quick Sync HEVC 10-bit asks for main10 even on auto', () => {
    assert.equal(valueOf(enc.encoderArgs('hevc_qsv', video({ codec: 'hevc' }), { fps: 25, tenBit: true }), '-profile:v'), 'main10');
  });

  test('Media Foundation HEVC never asks for a profile', () => {
    assert.equal(enc.encoderArgs('hevc_mf', video({ codec: 'hevc', profile: 'main' }), { fps: 25, tenBit: true }).includes('-profile:v'), false);
  });

  test('AOM AV1 scales quality to its 63 step range with zero bitrate', () => {
    const args = enc.encoderArgs('libaom-av1', video({ codec: 'av1', quality: 30 }), { fps: 25 });
    assert.equal(valueOf(args, '-crf'), '37');
    assert.equal(valueOf(args, '-b:v'), '0');
    assert.equal(valueOf(args, '-cpu-used'), '7');
    assert.equal(valueOf(args, '-row-mt'), '1');
  });

  test('VP9 CBR sets min and max rate', () => {
    const args = enc.encoderArgs('libvpx-vp9', video({ codec: 'vp9', rateControl: 'bitrate', bitrateMode: 'cbr', bitrate: 3000 }), { fps: 25 });
    assert.equal(valueOf(args, '-minrate'), '3000k');
    assert.equal(valueOf(args, '-maxrate'), '3000k');
    assert.equal(valueOf(args, '-deadline'), 'good');
  });

  test('NVENC AV1 scales cq to 63 steps', () => {
    assert.equal(valueOf(enc.encoderArgs('av1_nvenc', video({ codec: 'av1', quality: 51 }), { fps: 25 }), '-cq'), '63');
  });

  test('quality is clamped to 1..51 and a missing value means 23', () => {
    assert.equal(valueOf(enc.encoderArgs('libx264', video({ quality: 99 }), { fps: 25 }), '-crf'), '51');
    assert.equal(valueOf(enc.encoderArgs('libx264', video({ quality: -5 }), { fps: 25 }), '-crf'), '1');
    assert.equal(valueOf(enc.encoderArgs('libx264', video({ quality: undefined }), { fps: 25 }), '-crf'), '23');
  });
});

describe('pickEncoder', () => {
  test('auto picks the first working hardware encoder in candidate order', () => {
    assert.equal(enc.pickEncoder('h264', ['h264_mf', 'h264_qsv', 'libx264'], 'auto'), 'h264_qsv');
    assert.equal(enc.pickEncoder('h264', new Set(['h264_nvenc']), 'auto'), 'h264_nvenc');
    assert.equal(enc.pickEncoder('hevc', { hevc_amf: true, hevc_qsv: false }, 'auto'), 'hevc_amf');
  });

  test('falls back to software when nothing was detected', () => {
    assert.equal(enc.pickEncoder('h264', null, 'auto'), 'libx264');
    assert.equal(enc.pickEncoder('av1', [], 'auto'), 'libaom-av1');
    assert.equal(enc.pickEncoder('vp9', ['h264_qsv'], 'auto'), 'libvpx-vp9');
  });

  test('the software preference ignores hardware', () => {
    assert.equal(enc.pickEncoder('h264', ['h264_qsv'], 'software'), 'libx264');
  });

  test('a forced encoder wins when it works', () => {
    assert.equal(enc.pickEncoder('h264', ['h264_qsv', 'h264_mf'], 'auto', 'h264_mf'), 'h264_mf');
    assert.equal(enc.pickEncoder('h264', ['h264_qsv'], 'software', 'h264_qsv'), 'h264_qsv');
    assert.equal(enc.pickEncoder('h264', [], 'auto', 'libx264'), 'libx264');
  });

  test('a forced encoder that failed detection or belongs to another codec falls back', () => {
    assert.equal(enc.pickEncoder('h264', ['h264_qsv'], 'auto', 'h264_nvenc'), 'h264_qsv');
    assert.equal(enc.pickEncoder('h264', ['hevc_qsv'], 'auto', 'hevc_qsv'), 'libx264');
  });

  test('an unknown codec gives null', () => {
    assert.equal(enc.pickEncoder('mpeg2', ['libx264'], 'auto'), null);
  });

  test('Media Foundation cannot write MKV headers, so it is skipped for MKV and WebM only', () => {
    assert.equal(enc.supportsContainer('h264_mf', 'mkv'), false);
    assert.equal(enc.supportsContainer('hevc_mf', 'webm'), false);
    assert.equal(enc.supportsContainer('h264_mf', 'mp4'), true);
    assert.equal(enc.supportsContainer('h264_mf', 'mov'), true);
    assert.equal(enc.supportsContainer('h264_qsv', 'mkv'), true);
    assert.equal(enc.supportsContainer('libx264', 'mkv'), true);
    assert.equal(enc.pickEncoder('h264', ['h264_mf'], 'auto', 'auto', 'mkv'), 'libx264');
    assert.equal(enc.pickEncoder('h264', ['h264_mf', 'h264_qsv'], 'auto', 'h264_mf', 'mkv'), 'h264_qsv');
    assert.equal(enc.pickEncoder('h264', ['h264_mf'], 'auto', 'auto', 'mp4'), 'h264_mf');
    assert.equal(enc.pickEncoder('hevc', ['hevc_mf'], 'auto', 'auto'), 'hevc_mf');
  });

  test('only libx264 does two-pass', () => {
    assert.equal(enc.supportsTwoPass('libx264'), true);
    assert.equal(enc.supportsTwoPass('h264_qsv'), false);
    assert.equal(enc.supportsTwoPass('libx265'), false);
  });
});
