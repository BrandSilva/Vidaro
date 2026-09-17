import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { baseName } from '../lib/format.js';
import { t } from '../strings/index.js';
import { settingsStore, updateSection } from './settings.js';
import { presetsStore, savePreset } from './presets.js';
import { deepEqual, errorText, mergeSettings, sameSettings, settingsOf, stripView } from '../components/preset/model.js';
import { MAX_FILES, enqueueOutcome, mergePaths } from '../pages/convert/model.js';

const PROBE_LIMIT = 3;
const THUMB_LIMIT = 2;
const PERSIST_MS = 600;
const FALLBACK_PRESET = 'mp4-universal';

export const convertStore = createStore({
  files: [],
  presetId: null,
  base: null,
  working: null,
  modified: false,
  adding: 0,
  notice: null
});

let nextId = 1;
let probing = 0;
let thumbing = 0;
let persistTimer = 0;
const probeQueue = [];
const thumbQueue = [];

export function useConvert(selector) {
  return useStore(convertStore, selector);
}

function findFile(id) {
  return convertStore.get().files.find((file) => file.id === id) || null;
}

function patchFile(id, patch) {
  convertStore.set((state) => {
    const index = state.files.findIndex((file) => file.id === id);
    if (index < 0) return state;
    const current = state.files[index];
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    if (next === current) return state;
    const files = state.files.slice();
    files[index] = next;
    return { ...state, files };
  });
}

function newEntry({ path, key }) {
  const id = `f${nextId}`;
  nextId += 1;
  return {
    id,
    key,
    path,
    name: baseName(path),
    status: 'probing',
    media: null,
    error: null,
    thumbnail: null,
    thumbState: 'idle',
    trim: null,
    analysis: null,
    rejection: null
  };
}

function probeFailure(error) {
  return { message: (error && error.message) || t.convert.readFailed, hint: (error && error.hint) || null };
}

function probeOne(id, filePath) {
  return api.convert.probe([filePath]).then(
    (results) => {
      const result = Array.isArray(results) ? results[0] : null;
      if (result && result.media) patchFile(id, { status: 'ready', media: result.media, error: null });
      else patchFile(id, { status: 'error', error: probeFailure(result && result.error) });
    },
    (error) => patchFile(id, { status: 'error', error: { message: errorText(error, t.convert.readFailed), hint: null } })
  );
}

function pumpProbes() {
  while (probing < PROBE_LIMIT && probeQueue.length > 0) {
    const id = probeQueue.shift();
    const file = findFile(id);
    if (!file || file.status !== 'probing') continue;
    probing += 1;
    probeOne(id, file.path).finally(() => {
      probing -= 1;
      pumpProbes();
    });
  }
}

function loadThumbnail(id, filePath) {
  return api.convert.thumbnail(filePath).then(
    (url) => patchFile(id, { thumbnail: typeof url === 'string' && url.startsWith('data:image/') ? url : null, thumbState: 'done' }),
    () => patchFile(id, { thumbState: 'done' })
  );
}

function pumpThumbnails() {
  while (thumbing < THUMB_LIMIT && thumbQueue.length > 0) {
    const id = thumbQueue.pop();
    const file = findFile(id);
    if (!file || file.thumbState !== 'queued') continue;
    thumbing += 1;
    patchFile(id, { thumbState: 'loading' });
    loadThumbnail(id, file.path).finally(() => {
      thumbing -= 1;
      pumpThumbnails();
    });
  }
}

export function requestThumbnail(id) {
  const file = findFile(id);
  if (!file || file.status !== 'ready' || file.thumbState !== 'idle') return;
  patchFile(id, { thumbState: 'queued' });
  thumbQueue.push(id);
  pumpThumbnails();
}

function addNotice(expanded, result, added) {
  const c = t.convert;
  if (expanded.length === 0) return { tone: 'warning', text: c.noMediaFound };
  if (result.overflow > 0) return { tone: 'warning', text: c.tooMany(MAX_FILES) };
  if (result.duplicates > 0 && added === 0) return { tone: 'info', text: c.alreadyAdded(result.duplicates) };
  return null;
}

