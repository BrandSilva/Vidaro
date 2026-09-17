import { Globe, ListVideo, Radio, Undo2 } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { Badge, Notice } from '../../components/Feedback.jsx';
import { Select, TextInput } from '../../components/Inputs.jsx';
import { Thumb } from '../../components/Thumb.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { formatUploadDate } from '../../lib/format.js';
import { openPlaylist, restoreFileName, setFileName, setOption } from '../../state/download.js';
import { t } from '../../strings/index.js';
import { TEMPLATES, templateInvalid } from './model.js';

const d = t.download;
const TEMPLATE_OPTIONS = TEMPLATES.map((id) => ({ value: id, label: d.templates[id] }));

export function siteLabel(info) {
  if (info.site) return info.site.replace(/^www\./i, '');
  if (info.extractor && !/^generic$/i.test(info.extractor)) return info.extractor;
  return null;
}

export function TemplateSelect({ value, width = 168 }) {
  return (
    <Select
      value={TEMPLATES.includes(value) ? value : 'title'}
      options={TEMPLATE_OPTIONS}
      onChange={(next) => setOption('nameTemplate', next)}
      width={width}
      label={d.template.label}
    />
  );
}

export function CustomTemplate({ options }) {
  if (options.nameTemplate !== 'custom') return null;
  const invalid = templateInvalid(options);
  return (
    <div className="dl-custom">
      <TextInput
        className="dl-custom-input"
        value={options.customTemplate ?? ''}
        invalid={invalid}
        placeholder={d.template.customPlaceholder}
        aria-label={d.template.customLabel}
        maxLength={512}
        onChange={(value) => setOption('customTemplate', value)}
      />
      <div className={invalid ? 'dl-form-hint is-error' : 'dl-form-hint'}>{invalid ? d.template.customInvalid : d.template.customHint}</div>
    </div>
  );
}

function Meta({ info }) {
  const date = formatUploadDate(info.uploadDate);
  const site = siteLabel(info);
  const parts = [info.channel, date].filter(Boolean);
  return (
    <div className="dl-meta">
      {info.isLive && (
        <Badge tone="danger" icon={Radio}>
          {d.video.live}
        </Badge>
      )}
      {parts.map((part, index) => (
        <span key={part} className={index === 0 && info.channel ? 'dl-meta-text ellipsis' : 'dl-meta-text num'}>
          {index > 0 && <span className="dl-dot">·</span>}
          {part}
        </span>
      ))}
      {site && (
        <Badge icon={Globe} className="dl-site">
          {site}
        </Badge>
      )}
    </div>
  );
}

export function VideoCard({ info, fileName, nameEdited, preview, options, extension }) {
  return (
    <div className="section dl-video">
      <Thumb src={info.thumbnail} width={192} height={108} duration={info.duration} audio={info.hasVideo === false} iconSize={30} />
      <div className="dl-video-body">
        <Tooltip label={info.title} className="dl-title-anchor">
          <h2 className="dl-title">{info.title}</h2>
        </Tooltip>
        <Meta info={info} />
        {info.playlistHint && (
          <div className="dl-playlist-hint">
            <Button size="sm" variant="ghost" icon={ListVideo} tooltip={d.video.wholePlaylistHint} onClick={openPlaylist}>
              {d.video.wholePlaylist}
            </Button>
          </div>
        )}
        <div className="dl-name">
          <div className="field-label">{d.video.fileName}</div>
          <div className="dl-name-row">
            <TextInput
              className="dl-name-input"
              value={fileName}
              placeholder={preview}
              aria-label={d.video.fileNameLabel}
              maxLength={360}
              suffix={
                <Tooltip label={d.video.extensionHint}>
                  <span className="dl-ext">.{extension}</span>
                </Tooltip>
              }
              onChange={setFileName}
            />
            {nameEdited && preview && fileName !== preview && (
              <IconButton icon={Undo2} label={d.video.restoreName} outlined onClick={restoreFileName} />
            )}
            <TemplateSelect value={options.nameTemplate} />
          </div>
          <CustomTemplate options={options} />
        </div>
      </div>
    </div>
  );
}

export function VideoNotices({ info, options }) {
  const notices = [];
  if (info.drm) notices.push({ id: 'drm', tone: 'danger', text: d.video.drmNotice });
  if (info.liveStatus === 'is_upcoming') notices.push({ id: 'upcoming', tone: 'warning', text: d.video.upcomingNotice });
  if (info.isLive) notices.push({ id: 'live', tone: 'info', text: d.video.liveNotice });
  if (info.ageLimit >= 18 && options.cookiesMode === 'none') notices.push({ id: 'age', tone: 'info', text: d.video.ageNotice });
  if (notices.length === 0) return null;
  return notices.map((notice) => (
    <Notice key={notice.id} tone={notice.tone}>
      {notice.text}
    </Notice>
  ));
}
