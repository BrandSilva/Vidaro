import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.js';
import { setModalOpen } from '../lib/shortcuts.js';

export function Menu({ open, anchor, point, items, onClose, align = 'end' }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const node = ref.current;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left;
    let top;
    if (point) {
      left = point.x;
      top = point.y;
    } else if (anchor) {
      const rect = anchor.getBoundingClientRect();
      left = align === 'end' ? rect.right - width : rect.left;
      top = rect.bottom + 4;
      if (top + height > window.innerHeight - 6) top = rect.top - height - 4;
    } else {
      left = 0;
      top = 0;
    }
    setPosition({
      left: Math.round(Math.max(6, Math.min(left, window.innerWidth - width - 6))),
      top: Math.round(Math.max(6, Math.min(top, window.innerHeight - height - 6)))
    });
  }, [open, anchor, point, align, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    setModalOpen(true);
    const node = ref.current;
    node?.querySelector('.menu-item:not([disabled])')?.focus({ preventScroll: true });
    const close = () => closeRef.current?.();
    const onPointer = (event) => {
      if (node && !node.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const list = [...node.querySelectorAll('.menu-item:not([disabled])')];
        const index = list.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
        list[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      setModalOpen(false);
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="menu" role="menu" ref={ref} style={position}>
      {items.map((item, index) => {
        if (item.separator) return <div key={`sep-${index}`} className="menu-separator" />;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cx('menu-item', item.tone && `tone-${item.tone}`)}
            disabled={item.disabled}
            onClick={() => {
              closeRef.current?.();
              item.onSelect();
            }}
          >
            {Icon ? <Icon size={15} /> : <span style={{ width: 15 }} />}
            <span className="ellipsis">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
