const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore, mergeDefaults } = require('../src/main/store');
const settings = require('../src/main/settings');

const DOWNLOAD_FOLDER = 'C:\\Users\\Test\\Videos\\Vidaro';
const CONVERT_FOLDER = 'C:\\Users\\Test\\Videos\\Vidaro\\Converted';

function load(value) {
  return settings.normalize(mergeDefaults(settings.defaults(), value));
}

function withSection(section, values) {
  return { [section]: values };
}

before(() => {
  settings.setDefaultFolders({ download: DOWNLOAD_FOLDER, convert: CONVERT_FOLDER });
});

describe('defaults', () => {
  test('have the schema version and the default folders', () => {
    const data = settings.defaults();
    assert.equal(data.version, settings.SCHEMA_VERSION);
    assert.equal(settings.SCHEMA_VERSION, 1);
    assert.equal(data.download.folder, DOWNLOAD_FOLDER);
    assert.equal(data.convert.folder, CONVERT_FOLDER);
    assert.deepEqual(data.shortcuts, {});
    assert.deepEqual(Object.keys(data), ['version', 'general', 'download', 'convert', 'shortcuts', 'ui']);
  });

  test('match the product defaults', () => {
    const data = settings.defaults();
    assert.equal(data.general.closeBehavior, 'ask');
    assert.equal(data.general.autoResume, false);
    assert.equal(data.general.lowPriority, true);
    assert.equal(data.general.stallMinutes, 5);
    assert.equal(data.download.concurrency, 2);
    assert.equal(data.download.compatible, true);
    assert.equal(data.download.collision, 'rename');
    assert.equal(data.download.ytdlpChannel, 'stable');
    assert.equal(data.convert.concurrency, 1);
    assert.equal(data.convert.defaultPreset, 'mp4-universal');
    assert.equal(data.convert.nameTemplate, '{name}');
    assert.equal(data.ui.lastPage, 'download');
  });

  test('are a fresh object every time', () => {
    const first = settings.defaults();
    first.general.stallMinutes = 30;
    first.shortcuts.x = 'y';
    assert.equal(settings.defaults().general.stallMinutes, 5);
    assert.deepEqual(settings.defaults().shortcuts, {});
  });

  test('already normalized defaults stay the same', () => {
    assert.deepEqual(load(settings.defaults()), settings.defaults());
    assert.deepEqual(load(undefined), settings.defaults());
  });

  test('the default convert preset is a built-in preset', () => {
    const { isBuiltInId } = require('../src/main/presets');
    assert.equal(isBuiltInId(settings.defaults().convert.defaultPreset), true);
  });
});

