import { useEffect, useRef, useState } from 'react';
import { Moon, Power } from 'lucide-react';
import { Button } from '../components/Button.jsx';
import { ProgressBar } from '../components/Feedback.jsx';
import { api } from '../lib/api.js';
import { isModalOpen } from '../lib/shortcuts.js';
import { t } from '../strings/index.js';
import '../pages/settings/finish-countdown.css';

const f = t.settings.finish;
const DEFAULT_TOTAL = 60;
const FIGURE_SPACE = '\u2007';

function readPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.action !== 'shutdown' && payload.action !== 'sleep') return null;
  const remaining = Number(payload.remaining);
  if (!Number.isFinite(remaining)) return null;
  const total = Number.isFinite(payload.total) && payload.total > 0 ? payload.total : DEFAULT_TOTAL;
  return { action: payload.action, remaining: Math.max(0, Math.round(remaining)), total: Math.max(total, remaining) };
}

function isEditable(element) {
  if (!(element instanceof Element)) return false;
  return element.isContentEditable || Boolean(element.closest('input, textarea, select'));
}

export function FinishCountdown() {
  const [countdown, setCountdown] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const cancelRef = useRef(null);
  const visible = Boolean(countdown);

  useEffect(
    () =>
      api.app.onFinishCountdown((payload) => {
        const next = readPayload(payload);
        setCountdown(next);
        if (!next) {
          setCanceling(false);
          setAnnouncement('');
        }
      }),
    []
  );

  useEffect(() => {
    if (!visible) return;
    setAnnouncement((current) => current || (countdown.action === 'shutdown' ? f.shutdown(countdown.remaining) : f.sleep(countdown.remaining)));
    const active = document.activeElement;
    if (!isModalOpen() && !isEditable(active)) cancelRef.current?.querySelector('button')?.focus();
  }, [visible]);

  if (!countdown) return null;

  const shutdown = countdown.action === 'shutdown';
  const Icon = shutdown ? Power : Moon;
  const seconds = String(countdown.remaining).padStart(2, FIGURE_SPACE);
  const text = shutdown ? f.shutdown(seconds) : f.sleep(seconds);

  const cancel = () => {
    setCanceling(true);
    Promise.resolve(api.app.cancelFinishAction()).then(
      () => {
        setCountdown(null);
        setCanceling(false);
        setAnnouncement('');
      },
      () => setCanceling(false)
    );
  };

  return (
    <div className="finish-countdown" role="region" aria-label={f.hint}>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <div className="finish-countdown-row">
        <span className={shutdown ? 'finish-countdown-icon is-shutdown' : 'finish-countdown-icon'}>
          <Icon size={16} />
        </span>
        <div className="finish-countdown-text">
          <div className="finish-countdown-title num" aria-hidden="true">
            {text}
          </div>
          <div className="finish-countdown-hint">{f.hint}</div>
        </div>
        <span ref={cancelRef} className="finish-countdown-action">
          <Button variant="primary" size="sm" busy={canceling} onClick={cancel}>
            {f.cancel}
          </Button>
        </span>
      </div>
      <ProgressBar className="finish-countdown-bar" value={(countdown.remaining / countdown.total) * 100} label={text} />
    </div>
  );
}
