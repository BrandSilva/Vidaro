import { useEffect, useMemo, useState } from 'react';
import { cx } from './lib/cx.js';
import { dispatchKeydown, setBindings, useShortcut } from './lib/shortcuts.js';
import { useSettings } from './state/settings.js';
import { initApp, navigate, useApp } from './state/app.js';
import { initQueue, useQueue, summarize } from './state/queue.js';
import { api } from './lib/api.js';
import { TitleBar } from './shell/TitleBar.jsx';
import { Rail } from './shell/Rail.jsx';
import { StatusBar } from './shell/StatusBar.jsx';
import { CloseDialog } from './shell/CloseDialog.jsx';
import { NoticeStack } from './shell/NoticeStack.jsx';
import { DropLayer } from './shell/DropLayer.jsx';
import { DownloadPage } from './pages/download/DownloadPage.jsx';
import { ConvertPage } from './pages/convert/ConvertPage.jsx';
import { QueuePage } from './pages/queue/QueuePage.jsx';
import { PresetsPage } from './pages/presets/PresetsPage.jsx';
import { SettingsPage } from './pages/settings/SettingsPage.jsx';

const PAGE_COMPONENTS = {
  download: DownloadPage,
  convert: ConvertPage,
  queue: QueuePage,
  presets: PresetsPage,
  settings: SettingsPage
};

function useCompact() {
  const query = '(max-width: 1099px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setCompact(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return compact;
}

function useGlobalInput() {
  useEffect(() => {
    const onKeyDown = (event) => dispatchKeydown(event);
    const onClick = (event) => {
      if (event.detail === 0) return;
      const target = event.target instanceof Element ? event.target.closest('button, [role="button"], a, [role="switch"]') : null;
      if (target && document.activeElement === target) target.blur();
    };
    const onAuxClick = (event) => {
      if (event.button === 1) event.preventDefault();
    };
    const onContextMenu = (event) => {
      const editable = event.target instanceof Element && event.target.closest('input, textarea, .selectable');
      if (!editable) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onAuxClick);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onAuxClick);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}

function NavigationShortcuts() {
  useShortcut('goDownload', () => navigate('download'));
  useShortcut('goConvert', () => navigate('convert'));
  useShortcut('goQueue', () => navigate('queue'));
  useShortcut('goPresets', () => navigate('presets'));
  useShortcut('goSettings', () => navigate('settings'));
  useShortcut('openSettings', () => navigate('settings'));
  useShortcut('quit', () => api.app.quit());
  return null;
}

export default function App() {
  const settings = useSettings();
  const page = useApp((state) => state.page);
  const jobs = useQueue((state) => state.jobs);
  const compact = useCompact();
  const shortcuts = settings?.shortcuts;

  useGlobalInput();

  useEffect(() => {
    setBindings(shortcuts || {});
  }, [shortcuts]);

  useEffect(() => {
    let disposeApp = null;
    let disposeQueue = null;
    let alive = true;
    initApp().then((dispose) => {
      if (alive) disposeApp = dispose;
      else dispose();
      api.app.rendererReady();
    });
    initQueue().then(
      (dispose) => {
        if (alive) disposeQueue = dispose;
        else dispose();
      },
      () => {}
    );
    return () => {
      alive = false;
      disposeApp?.();
      disposeQueue?.();
    };
  }, []);

  const queueBadge = useMemo(() => summarize(jobs).active, [jobs]);
  const Page = PAGE_COMPONENTS[page] || DownloadPage;

  return (
    <div className={cx('app', compact && 'is-compact')}>
      <TitleBar />
      <Rail compact={compact} queueBadge={queueBadge} />
      <main className="main">
        <NoticeStack />
        <Page key={page} />
      </main>
      <StatusBar />
      <NavigationShortcuts />
      <CloseDialog />
      <DropLayer />
    </div>
  );
}
