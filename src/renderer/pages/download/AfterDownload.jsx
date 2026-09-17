import { Repeat2 } from 'lucide-react';
import { Notice } from '../../components/Feedback.jsx';
import { PresetSelect } from '../../components/preset/PresetSelect.jsx';
import { Section } from '../../components/Section.jsx';
import { setOption } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { ControlRow, ToggleRow } from './parts.jsx';

const a = t.download.after;

export function AfterDownload({ options, preset, presetIssue, presets, presetsLoaded }) {
  const missing = presetsLoaded && Boolean(options.afterPreset) && !preset;
  const keep = options.keepOriginalAfterConvert !== false;
  return (
    <Section
      title={a.title}
      icon={Repeat2}
      summary={preset ? a.summary(preset.name) : a.off}
      storageKey="download-after"
      className="dl-after"
    >
      <div className="dl-rows dl-after-rows">
        <ControlRow label={a.preset} hint={a.presetHint} error={missing ? a.missing : null}>
          <PresetSelect
            width={180}
            value={preset ? preset.id : null}
            list={presets}
            noneLabel={a.none}
            label={a.preset}
            onChange={(value) => setOption('afterPreset', value)}
          />
        </ControlRow>
        <ToggleRow
          label={a.keepOriginal}
          hint={keep ? a.keepOriginalOn : a.keepOriginalOff}
          checked={keep}
          disabled={!preset}
          onChange={(value) => setOption('keepOriginalAfterConvert', value)}
        />
      </div>
      {presetIssue === 'needs-video' && (
        <Notice tone="warning" className="dl-after-notice">
          {a.needsVideo}
        </Notice>
      )}
    </Section>
  );
}
