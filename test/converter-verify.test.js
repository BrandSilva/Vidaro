const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { checkOutput, outputDuration } = require('../src/main/converter/verify');

function output({ duration = 10, video = true, audio = true, fps = { num: 25, den: 1 }, size = 1000 } = {}) {
  return {
    size,
    duration,
    video: video ? { fps, avgFps: fps, duration } : null,
    audio: audio ? [{ duration }] : []
  };
}

describe('checkOutput', () => {
  test('a matching output passes', () => {
    const result = checkOutput(output(), { expectedDuration: 10, expectVideo: true, expectAudio: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.duration, 10);
    assert.equal(result.difference, 0);
  });

  test('a missing or empty output is no-output', () => {
    assert.deepEqual(checkOutput(null, { expectedDuration: 10 }).problems, ['no-output']);
    assert.deepEqual(checkOutput(output({ size: 0 }), { expectedDuration: 10 }).problems, ['no-output']);
    assert.ok(checkOutput(output({ video: false, audio: false }), {}).problems.includes('no-output'));
  });

  test('an unknown size is not mistaken for an empty file', () => {
    assert.equal(checkOutput(output({ size: null }), { expectedDuration: 10 }).ok, true);
    assert.equal(checkOutput(output({ size: undefined }), { expectedDuration: 10 }).ok, true);
    assert.deepEqual(checkOutput(output({ size: '0' }), { expectedDuration: 10 }).problems, ['no-output']);
  });

  test('NaN and N/A style values never pass as a match', () => {
    const result = checkOutput(output({ duration: Number.NaN }), { expectedDuration: 10, expectVideo: true });
    assert.deepEqual(result.problems, ['duration-mismatch']);
    assert.equal(checkOutput(output(), { expectedDuration: Number.NaN, encodedDuration: Number.NaN }).ok, true);
  });

  test('missing streams are reported', () => {
    assert.deepEqual(checkOutput(output({ video: false }), { expectedDuration: 10, expectVideo: true, expectAudio: true }).problems, ['no-video']);
    assert.deepEqual(checkOutput(output({ audio: false }), { expectedDuration: 10, expectVideo: true, expectAudio: true }).problems, ['no-audio']);
  });

  test('tolerance is 0.1 s plus one output frame', () => {
    assert.equal(checkOutput(output({ duration: 10.139 }), { expectedDuration: 10 }).ok, true);
    assert.equal(checkOutput(output({ duration: 9.861 }), { expectedDuration: 10 }).ok, true);
    assert.deepEqual(checkOutput(output({ duration: 10.15 }), { expectedDuration: 10 }).problems, ['duration-mismatch']);
    assert.deepEqual(checkOutput(output({ duration: 9.85 }), { expectedDuration: 10 }).problems, ['duration-mismatch']);
  });

  test('a low frame rate widens the tolerance by its frame length', () => {
    assert.equal(checkOutput(output({ duration: 10.25, fps: { num: 5, den: 1 } }), { expectedDuration: 10 }).ok, true);
  });

  test('audio-only outputs allow one codec frame', () => {
    assert.equal(checkOutput(output({ video: false, duration: 10.14 }), { expectedDuration: 10, expectAudio: true }).ok, true);
    assert.equal(checkOutput(output({ video: false, duration: 10.16 }), { expectedDuration: 10, expectAudio: true }).ok, false);
  });

  test('a much shorter output from a reliable source fails', () => {
    const result = checkOutput(output({ duration: 7 }), { expectedDuration: 10, sourceDurationReliable: true, encodedDuration: 7 });
    assert.deepEqual(result.problems, ['duration-mismatch']);
    assert.equal(result.difference, -3);
  });

  test('copy trims may be longer by the allowed slack but never shorter', () => {
    assert.equal(checkOutput(output({ duration: 14 }), { expectedDuration: 10, durationSlack: 10 }).ok, true);
    assert.equal(checkOutput(output({ duration: 21 }), { expectedDuration: 10, durationSlack: 10 }).ok, false);
    assert.equal(checkOutput(output({ duration: 9 }), { expectedDuration: 10, durationSlack: 10 }).ok, false);
  });

  test('an unreliable source is checked against the encoded duration and warns when the estimate was off', () => {
    const result = checkOutput(output({ duration: 7.5 }), { expectedDuration: 20, sourceDurationReliable: false, encodedDuration: 7.46 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, ['source-duration-unreliable']);
    assert.ok(Math.abs(result.difference - 0.04) < 1e-9);
  });

  test('an unreliable source still fails when the file does not match what ffmpeg encoded', () => {
    const result = checkOutput(output({ duration: 5 }), { expectedDuration: 20, sourceDurationReliable: false, encodedDuration: 7.5 });
    assert.deepEqual(result.problems, ['duration-mismatch']);
  });

  test('an unreliable source that matched its estimate gives no warning', () => {
    const result = checkOutput(output({ duration: 10.02 }), { expectedDuration: 10, sourceDurationReliable: false, encodedDuration: 9.96 });
    assert.deepEqual(result, { ok: true, problems: [], warnings: [], duration: 10.02, difference: result.difference });
  });

  test('the encoded time may trail the file by two frames', () => {
    assert.equal(checkOutput(output({ duration: 1, fps: { num: 24, den: 1 } }), { expectedDuration: 1, sourceDurationReliable: false, encodedDuration: 0.916667 }).ok, true);
  });

  test('an unreliable source without an encoded time only warns', () => {
    const result = checkOutput(output({ duration: 7 }), { expectedDuration: 10, sourceDurationReliable: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, ['source-duration-unreliable']);
  });

  test('an output with no readable duration fails when one was expected', () => {
    const broken = { size: 10, duration: null, video: { fps: null, duration: null }, audio: [] };
    assert.deepEqual(checkOutput(broken, { expectedDuration: 10, expectVideo: true }).problems, ['duration-mismatch']);
    assert.equal(checkOutput(broken, { expectVideo: true }).ok, true);
  });

  test('no expectations only checks that something was written', () => {
    assert.equal(checkOutput(output(), {}).ok, true);
    assert.equal(checkOutput(output()).ok, true);
  });
});

describe('outputDuration', () => {
  test('prefers the container duration and falls back to the longest stream', () => {
    assert.equal(outputDuration(output({ duration: 4 })), 4);
    assert.equal(outputDuration({ duration: null, video: { duration: 3 }, audio: [{ duration: 3.2 }] }), 3.2);
    assert.equal(outputDuration({ duration: null, video: null, audio: [] }), null);
    assert.equal(outputDuration(null), null);
  });
});
