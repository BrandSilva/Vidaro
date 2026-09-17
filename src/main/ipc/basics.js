const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, dialog, shell, clipboard } = require('electron');
const paths = require('../paths');
const v = require('../validate');
const settingsSchema = require('../settings');
const { isAllowedExternal } = require('../window');

const MEDIA_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'asf', 'flv', 'f4v', 'mpg', 'mpeg', 'm2v', 'vob', 'ts', 'm2ts', 'mts',
  'mxf', 'dv', 'dif', '3gp', '3g2', 'ogv', 'rm', 'rmvb', 'divx', 'xvid', 'y4m', 'hevc', 'h264', '264', 'mjpeg',
  'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'ac3', 'eac3', 'dts', 'aif', 'aiff', 'amr', 'mka', 'mp2', 'caf'
];
const MEDIA_SET = new Set(MEDIA_EXTENSIONS);
const MAX_EXPANDED = 2000;

function ownerWindow(ctx) {
  return ctx.window && !ctx.window.isDestroyed() ? ctx.window : undefined;
}

async function existingFolder(candidate) {
  let current = candidate;
  for (let i = 0; i < 32 && current; i += 1) {
    try {
      const stat = await fsp.stat(current);
      if (stat.isDirectory()) return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
  return undefined;
}

function isMediaFile(filePath) {
  return MEDIA_SET.has(path.extname(filePath).slice(1).toLowerCase());
}

async function expandInputs(paths) {
  const result = [];
  const seen = new Set();
  const add = (filePath) => {
    const key = filePath.toLowerCase();
    if (seen.has(key) || result.length >= MAX_EXPANDED) return;
    seen.add(key);
    result.push(filePath);
  };
  for (const input of paths) {
    let stat;
    try {
      stat = await fsp.stat(input);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      add(input);
      continue;
    }
    if (!stat.isDirectory()) continue;
    const stack = [{ dir: input, depth: 0 }];
    while (stack.length && result.length < MAX_EXPANDED) {
      const { dir, depth } = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const folders = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && isMediaFile(full)) add(full);
        else if (entry.isDirectory() && depth < 3) folders.push({ dir: full, depth: depth + 1 });
      }
      stack.push(...folders.reverse());
    }
  }
  return result;
}

async function diskSpace(folder) {
  const target = await existingFolder(folder);
  if (!target) return null;
  try {
    const stats = await fsp.statfs(target);
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize, root: path.parse(target).root };
  } catch {
    return null;
  }
}

function bundledManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.bundledBinDir(), 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function gpuNames() {
  try {
    const info = await app.getGPUInfo('complete');
    const names = (info.gpuDevice || []).map((device) => {
      const name = device.deviceString || device.driverVendor || `${device.vendorId}:${device.deviceId}`;
      return device.driverVersion ? `${name} (driver ${device.driverVersion})` : name;
    });
    return [...new Set(names)];
  } catch {
    return [];
  }
}

async function diagnostics() {
  const manifest = bundledManifest();
  const ffmpeg = manifest.ffmpeg ? `${manifest.ffmpeg} (gyan.dev essentials)` : null;
  const cpus = os.cpus();
  return {
    tools: { ffmpeg, ffprobe: ffmpeg },
    folders: { data: paths.localDataDir() },
    system: {
      cpu: cpus[0] ? cpus[0].model.trim() : null,
      cores: cpus.length,
      memory: os.totalmem(),
      gpu: await gpuNames()
    }
  };
}

function registerBasics(ctx, handle) {
  handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.getSystemVersion()}`,
    userData: app.getPath('userData')
  }));

  handle('app:diagnostics', () => diagnostics());
  handle('settings:defaults', () => settingsSchema.defaults());
  handle('app:notices', () => ctx.notices.list());
  handle('app:dismiss-notice', (id) => ctx.notices.dismiss(v.text(id, { max: 64 })));
  handle('app:renderer-ready', () => ctx.rendererReady());
  handle('app:close-choice', (choice) => ctx.handleCloseChoice(v.oneOf(choice, ['background', 'pause', 'cancel', 'stay'], 'choice')));
  handle('app:quit', () => ctx.requestQuit());

  handle('settings:get', () => ctx.settings.get());
  handle('settings:update', (patch) => {
    const clean = settingsSchema.sanitizePatch(v.jsonSize(v.object(patch, 'patch'), 64 * 1024, 'patch'));
    return ctx.settings.update((current) => settingsSchema.applyPatch(current, clean));
  });
  handle('settings:reset', (keys) => {
    if (!Array.isArray(keys) || keys.length > 64) throw new v.ValidationError('keys must be a list');
    return ctx.settings.update((current) => settingsSchema.resetKeys(current, keys));
  });

  handle('dialogs:pick-folder', async (defaultPath) => {
    const start = typeof defaultPath === 'string' && defaultPath.length < 1024 ? await existingFolder(defaultPath) : undefined;
    const result = await dialog.showOpenDialog(ownerWindow(ctx), {
      defaultPath: start,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  handle('dialogs:pick-files', async () => {
    const result = await dialog.showOpenDialog(ownerWindow(ctx), {
      defaultPath: ctx.lastInputFolder || app.getPath('videos'),
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Media files', extensions: MEDIA_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    ctx.lastInputFolder = path.dirname(result.filePaths[0]);
    return result.filePaths;
  });

  handle('dialogs:pick-cookies', async () => {
    const result = await dialog.showOpenDialog(ownerWindow(ctx), {
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'Cookies (Netscape format)', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  handle('files:open', async (filePath) => {
    const target = v.absolutePath(filePath);
    if (!fs.existsSync(target)) return false;
    return (await shell.openPath(target)) === '';
  });
  handle('files:open-folder', async (folder) => {
    const target = await existingFolder(v.absolutePath(folder));
    if (!target) return false;
    return (await shell.openPath(target)) === '';
  });
  handle('files:show', (filePath) => {
    const target = v.absolutePath(filePath);
    if (fs.existsSync(target)) {
      shell.showItemInFolder(target);
      return true;
    }
    const folder = path.dirname(target);
    if (fs.existsSync(folder)) return shell.openPath(folder).then((error) => error === '');
    return false;
  });
  handle('files:disk-space', (folder) => diskSpace(v.absolutePath(folder)));
  handle('files:expand', (paths) => expandInputs(v.pathList(paths)));

  handle('clipboard:read-url', () => {
    const value = clipboard.readText().trim();
    if (value.length > 8192 || /\s/.test(value)) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  });
  handle('clipboard:write', (value) => {
    clipboard.writeText(v.text(value, { max: 64 * 1024 }));
    return true;
  });

  handle('shell:open-external', (url) => {
    const target = v.webUrl(url);
    if (!isAllowedExternal(target)) return false;
    return shell.openExternal(target).then(() => true);
  });
}

module.exports = { registerBasics, expandInputs, diskSpace, isMediaFile, existingFolder };
