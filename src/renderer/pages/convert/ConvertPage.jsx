import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FolderPlus } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { Notice } from '../../components/Feedback.jsx';
import { PresetEditor, EditorSkeleton } from '../../components/preset/PresetEditor.jsx';
import { errorText, presetProblems } from '../../components/preset/model.js';
import { api } from '../../lib/api.js';
import { useShortcut } from '../../lib/shortcuts.js';
import { navigate } from '../../state/app.js';
import { onInputs } from '../../state/inputs.js';
import { useSettings } from '../../state/settings.js';
import { useEncoders, useEnsurePresets, usePresetList, usePresetSchema } from '../../state/presets.js';
import {
  addPaths,
  dismissNotice,
  enqueueFiles,
  flushConvertDraft,
  showNotice,
  syncSelection,
  updateWorking,
  useConvert
} from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { enqueueBlocker, listTotals, planTotals } from './model.js';
import { usePlanPreview } from './usePlanPreview.js';
import { DropArea } from './DropArea.jsx';
import { FileList } from './FileList.jsx';
import { PresetCard } from './PresetCard.jsx';
import { OutputSection } from './OutputSection.jsx';
import { ConvertFooter } from './ConvertFooter.jsx';
import './convert.css';

const c = t.convert;
const NOTICE_MS = 10000;
const OPEN_SECTIONS = {};

const selectFiles = (state) => state.files;
const selectPresetId = (state) => state.presetId;
const selectBase = (state) => state.base;
const selectWorking = (state) => state.working;
const selectModified = (state) => state.modified;
const selectNotice = (state) => state.notice;
const selectAdding = (state) => state.adding > 0;
const selectConvertSettings = (settings) => settings?.convert;

function outputOf(settings) {
  return {
    mode: settings?.outputMode === 'source' ? 'source' : 'folder',
    folder: settings?.folder || '',
    nameTemplate: settings?.nameTemplate || '{name}',
    collision: settings?.collision || 'rename',
    keepDate: settings?.keepDate === true
  };
}

function resultNotice(result) {
  const detail = result.firstError ? [result.firstError.message, result.firstError.hint].filter(Boolean).join(' ') : null;
  if (result.added === 0) {
    const text = result.rejected > 0 ? c.notAdded(result.rejected) : c.enqueueFailed;
    return { tone: 'danger', text, detail, queue: false };
  }
  const text = result.started ? c.started(result.added) : c.added(result.added);
  if (result.rejected > 0) return { tone: 'warning', text: `${text} ${c.notAdded(result.rejected)}`, detail, queue: true };
  return { tone: 'success', text, detail: null, queue: true };
}

function useNoticeTimer(notice) {
  useEffect(() => {
    if (!notice || notice.tone !== 'success') return undefined;
    const timer = setTimeout(() => dismissNotice(notice), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
}

export function ConvertPage() {
  useEnsurePresets();
  const files = useConvert(selectFiles);
  const presetId = useConvert(selectPresetId);
  const base = useConvert(selectBase);
  const working = useConvert(selectWorking);
  const modified = useConvert(selectModified);
  const notice = useConvert(selectNotice);
  const adding = useConvert(selectAdding);
  const list = usePresetList();
  const schema = usePresetSchema();
  const encoders = useEncoders();
  const settings = useSettings(selectConvertSettings);
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(null);

  useEffect(() => {
    syncSelection();
  }, [list, schema, settings?.defaultPreset]);

  useEffect(() => () => flushConvertDraft(), []);

  useEffect(
    () =>
      onInputs('files', (payload) => {
        addPaths(payload.files);
      }),
    []
  );

  useNoticeTimer(notice);

  const output = useMemo(() => outputOf(settings), [settings]);
  const totals = useMemo(() => listTotals(files), [files]);
  const { plans, pending } = usePlanPreview(files, working, encoders, settings?.hardware);
  const estimate = useMemo(() => planTotals(files, plans), [files, plans]);
  const problems = useMemo(() => presetProblems(working), [working]);
  const blocker = working ? enqueueBlocker({ totals, problems, output }) : c.nothingReady;
  const firstReady = useMemo(() => files.find((file) => file.status === 'ready') || null, [files]);
  const firstPlan = firstReady ? plans[firstReady.id] : null;

  const addFiles = useCallback(async () => {
    const paths = await api.dialogs.pickFiles().catch(() => []);
    if (Array.isArray(paths) && paths.length) addPaths(paths);
  }, []);

  const addFolder = useCallback(async () => {
    const folder = await api.dialogs.pickFolder().catch(() => null);
    if (folder) addPaths([folder]);
  }, []);

  const run = useCallback(
    async (start) => {
      if (busyRef.current || blocker) return;
      busyRef.current = start ? 'start' : 'queue';
      setBusy(busyRef.current);
      try {
        flushConvertDraft();
        const result = await enqueueFiles(start);
        if (result) showNotice(resultNotice(result));
      } catch (error) {
        showNotice({ tone: 'danger', text: c.enqueueFailed, detail: errorText(error, null), queue: false });
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [blocker]
  );

  useShortcut('addFiles', () => {
    addFiles();
  });

  useShortcut('start', () => {
    if (blocker || busyRef.current || files.length === 0) return false;
    run(true);
    return true;
  });

  const noticeActions =
    notice && notice.queue ? (
      <Button size="sm" variant="secondary" onClick={() => navigate('queue')}>
        {c.viewQueue}
      </Button>
    ) : null;

  const headerActions = (
    <>
      <Button icon={FolderPlus} onClick={addFolder}>
        {c.addFolder}
      </Button>
      <Button icon={FilePlus2} onClick={addFiles}>
        {c.addFiles}
      </Button>
    </>
  );

  const hasFiles = files.length > 0;

  return (
    <div className="page cv-page">
      <PageHeader title={c.title} subtitle={c.subtitle} actions={headerActions} />
      <div className={hasFiles ? 'page-body cv-body has-files' : 'page-body cv-body'}>
        {notice && (
          <div className="cv-notice">
            <Notice tone={notice.tone} title={notice.detail ? notice.text : undefined} actions={noticeActions} onDismiss={() => dismissNotice()}>
              {notice.detail || notice.text}
            </Notice>
          </div>
        )}
        {hasFiles ? (
          <div className="cv-layout">
            <FileList files={files} plans={plans} totals={totals} />
            <div className="cv-settings">
              {working && schema ? (
                <>
                  <PresetCard
                    list={list}
                    schema={schema}
                    presetId={presetId}
                    base={base}
                    working={working}
                    modified={modified}
                    plan={firstPlan}
                    planPending={pending}
                    estimate={estimate}
                    fileCount={estimate.convertible}
                  />
                  <PresetEditor
                    preset={working}
                    onChange={updateWorking}
                    encoders={encoders}
                    media={firstReady ? firstReady.media : null}
                    storagePrefix="cv"
                    openSections={OPEN_SECTIONS}
                  />
                  <OutputSection output={output} working={working} sample={firstReady} plan={firstPlan} />
                </>
              ) : (
                <EditorSkeleton />
              )}
            </div>
          </div>
        ) : (
          <div className="cv-empty">
            <DropArea busy={adding} onAddFiles={addFiles} onAddFolder={addFolder} />
          </div>
        )}
      </div>
      {hasFiles && <ConvertFooter output={output} blocker={blocker} busy={busy} onQueue={() => run(false)} onStart={() => run(true)} />}
    </div>
  );
}
