import { Settings } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { t } from '../../strings/index.js';

export function SettingsPage() {
  return (
    <div className="page">
      <PageHeader title={t.nav.settings} />
      <div className="page-body">
        <EmptyState icon={Settings} title={t.nav.settings} />
      </div>
    </div>
  );
}
