import { ListVideo } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { t } from '../../strings/index.js';

export function QueuePage() {
  return (
    <div className="page">
      <PageHeader title={t.nav.queue} />
      <div className="page-body">
        <EmptyState icon={ListVideo} title={t.nav.queue} />
      </div>
    </div>
  );
}
