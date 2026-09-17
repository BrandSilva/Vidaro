import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.js';

const SHOW_DELAY = 450;

function Bubble({ label, rect, side }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let top;
    let left;
    if (side === 'right') {
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.right + 10;
    } else if (side === 'top') {
      top = rect.top - height - 6;
      left = rect.left + rect.width / 2 - width / 2;
      if (top < 4) top = rect.bottom + 6;
    } else {
      top = rect.bottom + 6;
      left = rect.left + rect.width / 2 - width / 2;
      if (top + height > window.innerHeight - 4) top = rect.top - height - 6;
    }
    setPosition({
      left: Math.round(Math.max(6, Math.min(left, window.innerWidth - width - 6))),
      top: Math.round(Math.max(4, Math.min(top, window.innerHeight - height - 4)))
    });
  }, [rect, side]);

  return (
    <div ref={ref} className="tooltip" role="tooltip" style={position}>
      {label}
    </div>
  );
}

export function Tooltip({ label, side = 'bottom', disabled = false, className, children }) {
  const anchor = useRef(null);
  const timer = useRef(0);
  const [rect, setRect] = useState(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setRect(null);
  }, []);

  const show = useCallback(() => {
    if (!label || disabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (anchor.current && anchor.current.isConnected) setRect(anchor.current.getBoundingClientRect());
    }, SHOW_DELAY);
  }, [label, disabled]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(() => {
    if (!rect) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', hide, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', hide, true);
    };
  }, [rect, hide]);

  const onFocus = (event) => {
    if (event.target.matches(':focus-visible')) show();
  };

  return (
    <span
      ref={anchor}
      className={cx('tooltip-anchor', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      onFocus={onFocus}
      onBlur={hide}
    >
      {children}
      {rect && createPortal(<Bubble label={label} rect={rect} side={side} />, document.body)}
    </span>
  );
}
