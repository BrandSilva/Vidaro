import { FileVideo } from 'lucide-react';
import { Section, Field } from '../Section.jsx';
import { Segmented, Select } from '../Inputs.jsx';
import { t } from '../../strings/index.js';
import { changeKind, containerLabel, containersOfKind, isAudioOnly, kindOf, supportsFaststart } from './model.js';
import { SwitchField } from './parts.jsx';

const s = t.presets.editor;

export function FormatSection({ preset, schema, summary, readOnly, set, onChange, storageKey, defaultOpen }) {
  const kind = kindOf(schema, preset.container);
  const audioOnly = isAudioOnly(schema, preset.container);
  const faststart = supportsFaststart(schema, preset.container);
  const kinds = ['video', 'audio'].map((value) => ({ value, label: s.kinds[value] }));
  const containers = containersOfKind(schema, kind).map((value) => ({ value, label: containerLabel(value) }));
  const subtitleOptions = ['keep', 'drop'].map((value) => ({ value, label: s.subtitleOptions[value] }));
  return (
    <Section title={s.sections.format} icon={FileVideo} summary={summary} storageKey={storageKey} defaultOpen={defaultOpen}>
      <div className="field-grid">
        <Field label={s.outputType}>
          <Segmented block value={kind} options={kinds} disabled={readOnly} label={s.outputType} onChange={(value) => onChange(changeKind(preset, value, schema))} />
        </Field>
        <Field label={s.format} hint={s.containerHints[preset.container]}>
          <Select block value={preset.container} options={containers} disabled={readOnly} label={s.format} onChange={set('container')} />
        </Field>
        <Field label={s.subtitles} hint={audioOnly ? s.subtitlesAudioOnly : s.subtitlesHint}>
          <Segmented
            block
            value={preset.subtitles}
            options={subtitleOptions}
            disabled={readOnly || audioOnly || preset.video.mode === 'none'}
            label={s.subtitles}
            onChange={set('subtitles')}
          />
        </Field>
        <SwitchField
          label={s.faststart}
          hint={faststart ? s.faststartHint : s.faststartUnavailable}
          checked={faststart && preset.output.faststart}
          disabled={readOnly || !faststart}
          onChange={set('output.faststart')}
        />
      </div>
    </Section>
  );
}
