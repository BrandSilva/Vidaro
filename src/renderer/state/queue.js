import { createStore, useStore } from '../lib/store.js';
import { api } from '../lib/api.js';

export const queueStore = createStore({ jobs: [], progress: {}, loaded: false });

const ACTIVE = new Set(['running', 'queued']);
const FINISHED = new Set(['done', 'failed', 'canceled']);

export function isActive(job) {
  return ACTIVE.has(job.state);
}

export function isFinished(job) {
  return FINISHED.has(job.state);
}

function applyList(jobs) {
  queueStore.set((state) => {
    const ids = new Set(jobs.map((job) => job.id));
    const progress = {};
    for (const [id, value] of Object.entries(state.progress)) if (ids.has(id)) progress[id] = value;
    return { jobs, progress, loaded: true };
  });
}

function applyProgress(batch) {
  queueStore.set((state) => ({ ...state, progress: { ...state.progress, ...batch } }));
}

export async function initQueue() {
  const disposers = [api.queue.onChanged(applyList), api.queue.onProgress(applyProgress)];
  applyList(await api.queue.list());
  return () => disposers.forEach((dispose) => dispose());
}

export function useQueue(selector) {
  return useStore(queueStore, selector);
}

export function jobProgress(state, job) {
  return state.progress[job.id] || job.progress || null;
}

export function summarize(jobs) {
  let downloading = 0;
  let converting = 0;
  let waiting = 0;
  for (const job of jobs) {
    if (job.state === 'running') {
      if (job.kind === 'download') downloading += 1;
      else converting += 1;
    } else if (job.state === 'queued') {
      waiting += 1;
    }
  }
  return { downloading, converting, waiting, active: downloading + converting + waiting };
}

export const queueActions = {
  pause: (ids) => api.queue.pause(ids),
  resume: (ids) => api.queue.resume(ids),
  cancel: (ids) => api.queue.cancel(ids),
  retry: (ids) => api.queue.retry(ids),
  remove: (ids) => api.queue.remove(ids),
  reorder: (ids, beforeId) => api.queue.reorder(ids, beforeId),
  clearFinished: () => api.queue.clearFinished(),
  startAll: () => api.queue.startAll(),
  pauseAll: () => api.queue.pauseAll()
};
