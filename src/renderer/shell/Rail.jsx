import { ArrowDownToLine, Repeat2, ListVideo, SlidersHorizontal, Settings } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Tooltip } from '../components/Tooltip.jsx';
import { navigate, useApp } from '../state/app.js';
import { t } from '../strings/index.js';

const MAIN_ITEMS = [
  { id: 'download', icon: ArrowDownToLine },
  { id: 'convert', icon: Repeat2 },
  { id: 'queue', icon: ListVideo },
  { id: 'presets', icon: SlidersHorizontal }
];

function RailItem({ id, icon: Icon, compact, badge }) {
  const active = useApp((state) => state.page === id);
  const label = t.nav[id];
  const button = (
    <button
      type="button"
      className={cx('rail-item', active && 'is-active')}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={() => navigate(id)}
    >
      <Icon size={18} />
      <span className="rail-label">{label}</span>
      {badge > 0 && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
  return compact ? (
    <Tooltip label={label} side="right" className="rail-tooltip">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function Rail({ compact, queueBadge }) {
  return (
    <nav className="rail" aria-label="Main">
      {MAIN_ITEMS.map((item) => (
        <RailItem key={item.id} {...item} compact={compact} badge={item.id === 'queue' ? queueBadge : 0} />
      ))}
      <div className="rail-spacer" />
      <RailItem id="settings" icon={Settings} compact={compact} />
    </nav>
  );
}
