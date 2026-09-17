import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApp } from '../../state/app.js';
import { resetSettings, updateSection, updateSettings } from '../../state/settings.js';
import { mergeDefaults, mergeYtdlpStatus, splitKey } from './model.js';

export const SettingsContext = createContext(null);

export function useSettingsContext() {
  return useContext(SettingsContext);
}

export function useDefaults() {
  const [defaults, setDefaults] = useState(() => mergeDefaults(null));
  useEffect(() => {
    if (typeof api.settings.defaults !== 'function') return undefined;
    let alive = true;
    Promise.resolve(api.settings.defaults()).then(
      (remote) => {
        if (alive) setDefaults(mergeDefaults(remote));
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, []);
  return defaults;
}

export function useSettingsActions() {
  const [tokens, setTokens] = useState({});
  const [failed, setFailed] = useState(null);
  const counter = useRef(0);

  const mark = useCallback((keys) => {
    counter.current += 1;
    const token = counter.current;
    setTokens((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = token;
      return next;
    });
    setFailed((current) => (current && keys.includes(current) ? null : current));
  }, []);

  const save = useCallback(
    (key, value) => {
      const { section, field } = splitKey(key);
      return updateSection(section, { [field]: value }).then(
        () => mark([key]),
        () => setFailed(key)
      );
    },
    [mark]
  );

  const saveMany = useCallback(
    (values) => {
      const patch = {};
      for (const [key, value] of Object.entries(values)) {
        const { section, field } = splitKey(key);
        patch[section] = { ...patch[section], [field]: value };
      }
      const keys = Object.keys(values);
      return updateSettings(patch).then(
        () => mark(keys),
        () => setFailed(keys[0])
      );
    },
    [mark]
  );

  const reset = useCallback(
    (keys) =>
      resetSettings(keys).then(
        () => mark(keys),
        () => setFailed(keys[0])
      ),
    [mark]
  );

  const saveShortcuts = useCallback(
    (overrides, key) =>
      updateSettings({ shortcuts: overrides }).then(
        () => mark([key]),
        () => setFailed(key)
      ),
    [mark]
  );

  return useMemo(() => ({ tokens, failed, mark, save, saveMany, reset, saveShortcuts }), [tokens, failed, mark, save, saveMany, reset, saveShortcuts]);
}

export function usePresetList() {
  const [presets, setPresets] = useState(null);
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.presets.onChanged((list) => {
      if (alive && Array.isArray(list)) setPresets(list);
    });
    api.presets.list().then(
      (list) => {
        if (alive && Array.isArray(list)) setPresets((current) => current ?? list);
      },
      () => {
        if (alive) setPresets((current) => current ?? []);
      }
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return presets;
}

export function useUpdateStatus() {
  const live = useApp((state) => state.update);
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    let alive = true;
    api.updates.status().then(
      (status) => {
        if (alive) setInitial(status);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, []);
  return live || initial;
}

const UNKNOWN_YTDLP = Object.freeze({ version: null, channel: null, lastCheck: null, jsRuntime: null, checking: false, updating: false });

export function useYtdlpStatus() {
  const live = useApp((state) => state.ytdlp);
  const [status, setStatus] = useState(live);
  const alive = useRef(true);

  const inspect = useCallback(() => {
    api.ytdlp.status().then(
      (inspected) => {
        if (alive.current && inspected) setStatus((previous) => mergeYtdlpStatus(previous, inspected));
      },
      () => {
        if (alive.current) setStatus((previous) => previous ?? UNKNOWN_YTDLP);
      }
    );
  }, []);

  useEffect(() => {
    if (live) setStatus((previous) => mergeYtdlpStatus(previous, live));
  }, [live]);

  useEffect(() => {
    alive.current = true;
    inspect();
    return () => {
      alive.current = false;
    };
  }, [inspect]);

  return { status, setStatus, inspect };
}

const UNKNOWN_ENCODERS = Object.freeze({ status: 'unknown', available: {}, encoders: {}, broken: [] });

export function useEncoders() {
  const [view, setView] = useState(null);
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.convert.onEncodersChanged((next) => {
      if (alive && next) setView(next);
    });
    api.convert.encoders().then(
      (next) => {
        if (alive && next) setView((current) => current ?? next);
      },
      () => {
        if (alive) setView((current) => current ?? UNKNOWN_ENCODERS);
      }
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return [view, setView];
}

export function useDiagnosticsInfo() {
  const [state, setState] = useState({ diag: null, loaded: typeof api.app.diagnostics !== 'function' });
  useEffect(() => {
    if (typeof api.app.diagnostics !== 'function') return undefined;
    let alive = true;
    api.app.diagnostics().then(
      (value) => {
        if (alive) setState({ diag: value && typeof value === 'object' ? value : null, loaded: true });
      },
      () => {
        if (alive) setState({ diag: null, loaded: true });
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function useNarrow(ref, limit) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const inner = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setNarrow(inner < limit);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, limit]);
  return narrow;
}

export function useScrollSpy(rootRef, ids) {
  const [active, setActive] = useState(ids[0]);
  const nodes = useRef(new Map());
  const callbacks = useRef(new Map());
  const visible = useRef(new Set());
  const lock = useRef(false);
  const jumpRef = useRef(null);

  const register = useCallback((id) => {
    let callback = callbacks.current.get(id);
    if (!callback) {
      callback = (node) => {
        if (node) nodes.current.set(id, node);
        else nodes.current.delete(id);
      };
      callbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const seen = visible.current;
    let frame = 0;
    let fallback = 0;
    const atBottom = () => root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    const pick = () => {
      if (lock.current) return;
      if (atBottom()) {
        setActive(ids[ids.length - 1]);
        return;
      }
      const first = ids.find((id) => seen.has(id));
      if (first) setActive(first);
    };
    const unlock = () => {
      clearTimeout(fallback);
      lock.current = false;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.section;
          if (entry.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        pick();
      },
      { root, rootMargin: '-20% 0px -79% 0px', threshold: 0 }
    );
    for (const id of ids) {
      const node = nodes.current.get(id);
      if (node) observer.observe(node);
    }
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', unlock);
    jumpRef.current = (id) => {
      const node = nodes.current.get(id);
      if (!node) return;
      setActive(id);
      const top = node.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 4;
      const target = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
      if (Math.abs(target - root.scrollTop) < 1) return;
      lock.current = true;
      clearTimeout(fallback);
      fallback = setTimeout(unlock, 1500);
      root.scrollTo({ top: target, behavior: 'smooth' });
    };
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', unlock);
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      seen.clear();
      lock.current = false;
      jumpRef.current = null;
    };
  }, [rootRef, ids]);

  const jump = useCallback((id) => jumpRef.current?.(id), []);

  return { active, register, jump };
}