describe('normalize', () => {
  test('keeps valid enum values and replaces invalid ones', () => {
    const data = load({
      general: { closeBehavior: 'background', onQueueFinish: 'reboot' },
      download: { mode: 'audio', quality: '4320', container: 'webm', audioFormat: 'aiff', cookiesBrowser: 'safari' },
      convert: { outputMode: 'source', hardware: 'gpu' },
      ui: { lastPage: 'queue' }
    });
    assert.equal(data.general.closeBehavior, 'background');
    assert.equal(data.general.onQueueFinish, 'nothing');
    assert.equal(data.download.mode, 'audio');
    assert.equal(data.download.quality, 'best');
    assert.equal(data.download.container, 'webm');
    assert.equal(data.download.audioFormat, 'mp3');
    assert.equal(data.download.cookiesBrowser, 'edge');
    assert.equal(data.convert.outputMode, 'source');
    assert.equal(data.convert.hardware, 'auto');
    assert.equal(data.ui.lastPage, 'queue');
  });

  test('enum checks are case sensitive', () => {
    assert.equal(load(withSection('download', { collision: 'Skip' })).download.collision, 'rename');
  });

  test('clamps and rounds ranges', () => {
    const high = load({ general: { stallMinutes: 999 }, download: { concurrency: 9, concurrentFragments: 64 }, convert: { concurrency: 4 } });
    assert.equal(high.general.stallMinutes, 60);
    assert.equal(high.download.concurrency, 5);
    assert.equal(high.download.concurrentFragments, 16);
    assert.equal(high.convert.concurrency, 3);
    const low = load({ general: { stallMinutes: 0 }, download: { concurrency: -3, concurrentFragments: 0 }, convert: { concurrency: 0 } });
    assert.equal(low.general.stallMinutes, 1);
    assert.equal(low.download.concurrency, 1);
    assert.equal(low.download.concurrentFragments, 1);
    assert.equal(low.convert.concurrency, 1);
    assert.equal(load(withSection('download', { concurrency: 2.6 })).download.concurrency, 3);
    assert.equal(load(withSection('convert', { concurrency: 1.4 })).convert.concurrency, 1);
  });

  test('ranges fall back to defaults for wrong types or non-finite numbers', () => {
    assert.equal(load(withSection('download', { concurrency: '4' })).download.concurrency, 2);
    const direct = settings.defaults();
    direct.download.concurrency = Number.NaN;
    direct.general.stallMinutes = Infinity;
    settings.normalize(direct);
    assert.equal(direct.download.concurrency, 2);
    assert.equal(direct.general.stallMinutes, 5);
  });

  test('text fields over their limit fall back to defaults', () => {
    const data = load({
      download: { customTemplate: 'x'.repeat(513), subtitleLangs: 'en', rateLimit: '1'.repeat(17), proxy: 'p'.repeat(512) },
      convert: { folder: `D:\\${'f'.repeat(1030)}` }
    });
    assert.equal(data.download.customTemplate, '%(title)s');
    assert.equal(data.download.subtitleLangs, 'en');
    assert.equal(data.download.rateLimit, '');
    assert.equal(data.download.proxy.length, 512);
    assert.equal(data.convert.folder, CONVERT_FOLDER);
  });

  test('keeps non-ASCII folders', () => {
    const folder = 'D:\\Archivo de Canal\\Vídeos 🎬';
    assert.equal(load(withSection('download', { folder })).download.folder, folder);
  });

  test('blank folders fall back to the default folders', () => {
    const data = load({ download: { folder: '   ' }, convert: { folder: '' } });
    assert.equal(data.download.folder, DOWNLOAD_FOLDER);
    assert.equal(data.convert.folder, CONVERT_FOLDER);
  });

  test('the convert name template must contain {name}', () => {
    assert.equal(load(withSection('convert', { nameTemplate: 'output' })).convert.nameTemplate, '{name}');
    assert.equal(load(withSection('convert', { nameTemplate: '{name}_720p' })).convert.nameTemplate, '{name}_720p');
    assert.equal(load(withSection('convert', { nameTemplate: '{name} [{preset}]' })).convert.nameTemplate, '{name} [{preset}]');
  });

  test('nullable fields accept their type or null only', () => {
    const good = load({
      general: { dismissedUpdate: '1.2.0', lastVersion: '1.0.0' },
      download: { afterPreset: 'flowair-1080p' },
      convert: { lastPreset: { id: 'x', name: 'Last' } }
    });
    assert.equal(good.general.dismissedUpdate, '1.2.0');
    assert.equal(good.general.lastVersion, '1.0.0');
    assert.equal(good.download.afterPreset, 'flowair-1080p');
    assert.deepEqual(good.convert.lastPreset, { id: 'x', name: 'Last' });
    const bad = load({
      general: { dismissedUpdate: 5, lastVersion: { v: 1 } },
      download: { afterPreset: ['x'] },
      convert: { lastPreset: ['preset'] }
    });
    assert.equal(bad.general.dismissedUpdate, null);
    assert.equal(bad.general.lastVersion, null);
    assert.equal(bad.download.afterPreset, null);
    assert.equal(bad.convert.lastPreset, null);
    assert.equal(load(withSection('convert', { lastPreset: 'text' })).convert.lastPreset, null);
  });

  test('booleans of the wrong type fall back to defaults', () => {
    const data = load({ general: { autoResume: 'true', notifyOnFinish: 0 }, download: { compatible: null } });
    assert.equal(data.general.autoResume, false);
    assert.equal(data.general.notifyOnFinish, true);
    assert.equal(data.download.compatible, true);
  });

  test('always stamps the current schema version', () => {
    assert.equal(load({ version: 99 }).version, 1);
    assert.equal(load({ version: 'x' }).version, 1);
  });

  test('drops unknown sections and fields', () => {
    const data = load({ legacy: { a: 1 }, general: { removedOption: true } });
    assert.equal('legacy' in data, false);
    assert.equal(Object.hasOwn(data.general, 'removedOption'), false);
  });
});