export async function addPaths(paths) {
  const input = (Array.isArray(paths) ? paths : []).filter((item) => typeof item === 'string' && item);
  if (input.length === 0) return 0;
  convertStore.set((state) => ({ ...state, adding: state.adding + 1, notice: null }));
  let expanded = [];
  try {
    const value = await api.files.expandInputs(input);
    expanded = Array.isArray(value) ? value : [];
  } catch {
    expanded = [];
  } finally {
    convertStore.set((state) => ({ ...state, adding: Math.max(0, state.adding - 1) }));
  }
  const result = mergePaths(
    convertStore.get().files.map((file) => file.key),
    expanded,
    MAX_FILES
  );
  const entries = result.accepted.map(newEntry);
  const notice = addNotice(expanded, result, entries.length);
  convertStore.set((state) => ({ ...state, files: entries.length ? [...state.files, ...entries] : state.files, notice }));
  for (const entry of entries) probeQueue.push(entry.id);
  pumpProbes();
  return entries.length;
}

export function removeFiles(ids) {
  const targets = new Set(ids);
  for (const file of convertStore.get().files) {
    if (targets.has(file.id) && file.analysis && file.analysis.status === 'running') {
      api.convert.cancelAnalyze(file.path).catch(() => false);
    }
  }
  convertStore.set((state) => {
    const files = state.files.filter((file) => !targets.has(file.id));
    return files.length === state.files.length ? state : { ...state, files };
  });
}

export function clearFiles() {
  removeFiles(convertStore.get().files.map((file) => file.id));
  probeQueue.length = 0;
  thumbQueue.length = 0;
}

export function setTrim(id, trim) {
  patchFile(id, { trim: trim || null, rejection: null });
}

export async function analyzeFile(id) {
  const file = findFile(id);
  if (!file || file.status !== 'ready' || (file.analysis && file.analysis.status === 'running')) return;
  patchFile(id, { analysis: { status: 'running', result: null, error: null } });
  try {
    const result = await api.convert.analyze(file.path);
    patchFile(id, (current) => {
      if (!current.analysis || current.analysis.status !== 'running') return current;
      return { ...current, analysis: result ? { status: 'done', result, error: null } : null };
    });
  } catch (error) {
    patchFile(id, (current) => ({ ...current, analysis: { status: 'error', result: null, error: errorText(error, t.convert.analyzeFailed) } }));
  }
}

export function cancelAnalysis(id) {
  const file = findFile(id);
  if (!file || !file.analysis || file.analysis.status !== 'running') return;
  api.convert.cancelAnalyze(file.path).catch(() => false);
  patchFile(id, { analysis: null });
}

export function dismissNotice(expected) {
  convertStore.set((state) => {
    if (!state.notice || (expected && state.notice !== expected)) return state;
    return { ...state, notice: null };
  });
}

export function showNotice(notice) {
  convertStore.set((state) => ({ ...state, notice }));
}

function convertSettings() {
  const settings = settingsStore.get();
  return (settings && settings.convert) || {};
}

function persistNow() {
  persistTimer = 0;
  const { presetId, working, modified } = convertStore.get();
  if (!working) return;
  const value = { id: presetId, preset: modified ? settingsOf(working) : null };
  if (deepEqual(convertSettings().lastPreset, value)) return;
  updateSection('convert', { lastPreset: value }).catch(() => null);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_MS);
}

export function flushConvertDraft() {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistNow();
}

function withoutRejections(files) {
  return files.some((file) => file.rejection) ? files.map((file) => (file.rejection ? { ...file, rejection: null } : file)) : files;
}

function choose(base, working, presetId) {
  convertStore.set((state) => ({
    ...state,
    presetId,
    base,
    working,
    modified: base ? !sameSettings(working, base) : true,
    files: withoutRejections(state.files)
  }));
}

