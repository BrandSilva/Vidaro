import logoUrl from '../../../brand/logo.svg';
import { t } from '../strings/index.js';
import { UpdatePill } from './UpdatePill.jsx';

export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img className="titlebar-logo" src={logoUrl} alt="" draggable={false} />
        <span className="titlebar-name">{t.common.appName}</span>
      </div>
      <div className="titlebar-spacer" />
      <UpdatePill />
    </header>
  );
}
