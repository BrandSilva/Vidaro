import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, FileText } from 'lucide-react';
import { FolderField } from '../../components/FolderField.jsx';
import { Segmented, Select, Switch } from '../../components/Inputs.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { api } from '../../lib/api.js';
import { baseName } from '../../lib/format.js';
import { t } from '../../strings/index.js';
import { useSettingsContext } from './hooks.js';
import { GroupTitle, NumberRow, Row, SegmentedRow, SelectRow, SettingsCard, SwitchRow, TextRow, useValue } from './controls.jsx';
import {
  FORMAT_LABELS,
  LOSSLESS_AUDIO,
  OPTIONS,
  RANGES,
  downloadExtension,
  validateCustomTemplate,
  validateProxy,
  validateRateLimit,
  validateSubtitleLangs
} from './model.js';

const d = t.settings.downloads;

const labelled = (key, labels) => OPTIONS[key].map((value) => ({ value, label: labels[value] }));
const NAME_OPTIONS = labelled('download.nameTemplate', d.nameOptions);
const COLLISION_OPTIONS = labelled('download.collision', d.collisionOptions);
const MODE_OPTIONS = labelled('download.mode', d.modeOptions);
const QUALITY_OPTIONS = labelled('download.quality', d.qualityOptions);
const CONTAINER_OPTIONS = labelled('download.container', FORMAT_LABELS);
const AUDIO_FORMAT_OPTIONS = labelled('download.audioFormat', FORMAT_LABELS);
const AUDIO_QUALITY_OPTIONS = labelled('download.audioQuality', d.audioQualityOptions);
const COOKIE_OPTIONS = labelled('download.cookiesMode', d.cookiesOptions);
const BROWSER_OPTIONS = labelled('download.cookiesBrowser', d.browsers);
const [MIN_DL, MAX_DL] = RANGES['download.concurrency'];
const CONCURRENCY_OPTIONS = Array.from({ length: MAX_DL - MIN_DL + 1 }, (_, index) => ({ value: MIN_DL + index, label: String(MIN_DL + index) }));
const [MIN_FRAGMENTS, MAX_FRAGMENTS] = RANGES['download.concurrentFragments'];

function useNamePreview(download) {
  const [preview, setPreview] = useState(null);
  const { nameTemplate, customTemplate } = download;
  const extension = downloadExtension(download);
  useEffect(() => {
    let alive = true;
    Promise.resolve(api.download.suggestName({ info: d.exampleInfo, template: nameTemplate, custom: customTemplate })).then(
      (name) => {
        if (alive) setPreview(typeof name === 'string' && name ? `${name}.${extension}` : null);
      },
      () => {
        if (alive) setPreview(null);
      }
    );
    return () => {
      alive = false;
    };
  }, [nameTemplate, customTemplate, extension]);
  return preview;
}

function FolderRow() {
  const { save } = useSettingsContext();
  const folder = useValue('download.folder');
  return (
    <Row keys={['download.folder']} label={d.folder} hint={d.folderHint}>
      <div className="st-folder">
        <FolderField value={folder} onChange={(next) => save('download.folder', next)} />
      </div>
    </Row>
  );
}

function NameRow({ download }) {
  const { save } = useSettingsContext();
  const preview = useNamePreview(download);
  return (
    <Row keys={['download.nameTemplate']} label={d.nameTemplate} hint={preview ? d.example(preview) : d.nameTemplateHint}>
      <Select value={download.nameTemplate} options={NAME_OPTIONS} width={220} label={d.nameTemplate} onChange={(next) => save('download.nameTemplate', next)} />
    </Row>
  );
}

function ConcurrencyRow() {
  const { save } = useSettingsContext();
  const value = useValue('download.concurrency');
  return (
    <Row keys={['download.concurrency']} label={d.concurrency} hint={d.concurrencyHint}>
      <Segmented value={value} options={CONCURRENCY_OPTIONS} label={d.concurrency} onChange={(next) => save('download.concurrency', next)} />
    </Row>
  );
}

function CookiesFileRow() {
  const { save } = useSettingsContext();
  const file = useValue('download.cookiesFile');
  const choose = async () => {
    const picked = await api.dialogs.pickCookiesFile();
    if (picked) save('download.cookiesFile', picked);
  };
  return (
    <Row keys={['download.cookiesFile']} label={d.cookiesFile} hint={d.cookiesFileHint}>
      <div className="st-folder">
        <Tooltip label={file} className="grow">
          <button type="button" className="folder-path" onClick={choose}>
            <FileText size={15} />
            <span className={file ? 'ellipsis' : 'ellipsis faint'}>{file ? baseName(file) : d.cookiesFileNone}</span>
          </button>
        </Tooltip>
      </div>
    </Row>
  );
}

function AfterPresetRow({ value }) {
  const { save, presets } = useSettingsContext();
  const options = useMemo(() => {
    const list = [{ value: null, label: d.afterPresetNone }];
    for (const preset of presets || []) list.push({ value: preset.id, label: preset.name });
    if (value && presets && !presets.some((preset) => preset.id === value)) list.push({ value, label: t.settings.conversions.presetMissing, disabled: true });
    return list;
  }, [presets, value]);
  return (
    <Row keys={['download.afterPreset']} label={d.afterPreset} hint={d.afterPresetHint}>
      <Select value={value} options={options} width={220} label={d.afterPreset} disabled={!presets} onChange={(next) => save('download.afterPreset', next)} />
    </Row>
  );
}

