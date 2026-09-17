import { FileText, Save, Wrench } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { SavedFlag } from '../../components/Feedback.jsx';
import { NumberInput, Segmented, Select, TextInput } from '../../components/Inputs.jsx';
import { Section } from '../../components/Section.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { baseName } from '../../lib/format.js';
import { pickCookiesFile, resetOptions, saveDefaults, setOption, setSectionText } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { BROWSERS, COOKIE_MODES, MAX_FRAGMENTS, MIN_FRAGMENTS, parseRateLimit, validProxy, validSubtitleLangs } from './model.js';
import { moreSummary } from './labels.js';
import { ControlRow, Group, ToggleRow } from './parts.jsx';

const m = t.download.more;
const COOKIE_OPTIONS = COOKIE_MODES.map((value) => ({ value, label: m.cookieModes[value] }));
const BROWSER_OPTIONS = BROWSERS.map((value) => ({ value, label: m.browsers[value] }));

function Toggle({ name, label, hint, options, disabled }) {
  return <ToggleRow label={label} hint={hint} checked={options[name] === true} disabled={disabled} onChange={(value) => setOption(name, value)} />;
}

function SectionActions({ changed, savedToken }) {
  return (
    <div className="dl-more-actions">
      <SavedFlag token={savedToken} />
      {changed && (
        <Button size="sm" variant="ghost" tooltip={m.useDefaultsHint} onClick={resetOptions}>
          {m.useDefaults}
        </Button>
      )}
      <Button size="sm" icon={Save} tooltip={m.saveDefaultHint} disabled={!changed} onClick={saveDefaults}>
        {m.saveDefault}
      </Button>
    </div>
  );
}

function SubtitlesGroup({ options }) {
  const off = options.subtitles !== true;
  const langsInvalid = !off && !validSubtitleLangs(options.subtitleLangs);
  return (
    <Group title={m.groups.subtitles}>
      <Toggle name="subtitles" label={m.subtitles} hint={m.subtitlesHint} options={options} />
      <Toggle name="autoSubtitles" label={m.autoSubtitles} hint={m.autoSubtitlesHint} options={options} disabled={off} />
      <Toggle name="embedSubtitles" label={m.embedSubtitles} hint={m.embedSubtitlesHint} options={options} disabled={off || options.mode === 'audio'} />
      <ControlRow label={m.languages} hint={m.languagesHint} error={langsInvalid ? m.languagesInvalid : null} disabled={off}>
        <TextInput
          width={150}
          value={options.subtitleLangs ?? ''}
          disabled={off}
          invalid={langsInvalid}
          maxLength={128}
          aria-label={m.languages}
          onChange={(value) => setOption('subtitleLangs', value)}
        />
      </ControlRow>
    </Group>
  );
}

function EmbedGroup({ options }) {
  return (
    <Group title={m.groups.embed}>
      <Toggle name="embedThumbnail" label={m.embedThumbnail} hint={m.embedThumbnailHint} options={options} />
      <Toggle name="embedMetadata" label={m.embedMetadata} hint={m.embedMetadataHint} options={options} />
      <Toggle name="embedChapters" label={m.embedChapters} hint={m.embedChaptersHint} options={options} />
      <Toggle name="sponsorBlock" label={m.sponsorBlock} hint={m.sponsorBlockHint} options={options} />
    </Group>
  );
}

function RangeRow({ sectionStart, sectionEnd, sectionError }) {
  const startBad = sectionError === 'start' || sectionError === 'beyond';
  const endBad = sectionError === 'end' || sectionError === 'order';
  return (
    <ControlRow label={m.timeRange} hint={m.timeRangeHint} error={sectionError ? m.rangeErrors[sectionError] : null} span>
      <TextInput
        width={120}
        className="num"
        prefix={m.start}
        value={sectionStart}
        invalid={startBad}
        placeholder={m.startPlaceholder}
        maxLength={16}
        aria-label={m.start}
        onChange={(value) => setSectionText('start', value)}
      />
      <TextInput
        width={120}
        className="num"
        prefix={m.end}
        value={sectionEnd}
        invalid={endBad}
        placeholder={m.endPlaceholder}
        maxLength={16}
        aria-label={m.end}
        onChange={(value) => setSectionText('end', value)}
      />
    </ControlRow>
  );
}

