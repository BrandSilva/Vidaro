import { ExternalLink, Globe, Info } from 'lucide-react';
import logoUrl from '../../../../brand/logo.svg';
import { Button } from '../../components/Button.jsx';
import { Badge, Skeleton } from '../../components/Feedback.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../state/app.js';
import { t } from '../../strings/index.js';
import { GroupTitle, SettingsCard } from './controls.jsx';
import { LINKS } from './model.js';

const a = t.settings.about;

export function AboutCard({ sectionRef }) {
  const info = useApp((state) => state.info);
  return (
    <SettingsCard id="about" title={t.settings.sections.about} icon={Info} sectionRef={sectionRef}>
      <div className="st-about">
        <img className="st-about-logo" src={logoUrl} alt="" draggable={false} />
        <div className="st-about-text">
          <div className="st-about-name">
            <span>{t.common.appName}</span>
            {info ? <span className="st-about-version num">{a.version(info.version)}</span> : <Skeleton width={80} height={14} />}
          </div>
          <div className="muted">{a.tagline}</div>
          <div className="st-about-meta">
            <span>{a.by}</span>
            <span className="st-dot" />
            <span>{a.license}</span>
          </div>
        </div>
      </div>
      <div className="st-links">
        <Button variant="secondary" icon={ExternalLink} onClick={() => api.shell.openExternal(LINKS.repository)}>
          {a.repository}
        </Button>
        <Button variant="secondary" icon={ExternalLink} onClick={() => api.shell.openExternal(LINKS.releases)}>
          {a.releases}
        </Button>
        <Button variant="secondary" icon={Globe} onClick={() => api.shell.openExternal(LINKS.website)}>
          {a.website}
        </Button>
      </div>
      <GroupTitle>{a.thirdParty}</GroupTitle>
      <div className="st-credits">
        {a.credits.map((credit) => (
          <div className="st-credit" key={credit.name}>
            <span className="st-credit-name">{credit.name}</span>
            <Badge>{credit.license}</Badge>
            <span className="st-credit-note ellipsis">{credit.note}</span>
          </div>
        ))}
      </div>
      <div className="st-note st-credits-note">{a.thirdPartyNote}</div>
    </SettingsCard>
  );
}
