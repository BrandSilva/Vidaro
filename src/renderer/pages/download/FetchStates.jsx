import { useState } from 'react';
import { ArrowDownToLine, ChevronDown, ListVideo, RefreshCw, RotateCcw, Settings, X } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { EmptyState, Kbd, Notice, Skeleton } from '../../components/Feedback.jsx';
import { navigate } from '../../state/app.js';
import { cancelFetch, dismissAdded, retryFetch, updateAndRetry } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { errorView } from './labels.js';

const d = t.download;
const NOTES = {
  deferred: d.error.updateDeferred,
  failed: d.error.updateFailed,
  current: d.error.upToDate
};

export function IdleHint({ pasteKeys }) {
  return (
    <EmptyState icon={ArrowDownToLine} title={d.idle.title}>
      <div>{d.idle.text}</div>
      {pasteKeys && (
        <div className="dl-idle-keys">
          {d.idle.shortcutBefore} <Kbd>{pasteKeys}</Kbd> {d.idle.shortcutAfter}
        </div>
      )}
    </EmptyState>
  );
}

export function FetchingCard({ playlist }) {
  return (
    <div className="section dl-video dl-loading" aria-busy="true">
      <Skeleton width={192} height={108} radius={8} />
      <div className="dl-video-body">
        <Skeleton width="72%" height={18} />
        <Skeleton width="38%" height={13} />
        <div className="dl-loading-line">
          {playlist && <ListVideo size={14} />}
          <span className="ellipsis">{playlist ? d.fetching.playlist : d.fetching.video}</span>
          <span className="grow" />
          <Button size="sm" variant="ghost" icon={X} onClick={cancelFetch}>
            {d.fetching.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FetchError({ error, updating, updateNote }) {
  const [open, setOpen] = useState(false);
  const view = errorView(error);
  const settingsAction = error?.action === 'cookies' || error?.action === 'open-settings';
  const note = updateNote ? NOTES[updateNote] : null;
  return (
    <Notice tone="danger" title={view.message}>
      {view.hint && <div>{view.hint}</div>}
      {note && <div className="dl-error-note">{note}</div>}
      <div className="dl-error-actions">
        {error?.action === 'update-ytdlp' && (
          <Button size="sm" variant="secondary" icon={RefreshCw} busy={updating} onClick={updateAndRetry}>
            {updating ? d.error.updating : d.error.update}
          </Button>
        )}
        <Button size="sm" icon={RotateCcw} disabled={updating} onClick={() => retryFetch()}>
          {d.error.retry}
        </Button>
        {settingsAction && (
          <Button size="sm" icon={Settings} onClick={() => navigate('settings')}>
            {d.error.openSettings}
          </Button>
        )}
        {error?.detail && (
          <Button size="sm" variant="ghost" iconRight={ChevronDown} className={open ? 'dl-details-open' : undefined} onClick={() => setOpen((value) => !value)}>
            {open ? t.common.hideDetails : t.common.details}
          </Button>
        )}
      </div>
      {open && error?.detail && <div className="dl-details selectable">{error.detail}</div>}
    </Notice>
  );
}

export function AddedNotice({ added }) {
  return (
    <Notice
      tone="success"
      title={added.started ? d.added.started(added.count) : d.added.ready(added.count)}
      onDismiss={dismissAdded}
      actions={
        <Button size="sm" icon={ListVideo} onClick={() => navigate('queue')}>
          {d.added.viewQueue}
        </Button>
      }
    >
      {added.started ? null : d.added.readyHint}
    </Notice>
  );
}
