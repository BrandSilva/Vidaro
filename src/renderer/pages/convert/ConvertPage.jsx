import { Repeat2 } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { t } from '../../strings/index.js';

export function ConvertPage() {
  return (
    <div className="page">
      <PageHeader title={t.nav.convert} />
      <div className="page-body">
        <EmptyState icon={Repeat2} title={t.nav.convert} />
      </div>
    </div>
  );
}
