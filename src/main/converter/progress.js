function numberOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text === 'N/A' || text.toLowerCase() === 'nan') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseClock(value) {
  const match = /^(-)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(value || '').trim());
  if (!match) return null;
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  return match[1] ? -seconds : seconds;
}

function parseSpeed(value) {
  const match = /^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)x\s*$/i.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

function parseBitrate(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*kbits\/s\s*$/i.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

function outTimeOf(fields) {
  const micros = numberOrNull(fields.out_time_us);
  if (micros !== null) return micros / 1e6;
  const legacy = numberOrNull(fields.out_time_ms);
  if (legacy !== null) return legacy / 1e6;
  return parseClock(fields.out_time);
}

function createProgressParser() {
  let fields = {};
  let lastOutTime = null;

  function snapshot(state) {
    const raw = outTimeOf(fields);
    const outTimeSec = raw === null ? null : Math.max(0, raw);
    if (outTimeSec !== null) lastOutTime = Math.max(lastOutTime || 0, outTimeSec);
    const result = {
      outTimeSec,
      frame: numberOrNull(fields.frame),
      fps: numberOrNull(fields.fps),
      speed: parseSpeed(fields.speed),
      totalSize: numberOrNull(fields.total_size),
      bitrateKbps: parseBitrate(fields.bitrate),
      dupFrames: numberOrNull(fields.dup_frames),
      dropFrames: numberOrNull(fields.drop_frames),
      done: state === 'end'
    };
    fields = {};
    return result;
  }

  return {
    push(line) {
      const text = String(line || '').trim();
      const equals = text.indexOf('=');
      if (equals <= 0) return null;
      const key = text.slice(0, equals).trim();
      const value = text.slice(equals + 1).trim();
      if (key === 'progress') return snapshot(value);
      if (/^[a-z_0-9]+$/.test(key)) fields[key] = value;
      return null;
    },
    lastOutTime: () => lastOutTime,
    reset() {
      fields = {};
      lastOutTime = null;
    }
  };
}

function percentOf(outTimeSec, total) {
  if (!(total > 0) || outTimeSec === null || outTimeSec === undefined) return null;
  return Math.max(0, Math.min(100, (outTimeSec / total) * 100));
}

function etaOf(outTimeSec, total, speed) {
  if (!(total > 0) || !(speed > 0) || outTimeSec === null || outTimeSec === undefined) return null;
  return Math.max(0, (total - outTimeSec) / speed);
}

module.exports = { createProgressParser, percentOf, etaOf, parseClock };
