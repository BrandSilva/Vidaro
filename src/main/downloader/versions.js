const VERSION = /(?:\b(stable|nightly|master)@)?(?<!\d)(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d{1,6}))?(?!\d)/;
const CHANNELS = ['stable', 'nightly', 'master'];

function parseVersion(input) {
  if (input && typeof input === 'object' && Number.isInteger(input.year)) return input;
  if (typeof input !== 'string') return null;
  const match = VERSION.exec(input.trim());
  if (!match) return null;
  const [, channel, year, month, day, build] = match;
  const parsed = { year: Number(year), month: Number(month), day: Number(day), build: build ? Number(build) : 0 };
  if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > 31) return null;
  const text = `${year}.${month}.${day}${build ? `.${build}` : ''}`;
  return { ...parsed, channel: channel ?? (build && build.length === 6 ? 'nightly' : null), text };
}

function compareYtDlpVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ['year', 'month', 'day', 'build']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

function isNewer(candidate, current) {
  return compareYtDlpVersions(candidate, current) > 0;
}

function lineVersion(lines, prefix) {
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? parseVersion(line.slice(prefix.length)) : null;
}

function parseUpdateOutput(output, { exitCode = null } = {}) {
  const lines = (Array.isArray(output) ? output : String(output ?? '').split(/\r?\n/))
    .filter((line) => typeof line === 'string')
    .map((line) => line.trim())
    .filter(Boolean);
  const latest = lineVersion(lines, 'Latest version:');
  const current = lineVersion(lines, 'Current version:');
  const updatedLine = lines.find((line) => line.startsWith('Updated yt-dlp to '));
  const upToDateLine = lines.find((line) => /^yt-dlp is up to date \(/.test(line));
  const errorLine = [...lines].reverse().find((line) => line.startsWith('ERROR:'));
  if (updatedLine) {
    return { status: 'updated', version: parseVersion(updatedLine.slice('Updated yt-dlp to '.length)), previous: current, latest, message: null };
  }
  if (upToDateLine && !errorLine) {
    return { status: 'current', version: parseVersion(upToDateLine), previous: null, latest, message: null };
  }
  const message = errorLine ? errorLine.replace(/^ERROR:\s*/, '').replace(/\s*\(\(.*$|\s*\(caused by.*$/, '').replace(/;\s*Please try again later.*$/i, '') : null;
  return {
    status: 'failed',
    version: current,
    previous: null,
    latest,
    message: message || (exitCode === 0 ? null : 'The update could not be completed.')
  };
}

module.exports = { parseVersion, compareYtDlpVersions, isNewer, parseUpdateOutput, CHANNELS };
