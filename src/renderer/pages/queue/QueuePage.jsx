import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Copy, ExternalLink, FolderOpen, ListVideo, Pause, Play, Repeat2, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { EmptyState, Notice, Skeleton } from '../../components/Feedback.jsx';
import { Menu } from '../../components/Menu.jsx';
import { effectiveBindings, formatAccelerator, useShortcut } from '../../lib/shortcuts.js';
import { navigate } from '../../state/app.js';
import { useQueue } from '../../state/queue.js';
import { useSettings } from '../../state/settings.js';
import { t } from '../../strings/index.js';
import {
  CHUNK_SIZE,
  EMPTY_SELECTION,
  buildEntries,
  bulkPlan,
  canCancel,
  canOpen,
  canPause,
  canResume,
  canRetry,
  childIndex,
  dragIds,
  filterCounts,
  filterJobs,
  forgetMissingGroups,
  isEntrySelected,
  isReady,
  moveCursor,
  needsRemoveConfirm,
  normalizeQuery,
  pruneSelection,
  resolveDrop,
  revealTarget,
  selectAll,
  selectEntry,
  selectedJobs,
  stabilizeJobs,
  stateCounts,
  togglePlan
} from './model.js';
import {
  copyText,
  openJobFile,
  reorderJobs,
  retryWithSoftware,
  revealJob,
  runQueueAction,
  startAll,
  updateYtdlpAndRetry
} from './commands.js';
import { QueueHeader } from './QueueHeader.jsx';
import { QueueToolbar } from './QueueToolbar.jsx';
import { QueueList } from './QueueList.jsx';
import './queue.css';

const q = t.queue;
const DRAG_TYPE = 'application/x-vidaro-jobs';
const NOTICE_MS = 8000;
const SCROLL_ATTEMPTS = 30;
const MENU_OFFSET_X = 72;
const memory = { filter: 'all', collapsed: new Set() };

function selectJobs(state) {
  return state.jobs;
}

function selectLoaded(state) {
  return state.loaded;
}

function selectShortcuts(settings) {
  return settings?.shortcuts;
}

function useStableJobs(jobs) {
  const cache = useRef(null);
  return useMemo(() => {
    const next = stabilizeJobs(cache.current, jobs);
    cache.current = next;
    return next.list;
  }, [jobs]);
}

function orderedIds(jobs, ids) {
  return jobs.filter((job) => ids.has(job.id)).map((job) => job.id);
}

function buildMenu(jobs, bindings, run) {
  if (jobs.length === 0) return [];
  const plan = bulkPlan(jobs);
  const toggle = togglePlan(jobs);
  const toggleKey = formatAccelerator(bindings.get('toggleJob')) || undefined;
  const removeKey = formatAccelerator(bindings.get('removeJob')) || undefined;
  const single = jobs.length === 1 ? jobs[0] : null;
  const resumeLabel = jobs.filter(canResume).every(isReady) ? q.actions.start : q.actions.resume;
  const sections = [
    [
      single && canOpen(single) && { id: 'open', label: q.actions.openFile, icon: ExternalLink, shortcut: 'Enter', onSelect: () => run('open') },
      single &&
        revealTarget(single) && {
          id: 'show',
          label: single.result?.path ? q.actions.showInFolder : q.actions.openFolder,
          icon: FolderOpen,
          onSelect: () => run('show')
        }
    ],
    [
      plan.resume.length > 0 && {
        id: 'resume',
        label: resumeLabel,
        icon: Play,
        shortcut: toggle?.action === 'resume' ? toggleKey : undefined,
        onSelect: () => run('resume')
      },
      plan.pause.length > 0 && {
        id: 'pause',
        label: q.actions.pause,
        icon: Pause,
        shortcut: toggle?.action === 'pause' ? toggleKey : undefined,
        onSelect: () => run('pause')
      },
      plan.retry.length > 0 && { id: 'retry', label: q.actions.retry, icon: RotateCcw, onSelect: () => run('retry') },
      plan.cancel.length > 0 && { id: 'cancel', label: q.actions.cancel, icon: X, onSelect: () => run('cancel') }
    ],
    [
      single?.source && {
        id: 'copy-source',
        label: single.kind === 'download' ? q.actions.copyLink : q.actions.copySource,
        icon: Copy,
        onSelect: () => run('copy-source')
      },
      single?.result?.path && { id: 'copy-output', label: q.actions.copyOutput, icon: Copy, onSelect: () => run('copy-output') }
    ],
    [{ id: 'remove', label: q.actions.remove, icon: Trash2, tone: 'danger', shortcut: removeKey, onSelect: () => run('remove') }]
  ];
  const items = [];
  for (const section of sections) {
    const list = section.filter(Boolean);
    if (list.length === 0) continue;
    if (items.length) items.push({ separator: true });
    items.push(...list);
  }
  return items;
}

