import { useMemo } from 'react';
import { Globe, ListVideo } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Feedback.jsx';
import { Checkbox, TextInput } from '../../components/Inputs.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { applyRange, selectAllEntries, setOption, setRangeText } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { ENTRY_LIMIT, durationStats, selectAllState } from './selection.js';
import { playlistCount } from './requests.js';
import { durationText, fileNameFor } from './labels.js';
import { InlineSwitch } from './parts.jsx';
import { CustomTemplate, TemplateSelect, siteLabel } from './VideoCard.jsx';
import { EntryList } from './EntryList.jsx';

const p = t.download.playlist;

function Header({ info, entries }) {
  const title = info.playlistTitle || info.title || p.fallbackTitle;
  const stats = useMemo(() => durationStats(entries), [entries]);
  const duration = durationText(stats);
  const site = siteLabel(info);
  return (
    <div className="dl-pl-head">
      <span className="dl-pl-icon">
        <ListVideo size={20} />
      </span>
      <div className="dl-pl-heading">
        <Tooltip label={title} className="dl-pl-title-anchor">
          <h2 className="dl-pl-title ellipsis">{title}</h2>
        </Tooltip>
        <div className="dl-meta">
          {info.channel && <span className="dl-meta-text ellipsis">{info.channel}</span>}
          <span className="dl-meta-text num">
            {info.channel && <span className="dl-dot">·</span>}
            {p.videos(entries.length)}
          </span>
          {duration && (
            <span className="dl-meta-text num">
              <span className="dl-dot">·</span>
              {duration}
            </span>
          )}
          {site && (
            <Badge icon={Globe} className="dl-site">
              {site}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function Names({ options, preview, extension }) {
  const example = fileNameFor(preview, extension);
  return (
    <div className="dl-pl-names-block">
      <div className="dl-pl-names">
        <span className="dl-pl-label">{t.download.template.fileNames}</span>
        <TemplateSelect value={options.nameTemplate} />
        <Tooltip label={p.numberFilesHint}>
          <InlineSwitch label={p.numberFiles} checked={options.numberPlaylist !== false} onChange={(value) => setOption('numberPlaylist', value)} />
        </Tooltip>
        {example && (
          <Tooltip label={example} className="dl-pl-example">
            <span className="ellipsis">
              <span className="dl-pl-example-label">{t.download.template.example}</span>
              {example}
            </span>
          </Tooltip>
        )}
      </div>
      <CustomTemplate options={options} />
    </div>
  );
}

function Toolbar({ entries, selection, rangeText, rangeError }) {
  const state = selectAllState(entries, selection);
  const stats = useMemo(() => durationStats(entries, selection), [entries, selection]);
  const duration = durationText(stats);
  return (
    <div className="dl-pl-toolbar">
      <span className="dl-entry-check">
        <Checkbox checked={state.all} indeterminate={state.some} disabled={state.total === 0} label={p.toggleAll} onChange={(value) => selectAllEntries(value)} />
      </span>
      <span className="dl-pl-count num">{p.selected(state.count, state.total)}</span>
      <span className="dl-pl-duration num">{duration}</span>
      <span className="grow" />
      <Tooltip label={rangeError ? p.rangeInvalid : p.rangeHint}>
        <TextInput
          size="sm"
          width={170}
          className="num"
          prefix={p.range}
          value={rangeText}
          invalid={rangeError}
          placeholder={p.rangePlaceholder}
          maxLength={200}
          aria-label={p.range}
          onChange={setRangeText}
          onEnter={() => applyRange()}
        />
      </Tooltip>
      <Button size="sm" disabled={!rangeText.trim()} onClick={applyRange}>
        {p.rangeApply}
      </Button>
    </div>
  );
}

export function PlaylistCard({ info, options, preview, extension, selection, rangeText, rangeError }) {
  const entries = info.entries;
  const total = playlistCount(info);
  return (
    <div className="section dl-playlist">
      <Header info={info} entries={entries} />
      <Names options={options} preview={preview} extension={extension} />
      <div className="dl-pl-list">
        <Toolbar entries={entries} selection={selection} rangeText={rangeText} rangeError={rangeError} />
        <EntryList entries={entries} selection={selection} />
        {entries.length >= ENTRY_LIMIT && total > entries.length && <div className="dl-form-hint">{p.showing(entries.length, total)}</div>}
      </div>
    </div>
  );
}
