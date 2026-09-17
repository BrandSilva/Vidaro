import { Folder, FolderOpen } from 'lucide-react';
import { api } from '../lib/api.js';
import { t } from '../strings/index.js';
import { IconButton } from './Button.jsx';
import { Tooltip } from './Tooltip.jsx';

export function FolderField({ value, onChange, disabled = false, placeholder }) {
  const browse = async () => {
    const picked = await api.dialogs.pickFolder(value);
    if (picked) onChange(picked);
  };
  return (
    <div className="folder-field">
      <Tooltip label={value} className="grow">
        <button type="button" className="folder-path" onClick={browse} disabled={disabled}>
          <Folder size={15} />
          <span className="ellipsis">{value || placeholder}</span>
        </button>
      </Tooltip>
      <IconButton icon={FolderOpen} label={t.common.openFolder} outlined disabled={disabled || !value} onClick={() => api.files.openFolder(value)} />
    </div>
  );
}
