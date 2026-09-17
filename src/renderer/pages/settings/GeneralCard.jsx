import { SlidersHorizontal } from 'lucide-react';
import { t } from '../../strings/index.js';
import { NumberRow, SegmentedRow, SelectRow, SettingsCard, SwitchRow } from './controls.jsx';
import { OPTIONS, RANGES } from './model.js';

const g = t.settings.general;

const CLOSE_OPTIONS = OPTIONS['general.closeBehavior'].map((value) => ({ value, label: g.closeOptions[value] }));
const FINISH_OPTIONS = OPTIONS['general.onQueueFinish'].map((value) => ({ value, label: g.onFinishOptions[value] }));
const [STALL_MIN, STALL_MAX] = RANGES['general.stallMinutes'];

export function GeneralCard({ sectionRef }) {
  return (
    <SettingsCard id="general" title={t.settings.sections.general} icon={SlidersHorizontal} sectionRef={sectionRef}>
      <SelectRow path="general.closeBehavior" label={g.closeBehavior} hint={g.closeBehaviorHint} options={CLOSE_OPTIONS} width={250} />
      <SegmentedRow path="general.onQueueFinish" label={g.onFinish} hint={g.onFinishHint} options={FINISH_OPTIONS} />
      <SwitchRow path="general.notifyOnFinish" label={g.notify} hint={g.notifyHint} />
      <SwitchRow path="general.autoResume" label={g.autoResume} hint={g.autoResumeHint} />
      <SwitchRow path="general.lowPriority" label={g.lowPriority} hint={g.lowPriorityHint} />
      <SwitchRow path="general.clipboardChip" label={g.clipboardChip} hint={g.clipboardChipHint} />
      <NumberRow path="general.stallMinutes" label={g.stall} hint={g.stallHint} min={STALL_MIN} max={STALL_MAX} suffix={g.minutes} width={110} />
    </SettingsCard>
  );
}
