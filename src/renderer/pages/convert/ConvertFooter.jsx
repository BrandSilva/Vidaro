import { ListPlus, Play } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { FolderField } from '../../components/FolderField.jsx';
import { Segmented } from '../../components/Inputs.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { updateOutput } from '../../state/convert.js';
import { t } from '../../strings/index.js';

const c = t.convert;
const MODES = ['source', 'folder'];

export function ConvertFooter({ output, blocker, busy, onQueue, onStart }) {
  const modes = MODES.map((value) => ({ value, label: c.saveModes[value] }));
  return (
    <div className="page-footer cv-footer">
      <Segmented value={output.mode} options={modes} label={c.saveTo} onChange={(value) => updateOutput({ outputMode: value })} />
      <div className="cv-footer-dest">
        {output.mode === 'folder' ? (
          <FolderField value={output.folder} placeholder={c.chooseFolder} onChange={(folder) => updateOutput({ folder })} />
        ) : (
          <span className="cv-footer-note ellipsis">{c.sourceFolderNote}</span>
        )}
      </div>
      <Tooltip label={blocker} side="top" disabled={!blocker}>
        <Button icon={ListPlus} disabled={Boolean(blocker) || Boolean(busy)} busy={busy === 'queue'} onClick={onQueue}>
          {c.addToQueue}
        </Button>
      </Tooltip>
      <Tooltip label={blocker} side="top" disabled={!blocker}>
        <Button variant="primary" icon={Play} disabled={Boolean(blocker) || Boolean(busy)} busy={busy === 'start'} onClick={onStart}>
          {c.convertAll}
        </Button>
      </Tooltip>
    </div>
  );
}
