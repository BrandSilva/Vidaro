const path = require('node:path');
const { app } = require('electron');

const APP_DIR = 'Vidaro';
const DEV_DIR = 'Vidaro Dev';

function hasCustomProfile() {
  return app.commandLine.hasSwitch('user-data-dir');
}

function configureDataPaths() {
  if (app.isPackaged || hasCustomProfile()) return;
  app.setPath('userData', path.join(app.getPath('appData'), DEV_DIR));
}

const IDENTITIES = {
  release: { appUserModelId: 'com.tridentsky.vidaro', toastActivator: '{F4A7A10D-C880-40B1-85EF-D4E227E7E8E0}' },
  test: { appUserModelId: 'com.tridentsky.vidaro.test', toastActivator: '{F87D0960-616F-40CD-B971-0F4D52C82E43}' },
  development: { appUserModelId: 'com.tridentsky.vidaro.dev', toastActivator: '{81032862-A209-4681-AC40-938855294CED}' }
};

function windowsIdentity() {
  if (!app.isPackaged) return IDENTITIES.development;
  return hasCustomProfile() ? IDENTITIES.test : IDENTITIES.release;
}

function localDataDir() {
  if (hasCustomProfile()) return path.join(app.getPath('userData'), 'Local');
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  return path.join(base, app.isPackaged ? APP_DIR : DEV_DIR);
}

function bundledBinDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'bin');
}

function userBinDir() {
  return path.join(localDataDir(), 'bin');
}

function tempDir() {
  return path.join(localDataDir(), 'temp');
}

function updatesDir() {
  return path.join(localDataDir(), 'updates');
}

function cacheDir() {
  return path.join(localDataDir(), 'cache');
}

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function ffmpegPath() {
  return path.join(bundledBinDir(), 'ffmpeg.exe');
}

function ffprobePath() {
  return path.join(bundledBinDir(), 'ffprobe.exe');
}

function bundledYtDlpPath() {
  return path.join(bundledBinDir(), 'yt-dlp.exe');
}

function ytDlpPath() {
  return path.join(userBinDir(), 'yt-dlp.exe');
}

function jsRuntime() {
  return { name: 'node', path: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function defaultDownloadFolder() {
  return path.join(app.getPath('videos'), 'Vidaro');
}

function defaultConvertFolder() {
  return path.join(app.getPath('videos'), 'Vidaro', 'Converted');
}

function sweepDirs() {
  return [bundledBinDir(), userBinDir()];
}

module.exports = {
  configureDataPaths,
  windowsIdentity,
  localDataDir,
  bundledBinDir,
  userBinDir,
  tempDir,
  updatesDir,
  cacheDir,
  userDataFile,
  ffmpegPath,
  ffprobePath,
  bundledYtDlpPath,
  ytDlpPath,
  jsRuntime,
  defaultDownloadFolder,
  defaultConvertFolder,
  sweepDirs
};
