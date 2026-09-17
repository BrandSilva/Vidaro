import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.js';
import { Button } from './Button.jsx';
import { Kbd } from './Feedback.jsx';
import { t } from '../strings/index.js';
import { setModalOpen } from '../lib/shortcuts.js';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, title, text, children, actions = [], onCancel, stacked = false, showKeyHints = true, width }) {
  const ref = useRef(null);
  const titleId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const root = ref.current;
    setModalOpen(true);
    const initial = root?.querySelector('[data-autofocus="true"]') || root?.querySelector(FOCUSABLE);
    initial?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current?.();
        return;
      }
      if (event.key === 'Tab' && root) {
        const items = [...root.querySelectorAll(FOCUSABLE)];
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement);
        event.preventDefault();
        const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
        items[next].focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...root.querySelectorAll('.dialog-actions button:not([disabled])')];
        const index = items.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
        items[next].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      setModalOpen(false);
      if (previous && typeof previous.focus === 'function' && previous.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} style={width ? { width } : undefined}>
        <div className="dialog-title" id={titleId}>
          {title}
        </div>
        {text && <div className="dialog-text">{text}</div>}
        {children && <div className="dialog-content">{children}</div>}
        <div className={cx('dialog-actions', stacked && 'is-stacked')}>
          {actions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant || 'secondary'}
              icon={action.icon}
              data-autofocus={action.autoFocus ? 'true' : undefined}
              className="dialog-action"
              onClick={action.onSelect}
            >
              {stacked && action.hint ? (
                <span className="dialog-action-text">
                  <span>{action.label}</span>
                  <span className="dialog-action-hint">{action.hint}</span>
                </span>
              ) : (
                action.label
              )}
            </Button>
          ))}
        </div>
        {showKeyHints && (
          <div className="dialog-hint">
            <span>
              <Kbd>Enter</Kbd> {t.app.keyHintConfirm}
            </span>
            <span>
              <Kbd>Esc</Kbd> {t.app.keyHintCancel}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
