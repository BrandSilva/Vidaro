import { useMemo } from 'react';
import { Film } from 'lucide-react';
import { FolderField } from '../../components/FolderField.jsx';
import { Segmented, Select } from '../../components/Inputs.jsx';
import { t } from '../../strings/index.js';
import { useSettingsContext } from './hooks.js';
import { Row, SegmentedRow, SettingsCard, SwitchRow, TextRow, useValue } from './controls.jsx';
import { OPTIONS, RANGES, convertNamePreview, validateConvertTemplate } from './model.js';

const c = t.settings.conversions;
const d = t.settings.downloads;

const OUTPUT_OPTIONS = OPTIONS['convert.outputMode'].map((value) => ({ value, label: c.outputOptions[value] }));
const COLLISION_OPTIONS = OPTIONS['convert.collision'].map((value) => ({ value, label: d.collisionOptions[value] }));
const HARDWARE_OPTIONS = OPTIONS['convert.hardware'].map((value) => ({ value, label: c.hardwareOptions[value] }));
const [MIN_CV, MAX_CV] = RANGES['convert.concurrency'];
const CONCURRENCY_OPTIONS = Array.from({ length: MAX_CV - MIN_CV + 1 }, (_, index) => ({ value: MIN_CV + index, label: String(MIN_CV + index) }));

const previewName = (template) => {
  const result = validateConvertTemplate(template);
  if (!result.ok || result.value === '{name}') return null;
  return c.example(`${convertNamePreview(result.value, c.exampleValues)}.mp4`);
};

function FolderRow({ disabled }) {
  const { save } = useSettingsContext();
  const folder = useValue('convert.folder');
  return (
    <Row keys={['convert.folder']} label={c.folder} hint={c.folderHint} disabled={disabled}>
      <div className="st-folder">
        <FolderField value={folder} disabled={disabled} onChange={(next) => save('convert.folder', next)} />
      </div>
    </Row>
  );
}

function ConcurrencyRow() {
  const { save } = useSettingsContext();
  const value = useValue('convert.concurrency');
  return (
    <Row keys={['convert.concurrency']} label={c.concurrency} hint={c.concurrencyHints[value] || c.concurrencyHints[1]}>
      <Segmented value={value} options={CONCURRENCY_OPTIONS} label={c.concurrency} onChange={(next) => save('convert.concurrency', next)} />
    </Row>
  );
}

function PresetRow() {
  const { save, presets } = useSettingsContext();
  const value = useValue('convert.defaultPreset');
  const options = useMemo(() => {
    const list = (presets || []).map((preset) => ({ value: preset.id, label: preset.name }));
    if (value && presets && !presets.some((preset) => preset.id === value)) list.push({ value, label: c.presetMissing, disabled: true });
    return list;
  }, [presets, value]);
  return (
    <Row keys={['convert.defaultPreset']} label={c.defaultPreset} hint={c.defaultPresetHint}>
      <Select value={value} options={options} width={220} label={c.defaultPreset} disabled={!presets} onChange={(next) => save('convert.defaultPreset', next)} />
    </Row>
  );
}

export function ConversionsCard({ sectionRef }) {
  const outputMode = useValue('convert.outputMode');
  return (
    <SettingsCard id="conversions" title={t.settings.sections.conversions} icon={Film} sectionRef={sectionRef}>
      <SegmentedRow path="convert.outputMode" label={c.output} hint={c.outputHint} options={OUTPUT_OPTIONS} />
      <FolderRow disabled={outputMode !== 'folder'} />
      <TextRow
        path="convert.nameTemplate"
        label={c.nameTemplate}
        hint={c.nameTemplateHint}
        invalidText={c.nameTemplateInvalid}
        validate={validateConvertTemplate}
        preview={previewName}
        width={220}
        mono
      />
      <SegmentedRow path="convert.collision" label={c.collision} hint={d.collisionHint} options={COLLISION_OPTIONS} />
      <ConcurrencyRow />
      <SegmentedRow path="convert.hardware" label={c.hardware} hint={c.hardwareHint} options={HARDWARE_OPTIONS} />
      <PresetRow />
      <SwitchRow path="convert.keepDate" label={c.keepDate} hint={c.keepDateHint} />
    </SettingsCard>
  );
}
