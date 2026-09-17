import { useState } from 'react';
import { ArrowUpCircle, LoaderCircle } from 'lucide-react';
import { useApp } from '../state/app.js';
import { t } from '../strings/index.js';
import { UpdateDialog } from './UpdateDialog.jsx';

export function UpdatePill() {
  const update = useApp((state) => state.update);
  const [open, setOpen] = useState(false);
  if (!update || !update.available || update.dismissed) return null;
  const downloading = update.phase === 'downloading';
  return (
    <>
      <button type="button" className="pill no-drag" onClick={() => setOpen(true)}>
        {downloading ? <LoaderCircle size={14} className="spin" /> : <ArrowUpCircle size={14} />}
        <span className="num">{t.common.updateAvailable(update.version)}</span>
      </button>
      <UpdateDialog open={open} update={update} onClose={() => setOpen(false)} />
    </>
  );
}