describe('shortcuts', () => {
  test('keeps valid ids with string accelerators', () => {
    const data = load({ shortcuts: { 'queue.pause': 'Space', 'nav.page-1': 'Ctrl+1', convertStart: 'Ctrl+Enter', 'queue.remove': '' } });
    assert.deepEqual(data.shortcuts, { 'queue.pause': 'Space', 'nav.page-1': 'Ctrl+1', convertStart: 'Ctrl+Enter', 'queue.remove': '' });
  });

  test('drops invalid ids and accelerators', () => {
    const data = load({
      shortcuts: {
        'Queue.pause': 'Space',
        '1page': 'Ctrl+1',
        'has space': 'A',
        [`a${'b'.repeat(41)}`]: 'B',
        'ok.long': 'x'.repeat(41),
        'ok.number': 5,
        'ok.null': null,
        'ok.array': ['Ctrl+A'],
        'ok.valid': 'Ctrl+Shift+K'
      }
    });
    assert.deepEqual(data.shortcuts, { 'ok.valid': 'Ctrl+Shift+K' });
  });

  test('keeps at most 64 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`action.n${index}`, `Ctrl+${index}`]));
    const data = load({ shortcuts: many });
    assert.equal(Object.keys(data.shortcuts).length, 64);
    assert.equal(data.shortcuts['action.n63'], 'Ctrl+63');
    assert.equal('action.n64' in data.shortcuts, false);
  });

  test('a non-object value becomes empty', () => {
    assert.deepEqual(load({ shortcuts: ['Ctrl+A'] }).shortcuts, {});
    assert.deepEqual(load({ shortcuts: 'Ctrl+A' }).shortcuts, {});
  });
});

describe('sanitizePatch', () => {
  test('rejects a patch that is not an object', () => {
    for (const value of [null, undefined, 'x', 3, []]) assert.throws(() => settings.sanitizePatch(value), TypeError);
  });

  test('keeps known sections and fields only', () => {
    const patch = settings.sanitizePatch({
      general: { stallMinutes: 10, unknown: 1 },
      download: { folder: 'D:\\Media' },
      version: 5,
      secrets: { token: 'x' },
      ui: 'not an object',
      convert: null
    });
    assert.deepEqual(patch, { general: { stallMinutes: 10 }, download: { folder: 'D:\\Media' } });
  });

  test('passes values through for normalize to check later', () => {
    const patch = settings.sanitizePatch({ download: { concurrency: 99 } });
    assert.deepEqual(patch, { download: { concurrency: 99 } });
  });

  test('normalizes shortcuts right away', () => {
    const patch = settings.sanitizePatch({ shortcuts: { 'queue.pause': 'P', BAD: 'X' } });
    assert.deepEqual(patch, { shortcuts: { 'queue.pause': 'P' } });
    assert.deepEqual(settings.sanitizePatch({ shortcuts: 'x' }), { shortcuts: {} });
  });

  test('an empty patch stays empty', () => {
    assert.deepEqual(settings.sanitizePatch({}), {});
    assert.deepEqual(settings.sanitizePatch({ general: {} }), { general: {} });
  });

  test(
    'ignores inherited property names such as constructor and toString',
    () => {
      const patch = settings.sanitizePatch(JSON.parse('{"constructor":{"assign":1},"general":{"toString":"x","hasOwnProperty":1}}'));
      assert.equal(Object.hasOwn(patch, 'constructor'), false);
      assert.deepEqual(patch, { general: {} });
    }
  );

  test('a sanitized patch never changes built-in objects when applied', () => {
    const originalAssign = Object.assign;
    const originalKeys = Object.keys;
    const patch = settings.sanitizePatch(JSON.parse('{"general":{"toString":"x"}}'));
    const next = settings.applyPatch(settings.defaults(), patch);
    assert.equal(Object.assign, originalAssign);
    assert.equal(Object.keys, originalKeys);
    assert.equal(Object.hasOwn(load(next).general, 'toString'), false);
  });
});

