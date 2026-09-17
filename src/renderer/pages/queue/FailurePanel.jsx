import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Cpu, RefreshCw, RotateCcw, Settings } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Notice } from '../../components/Feedback.jsx';
import { cx } from '../../lib/cx.js';
import { useStore } from '../../lib/store.js';
import { t } from '../../strings/index.js';
import { ytdlpUpdateStore } from './commands.js';
import { errorText } from './labels.js';

const q = t.queue;
const COPIED_MS = 1600;

function selectBusy(state) {
  return state.busy;
}

function selectNote(state) {
  return state.note;
}

export function FailurePanel({ job, handlers }) {
  const error = job.error;
  const text = errorText(error);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const busy = useStore(ytdlpUpdateStore, selectBusy);
  const note = useStore(ytdlpUpdateStore, selectNote);
  const action = error?.action || null;
  const detail = error?.detail || '';
  const updateNote = note?.ids.has(job.id) ? note.kind : null;
  const updating = busy && action === 'update-ytdlp';

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await handlers.copy(detail);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const actions = (
    <>
      {action === 'update-ytdlp' && (
        <Button size="sm" variant="primary" icon={RefreshCw} busy={updating} onClick={() => handlers.updateAndRetry([job.id])}>
          {q.failure.updateAndRetry}
        </Button>
      )}
      {action === 'retry-software' && (
        <Button size="sm" icon={Cpu} tooltip={q.failure.softwareRetryHint} onClick={() => handlers.softwareRetry([job.id])}>
          {q.failure.softwareRetry}
        </Button>
      )}
      {(action === 'cookies' || action === 'open-settings') && (
        <Button size="sm" icon={Settings} onClick={handlers.openSettings}>
          {action === 'cookies' ? q.failure.cookieSettings : q.failure.openSettings}
        </Button>
      )}
      <Button size="sm" icon={RotateCcw} disabled={updating} onClick={() => handlers.retry([job.id])}>
        {q.actions.retry}
      </Button>
      {detail && (
        <Button
          size="sm"
          variant="ghost"
          iconRight={ChevronDown}
          className={cx('q-details-toggle', open && 'is-open')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {q.failure.details}
        </Button>
      )}
    </>
  );

  return (
    <div className="q-failure">
      <Notice tone="danger" className="q-failure-notice" title={text.message} actions={actions}>
        {(text.hint || updateNote) && (
          <>
            {text.hint}
            {updateNote && (
              <span className={cx('q-failure-update', updateNote === 'failed' && 'is-danger')}>
                {updateNote === 'failed' ? q.failure.updateFailed : q.failure.updateDeferred}
              </span>
            )}
          </>
        )}
      </Notice>
      {open && detail && (
        <div className="q-failure-detail">
          <pre className="q-detail-text mono selectable" aria-label={q.failure.detailsLabel}>
            {detail}
          </pre>
          <Button size="sm" variant="ghost" icon={copied ? Check : Copy} className="q-copy" onClick={copy}>
            {copied ? q.failure.copied : q.failure.copy}
          </Button>
        </div>
      )}
    </div>
  );
}
