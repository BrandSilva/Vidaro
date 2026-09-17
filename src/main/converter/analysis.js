const { inputUrl, rateValue } = require('./media');

const MIN_DECIDED_FRAMES = 20;
const PROGRESSIVE_MAX_SHARE = 0.1;
const INTERLACED_MIN_SHARE = 0.2;
const MINORITY_MAX_SHARE = 0.2;
const TELECINE_MIN_REPEAT_SHARE = 0.15;
const TELECINE_MAX_REPEAT_SHARE = 0.6;
const TELECINE_MIN_SIDE_SHARE = 0.05;

const LINE_PATTERN = /\[Parsed_idet_\d+ @ ([^\]]+)\]\s*(Repeated Fields|Single frame detection|Multi frame detection):\s*(.*)$/;

function idetArgs(inputPath, media, { frames = 600 } = {}) {
  const video = media && media.video;
  const count = Math.max(30, Math.round(Number(frames) || 600));
  const fps = video && (video.fps || video.avgFps) ? rateValue(video.fps || video.avgFps) : 30;
  const span = count / fps;
  const duration = media && media.durationReliable && media.duration > 0 ? media.duration : 0;
  const start = duration > span ? Math.min(duration * 0.1, duration - span) : 0;
  const args = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info', '-progress', 'pipe:1'];
  if (start > 0) args.push('-ss', String(Number(start.toFixed(3))));
  args.push('-i', inputUrl(inputPath));
  if (video) args.push('-map', `0:${video.index}`);
  args.push('-an', '-sn', '-dn', '-vf', 'idet', '-frames:v', String(count), '-f', 'null', 'NUL');
  return args;
}

function parseCounts(text) {
  const counts = {};
  const pattern = /([A-Za-z]+):\s*(\d+)/g;
  let match;
  while ((match = pattern.exec(text))) counts[match[1].toLowerCase()] = Number(match[2]);
  return counts;
}

function emptyCounts() {
  return {
    repeated: { neither: 0, top: 0, bottom: 0 },
    single: { tff: 0, bff: 0, progressive: 0, undetermined: 0 },
    multi: { tff: 0, bff: 0, progressive: 0, undetermined: 0 }
  };
}

function frameTotal(group) {
  return group.tff + group.bff + group.progressive + group.undetermined;
}

function collect(lines) {
  const instances = new Map();
  const list = Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/);
  for (const line of list) {
    const match = LINE_PATTERN.exec(String(line));
    if (!match) continue;
    const [, id, kind, rest] = match;
    if (!instances.has(id)) instances.set(id, emptyCounts());
    const counts = instances.get(id);
    const values = parseCounts(rest);
    if (kind === 'Repeated Fields') {
      counts.repeated = { neither: values.neither || 0, top: values.top || 0, bottom: values.bottom || 0 };
    } else {
      const key = kind.startsWith('Single') ? 'single' : 'multi';
      counts[key] = { tff: values.tff || 0, bff: values.bff || 0, progressive: values.progressive || 0, undetermined: values.undetermined || 0 };
    }
  }
  let best = null;
  for (const counts of instances.values()) {
    const total = frameTotal(counts.multi) + frameTotal(counts.single);
    if (!best || total > best.total) best = { counts, total };
  }
  return best ? best.counts : null;
}

function fieldVerdict(group) {
  const interlaced = group.tff + group.bff;
  const decided = interlaced + group.progressive;
  if (decided < MIN_DECIDED_FRAMES) return 'unknown';
  const share = interlaced / decided;
  if (share < PROGRESSIVE_MAX_SHARE) return 'progressive';
  if (share < INTERLACED_MIN_SHARE) return 'unknown';
  const dominant = group.tff >= group.bff ? 'tff' : 'bff';
  const minority = Math.min(group.tff, group.bff);
  return minority <= interlaced * MINORITY_MAX_SHARE ? dominant : 'unknown';
}

function telecineOf(counts, verdict) {
  if (verdict !== 'tff' && verdict !== 'bff') return false;
  const { neither, top, bottom } = counts.repeated;
  const total = neither + top + bottom;
  if (total < MIN_DECIDED_FRAMES) return false;
  const share = (top + bottom) / total;
  return share >= TELECINE_MIN_REPEAT_SHARE && share <= TELECINE_MAX_REPEAT_SHARE && top / total >= TELECINE_MIN_SIDE_SHARE && bottom / total >= TELECINE_MIN_SIDE_SHARE;
}

function parseIdet(lines) {
  const counts = collect(lines);
  if (!counts) return { verdict: 'unknown', telecine: false, counts: null, frames: 0 };
  const multi = fieldVerdict(counts.multi);
  const verdict = multi !== 'unknown' ? multi : fieldVerdict(counts.single);
  return {
    verdict,
    telecine: telecineOf(counts, verdict),
    counts,
    frames: Math.max(frameTotal(counts.multi), frameTotal(counts.single))
  };
}

module.exports = { idetArgs, parseIdet };
