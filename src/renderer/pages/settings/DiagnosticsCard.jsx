import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FolderOpen, RefreshCw, Stethoscope } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Badge, Skeleton } from '../../components/Feedback.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../state/app.js';
import { t } from '../../strings/index.js';
import { useDiagnosticsInfo, useEncoders, useSettingsContext } from './hooks.js';
import { GroupTitle, InfoRow, SettingsCard, ValueText } from './controls.jsx';
import { RuntimeBadge, runtimeLabel } from './YtDlpCard.jsx';
import { diagnosticsText, encoderRows } from './model.js';

const x = t.settings.diagnostics;
const COPIED_MS = 2000;
const PENDING_CODECS = ['h264', 'hevc', 'av1', 'vp9'];

function Pending({ width = 90 }) {
  return <Skeleton width={width} height={14} />;
}

function ToolValue({ loaded, value }) {
  if (!loaded) return <Pending />;
  return <ValueText tone={value ? undefined : 'muted'}>{value || x.unavailable}</ValueText>;
}

function EncoderList({ row }) {
  if (row.encoders.length === 0) return <ValueText tone="muted">{x.noEncoder}</ValueText>;
  return (
    <span className="st-badges">
      {row.encoders.map((encoder) => (
        <Badge key={encoder.name} tone={encoder.broken ? 'warning' : encoder.hardware ? 'accent' : undefined}>
          {encoder.broken ? x.failedEncoder(encoder.label) : encoder.label}
        </Badge>
      ))}
    </span>
  );
}

function FolderRow({ label, hint, folder }) {
  return (
    <InfoRow label={label} hint={hint}>
      <Tooltip label={folder} className="st-path-wrap">
        <span className="st-path selectable">{folder}</span>
      </Tooltip>
      <Button size="sm" icon={FolderOpen} disabled={!folder} onClick={() => api.files.openFolder(folder)}>
        {x.open}
      </Button>
    </InfoRow>
  );
}

function CopyButton({ build }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await api.clipboard.writeText(build());
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <Button size="sm" variant="ghost" icon={copied ? Check : Copy} className="st-copy" onClick={copy}>
      {copied ? x.copied : x.copy}
    </Button>
  );
}

export function DiagnosticsCard({ sectionRef, ytdlp }) {
  const { settings } = useSettingsContext();
  const info = useApp((state) => state.info);
  const { diag, loaded } = useDiagnosticsInfo();
  const [encoders, setEncoders] = useEncoders();
  const [detecting, setDetecting] = useState(false);
  const status = ytdlp.status;
  const encodersReady = encoders && encoders.status === 'ready';
  const busy = detecting || encoders?.status === 'detecting';
  const rows = encoderRows(encoders);

  const detect = () => {
    setDetecting(true);
    api.convert
      .detectEncoders()
      .then((view) => {
        if (view) setEncoders(view);
      }, () => null)
      .finally(() => setDetecting(false));
  };

  const build = () => diagnosticsText({ info, diag, ytdlp: status, encoders, settings });

  return (
    <SettingsCard id="diagnostics" title={t.settings.sections.diagnostics} icon={Stethoscope} sectionRef={sectionRef} actions={<CopyButton build={build} />}>
      <GroupTitle>{x.groupTools}</GroupTitle>
      <InfoRow label={x.ffmpeg}>
        <ToolValue loaded={loaded} value={diag?.tools?.ffmpeg} />
      </InfoRow>
      <InfoRow label={x.ytdlp}>{status ? <ValueText>{status.version || x.unavailable}</ValueText> : <Pending />}</InfoRow>
      <InfoRow label={x.runtime}>
        {status ? (
          <>
            <ValueText>{runtimeLabel(status.jsRuntime)}</ValueText>
            <RuntimeBadge runtime={status.jsRuntime} />
          </>
        ) : (
          <Pending width={160} />
        )}
      </InfoRow>

      <div className="st-group st-group-actions">
        <span>{x.groupEncoders}</span>
        <Button size="sm" variant="ghost" icon={RefreshCw} busy={busy} onClick={detect}>
          {x.detectAgain}
        </Button>
      </div>
      <div className="st-note">{x.encodersHint}</div>
      {encodersReady &&
        rows.map((row) => (
          <InfoRow key={row.codec} label={x.codecs[row.codec] || row.codec}>
            <EncoderList row={row} />
          </InfoRow>
        ))}
      {!encodersReady && (busy || !encoders)
        ? PENDING_CODECS.map((codec) => (
            <InfoRow key={codec} label={x.codecs[codec]} hint={codec === PENDING_CODECS[0] && busy ? x.detecting : null}>
              <Pending width={140} />
            </InfoRow>
          ))
        : null}
      {!encodersReady && !busy && encoders && (
        <InfoRow label={x.notDetected}>
          <ValueText tone="muted">{x.noEncoder}</ValueText>
        </InfoRow>
      )}

      <GroupTitle>{x.groupApp}</GroupTitle>
      <InfoRow label={x.version}>
        {info ? (
          <>
            {!info.packaged && <Badge>{x.development}</Badge>}
            <ValueText>{info.version}</ValueText>
          </>
        ) : (
          <Pending width={60} />
        )}
      </InfoRow>
      <InfoRow label={x.electron}>{info ? <ValueText>{info.electron}</ValueText> : <Pending />}</InfoRow>
      <InfoRow label={x.chrome}>{info ? <ValueText>{info.chrome}</ValueText> : <Pending />}</InfoRow>
      <InfoRow label={x.node}>{info ? <ValueText>{info.node}</ValueText> : <Pending />}</InfoRow>
      <InfoRow label={x.system}>{info ? <ValueText>{info.platform}</ValueText> : <Pending width={140} />}</InfoRow>

      <GroupTitle>{x.groupFolders}</GroupTitle>
      <FolderRow label={x.settingsFolder} hint={x.settingsFolderHint} folder={info?.userData || ''} />
      {diag?.folders?.data && <FolderRow label={x.dataFolder} hint={x.dataFolderHint} folder={diag.folders.data} />}
      <FolderRow label={x.downloadsFolder} hint={x.downloadsFolderHint} folder={settings.download.folder} />
    </SettingsCard>
  );
}
