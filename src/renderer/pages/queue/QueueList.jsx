import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../../lib/cx.js';
import { t } from '../../strings/index.js';
import { CHUNK_SIZE, WINDOW_THRESHOLD, chunkEntries, chunkSignature, estimateHeight, isEntrySelected } from './model.js';
import { JobRow } from './JobRow.jsx';
import { GroupRow } from './GroupRow.jsx';

const ROOT_MARGIN = '720px 0px';
const EAGER_CHUNKS = 2;

const KEY_MOVES = {
  ArrowDown: 1,
  ArrowUp: -1,
  PageDown: 10,
  PageUp: -10,
  Home: 'home',
  End: 'end'
};

function Chunk({ index, entries, rootRef, render }) {
  const ref = useRef(null);
  const measured = useRef({ signature: '', height: 0 });
  const [visible, setVisible] = useState(index < EAGER_CHUNKS);
  const signature = chunkSignature(entries);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (records) => {
        const record = records[records.length - 1];
        if (record) setVisible(record.isIntersecting);
      },
      { root: rootRef.current || null, rootMargin: ROOT_MARGIN }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    const node = ref.current;
    if (!visible || !node) return undefined;
    const save = () => {
      measured.current = { signature, height: node.offsetHeight };
    };
    save();
    const observer = new ResizeObserver(save);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, signature]);

  const height = measured.current.signature === signature ? measured.current.height : estimateHeight(entries);
  return (
    <div ref={ref} className="q-chunk" data-chunk={index}>
      {visible ? entries.map(render) : <div className="q-chunk-space" style={{ height }} />}
    </div>
  );
}

export function QueueList({ entries, selection, childJobs, indicator, handlers, listRef, scrollRef, dragging }) {
  const [keyboard, setKeyboard] = useState(false);
  const windowed = entries.length > WINDOW_THRESHOLD;
  const chunks = useMemo(() => (windowed ? chunkEntries(entries, CHUNK_SIZE) : null), [entries, windowed]);

  const render = (entry) => {
    const selected = isEntrySelected(entry, selection.ids);
    const cursor = selection.cursor === entry.key;
    const dropEdge = indicator && indicator.key === entry.key ? indicator.edge : null;
    if (entry.type === 'group') {
      return <GroupRow key={entry.key} entry={entry} selected={selected} cursor={cursor} dropEdge={dropEdge} handlers={handlers} />;
    }
    return (
      <JobRow
        key={entry.key}
        entry={entry}
        child={childJobs.get(entry.job.id) || null}
        selected={selected}
        cursor={cursor}
        dropEdge={dropEdge}
        handlers={handlers}
      />
    );
  };

  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget || event.altKey) return;
    const move = KEY_MOVES[event.key];
    if (move !== undefined && !event.ctrlKey) {
      event.preventDefault();
      setKeyboard(true);
      handlers.move(move, event.shiftKey);
      return;
    }
    if (event.ctrlKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      setKeyboard(true);
      handlers.activateCursor();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setKeyboard(true);
      handlers.expandCursor(event.key === 'ArrowRight');
    } else if (event.key === 'Escape') {
      if (handlers.clearSelection()) event.preventDefault();
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      setKeyboard(true);
      handlers.cursorMenu();
    }
  };

  return (
    <div
      ref={listRef}
      className={cx('q-list', keyboard && 'is-keyboard', dragging && 'is-dragging')}
      tabIndex={0}
      role="listbox"
      aria-multiselectable="true"
      aria-label={t.queue.listLabel}
      onKeyDown={onKeyDown}
      onMouseDown={() => setKeyboard(false)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) handlers.dragLeave();
      }}
    >
      <div className="q-rows">
        {chunks
          ? chunks.map((chunk, index) => <Chunk key={index} index={index} entries={chunk} rootRef={scrollRef} render={render} />)
          : entries.map(render)}
      </div>
    </div>
  );
}
