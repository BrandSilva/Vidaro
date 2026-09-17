import { Film, RefreshCw } from 'lucide-react';
import { Section, Field } from '../Section.jsx';
import { IconButton } from '../Button.jsx';
import { NumberInput, Segmented, Select, Slider } from '../Inputs.jsx';
import { t } from '../../strings/index.js';
import {
  encoderOptions,
  isAudioOnly,
  levelOptions,
  profileOptions,
  qualityFromSlider,
  qualityText,
  sliderFromQuality,
  twoPassAvailable,
  videoCodecOptions,
  videoModeOptions
} from './model.js';
import { EditorNote, SwitchField } from './parts.jsx';

const s = t.presets.editor;

function modeHint(preset) {
  if (preset.video.mode === 'copy') return s.videoCopyHint;
  if (preset.video.mode === 'none') return s.videoNoneHint;
  if (preset.audio.mode === 'none') return s.videoRemoveBlocked;
  return null;
}

function optionalRate(field) {
  return (value) => (value <= 0 ? 0 : Math.min(field.max, Math.max(field.min, Math.round(value))));
}

function keyframeValue(field) {
  return (value) => (value <= 0 ? 0 : Math.min(field.max, Math.max(field.min, Math.round(value * 10) / 10)));
}

function encoderHint({ detecting, hardware, forced }) {
  if (detecting) return s.encoderDetecting;
  if (hardware === 'software' && forced === 'auto') return s.encoderSoftwareSetting;
  return null;
}

export function VideoSection({ preset, schema, summary, readOnly, set, encoders, detecting, hardware, onDetect, storageKey, defaultOpen }) {
  const { video } = preset;
  const fields = schema.fields.video;
  const audioOnly = isAudioOnly(schema, preset.container);
  const encode = video.mode === 'encode' && !audioOnly;
  const profiles = profileOptions(schema, video.codec);
  const levels = levelOptions(schema, video.codec);
  const speeds = fields.speed.values.map((value) => ({ value, label: s.speeds[value] }));
  const rateControls = fields.rateControl.values.map((value) => ({ value, label: s.rateControls[value] }));
  const bitrateModes = fields.bitrateMode.values.map((value) => ({ value, label: s.bitrateModes[value] }));
  const detectButton = (
    <IconButton
      icon={RefreshCw}
      size="sm"
      iconSize={13}
      label={s.detectAgain}
      disabled={readOnly || detecting}
      onClick={onDetect}
      className={detecting ? 'pe-inline-btn pe-spinning' : 'pe-inline-btn'}
    />
  );
  return (
    <Section title={s.sections.video} icon={Film} summary={summary} storageKey={storageKey} defaultOpen={defaultOpen}>
      {audioOnly ? (
        <EditorNote>{s.videoAudioOnly}</EditorNote>
      ) : (
        <div className="field-grid">
          <Field label={s.videoMode} span hint={modeHint(preset)}>
            <Segmented block value={video.mode} options={videoModeOptions(preset, schema)} disabled={readOnly} label={s.videoMode} onChange={set('video.mode')} />
          </Field>
          {encode && (
            <>
              <Field label={s.codec}>
                <Select block value={video.codec} options={videoCodecOptions(schema, preset.container)} disabled={readOnly} label={s.codec} onChange={set('video.codec')} />
              </Field>
              <Field label={s.encoder} trailing={detectButton} hint={encoderHint({ detecting, hardware, forced: video.encoder })}>
                <Select block value={video.encoder} options={encoderOptions(encoders, video.codec, video.encoder)} disabled={readOnly} label={s.encoder} onChange={set('video.encoder')} />
              </Field>
              <Field label={s.rateControl} span>
                <Segmented block value={video.rateControl} options={rateControls} disabled={readOnly} label={s.rateControl} onChange={set('video.rateControl')} />
              </Field>
              {video.rateControl === 'quality' ? (
                <Field label={s.quality} span hint={s.qualityHint}>
                  <div className="pe-quality">
                    <Slider
                      value={sliderFromQuality(video.quality, fields.quality)}
                      min={fields.quality.min}
                      max={fields.quality.max}
                      step={1}
                      disabled={readOnly}
                      label={s.quality}
                      format={() => qualityText(video.quality)}
                      onChange={(value) => set('video.quality')(qualityFromSlider(value, fields.quality))}
                    />
                  </div>
                </Field>
              ) : (
                <>
                  <Field label={s.bitrate}>
                    <NumberInput
                      value={video.bitrate}
                      min={fields.bitrate.min}
                      max={fields.bitrate.max}
                      step={100}
                      suffix={s.kbps}
                      width="100%"
                      disabled={readOnly}
                      label={s.bitrate}
                      onChange={set('video.bitrate')}
                    />
                  </Field>
                  <Field label={s.bitrateMode}>
                    <Segmented block value={video.bitrateMode} options={bitrateModes} disabled={readOnly} label={s.bitrateMode} onChange={set('video.bitrateMode')} />
                  </Field>
                  <Field label={s.maxrate} hint={s.zeroOff}>
                    <NumberInput
                      value={video.maxrate}
                      min={0}
                      max={fields.maxrate.max}
                      step={100}
                      suffix={s.kbps}
                      width="100%"
                      disabled={readOnly}
                      label={s.maxrate}
                      onChange={(value) => set('video.maxrate')(optionalRate(fields.maxrate)(value))}
                    />
                  </Field>
                  <Field label={s.bufsize} hint={s.zeroOff}>
                    <NumberInput
                      value={video.bufsize}
                      min={0}
                      max={fields.bufsize.max}
                      step={100}
                      suffix={s.kbps}
                      width="100%"
                      disabled={readOnly || !video.maxrate}
                      label={s.bufsize}
                      onChange={(value) => set('video.bufsize')(optionalRate(fields.bufsize)(value))}
                    />
                  </Field>
                  {twoPassAvailable(preset) && (
                    <SwitchField label={s.twoPass} hint={s.twoPassHint} checked={video.twoPass} disabled={readOnly} onChange={set('video.twoPass')} />
                  )}
                </>
              )}
              <Field label={s.speed} hint={s.speedHint}>
                <Segmented block value={video.speed} options={speeds} disabled={readOnly} label={s.speed} onChange={set('video.speed')} />
              </Field>
              <Field label={s.keyframes} hint={s.keyframesHint}>
                <NumberInput
                  value={video.keyframeSeconds}
                  min={0}
                  max={fields.keyframeSeconds.max}
                  step={0.5}
                  suffix={s.seconds}
                  width="100%"
                  disabled={readOnly}
                  label={s.keyframes}
                  onChange={(value) => set('video.keyframeSeconds')(keyframeValue(fields.keyframeSeconds)(value))}
                />
              </Field>
              {profiles.length > 1 && (
                <Field label={s.profile}>
                  <Select block value={video.profile} options={profiles} disabled={readOnly} label={s.profile} onChange={set('video.profile')} />
                </Field>
              )}
              {levels.length > 1 && (
                <Field label={s.level}>
                  <Select block value={video.level} options={levels} disabled={readOnly} label={s.level} onChange={set('video.level')} />
                </Field>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
