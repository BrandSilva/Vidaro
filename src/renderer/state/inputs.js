const listeners = new Set();
const pending = [];

export function emitInputs(payload) {
  if (!payload || (!payload.files?.length && !payload.urls?.length)) return;
  const kinds = payload.files?.length ? 'files' : 'urls';
  const handled = [...listeners].some((listener) => listener.kind === kinds && listener.fn(payload) !== false);
  if (!handled) pending.push(payload);
}

export function onInputs(kind, fn) {
  const listener = { kind, fn };
  listeners.add(listener);
  const matching = pending.filter((payload) => (payload.files?.length ? 'files' : 'urls') === kind);
  for (const payload of matching) pending.splice(pending.indexOf(payload), 1);
  if (matching.length) queueMicrotask(() => matching.forEach((payload) => fn(payload)));
  return () => listeners.delete(listener);
}
