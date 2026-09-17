import { ArrowDownToLine, ExternalLink, FolderOpen, Pause, Play, Repeat2, RotateCcw, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/Button.jsx';
import { Thumb } from '../../components/Thumb.jsx';
import { t } from '../../strings/index.js';

const q = t.queue;

const ROW_ACTIONS = {
  start: { icon: Play, label: q.actions.start },
  pause: { icon: Pause, label: q.actions.pause },
  resume: { icon: Play, label: q.actions.resume },
  retry: { icon: RotateCcw, label: q.actions.retry },
  cancel: { icon: X, label: q.actions.cancel, tone: 'danger' },
  remove: { icon: Trash2, label: q.actions.remove, tone: 'danger' },
  open: { icon: ExternalLink, label: q.actions.openFile },
  show: { icon: FolderOpen, label: q.actions.showInFolder }
};

export function tipContent(title, lines) {
  const list = (lines || []).filter(Boolean);
  if (!title && list.length === 0) return null;
  return (
    <span className="q-tip">
      {title && <span className="q-tip-title">{title}</span>}
      {list.map((line, index) => (
        <span key={index} className="q-tip-line">
          {line}
        </span>
      ))}
    </span>
  );
}

function stopEvent(event) {
  event.stopPropagation();
}

export function ActionButtons({ names, labels, onAction }) {
  return (
    <span className="q-cell q-actions" onClick={stopEvent} onDoubleClick={stopEvent}>
      {names.map((name) => {
        const spec = ROW_ACTIONS[name];
        return (
          <IconButton
            key={name}
            size="sm"
            icon={spec.icon}
            iconSize={14}
            label={labels?.[name] || spec.label}
            tone={spec.tone}
            side="top"
            onClick={() => onAction(name)}
          />
        );
      })}
    </span>
  );
}

export function KindIcon({ job }) {
  if (job.kind === 'download' && job.thumbnail) {
    return <Thumb src={job.thumbnail} width={32} height={18} audio={job.download?.mode === 'audio'} iconSize={12} />;
  }
  const Icon = job.kind === 'download' ? ArrowDownToLine : Repeat2;
  return (
    <span className="q-kind-icon">
      <Icon size={14} />
    </span>
  );
}
