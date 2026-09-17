import { useState } from 'react';
import { Film, Music } from 'lucide-react';
import { formatDuration } from '../lib/format.js';

export function Thumb({ src, width = 128, height = 72, duration, audio = false, iconSize = 22 }) {
  const [failed, setFailed] = useState(false);
  const Icon = audio ? Music : Film;
  return (
    <div className="thumb" style={{ width, height }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <Icon size={iconSize} />
      )}
      {Number.isFinite(duration) && duration > 0 && <span className="thumb-duration">{formatDuration(duration)}</span>}
    </div>
  );
}
