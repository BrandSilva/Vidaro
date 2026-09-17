import { useEffect } from 'react';
import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { t } from '../strings/index.js';
import { errorText, removePresetFrom, upsertPreset } from '../components/preset/model.js';

export const presetsStore = createStore({ loaded: false, list: [], schema: null, error: null });
export const encodersStore = createStore({ view: null, detecting: false });
export const draftsStore = createStore({});

let session = null;

function applyList(list) {
  if (!Array.isArray(list)) return;
  presetsStore.set((state) => ({ ...state, list, loaded: true, error: null }));
  const ids = new Set(list.map((preset) => preset.id));
  draftsStore.set((drafts) => {
    const kept = Object.entries(drafts).filter(([id]) => ids.has(id));
    return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
  });
}

function applyEncoders(view) {
  if (view && typeof view === 'object') encodersStore.set((state) => ({ ...state, view }));
}

async function load(current) {
  try {
    const [list, schema] = await Promise.all([api.presets.list(), api.presets.schema()]);
    if (session !== current) return;
    presetsStore.set((state) => ({ ...state, schema, error: null }));
    applyList(list);
  } catch (error) {
    if (session !== current) return;
    presetsStore.set((state) => ({ ...state, loaded: true, error: errorText(error, t.presets.loadFailed) }));
  }
  const view = await api.convert.encoders().catch(() => null);
  if (session === current) applyEncoders(view);
}

export function initPresets() {
  if (!session) {
    const disposers = [api.presets.onChanged(applyList), api.convert.onEncodersChanged(applyEncoders)];
    const current = { ready: null, dispose: null };
    current.dispose = () => {
      disposers.splice(0).forEach((dispose) => dispose());
      if (session === current) session = null;
    };
    session = current;
    current.ready = load(current);
  }
  const active = session;
  return active.ready.then(() => active.dispose);
}

export function reloadPresets() {
  if (!session) return initPresets();
  presetsStore.set((state) => ({ ...state, error: null }));
  const active = session;
  active.ready = load(active);
  return active.ready.then(() => active.dispose);
}

export function useEnsurePresets() {
  useEffect(() => {
    if (!session) initPresets();
  }, []);
}

export function usePresets(selector) {
  return useStore(presetsStore, selector);
}

const selectList = (state) => state.list;
const selectSchema = (state) => state.schema;
const selectEncoderView = (state) => state.view;

export function usePresetList() {
  return useStore(presetsStore, selectList);
}

export function usePresetSchema() {
  return useStore(presetsStore, selectSchema);
}

export function useEncoders() {
  return useStore(encodersStore, selectEncoderView);
}

export function useEncoderDetecting() {
  return useStore(encodersStore, (state) => state.detecting || state.view?.status === 'detecting');
}

export function findPreset(id) {
  return presetsStore.get().list.find((preset) => preset.id === id) || null;
}

export async function detectEncoders() {
  if (encodersStore.get().detecting) return encodersStore.get().view;
  encodersStore.set((state) => ({ ...state, detecting: true }));
  try {
    const view = await api.convert.detectEncoders();
    applyEncoders(view);
    return view;
  } catch {
    return encodersStore.get().view;
  } finally {
    encodersStore.set((state) => ({ ...state, detecting: false }));
  }
}

function remember(preset) {
  presetsStore.set((state) => ({ ...state, list: upsertPreset(state.list, preset) }));
  return preset;
}

export async function savePreset(preset) {
  return remember(await api.presets.save(preset));
}

export async function duplicatePreset(id, name) {
  return remember(await api.presets.duplicate(id, name));
}

export async function renamePreset(id, name) {
  return remember(await api.presets.rename(id, name));
}

export async function removePreset(id) {
  const removed = await api.presets.remove(id);
  presetsStore.set((state) => ({ ...state, list: removePresetFrom(state.list, id) }));
  clearDraft(id);
  return removed;
}

export async function importPresets() {
  const result = await api.presets.importFile();
  const imported = Array.isArray(result?.imported) ? result.imported : [];
  for (const preset of imported) remember(preset);
  return { imported, failed: Array.isArray(result?.failed) ? result.failed : [] };
}

export function exportPreset(id) {
  return api.presets.exportFile(id);
}

export function useDrafts() {
  return useStore(draftsStore);
}

export function setDraft(id, preset) {
  if (!id) return;
  draftsStore.set((drafts) => (drafts[id] === preset ? drafts : { ...drafts, [id]: preset }));
}

export function clearDraft(id) {
  draftsStore.set((drafts) => {
    if (!id || !Object.hasOwn(drafts, id)) return drafts;
    const next = { ...drafts };
    delete next[id];
    return next;
  });
}
