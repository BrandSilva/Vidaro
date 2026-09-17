import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../strings/index.js';
import { errorText } from '../../components/preset/model.js';
import { PREVIEW_LIMIT, planSignature } from './model.js';

const DEBOUNCE_MS = 160;
const BATCH = 6;
const EMPTY = Object.freeze({});

function failedPlan(error) {
  return { lines: [], estimateBytes: null, errors: [{ code: 'describe-failed', message: errorText(error, t.convert.notConvertible) }], warnings: [], encoder: null };
}

function describeOne(preset, file) {
  return api.convert.describe(preset, file.media, { trim: file.trim }).then(
    (plan) => plan || failedPlan(null),
    (error) => failedPlan(error)
  );
}

export function usePlanPreview(files, preset, encoders, hardware) {
  const [plans, setPlans] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const filesRef = useRef(files);
  filesRef.current = files;
  const signature = useMemo(() => planSignature(files), [files]);

  useEffect(() => {
    const sample = filesRef.current.filter((file) => file.status === 'ready').slice(0, PREVIEW_LIMIT);
    if (!preset || sample.length === 0) {
      setPlans(EMPTY);
      setPending(false);
      return undefined;
    }
    let alive = true;
    setPending(true);
    const timer = setTimeout(async () => {
      const next = {};
      for (let index = 0; index < sample.length; index += BATCH) {
        const batch = sample.slice(index, index + BATCH);
        const results = await Promise.all(batch.map((file) => describeOne(preset, file)));
        if (!alive) return;
        batch.forEach((file, position) => {
          next[file.id] = results[position];
        });
        if (index === 0) setPlans((current) => ({ ...current, ...next }));
      }
      if (!alive) return;
      setPlans(next);
      setPending(false);
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [signature, preset, encoders, hardware]);

  return { plans, pending };
}
