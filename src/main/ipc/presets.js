const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, dialog } = require('electron');
const v = require('../validate');
const { exposed } = require('../ipc');
const { sanitizeFileName } = require('../fsnames');
const { SCHEMA, summarize } = require('../presets');

const MAX_IMPORT_BYTES = 256 * 1024;

function withTags(preset) {
  let tags = [];
  try {
    tags = summarize(preset);
  } catch {
    tags = [];
  }
  return { ...preset, tags };
}

function withView(store) {
  return store.list().map(withTags);
}

function registerPresets(ctx, handle) {
  const store = ctx.presets;
  const guard = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (error && error.name === 'PresetError') throw exposed(error.message);
      throw error;
    }
  };

  handle('presets:list', () => withView(store));
  handle('presets:schema', () => SCHEMA);
  handle('presets:save', (preset) =>
    guard(() => withTags(store.save(v.jsonSize(v.object(preset, 'preset'), 64 * 1024, 'preset'))))
  );
  handle('presets:duplicate', (id, name) =>
    guard(() =>
      withTags(store.duplicate(v.text(id, { min: 1, max: 64 }), name === undefined || name === null ? undefined : v.text(name, { max: 60 })))
    )
  );
  handle('presets:rename', (id, name) =>
    guard(() => withTags(store.rename(v.text(id, { min: 1, max: 64 }), v.text(name, { min: 1, max: 60 }))))
  );
  handle('presets:remove', (id) => guard(() => store.remove(v.text(id, { min: 1, max: 64 }))));

  handle('presets:export', async (id) => {
    const data = guard(() => store.exportData(v.text(id, { min: 1, max: 64 })));
    const win = ctx.window && !ctx.window.isDestroyed() ? ctx.window : undefined;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `${sanitizeFileName(data.preset.name, { fallback: 'preset' })}.vidaropreset`),
      filters: [{ name: 'Vidaro preset', extensions: ['vidaropreset'] }],
      properties: ['showOverwriteConfirmation', 'dontAddToRecent']
    });
    if (result.canceled || !result.filePath) return false;
    await fsp.writeFile(result.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return true;
  });

  handle('presets:import', async () => {
    const win = ctx.window && !ctx.window.isDestroyed() ? ctx.window : undefined;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Vidaro preset', extensions: ['vidaropreset', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled) return { imported: [], failed: [] };
    const imported = [];
    const failed = [];
    for (const file of result.filePaths.slice(0, 50)) {
      try {
        const stat = await fsp.stat(file);
        if (stat.size > MAX_IMPORT_BYTES) throw new Error('too large');
        const text = await fsp.readFile(file, 'utf8');
        imported.push(withTags(store.importData(JSON.parse(text.replace(/^﻿/, '')))));
      } catch {
        failed.push(path.basename(file));
      }
    }
    return { imported, failed };
  });
}

function bridgePresets(ctx) {
  return ctx.presets.subscribe(() => ctx.send('presets:changed', withView(ctx.presets)));
}

module.exports = { registerPresets, bridgePresets };
