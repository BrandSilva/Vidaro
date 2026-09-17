import { memo, useEffect, useRef, useState } from 'react';
import { ListVideo } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Feedback.jsx';
import { Checkbox } from '../../components/Inputs.jsx';
import { Thumb } from '../../components/Thumb.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { cx } from '../../lib/cx.js';
import { formatDuration } from '../../lib/format.js';
import { openEntryList, toggleEntry } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { entryFlag, isSelectable, windowRange } from './selection.js';

const p = t.download.playlist;
const ROW_HEIGHT = 36;
const VISIBLE_ROWS = 12;
const FLAG_TONES = { upcoming: 'warning', live: 'danger', private: 'warning', members: 'warning', login: 'warning' };

const EntryRow = memo(function EntryRow({ entry, top, selected, shiftRef }) {
  const selectable = isSelectable(entry);
  const flag = entryFlag(entry);
  const toggle = (shift) => {
    if (selectable) toggleEntry(entry.index, { shift });
  };
  return (
    <div
      role="listitem"
      className={cx('dl-entry', selected && 'is-selected', !selectable && 'is-list')}
      style={{ transform: `translateY(${top}px)` }}
      onMouseDownCapture={(event) => {
        shiftRef.current = event.shiftKey;
      }}
      onKeyDownCapture={(event) => {
        shiftRef.current = event.shiftKey;
      }}
      onClick={(event) => toggle(event.shiftKey)}
    >
      <span className="dl-entry-check">
        {selectable ? (
          <Checkbox checked={selected} label={entry.title} onChange={() => toggle(shiftRef.current)} />
        ) : (
          <ListVideo size={15} />
        )}
      </span>
      <span className="dl-entry-index num">{entry.index}</span>
      <Thumb src={entry.thumbnail} width={32} height={18} iconSize={11} />
      <Tooltip label={entry.title} className="dl-entry-title">
        <span className="ellipsis">{entry.title}</span>
      </Tooltip>
      {flag && flag !== 'list' && (
        <Tooltip label={p.flagHints[flag]}>
          <Badge tone={FLAG_TONES[flag]}>{p.flags[flag]}</Badge>
        </Tooltip>
      )}
      <span className="dl-entry-end">
        {selectable ? (
          <span className="dl-entry-duration num">{Number.isFinite(entry.duration) ? formatDuration(entry.duration) : ''}</span>
        ) : (
          <Button
            size="sm"
            tooltip={p.openHint}
            onClick={(event) => {
              event.stopPropagation();
              openEntryList(entry);
            }}
          >
            {p.open}
          </Button>
        )}
      </span>
    </div>
  );
});

export function EntryList({ entries, selection }) {
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef(0);
  const shiftRef = useRef(false);
  const viewport = Math.min(entries.length, VISIBLE_ROWS) * ROW_HEIGHT;
  const { start, end } = windowRange(scrollTop, viewport, ROW_HEIGHT, entries.length);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = (event) => {
    const value = event.currentTarget.scrollTop;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(value));
  };

  if (entries.length === 0) return <div className="dl-entries-empty">{p.empty}</div>;

  return (
    <div className="dl-entries" style={{ height: viewport + 2 }} onScroll={onScroll} role="list" aria-label={p.listLabel}>
      <div className="dl-entries-canvas" style={{ height: entries.length * ROW_HEIGHT }}>
        {entries.slice(start, end).map((entry, offset) => (
          <EntryRow
            key={entry.index}
            entry={entry}
            top={(start + offset) * ROW_HEIGHT}
            selected={selection.has(entry.index)}
            shiftRef={shiftRef}
          />
        ))}
      </div>
    </div>
  );
}
