const HEIGHT_LADDER = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'mhtml', 'bmp']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'opus', 'oga', 'flac', 'wav', 'wma', 'mka', 'weba', 'alac', 'aiff', 'ac3']);
const MAX_ENTRIES = 10000;
const MAX_TEXT = 1024;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function imageUrl(value) {
  const url = webUrl(value);
  return url && url.startsWith('https:') ? url : null;
}

function dateText(value) {
  return typeof value === 'string' && /^\d{8}$/.test(value) ? value : null;
}

function heightClass(width, height) {
  const h = positive(height);
  if (!h) return null;
  const w = positive(width);
  const short = w ? Math.min(w, h) : h;
  return HEIGHT_LADDER.find((step) => step >= short * 0.95) ?? HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
}

function isMediaFormat(format) {
  if (!isObject(format)) return false;
  if (format.format_note === 'storyboard' || format.protocol === 'mhtml') return false;
  if (typeof format.ext === 'string' && IMAGE_EXTS.has(format.ext.toLowerCase())) return false;
  return format.has_drm !== true;
}

function hasVideoStream(format) {
  if (!isMediaFormat(format) || format.vcodec === 'none') return false;
  if (typeof format.vcodec === 'string') return true;
  if (positive(format.height)) return true;
  if (typeof format.ext === 'string' && AUDIO_EXTS.has(format.ext.toLowerCase())) return false;
  return typeof format.video_ext === 'string' ? format.video_ext !== 'none' : format.acodec === undefined || format.acodec === null;
}

function hasAudioStream(format) {
  return isMediaFormat(format) && format.acodec !== 'none';
}

function formatSize(format) {
  return positive(format?.filesize) ?? positive(format?.filesize_approx);
}

function availableHeights(formats) {
  if (!Array.isArray(formats)) return [];
  const heights = new Set();
  for (const format of formats) {
    if (!hasVideoStream(format)) continue;
    const step = heightClass(format.width, format.height);
    if (step) heights.add(step);
  }
  return [...heights].sort((a, b) => b - a);
}

function isH264(format) {
  return typeof format.vcodec === 'string' && /^(avc|h264)/i.test(format.vcodec);
}

function sizeEstimates(formats) {
  if (!Array.isArray(formats)) return [];
  const audioOnly = formats.filter((format) => hasAudioStream(format) && format.vcodec === 'none' && formatSize(format));
  const aac = audioOnly.filter((format) => typeof format.acodec === 'string' && /^mp4a|^aac/i.test(format.acodec));
  const audioPool = aac.length > 0 ? aac : audioOnly;
  const audioBytes = audioPool.reduce((best, format) => Math.max(best, formatSize(format)), 0);
  const byHeight = new Map();
  for (const format of formats) {
    if (!hasVideoStream(format) || !formatSize(format)) continue;
    const step = heightClass(format.width, format.height);
    if (!step) continue;
    const bytes = formatSize(format) + (format.acodec === 'none' ? audioBytes : 0);
    const current = byHeight.get(step);
    const preferred = isH264(format);
    if (!current || (preferred && !current.preferred) || (preferred === current.preferred && bytes > current.bytes)) {
      byHeight.set(step, { bytes, preferred });
    }
  }
  return [...byHeight.entries()].sort((a, b) => b[0] - a[0]).map(([height, { bytes }]) => ({ height, bytes: Math.round(bytes) }));
}

function requestedSize(json) {
  const requested = Array.isArray(json.requested_formats)
    ? json.requested_formats
    : Array.isArray(json.requested_downloads?.[0]?.requested_formats)
      ? json.requested_downloads[0].requested_formats
      : null;
  if (requested && requested.length > 0) {
    const sizes = requested.map(formatSize);
    return sizes.every(Boolean) ? Math.round(sizes.reduce((sum, size) => sum + size, 0)) : null;
  }
  const own = formatSize(json) ?? formatSize(json.requested_downloads?.[0]);
  return own ? Math.round(own) : null;
}

function pickThumbnail(item, { small = false } = {}) {
  const direct = imageUrl(item.thumbnail);
  const list = Array.isArray(item.thumbnails)
    ? item.thumbnails.filter((thumb) => isObject(thumb) && imageUrl(thumb.url))
    : [];
  if (!small && direct) return direct;
  if (list.length === 0) return direct;
  if (small) {
    const sized = list.filter((thumb) => positive(thumb.width)).sort((a, b) => a.width - b.width);
    const fit = sized.find((thumb) => thumb.width >= 160);
    return imageUrl((fit ?? sized[sized.length - 1] ?? list[0]).url);
  }
  const ranked = [...list].sort(
    (a, b) => (a.preference ?? 0) - (b.preference ?? 0) || (positive(a.width) ?? 0) - (positive(b.width) ?? 0)
  );
  return imageUrl(ranked[ranked.length - 1].url);
}

function isPlaylistLike(entry, url) {
  if (entry._type === 'playlist' || entry.ie_key === 'YoutubeTab') return true;
  if (!url) return false;
  const parsed = new URL(url);
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return false;
  return parsed.pathname === '/playlist' || (parsed.searchParams.has('list') && !parsed.searchParams.has('v'));
}

