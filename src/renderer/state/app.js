import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { updateSettings, settingsStore } from './settings.js';

export const PAGES = ['download', 'convert', 'queue', 'presets', 'settings'];

export const appStore = createStore({
  page: 'download',
  info: null,
  notices: [],
  closeRequest: null,
  update: null,
  ytdlp: null
});

const pageListeners = new Set();

export function useApp(selector) {
  return useStore(appStore, selector);
}

export function navigate(page) {
  if (!PAGES.includes(page)) return;
  appStore.set((state) => (state.page === page ? state : { ...state, page }));
  const current = settingsStore.get();
  if (current && current.ui.lastPage !== page) updateSettings({ ui: { lastPage: page } });
  for (const listener of pageListeners) listener(page);
}

export function onNavigate(listener) {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
}

function upsertNotice(notice) {
  appStore.set((state) => {
    const rest = state.notices.filter((item) => item.id !== notice.id);
    return { ...state, notices: notice.removed ? rest : [...rest, notice] };
  });
}

export function dismissNotice(id) {
  appStore.set((state) => ({ ...state, notices: state.notices.filter((item) => item.id !== id) }));
  api.app.dismissNotice(id);
}

export function setCloseRequest(request) {
  appStore.set((state) => ({ ...state, closeRequest: request }));
}

export async function initApp() {
  const disposers = [
    api.app.onNotice(upsertNotice),
    api.app.onCloseRequested((request) => setCloseRequest(request)),
    api.app.onNavigate((page) => navigate(page)),
    api.updates.onStatus((update) => appStore.set((state) => ({ ...state, update }))),
    api.ytdlp.onStatus((ytdlp) => appStore.set((state) => ({ ...state, ytdlp })))
  ];
  const [info, notices] = await Promise.all([api.app.info(), api.app.notices()]);
  const page = settingsStore.get()?.ui.lastPage;
  appStore.set((state) => ({ ...state, info, notices, page: PAGES.includes(page) ? page : state.page }));
  return () => disposers.forEach((dispose) => dispose());
}
