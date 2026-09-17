import { useCallback } from 'react';
import { cx } from '../../lib/cx.js';
import { Skeleton } from '../Feedback.jsx';
import { useSettings } from '../../state/settings.js';
import { detectEncoders, useEncoderDetecting, useEncoders, useEnsurePresets, usePresetSchema } from '../../state/presets.js';
import { changePreset, sectionSummaries } from './model.js';
import { FormatSection } from './FormatSection.jsx';
import { VideoSection } from './VideoSection.jsx';
import { PictureSection } from './PictureSection.jsx';
import { AudioSection } from './AudioSection.jsx';
import './preset-editor.css';

const SECTION_COUNT = 4;

function selectHardware(settings) {
  return settings?.convert?.hardware || 'auto';
}

export function EditorSkeleton() {
  return (
    <div className="pe">
      {Array.from({ length: SECTION_COUNT }, (_, index) => (
        <Skeleton key={index} height={48} radius={12} />
      ))}
    </div>
  );
}

export function PresetEditor({ preset, onChange, readOnly = false, encoders, media = null, storagePrefix = 'pe', openSections = {} }) {
  useEnsurePresets();
  const schema = usePresetSchema();
  const storedEncoders = useEncoders();
  const detecting = useEncoderDetecting();
  const hardware = useSettings(selectHardware);
  const view = encoders === undefined ? storedEncoders : encoders;

  const set = useCallback(
    (path) => (value) => {
      if (readOnly || !preset || !schema) return;
      const next = changePreset(preset, path, value, schema);
      if (next !== preset) onChange(next);
    },
    [preset, schema, readOnly, onChange]
  );

  const replace = useCallback(
    (next) => {
      if (!readOnly && next !== preset) onChange(next);
    },
    [preset, readOnly, onChange]
  );

  if (!preset || !schema) return <EditorSkeleton />;

  const summaries = sectionSummaries(preset, schema, view);
  const common = { preset, schema, readOnly, set };
  const key = (name) => `${storagePrefix}-${name}`;

  return (
    <div className={cx('pe', readOnly && 'is-readonly')}>
      <FormatSection {...common} summary={summaries.format} onChange={replace} storageKey={key('format')} defaultOpen={Boolean(openSections.format)} />
      <VideoSection
        {...common}
        summary={summaries.video}
        encoders={view}
        detecting={detecting}
        hardware={hardware}
        onDetect={detectEncoders}
        storageKey={key('video')}
        defaultOpen={Boolean(openSections.video)}
      />
      <PictureSection {...common} summary={summaries.picture} media={media} storageKey={key('picture')} defaultOpen={Boolean(openSections.picture)} />
      <AudioSection {...common} summary={summaries.audio} storageKey={key('audio')} defaultOpen={Boolean(openSections.audio)} />
    </div>
  );
}