function TransferGroup({ options, draft, kind }) {
  const rateInvalid = !parseRateLimit(options.rateLimit).valid;
  return (
    <Group title={m.groups.transfer}>
      {kind === 'video' && <RangeRow sectionStart={draft.sectionStart} sectionEnd={draft.sectionEnd} sectionError={draft.sectionError} />}
      <ControlRow label={m.speedLimit} hint={m.speedHint} error={rateInvalid ? m.speedInvalid : null}>
        <TextInput
          width={110}
          className="num"
          value={String(options.rateLimit ?? '')}
          invalid={rateInvalid}
          placeholder={m.speedPlaceholder}
          maxLength={16}
          aria-label={m.speedLimit}
          onChange={(value) => setOption('rateLimit', value)}
        />
      </ControlRow>
      <ControlRow label={m.fragments} hint={m.fragmentsHint}>
        <NumberInput
          value={options.concurrentFragments}
          min={MIN_FRAGMENTS}
          max={MAX_FRAGMENTS}
          width={80}
          label={m.fragments}
          onChange={(value) => setOption('concurrentFragments', value)}
        />
      </ControlRow>
    </Group>
  );
}

function CookieFileButton({ file }) {
  return (
    <Tooltip label={file || null} className="dl-file-anchor">
      <button type="button" className={file ? 'folder-path' : 'folder-path dl-file-missing'} onClick={pickCookiesFile}>
        <FileText size={15} />
        <span className="ellipsis">{file ? baseName(file) : m.chooseFile}</span>
      </button>
    </Tooltip>
  );
}

function cookiesHint(options) {
  if (options.cookiesMode === 'browser') return m.browserHint;
  if (options.cookiesMode === 'file') return m.cookiesFileHint;
  return m.cookiesHint;
}

function AccessGroup({ options }) {
  const mode = COOKIE_MODES.includes(options.cookiesMode) ? options.cookiesMode : 'none';
  const fileMissing = mode === 'file' && !options.cookiesFile;
  const proxyInvalid = !validProxy(options.proxy);
  return (
    <Group title={m.groups.access}>
      <ControlRow label={m.cookies} hint={cookiesHint(options)} error={fileMissing ? m.noFile : null} span>
        <div className="dl-cookie-modes">
          <Segmented
            block
            value={mode}
            options={COOKIE_OPTIONS}
            label={m.cookies}
            onChange={(value) => (value === 'file' && !options.cookiesFile ? pickCookiesFile() : setOption('cookiesMode', value))}
          />
        </div>
        <div className="dl-cookie-target">
          {mode === 'browser' && (
            <Select
              block
              value={BROWSERS.includes(options.cookiesBrowser) ? options.cookiesBrowser : 'edge'}
              options={BROWSER_OPTIONS}
              label={m.browser}
              onChange={(value) => setOption('cookiesBrowser', value)}
            />
          )}
          {mode === 'file' && <CookieFileButton file={options.cookiesFile || ''} />}
        </div>
      </ControlRow>
      <ControlRow label={m.proxy} hint={m.proxyHint} error={proxyInvalid ? m.proxyInvalid : null} span>
        <TextInput
          width={444}
          value={options.proxy ?? ''}
          invalid={proxyInvalid}
          placeholder={m.proxyPlaceholder}
          maxLength={512}
          aria-label={m.proxy}
          onChange={(value) => setOption('proxy', value)}
        />
      </ControlRow>
    </Group>
  );
}

export function MoreOptions({ options, draft, kind, changed, savedToken }) {
  const summary = moreSummary(options, { hasSection: kind === 'video' && Boolean(draft.section) });
  return (
    <Section
      title={m.title}
      icon={Wrench}
      summary={summary}
      storageKey="download-more"
      className="dl-more"
      actions={<SectionActions changed={changed} savedToken={savedToken} />}
    >
      <div className="dl-groups">
        <SubtitlesGroup options={options} />
        <EmbedGroup options={options} />
        <TransferGroup options={options} draft={draft} kind={kind} />
        <AccessGroup options={options} />
      </div>
    </Section>
  );
}
