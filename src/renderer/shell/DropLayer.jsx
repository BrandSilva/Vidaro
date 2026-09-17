import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Link2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../state/app.js';
import { t } from '../strings/index.js';
import { emitInputs } from '../state/inputs.js';

function describe(dataTransfer) {
  const types = [...(dataTransfer?.types || [])];
  if (types.includes('Files')) return 'files';
  if (types.includes('text/uri-list') || types.includes('text/plain')) return 'link';
  return null;
}

function extractUrl(dataTransfer) {
  const raw = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '';
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'));
  return line && /^https?:\/\//i.test(line) ? line : null;
}

export function DropLayer() {
  const [kind, setKind] = useState(null);
  const depth = useRef(0);

  useEffect(() => {
    const onEnter = (event) => {
      const next = describe(event.dataTransfer);
      if (!next) return;
      event.preventDefault();
      depth.current += 1;
      setKind(next);
    };
    const onOver = (event) => {
      if (!describe(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setKind(null);
    };
    const onDrop = (event) => {
      event.preventDefault();
      depth.current = 0;
      setKind(null);
      const files = [...(event.dataTransfer?.files || [])].map((file) => api.files.pathFor(file)).filter(Boolean);
      if (files.length) {
        navigate('convert');
        emitInputs({ files, urls: [] });
        return;
      }
      const url = extractUrl(event.dataTransfer);
      if (url) {
        navigate('download');
        emitInputs({ files: [], urls: [url] });
      }
    };
    const onEnd = () => {
      depth.current = 0;
      setKind(null);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('blur', onEnd);
    const dispose = api.app.onOpenInputs((payload) => {
      if (payload.files?.length) navigate('convert');
      else if (payload.urls?.length) navigate('download');
      emitInputs(payload);
    });
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('blur', onEnd);
      dispose();
    };
  }, []);

  if (!kind) return null;
  const Icon = kind === 'files' ? FilePlus2 : Link2;
  return (
    <div className="dropzone-overlay">
      <div className="dropzone-card">
        <Icon size={34} />
        {kind === 'files' ? t.app.dropFiles : t.app.dropLink}
      </div>
    </div>
  );
}
