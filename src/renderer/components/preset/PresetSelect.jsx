import { ChevronDown } from 'lucide-react';
import { cx } from '../../lib/cx.js';
import { t } from '../../strings/index.js';
import { groupPresets } from './model.js';

const NONE = '';

export function PresetSelect({ value, list, onChange, modified = false, placeholder, noneLabel, disabled = false, block = false, size = 'md', width, label }) {
  const { builtIn, user } = groupPresets(list);
  const current = (list || []).find((preset) => preset.id === value) || null;
  const selected = current ? current.id : NONE;
  const nameOf = (preset) => (preset.id === selected && modified ? `${preset.name} ${t.presets.modified}` : preset.name);
  return (
    <span className={cx('select', block && 'is-block', size === 'sm' && 'is-sm')} style={width ? { width } : undefined}>
      <select
        aria-label={label}
        value={selected}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === NONE ? null : event.target.value)}
      >
        {noneLabel ? (
          <option value={NONE}>{noneLabel}</option>
        ) : (
          !current && (
            <option value={NONE} disabled hidden={!placeholder}>
              {placeholder || ''}
            </option>
          )
        )}
        <optgroup label={t.presets.groupBuiltIn}>
          {builtIn.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {nameOf(preset)}
            </option>
          ))}
        </optgroup>
        {user.length > 0 && (
          <optgroup label={t.presets.groupUser}>
            {user.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {nameOf(preset)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <ChevronDown size={14} className="select-chevron" />
    </span>
  );
}
