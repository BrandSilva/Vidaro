import { useEffect, useMemo, useState } from 'react';
import { Gauge, HardDrive } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { api } from '../lib/api.js';
import { formatBytes, formatSpeed, driveOf } from '../lib/format.js';
import { useQueue, summarize } from '../state/queue.js';
import { useSettings } from '../state/settings.js';
import { useApp } from '../state/app.js';
import { t } from '../strings/index.js';

const LOW_SPACE = 2 * 1024 * 1024 * 1024;

function useDiskSpace(folder, refreshKey) {
  const [space, setSpace] = useState(null);
  useEffect(() => {
    if (!folder) return undefined;
    let alive = true;
    const load = () =>
      api.files.diskSpace(folder).then((value) => {
        if (alive) setSpace(value);
      }, () => {});
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [folder, refreshKey]);
  return space;
}

export function StatusBar() {
  const jobs = useQueue((state) => state.jobs);
  const progress = useQueue((state) => state.progress);
  const page = useApp((state) => state.page);
  const downloadFolder = useSettings((s) => s.download.folder);
  const convertFolder = useSettings((s) => (s.convert.outputMode === 'folder' ? s.convert.folder : ''));
  const counts = useMemo(() => summarize(jobs), [jobs]);
  const folder = page === 'convert' && convertFolder ? convertFolder : downloadFolder;
  const finishedCount = useMemo(() => jobs.filter((job) => job.state === 'done').length, [jobs]);
  const space = useDiskSpace(folder, finishedCount);

  const speed = useMemo(() => {
    let total = 0;
    for (const job of jobs) {
      if (job.state !== 'running' || job.kind !== 'download') continue;
      const value = progress[job.id]?.speed;
      if (Number.isFinite(value)) total += value;
    }
    return total;
  }, [jobs, progress]);

  const busy = counts.downloading + counts.converting > 0;
  const parts = [];
  if (counts.downloading) parts.push(t.status.downloading(counts.downloading));
  if (counts.converting) parts.push(t.status.converting(counts.converting));
  if (counts.waiting) parts.push(t.status.waiting(counts.waiting));
  const drive = driveOf(folder);
  const low = space && space.free < LOW_SPACE;

  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className={cx('status-dot', busy && 'is-busy')} />
        <span className="ellipsis">{parts.length ? parts.join(' · ') : t.status.idle}</span>
      </div>
      {speed > 0 && (
        <div className="status-item num" aria-label={t.status.totalSpeed}>
          <Gauge size={13} />
          <span>{formatSpeed(speed)}</span>
        </div>
      )}
      <div className="status-spacer" />
      {space && (
        <div className={cx('status-item num', low && 'is-low')}>
          <HardDrive size={13} />
          <span>{low ? t.status.diskLow(drive, formatBytes(space.free)) : t.status.diskFree(drive, formatBytes(space.free))}</span>
        </div>
      )}
    </footer>
  );
}