function KeepOriginalRow({ enabled }) {
  const { save } = useSettingsContext();
  const value = useValue('download.keepOriginalAfterConvert');
  return (
    <Row keys={['download.keepOriginalAfterConvert']} label={d.keepOriginal} hint={d.keepOriginalHint} disabled={!enabled}>
      <Switch checked={Boolean(value)} label={d.keepOriginal} disabled={!enabled} onChange={(next) => save('download.keepOriginalAfterConvert', next)} />
    </Row>
  );
}

export function DownloadsCard({ sectionRef }) {
  const { settings } = useSettingsContext();
  const download = settings.download;
  const subtitlesOff = !download.subtitles;
  const lossless = LOSSLESS_AUDIO.has(download.audioFormat);

  return (
    <SettingsCard id="downloads" title={t.settings.sections.downloads} icon={ArrowDownToLine} sectionRef={sectionRef}>
      <GroupTitle>{d.groupFiles}</GroupTitle>
      <FolderRow />
      <NameRow download={download} />
      {download.nameTemplate === 'custom' && (
        <TextRow
          path="download.customTemplate"
          label={d.customTemplate}
          hint={d.customTemplateHint}
          invalidText={d.customTemplateInvalid}
          validate={validateCustomTemplate}
          width={300}
          mono
        />
      )}
      <SegmentedRow path="download.collision" label={d.collision} hint={d.collisionHint} options={COLLISION_OPTIONS} />
      <ConcurrencyRow />
      <SwitchRow path="download.numberPlaylist" label={d.numberPlaylist} hint={d.numberPlaylistHint} />

      <GroupTitle>{d.groupFormat}</GroupTitle>
      <SegmentedRow path="download.mode" label={d.mode} options={MODE_OPTIONS} />
      <SelectRow path="download.quality" label={d.quality} hint={d.qualityHint} options={QUALITY_OPTIONS} width={180} />
      <SwitchRow path="download.compatible" label={d.compatible} hint={d.compatibleHint} />
      <SegmentedRow path="download.container" label={d.container} options={CONTAINER_OPTIONS} />
      <SegmentedRow path="download.audioFormat" label={d.audioFormat} hint={d.audioFormatHint} options={AUDIO_FORMAT_OPTIONS} />
      <SelectRow
        path="download.audioQuality"
        label={d.audioQuality}
        hint={lossless ? d.audioQualityHint : null}
        options={AUDIO_QUALITY_OPTIONS}
        width={180}
        disabled={lossless}
      />

      <GroupTitle>{d.groupExtras}</GroupTitle>
      <SwitchRow path="download.subtitles" label={d.subtitles} hint={d.subtitlesHint} />
      <TextRow
        path="download.subtitleLangs"
        label={d.subtitleLangs}
        hint={d.subtitleLangsHint}
        invalidText={d.subtitleLangsInvalid}
        validate={validateSubtitleLangs}
        width={180}
        disabled={subtitlesOff}
        mono
      />
      <SwitchRow path="download.embedSubtitles" label={d.embedSubtitles} hint={d.embedSubtitlesHint} disabled={subtitlesOff} />
      <SwitchRow path="download.autoSubtitles" label={d.autoSubtitles} hint={d.autoSubtitlesHint} disabled={subtitlesOff} />
      <SwitchRow path="download.embedThumbnail" label={d.embedThumbnail} hint={d.embedThumbnailHint} />
      <SwitchRow path="download.embedMetadata" label={d.embedMetadata} hint={d.embedMetadataHint} />
      <SwitchRow path="download.embedChapters" label={d.embedChapters} hint={d.embedChaptersHint} />
      <SwitchRow path="download.sponsorBlock" label={d.sponsorBlock} hint={d.sponsorBlockHint} />

      <GroupTitle>{d.groupNetwork}</GroupTitle>
      <TextRow
        path="download.rateLimit"
        label={d.rateLimit}
        hint={d.rateLimitHint}
        invalidText={d.rateLimitInvalid}
        placeholder={d.rateLimitPlaceholder}
        validate={validateRateLimit}
        width={140}
      />
      <NumberRow path="download.concurrentFragments" label={d.fragments} hint={d.fragmentsHint} min={MIN_FRAGMENTS} max={MAX_FRAGMENTS} width={110} />
      <SegmentedRow path="download.cookiesMode" label={d.cookies} hint={d.cookiesHint} options={COOKIE_OPTIONS} />
      {download.cookiesMode === 'browser' && (
        <SelectRow path="download.cookiesBrowser" label={d.cookiesBrowser} hint={d.cookiesBrowserHint} options={BROWSER_OPTIONS} width={200} />
      )}
      {download.cookiesMode === 'file' && <CookiesFileRow />}
      <TextRow
        path="download.proxy"
        label={d.proxy}
        hint={d.proxyHint}
        invalidText={d.proxyInvalid}
        placeholder={d.proxyPlaceholder}
        validate={validateProxy}
        width={260}
        mono
      />

      <GroupTitle>{d.groupAfter}</GroupTitle>
      <AfterPresetRow value={download.afterPreset} />
      <KeepOriginalRow enabled={Boolean(download.afterPreset)} />
    </SettingsCard>
  );
}
