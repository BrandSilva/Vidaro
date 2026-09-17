import { useEffect, useMemo } from 'react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { effectiveBindings, formatAccelerator, useShortcut } from '../../lib/shortcuts.js';
import { onInputs } from '../../state/inputs.js';
import { useSettings } from '../../state/settings.js';
import {
  clearClipboardNote,
  computeDraft,
  dismissAdded,
  enqueueDraft,
  fetchLink,
  offerClipboard,
  pasteFromClipboard,
  refreshNames,
  useDownload
} from '../../state/download.js';
import { useEnsurePresets, usePresets } from '../../state/presets.js';
import { t } from '../../strings/index.js';
import { LinkBar } from './LinkBar.jsx';
import { AddedNotice, FetchError, FetchingCard, IdleHint } from './FetchStates.jsx';
import { VideoCard, VideoNotices } from './VideoCard.jsx';
import { PlaylistCard } from './PlaylistCard.jsx';
import { OptionsCard } from './OptionsCard.jsx';
import { MoreOptions } from './MoreOptions.jsx';
import { AfterDownload } from './AfterDownload.jsx';
import { DownloadFooter } from './DownloadFooter.jsx';
import { compatibleApplies, estimateBytes, looksLikeList } from './model.js';
import { nameBasis } from './requests.js';
import { summaryText } from './labels.js';
import './download.css';

const d = t.download;
const ADDED_MS = 8000;
const CLIPBOARD_NOTE_MS = 3000;

function selectDownloadSettings(settings) {
  return settings?.download;
}

function selectChipEnabled(settings) {
  return settings?.general?.clipboardChip !== false;
}

function selectShortcuts(settings) {
  return settings?.shortcuts;
}

function selectPresets(state) {
  return state.list;
}

function selectPresetsLoaded(state) {
  return state.loaded;
}

function useExternalLinks(chipEnabled) {
  useEffect(
    () =>
      onInputs('urls', (payload) => {
        const url = payload?.urls?.[0];
        if (url) fetchLink(url);
      }),
    []
  );

  useEffect(() => {
    if (!chipEnabled) return undefined;
    const onFocus = () => offerClipboard(true);
    offerClipboard(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [chipEnabled]);
}

function useTimedFlag(token, clear, ms) {
  useEffect(() => {
    if (!token) return undefined;
    const timer = setTimeout(clear, ms);
    return () => clearTimeout(timer);
  }, [token, clear, ms]);
}

export function DownloadPage() {
  const state = useDownload();
  const download = useSettings(selectDownloadSettings);
  const chipEnabled = useSettings(selectChipEnabled);
  const shortcuts = useSettings(selectShortcuts);
  const presets = usePresets(selectPresets);
  const presetsLoaded = usePresets(selectPresetsLoaded);

  useEnsurePresets();
  useExternalLinks(chipEnabled);
  useTimedFlag(state.added?.token, dismissAdded, ADDED_MS);
  useTimedFlag(state.clipboardNote, clearClipboardNote, CLIPBOARD_NOTE_MS);

  const draft = useMemo(() => computeDraft(state, download, presets), [state, download, presets]);
  const { options, kind } = draft;
  const info = state.status === 'ready' ? state.info : null;
  const basis = info ? nameBasis(info, options) : '';

  useEffect(() => {
    if (basis) refreshNames();
  }, [basis]);

  const keys = useMemo(() => {
    const bindings = effectiveBindings(shortcuts || {});
    return { paste: formatAccelerator(bindings.get('paste')), start: formatAccelerator(bindings.get('start')) };
  }, [shortcuts]);

  const canStart = kind !== null && draft.issues.length === 0 && !state.enqueueing;

  useShortcut('paste', () => {
    pasteFromClipboard();
  });

  useShortcut('start', () => {
    if (!canStart) return false;
    enqueueDraft({ start: true });
    return undefined;
  });

  const summary = useMemo(() => {
    if (!info) return '';
    const compatible = compatibleApplies(options) && options.compatible !== false;
    const estimate = estimateBytes(info, { mode: draft.mode, quality: draft.quality, section: draft.section, compatible });
    return summaryText(options, { kind, count: draft.count, estimate, section: draft.section, preset: draft.preset });
  }, [info, options, kind, draft]);

  if (!download) return null;

  return (
    <div className="page dl-page">
      <PageHeader title={d.title} subtitle={d.subtitle} />
      <div className="page-body dl-body">
        <LinkBar
          url={state.url}
          linkInvalid={state.linkInvalid}
          clipboardNote={state.clipboardNote}
          chip={chipEnabled ? state.chip : null}
          pasteKeys={keys.paste}
        />
        {state.added && <AddedNotice added={state.added} />}
        {state.status === 'idle' && !state.added && <IdleHint pasteKeys={keys.paste} />}
        {state.status === 'fetching' && <FetchingCard playlist={Boolean(state.request?.playlist) || looksLikeList(state.request?.url)} />}
        {state.status === 'error' && <FetchError error={state.error} updating={state.updating} updateNote={state.updateNote} />}
        {info && kind === 'video' && (
          <>
            <VideoCard
              info={info}
              fileName={state.fileName}
              nameEdited={state.nameEdited}
              preview={state.preview}
              options={options}
              extension={draft.extension}
            />
            <VideoNotices info={info} options={options} />
          </>
        )}
        {info && kind === 'playlist' && (
          <PlaylistCard
            key={`${info.id ?? ''}|${info.url ?? ''}`}
            info={info}
            options={options}
            preview={state.preview}
            extension={draft.extension}
            selection={state.selection}
            rangeText={state.rangeText}
            rangeError={state.rangeError}
          />
        )}
        {info && (
          <>
            <OptionsCard options={options} info={info} folder={download.folder} />
            <MoreOptions
              options={options}
              kind={kind}
              draft={{ sectionStart: state.sectionStart, sectionEnd: state.sectionEnd, sectionError: draft.sectionError, section: draft.section }}
              changed={draft.changed.length > 0}
              savedToken={state.savedToken}
            />
            <AfterDownload
              options={options}
              preset={draft.preset}
              presetIssue={draft.presetIssue}
              presets={presets}
              presetsLoaded={presetsLoaded}
            />
          </>
        )}
      </div>
      <DownloadFooter
        status={state.status}
        summary={summary}
        issue={draft.issues[0] ?? null}
        enqueueError={state.enqueueError}
        enqueueing={state.enqueueing}
        startKeys={keys.start}
      />
    </div>
  );
}
