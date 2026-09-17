import { ArrowDownToLine, ListX, Pause, Play, Repeat2 } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { Select } from '../../components/Inputs.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { updateSection, useSettings } from '../../state/settings.js';
import { t } from '../../strings/index.js';
import { clearFinished, pauseAll, startAll } from './commands.js';
import { subtitleText } from './labels.js';

const q = t.queue;
const DOWNLOAD_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));
const CONVERT_OPTIONS = [1, 2, 3].map((value) => ({ value, label: String(value) }));

function selectDownloads(settings) {
  return settings?.download?.concurrency ?? 2;
}

function selectConversions(settings) {
  return settings?.convert?.concurrency ?? 1;
}

function Limit({ icon: Icon, text, hint, value, options, onChange }) {
  return (
    <Tooltip label={hint} className="q-limit">
      <span className="q-limit-icon">
        <Icon size={14} />
      </span>
      <span className="q-limit-text">{text}</span>
      <Select size="sm" width={54} value={value} options={options} label={hint} onChange={onChange} />
    </Tooltip>
  );
}

export function QueueHeader({ counts }) {
  const downloads = useSettings(selectDownloads);
  const conversions = useSettings(selectConversions);
  const hasJobs = counts.total > 0;

  return (
    <PageHeader
      title={q.title}
      subtitle={<span className="num">{subtitleText(counts)}</span>}
      actions={
        <>
          <div className="q-limits">
            <span className="q-limits-label">{q.atOnce}</span>
            <Limit
              icon={ArrowDownToLine}
              text={q.limitDownloads}
              hint={q.downloadsAtOnce}
              value={downloads}
              options={DOWNLOAD_OPTIONS}
              onChange={(value) => updateSection('download', { concurrency: value })}
            />
            <Limit
              icon={Repeat2}
              text={q.limitConversions}
              hint={q.conversionsAtOnce}
              value={conversions}
              options={CONVERT_OPTIONS}
              onChange={(value) => updateSection('convert', { concurrency: value })}
            />
          </div>
          <span className="q-header-divider" />
          <Button icon={ListX} disabled={counts.clearable === 0} tooltip={q.clearFinishedHint} onClick={clearFinished}>
            {q.clearFinished}
          </Button>
          <Button icon={Pause} disabled={counts.pausable === 0} tooltip={q.pauseAllHint} onClick={pauseAll}>
            {q.pauseAll}
          </Button>
          <Button
            variant={hasJobs ? 'primary' : 'secondary'}
            icon={Play}
            disabled={counts.startable === 0}
            tooltip={q.startAllHint}
            onClick={startAll}
          >
            {q.startAll}
          </Button>
        </>
      }
    />
  );
}
