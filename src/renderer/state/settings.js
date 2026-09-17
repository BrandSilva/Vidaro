import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';

export const settingsStore = createStore(null);

let inflight = 0;
let latest = null;
let unsubscribe = null;

function applyPatch(current, patch) {
  if (!current) return current;
  const next = { ...current };
  for (const [section, values] of Object.entries(patch)) {
    next[section] = section === 'shortcuts' ? { ...values } : { ...current[section], ...values };
  }
  return next;
}

function receive(data) {
  latest = data;
  if (inflight === 0) settingsStore.set(data);
}

export async function loadSettings() {
  unsubscribe?.();
  unsubscribe = api.settings.onChanged(receive);
  settingsStore.set(await api.settings.get());
}

export async function updateSettings(patch) {
  settingsStore.set((current) => applyPatch(current, patch));
  inflight += 1;
  try {
    latest = await api.settings.update(patch);
  } finally {
    inflight -= 1;
    if (inflight === 0 && latest) settingsStore.set(latest);
  }
  return latest;
}

export function updateSection(section, values) {
  return updateSettings({ [section]: values });
}

export async function resetSettings(keys) {
  inflight += 1;
  try {
    latest = await api.settings.reset(keys);
  } finally {
    inflight -= 1;
    if (inflight === 0 && latest) settingsStore.set(latest);
  }
  return latest;
}

export function useSettings(selector) {
  return useStore(settingsStore, selector);
}
