import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx.js';

export function Switch({ checked, onChange, disabled = false, label, id }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={Boolean(checked)}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

export function Segmented({ value, options, onChange, size = 'md', block = false, disabled = false, label }) {
  return (
    <div className={cx('segmented', size === 'sm' && 'is-sm', block && 'is-block')} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            className={cx('segmented-item', active && 'is-active')}
            disabled={disabled || option.disabled}
            onClick={() => !active && onChange(option.value)}
          >
            {Icon && <Icon size={size === 'sm' ? 13 : 15} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Select({ value, options, onChange, disabled = false, block = false, size = 'md', width, label, className }) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  return (
    <span className={cx('select', block && 'is-block', size === 'sm' && 'is-sm', className)} style={width ? { width } : undefined}>
      <select
        aria-label={label}
        value={selectedIndex < 0 ? '' : String(selectedIndex)}
        disabled={disabled}
        onChange={(event) => {
          const option = options[Number(event.target.value)];
          if (option) onChange(option.value);
        }}
      >
        {selectedIndex < 0 && <option value="" disabled hidden />}
        {options.map((option, index) => (
          <option key={`${index}-${String(option.value)}`} value={String(index)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="select-chevron" />
    </span>
  );
}

export function TextInput({
  value,
  onChange,
  onCommit,
  onEnter,
  prefix,
  suffix,
  invalid = false,
  disabled = false,
  size = 'md',
  className,
  inputRef,
  width,
  ...rest
}) {
  return (
    <label
      className={cx('input', invalid && 'is-invalid', disabled && 'is-disabled', size !== 'md' && `is-${size}`, className)}
      style={width ? { width } : undefined}
    >
      {prefix && <span className="input-affix">{prefix}</span>}
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={(event) => onCommit?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onCommit?.(event.currentTarget.value);
            onEnter?.(event.currentTarget.value, event);
          }
        }}
        {...rest}
      />
      {suffix && <span className="input-affix">{suffix}</span>}
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, suffix, width = 110, disabled = false, size = 'md', label }) {
  const [text, setText] = useState(String(value ?? ''));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value ?? ''));
  }, [value]);

  const clamp = (raw) => {
    let next = raw;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return step >= 1 ? Math.round(next) : Math.round(next * 1000) / 1000;
  };

  const commit = (raw) => {
    focused.current = false;
    const parsed = Number(String(raw).replace(',', '.'));
    if (String(raw).trim() === '' || !Number.isFinite(parsed)) {
      setText(String(value ?? ''));
      return;
    }
    const next = clamp(parsed);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  const nudge = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const base = Number(String(text).replace(',', '.'));
    const next = clamp((Number.isFinite(base) ? base : Number(value) || 0) + (event.key === 'ArrowUp' ? step : -step));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <TextInput
      value={text}
      width={width}
      size={size}
      suffix={suffix}
      disabled={disabled}
      inputMode="decimal"
      aria-label={label}
      className="num"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={setText}
      onCommit={commit}
      onKeyDownCapture={nudge}
    />
  );
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, format = (v) => v, disabled = false, label }) {
  const ratio = (value - min) / (max - min || 1);
  return (
    <div className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--fill': `${Math.round(ratio * 1000) / 10}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="slider-value">{format(value)}</span>
    </div>
  );
}

export function Chip({ selected = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      className={cx('chip', selected && 'is-selected')}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Checkbox({ checked, indeterminate = false, onChange, label, disabled = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox"
      aria-label={label}
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked, event)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
