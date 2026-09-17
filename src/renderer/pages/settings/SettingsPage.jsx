import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  CircleArrowUp,
  Film,
  Info,
  Keyboard,
  RotateCcw,
  SlidersHorizontal,
  Stethoscope,
  TerminalSquare
} from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { Select } from '../../components/Inputs.jsx';
import { cx } from '../../lib/cx.js';
import { useSettings } from '../../state/settings.js';
import { PageHeader } from '../../shell/PageHeader.jsx';
import { t } from '../../strings/index.js';
import { SettingsContext, useDefaults, useNarrow, usePresetList, useScrollSpy, useSettingsActions, useYtdlpStatus } from './hooks.js';
import { SECTION_IDS, differsFromDefault, resetAllKeys } from './model.js';
import { GeneralCard } from './GeneralCard.jsx';
import { DownloadsCard } from './DownloadsCard.jsx';
import { ConversionsCard } from './ConversionsCard.jsx';
import { YtDlpCard } from './YtDlpCard.jsx';
import { ShortcutsCard } from './ShortcutsCard.jsx';
import { UpdatesCard } from './UpdatesCard.jsx';
import { DiagnosticsCard } from './DiagnosticsCard.jsx';
import { AboutCard } from './AboutCard.jsx';
import './settings.css';

const s = t.settings;
const NARROW_WIDTH = 900;
const ICONS = {
  general: SlidersHorizontal,
  downloads: ArrowDownToLine,
  conversions: Film,
  ytdlp: TerminalSquare,
  shortcuts: Keyboard,
  updates: CircleArrowUp,
  diagnostics: Stethoscope,
  about: Info
};
const NAV_OPTIONS = SECTION_IDS.map((id) => ({ value: id, label: s.sections[id] }));
const RESET_KEYS = resetAllKeys();

function SubNav({ active, onJump }) {
  return (
    <nav className="st-nav" aria-label={s.jumpTo}>
      {SECTION_IDS.map((id) => {
        const Icon = ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className={cx('st-nav-item', active === id && 'is-active')}
            aria-current={active === id ? 'true' : undefined}
            onClick={() => onJump(id)}
          >
            <Icon size={15} />
            <span className="ellipsis">{s.sections[id]}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ResetAll({ onConfirm, disabled }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="st-reset-all">
      <div className="st-reset-text">
        <div className="setting-label">{s.resetAll.title}</div>
        <div className="setting-hint">{s.resetAll.hint}</div>
      </div>
      <Button variant="danger" icon={RotateCcw} disabled={disabled} onClick={() => setOpen(true)}>
        {s.resetAll.button}
      </Button>
      <Dialog
        open={open}
        title={s.resetAll.confirmTitle}
        text={s.resetAll.confirmText}
        onCancel={close}
        actions={[
          { id: 'cancel', label: s.resetAll.cancel, variant: 'secondary', autoFocus: true, onSelect: close },
          {
            id: 'reset',
            label: s.resetAll.confirm,
            variant: 'danger',
            icon: RotateCcw,
            onSelect: () => {
              close();
              onConfirm();
            }
          }
        ]}
      />
    </div>
  );
}

export function SettingsPage() {
  const settings = useSettings((state) => state);
  const defaults = useDefaults();
  const actions = useSettingsActions();
  const ytdlp = useYtdlpStatus();
  const presets = usePresetList();
  const bodyRef = useRef(null);
  const narrow = useNarrow(bodyRef, NARROW_WIDTH);
  const { active, register, jump } = useScrollSpy(bodyRef, SECTION_IDS);

  const context = useMemo(() => ({ settings, defaults, presets, ...actions }), [settings, defaults, presets, actions]);
  const anyChanged = useMemo(() => differsFromDefault(settings, defaults, RESET_KEYS.filter((key) => key !== 'shortcuts')) || Object.keys(settings.shortcuts || {}).length > 0, [settings, defaults]);

  return (
    <SettingsContext.Provider value={context}>
      <div className="page st-page">
        <PageHeader
          title={s.title}
          actions={narrow ? <Select value={active} options={NAV_OPTIONS} width={200} label={s.jumpTo} onChange={jump} /> : null}
        />
        <div className="page-body st-body" ref={bodyRef}>
          <div className={cx('st-layout', narrow && 'is-narrow')}>
            {!narrow && <SubNav active={active} onJump={jump} />}
            <div className="st-content">
              <GeneralCard sectionRef={register('general')} />
              <DownloadsCard sectionRef={register('downloads')} />
              <ConversionsCard sectionRef={register('conversions')} />
              <YtDlpCard sectionRef={register('ytdlp')} ytdlp={ytdlp} />
              <ShortcutsCard sectionRef={register('shortcuts')} />
              <UpdatesCard sectionRef={register('updates')} />
              <DiagnosticsCard sectionRef={register('diagnostics')} ytdlp={ytdlp} />
              <AboutCard sectionRef={register('about')} />
              <ResetAll disabled={!anyChanged} onConfirm={() => actions.reset(RESET_KEYS)} />
            </div>
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}
