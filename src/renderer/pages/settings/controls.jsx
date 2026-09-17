import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { IconButton } from '../../components/Button.jsx';
import { SavedFlag } from '../../components/Feedback.jsx';
import { NumberInput, Segmented, Select, Switch, TextInput } from '../../components/Inputs.jsx';
import { Card, SettingRow } from '../../components/Section.jsx';
import { cx } from '../../lib/cx.js';
import { t } from '../../strings/index.js';
import { useSettingsContext } from './hooks.js';
import { differsFromDefault, valueAt } from './model.js';

const s = t.settings;

export function SettingsCard({ id, title, icon, actions, sectionRef, children }) {
  return (
    <div className="st-card" data-section={id} id={`settings-${id}`} ref={sectionRef}>
      <Card title={title} icon={icon} actions={actions}>
        {children}
      </Card>
    </div>
  );
}

export function GroupTitle({ children }) {
  return <div className="st-group">{children}</div>;
}

export function RowLabel({ text, token, failed }) {
  return (
    <span className="st-label">
      <span className="ellipsis">{text}</span>
      {failed ? <span className="st-failed">{s.saveFailed}</span> : <SavedFlag token={token} />}
    </span>
  );
}

export function Row({ keys = [], label, hint, error, children, disabled = false, compact = false, flagKey }) {
  const { settings, defaults, tokens, failed, reset } = useSettingsContext();
  const markKey = flagKey || keys[0];
  const token = keys.reduce((latest, key) => Math.max(latest, tokens[key] || 0), flagKey ? tokens[flagKey] || 0 : 0);
  const showReset = keys.length > 0 && differsFromDefault(settings, defaults, keys);
  const hintNode = error ? <span className="st-error">{error}</span> : hint;
  return (
    <div className={cx('st-row', disabled && 'is-disabled', compact && 'is-compact')}>
      <SettingRow
        label={<RowLabel text={label} token={token || null} failed={markKey && failed === markKey} />}
        hint={hintNode}
        reset={showReset ? <IconButton icon={RotateCcw} size="sm" iconSize={14} label={s.resetRow} onClick={() => reset(keys)} /> : null}
      >
        {children}
      </SettingRow>
    </div>
  );
}

export function InfoRow({ label, hint, children }) {
  return (
    <div className="st-row is-info">
      <SettingRow label={<RowLabel text={label} />} hint={hint}>
        {children}
      </SettingRow>
    </div>
  );
}

export function useValue(key) {
  const { settings } = useSettingsContext();
  return valueAt(settings, key);
}

export function SwitchRow({ path, label, hint, disabled = false }) {
  const { save } = useSettingsContext();
  const value = useValue(path);
  return (
    <Row keys={[path]} label={label} hint={hint} disabled={disabled}>
      <Switch checked={Boolean(value)} label={label} disabled={disabled} onChange={(next) => save(path, next)} />
    </Row>
  );
}

export function SegmentedRow({ path, label, hint, options, disabled = false, size = 'md' }) {
  const { save } = useSettingsContext();
  const value = useValue(path);
  return (
    <Row keys={[path]} label={label} hint={hint} disabled={disabled}>
      <Segmented value={value} options={options} size={size} label={label} disabled={disabled} onChange={(next) => save(path, next)} />
    </Row>
  );
}

export function SelectRow({ path, label, hint, options, width = 220, disabled = false }) {
  const { save } = useSettingsContext();
  const value = useValue(path);
  return (
    <Row keys={[path]} label={label} hint={hint} disabled={disabled}>
      <Select value={value} options={options} width={width} label={label} disabled={disabled} onChange={(next) => save(path, next)} />
    </Row>
  );
}

export function NumberRow({ path, label, hint, min, max, suffix, width = 110, disabled = false }) {
  const { save } = useSettingsContext();
  const value = useValue(path);
  return (
    <Row keys={[path]} label={label} hint={hint} disabled={disabled}>
      <NumberInput value={value} min={min} max={max} suffix={suffix} width={width} label={label} disabled={disabled} onChange={(next) => save(path, next)} />
    </Row>
  );
}

export function TextRow({ path, label, hint, validate, invalidText, placeholder, width = 260, disabled = false, mono = false, preview }) {
  const { save } = useSettingsContext();
  const value = useValue(path) ?? '';
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const reverting = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
      setInvalid(false);
    }
  }, [value]);

  const check = (text) => (validate ? validate(text) : { ok: true, value: text });

  const commit = (text) => {
    if (reverting.current) return;
    const result = check(text);
    if (!result.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(result.value);
    if (result.value !== value) save(path, result.value);
  };

  const onBlur = (event) => {
    commit(event.target.value);
    focused.current = false;
    reverting.current = false;
  };

  const onKeyDownCapture = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    reverting.current = true;
    setDraft(value);
    setInvalid(false);
    event.currentTarget.blur();
  };

  const liveHint = !invalid && preview ? preview(draft) : null;

  return (
    <Row keys={[path]} label={label} hint={liveHint || hint} error={invalid ? invalidText : null} disabled={disabled}>
      <TextInput
        value={draft}
        width={width}
        invalid={invalid}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        className={mono ? 'st-mono' : undefined}
        onFocus={() => {
          focused.current = true;
          reverting.current = false;
        }}
        onBlur={onBlur}
        onChange={(text) => {
          setDraft(text);
          if (invalid && check(text).ok) setInvalid(false);
        }}
        onCommit={commit}
        onKeyDownCapture={onKeyDownCapture}
      />
    </Row>
  );
}

export function ValueText({ children, tone, className }) {
  return <span className={cx('st-value num', tone && `tone-${tone}`, className)}>{children}</span>;
}
