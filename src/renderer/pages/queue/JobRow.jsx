import { memo } from 'react';
import { CornerDownRight, GripVertical, Repeat2, TriangleAlert } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip.jsx';
import { Badge, ProgressBar } from '../../components/Feedback.jsx';
import { cx } from '../../lib/cx.js';
import { useQueue } from '../../state/queue.js';
import { t } from '../../strings/index.js';
import { isPending, rowActions } from './model.js';
import { badgeFor, etaText, liveProgress, nameLines, progressView, speedText, targetLabel, targetLines, warningLines } from './labels.js';
import { ActionButtons, KindIcon, tipContent } from './parts.jsx';
import { FailurePanel } from './FailurePanel.jsx';

const q = t.queue;

function ChildLink({ child, onReveal }) {
  return (
    <Tooltip label={q.conversionHint(badgeFor(child, null).label)} className="q-extra">
      <button
        type="button"
        className="q-link"
        onClick={(event) => {
          event.stopPropagation();
          onReveal(child.id);
        }}
      >
        <CornerDownRight size={12} />
        {q.conversion}
      </button>
    </Tooltip>
  );
}

function WarningMark({ lines }) {
  return (
    <Tooltip label={tipContent(q.finishedNotes, lines)} className="q-extra">
      <span className="q-warn" role="img" aria-label={q.finishedNotes}>
        <TriangleAlert size={14} />
      </span>
    </Tooltip>
  );
}

export const JobRow = memo(function JobRow({ entry, child, selected, cursor, dropEdge, handlers }) {
  const job = entry.job;
  const running = job.state === 'running';
  const liveEvent = useQueue((state) => (running ? state.progress[job.id] : undefined));
  const progress = liveProgress(job, liveEvent);
  const bar = progressView(job, progress);
  const badge = badgeFor(job, progress);
  const actions = rowActions(job, bar.stopping);
  const warnings = job.state === 'done' ? warningLines(job.result?.warnings) : [];

  return (
    <div
      className={cx(
        'q-item',
        selected && 'is-selected',
        cursor && 'is-cursor',
        entry.groupKey && 'is-child',
        entry.last && 'is-last-child',
        dropEdge && `drop-${dropEdge}`
      )}
      data-key={entry.key}
      role="option"
      aria-selected={selected}
      onClick={(event) => handlers.click(entry.key, event)}
      onDoubleClick={(event) => handlers.activate(entry.key, event)}
      onContextMenu={(event) => handlers.contextMenu(entry.key, event)}
      onDragOver={(event) => handlers.dragOver(entry, event)}
      onDrop={handlers.drop}
    >
      <div className="q-row">
        <span className="q-cell q-grip">
          {isPending(job) && (
            <span
              className="q-grip-handle"
              draggable
              aria-label={q.actions.dragToReorder}
              onDragStart={(event) => handlers.dragStart(job.id, event)}
              onDragEnd={handlers.dragEnd}
            >
              <GripVertical size={14} />
            </span>
          )}
        </span>
        <span className="q-cell q-kind">
          <KindIcon job={job} />
        </span>
        <span className="q-cell q-name">
          <Tooltip label={tipContent(job.title, nameLines(job))} className="q-name-tip">
            <span className="q-title ellipsis">{job.title}</span>
          </Tooltip>
          {warnings.length > 0 && <WarningMark lines={warnings} />}
          {child && job.state === 'done' && <ChildLink child={child} onReveal={handlers.reveal} />}
        </span>
        <span className="q-cell q-target">
          <Tooltip label={tipContent(null, targetLines(job))} className="q-target-tip">
            <span className="ellipsis">{targetLabel(job)}</span>
          </Tooltip>
          {job.chained && <Repeat2 size={12} className="q-chain-mark" aria-hidden="true" />}
        </span>
        <span className="q-cell q-progress">
          <ProgressBar value={bar.value} tone={bar.tone} label={job.title} />
        </span>
        <span className="q-cell q-percent num">{bar.text}</span>
        <span className="q-cell q-speed num">{speedText(job, progress)}</span>
        <span className="q-cell q-eta num">{etaText(job, progress)}</span>
        <span className="q-cell q-state">
          <Tooltip label={badge.hint} className="q-badge-tip">
            <Badge tone={badge.tone} className="q-badge">
              <span className="ellipsis">{badge.label}</span>
            </Badge>
          </Tooltip>
        </span>
        <ActionButtons names={actions} onAction={(name) => handlers.action(name, job)} />
      </div>
      {job.state === 'failed' && <FailurePanel job={job} handlers={handlers} />}
    </div>
  );
});