function initialSelection(list, schema) {
  const settings = convertSettings();
  const byId = (id) => (typeof id === 'string' ? list.find((preset) => preset.id === id) || null : null);
  const fallback = byId(settings.defaultPreset) || byId(FALLBACK_PRESET) || list[0];
  const last = settings.lastPreset;
  if (last && typeof last === 'object') {
    const remembered = byId(last.id);
    if (remembered) return { base: remembered, working: mergeSettings(remembered, last.preset, schema), presetId: remembered.id };
    if (last.id === null && last.preset && fallback) {
      const working = { ...mergeSettings(fallback, last.preset, schema), id: null, name: t.presets.missing };
      return { base: null, working, presetId: null };
    }
  }
  return fallback ? { base: fallback, working: stripView(fallback), presetId: fallback.id } : null;
}

export function syncSelection() {
  const { list, schema } = presetsStore.get();
  if (!schema || list.length === 0) return;
  const state = convertStore.get();
  if (state.working) {
    if (state.presetId === null) return;
    const base = list.find((preset) => preset.id === state.presetId) || null;
    if (base === state.base) return;
    if (base) {
      const working = state.modified ? { ...state.working, name: base.name } : stripView(base);
      convertStore.set((current) => ({ ...current, base, working, modified: !sameSettings(working, base) }));
      return;
    }
    if (state.modified) {
      convertStore.set((current) => ({ ...current, base: null, presetId: null, working: { ...current.working, id: null, name: t.presets.missing } }));
      schedulePersist();
      return;
    }
  }
  const selection = initialSelection(list, schema);
  if (selection) convertStore.set((current) => ({ ...current, ...selection, modified: selection.base ? !sameSettings(selection.working, selection.base) : true }));
}

export function selectPreset(id) {
  const base = presetsStore.get().list.find((preset) => preset.id === id);
  if (!base) return;
  choose(base, stripView(base), base.id);
  schedulePersist();
}

export function updateWorking(next) {
  const state = convertStore.get();
  if (!next || next === state.working) return;
  choose(state.base, next, state.presetId);
  schedulePersist();
}

export function resetWorking() {
  const { base } = convertStore.get();
  if (!base) return;
  choose(base, stripView(base), base.id);
  schedulePersist();
}

export async function saveWorkingAs(name) {
  const { working } = convertStore.get();
  if (!working) return null;
  const saved = await savePreset({ ...settingsOf(working), name, description: '' });
  choose(saved, stripView(saved), saved.id);
  schedulePersist();
  return saved;
}

export function updateOutput(values) {
  return updateSection('convert', values);
}

function outputRequest(settings) {
  const mode = settings.outputMode === 'source' ? 'source' : 'folder';
  return {
    mode,
    folder: mode === 'folder' ? settings.folder : null,
    nameTemplate: settings.nameTemplate,
    collision: settings.collision,
    keepDate: settings.keepDate === true
  };
}

export async function enqueueFiles(start) {
  const state = convertStore.get();
  const sent = state.files.filter((file) => file.status === 'ready');
  if (sent.length === 0 || !state.working) return null;
  const request = {
    files: sent.map((file) => ({ path: file.path, trim: file.trim })),
    preset: { ...settingsOf(state.working), id: state.presetId, name: state.working.name || t.presets.missing },
    output: outputRequest(convertSettings()),
    start: start === true
  };
  const result = await api.convert.enqueue(request);
  const ids = Array.isArray(result && result.ids) ? result.ids : [];
  const outcome = enqueueOutcome(sent, result && result.errors);
  const done = new Set(ids.length > 0 ? outcome.done : []);
  const rejected = new Map(outcome.rejected.map((item) => [item.id, item.error]));
  convertStore.set((current) => ({
    ...current,
    files: current.files.filter((file) => !done.has(file.id)).map((file) => (rejected.has(file.id) ? { ...file, rejection: rejected.get(file.id) } : file))
  }));
  const firstError = outcome.rejected[0] ? outcome.rejected[0].error : outcome.orphanErrors[0] || null;
  return { added: ids.length, rejected: outcome.rejected.length, firstError, started: start === true };
}
