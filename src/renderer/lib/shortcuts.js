import { useEffect, useRef } from 'react';

export const SHORTCUTS = [
  { id: 'paste', group: 'download', accelerator: 'Ctrl+V' },
  { id: 'addFiles', group: 'convert', accelerator: 'Ctrl+O' },
  { id: 'start', group: 'general', accelerator: 'Ctrl+Enter' },
  { id: 'toggleJob', group: 'queue', accelerator: 'Space' },
  { id: 'removeJob', group: 'queue', accelerator: 'Delete' },
  { id: 'selectAll', group: 'queue', accelerator: 'Ctrl+A' },
  { id: 'filterQueue', group: 'queue', accelerator: 'Ctrl+F' },
  { id: 'goDownload', group: 'navigation', accelerator: 'Ctrl+1' },
  { id: 'goConvert', group: 'navigation', accelerator: 'Ctrl+2' },
  { id: 'goQueue', group: 'navigation', accelerator: 'Ctrl+3' },
  { id: 'goPresets', group: 'navigation', accelerator: 'Ctrl+4' },
  { id: 'goSettings', group: 'navigation', accelerator: 'Ctrl+5' },
  { id: 'openSettings', group: 'navigation', accelerator: 'Ctrl+,' },
  { id: 'quit', group: 'general', accelerator: 'Ctrl+Q' }
];

const TEXT_EDITING = new Set([
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+Z',
  'Ctrl+Backspace',
  'Ctrl+Delete',
  'Ctrl+ArrowLeft',
  'Ctrl+ArrowRight',
  'Ctrl+Shift+ArrowLeft',
  'Ctrl+Shift+ArrowRight',
  'Ctrl+Home',
  'Ctrl+End'
]);

const NAMED_KEYS = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  '+': 'Plus'
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process']);

const handlers = new Map();
let modalDepth = 0;
let bindings = new Map();

export function setModalOpen(open) {
  modalDepth = Math.max(0, modalDepth + (open ? 1 : -1));
}

export function isModalOpen() {
  return modalDepth > 0;
}

export function keyName(event) {
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad\d$/.test(event.code)) return event.code.slice(6);
  const key = NAMED_KEYS[event.key] || event.key;
  if (MODIFIER_KEYS.has(key)) return null;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function acceleratorFromEvent(event) {
  const key = keyName(event);
  if (!key) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function formatAccelerator(accelerator) {
  return (accelerator || '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
}

export function effectiveBindings(overrides = {}) {
  const map = new Map();
  for (const shortcut of SHORTCUTS) {
    const value = Object.hasOwn(overrides, shortcut.id) ? overrides[shortcut.id] : shortcut.accelerator;
    map.set(shortcut.id, value || '');
  }
  return map;
}

export function findConflict(overrides, id, accelerator) {
  if (!accelerator) return null;
  for (const [otherId, value] of effectiveBindings(overrides)) {
    if (otherId !== id && value === accelerator) return otherId;
  }
  return null;
}

export function setBindings(overrides) {
  bindings = effectiveBindings(overrides);
}

function isTyping(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'range', 'button'].includes(target.type);
}

function isActivatable(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, a, [role="button"], [role="switch"], [role="radio"], [role="checkbox"], input[type="checkbox"]'));
}

export function dispatchKeydown(event) {
  if (event.defaultPrevented || modalDepth > 0 || event.repeat) return;
  const accelerator = acceleratorFromEvent(event);
  if (!accelerator) return;
  const typing = isTyping(event.target);
  if (typing && (!accelerator.includes('Ctrl') || TEXT_EDITING.has(accelerator))) return;
  if (!typing && (accelerator === 'Space' || accelerator === 'Enter') && isActivatable(event.target)) return;
  for (const [id, value] of bindings) {
    if (value !== accelerator) continue;
    const stack = handlers.get(id);
    const handler = stack && stack[stack.length - 1];
    if (!handler) continue;
    const handled = handler.current(event);
    if (handled !== false) {
      event.preventDefault();
      return;
    }
  }
}

export function useShortcut(id, handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const stack = handlers.get(id) || [];
    stack.push(ref);
    handlers.set(id, stack);
    return () => {
      const current = handlers.get(id) || [];
      const index = current.lastIndexOf(ref);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) handlers.delete(id);
    };
  }, [id, enabled]);
}
