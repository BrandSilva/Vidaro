import { DOWNLOAD_OPTION_KEYS, MAX_TEMPLATE, TEMPLATES, compactLangs, parseRateLimit } from './model.js';

export function videoInfoPayload(info, url) {
  return {
    id: info.id ?? null,
    title: info.title ?? null,
    channel: info.channel ?? null,
    uploadDate: info.uploadDate ?? null,
    duration: info.duration ?? null,
    thumbnail: info.thumbnail ?? null,
    extractor: info.extractor ?? null,
    webpageUrl: info.webpageUrl ?? url ?? null,
    playlistIndex: info.playlistIndex ?? null,
    playlistTitle: info.playlistTitle ?? null,
    playlistCount: info.playlistCount ?? null
  };
}

export function entryInfoPayload(playlist, entry) {
  return {
    id: entry.id ?? null,
    title: entry.title ?? null,
    channel: entry.channel ?? playlist.channel ?? null,
    duration: entry.duration ?? null,
    thumbnail: entry.thumbnail ?? null,
    extractor: playlist.extractor ?? null,
    webpageUrl: entry.url,
    playlistIndex: entry.index,
    playlistTitle: playlist.playlistTitle ?? playlist.title ?? null,
    playlistCount: playlistCount(playlist)
  };
}

export function playlistCount(playlist) {
  const listed = Array.isArray(playlist?.entries) ? playlist.entries.length : 0;
  return Number.isInteger(playlist?.playlistCount) && playlist.playlistCount >= listed ? playlist.playlistCount : listed;
}

export function nameRequest(info, options, { entry = null } = {}) {
  const template = TEMPLATES.includes(options.nameTemplate) ? options.nameTemplate : 'title';
  const custom = template === 'custom' ? String(options.customTemplate ?? '').slice(0, MAX_TEMPLATE) : null;
  if (!entry) return { info: videoInfoPayload(info), template, custom };
  const numbered = options.numberPlaylist !== false;
  return {
    info: entryInfoPayload(info, entry),
    template,
    custom,
    index: numbered ? entry.index : null,
    count: playlistCount(info)
  };
}

export function batchNameRequest(info, options, entries) {
  const template = TEMPLATES.includes(options.nameTemplate) ? options.nameTemplate : 'title';
  return {
    template,
    custom: template === 'custom' ? String(options.customTemplate ?? '').slice(0, MAX_TEMPLATE) : null,
    numbered: options.numberPlaylist !== false,
    count: playlistCount(info),
    items: entries.map((entry) => ({ info: entryInfoPayload(info, entry), index: entry.index }))
  };
}

export function nameBasis(info, options) {
  if (!info) return '';
  const template = TEMPLATES.includes(options.nameTemplate) ? options.nameTemplate : 'title';
  const custom = template === 'custom' ? String(options.customTemplate ?? '') : '';
  const numbered = info.kind === 'playlist' ? options.numberPlaylist !== false : false;
  return JSON.stringify([info.kind, info.id, info.url, template, custom, numbered]);
}

export function requestOptions(options, { mode, quality, section }) {
  const result = {};
  for (const key of DOWNLOAD_OPTION_KEYS) result[key] = options[key];
  result.mode = mode;
  result.quality = quality;
  result.rateLimit = parseRateLimit(options.rateLimit).value;
  result.proxy = String(options.proxy ?? '').trim();
  result.subtitleLangs = compactLangs(options.subtitleLangs);
  result.cookiesFile = options.cookiesMode === 'file' ? options.cookiesFile || '' : '';
  result.section = section ?? null;
  return result;
}
