import { useState } from 'react';
import { CircleAlert, CircleCheck, Clock, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Badge, Skeleton } from '../../components/Feedback.jsx';
import { Segmented } from '../../components/Inputs.jsx';
import { api } from '../../lib/api.js';
import { cx } from '../../lib/cx.js';
import { formatDate } from '../../lib/format.js';
import { t } from '../../strings/index.js';
import { useSettingsContext } from './hooks.js';
import { InfoRow, Row, SettingsCard, SwitchRow, ValueText, useValue } from './controls.jsx';
import { OPTIONS, mergeYtdlpStatus, runtimeState, shortVersion, ytdlpBusy, ytdlpResultKey, ytdlpStatusResult } from './model.js';

const y = t.settings.ytdlp;

const CHANNEL_OPTIONS = OPTIONS['download.ytdlpChannel'].map((value) => ({ value, label: y.channelOptions[value] }));
const SUCCESS = new Set(['current', 'updated']);
const THROWN = Object.freeze({ outcome: 'failed', error: 'failed' });
const DEFERRED = Object.freeze({ outcome: 'deferred' });

export function runtimeLabel(runtime) {
  if (!runtime || !runtime.name) return y.runtimeNone;
  if (runtime.name === 'node') return y.runtimeBuiltIn(shortVersion(runtime.version));
  const name = runtime.name.charAt(0).toUpperCase() + runtime.name.slice(1);
  return y.runtimeNamed(name, shortVersion(runtime.version));
}

export function RuntimeBadge({ runtime }) {
  const state = runtimeState(runtime);
  if (state === 'ok') return <Badge tone="success">{y.runtimeOk}</Badge>;
  if (state === 'broken' || state === 'none') return <Badge tone="danger">{y.runtimeBroken}</Badge>;
  return <Badge>{t.settings.checking}</Badge>;
}

function resultText(key, status) {
  if (key === 'current') return y.results.current(status?.version);
  if (key === 'updated') return y.results.updated(status?.version);
  return y.results[key] || y.results.failed;
}

function ChannelRow({ status }) {
  const { save } = useSettingsContext();
  const value = useValue('download.ytdlpChannel');
  const switching = Boolean(status && status.channel && !status.usingBundled && status.channel !== value);
  return (
    <Row keys={['download.ytdlpChannel']} label={y.channel} hint={switching ? y.channelSwitchHint : y.channelHint}>
      <Segmented value={value} options={CHANNEL_OPTIONS} label={y.channel} onChange={(next) => save('download.ytdlpChannel', next)} />
    </Row>
  );
}

function UpdateRow({ status, setStatus, inspect }) {
  const [running, setRunning] = useState(false);
  const [thrown, setThrown] = useState(false);
  const busy = running || ytdlpBusy(status);
  const shown = thrown ? THROWN : status?.pending ? DEFERRED : ytdlpStatusResult(status);
  const key = busy ? null : ytdlpResultKey(shown);
  const lastCheck = status?.lastCheck ? formatDate(status.lastCheck) : t.settings.never;

  const update = async () => {
    setRunning(true);
    setThrown(false);
    try {
      const outcome = await api.ytdlp.update();
      if (outcome?.status) setStatus((previous) => mergeYtdlpStatus(previous, outcome.status));
      if (outcome?.outcome === 'updated') inspect();
    } catch {
      setThrown(true);
    } finally {
      setRunning(false);
    }
  };

  const tone = key === 'deferred' ? 'info' : SUCCESS.has(key) ? 'success' : 'danger';
  const Icon = key === 'deferred' ? Clock : SUCCESS.has(key) ? CircleCheck : CircleAlert;
  const hint = busy ? (
    <span className="st-result">{y.updating}</span>
  ) : key ? (
    <span className={cx('st-result', `tone-${tone}`)}>
      <Icon size={13} />
      <span className="ellipsis">{resultText(key, status)}</span>
    </span>
  ) : null;

  return (
    <InfoRow label={y.lastCheck} hint={hint}>
      <ValueText className="st-date">{status ? lastCheck : ''}</ValueText>
      <Button size="md" icon={RefreshCw} busy={busy} disabled={!status} onClick={update}>
        {y.updateNow}
      </Button>
    </InfoRow>
  );
}

export function YtDlpCard({ sectionRef, ytdlp }) {
  const { status, setStatus, inspect } = ytdlp;
  const runtime = status?.jsRuntime;
  const runtimeBroken = ['broken', 'none'].includes(runtimeState(runtime)) && Boolean(status);

  return (
    <SettingsCard id="ytdlp" title={t.settings.sections.ytdlp} icon={TerminalSquare} sectionRef={sectionRef}>
      <InfoRow label={y.version} hint={y.versionHint}>
        {status ? (
          <>
            {status.usingBundled && <Badge>{y.bundled}</Badge>}
            {status.channel && <Badge tone={status.channel === 'nightly' ? 'accent' : undefined}>{y.channelOptions[status.channel]}</Badge>}
            <ValueText>{status.version || t.common.unknown}</ValueText>
          </>
        ) : (
          <Skeleton width={120} height={14} />
        )}
      </InfoRow>
      <ChannelRow status={status} />
      <SwitchRow path="download.ytdlpAutoUpdate" label={y.autoUpdate} hint={y.autoUpdateHint} />
      <UpdateRow status={status} setStatus={setStatus} inspect={inspect} />
      <InfoRow label={y.runtime} hint={runtimeBroken ? <span className="st-error">{y.runtimeBrokenHint}</span> : y.runtimeHint}>
        {status ? (
          <>
            <ValueText>{runtimeLabel(runtime)}</ValueText>
            <RuntimeBadge runtime={runtime} />
          </>
        ) : (
          <Skeleton width={160} height={14} />
        )}
      </InfoRow>
    </SettingsCard>
  );
}
