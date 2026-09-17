import { AudioLines } from 'lucide-react';
import { Section, Field } from '../Section.jsx';
import { Segmented, Select, Slider } from '../Inputs.jsx';
import { t } from '../../strings/index.js';
import {
  audioBitrateOptions,
  audioCodecOptions,
  audioModeOptions,
  channelOptions,
  isAudioOnly,
  loudnessOptions,
  sampleRateOptions,
  vbrOptions
} from './model.js';

const s = t.presets.editor;
const LOSSLESS = new Set(['pcm', 'flac']);

function modeHint(preset, audioOnly) {
  if (preset.audio.mode === 'copy') return s.audioCopyHint;
  if (preset.audio.mode === 'none') return s.audioNoneHint;
  if (!audioOnly && preset.video.mode === 'none') return s.audioRemoveBlocked;
  return null;
}

export function AudioSection({ preset, schema, summary, readOnly, set, storageKey, defaultOpen }) {
  const { audio } = preset;
  const fields = schema.fields.audio;
  const audioOnly = isAudioOnly(schema, preset.container);
  const encode = audio.mode === 'encode';
  const codecs = audioCodecOptions(schema, preset.container);
  const lossless = LOSSLESS.has(audio.codec);
  const vbrOn = audio.codec === 'mp3' && audio.vbr > 0;
  const tracks = fields.tracks.values.map((value) => ({ value, label: s.trackOptions[value] }));
  return (
    <Section title={s.sections.audio} icon={AudioLines} summary={summary} storageKey={storageKey} defaultOpen={defaultOpen}>
      <div className="field-grid">
        <Field label={s.audioMode} span hint={modeHint(preset, audioOnly)}>
          <Segmented block value={audio.mode} options={audioModeOptions(preset, schema)} disabled={readOnly} label={s.audioMode} onChange={set('audio.mode')} />
        </Field>
        {encode && (
          <>
            <Field label={s.codec}>
              <Select block value={audio.codec} options={codecs} disabled={readOnly || codecs.length < 2} label={s.codec} onChange={set('audio.codec')} />
            </Field>
            <Field label={s.audioBitrate}>
              {lossless ? (
                <div className="pe-static">{s.losslessBitrate}</div>
              ) : (
                <Select
                  block
                  value={audio.bitrate}
                  options={audioBitrateOptions(schema, audio.codec, audio.channels, audio.bitrate)}
                  disabled={readOnly || vbrOn}
                  label={s.audioBitrate}
                  onChange={set('audio.bitrate')}
                />
              )}
            </Field>
            {audio.codec === 'mp3' && (
              <Field label={s.vbr}>
                <Select block value={audio.vbr} options={vbrOptions(schema)} disabled={readOnly} label={s.vbr} onChange={set('audio.vbr')} />
              </Field>
            )}
            <Field label={s.sampleRate} hint={audio.codec === 'opus' ? s.opusRate : null}>
              <Segmented
                block
                size="sm"
                value={audio.sampleRate}
                options={sampleRateOptions(schema)}
                disabled={readOnly || audio.codec === 'opus'}
                label={s.sampleRate}
                onChange={set('audio.sampleRate')}
              />
            </Field>
            <Field label={s.channels}>
              <Segmented block size="sm" value={audio.channels} options={channelOptions(schema)} disabled={readOnly} label={s.channels} onChange={set('audio.channels')} />
            </Field>
            <Field label={s.volume} span>
              <div className="pe-volume">
                <Slider
                  value={audio.volumeDb}
                  min={fields.volumeDb.min}
                  max={fields.volumeDb.max}
                  step={0.5}
                  disabled={readOnly}
                  label={s.volume}
                  format={s.volumeValue}
                  onChange={set('audio.volumeDb')}
                />
              </div>
            </Field>
            <Field label={s.loudness} span hint={audio.loudness === 'off' ? null : s.loudnessHint}>
              <Select block value={audio.loudness} options={loudnessOptions(schema)} disabled={readOnly} label={s.loudness} onChange={set('audio.loudness')} />
            </Field>
          </>
        )}
        {audio.mode !== 'none' && (
          <Field label={s.tracks} hint={audioOnly ? s.tracksAudioOnly : null}>
            <Segmented block size="sm" value={audio.tracks} options={tracks} disabled={readOnly || audioOnly} label={s.tracks} onChange={set('audio.tracks')} />
          </Field>
        )}
      </div>
    </Section>
  );
}
