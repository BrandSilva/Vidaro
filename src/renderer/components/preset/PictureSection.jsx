import { Crop } from 'lucide-react';
import { Section, Field } from '../Section.jsx';
import { Chip, NumberInput, Segmented, Select, TextInput } from '../Inputs.jsx';
import { t } from '../../strings/index.js';
import { evenNumber, fitOptions, fpsOptions, isAudioOnly, normalizeRate, resolutionOptions, rotateOptions, triStateOptions } from './model.js';
import { EditorNote, SwitchField } from './parts.jsx';

const s = t.presets.editor;
const CROP_SIDES = ['top', 'bottom', 'left', 'right'];

function sourceSize(media) {
  const video = media && media.video;
  if (!video || !video.width) return null;
  return `${video.displayWidth || video.width}×${video.displayHeight || video.height}`;
}

function sourceRate(media) {
  const video = media && media.video;
  return video && video.fpsLabel ? `${video.fpsLabel} ${s.fps}` : null;
}

function sourceHint(value) {
  return value ? `${t.convert.sourceLabel}: ${value}` : null;
}

export function PictureSection({ preset, schema, summary, readOnly, set, media, storageKey, defaultOpen }) {
  const { picture } = preset;
  const fields = schema.fields.picture;
  const active = preset.video.mode === 'encode' && !isAudioOnly(schema, preset.container);
  const keepSize = picture.resolution === 'keep';
  const customRateInvalid = picture.fps === 'custom' && !normalizeRate(picture.customFps);
  const colorOptions = fields.colorConvert.values.map((value) => ({ value, label: s.colorOptions[value] }));
  const rateOptions = fields.deinterlaceRate.values.map((value) => ({ value, label: s.deinterlaceRates[value] }));
  const crop = picture.crop || {};
  return (
    <Section title={s.sections.picture} icon={Crop} summary={summary} storageKey={storageKey} defaultOpen={defaultOpen}>
      {!active ? (
        <EditorNote>{s.pictureNotUsed}</EditorNote>
      ) : (
        <div className="field-grid">
          <Field label={s.resolution} hint={keepSize ? sourceHint(sourceSize(media)) : null}>
            <Select block value={picture.resolution} options={resolutionOptions(schema)} disabled={readOnly} label={s.resolution} onChange={set('picture.resolution')} />
          </Field>
          <Field label={s.fit} hint={keepSize ? null : s.fitHints[picture.fit]}>
            <Segmented block size="sm" value={picture.fit} options={fitOptions(schema)} disabled={readOnly || keepSize} label={s.fit} onChange={set('picture.fit')} />
          </Field>
          {picture.resolution === 'custom' && (
            <>
              <Field label={s.width}>
                <NumberInput
                  value={picture.width}
                  min={fields.width.min}
                  max={fields.width.max}
                  step={2}
                  suffix={s.px}
                  width="100%"
                  disabled={readOnly}
                  label={s.width}
                  onChange={(value) => set('picture.width')(evenNumber(value, fields.width.min, fields.width.max))}
                />
              </Field>
              <Field label={s.height}>
                <NumberInput
                  value={picture.height}
                  min={fields.height.min}
                  max={fields.height.max}
                  step={2}
                  suffix={s.px}
                  width="100%"
                  disabled={readOnly}
                  label={s.height}
                  onChange={(value) => set('picture.height')(evenNumber(value, fields.height.min, fields.height.max))}
                />
              </Field>
            </>
          )}
          <SwitchField label={s.noUpscale} hint={s.noUpscaleHint} checked={picture.noUpscale} disabled={readOnly || keepSize} onChange={set('picture.noUpscale')} />
          <Field label={s.frameRate} hint={picture.fps === 'keep' ? sourceHint(sourceRate(media)) : null}>
            <Select block value={picture.fps} options={fpsOptions(schema)} disabled={readOnly} label={s.frameRate} onChange={set('picture.fps')} />
          </Field>
          {picture.fps === 'custom' && (
            <Field label={s.customFps}>
              <TextInput
                value={picture.customFps}
                invalid={customRateInvalid}
                disabled={readOnly}
                placeholder={s.customFpsPlaceholder}
                maxLength={fields.customFps.maxLength}
                suffix={s.fps}
                aria-label={s.customFps}
                onChange={set('picture.customFps')}
              />
            </Field>
          )}
          {customRateInvalid && <div className="pe-error field-span">{s.customFpsInvalid}</div>}
          <SwitchField label={s.cfr} hint={s.cfrHint} checked={picture.cfr} disabled={readOnly} onChange={set('picture.cfr')} />
          <Field label={s.deinterlace}>
            <Segmented block value={picture.deinterlace} options={triStateOptions(fields.deinterlace.values)} disabled={readOnly} label={s.deinterlace} onChange={set('picture.deinterlace')} />
          </Field>
          <Field label={s.deinterlaceRate} hint={picture.deinterlace === 'off' ? null : s.deinterlaceRateHints[picture.deinterlaceRate]}>
            <Segmented
              block
              value={picture.deinterlaceRate}
              options={rateOptions}
              disabled={readOnly || picture.deinterlace === 'off'}
              label={s.deinterlaceRate}
              onChange={set('picture.deinterlaceRate')}
            />
          </Field>
          <Field label={s.ivtc} hint={s.ivtcHint}>
            <Segmented block value={picture.ivtc} options={triStateOptions(fields.ivtc.values)} disabled={readOnly} label={s.ivtc} onChange={set('picture.ivtc')} />
          </Field>
          <Field label={s.colorConvert} hint={s.colorConvertHint}>
            <Segmented block value={picture.colorConvert} options={colorOptions} disabled={readOnly} label={s.colorConvert} onChange={set('picture.colorConvert')} />
          </Field>
          <SwitchField label={s.squarePixels} hint={s.squarePixelsHint} checked={picture.squarePixels} disabled={readOnly} onChange={set('picture.squarePixels')} />
          <Field label={s.rotate}>
            <Segmented block value={picture.rotate} options={rotateOptions(schema)} disabled={readOnly} label={s.rotate} onChange={set('picture.rotate')} />
          </Field>
          <Field label={s.flip}>
            <div className="pe-chips">
              <Chip selected={picture.flipH} disabled={readOnly} onClick={() => set('picture.flipH')(!picture.flipH)}>
                {s.flipH}
              </Chip>
              <Chip selected={picture.flipV} disabled={readOnly} onClick={() => set('picture.flipV')(!picture.flipV)}>
                {s.flipV}
              </Chip>
            </div>
          </Field>
          <Field label={s.crop} span hint={s.cropHint}>
            <div className="pe-crop">
              {CROP_SIDES.map((side) => (
                <div key={side} className="pe-crop-side">
                  <span className="pe-crop-label">{s.cropSides[side]}</span>
                  <NumberInput
                    value={crop[side] || 0}
                    min={0}
                    max={fields.crop[side].max}
                    step={2}
                    suffix={s.px}
                    width="100%"
                    disabled={readOnly}
                    label={s.cropSides[side]}
                    onChange={(value) => set(`picture.crop.${side}`)(evenNumber(value, 0, fields.crop[side].max))}
                  />
                </div>
              ))}
            </div>
          </Field>
        </div>
      )}
    </Section>
  );
}
