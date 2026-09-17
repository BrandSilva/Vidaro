import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx.js';

const memory = new Map();

function readOpen(key, fallback) {
  if (!key) return fallback;
  if (memory.has(key)) return memory.get(key);
  try {
    const stored = window.localStorage.getItem(`section:${key}`);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function writeOpen(key, open) {
  if (!key) return;
  memory.set(key, open);
  try {
    window.localStorage.setItem(`section:${key}`, open ? '1' : '0');
  } catch {
    memory.set(key, open);
  }
}

export function Section({ title, icon: Icon, summary, defaultOpen = false, storageKey, actions, children, className }) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const bodyId = useId();
  const toggle = () => {
    setOpen((value) => {
      writeOpen(storageKey, !value);
      return !value;
    });
  };
  return (
    <section className={cx('section', open && 'is-open', className)}>
      <div className="row" style={{ paddingRight: actions ? 10 : 0 }}>
        <button type="button" className="section-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {Icon && (
            <span className="section-icon">
              <Icon size={16} />
            </span>
          )}
          <span className="section-title">{title}</span>
          <span className="section-summary">{summary}</span>
          <span className="section-chevron">
            <ChevronDown size={16} />
          </span>
        </button>
        {actions}
      </div>
      {open && (
        <div className="section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Card({ title, icon: Icon, actions, children, className }) {
  return (
    <section className={cx('section section-static', className)}>
      {title && (
        <div className="section-head" style={{ cursor: 'default' }}>
          {Icon && (
            <span className="section-icon">
              <Icon size={16} />
            </span>
          )}
          <span className="section-title">{title}</span>
          <span className="grow" />
          {actions}
        </div>
      )}
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, span = false, trailing }) {
  return (
    <div className={cx('field', span && 'field-span')}>
      {label && (
        <div className="field-label">
          <span className="ellipsis">{label}</span>
          {trailing && <span className="grow" />}
          {trailing}
        </div>
      )}
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function SettingRow({ label, hint, children, reset }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
      <div className="setting-reset">{reset}</div>
    </div>
  );
}
