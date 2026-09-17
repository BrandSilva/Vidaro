import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { TextInput } from '../../components/Inputs.jsx';
import { formatClock } from '../../lib/format.js';
import { setTrim } from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { parseTrim, trimFields } from './model.js';

const c = t.convert;

export function TrimEditor({ file, onClose }) {
  const [fields, setFields] = useState(() => trimFields(file.trim));
  const [error, setError] = useState(null);
  const applied = useRef(trimFields(file.trim));
  const startRef = useRef(null);
  const duration = file.media && file.media.duration > 0 ? file.media.duration : null;

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  const apply = (next = fields) => {
    const result = parseTrim(next.start, next.end, file.media);
    if (!result.ok) {
      setError(result);
      return;
    }
    setError(null);
    const normalized = trimFields(result.trim);
    applied.current = normalized;
    setFields(normalized);
    setTrim(file.id, result.trim);
  };

  const commit = () => {
    if (fields.start !== applied.current.start || fields.end !== applied.current.end) apply();
  };

  const clear = () => {
    const empty = { start: '', end: '' };
    applied.current = empty;
    setFields(empty);
    setError(null);
    setTrim(file.id, null);
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const edit = (key) => (value) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (error && error.field === key) setError(null);
  };

  return (
    <div className="cv-trim" onKeyDown={onKeyDown}>
      <div className="cv-trim-row">
        <span className="cv-trim-label">{c.trimStart}</span>
        <TextInput
          size="sm"
          width={128}
          className="num"
          value={fields.start}
          invalid={error?.field === 'start'}
          placeholder={c.trimStartPlaceholder}
          aria-label={c.trimStart}
          inputRef={startRef}
          maxLength={16}
          onChange={edit('start')}
          onCommit={commit}
        />
        <span className="cv-trim-label">{c.trimEnd}</span>
        <TextInput
          size="sm"
          width={128}
          className="num"
          value={fields.end}
          invalid={error?.field === 'end'}
          placeholder={duration ? formatClock(duration, true) : c.trimStartPlaceholder}
          aria-label={c.trimEnd}
          maxLength={16}
          onChange={edit('end')}
          onCommit={commit}
        />
        <Button size="sm" onClick={() => apply()}>
          {c.trimApply}
        </Button>
        <Button size="sm" variant="ghost" disabled={!file.trim && !fields.start && !fields.end} onClick={clear}>
          {c.trimClear}
        </Button>
        <span className="grow" />
        <IconButton icon={X} size="sm" label={t.common.close} onClick={onClose} />
      </div>
      <div className={error ? 'cv-trim-error' : 'cv-trim-hint'}>{error ? error.error : c.trimHint}</div>
    </div>
  );
}
