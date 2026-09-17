import { ArrowDownToLine, CircleAlert, ListPlus, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { cx } from '../../lib/cx.js';
import { enqueueDraft } from '../../state/download.js';
import { t } from '../../strings/index.js';

const f = t.download.footer;

function messageFor(enqueueError) {
  if (!enqueueError) return null;
  if (enqueueError.issue) return t.download.issues[enqueueError.issue] ?? t.download.added.failed;
  return enqueueError.message || t.download.added.failed;
}

export function DownloadFooter({ status, summary, issue, enqueueError, enqueueing, startKeys }) {
  const ready = status === 'ready';
  const blocked = !ready || Boolean(issue);
  const error = messageFor(enqueueError);
  let tone = null;
  let text = summary;
  if (status === 'idle' || status === 'error') text = f.idle;
  else if (status === 'fetching') text = f.loading;
  else if (error) {
    tone = 'error';
    text = error;
  } else if (issue) {
    tone = 'issue';
    text = t.download.issues[issue] ?? '';
  }
  const Icon = tone === 'error' ? CircleAlert : tone === 'issue' ? TriangleAlert : null;
  return (
    <div className="page-footer dl-footer">
      <div className={cx('page-footer-info dl-summary', tone && `is-${tone}`, !ready && 'is-muted')} aria-live="polite">
        {Icon && <Icon size={15} />}
        <Tooltip label={ready ? text : null} className="dl-summary-anchor">
          <span className="dl-summary-text">{text}</span>
        </Tooltip>
      </div>
      <Button
        icon={ListPlus}
        size="lg"
        tooltip={f.addToQueueHint}
        disabled={blocked || enqueueing === 'start'}
        busy={enqueueing === 'queue'}
        onClick={() => enqueueDraft({ start: false })}
      >
        {f.addToQueue}
      </Button>
      <Button
        variant="primary"
        size="lg"
        icon={ArrowDownToLine}
        tooltip={startKeys ? `${f.downloadHint} (${startKeys})` : f.downloadHint}
        disabled={blocked || enqueueing === 'queue'}
        busy={enqueueing === 'start'}
        onClick={() => enqueueDraft({ start: true })}
      >
        {f.download}
      </Button>
    </div>
  );
}
