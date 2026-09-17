import { memo, useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, ScanSearch, Scissors, X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { Badge, Skeleton } from '../../components/Feedback.jsx';
import { Thumb } from '../../components/Thumb.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { cx } from '../../lib/cx.js';
import { formatBytes, formatDuration } from '../../lib/format.js';
import { analyzeFile, cancelAnalysis, removeFiles, requestThumbnail } from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { analysisView, effectiveDuration, mediaChips, planProblem, trimText } from './model.js';
import { TrimEditor } from './TrimEditor.jsx';

const c = t.convert;
const THUMB_WIDTH = 112;
const THUMB_HEIGHT = 63;

function useThumbnail(ref, file) {
  const wanted = file.status === 'ready' && file.thumbState === 'idle';
  useEffect(() => {
    const node = ref.current;
    if (!wanted || !node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        requestThumbnail(file.id);
      },
      { rootMargin: '240px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, wanted, file.id]);
}

function WarningChip({ chip, file }) {
  const running = file.analysis && file.analysis.status === 'running';
  return (
    <span className="cv-chip">
      <Tooltip label={c.chipHints[chip.code]} side="top">
        <Badge tone={chip.tone}>{c.chips[chip.code]}</Badge>
      </Tooltip>
      {chip.analyze && !running && (
        <Tooltip label={c.analyzeHint} side="top">
          <Button size="sm" variant="ghost" icon={ScanSearch} className="cv-chip-action" onClick={() => analyzeFile(file.id)}>
            {c.analyze}
          </Button>
        </Tooltip>
      )}
    </span>
  );
}

function AnalysisState({ file }) {
  const analysis = file.analysis;
  if (!analysis) return null;
  if (analysis.status === 'running') {
    return (
      <span className="cv-chip">
        <Badge tone="accent" icon={LoaderCircle} className="cv-badge-busy">
          {c.analyzing}
        </Badge>
        <IconButton icon={X} size="sm" iconSize={13} label={c.cancelAnalyze} className="cv-chip-icon" onClick={() => cancelAnalysis(file.id)} />
      </span>
    );
  }
  if (analysis.status === 'error') {
    return (
      <Tooltip label={analysis.error} side="top">
        <Badge tone="danger" icon={CircleAlert}>
          {c.analyzeFailed}
        </Badge>
      </Tooltip>
    );
  }
  const view = analysisView(analysis.result);
  if (!view) return null;
  return (
    <Tooltip label={c.analysisHints[view.key]} side="top">
      <Badge tone={view.tone}>{c.analysis[view.key]}</Badge>
    </Tooltip>
  );
}

function ProblemText({ problem }) {
  const text = problem.hint ? `${problem.message} ${problem.hint}` : problem.message;
  return (
    <Tooltip label={text} side="top" className="cv-problem">
      <span className="cv-problem-text ellipsis">
        <CircleAlert size={13} />
        {problem.message}
      </span>
    </Tooltip>
  );
}

function ProbingCard() {
  return (
    <div className="cv-card is-probing" aria-busy="true">
      <div className="cv-card-main">
        <Skeleton width={THUMB_WIDTH} height={THUMB_HEIGHT} radius={8} />
        <div className="cv-card-body">
          <Skeleton width="58%" height={13} />
          <Skeleton width="72%" height={16} />
          <Skeleton width="34%" height={12} />
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ file }) {
  return (
    <div className="cv-card is-error">
      <div className="cv-card-main">
        <div className="cv-card-thumb-error" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
          <CircleAlert size={22} />
        </div>
        <div className="cv-card-body">
          <Tooltip label={file.path} className="cv-card-title">
            <span className="cv-card-name ellipsis">{file.name}</span>
          </Tooltip>
          <ProblemText problem={file.error || { message: c.readFailed }} />
        </div>
        <div className="cv-card-actions">
          <IconButton icon={X} tone="danger" label={c.remove} onClick={() => removeFiles([file.id])} />
        </div>
      </div>
    </div>
  );
}

function ReadyCard({ file, plan }) {
  const ref = useRef(null);
  const [trimOpen, setTrimOpen] = useState(false);
  useThumbnail(ref, file);
  const { media } = file;
  const problem = file.rejection || planProblem(plan);
  const chips = mediaChips(media, file.analysis);
  const duration = effectiveDuration(media, file.trim);
  return (
    <div ref={ref} className={cx('cv-card', trimOpen && 'is-expanded', problem && 'has-problem')}>
      <div className="cv-card-main">
        <Thumb src={file.thumbnail} width={THUMB_WIDTH} height={THUMB_HEIGHT} duration={media.duration} audio={!media.video} />
        <div className="cv-card-body">
          <Tooltip label={file.path} className="cv-card-title">
            <span className="cv-card-name ellipsis">{file.name}</span>
          </Tooltip>
          <div className="cv-card-badges">
            {media.badges.map((badge, index) => (
              <Badge key={`${index}-${badge}`}>{badge}</Badge>
            ))}
          </div>
          <div className="cv-card-meta">
            <span className="num">{formatBytes(media.size)}</span>
            <span className="cv-sep">·</span>
            <span className="num">{Number.isFinite(duration) ? formatDuration(duration) : c.unknownDuration}</span>
            {file.trim && (
              <Badge tone="accent" icon={Scissors} className="num">
                {trimText(file.trim)}
              </Badge>
            )}
            {problem ? (
              <ProblemText problem={problem} />
            ) : (
              <>
                <AnalysisState file={file} />
                {chips.map((chip) => (
                  <WarningChip key={chip.code} chip={chip} file={file} />
                ))}
              </>
            )}
          </div>
        </div>
        <div className="cv-card-actions">
          <IconButton icon={Scissors} label={c.trim} className={trimOpen ? 'is-on' : undefined} aria-pressed={trimOpen} onClick={() => setTrimOpen((open) => !open)} />
          <IconButton icon={X} tone="danger" label={c.remove} onClick={() => removeFiles([file.id])} />
        </div>
      </div>
      {trimOpen && <TrimEditor file={file} onClose={() => setTrimOpen(false)} />}
    </div>
  );
}

export const FileCard = memo(function FileCard({ file, plan }) {
  if (file.status === 'probing') return <ProbingCard />;
  if (file.status === 'error') return <ErrorCard file={file} />;
  return <ReadyCard file={file} plan={plan} />;
});
