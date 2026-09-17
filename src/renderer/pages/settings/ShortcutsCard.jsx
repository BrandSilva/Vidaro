import { Fragment, useEffect, useRef, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { Kbd, Notice } from '../../components/Feedback.jsx';
import { acceleratorFromEvent, findConflict, formatAccelerator, setModalOpen, SHORTCUTS } from '../../lib/shortcuts.js';
import { cx } from '../../lib/cx.js';
import { t } from '../../strings/index.js';
import { useSettingsContext } from './hooks.js';
import { GroupTitle, RowLabel, SettingsCard } from './controls.jsx';
import { acceleratorParts, assignShortcut, captureAction, groupShortcuts, isShortcutDefault, resetShortcut, shortcutValue } from './model.js';

const k = t.settings.shortcuts;
const GROUPS = groupShortcuts(SHORTCUTS);
const flagKey = (id) => `shortcuts.${id}`;

export function shortcutLabel(id) {
  return k.labels[id] || id;
}

export function Keys({ accelerator }) {
  const parts = acceleratorParts(formatAccelerator(accelerator));
  if (parts.length === 0) return <span className="st-unset">{t.settings.notSet}</span>;
  return (
    <span className="st-keys">
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 && <span className="st-plus">+</span>}
          <Kbd>{part}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

function Recorder({ onResult }) {
  const ref = useRef(null);
  const [reserved, setReserved] = useState(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    setModalOpen(true);
    ref.current?.focus();
    const onKeyDown = (event) => {
      const action = captureAction(event, acceleratorFromEvent(event));
      if (action.type === 'leave') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || action.type === 'wait') return;
      if (action.type === 'reserved') {
        setReserved(action.accelerator);
        return;
      }
      resultRef.current({ ...action, via: 'key' });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      setModalOpen(false);
    };
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={0}
      className={cx('st-capture', reserved && 'is-invalid')}
      aria-live="polite"
      onBlur={() => resultRef.current({ type: 'cancel', via: 'blur' })}
    >
      <span className="ellipsis">{reserved ? k.reserved(formatAccelerator(reserved)) : k.recording}</span>
    </div>
  );
}

function ShortcutRow({ shortcut, overrides, recording, onRecord, onResult, onReset, token, failed }) {
  const value = shortcutValue(overrides, shortcut);
  const changed = !isShortcutDefault(overrides, shortcut);
  const label = shortcutLabel(shortcut.id);
  return (
    <div className={cx('st-row is-compact', recording && 'is-recording')}>
      <div className="setting-row">
        <div className="setting-text">
          <div className="setting-label">
            <RowLabel text={label} token={token} failed={failed} />
          </div>
          {recording && <div className="setting-hint">{k.recordingHint}</div>}
        </div>
        <div className="setting-control st-shortcut-control">
          {recording ? (
            <Recorder onResult={onResult} />
          ) : (
            <>
              <span className="st-shortcut-keys">
                <Keys accelerator={value} />
              </span>
              <Button size="sm" variant="secondary" className="st-change" data-shortcut={shortcut.id} onClick={onRecord} aria-label={`${k.change}: ${label}`}>
                {k.change}
              </Button>
            </>
          )}
        </div>
        <div className="setting-reset">
          {changed && !recording && <IconButton icon={RotateCcw} size="sm" iconSize={14} label={t.settings.resetRow} onClick={onReset} />}
        </div>
      </div>
    </div>
  );
}

export function ShortcutsCard({ sectionRef }) {
  const { settings, tokens, failed, saveShortcuts, reset } = useSettingsContext();
  const overrides = settings.shortcuts || {};
  const [recording, setRecording] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [restore, setRestore] = useState(null);
  const anyChanged = SHORTCUTS.some((shortcut) => !isShortcutDefault(overrides, shortcut));

  const apply = (id, accelerator, conflictId = null) => {
    saveShortcuts(assignShortcut(overrides, SHORTCUTS, id, accelerator, conflictId), flagKey(id));
  };

  useEffect(() => {
    if (!restore || recording) return;
    setRestore(null);
    if (conflict) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector(`.st-change[data-shortcut="${restore}"]`)?.focus();
  }, [restore, recording, conflict]);

  const onResult = (id) => (action) => {
    setRecording(null);
    if (action.via === 'key') setRestore(id);
    if (action.type === 'cancel') return;
    if (action.type === 'clear') {
      apply(id, '');
      return;
    }
    const other = findConflict(overrides, id, action.accelerator);
    if (other) {
      setConflict({ id, accelerator: action.accelerator, other });
      return;
    }
    apply(id, action.accelerator);
  };

  const resetAll = () => {
    setConflict(null);
    reset(['shortcuts']);
  };

  return (
    <SettingsCard
      id="shortcuts"
      title={t.settings.sections.shortcuts}
      icon={Keyboard}
      sectionRef={sectionRef}
      actions={
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!anyChanged} onClick={resetAll}>
          {k.resetAll}
        </Button>
      }
    >
      <div className="st-note">{k.hint}</div>
      {GROUPS.map((group) => (
        <Fragment key={group.id}>
          <GroupTitle>{k.groups[group.id] || group.id}</GroupTitle>
          {group.items.map((shortcut) => (
            <Fragment key={shortcut.id}>
              <ShortcutRow
                shortcut={shortcut}
                overrides={overrides}
                recording={recording === shortcut.id}
                token={tokens[flagKey(shortcut.id)] || tokens.shortcuts || null}
                failed={failed === flagKey(shortcut.id)}
                onRecord={() => {
                  setConflict(null);
                  setRecording(shortcut.id);
                }}
                onResult={onResult(shortcut.id)}
                onReset={() => {
                  setConflict(null);
                  saveShortcuts(resetShortcut(overrides, shortcut.id), flagKey(shortcut.id));
                }}
              />
              {conflict && conflict.id === shortcut.id && (
                <div
                  className="st-conflict"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.stopPropagation();
                    setConflict(null);
                    setRestore(conflict.id);
                  }}
                >
                  <Notice
                    tone="warning"
                    actions={
                      <>
                        <Button size="sm" variant="ghost" autoFocus onClick={() => setConflict(null)}>
                          {k.keepBoth}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            apply(conflict.id, conflict.accelerator, conflict.other);
                            setConflict(null);
                          }}
                        >
                          {k.replace}
                        </Button>
                      </>
                    }
                  >
                    {k.conflict(formatAccelerator(conflict.accelerator), shortcutLabel(conflict.other))}
                  </Notice>
                </div>
              )}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </SettingsCard>
  );
}
