import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Import, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { EmptyState, Notice, SavedFlag } from '../../components/Feedback.jsx';
import { EditorSkeleton, PresetEditor } from '../../components/preset/PresetEditor.jsx';
import { errorText, groupPresets, presetProblems, presetTags, sameSettings, settingsOf, stripView } from '../../components/preset/model.js';
import { useShortcut } from '../../lib/shortcuts.js';
import { updateSection, useSettings } from '../../state/settings.js';
import {
  clearDraft,
  duplicatePreset,
  exportPreset,
  importPresets,
  reloadPresets,
  removePreset,
  savePreset,
  setDraft,
  useDrafts,
  useEnsurePresets,
  usePresetList,
  usePresetSchema,
  usePresets
} from '../../state/presets.js';
import { t } from '../../strings/index.js';
import { PresetList } from './PresetList.jsx';
import { PresetHeader } from './PresetHeader.jsx';
import './presets.css';

const p = t.presets;
const NOTICE_MS = 8000;
const FALLBACK_DEFAULT = 'mp4-universal';
const OPEN_SECTIONS = { format: true, video: true };
const memory = { selected: null };

const selectLoaded = (state) => state.loaded;
const selectError = (state) => state.error;
const selectDefault = (settings) => settings?.convert?.defaultPreset || null;

function importNotice({ imported, failed }) {
  if (imported.length === 0 && failed.length === 0) return null;
  const detail = failed.length ? p.importFailed(failed) : null;
  if (imported.length === 0) return { tone: 'danger', text: p.nothingImported, detail };
  return { tone: failed.length ? 'warning' : 'success', text: p.imported(imported.length), detail };
}

