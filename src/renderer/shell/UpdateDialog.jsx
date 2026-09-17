import { Download, RefreshCw, ExternalLink } from 'lucide-react';
import { Dialog } from '../components/Dialog.jsx';
import { Notice, ProgressBar } from '../components/Feedback.jsx';
import { api } from '../lib/api.js';
import { formatPercent } from '../lib/format.js';
import { t } from '../strings/index.js';

export function UpdateDialog({ open, update, onClose }) {
  const ready = update.phase === 'ready';
  const downloading = update.phase === 'downloading';
  const actions = [];
  if (ready) {
    actions.push({ id: 'install', label: t.app.updateInstall, variant: 'primary', icon: RefreshCw, autoFocus: true, onSelect: () => api.updates.install() });
  } else if (!downloading) {
    actions.push({ id: 'download', label: t.app.updateDownload, variant: 'primary', icon: Download, autoFocus: true, onSelect: () => api.updates.download() });
  }
  if (update.notesUrl) {
    actions.unshift({ id: 'notes', label: t.app.viewReleaseNotes, variant: 'ghost', icon: ExternalLink, onSelect: () => api.shell.openExternal(update.notesUrl) });
  }
  actions.unshift({
    id: 'skip',
    label: t.app.updateSkip,
    variant: 'ghost',
    onSelect: () => {
      api.updates.dismiss(update.version);
      onClose();
    }
  });
  actions.push({ id: 'later', label: t.app.updateLater, variant: 'secondary', autoFocus: downloading, onSelect: onClose });

  return (
    <Dialog open={open} title={ready ? t.app.updateReady(update.version) : t.app.updateTitle(update.version)} actions={actions} onCancel={onClose} width={480}>
      <div className="stack">
        {downloading && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted num">{t.app.updateDownloading(formatPercent(update.percent ?? 0))}</div>
            <ProgressBar value={update.percent} />
          </div>
        )}
        {update.error && <Notice tone="danger">{t.app.updateFailed}</Notice>}
        {ready && update.activeJobs > 0 && <Notice tone="warning">{t.app.updateRunningJobs}</Notice>}
      </div>
    </Dialog>
  );
}
