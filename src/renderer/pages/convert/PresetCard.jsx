import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, CircleAlert, Cpu, RotateCcw, TriangleAlert, Zap } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Badge, SavedFlag, Skeleton } from '../../components/Feedback.jsx';
import { TextInput } from '../../components/Inputs.jsx';
import { PresetSelect } from '../../components/preset/PresetSelect.jsx';
import { errorText, presetTags } from '../../components/preset/model.js';
import { formatBytes } from '../../lib/format.js';
import { resetWorking, saveWorkingAs, selectPreset } from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { planProblem } from './model.js';

const c = t.convert;
const NAME_MAX = 60;
const SKELETON_LINES = 3;

function SaveRow({ onDone }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const value = name.trim();
    if (!value) {
      setError(t.presets.nameRequired);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveWorkingAs(value);
      onDone(saved);
    } catch (failure) {
      setError(errorText(failure, t.presets.actionFailed));
      setBusy(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onDone(null);
  };

  return (
    <div className="cv-save" onKeyDown={onKeyDown}>
      <div className="cv-save-row">
        <TextInput
          className="grow"
          value={name}
          invalid={Boolean(error)}
          maxLength={NAME_MAX}
          placeholder={c.presetNamePlaceholder}
          aria-label={c.presetName}
          inputRef={inputRef}
          onChange={(value) => {
            setName(value);
            setError(null);
          }}
          onEnter={submit}
        />
        <Button variant="secondary" busy={busy} onClick={submit}>
          {c.savePreset}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDone(null)}>
          {c.cancel}
        </Button>
      </div>
      {error && <div className="cv-save-error">{error}</div>}
    </div>
  );
}

function PlanSummary({ plan, pending, working, schema, estimate, fileCount }) {
  if (!plan) {
    if (!pending) return null;
    return (
      <div className="cv-summary">
        {Array.from({ length: SKELETON_LINES }, (_, index) => (
          <Skeleton key={index} width={`${80 - index * 18}%`} height={12} />
        ))}
      </div>
    );
  }
  const problem = planProblem(plan);
  const [container] = presetTags(working, schema);
  const warnings = (plan.warnings || []).filter((code) => c.planWarnings[code]);
  const size = estimate.bytes !== null ? formatBytes(estimate.bytes) : null;
  const EncoderIcon = plan.encoder && plan.encoder.hardware ? Zap : Cpu;
  return (
    <div className="cv-summary">
      <div className="cv-summary-head">
        <span className="cv-summary-title">{c.summaryTitle}</span>
        {container && <Badge tone="accent">{container}</Badge>}
        {plan.encoder && <Badge icon={EncoderIcon}>{plan.encoder.label}</Badge>}
        {plan.encodersReady === false && <span className="cv-summary-note ellipsis">{c.encodersPending}</span>}
        <span className="grow" />
        {size && !problem && <span className="cv-summary-size num">{fileCount > 1 ? c.estimateTotal(size) : c.estimate(size)}</span>}
      </div>
      {problem ? (
        <div className="cv-summary-error">
          <CircleAlert size={14} />
          <span>{problem.hint ? `${problem.message} ${problem.hint}` : problem.message}</span>
        </div>
      ) : (
        <div className="cv-summary-lines">
          {plan.lines.map((line, index) => (
            <div key={`${index}-${line}`} className={index === 0 ? 'cv-summary-line is-main num' : 'cv-summary-line num'}>
              {line}
            </div>
          ))}
        </div>
      )}
      {warnings.map((code) => (
        <div key={code} className="cv-summary-warning">
          <TriangleAlert size={13} />
          <span>{c.planWarnings[code]}</span>
        </div>
      ))}
      {fileCount > 1 && <div className="cv-summary-note">{c.estimateFirst}</div>}
    </div>
  );
}

export function PresetCard({ list, schema, presetId, base, working, modified, plan, planPending, estimate, fileCount }) {
  const [saving, setSaving] = useState(false);
  const [savedToken, setSavedToken] = useState(0);

  const finishSave = (saved) => {
    setSaving(false);
    if (saved) setSavedToken(Date.now());
  };

  return (
    <section className="section cv-preset">
      <div className="cv-preset-head">
        <span className="cv-preset-label">{c.preset}</span>
        <SavedFlag token={savedToken} />
        <span className="grow" />
        {modified && base && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetWorking}>
            {c.resetChanges}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={BookmarkPlus} disabled={saving || !working} onClick={() => setSaving(true)}>
          {c.saveAsPreset}
        </Button>
      </div>
      <PresetSelect
        block
        value={presetId}
        list={list}
        modified={modified}
        placeholder={`${c.presetPlaceholder} ${t.presets.modified}`}
        label={c.preset}
        onChange={(id) => id && selectPreset(id)}
      />
      {saving && <SaveRow onDone={finishSave} />}
      <PlanSummary plan={plan} pending={planPending} working={working} schema={schema} estimate={estimate} fileCount={fileCount} />
    </section>
  );
}
