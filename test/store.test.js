const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JsonStore, mergeDefaults, writeFileAtomicSync, isPlainObject } = require('../src/main/store');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const LOCK_SCRIPT = [
  "$f = [System.IO.File]::Open($env:VIDARO_LOCK_FILE, 'Open', 'ReadWrite', 'None')",
  "[Console]::Out.WriteLine('locked')",
  '[Console]::Out.Flush()',
  'Start-Sleep -Milliseconds ([int]$env:VIDARO_LOCK_MS)',
  '$f.Close()'
].join('; ');

const DEFAULTS = Object.freeze({
  version: 1,
  general: { name: 'Vidaro', count: 2, enabled: true, note: null, tags: ['a'] },
  shortcuts: {},
  list: []
});

describe('isPlainObject', () => {
  test('accepts objects only', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
    for (const value of [null, undefined, [], 'x', 1, true]) assert.equal(isPlainObject(value), false);
  });
});

describe('mergeDefaults', () => {
  test('fills missing keys and drops unknown ones', () => {
    const result = mergeDefaults(DEFAULTS, { general: { name: 'Mine', extra: 1 }, other: true });
    assert.deepEqual(result, {
      version: 1,
      general: { name: 'Mine', count: 2, enabled: true, note: null, tags: ['a'] },
      shortcuts: {},
      list: []
    });
  });

  test('replaces values whose type does not match the default', () => {
    const result = mergeDefaults(DEFAULTS, {
      version: '2',
      general: { name: 5, count: '3', enabled: 'yes', tags: 'a,b' },
      list: {}
    });
    assert.equal(result.version, 1);
    assert.equal(result.general.name, 'Vidaro');
    assert.equal(result.general.count, 2);
    assert.equal(result.general.enabled, true);
    assert.deepEqual(result.general.tags, ['a']);
    assert.deepEqual(result.list, []);
  });

  test('a null default accepts any value', () => {
    for (const note of ['text', 3, { a: 1 }, [1], false, null]) {
      assert.deepEqual(mergeDefaults(DEFAULTS, { general: { note } }).general.note, note);
    }
    assert.equal(mergeDefaults(DEFAULTS, { general: {} }).general.note, null);
  });

  test('an empty object default is a free-form map that is copied', () => {
    const shortcuts = { 'queue.pause': 'Space', nested: { deep: true } };
    const result = mergeDefaults(DEFAULTS, { shortcuts });
    assert.deepEqual(result.shortcuts, shortcuts);
    assert.notEqual(result.shortcuts, shortcuts);
    assert.notEqual(result.shortcuts.nested, shortcuts.nested);
    assert.deepEqual(mergeDefaults(DEFAULTS, { shortcuts: ['x'] }).shortcuts, {});
    assert.deepEqual(mergeDefaults(DEFAULTS, { shortcuts: null }).shortcuts, {});
  });

  test('arrays are taken as a whole when the value is an array', () => {
    assert.deepEqual(mergeDefaults(DEFAULTS, { general: { tags: [] } }).general.tags, []);
    assert.deepEqual(mergeDefaults(DEFAULTS, { list: [{ id: 1 }, 'x'] }).list, [{ id: 1 }, 'x']);
  });

  test('a non-object value yields a fresh copy of the defaults', () => {
    for (const value of [undefined, null, 'x', 7, []]) {
      const result = mergeDefaults(DEFAULTS, value);
      assert.deepEqual(result, DEFAULTS);
      assert.notEqual(result, DEFAULTS);
      assert.notEqual(result.general, DEFAULTS.general);
      assert.notEqual(result.general.tags, DEFAULTS.general.tags);
    }
  });

  test('never mutates the defaults', () => {
    const defaults = structuredClone(DEFAULTS);
    const result = mergeDefaults(defaults, {});
    result.general.tags.push('b');
    result.general.name = 'changed';
    assert.deepEqual(defaults, DEFAULTS);
  });

  test('keeps primitives of the right type, including falsy ones', () => {
    const result = mergeDefaults(DEFAULTS, { general: { name: '', count: 0, enabled: false } });
    assert.equal(result.general.name, '');
    assert.equal(result.general.count, 0);
    assert.equal(result.general.enabled, false);
  });
});

