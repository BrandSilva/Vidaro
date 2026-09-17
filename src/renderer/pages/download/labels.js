import { t } from '../../strings/index.js';
import { formatBytes, formatClock, formatDuration } from '../../lib/format.js';
import { compatibleApplies, isLossless, parseRateLimit } from './model.js';

const d = t.download;

export function qualityLabel(quality) {
  if (!quality || quality === 'best') return d.options.best;
  return quality === '2160' ? d.options.fourK : d.options.height(quality);
}

function shortClock(seconds) {
  const text = formatClock(seconds);
  return text.startsWith('00:') ? text.slice(3) : text;
}

export function formatParts(options) {
  if (options.mode === 'audio') {
    const parts = [d.options.audioFormats[options.audioFormat] ?? String(options.audioFormat).toUpperCase()];
    if (!isLossless(options.audioFormat)) {
      parts.push(options.audioQuality === 'best' ? d.footer.best : d.footer.kbps(options.audioQuality));
    }
    return parts;
  }
  const parts = [d.options.containers[options.container] ?? String(options.container).toUpperCase()];
  parts.push(options.quality === 'best' ? d.footer.best : options.quality === '2160' ? d.footer.fourK : d.footer.height(options.quality));
  if (compatibleApplies(options) && options.compatible !== false) parts.push(d.footer.compatible);
  if (options.mode === 'video') parts.push(d.footer.videoOnly);
  return parts;
}

export function summaryText(options, { kind, count, estimate, section, preset }) {
  const parts = [];
  if (kind === 'playlist') parts.push(d.footer.videos(count));
  parts.push(...formatParts(options));
  if (kind === 'video' && section) {
    parts.push(d.footer.range(shortClock(section.start), section.end === null ? '' : shortClock(section.end)));
  }
  if (Number.isFinite(estimate) && estimate > 0) parts.push(d.footer.size(formatBytes(estimate)));
  if (preset) parts.push(d.footer.then(preset.name));
  return parts.join(' · ');
}

export function moreSummary(options, { hasSection }) {
  const parts = [];
  const a = d.more.active;
  if (options.subtitles) parts.push(a.subtitles);
  if (!options.embedThumbnail && !options.embedMetadata && !options.embedChapters) parts.push(a.noEmbeds);
  if (options.sponsorBlock) parts.push(a.sponsorBlock);
  if (hasSection) parts.push(a.range);
  const rate = parseRateLimit(options.rateLimit);
  if (rate.valid && rate.value) parts.push(a.speed(rate.value));
  if (options.concurrentFragments !== 4 && Number.isInteger(options.concurrentFragments)) parts.push(a.fragments(options.concurrentFragments));
  if (options.cookiesMode && options.cookiesMode !== 'none') parts.push(a.cookies);
  if (String(options.proxy ?? '').trim()) parts.push(a.proxy);
  return parts.length ? parts.join(' · ') : d.more.defaults;
}

export function errorView(error) {
  if (!error) return { message: '', hint: null };
  const entry = t.errors[error.code];
  const known = entry && typeof entry.message === 'string' ? entry.variants?.[error.message] || entry : null;
  return {
    message: known?.message || error.message || t.errors.unexpected.message,
    hint: known?.hint ?? error.hint ?? null
  };
}

export function durationText(stats) {
  if (!stats || stats.seconds <= 0) return '';
  const text = formatDuration(stats.seconds);
  return stats.unknown > 0 ? d.playlist.moreDuration(text) : text;
}

export function fileNameFor(name, extension) {
  return name ? `${name}.${extension}` : '';
}
