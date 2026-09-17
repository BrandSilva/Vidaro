const { rateValue } = require('./media');

const BASE_TOLERANCE = 0.1;
const AUDIO_FRAME_TOLERANCE = 0.05;
const SHORT_SHARE = 0.02;

function frameSeconds(output) {
  const video = output && output.video;
  const rate = video && (video.avgFps || video.fps);
  const value = rateValue(rate);
  return value > 0 ? 1 / value : AUDIO_FRAME_TOLERANCE;
}

function outputDuration(output) {
  if (!output) return null;
  if (output.duration > 0) return output.duration;
  const durations = [output.video, ...(output.audio || [])].filter(Boolean).map((stream) => stream.duration || 0);
  const longest = durations.length ? Math.max(...durations) : 0;
  return longest > 0 ? longest : null;
}

function checkOutput(output, expectations = {}) {
  const {
    expectedDuration = null,
    expectVideo = false,
    expectAudio = false,
    sourceDurationReliable = true,
    encodedDuration = null,
    durationSlack = 0
  } = expectations;
  const problems = [];
  const warnings = [];
  const size = output && output.size !== null && output.size !== undefined ? Number(output.size) : Number.NaN;
  if (!output || (Number.isFinite(size) && size <= 0)) {
    return { ok: false, problems: ['no-output'], warnings, duration: null, difference: null };
  }
  const hasVideo = Boolean(output.video);
  const hasAudio = Array.isArray(output.audio) && output.audio.length > 0;
  if (!hasVideo && !hasAudio) problems.push('no-output');
  if (expectVideo && !hasVideo) problems.push('no-video');
  if (expectAudio && !hasAudio) problems.push('no-audio');
  const duration = outputDuration(output);
  const tolerance = BASE_TOLERANCE + frameSeconds(output);
  const encoded = encodedDuration > 0 ? encodedDuration : null;
  let difference = null;
  if (duration === null) {
    if (expectedDuration > 0 || encoded) problems.push('duration-mismatch');
  } else if (sourceDurationReliable !== false && expectedDuration > 0) {
    difference = duration - expectedDuration;
    const tooShort = difference < -tolerance;
    const tooLong = difference > tolerance + Math.max(0, Number(durationSlack) || 0);
    if (tooShort || tooLong) problems.push('duration-mismatch');
  } else if (encoded) {
    difference = duration - encoded;
    if (Math.abs(difference) > tolerance + frameSeconds(output)) problems.push('duration-mismatch');
    if (expectedDuration > 0 && Math.abs(encoded - expectedDuration) > Math.max(tolerance, expectedDuration * SHORT_SHARE)) {
      warnings.push('source-duration-unreliable');
    }
  } else if (expectedDuration > 0) {
    difference = duration - expectedDuration;
    if (Math.abs(difference) > tolerance) warnings.push('source-duration-unreliable');
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)], warnings, duration, difference };
}

module.exports = { checkOutput, outputDuration };
