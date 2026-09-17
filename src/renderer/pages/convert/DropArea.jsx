import { FilePlus2, FolderPlus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Kbd, Skeleton } from '../../components/Feedback.jsx';
import { effectiveBindings, formatAccelerator } from '../../lib/shortcuts.js';
import { useSettings } from '../../state/settings.js';
import { t } from '../../strings/index.js';

const c = t.convert;
const SKELETON_ROWS = 3;

function selectShortcuts(settings) {
  return settings?.shortcuts;
}

export function DropArea({ busy, onAddFiles, onAddFolder }) {
  const shortcuts = useSettings(selectShortcuts);
  const accelerator = effectiveBindings(shortcuts || {}).get('addFiles');
  if (busy) {
    return (
      <div className="cv-drop is-busy" aria-busy="true">
        <div className="cv-drop-title">{c.reading}</div>
        <div className="cv-drop-skeleton">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} height={62} radius={10} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="cv-drop">
      <div className="cv-drop-icon">
        <FilePlus2 size={30} />
      </div>
      <div className="cv-drop-title">{c.dropTitle}</div>
      <div className="cv-drop-or">{c.dropOr}</div>
      <div className="cv-drop-actions">
        <Button variant="primary" size="lg" icon={FilePlus2} onClick={onAddFiles}>
          {c.addFiles}
        </Button>
        <Button size="lg" icon={FolderPlus} onClick={onAddFolder}>
          {c.addFolder}
        </Button>
      </div>
      {accelerator && (
        <div className="cv-drop-key">
          <Kbd>{formatAccelerator(accelerator)}</Kbd>
        </div>
      )}
      <div className="cv-drop-formats">{c.dropFormats}</div>
    </div>
  );
}
