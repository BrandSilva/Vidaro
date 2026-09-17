const path = require('node:path');
const { spawn } = require('node:child_process');
const { powerSaveBlocker, Notification } = require('electron');
const { trayIconPath } = require('./tray');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const COUNTDOWN_SECONDS = 60;
const SLEEP_SCRIPT = "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)";

function runDetached(file, args) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

function performFinishAction(action) {
  if (action === 'shutdown') runDetached(path.join(SYSTEM32, 'shutdown.exe'), ['/s', '/t', '0']);
  else if (action === 'sleep') {
    runDetached(path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', SLEEP_SCRIPT]);
  }
}

function createPowerManager({ queue, getWindow, getSettings, send, showWindow, labels, onBackgroundIdle, onFinishAction }) {
  let blocker = null;
  let lastTaskbar = -2;
  let taskbarTimer = null;
  let countdown = null;
  let finished = { downloads: 0, conversions: 0, failed: 0 };
  let hadWork = false;

  function updateBlocker(active) {
    if (active > 0 && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if (active === 0 && blocker !== null) {
      if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  }

  function updateTaskbar() {
    taskbarTimer = null;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const counts = queue.counts();
    if (counts.running === 0) {
      if (lastTaskbar !== -1) win.setProgressBar(-1);
      lastTaskbar = -1;
      return;
    }
    const { percent } = queue.activeSummary();
    const value = Number.isFinite(percent) ? Math.round(percent) / 100 : 2;
    if (value === lastTaskbar) return;
    lastTaskbar = value;
    win.setProgressBar(value, { mode: value > 1 ? 'indeterminate' : 'normal' });
  }

  function scheduleTaskbar() {
    if (taskbarTimer) return;
    taskbarTimer = setTimeout(updateTaskbar, 1000);
  }

  function notify(title, body) {
    if (!getSettings().general.notifyOnFinish || !Notification.isSupported()) return;
    const win = getWindow();
    if (win && win.isVisible() && win.isFocused()) return;
    const notification = new Notification({ title, body, icon: trayIconPath(), silent: false });
    notification.on('click', () => showWindow('queue'));
    notification.show();
  }

  function cancelCountdown() {
    if (!countdown) return false;
    clearInterval(countdown.timer);
    countdown = null;
    send('app:finish-countdown', null);
    return true;
  }

  function startCountdown(action) {
    cancelCountdown();
    let remaining = COUNTDOWN_SECONDS;
    showWindow();
    send('app:finish-countdown', { action, remaining, total: COUNTDOWN_SECONDS });
    const timer = setInterval(async () => {
      remaining -= 1;
      if (remaining > 0) {
        send('app:finish-countdown', { action, remaining, total: COUNTDOWN_SECONDS });
        return;
      }
      cancelCountdown();
      await onFinishAction(action);
    }, 1000);
    countdown = { action, timer };
  }

  function onChanged() {
    const counts = queue.counts();
    updateBlocker(counts.running + counts.queued);
    if (counts.running + counts.queued > 0) {
      hadWork = true;
      if (countdown) cancelCountdown();
    }
    scheduleTaskbar();
  }

  function onFinished(job) {
    if (job.state === 'done') {
      if (job.kind === 'download') finished.downloads += 1;
      else finished.conversions += 1;
    } else if (job.state === 'failed') {
      finished.failed += 1;
    }
  }

  function onIdle() {
    if (!hadWork) return;
    hadWork = false;
    const summary = finished;
    finished = { downloads: 0, conversions: 0, failed: 0 };
    if (summary.downloads + summary.conversions + summary.failed > 0) {
      notify(labels.finishedTitle(summary), labels.finishedBody(summary));
    }
    const win = getWindow();
    const action = getSettings().general.onQueueFinish;
    if (action !== 'nothing' && summary.failed === 0) {
      startCountdown(action);
      return;
    }
    if (win && !win.isDestroyed() && !win.isVisible()) onBackgroundIdle();
  }

  queue.on('changed', onChanged);
  queue.on('progress', scheduleTaskbar);
  queue.on('job-finished', onFinished);
  queue.on('idle', onIdle);
  onChanged();

  return {
    cancelCountdown,
    countdownState: () => (countdown ? { action: countdown.action } : null),
    dispose() {
      queue.off('changed', onChanged);
      queue.off('progress', scheduleTaskbar);
      queue.off('job-finished', onFinished);
      queue.off('idle', onIdle);
      clearTimeout(taskbarTimer);
      cancelCountdown();
      updateBlocker(0);
      const win = getWindow();
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
    }
  };
}

module.exports = { createPowerManager, performFinishAction };
