import { useId } from 'react';
import { cx } from '../../lib/cx.js';
import { Switch } from '../Inputs.jsx';

export function SwitchField({ label, hint, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <div className={cx('pe-switch', 'field-span', disabled && 'is-disabled')}>
      <label className="pe-switch-text" htmlFor={id}>
        <span className="pe-switch-label">{label}</span>
        {hint && <span className="pe-switch-hint">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  );
}

export function EditorNote({ children, tone }) {
  return <div className={cx('pe-note', tone && `tone-${tone}`)}>{children}</div>;
}
