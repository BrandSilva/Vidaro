import { ArrowDownToLine } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { t } from '../../strings/index.js';

export function DownloadPage() {
  return (
    <div className="page">
      <PageHeader title={t.nav.download} />
      <div className="page-body">
        <EmptyState icon={ArrowDownToLine} title={t.nav.download} />
      </div>
    </div>
  );
}
