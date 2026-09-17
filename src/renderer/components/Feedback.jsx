import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { t } from '../strings/index.js';
import { IconButton } from './Button.jsx';

export function Badge({ tone, icon: Icon, children, className }) {
  return (
    <span className={cx('badge', tone && `tone-${tone}`, className)}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone, className, label }) {
  const indeterminate = value === null || value === undefined || !Number.isFinite(value);
  const width = indeterminate ? undefined : `${Math.min(100, Math.max(0, value))}%`;
  return (
    <div
      className={cx('progress', indeterminate && 'is-indeterminate', tone && `tone-${tone}`, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
    >
      <div className="progress-fill" style={width ? { width } : undefined} />
    </div>
  );
}

const NOTICE_ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck };

export function Notice({ tone = 'info', title, children, actions, onDismiss, icon, className }) {
  const Icon = icon || NOTICE_ICONS[tone] || Info;
  return (
    <div className={cx('notice', `tone-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice-icon">
        <Icon size={16} />
      </span>
      <div className="notice-body">
        {title && <div className="notice-title">{title}</div>}
        {children && <div className="notice-text">{children}</div>}
      </div>
      {(actions || onDismiss) && (
        <div className="notice-actions">
          {actions}
          {onDismiss && <IconButton icon={X} size="sm" label={t.common.dismiss} onClick={onDismiss} />}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-icon">
          <Icon size={26} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, radius, className }) {
  return <span className={cx('skeleton', className)} style={{ width, height, borderRadius: radius }} />;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function SavedFlag({ token }) {
  if (!token) return null;
  return (
    <span key={token} className="saved-flag">
      <CircleCheck size={13} />
      {t.common.saved}
    </span>
  );
}
