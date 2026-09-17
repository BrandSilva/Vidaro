import { useEffect, useRef } from 'react';
import { Star } from 'lucide-react';
import { cx } from '../../lib/cx.js';
import { Skeleton } from '../../components/Feedback.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { groupPresets } from '../../components/preset/model.js';
import { t } from '../../strings/index.js';

const p = t.presets;
const SKELETON_ITEMS = 6;

function Item({ preset, selected, isDefault, dirty, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const tags = Array.isArray(preset.tags) ? preset.tags.join(' · ') : '';
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      data-id={preset.id}
      tabIndex={selected ? 0 : -1}
      className={cx('ps-item', selected && 'is-selected')}
      onClick={() => onSelect(preset.id)}
    >
      <span className="ps-item-text">
        <span className="ps-item-name ellipsis">{preset.name}</span>
        <span className="ps-item-tags ellipsis num">{tags}</span>
      </span>
      <span className="ps-item-marks">
        {dirty && <span className="ps-dot" aria-label={p.unsaved} />}
        {isDefault && (
          <Tooltip label={p.isDefault} side="top">
            <Star size={14} className="ps-star" fill="currentColor" aria-label={p.isDefault} />
          </Tooltip>
        )}
      </span>
    </button>
  );
}

function Group({ title, items, selectedId, defaultId, drafts, onSelect, empty }) {
  return (
    <div className="ps-group" role="group" aria-label={title}>
      <div className="ps-group-title">
        <span>{title}</span>
        <span className="ps-group-count num">{items.length}</span>
      </div>
      {items.length === 0 && empty ? <div className="ps-group-empty">{empty}</div> : null}
      {items.map((preset) => (
        <Item
          key={preset.id}
          preset={preset}
          selected={preset.id === selectedId}
          isDefault={preset.id === defaultId}
          dirty={Boolean(drafts[preset.id])}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function PresetList({ list, loaded, selectedId, defaultId, drafts, onSelect, onRename, onDelete }) {
  const { builtIn, user } = groupPresets(list);
  const ordered = [...builtIn, ...user];

  const onKeyDown = (event) => {
    const index = ordered.findIndex((preset) => preset.id === selectedId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        onSelect(next.id);
        event.currentTarget.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? ordered[0] : ordered[ordered.length - 1];
      if (next) {
        onSelect(next.id);
        event.currentTarget.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
      }
      return;
    }
    const current = ordered[index];
    if (!current || current.builtIn) return;
    if (event.key === 'F2') {
      event.preventDefault();
      onRename();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete();
    }
  };

  if (!loaded) {
    return (
      <div className="ps-list">
        {Array.from({ length: SKELETON_ITEMS }, (_, index) => (
          <Skeleton key={index} height={50} radius={8} />
        ))}
      </div>
    );
  }

  return (
    <div className="ps-list" role="listbox" aria-label={p.title} onKeyDown={onKeyDown}>
      <Group title={p.groupBuiltIn} items={builtIn} selectedId={selectedId} defaultId={defaultId} drafts={drafts} onSelect={onSelect} />
      <Group
        title={p.groupUser}
        items={user}
        selectedId={selectedId}
        defaultId={defaultId}
        drafts={drafts}
        onSelect={onSelect}
        empty={p.noUserPresets}
      />
    </div>
  );
}
