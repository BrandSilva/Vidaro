const UI_LOCALE = 'en-US';
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fixed = unit === 0 ? 0 : value >= 100 ? 0 : digits;
  return `${value.toFixed(fixed)} ${BYTE_UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatClock(seconds, withFraction = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sec = withFraction ? s.toFixed(3).padStart(6, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
}

export function parseClock(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const [, h = '0', m, s] = match;
  const minutes = Number(m);
  const secs = Number(s);
  if (minutes >= 60 || secs >= 60) return null;
  return Number(h) * 3600 + minutes * 60 + secs;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.floor(Math.min(100, Math.max(0, value)))}%`;
}

export function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString(UI_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatUploadDate(yyyymmdd) {
  if (typeof yyyymmdd !== 'string' || !/^\d{8}$/.test(yyyymmdd)) return '';
  const date = new Date(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)));
  return date.toLocaleDateString(UI_LOCALE, { dateStyle: 'medium' });
}

export function baseName(filePath) {
  if (typeof filePath !== 'string') return '';
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function dirName(filePath) {
  if (typeof filePath !== 'string') return '';
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return index > 0 ? filePath.slice(0, index) : filePath;
}

export function stripExtension(fileName) {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

export function driveOf(filePath) {
  const match = /^([a-zA-Z]:)/.exec(filePath || '');
  if (match) return match[1].toUpperCase();
  const unc = /^\\\\[^\\]+\\[^\\]+/.exec(filePath || '');
  return unc ? unc[0] : '';
}
