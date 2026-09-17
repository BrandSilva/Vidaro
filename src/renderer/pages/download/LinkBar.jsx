import { ArrowRight, ClipboardPaste, CircleAlert, ClipboardX, Link2, X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { TextInput } from '../../components/Inputs.jsx';
import { Tooltip } from '../../components/Tooltip.jsx';
import { t } from '../../strings/index.js';
import {
  acceptChip,
  cancelFetch,
  dismissChip,
  fetchLink,
  pasteFromClipboard,
  resetDraft,
  setUrl
} from '../../state/download.js';
import { linkLabel, normalizeLink } from './model.js';

const d = t.download;
const TOOLTIP_MAX = 300;

function onPaste(event) {
  const input = event.currentTarget;
  const text = event.clipboardData?.getData('text') ?? '';
  const replacesAll = input.value === '' || (input.selectionStart === 0 && input.selectionEnd === input.value.length);
  if (!replacesAll || !normalizeLink(text)) return;
  event.preventDefault();
  fetchLink(text);
}

function onKeyDown(event) {
  if (event.key === 'Escape') cancelFetch();
}

function MetaLine({ linkInvalid, clipboardNote, chip }) {
  if (linkInvalid) {
    return (
      <div className="dl-link-note is-error">
        <CircleAlert size={13} />
        <span className="ellipsis">{d.link.invalid}</span>
      </div>
    );
  }
  if (clipboardNote) {
    return (
      <div className="dl-link-note">
        <ClipboardX size={13} />
        <span className="ellipsis">{d.link.clipboardEmpty}</span>
      </div>
    );
  }
  if (!chip) return null;
  return (
    <div className="dl-chip-row">
      <Tooltip label={chip.length > TOOLTIP_MAX ? `${chip.slice(0, TOOLTIP_MAX)}…` : chip} className="dl-chip-anchor">
        <button type="button" className="pill dl-chip" onClick={acceptChip} aria-label={`${d.link.chip} ${chip}`}>
          <ClipboardPaste size={13} />
          <span className="dl-chip-label">{d.link.chip}</span>
          <span className="dl-chip-url ellipsis">{linkLabel(chip)}</span>
        </button>
      </Tooltip>
      <IconButton icon={X} size="sm" label={d.link.chipDismiss} onClick={dismissChip} />
    </div>
  );
}

export function LinkBar({ url, linkInvalid, clipboardNote, chip, pasteKeys }) {
  return (
    <div className="dl-top">
      <div className="section dl-linkbar">
        <span className="dl-link-icon">
          <Link2 size={18} />
        </span>
        <TextInput
          size="lg"
          className="dl-link-input"
          value={url}
          invalid={linkInvalid}
          placeholder={d.link.placeholder}
          aria-label={d.link.label}
          onChange={setUrl}
          onEnter={(value) => fetchLink(value)}
          onPaste={onPaste}
          onKeyDownCapture={onKeyDown}
          autoComplete="off"
          suffix={url ? <IconButton icon={X} size="sm" label={d.link.clear} onClick={resetDraft} /> : null}
        />
        <Button size="lg" icon={ClipboardPaste} tooltip={pasteKeys ? `${d.link.pasteHint} (${pasteKeys})` : d.link.pasteHint} onClick={pasteFromClipboard}>
          {d.link.paste}
        </Button>
        <Button size="lg" iconRight={ArrowRight} tooltip={d.link.getHint} disabled={!url.trim()} onClick={() => fetchLink(url)}>
          {d.link.get}
        </Button>
      </div>
      <div className="dl-link-meta">
        <MetaLine linkInvalid={linkInvalid} clipboardNote={clipboardNote} chip={chip} />
      </div>
    </div>
  );
}