describe('files', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-test-store-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeStore(options = {}) {
    return new JsonStore({ file: path.join(dir, 'settings.json'), defaults: DEFAULTS, debounceMs: 50, ...options });
  }

  function readSaved(store) {
    return JSON.parse(fs.readFileSync(store.file, 'utf8'));
  }

  describe('writeFileAtomicSync', () => {
    test('creates missing folders, writes the text and leaves no temp file', () => {
      const file = path.join(dir, 'a', 'b', 'data.json');
      writeFileAtomicSync(file, '{"ok":true}\n');
      assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}\n');
      assert.equal(fs.existsSync(`${file}.tmp`), false);
    });

    test('replaces an existing file completely', () => {
      const file = path.join(dir, 'data.json');
      writeFileAtomicSync(file, 'x'.repeat(5000));
      writeFileAtomicSync(file, 'short');
      assert.equal(fs.readFileSync(file, 'utf8'), 'short');
      assert.deepEqual(fs.readdirSync(dir), ['data.json']);
    });

    test('writes non-ASCII text as UTF-8', () => {
      const file = path.join(dir, 'Canción 🎬', 'datos.json');
      writeFileAtomicSync(file, '{"title":"Año nuevo 🎬"}');
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'Año nuevo 🎬');
    });

    test('fails when the target is a folder and leaves it intact', () => {
      const target = path.join(dir, 'folder');
      fs.mkdirSync(target);
      assert.throws(() => writeFileAtomicSync(target, 'x'));
      assert.equal(fs.statSync(target).isDirectory(), true);
    });
  });

  describe('JsonStore', () => {
    test('a missing file loads the defaults without writing', () => {
      const store = makeStore();
      const data = store.load();
      assert.deepEqual(data, DEFAULTS);
      assert.equal(store.get(), data);
      assert.equal(store.recovered, false);
      store.dispose();
      assert.equal(fs.existsSync(store.file), false);
    });

    test('a saved file is merged over the defaults', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, JSON.stringify({ general: { name: 'Saved', legacy: 1 }, shortcuts: { a: 'B' } }));
      const data = store.load();
      assert.equal(data.general.name, 'Saved');
      assert.equal(data.general.count, 2);
      assert.equal('legacy' in data.general, false);
      assert.deepEqual(data.shortcuts, { a: 'B' });
      assert.equal(store.recovered, false);
      store.dispose();
    });

    test('a file with a UTF-8 BOM loads', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, `${String.fromCharCode(0xfeff)}{"general":{"name":"Bom"}}`);
      assert.equal(store.load().general.name, 'Bom');
      assert.equal(store.recovered, false);
      assert.equal(fs.existsSync(`${store.file}.bak`), false);
      store.dispose();
    });

    test('normalize runs on load and on update', () => {
      const store = makeStore({
        normalize: (data) => {
          data.general.count = Math.min(5, data.general.count);
          return data;
        }
      });
      fs.writeFileSync(store.file, JSON.stringify({ general: { count: 50 } }));
      assert.equal(store.load().general.count, 5);
      assert.equal(store.update({ ...store.get(), general: { ...store.get().general, count: 9 } }).general.count, 5);
      store.dispose();
    });

    test('a corrupt file is kept as .bak and the defaults are used', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, '{"general": {"name": "Brok');
      const data = store.load();
      assert.deepEqual(data, DEFAULTS);
      assert.equal(store.recovered, true);
      assert.equal(fs.readFileSync(`${store.file}.bak`, 'utf8'), '{"general": {"name": "Brok');
      assert.equal(fs.readFileSync(store.file, 'utf8'), '{"general": {"name": "Brok');
      store.update((current) => ({ ...current, version: 1, general: { ...current.general, name: 'Fresh' } }));
      store.flush();
      assert.equal(readSaved(store).general.name, 'Fresh');
      assert.equal(fs.readFileSync(`${store.file}.bak`, 'utf8'), '{"general": {"name": "Brok');
      store.dispose();
    });

    test('an empty file counts as corrupt', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, '');
      assert.deepEqual(store.load(), DEFAULTS);
      assert.equal(store.recovered, true);
      assert.equal(fs.existsSync(`${store.file}.bak`), true);
      store.dispose();
    });

    test('a complete leftover temp file is recovered and saved', () => {
      const store = makeStore();
      fs.writeFileSync(`${store.file}.tmp`, JSON.stringify({ general: { name: 'From temp' } }));
      const data = store.load();
      assert.equal(data.general.name, 'From temp');
      assert.equal(store.recovered, false);
      store.flush();
      assert.equal(readSaved(store).general.name, 'From temp');
      assert.equal(fs.existsSync(`${store.file}.tmp`), false);
      store.dispose();
    });

    test('a leftover temp file is also used when the main file is corrupt', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, '{bad');
      fs.writeFileSync(`${store.file}.tmp`, JSON.stringify({ general: { name: 'Newer' } }));
      assert.equal(store.load().general.name, 'Newer');
      store.dispose();
      assert.equal(readSaved(store).general.name, 'Newer');
    });

    test('a broken leftover temp file is deleted and the corrupt file backed up', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, 'nope');
      fs.writeFileSync(`${store.file}.tmp`, '{"general":');
      assert.deepEqual(store.load(), DEFAULTS);
      assert.equal(fs.existsSync(`${store.file}.tmp`), false);
      assert.equal(store.recovered, true);
      assert.equal(fs.readFileSync(`${store.file}.bak`, 'utf8'), 'nope');
      store.dispose();
    });

    test('a valid main file wins over a stale temp file', () => {
      const store = makeStore();
      fs.writeFileSync(store.file, JSON.stringify({ general: { name: 'Main' } }));
      fs.writeFileSync(`${store.file}.tmp`, JSON.stringify({ general: { name: 'Stale' } }));
      assert.equal(store.load().general.name, 'Main');
      store.dispose();
      assert.equal(readSaved(store).general.name, 'Main');
    });

    test('update accepts a value or a function and merges over the defaults', () => {
      const store = makeStore();
      store.load();
      const next = store.update({ general: { name: 'Value' } });
      assert.equal(next.general.name, 'Value');
      assert.equal(next.general.count, 2);
      assert.equal(store.get(), next);
      const seen = [];
      store.update((current) => {
        seen.push(current);
        return { ...current, general: { ...current.general, count: 4 } };
      });
      assert.equal(seen[0], next);
      assert.equal(store.get().general.count, 4);
      assert.equal(store.get().general.name, 'Value');
      store.dispose();
    });

    test('writes are debounced into one save with the latest data', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const store = makeStore();
      store.load();
      store.update({ general: { count: 1 } });
      t.mock.timers.tick(30);
      store.update({ general: { count: 2 } });
      t.mock.timers.tick(30);
      store.update({ general: { count: 3 } });
      assert.equal(fs.existsSync(store.file), false);
      t.mock.timers.tick(49);
      assert.equal(fs.existsSync(store.file), false);
      t.mock.timers.tick(1);
      assert.equal(readSaved(store).general.count, 3);
      fs.rmSync(store.file);
      t.mock.timers.tick(1000);
      assert.equal(fs.existsSync(store.file), false);
      store.dispose();
      assert.equal(fs.existsSync(store.file), false);
    });

    test('the saved file is pretty JSON ending with a newline', () => {
      const store = makeStore();
      store.load();
      store.update({ general: { name: 'Pretty' } });
      store.flush();
      const text = fs.readFileSync(store.file, 'utf8');
      assert.equal(text, `${JSON.stringify(store.get(), null, 2)}\n`);
      store.dispose();
    });

    test('flush writes at once, cancels the timer and does nothing when clean', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const store = makeStore();
      store.load();
      store.update({ general: { name: 'Now' } });
      store.flush();
      assert.equal(readSaved(store).general.name, 'Now');
      fs.rmSync(store.file);
      t.mock.timers.tick(100);
      assert.equal(fs.existsSync(store.file), false);
      store.flush();
      assert.equal(fs.existsSync(store.file), false);
      store.dispose();
    });

    test('a failed write stays dirty and succeeds on the next flush', () => {
      const store = makeStore();
      store.load();
      fs.mkdirSync(store.file);
      store.update({ general: { name: 'Retry' } });
      store.flush();
      assert.equal(store.dirty, true);
      assert.equal(fs.statSync(store.file).isDirectory(), true);
      fs.rmSync(store.file, { recursive: true });
      store.flush();
      assert.equal(store.dirty, false);
      assert.equal(readSaved(store).general.name, 'Retry');
      store.dispose();
    });

    test('subscribers get every update until they unsubscribe', () => {
      const store = makeStore();
      store.load();
      const first = [];
      const second = [];
      const unsubscribe = store.subscribe((data) => first.push(data.general.count));
      store.subscribe((data) => second.push(data.general.count));
      store.update({ general: { count: 7 } });
      unsubscribe();
      store.update({ general: { count: 8 } });
      assert.deepEqual(first, [7]);
      assert.deepEqual(second, [7, 8]);
      store.dispose();
      store.update({ general: { count: 9 } });
      assert.deepEqual(second, [7, 8]);
      store.flush();
    });

    test('dispose flushes pending changes', () => {
      const store = makeStore({ debounceMs: 60000 });
      store.load();
      store.update({ general: { name: 'On quit' } });
      store.dispose();
      assert.equal(readSaved(store).general.name, 'On quit');
      assert.equal(store.timer, null);
    });

    test(
      'a file locked for a moment by antivirus or sync is not replaced by the defaults',
      {
        skip: process.platform !== 'win32' && 'Windows only',
        timeout: 30000
      },
      async () => {
        const store = makeStore();
        fs.writeFileSync(store.file, JSON.stringify({ general: { name: 'User value', count: 9 } }));
        const holder = spawn(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LOCK_SCRIPT], {
          env: { ...process.env, VIDARO_LOCK_FILE: store.file, VIDARO_LOCK_MS: '500' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        const closed = new Promise((resolve) => holder.once('close', resolve));
        try {
          await new Promise((resolve, reject) => {
            holder.stdout.on('data', (chunk) => {
              if (String(chunk).includes('locked')) resolve();
            });
            holder.once('error', reject);
            closed.then(() => reject(new Error('the lock holder exited early')));
          });
          assert.throws(() => fs.readFileSync(store.file), { code: 'EBUSY' });
          store.load();
          await closed;
          store.update((current) => ({ ...current, general: { ...current.general, enabled: false } }));
          store.flush();
          const saved = readSaved(store);
          assert.equal(saved.general.name, 'User value');
          assert.equal(saved.general.count, 9);
          assert.equal(saved.general.enabled, false);
        } finally {
          holder.kill();
          await closed;
          store.dispose();
        }
      }
    );

    test('a reload sees what was saved, including non-ASCII text', () => {
      const store = makeStore();
      store.load();
      store.update({ general: { name: 'Música en vivo 🎬 – 日本' } });
      store.dispose();
      const again = makeStore();
      assert.equal(again.load().general.name, 'Música en vivo 🎬 – 日本');
      again.dispose();
    });
  });
});
