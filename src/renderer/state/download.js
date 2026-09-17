import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { settingsStore, updateSection } from './settings.js';
import { presetsStore } from './presets.js';
import {
  changedKeys,
  cleanName,
  defaultsPatch,
  draftIssues,
  effectiveMode,
  effectiveOptions,
  effectiveQuality,
  fileExtension,
  findPreset,
  normalizeLink,
  parseSection,
  presetWarning,
  remoteMessage,
  sameLink,
  setOverride,
  validProxy
} from '../pages/download/model.js';
import {
  defaultSelection,
  firstSelectable,
  parseRange,
  selectableIndexes,
  selectedEntries,
  selectionFromRange,
  toggleSelection
} from '../pages/download/selection.js';
import { batchNameRequest, entryInfoPayload, nameBasis, nameRequest, requestOptions, videoInfoPayload } from '../pages/download/requests.js';

const EMPTY_SELECTION = new Set();
const NETWORK_KEYS = ['cookiesMode', 'cookiesBrowser', 'cookiesFile', 'proxy'];
const NAME_DELAY = 200;
const OFFERED_LIMIT = 200;

function blankDraft() {
  return {
    url: '',
    linkInvalid: false,
    status: 'idle',
    request: null,
    info: null,
    error: null,
    fileName: '',
    nameEdited: false,
    preview: '',
    basis: '',
    selection: EMPTY_SELECTION,
    anchor: null,
    rangeText: '',
    rangeError: false,
    sectionStart: '',
    sectionEnd: '',
    updating: false,
    updateNote: null,
    enqueueing: false,
    enqueueError: null
  };
}

export const downloadStore = createStore({
  ...blankDraft(),
  overrides: {},
  chip: null,
  clipboardNote: 0,
  added: null,
  savedToken: 0
});

let fetchSeq = 0;
let nameSeq = 0;
let nameTimer = 0;
const offered = new Set();
const selectableCache = new WeakMap();

function selectableCount(entries) {
  if (!Array.isArray(entries)) return 0;
  if (!selectableCache.has(entries)) selectableCache.set(entries, selectableIndexes(entries).length);
  return selectableCache.get(entries);
}

function get() {
  return downloadStore.get();
}

function patch(values) {
  downloadStore.set((state) => ({ ...state, ...values }));
}

function downloadSettings() {
  return settingsStore.get()?.download ?? {};
}

export function useDownload(selector) {
  return useStore(downloadStore, selector);
}

export function computeDraft(state, download, presets = []) {
  const options = effectiveOptions(download, state.overrides);
  const info = state.status === 'ready' ? state.info : null;
  const kind = info?.kind ?? null;
  const mode = effectiveMode(options.mode, info);
  const quality = effectiveQuality(options.quality, info?.heights);
  const view = { ...options, mode, quality };
  const range = kind === 'video' ? parseSection(state.sectionStart, state.sectionEnd, info.duration) : { section: null, error: null };
  const count = kind === 'playlist' ? state.selection.size : kind ? 1 : 0;
  const preset = findPreset(presets, options.afterPreset);
  const presetIssue = presetWarning(preset, mode);
  const selectable = kind === 'playlist' ? selectableCount(info.entries) : 0;
  const issues = kind ? draftIssues(view, { kind, count, selectable, sectionError: range.error, drm: info.drm === true }) : [];
  if (kind && presetIssue) issues.push('preset-video');
  return {
    options: view,
    kind,
    mode,
    quality,
    qualityChanged: kind !== null && quality !== String(options.quality),
    section: range.section,
    sectionError: range.error,
    count,
    preset,
    presetIssue,
    issues,
    extension: fileExtension(view),
    changed: changedKeys(download, state.overrides)
  };
}

function remember(url) {
  offered.add(url);
  if (offered.size > OFFERED_LIMIT) offered.delete(offered.values().next().value);
}

function networkOverrides() {
  const download = downloadSettings();
  const changed = changedKeys(download, get().overrides);
  if (!NETWORK_KEYS.some((key) => changed.includes(key))) return null;
  const options = effectiveOptions(download, get().overrides);
  if (!validProxy(options.proxy)) return null;
  if (options.cookiesMode === 'file' && !options.cookiesFile) return null;
  return {
    cookiesMode: options.cookiesMode,
    cookiesBrowser: options.cookiesBrowser,
    cookiesFile: options.cookiesMode === 'file' ? options.cookiesFile : '',
    proxy: String(options.proxy ?? '').trim()
  };
}

export function setUrl(text) {
  patch({ url: text, linkInvalid: false });
}