describe('applyPatch', () => {
  test('merges fields without touching the current settings', () => {
    const current = settings.defaults();
    const snapshot = structuredClone(current);
    const next = settings.applyPatch(current, { general: { stallMinutes: 10 }, download: { mode: 'audio' } });
    assert.deepEqual(current, snapshot);
    assert.equal(next.general.stallMinutes, 10);
    assert.equal(next.general.closeBehavior, 'ask');
    assert.equal(next.download.mode, 'audio');
    assert.equal(next.download.folder, DOWNLOAD_FOLDER);
    assert.notEqual(next.general, current.general);
  });

  test('replaces the whole shortcut map', () => {
    const current = settings.applyPatch(settings.defaults(), { shortcuts: { 'queue.pause': 'P', 'nav.queue': 'Ctrl+3' } });
    const next = settings.applyPatch(current, { shortcuts: { 'queue.pause': 'K' } });
    assert.deepEqual(next.shortcuts, { 'queue.pause': 'K' });
  });

  test('the sanitize, apply, normalize pipeline enforces every rule', () => {
    const current = settings.defaults();
    const patch = settings.sanitizePatch({
      download: { concurrency: 50, container: 'avi', folder: '' },
      convert: { nameTemplate: 'x' },
      general: { closeBehavior: 'pause' }
    });
    const next = load(settings.applyPatch(current, patch));
    assert.equal(next.download.concurrency, 5);
    assert.equal(next.download.container, 'mp4');
    assert.equal(next.download.folder, DOWNLOAD_FOLDER);
    assert.equal(next.convert.nameTemplate, '{name}');
    assert.equal(next.general.closeBehavior, 'pause');
  });
});

describe('resetKeys', () => {
  test('resets the listed fields to their defaults', () => {
    const current = load({ general: { stallMinutes: 30, closeBehavior: 'cancel' }, download: { concurrency: 4 } });
    const snapshot = structuredClone(current);
    const next = settings.resetKeys(current, ['general.stallMinutes', 'download.concurrency']);
    assert.deepEqual(current, snapshot);
    assert.equal(next.general.stallMinutes, 5);
    assert.equal(next.download.concurrency, 2);
    assert.equal(next.general.closeBehavior, 'cancel');
  });

  test('resets all shortcuts', () => {
    const current = load({ shortcuts: { 'queue.pause': 'P' } });
    assert.deepEqual(settings.resetKeys(current, ['shortcuts']).shortcuts, {});
  });

  test('ignores unknown or malformed keys', () => {
    const current = load({ general: { stallMinutes: 30 } });
    const next = settings.resetKeys(current, [
      'general',
      'general.missing',
      'nothing.stallMinutes',
      'general.stall-minutes',
      'general.stallMinutes.extra',
      'version',
      42,
      null
    ]);
    assert.deepEqual(next, current);
  });

  test('resetting a folder uses the default folder', () => {
    const current = load(withSection('download', { folder: 'E:\\Other' }));
    assert.equal(settings.resetKeys(current, ['download.folder']).download.folder, DOWNLOAD_FOLDER);
  });
});

describe('with JsonStore', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-test-settings-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function open() {
    return new JsonStore({ file: path.join(dir, 'settings.json'), defaults: settings.defaults(), normalize: settings.normalize, debounceMs: 10 });
  }

  test('a hand-edited file loads normalized', () => {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        version: 0,
        general: { stallMinutes: 500, closeBehavior: 'explode' },
        download: { concurrency: '3', folder: '' },
        shortcuts: { 'queue.pause': 'P', Bad: 'X' },
        extra: true
      })
    );
    const store = open();
    const data = store.load();
    assert.equal(data.version, 1);
    assert.equal(data.general.stallMinutes, 60);
    assert.equal(data.general.closeBehavior, 'ask');
    assert.equal(data.download.concurrency, 2);
    assert.equal(data.download.folder, DOWNLOAD_FOLDER);
    assert.deepEqual(data.shortcuts, { 'queue.pause': 'P' });
    assert.equal('extra' in data, false);
    store.dispose();
  });

  test('patches persist and reload', () => {
    const store = open();
    store.load();
    const patch = settings.sanitizePatch({ convert: { concurrency: 2, keepDate: true }, shortcuts: { 'app.quit': 'Ctrl+Q' } });
    store.update((current) => settings.applyPatch(current, patch));
    store.dispose();
    const again = open();
    const data = again.load();
    assert.equal(data.convert.concurrency, 2);
    assert.equal(data.convert.keepDate, true);
    assert.deepEqual(data.shortcuts, { 'app.quit': 'Ctrl+Q' });
    again.dispose();
  });
});