export function PresetsPage() {
  useEnsurePresets();
  const loaded = usePresets(selectLoaded);
  const loadError = usePresets(selectError);
  const list = usePresetList();
  const schema = usePresetSchema();
  const drafts = useDrafts();
  const defaultId = useSettings(selectDefault);
  const [selectedId, setSelectedId] = useState(memory.selected);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState(null);
  const [savedToken, setSavedToken] = useState(0);
  const [exportedToken, setExportedToken] = useState(0);
  const [busy, setBusy] = useState(null);

  const ordered = useMemo(() => {
    const { builtIn, user } = groupPresets(list);
    return [...builtIn, ...user];
  }, [list]);
  const selected = useMemo(() => list.find((preset) => preset.id === selectedId) || null, [list, selectedId]);
  const clean = useMemo(() => (selected ? stripView(selected) : null), [selected]);
  const draft = selected ? drafts[selected.id] || null : null;
  const editing = draft || clean;
  const dirty = Boolean(draft);
  const problems = useMemo(() => presetProblems(editing), [editing]);
  const tags = useMemo(() => (draft ? presetTags(draft, schema) : selected?.tags || []), [draft, schema, selected]);

  const select = useCallback((id) => {
    memory.selected = id;
    setSelectedId(id);
    setRenaming(false);
  }, []);

  useEffect(() => {
    if (!loaded || list.length === 0 || selected) return;
    const fallback = list.find((preset) => preset.id === defaultId) || list[0];
    select(fallback.id);
  }, [loaded, list, selected, defaultId, select]);

  useEffect(() => {
    if (!notice || notice.tone !== 'success') return undefined;
    const timer = setTimeout(() => setNotice((current) => (current === notice ? null : current)), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const act = async (name, task) => {
    if (busy) return null;
    setBusy(name);
    try {
      return await task();
    } catch (error) {
      setNotice({ tone: 'danger', text: p.actionFailed, detail: errorText(error, null) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onChange = useCallback(
    (next) => {
      if (!selected || selected.builtIn) return;
      if (sameSettings(next, selected)) clearDraft(selected.id);
      else setDraft(selected.id, next);
    },
    [selected]
  );

  const save = () =>
    act('save', async () => {
      if (!selected || !draft) return;
      const saved = await savePreset({ ...settingsOf(draft), id: selected.id, name: selected.name, description: selected.description });
      clearDraft(saved.id);
      setSavedToken(Date.now());
    });

  const discard = () => {
    if (selected) clearDraft(selected.id);
  };

  const duplicate = () =>
    act('duplicate', async () => {
      if (!selected) return;
      const copy = draft
        ? await savePreset({ ...settingsOf(draft), id: null, name: selected.name, description: selected.description })
        : await duplicatePreset(selected.id);
      select(copy.id);
      setRenaming(true);
    });

  const exportSelected = () =>
    act('export', async () => {
      if (selected && (await exportPreset(selected.id))) setExportedToken(Date.now());
    });

  const importFiles = () =>
    act('import', async () => {
      const result = await importPresets();
      const next = importNotice(result);
      if (next) setNotice(next);
      if (result.imported[0]) select(result.imported[0].id);
    });

  const remove = () =>
    act('delete', async () => {
      setConfirmDelete(false);
      if (!selected || selected.builtIn) return;
      const removedId = selected.id;
      const index = ordered.findIndex((preset) => preset.id === removedId);
      await removePreset(removedId);
      if (defaultId === removedId) updateSection('convert', { defaultPreset: FALLBACK_DEFAULT }).catch(() => null);
      const remaining = ordered.filter((preset) => preset.id !== removedId);
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) select(next.id);
    });

  const setDefault = () => {
    if (selected) updateSection('convert', { defaultPreset: selected.id }).catch(() => null);
  };

  const askDelete = () => {
    if (selected && !selected.builtIn && !busy) setConfirmDelete(true);
  };

  const startRename = () => {
    if (selected && !selected.builtIn) setRenaming(true);
  };

  useShortcut('start', () => {
    if (!dirty || problems.length > 0 || busy || confirmDelete) return false;
    save();
    return true;
  });

  const headerActions = (
    <Button icon={Import} busy={busy === 'import'} disabled={Boolean(busy) && busy !== 'import'} onClick={importFiles}>
      {p.importPresets}
    </Button>
  );

  let detail;
  if (selected && editing) {
    detail = (
      <>
        <PresetHeader
          preset={selected}
          tags={tags}
          isDefault={selected.id === defaultId}
          renaming={renaming}
          exportedToken={exportedToken}
          busy={Boolean(busy)}
          onRenameStart={startRename}
          onRenameEnd={() => setRenaming(false)}
          onDuplicate={duplicate}
          onExport={exportSelected}
          onDelete={askDelete}
          onSetDefault={setDefault}
        />
        {selected.builtIn && <Notice tone="info">{p.readOnly}</Notice>}
        <PresetEditor preset={editing} onChange={onChange} readOnly={selected.builtIn} storagePrefix="ps" openSections={OPEN_SECTIONS} />
      </>
    );
  } else if (loaded && !loadError) {
    detail = <EmptyState icon={SlidersHorizontal} title={p.noSelection} />;
  } else {
    detail = <EditorSkeleton />;
  }

  return (
    <div className="page ps-page">
      <PageHeader title={p.title} subtitle={p.subtitle} actions={headerActions} />
      <div className="page-body ps-body">
        {(notice || loadError) && (
          <div className="ps-notices">
            {loadError && (
              <Notice
                tone="danger"
                actions={
                  <Button size="sm" onClick={reloadPresets}>
                    {t.common.retry}
                  </Button>
                }
              >
                {loadError}
              </Notice>
            )}
            {notice && (
              <Notice tone={notice.tone} title={notice.detail ? notice.text : undefined} onDismiss={() => setNotice(null)}>
                {notice.detail || notice.text}
              </Notice>
            )}
          </div>
        )}
        <div className="ps-layout">
          <PresetList
            list={list}
            loaded={loaded}
            selectedId={selected ? selected.id : null}
            defaultId={defaultId}
            drafts={drafts}
            onSelect={select}
            onRename={startRename}
            onDelete={askDelete}
          />
          <div className="ps-detail">{detail}</div>
        </div>
      </div>
      {selected && (
        <div className="page-footer ps-footer">
          <div className="page-footer-info ps-footer-info">
            {!selected.builtIn &&
              (dirty ? (
                <span className="ps-unsaved">
                  <span className="ps-dot" />
                  {p.unsaved}
                </span>
              ) : (
                <SavedFlag token={savedToken} />
              ))}
          </div>
          {selected.builtIn ? (
            <Button variant="primary" icon={Copy} busy={busy === 'duplicate'} disabled={Boolean(busy)} onClick={duplicate}>
              {p.duplicateToEdit}
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={!dirty || Boolean(busy)} onClick={discard}>
                {p.discard}
              </Button>
              <Button variant="primary" icon={Save} busy={busy === 'save'} disabled={!dirty || problems.length > 0 || Boolean(busy)} onClick={save}>
                {p.save}
              </Button>
            </>
          )}
        </div>
      )}
      <Dialog
        open={confirmDelete && Boolean(selected)}
        title={selected ? p.deleteTitle(selected.name) : ''}
        text={p.deleteText}
        onCancel={() => setConfirmDelete(false)}
        actions={[
          { id: 'cancel', label: t.common.cancel, autoFocus: true, onSelect: () => setConfirmDelete(false) },
          { id: 'delete', label: p.deleteConfirm, variant: 'danger', icon: Trash2, onSelect: remove }
        ]}
      />
    </div>
  );
}
