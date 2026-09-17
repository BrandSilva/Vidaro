import { useId } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Switch } from '../../components/Inputs.jsx';
import { cx } from '../../lib/cx.js';

export function FormRow({ label, hint, error, children }) {
  return (
    <>
      <div className="dl-form-label">{label}</div>
      <div className="dl-form-control">
        {children}
        {(error || hint) && <div className={cx('dl-form-hint', error && 'is-error')}>{error || hint}</div>}
      </div>
    </>
  );
}

function RowText({ label, hint, error, htmlFor }) {
  const Tag = htmlFor ? 'label' : 'div';
  return (
    <Tag htmlFor={htmlFor} className="dl-row-text">
      <span className="dl-row-label ellipsis">{label}</span>
      {(error || hint) && <span className={cx('dl-row-hint ellipsis', error && 'is-error')}>{error || hint}</span>}
    </Tag>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled = false, span = false }) {
  const id = useId();
  return (
    <div className={cx('dl-row', disabled && 'is-disabled', span && 'dl-span-2')}>
      <RowText label={label} hint={hint} htmlFor={id} />
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

export function ControlRow({ label, hint, error, disabled = false, span = false, children }) {
  return (
    <div className={cx('dl-row', disabled && 'is-disabled', span && 'dl-span-2')}>
      <RowText label={label} hint={hint} error={error} />
      <div className="dl-row-control">{children}</div>
    </div>
  );
}

export function InlineSwitch({ label, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <span className={cx('dl-inline-switch', disabled && 'is-disabled')}>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} label={label} />
      <label htmlFor={id} className="dl-inline-switch-label">
        {label}
      </label>
    </span>
  );
}

export function WarningLine({ children }) {
  return (
    <div className="dl-warning">
      <TriangleAlert size={13} />
      <span className="ellipsis">{children}</span>
    </div>
  );
}

export function Group({ title, children }) {
  return (
    <div className="dl-group">
      <div className="dl-group-title">{title}</div>
      <div className="dl-rows">{children}</div>
    </div>
  );
}
