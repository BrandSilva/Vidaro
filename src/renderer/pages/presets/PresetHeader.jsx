import { useEffect, useRef, useState } from 'react';
import { Copy, Pencil, Share, Star, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { Badge, SavedFlag } from '../../components/Feedback.jsx';
import { TextInput } from '../../components/Inputs.jsx';
import { errorText } from '../../components/preset/model.js';
import { renamePreset } from '../../state/presets.js';
import { t } from '../../strings/index.js';

const p = t.presets;
const NAME_MAX = 60;

function RenameField({ preset, onDone }) {
  const [name, setName] = useState(preset.name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    const value = name.trim();
    if (!value) {
      setError(p.nameRequired);
      return;
    }
    if (value === preset.name) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await renamePreset(preset.id, value);
      onDone();
    } catch (failure) {
      setError(errorText(failure, p.actionFailed));
      setBusy(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onDone();
  };

  return (
    <div className="ps-rename" onKeyDown={onKeyDown}>
      <div className="ps-rename-row">
        <TextInput
          className="grow"
          value={name}
          invalid={Boolean(error)}
          disabled={busy}
          maxLength={NAME_MAX}
          aria-label={p.nameLabel}
          inputRef={inputRef}
          onChange={(value) => {
            setName(value);
            setError(null);
          }}
          onEnter={submit}
        />
        <Button variant="secondary" busy={busy} onClick={submit}>
          {p.save}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
      <div className={error ? 'ps-rename-error' : 'ps-rename-hint'}>{error || p.renameHint}</div>
    </div>
  );
}

export function PresetHeader({ preset, tags, isDefault, renaming, exportedToken, busy, onRenameStart, onRenameEnd, onDuplicate, onExport, onDelete, onSetDefault }) {
  const user = !preset.builtIn;
  return (
    <div className="ps-head">
      {renaming && user ? (
        <RenameField preset={preset} onDone={onRenameEnd} />
      ) : (
        <div className="ps-head-row">
          <div className="ps-head-text">
            <h2 className="ps-title ellipsis">{preset.name}</h2>
            {isDefault && (
              <Badge tone="accent" icon={Star}>
                {p.defaultBadge}
              </Badge>
            )}
          </div>
          <div className="ps-head-actions">
            <SavedFlag token={exportedToken} />
            <IconButton icon={Star} label={p.setDefault} disabled={isDefault || busy} onClick={onSetDefault} />
            <IconButton icon={Copy} label={p.duplicate} disabled={busy} onClick={onDuplicate} />
            {user && <IconButton icon={Pencil} label={p.rename} disabled={busy} onClick={onRenameStart} />}
            <IconButton icon={Share} label={p.exportPreset} disabled={busy} onClick={onExport} />
            {user && <IconButton icon={Trash2} tone="danger" label={p.remove} disabled={busy} onClick={onDelete} />}
          </div>
        </div>
      )}
      <div className="ps-tags">
        {tags.map((tag, index) => (
          <Badge key={`${index}-${tag}`}>{tag}</Badge>
        ))}
      </div>
      {preset.description && <p className="ps-description">{preset.description}</p>}
    </div>
  );
}