function entryUrl(entry) {
  for (const candidate of [entry.url, entry.webpage_url, entry.original_url]) {
    const url = webUrl(candidate);
    if (url) return url;
  }
  const id = text(entry.id);
  if (id && entry.ie_key === 'Youtube' && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  return null;
}

function flatten(entries, depth = 0, out = []) {
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) break;
    if (!isObject(entry)) continue;
    if (depth === 0 && Array.isArray(entry.entries)) flatten(entry.entries, depth + 1, out);
    else out.push(entry);
  }
  return out;
}

function summarizeEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of flatten(entries)) {
    const url = entryUrl(entry);
    if (!url) continue;
    const key = text(entry.id) ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = isPlaylistLike(entry, url) ? 'playlist' : 'video';
    result.push({
      kind,
      id: text(entry.id),
      url,
      title: text(entry.title) ?? text(entry.id) ?? url,
      duration: positive(entry.duration),
      index: result.length + 1,
      thumbnail: pickThumbnail(entry, { small: true }),
      channel: kind === 'playlist' ? null : text(entry.channel) ?? text(entry.uploader),
      liveStatus: text(entry.live_status),
      availability: text(entry.availability)
    });
  }
  return result;
}

function subtitleLanguages(value) {
  if (!isObject(value)) return [];
  return Object.keys(value)
    .filter((lang) => lang !== 'live_chat' && /^[\w.-]{1,32}$/.test(lang))
    .slice(0, 200);
}

function summarizeInfo(json, url) {
  if (!isObject(json)) throw new TypeError('No media information was returned');
  const isPlaylist = json._type === 'playlist' || json._type === 'multi_video';
  const formats = Array.isArray(json.formats) ? json.formats : null;
  const entries = isPlaylist && Array.isArray(json.entries) ? summarizeEntries(json.entries) : [];
  const nested = isPlaylist && Array.isArray(json.entries) && json.entries.some((entry) => isObject(entry) && Array.isArray(entry.entries));
  const id = text(json.id) ?? text(json.display_id);
  const title = text(json.title) ?? text(json.fulltitle) ?? id;
  const liveStatus = text(json.live_status);
  const drm = json._has_drm === true || (formats !== null && formats.length > 0 && formats.every((format) => isObject(format) && format.has_drm === true));
  return {
    kind: isPlaylist ? 'playlist' : 'video',
    id,
    url: webUrl(url) ?? webUrl(json.original_url) ?? webUrl(json.webpage_url),
    webpageUrl: webUrl(json.webpage_url) ?? webUrl(json.original_url) ?? webUrl(url),
    title,
    channel: text(json.channel) ?? text(json.uploader) ?? text(json.playlist_uploader) ?? text(json.creator),
    uploadDate: dateText(json.upload_date) ?? dateText(json.release_date),
    duration: positive(json.duration),
    thumbnail: pickThumbnail(json),
    extractor: text(json.extractor) ?? text(json.extractor_key),
    site: text(json.webpage_url_domain),
    isLive: json.is_live === true || liveStatus === 'is_live',
    liveStatus,
    availability: text(json.availability),
    ageLimit: positive(json.age_limit) ?? 0,
    drm,
    heights: availableHeights(formats),
    sizes: sizeEstimates(formats),
    hasVideo: formats === null ? null : formats.some(hasVideoStream),
    hasAudio: formats === null ? null : formats.some(hasAudioStream),
    filesizeApprox: isPlaylist ? null : requestedSize(json),
    subtitles: subtitleLanguages(json.subtitles),
    autoSubtitles: subtitleLanguages(json.automatic_captions).length > 0,
    chapters: Array.isArray(json.chapters) ? json.chapters.length : 0,
    playlistTitle: isPlaylist ? title : text(json.playlist_title) ?? text(json.playlist),
    playlistCount: isPlaylist ? (nested ? entries.length : positive(json.playlist_count) ?? entries.length) : positive(json.playlist_count),
    playlistIndex: positive(json.playlist_index),
    entries
  };
}

function parseInfoOutput(stdout) {
  if (typeof stdout !== 'string') return null;
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === 'null') return null;
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function urlKind(url) {
  const link = webUrl(url);
  if (!link) return 'invalid';
  const parsed = new URL(link);
  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return 'unknown';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const hasList = parsed.searchParams.has('list');
  const hasVideo = parsed.searchParams.has('v');
  if (host === 'youtu.be') {
    if (!segments[0]) return 'unknown';
    return hasList ? 'mixed' : 'video';
  }
  if (segments[0] === 'playlist') return hasList ? 'playlist' : 'unknown';
  if (segments[0] === 'watch') {
    if (!hasVideo) return hasList ? 'playlist' : 'unknown';
    return hasList ? 'mixed' : 'video';
  }
  if (['shorts', 'live', 'embed', 'v'].includes(segments[0])) return 'video';
  if (segments[0]?.startsWith('@') || ['channel', 'c', 'user'].includes(segments[0])) return 'channel';
  return 'unknown';
}

module.exports = {
  summarizeInfo,
  availableHeights,
  sizeEstimates,
  heightClass,
  parseInfoOutput,
  urlKind,
  HEIGHT_LADDER
};