export async function fetchLink(text, { playlist = false, keepNote = false } = {}) {
  const url = normalizeLink(text);
  if (!url) {
    const typed = String(text ?? '').trim();
    patch({ url: typed || get().url, linkInvalid: true });
    return false;
  }
  if (get().status === 'fetching') api.download.cancelFetch().catch(() => undefined);
  const seq = ++fetchSeq;
  nameSeq += 1;
  clearTimeout(nameTimer);
  remember(url);
  downloadStore.set((state) => ({
    ...state,
    ...blankDraft(),
    url,
    status: 'fetching',
    request: { url, playlist },
    updateNote: keepNote ? state.updateNote : null,
    chip: sameLink(state.chip, url) ? null : state.chip,
    added: null
  }));
  const options = { playlist };
  const network = networkOverrides();
  if (network) options.network = network;
  let result;
  try {
    result = await api.download.fetchInfo(url, options);
  } catch (error) {
    result = { error: { code: 'unexpected', message: remoteMessage(error), hint: null, action: null } };
  }
  if (seq !== fetchSeq) return false;
  if (!result || result.canceled) {
    patch({ status: 'idle', request: null });
    return false;
  }
  if (result.error || !result.info) {
    patch({ status: 'error', error: result.error ?? { code: 'unexpected', message: null, hint: null, action: null } });
    return false;
  }
  const info = result.info;
  patch({
    status: 'ready',
    info,
    error: null,
    updateNote: null,
    selection: info.kind === 'playlist' ? defaultSelection(info.entries) : EMPTY_SELECTION,
    anchor: null
  });
  refreshNames({ force: true });
  return true;
}

export function openPlaylist() {
  const { info, request } = get();
  const url = request?.url ?? info?.url;
  if (url) fetchLink(url, { playlist: true });
}

export function openEntryList(entry) {
  if (entry?.url) fetchLink(entry.url, { playlist: true });
}

export function cancelFetch() {
  if (get().status !== 'fetching') return;
  fetchSeq += 1;
  api.download.cancelFetch().catch(() => undefined);
  patch({ status: 'idle', request: null });
}

export function retryFetch({ keepNote = false } = {}) {
  const { request, url } = get();
  if (request) return fetchLink(request.url, { playlist: request.playlist, keepNote });
  return fetchLink(url, { keepNote });
}

export async function updateAndRetry() {
  if (get().updating) return;
  const request = get().request;
  patch({ updating: true, updateNote: null });
  let outcome = 'failed';
  try {
    const result = await api.ytdlp.update();
    outcome = result?.outcome ?? 'failed';
  } catch {
    outcome = 'failed';
  }
  const state = get();
  if (state.status !== 'error' || state.request !== request) {
    if (state.updating) patch({ updating: false });
    return;
  }
  if (outcome === 'deferred' || outcome === 'failed') {
    patch({ updating: false, updateNote: outcome });
    return;
  }
  patch({ updating: false, updateNote: outcome === 'current' ? 'current' : null });
  retryFetch({ keepNote: true });
}

export function resetDraft() {
  fetchSeq += 1;
  nameSeq += 1;
  clearTimeout(nameTimer);
  if (get().status === 'fetching') api.download.cancelFetch().catch(() => undefined);
  downloadStore.set((state) => ({ ...state, ...blankDraft() }));
}

export function refreshNames({ force = false } = {}) {
  const state = get();
  const info = state.info;
  if (!info || state.status !== 'ready') return;
  const options = effectiveOptions(downloadSettings(), state.overrides);
  const basis = nameBasis(info, options);
  if (!force && basis === state.basis) return;
  clearTimeout(nameTimer);
  const seq = ++nameSeq;
  const run = async () => {
    let name = '';
    try {
      if (info.kind === 'playlist') {
        const entry = firstSelectable(info.entries);
        name = entry ? await api.download.suggestName(nameRequest(info, options, { entry })) : '';
      } else {
        name = await api.download.suggestName(nameRequest(info, options));
      }
    } catch {
      name = '';
    }
    if (seq !== nameSeq || get().info !== info) return;
    downloadStore.set((current) => ({
      ...current,
      preview: typeof name === 'string' ? name : '',
      fileName: info.kind === 'video' ? (typeof name === 'string' ? name : '') : '',
      nameEdited: false
    }));
  };
  patch({ basis });
  if (!force && options.nameTemplate === 'custom') nameTimer = setTimeout(run, NAME_DELAY);
  else run();
}

export function setFileName(text) {
  patch({ fileName: text, nameEdited: true });
}

export function restoreFileName() {
  patch({ fileName: get().preview, nameEdited: false });
}

export function setOption(key, value) {
  downloadStore.set((state) => ({
    ...state,
    overrides: setOverride(state.overrides, downloadSettings(), key, value),
    enqueueError: null
  }));
}

export function setOptions(values) {
  downloadStore.set((state) => {
    let overrides = state.overrides;
    for (const [key, value] of Object.entries(values)) overrides = setOverride(overrides, downloadSettings(), key, value);
    return { ...state, overrides, enqueueError: null };
  });
}

export function resetOptions() {
  patch({ overrides: {}, enqueueError: null });
}

export async function saveDefaults() {
  const state = get();
  const options = effectiveOptions(downloadSettings(), state.overrides);
  const values = defaultsPatch(options);
  const kept = {};
  for (const [key, value] of Object.entries(state.overrides)) {
    if (!Object.hasOwn(values, key)) kept[key] = value;
  }
  const previous = state.overrides;
  const pending = updateSection('download', values);
  patch({ overrides: kept, savedToken: Date.now() });
  try {
    await pending;
    return true;
  } catch {
    downloadStore.set((current) => ({ ...current, overrides: { ...previous, ...current.overrides }, savedToken: 0 }));
    return false;
  }
}

