import { useState } from 'react';
import { CircleAlert, CircleArrowUp, CircleCheck, Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Notice, ProgressBar, Skeleton } from '../../components/Feedback.jsx';
import { api } from '../../lib/api.js';
import { cx } from '../../lib/cx.js';
import { formatDate, formatPercent } from '../../lib/format.js';
import { useApp } from '../../state/app.js';
import { t } from '../../strings/index.js';
import { useUpdateStatus } from './hooks.js';
import { InfoRow, SettingsCard, SwitchRow, ValueText } from './controls.jsx';
import { LINKS, updatePhase } from './model.js';

const u = t.settings.updates;

function statusLine(phase, update) {
  switch (phase) {
    case 'checking':
      return { text: u.checking };
    case 'current':
      return { text: u.upToDate, tone: 'success', icon: CircleCheck };
    case 'available':
      return { text: u.available(update.version), tone: 'accent', icon: CircleArrowUp };
    case 'downloading':
      return { text: u.downloading(formatPercent(update.percent ?? 0)) };
    case 'ready':
      return { text: u.ready(update.version), tone: 'success', icon: CircleArrowUp };
    case 'check-failed':
      return { text: u.checkFailed, tone: 'danger', icon: CircleAlert };
    default:
      return { text: u.idle };
  }
}

function StatusAction({ phase, busy, onCheck }) {
  if (phase === 'available') {
    return (
      <Button icon={Download} onClick={() => api.updates.download()}>
        {u.download}
      </Button>
    );
  }
  if (phase === 'ready') {
    return (
      <Button variant="primary" icon={RotateCw} onClick={() => api.updates.install()}>
        {u.install}
      </Button>
    );
  }
  return (
    <Button icon={RefreshCw} busy={busy} disabled={phase === 'downloading'} onClick={onCheck}>
      {u.check}
    </Button>
  );
}

export function UpdatesCard({ sectionRef }) {
  const info = useApp((state) => state.info);
  const update = useUpdateStatus();
  const [checking, setChecking] = useState(false);
  const phase = updatePhase(update);
  const line = statusLine(phase, update);
  const Icon = line.icon;
  const notesUrl = update?.notesUrl || LINKS.releases;

  const check = () => {
    setChecking(true);
    api.updates
      .check()
      .catch(() => null)
      .finally(() => setChecking(false));
  };

  const hint =
    phase === 'current' && update?.checkedAt ? u.checkedAt(formatDate(update.checkedAt)) : update?.error === 'download-failed' ? <span className="st-error">{u.downloadFailed}</span> : null;

  return (
    <SettingsCard id="updates" title={t.settings.sections.updates} icon={CircleArrowUp} sectionRef={sectionRef}>
      <InfoRow label={u.current}>{info ? <ValueText>{info.version}</ValueText> : <Skeleton width={60} height={14} />}</InfoRow>
      <SwitchRow path="general.checkUpdates" label={u.auto} hint={u.autoHint} />
      <InfoRow
        label={
          <span className={cx('st-status', line.tone && `tone-${line.tone}`)}>
            {Icon && <Icon size={14} />}
            <span className="ellipsis num">{line.text}</span>
          </span>
        }
        hint={hint}
      >
        <StatusAction phase={phase} busy={checking || phase === 'checking'} onCheck={check} />
      </InfoRow>
      {phase === 'downloading' && (
        <div className="st-inline">
          <ProgressBar value={update.percent} label={line.text} />
        </div>
      )}
      {phase === 'ready' && update.activeJobs > 0 && (
        <div className="st-inline">
          <Notice tone="warning">{u.runningJobs}</Notice>
        </div>
      )}
      <InfoRow label={u.notes} hint={u.notesHint}>
        <Button variant="ghost" icon={ExternalLink} onClick={() => api.shell.openExternal(notesUrl)}>
          {t.settings.about.releases}
        </Button>
      </InfoRow>
    </SettingsCard>
  );
}
