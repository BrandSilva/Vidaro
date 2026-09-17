import { Film, Music, Settings2, VolumeX } from 'lucide-react';
import { Card } from '../../components/Section.jsx';
import { Chip, Segmented, Select, Switch } from '../../components/Inputs.jsx';
import { FolderField } from '../../components/FolderField.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { setFolder, setOption } from '../../state/download.js';
import { t } from '../../strings/index.js';
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  CONTAINERS,
  QUALITY_CHIPS,
  compatibleApplies,
  isLossless,
  qualityAvailable,
  qualityWarning
} from './model.js';
import { qualityLabel } from './labels.js';
import { FormRow, WarningLine } from './parts.jsx';

const o = t.download.options;
const CONTAINER_OPTIONS = CONTAINERS.map((value) => ({ value, label: o.containers[value] }));
const AUDIO_FORMAT_OPTIONS = AUDIO_FORMATS.map((value) => ({ value, label: o.audioFormats[value] }));
const AUDIO_QUALITY_OPTIONS = AUDIO_QUALITIES.map((value) => ({ value, label: o.audioQualities[value] }));
const MODE_ICONS = { av: Film, video: VolumeX, audio: Music };

function QualityChips({ quality, heights }) {
  return (
    <div className="chip-group dl-chips" role="group" aria-label={o.quality}>
      {QUALITY_CHIPS.map((chip) => {
        const available = qualityAvailable(chip, heights);
        const button = (
          <Chip key={chip} selected={quality === chip} disabled={!available} onClick={() => setOption('quality', chip)}>
            {qualityLabel(chip)}
          </Chip>
        );
        return available ? (
          button
        ) : (
          <Tooltip key={chip} label={o.unavailable}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}

function CompatibleRow({ options, extractor }) {
  const applies = compatibleApplies(options);
  const warning = qualityWarning(options, options.quality, extractor);
  return (
    <FormRow label={o.compatible}>
      <div className="dl-inline">
        <Switch checked={applies && options.compatible !== false} disabled={!applies} onChange={(value) => setOption('compatible', value)} label={o.compatible} />
        <span className="dl-inline-hint ellipsis">{applies ? o.compatibleHint : o.compatibleWebm}</span>
      </div>
      {warning && <WarningLine>{warning === 'youtube' ? o.compatibleYoutube : o.compatibleGeneric}</WarningLine>}
    </FormRow>
  );
}

export function OptionsCard({ options, info, folder }) {
  const audioSource = info?.hasVideo === false;
  const modes = ['av', 'video', 'audio'].map((value) => ({
    value,
    label: o.modes[value],
    icon: MODE_ICONS[value],
    disabled: audioSource && value !== 'audio'
  }));
  const audio = options.mode === 'audio';
  const lossless = isLossless(options.audioFormat);
  return (
    <Card title={o.title} icon={Settings2} className="dl-options">
      <div className="dl-form">
        <FormRow label={o.what} hint={audioSource ? t.download.video.audioOnly : null}>
          <div className="dl-inline">
            <Segmented value={options.mode} options={modes} onChange={(value) => setOption('mode', value)} label={o.what} />
          </div>
        </FormRow>
        {audio ? (
          <>
            <FormRow label={o.format}>
              <div className="dl-inline">
                <Select value={options.audioFormat} options={AUDIO_FORMAT_OPTIONS} width={140} label={o.format} onChange={(value) => setOption('audioFormat', value)} />
              </div>
            </FormRow>
            <FormRow label={o.quality}>
              <div className="dl-inline">
                <Select
                  value={lossless ? 'best' : options.audioQuality}
                  options={AUDIO_QUALITY_OPTIONS}
                  width={140}
                  disabled={lossless}
                  label={o.quality}
                  onChange={(value) => setOption('audioQuality', value)}
                />
                {lossless && <span className="dl-inline-hint">{o.lossless}</span>}
              </div>
            </FormRow>
          </>
        ) : (
          <>
            <FormRow label={o.quality}>
              <QualityChips quality={options.quality} heights={info?.heights} />
            </FormRow>
            <FormRow label={o.format}>
              <div className="dl-inline">
                <Select value={options.container} options={CONTAINER_OPTIONS} width={140} label={o.format} onChange={(value) => setOption('container', value)} />
              </div>
            </FormRow>
            <CompatibleRow options={options} extractor={info?.extractor} />
          </>
        )}
        <FormRow label={o.saveTo}>
          <FolderField value={folder} onChange={setFolder} placeholder={o.chooseFolder} />
        </FormRow>
      </div>
    </Card>
  );
}