function LoadingRows() {
  return (
    <div className="q-list q-list-loading" aria-hidden="true">
      {[62, 48, 56, 40, 52, 44].map((width, index) => (
        <div key={index} className="q-item">
          <div className="q-row-skeleton">
            <Skeleton width={32} height={18} radius={3} />
            <Skeleton width={`${width}%`} height={12} />
            <span className="grow" />
            <Skeleton width={140} height={4} radius={2} />
            <Skeleton width={72} height={20} radius={5} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function QueuePage() {
  const rawJobs = useQueue(selectJobs);
  const loaded = useQueue(selectLoaded);
  const shortcuts = useSettings(selectShortcuts);
  const jobs = useStableJobs(rawJobs);
  const [filter, setFilterState] = useState(memory.filter);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(memory.collapsed);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [indicator, setIndicator] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [menu, setMenu] = useState(null);
  const [notice, setNotice] = useState(null);
  const listRef = useRef(null);
  const scrollRef = useRef(null);
  const searchRef = useRef(null);
  const drag = useRef(null);
  const pendingReveal = useRef(null);
  const noticeTimer = useRef(0);
  const scrollFrame = useRef(0);
  const live = useRef(null);

  const bindings = useMemo(() => effectiveBindings(shortcuts || {}), [shortcuts]);
  const counts = useMemo(() => stateCounts(jobs), [jobs]);
  const tabCounts = useMemo(() => filterCounts(jobs), [jobs]);
  const words = useMemo(() => normalizeQuery(query), [query]);
  const visibleJobs = useMemo(() => filterJobs(jobs, filter, words), [jobs, filter, words]);
  const entries = useMemo(() => buildEntries(visibleJobs, collapsed), [visibleJobs, collapsed]);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
  const visibleIds = useMemo(() => new Set(visibleJobs.map((job) => job.id)), [visibleJobs]);
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const childJobs = useMemo(() => childIndex(jobs), [jobs]);
  const selected = useMemo(() => selectedJobs(visibleJobs, selection.ids), [visibleJobs, selection.ids]);

  useLayoutEffect(() => {
    live.current = { jobs, visibleJobs, entries, byKey, selection, collapsed, jobsById };
  });

  useEffect(() => {
    setSelection((current) => pruneSelection(current, entries, visibleIds));
  }, [entries, visibleIds]);

  useEffect(() => {
    setCollapsed((current) => {
      const next = forgetMissingGroups(current, jobs);
      if (next !== current) memory.collapsed = next;
      return next;
    });
  }, [jobs]);

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      cancelAnimationFrame(scrollFrame.current);
    },
    []
  );

  const setFilter = useCallback((value) => {
    memory.filter = value;
    setFilterState(value);
  }, []);

  const showNotice = useCallback((text) => {
    if (!text) return;
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const scrollToKey = useCallback((key) => {
    cancelAnimationFrame(scrollFrame.current);
    if (key === null || key === undefined) return;
    let attempts = 0;
    const step = () => {
      const list = listRef.current;
      if (!list) return;
      const node = list.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (node) {
        node.scrollIntoView({ block: 'nearest' });
        return;
      }
      const index = (live.current?.entries || []).findIndex((entry) => entry.key === key);
      if (index < 0) return;
      list.querySelector(`[data-chunk="${Math.floor(index / CHUNK_SIZE)}"]`)?.scrollIntoView({ block: 'nearest' });
      attempts += 1;
      if (attempts < SCROLL_ATTEMPTS) scrollFrame.current = requestAnimationFrame(step);
    };
    scrollFrame.current = requestAnimationFrame(step);
  }, []);

  const handlers = useMemo(() => {
    const get = () => live.current;
    const focusList = () => listRef.current?.focus({ preventScroll: true });

    const toggleGroup = (groupId, open) => {
      setCollapsed((current) => {
        const isCollapsed = current.has(groupId);
        const collapse = open === undefined ? !isCollapsed : !open;
        if (collapse === isCollapsed) return current;
        const next = new Set(current);
        if (collapse) next.add(groupId);
        else next.delete(groupId);
        memory.collapsed = next;
        return next;
      });
    };

    const selectKey = (key) => {
      const next = selectEntry(get().selection, get().entries, key);
      setSelection(next);
      scrollToKey(key);
    };

    const requestRemove = (jobs) => {
      if (jobs.length === 0) return;
      const ids = jobs.map((job) => job.id);
      const active = jobs.filter(needsRemoveConfirm).length;
      if (active === 0) runQueueAction('remove', ids);
      else setConfirm({ ids, active });
    };

    const idsWhere = (jobs, predicate) => jobs.filter(predicate).map((job) => job.id);

    const run = (name, jobs) => {
      const first = jobs[0];
      switch (name) {
        case 'start':
        case 'resume':
          return runQueueAction('resume', idsWhere(jobs, canResume));
        case 'pause':
          return runQueueAction('pause', idsWhere(jobs, canPause));
        case 'retry':
          return runQueueAction('retry', idsWhere(jobs, canRetry));
        case 'cancel':
          return runQueueAction('cancel', idsWhere(jobs, canCancel));
        case 'remove':
          return requestRemove(jobs);
        case 'open':
          return first && openJobFile(first).then(showNotice);
        case 'show':
          return first && revealJob(first).then(showNotice);
        case 'copy-source':
          return first && copyText(first.source);
        case 'copy-output':
          return first && copyText(first.result?.path);
        default:
          return null;
      }
    };

    const openMenu = (ids, point) => {
      if (ids.size === 0) return;
      setMenu({ ids: orderedIds(get().jobs, ids), point });
    };

    const endDrag = () => {
      drag.current = null;
      setIndicator(null);
      setDragging(false);
    };

    return {
      run,
      focusList,
      toggleGroup,
      click(key, event) {
        if (event.target instanceof Element && event.target.closest('button, a, .selectable')) return;
        const options = { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
        setSelection((current) => selectEntry(current, get().entries, key, options));
      },
      activate(key, event) {
        if (event.target instanceof Element && event.target.closest('button, a, .selectable')) return;
        const entry = get().byKey.get(key);
        if (!entry) return;
        if (entry.type === 'group') toggleGroup(entry.groupId);
        else if (canOpen(entry.job)) run('open', [entry.job]);
      },
      activateCursor() {
        const entry = get().byKey.get(get().selection.cursor);
        if (!entry) return;
        if (entry.type === 'group') toggleGroup(entry.groupId);
        else if (canOpen(entry.job)) run('open', [entry.job]);
      },
      expandCursor(open) {
        const { byKey, entries, selection } = get();
        const entry = byKey.get(selection.cursor);
        if (!entry) return;
        if (entry.type === 'job') {
          if (!open && entry.groupKey) selectKey(entry.groupKey);
          return;
        }
        if (open && !entry.collapsed) {
          const next = entries[entries.indexOf(entry) + 1];
          if (next && next.groupKey === entry.key) selectKey(next.key);
          return;
        }
        if (open === entry.collapsed) toggleGroup(entry.groupId, open);
      },
      move(step, extend) {
        const next = moveCursor(get().selection, get().entries, step, { extend });
        setSelection(next);
        scrollToKey(next.cursor);
      },
      focusFirst() {
        const { entries, selection } = get();
        if (entries.length === 0) return;
        focusList();
        if (selection.cursor === null) selectKey(entries[0].key);
      },
      clearSelection() {
        if (get().selection.ids.size === 0) return false;
        setSelection((current) => ({ ids: new Set(), anchor: null, cursor: current.cursor }));
        return true;
      },
      contextMenu(key, event) {
        if (event.target instanceof Element && event.target.closest('.selectable')) return;
        event.preventDefault();
        const { entries, selection, byKey } = get();
        const entry = byKey.get(key);
        if (!entry) return;
        const next = isEntrySelected(entry, selection.ids) ? { ...selection, cursor: key } : selectEntry(selection, entries, key);
        setSelection(next);
        openMenu(next.ids, { x: event.clientX, y: event.clientY });
      },
      cursorMenu() {
        const { entries, selection, byKey } = get();
        const key = selection.cursor;
        const entry = byKey.get(key);
        if (!entry) return;
        const next = isEntrySelected(entry, selection.ids) ? selection : selectEntry(selection, entries, key);
        setSelection(next);
        const row = listRef.current?.querySelector(`[data-key="${CSS.escape(key)}"] > .q-row`);
        const rect = row?.getBoundingClientRect();
        openMenu(next.ids, rect ? { x: rect.left + MENU_OFFSET_X, y: rect.bottom } : { x: 0, y: 0 });
      },
      action(name, job) {
        run(name, [job]);
        focusList();
      },
      groupAction(name, entry) {
        if (name === 'retry') run('retry', entry.jobs.filter((job) => job.state === 'failed'));
        else run(name, entry.jobs);
        focusList();
      },
      reveal(id) {
        const { byKey, jobsById, collapsed } = get();
        const job = jobsById.get(id);
        if (!job) return;
        if (byKey.has(id)) {
          selectKey(id);
          focusList();
          return;
        }
        pendingReveal.current = id;
        setFilter('all');
        setQuery('');
        if (job.groupId && collapsed.has(job.groupId)) toggleGroup(job.groupId, true);
      },
      retry(ids) {
        runQueueAction('retry', ids);
      },
      updateAndRetry(ids) {
        updateYtdlpAndRetry(ids);
      },
      softwareRetry(ids) {
        retryWithSoftware(ids);
      },
      openSettings() {
        navigate('settings');
      },
      copy(text) {
        return copyText(text);
      },
      dragStart(id, event) {
        const { jobs, selection } = get();
        const ids = dragIds(jobs, selection.ids, id);
        drag.current = { ids: new Set(ids), beforeId: undefined };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, ids.join(','));
        const row = event.currentTarget.closest('.q-row');
        if (row) event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
        setDragging(true);
      },
      dragOver(entry, event) {
        const active = drag.current;
        if (!active) return;
        event.preventDefault();
        const row = event.currentTarget.querySelector(':scope > .q-row') || event.currentTarget;
        const rect = row.getBoundingClientRect();
        const half = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
        const result = resolveDrop({ jobs: get().jobs, entry, half, moving: active.ids });
        if (!result) {
          event.dataTransfer.dropEffect = 'none';
          active.beforeId = undefined;
          setIndicator(null);
          return;
        }
        event.dataTransfer.dropEffect = 'move';
        active.beforeId = result.beforeId;
        setIndicator((current) =>
          current && current.key === result.indicator.key && current.edge === result.indicator.edge ? current : result.indicator
        );
      },
      drop(event) {
        const active = drag.current;
        if (!active) return;
        event.preventDefault();
        if (active.beforeId !== undefined) reorderJobs(orderedIds(get().jobs, active.ids), active.beforeId);
        endDrag();
      },
      dragEnd() {
        endDrag();
      },
      dragLeave() {
        if (!drag.current) return;
        drag.current.beforeId = undefined;
        setIndicator(null);
      }
    };
  }, [scrollToKey, setFilter, showNotice]);

  useEffect(() => {
    const id = pendingReveal.current;
    if (!id || !byKey.has(id)) return;
    pendingReveal.current = null;
    setSelection((current) => selectEntry(current, entries, id));
    scrollToKey(id);
    listRef.current?.focus({ preventScroll: true });
  }, [entries, byKey, scrollToKey]);

  useShortcut('filterQueue', () => {
    const input = searchRef.current;
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  });
  useShortcut('selectAll', () => {
    if (entries.length === 0) return false;
    setSelection((current) => selectAll(current, entries));
    return true;
  });
  useShortcut('removeJob', () => {
    if (selected.length === 0) return false;
    handlers.run('remove', selected);
    return true;
  });
  useShortcut('toggleJob', () => {
    const plan = togglePlan(selected);
    if (!plan) return false;
    runQueueAction(plan.action, plan.ids);
    return true;
  });
  useShortcut('start', () => {
    if (counts.startable === 0) return false;
    startAll();
    return true;
  });

  const menuJobs = useMemo(
    () => (menu ? menu.ids.map((id) => jobsById.get(id)).filter(Boolean) : []),
    [menu, jobsById]
  );
  const menuItems = useMemo(
    () =>
      buildMenu(menuJobs, bindings, (name) => {
        handlers.run(name, menuJobs);
        handlers.focusList();
      }),
    [menuJobs, bindings, handlers]
  );

  const closeMenu = () => {
    setMenu(null);
    handlers.focusList();
  };
  const closeConfirm = () => setConfirm(null);
  const confirmRemove = () => {
    if (confirm) runQueueAction('remove', confirm.ids);
    setConfirm(null);
  };
  const showAll = () => {
    setFilter('all');
    setQuery('');
  };
  const trimmedQuery = query.trim();

  let content;
  if (!loaded) {
    content = <LoadingRows />;
  } else if (jobs.length === 0) {
    content = (
      <div className="q-empty">
        <EmptyState
          icon={ListVideo}
          title={q.emptyTitle}
          actions={
            <>
              <Button variant="primary" icon={ArrowDownToLine} onClick={() => navigate('download')}>
                {q.emptyDownload}
              </Button>
              <Button icon={Repeat2} onClick={() => navigate('convert')}>
                {q.emptyConvert}
              </Button>
            </>
          }
        >
          {q.emptyText}
        </EmptyState>
      </div>
    );
  } else if (entries.length === 0) {
    content = (
      <div className="q-no-match">
        <span className="ellipsis">{trimmedQuery ? q.noMatchSearch(trimmedQuery) : q.noMatch}</span>
        <Button size="sm" variant="ghost" onClick={showAll}>
          {q.showAll}
        </Button>
      </div>
    );
  } else {
    content = (
      <QueueList
        entries={entries}
        selection={selection}
        childJobs={childJobs}
        indicator={indicator}
        handlers={handlers}
        listRef={listRef}
        scrollRef={scrollRef}
        dragging={dragging}
      />
    );
  }

  return (
    <div className="page q-page">
      <QueueHeader counts={counts} />
      {loaded && jobs.length > 0 && (
        <QueueToolbar
          filter={filter}
          onFilter={setFilter}
          counts={tabCounts}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          selectedCount={selected.length}
          searchKey={formatAccelerator(bindings.get('filterQueue'))}
          onLeaveSearch={handlers.focusFirst}
        />
      )}
      <div
        ref={scrollRef}
        className="page-body q-body"
        onClick={(event) => {
          if (event.target === event.currentTarget) handlers.clearSelection();
        }}
      >
        {notice && (
          <Notice tone="warning" className="q-notice" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
        {content}
      </div>
      <Dialog
        open={Boolean(confirm)}
        title={confirm ? q.removeTitle(confirm.ids.length) : ''}
        text={confirm ? (confirm.ids.length === 1 ? q.removeTextSingle : q.removeText(confirm.active)) : ''}
        onCancel={closeConfirm}
        actions={[
          { id: 'keep', label: q.removeKeep, autoFocus: true, onSelect: closeConfirm },
          { id: 'remove', label: q.removeConfirm, variant: 'danger', icon: Trash2, onSelect: confirmRemove }
        ]}
      />
      <Menu open={menuItems.length > 0} point={menu?.point} items={menuItems} onClose={closeMenu} />
    </div>
  );
}
