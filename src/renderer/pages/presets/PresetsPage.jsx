import { SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { t } from '../../strings/index.js';

export function PresetsPage() {
  return (
    <div className="page">
      <PageHeader title={t.nav.presets} />
      <div className="page-body">
        <EmptyState icon={SlidersHorizontal} title={t.nav.presets} />
      </div>
    </div>
  );
}
