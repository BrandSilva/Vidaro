import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { Segmented, TextInput } from '../../components/Inputs.jsx';
import { Kbd } from '../../components/Feedback.jsx';
import { cx } from '../../lib/cx.js';
import { t } from '../../strings/index.js';
import { FILTERS } from './model.js';

const q = t.queue;

export function QueueToolbar({ filter, onFilter, counts, query, onQuery, searchRef, selectedCount, searchKey, onLeaveSearch }) {
  const options = useMemo(
    () =>
      FILTERS.map((id) => ({
        value: id,
        label: (
          <>
            <span>{q.filters[id]}</span>
            <span className={cx('q-filter-count num', id === 'failed' && counts.failed > 0 && 'is-danger')}>{counts[id]}</span>
          </>
        )
      })),
    [counts]
  );

  return (
    <div className="q-toolbar">
      <Segmented value={filter} options={options} onChange={onFilter} label={q.filterLabel} />
      <span className="q-selection num">{selectedCount > 0 ? q.selected(selectedCount) : ''}</span>
      <span className="grow" />
      <TextInput
        className="q-search"
        width={248}
        inputRef={searchRef}
        value={query}
        placeholder={q.searchPlaceholder}
        aria-label={q.searchLabel}
        prefix={<Search size={14} />}
        suffix={
          query ? (
            <button
              type="button"
              className="q-search-clear"
              aria-label={q.clearSearch}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onQuery('')}
            >
              <X size={13} />
            </button>
          ) : (
            searchKey && <Kbd>{searchKey}</Kbd>
          )
        }
        onChange={onQuery}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (query) onQuery('');
            else onLeaveSearch();
          } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
            event.preventDefault();
            onLeaveSearch();
          }
        }}
      />
    </div>
  );
}
