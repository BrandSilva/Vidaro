import { api } from '../../lib/api.js';
import { createStore } from '../../lib/store.js';
import { baseName } from '../../lib/format.js';
import { queueActions } from '../../state/queue.js';
import { updateSection } from '../../state/settings.js';
import { t } from '../../strings/index.js';
import { revealTarget } from './model.js';

export const ytdlpUpdateStore = createStore({ busy: false, note: null });

function settle(promise, fallback) {
  return Promise.resolve(promise).then(
    (value) => value,
    () => fallback
  );
}

function forgetUpdateNote(ids) {
  const { busy, note } = ytdlpUpdateStore.get();
  if (!note || !ids.some((id) => note.ids.has(id))) return;
  const rest = new Set([...note.ids].filter((id) => !ids.includes(id)));
  ytdlpUpdateStore.set({ busy, note: rest.size ? { kind: note.kind, ids: rest } : null });
}

export function runQueueAction(name, ids) {
  if (!ids || ids.length === 0) return Promise.resolve(null);
  if (name === 'retry') forgetUpdateNote(ids);
  const action = queueActions[name];
  return action ? settle(action(ids), null) : Promise.resolve(null);
}

export function reorderJobs(ids, beforeId) {
  return settle(queueActions.reorder(ids, beforeId), false);
}

export function clearFinished() {
  return settle(queueActions.clearFinished(), []);
}

export function startAll() {
  return settle(queueActions.startAll(), []);
}

export function pauseAll() {
  return settle(queueActions.pauseAll(), []);
}

export async function openJobFile(job) {
  const target = job?.result?.path;
  if (!target) return null;
  const ok = await settle(api.files.openPath(target), false);
  return ok ? null : t.queue.fileMissing(baseName(target));
}

export async function revealJob(job) {
  const target = job ? revealTarget(job) : null;
  if (!target) return null;
  const ok = target.file
    ? await settle(api.files.showInFolder(target.file), false)
    : await settle(api.files.openFolder(target.folder), false);
  return ok ? null : t.queue.folderMissing;
}

export function copyText(text) {
  if (!text) return Promise.resolve(false);
  return settle(
    Promise.resolve(api.clipboard.writeText(text)).then(() => true),
    false
  );
}

function updateOutcome(result) {
  if (!result || typeof result !== 'object') return 'failed';
  if (result.outcome === 'deferred') return 'deferred';
  if (result.outcome === 'current' || result.outcome === 'updated') return 'done';
  return 'failed';
}

export async function updateYtdlpAndRetry(ids) {
  if (ytdlpUpdateStore.get().busy || !ids.length) return;
  ytdlpUpdateStore.set({ busy: true, note: null });
  const outcome = await settle(Promise.resolve(api.ytdlp.update()).then(updateOutcome), 'failed');
  ytdlpUpdateStore.set({ busy: false, note: outcome === 'done' ? null : { kind: outcome, ids: new Set(ids) } });
  if (outcome === 'done') await runQueueAction('retry', ids);
}

export async function retryWithSoftware(ids) {
  if (!ids.length) return;
  await settle(updateSection('convert', { hardware: 'software' }), null);
  await runQueueAction('retry', ids);
}
