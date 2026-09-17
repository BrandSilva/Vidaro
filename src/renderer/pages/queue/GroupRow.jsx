import { memo, useMemo } from 'react';
import { ChevronRight, ListVideo } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip.jsx';
import { Badge, ProgressBar } from '../../components/Feedback.jsx';
import { cx } from '../../lib/cx.js';
import { formatPercent, formatSpeed } from '../../lib/format.js';
import { useQueue } from '../../state/queue.js';
import { t } from '../../strings/index.js';
import { bulkPlan, canResume, groupPercent, groupSpeed, isReady } from './model.js';
import { groupView } from './labels.js';
import { ActionButtons } from './parts.jsx';

const q = t.queue;
const BAR_TONES = { running: undefined, done: 'success', failed: 'danger' };

function groupActions(jobs, plan, failed) {
  const names = [];
  if (plan.pause.length) names.push('pause');
  else if (plan.resume.length) names.push(jobs.filter(canResume).every(isReady) ? 'start' : 'resume');
  if (failed > 0) names.push('retry');
  names.push('remove');
  return names;
}

export const GroupRow = memo(function GroupRow({ entry, selected, cursor, dropEdge, handlers }) {
  const percent = useQueue((state) => groupPercent(entry.jobs, state.progress));
  const speed = useQueue((state) => groupSpeed(entry.jobs, state.progress));
  const view = useMemo(() => groupView(entry.jobs), [entry.jobs]);
  const actions = useMemo(() => groupActions(entry.jobs, bulkPlan(entry.jobs), view.counts.failed), [entry.jobs, view]);
  const title = entry.title || q.group.untitled;
  const running = view.state === 'running';
  const tone = Object.hasOwn(BAR_TONES, view.state) ? BAR_TONES[view.state] : 'muted';

  return (
    <div
      className={cx('q-item', 'is-group', selected && 'is-selected', cursor && 'is-cursor', dropEdge && `drop-${dropEdge}`)}
      data-key={entry.key}
      role="option"
      aria-selected={selected}
      aria-expanded={!entry.collapsed}
      onClick={(event) => handlers.click(entry.key, event)}
      onDoubleClick={(event) => handlers.activate(entry.key, event)}
      onContextMenu={(event) => handlers.contextMenu(entry.key, event)}
      onDragOver={(event) => handlers.dragOver(entry, event)}
      onDrop={handlers.drop}
    >
      <div className="q-row">
        <span className="q-cell q-grip">
          <Tooltip label={entry.collapsed ? q.actions.expand : q.actions.collapse} side="top">
            <button
              type="button"
              className={cx('q-chevron', !entry.collapsed && 'is-open')}
              aria-label={entry.collapsed ? q.actions.expand : q.actions.collapse}
              onClick={(event) => {
                event.stopPropagation();
                handlers.toggleGroup(entry.groupId);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <ChevronRight size={14} />
            </button>
          </Tooltip>
        </span>
        <span className="q-cell q-kind">
          <span className="q-kind-icon is-group">
            <ListVideo size={14} />
          </span>
        </span>
        <span className="q-cell q-name">
          <Tooltip label={title} className="q-name-tip">
            <span className="q-title q-group-title ellipsis">{title}</span>
          </Tooltip>
          <span className="q-group-summary num">{view.summary}</span>
        </span>
        <span className="q-cell q-target" />
        <span className="q-cell q-progress">
          <ProgressBar value={percent} tone={tone} label={title} />
        </span>
        <span className="q-cell q-percent num">{percent > 0 || running ? formatPercent(percent) : ''}</span>
        <span className="q-cell q-speed num">{speed > 0 ? formatSpeed(speed) : ''}</span>
        <span className="q-cell q-eta num" />
        <span className="q-cell q-state">
          <Badge tone={view.badge.tone} className="q-badge">
            <span className="ellipsis">{view.badge.label}</span>
          </Badge>
        </span>
        <ActionButtons
          names={actions}
          labels={{ retry: q.actions.retryFailed, remove: q.actions.removeGroup }}
          onAction={(name) => handlers.groupAction(name, entry)}
        />
      </div>
    </div>
  );
});
