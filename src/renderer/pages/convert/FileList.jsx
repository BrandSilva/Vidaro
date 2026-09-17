import { Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { formatBytes, formatDuration } from '../../lib/format.js';
import { clearFiles } from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { FileCard } from './FileCard.jsx';

const c = t.convert;

export function FileList({ files, plans, totals }) {
  return (
    <div className="cv-files">
      <div className="cv-list-head">
        <span className="cv-list-summary num ellipsis">{c.listSummary(totals.count, formatBytes(totals.size), formatDuration(totals.duration))}</span>
        {totals.probing > 0 && <span className="cv-list-probing num">{c.probingCount(totals.probing)}</span>}
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={clearFiles}>
          {c.clear}
        </Button>
      </div>
      <div className="cv-list" role="list">
        {files.map((file) => (
          <div key={file.id} role="listitem" className="cv-list-item">
            <FileCard file={file} plan={plans[file.id]} />
          </div>
        ))}
      </div>
    </div>
  );
}
