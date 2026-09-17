import { LoaderCircle } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Tooltip } from './Tooltip.jsx';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  busy = false,
  disabled = false,
  tooltip,
  className,
  children,
  type = 'button',
  ...rest
}) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  const button = (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, busy && 'btn-busy', className)}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <LoaderCircle size={iconSize} className="spin" /> : Icon && <Icon size={iconSize} />}
      {children}
      {IconRight && <IconRight size={iconSize} />}
    </button>
  );
  return tooltip ? <Tooltip label={tooltip}>{button}</Tooltip> : button;
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  tone,
  outlined = false,
  side = 'bottom',
  iconSize,
  className,
  type = 'button',
  ...rest
}) {
  const pixels = iconSize || (size === 'sm' ? 15 : 17);
  return (
    <Tooltip label={label} side={side}>
      <button
        type={type}
        aria-label={label}
        className={cx('icon-btn', size === 'sm' && 'is-sm', outlined && 'is-outlined', tone && `tone-${tone}`, className)}
        {...rest}
      >
        <Icon size={pixels} />
      </button>
    </Tooltip>
  );
}
