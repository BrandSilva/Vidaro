const path = require('node:path');
const { app, Tray, Menu, nativeImage } = require('electron');

function trayIconPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), 'build', 'icon.ico');
}

function createTray({ onShow, onPauseAll, onQuit, labels }) {
  let tray = null;
  let tooltip = 'Vidaro';

  function ensure() {
    if (tray) return tray;
    tray = new Tray(nativeImage.createFromPath(trayIconPath()));
    tray.setToolTip(tooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: labels.show, click: onShow },
        { label: labels.pauseAll, click: onPauseAll },
        { type: 'separator' },
        { label: labels.quit, click: onQuit }
      ])
    );
    tray.on('click', onShow);
    tray.on('double-click', onShow);
    return tray;
  }

  return {
    show() {
      ensure();
    },
    setTooltip(text) {
      tooltip = text.slice(0, 120);
      if (tray) tray.setToolTip(tooltip);
    },
    hide() {
      if (!tray) return;
      tray.destroy();
      tray = null;
    },
    visible: () => Boolean(tray),
    destroy() {
      if (!tray) return;
      tray.destroy();
      tray = null;
    }
  };
}

module.exports = { createTray, trayIconPath };
