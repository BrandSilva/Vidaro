import { useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? next(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function useStore(store, selector = identity) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

function identity(value) {
  return value;
}