export function setFolder(folder) {
  if (typeof folder === 'string' && folder) updateSection('download', { folder });
}

export async function pickCookiesFile() {
  let file = null;
  try {
    file = await api.dialogs.pickCookiesFile();
  } catch {
    file = null;
  }
  if (file) setOptions({ cookiesMode: 'file', cookiesFile: file });
}

export function toggleEntry(index, { shift = false } = {}) {
  downloadStore.set((state) => {
    if (!state.info || state.info.kind !== 'playlist') return state;
    const selection = toggleSelection(state.selection, state.info.entries, index, { anchor: state.anchor, shift });
    return { ...state, selection, anchor: shift && state.anchor !== null ? state.anchor : index, enqueueError: null };
  });
}

export function selectAllEntries(on) {
  downloadStore.set((state) => {
    if (!state.info || state.info.kind !== 'playlist') return state;
    const selection = on ? new Set(selectableIndexes(state.info.entries)) : new Set();
    return { ...state, selection, anchor: null, enqueueError: null };
  });
}

export function setRangeText(text) {
  patch({ rangeText: text, rangeError: false });
}

export function applyRange() {
  downloadStore.set((state) => {
    if (!state.info || state.info.kind !== 'playlist') return state;
    const entries = state.info.entries;
    const maxIndex = entries.length ? entries[entries.length - 1].index : 0;
    const parsed = parseRange(state.rangeText, maxIndex);
    if (parsed.error) return { ...state, rangeError: true };
    if (!parsed.indexes) return state;
    return { ...state, selection: selectionFromRange(entries, parsed.indexes), anchor: null, rangeError: false, enqueueError: null };
  });
}

export function setSectionText(part, text) {
  patch(part === 'end' ? { sectionEnd: text, enqueueError: null } : { sectionStart: text, enqueueError: null });
}

export async function offerClipboard(enabled) {
  if (!enabled) return;
  let url = null;
  try {
    url = await api.clipboard.readUrl();
  } catch {
    url = null;
  }
  if (!url) return;
  const state = get();
  const known = offered.has(url) || sameLink(url, state.url) || sameLink(url, state.request?.url);
  remember(url);
  if (!known) patch({ chip: url });
}

export function dismissChip() {
  patch({ chip: null });
}

export function acceptChip() {
  const url = get().chip;
  patch({ chip: null });
  if (url) fetchLink(url);
}

export async function pasteFromClipboard() {
  let url = null;
  try {
    url = await api.clipboard.readUrl();
  } catch {
    url = null;
  }
  if (!url) {
    patch({ clipboardNote: Date.now() });
    return false;
  }
  return fetchLink(url);
}

export function clearClipboardNote() {
  patch({ clipboardNote: 0 });
}

export function dismissAdded() {
  patch({ added: null });
}

async function buildItems(state, draft) {
  const info = state.info;
  if (draft.kind === 'playlist') {
    const entries = selectedEntries(info.entries, state.selection);
    const names = await api.download.suggestName(batchNameRequest(info, draft.options, entries));
    return {
      items: entries.map((entry, i) => ({
        url: entry.url,
        info: entryInfoPayload(info, entry),
        name: (Array.isArray(names) && names[i]) || entry.title || ''
      })),
      group: { title: info.playlistTitle || info.title || '' }
    };
  }
  const pageUrl = state.request?.url ?? info.url;
  const name = cleanName(state.fileName, draft.extension) || state.preview;
  return { items: [{ url: info.url || pageUrl, info: videoInfoPayload(info, pageUrl), name }], group: null };
}

export async function enqueueDraft({ start = true } = {}) {
  const state = get();
  if (state.status !== 'ready' || !state.info || state.enqueueing) return false;
  const download = downloadSettings();
  const draft = computeDraft(state, download, presetsStore.get().list);
  if (draft.issues.length > 0) {
    patch({ enqueueError: { issue: draft.issues[0] } });
    return false;
  }
  const info = state.info;
  patch({ enqueueing: start ? 'start' : 'queue', enqueueError: null });
  try {
    const { items, group } = await buildItems(state, draft);
    const request = {
      items,
      options: requestOptions(draft.options, draft),
      output: { folder: download.folder, collision: download.collision },
      after: draft.preset ? { presetId: draft.preset.id, keepOriginal: draft.options.keepOriginalAfterConvert !== false } : null,
      group,
      start
    };
    const result = await api.download.enqueue(request);
    const count = Array.isArray(result?.ids) ? result.ids.length : items.length;
    if (get().info === info) {
      nameSeq += 1;
      clearTimeout(nameTimer);
    }
    downloadStore.set((current) => ({
      ...current,
      ...(current.info === info ? blankDraft() : { enqueueing: false }),
      added: { token: Date.now(), count, started: start }
    }));
    return true;
  } catch (error) {
    downloadStore.set((current) => ({
      ...current,
      enqueueing: false,
      enqueueError: current.info === info ? { message: remoteMessage(error) } : null
    }));
    return false;
  }
}
