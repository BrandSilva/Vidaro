const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createYtDlpManager, runtimeVerdict, meetsMinimum, failureCode } = require('../src/main/downloader/ytdlp-manager');
const { fakeRun, lines } = require('./fixtures/downloader-runtime/fake-run');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const RUNTIME_FIXTURES = path.join(__dirname, 'fixtures', 'downloader-runtime');
const BUNDLED_VERSION = '2026.08.19';
const EXE_BYTES = 1024 * 1024 + 7;
const RUNTIME = { name: 'node', path: 'C:\\Program Files\\Vidaro\\Vidaro.exe', env: { ELECTRON_RUN_AS_NODE: '1' } };

function fixture(name, folder = FIXTURES) {
  return fs.readFileSync(path.join(folder, name), 'utf8');
}

function outSteps(text) {
  return lines(text).map((line) => ({ out: line }));
}

let root;
let bundledPath;
let userBinDir;
let runtimeDir;
let settings;
let managers;

function hasFlag(args, flag) {
  return args.includes(flag);
}

function setup({ script = () => ({ steps: [{ out: BUNDLED_VERSION }] }), busy = () => false, timings = {}, bundledVersion = BUNDLED_VERSION, now } = {}) {
  const fake = fakeRun(script);
  const events = [];
  const manager = createYtDlpManager({
    bundledPath,
    bundledVersion,
    userBinDir,
    runtimeDir,
    jsRuntime: RUNTIME,
    getSettings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, download: { ...settings.download, ...patch.download } };
    },
    isBusy: busy,
    now,
    run: fake.run,
    timings: { deferPollMs: 15, renameDelayMs: 5, ...timings }
  });
  manager.on('status', (status) => events.push(status));
  managers.push(manager);
  return { manager, fake, events };
}

function target() {
  return path.join(userBinDir, 'yt-dlp.exe');
}

function writeUserCopy(bytes = EXE_BYTES, fill = 2) {
  fs.mkdirSync(userBinDir, { recursive: true });
  fs.writeFileSync(target(), Buffer.alloc(bytes, fill));
  return fs.statSync(target());
}

function writeMeta(meta) {
  fs.writeFileSync(path.join(userBinDir, 'yt-dlp.json'), JSON.stringify(meta));
}

function readMeta() {
  return JSON.parse(fs.readFileSync(path.join(userBinDir, 'yt-dlp.json'), 'utf8'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-dlrt-ñ🎬-'));
  bundledPath = path.join(root, 'resources', 'bin', 'yt-dlp.exe');
  userBinDir = path.join(root, 'Local', 'Vidaro', 'bin');
  runtimeDir = path.join(root, 'Local', 'Vidaro', 'temp', 'runtime');
  fs.mkdirSync(path.dirname(bundledPath), { recursive: true });
  fs.writeFileSync(bundledPath, Buffer.alloc(EXE_BYTES, 1));
  settings = { download: { ytdlpChannel: 'stable', ytdlpAutoUpdate: true, ytdlpLastCheck: 0 } };
  managers = [];
});

afterEach(async () => {
  for (const manager of managers) manager.dispose();
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('ensure', () => {
  test('copies the bundled yt-dlp on first run without starting it', async () => {
    const { manager, fake } = setup();
    assert.equal(await manager.ensure(), target());
    assert.deepEqual(fs.readFileSync(target()), fs.readFileSync(bundledPath));
    const stat = fs.statSync(target());
    assert.deepEqual(readMeta(), { version: BUNDLED_VERSION, size: stat.size, mtimeMs: stat.mtimeMs, channel: 'stable' });
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(fs.readdirSync(userBinDir).sort(), ['yt-dlp.exe', 'yt-dlp.json']);
    assert.equal(await manager.version(), BUNDLED_VERSION);
    assert.equal(manager.status().usingBundled, false);
  });

  test('reuses a known copy without copying or probing again', async () => {
    const first = setup();
    await first.manager.ensure();
    const before = fs.statSync(target()).mtimeMs;
    const second = setup();
    await second.manager.ensure();
    await second.manager.ensure();
    assert.equal(fs.statSync(target()).mtimeMs, before);
    assert.equal(second.fake.calls.length, 0);
  });

  test('concurrent calls share one copy', async () => {
    const { manager } = setup();
    const results = await Promise.all([manager.ensure(), manager.ensure(), manager.ensure()]);
    assert.deepEqual(new Set(results), new Set([target()]));
    assert.deepEqual(fs.readdirSync(userBinDir).sort(), ['yt-dlp.exe', 'yt-dlp.json']);
  });

  test('replaces an older copy when the bundled one is newer', async () => {
    const stat = writeUserCopy();
    writeMeta({ version: '2026.07.01', size: stat.size, mtimeMs: stat.mtimeMs, channel: 'stable' });
    const { manager, fake } = setup();
    await manager.ensure();
    assert.deepEqual(fs.readFileSync(target()), fs.readFileSync(bundledPath));
    assert.equal(readMeta().version, BUNDLED_VERSION);
    assert.equal(fake.calls.length, 0);
  });

  test('keeps a newer nightly copy', async () => {
    const stat = writeUserCopy();
    writeMeta({ version: '2026.08.30.232658', size: stat.size, mtimeMs: stat.mtimeMs, channel: 'nightly' });
    const { manager } = setup();
    await manager.ensure();
    assert.equal(fs.readFileSync(target())[0], 2);
    assert.equal(manager.status().version, '2026.08.30.232658');
    assert.equal(manager.status().channel, 'nightly');
  });

  test('asks an unknown copy for its version once', async () => {
    writeUserCopy();
    const { manager, fake } = setup({ script: () => ({ steps: [{ out: '2026.08.30.232658' }] }) });
    await manager.ensure();
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].args, ['--ignore-config', '--no-plugin-dirs', '--version']);
    assert.equal(fake.calls[0].file, target());
    assert.equal(fs.readFileSync(target())[0], 2);
    assert.equal(readMeta().channel, 'nightly');
    await manager.ensure();
    assert.equal(fake.calls.length, 1);
  });

  test('replaces a copy that no longer runs', async () => {
    const stat = writeUserCopy();
    writeMeta({ version: BUNDLED_VERSION, size: stat.size + 1, mtimeMs: stat.mtimeMs, channel: 'stable' });
    const { manager, fake } = setup({ script: () => ({ code: 1, steps: [{ err: '[PYI-1234:ERROR] Failed to extract' }] }) });
    await manager.ensure();
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fs.readFileSync(target()), fs.readFileSync(bundledPath));
    assert.equal(readMeta().size, EXE_BYTES);
  });

  test('replaces a truncated or quarantined copy without starting it', async () => {
    writeUserCopy(10);
    const { manager, fake } = setup();
    await manager.ensure();
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.statSync(target()).size, EXE_BYTES);
    fs.unlinkSync(target());
    await manager.ensure();
    assert.equal(fs.statSync(target()).size, EXE_BYTES);
  });

  test('removes leftovers from interrupted copies and updates', async () => {
    fs.mkdirSync(userBinDir, { recursive: true });
    fs.writeFileSync(path.join(userBinDir, 'yt-dlp.exe.1a2b3c4d.tmp'), 'x');
    fs.writeFileSync(path.join(userBinDir, 'yt-dlp.exe.old'), 'x');
    fs.writeFileSync(path.join(userBinDir, 'keep.txt'), 'x');
    const { manager } = setup();
    await manager.ensure();
    assert.deepEqual(fs.readdirSync(userBinDir).sort(), ['keep.txt', 'yt-dlp.exe', 'yt-dlp.json']);
  });

  test('uses the user copy when the bundled one is gone', async () => {
    const stat = writeUserCopy();
    writeMeta({ version: '2026.07.01', size: stat.size, mtimeMs: stat.mtimeMs, channel: 'stable' });
    fs.unlinkSync(bundledPath);
    const { manager } = setup();
    assert.equal(await manager.ensure(), target());
  });

  test('fails when there is no yt-dlp at all', async () => {
    fs.unlinkSync(bundledPath);
    const { manager } = setup();
    await assert.rejects(manager.ensure(), { code: 'ENOENT' });
    assert.equal(await manager.version(), null);
  });

  test('runs the bundled copy when the local folder cannot be written', async () => {
    fs.mkdirSync(path.dirname(userBinDir), { recursive: true });
    fs.writeFileSync(userBinDir, 'not a folder');
    const { manager, events } = setup();
    assert.equal(await manager.ensure(), bundledPath);
    assert.equal(manager.status().usingBundled, true);
    assert.equal(manager.status().version, BUNDLED_VERSION);
    assert.ok(events.length >= 1);
    const result = await manager.update({ manual: true });
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'not-updatable');
    assert.equal(manager.status().error, 'not-updatable');
  });

  test('an unknown bundled version is read from the copy', async () => {
    const { manager, fake } = setup({ bundledVersion: null });
    await manager.ensure();
    assert.equal(fake.calls.length, 1);
    assert.equal(readMeta().version, BUNDLED_VERSION);
  });

  test('stops waiting when the job is aborted', async () => {
    const controller = new AbortController();
    controller.abort('cancel');
    const { manager } = setup();
    await assert.rejects(manager.ensure({ signal: controller.signal }), { name: 'AbortError' });
  });
});

describe('update', () => {
  test('reports an up to date copy and records the check', async () => {
    const { manager, fake, events } = setup({ script: () => ({ steps: outSteps(fixture('update-current.txt')) }), now: () => 5000 });
    await manager.ensure();
    const result = await manager.update({ manual: false });
    assert.deepEqual(result, { status: 'current', version: BUNDLED_VERSION, channel: 'stable', error: null });
    const call = fake.calls[0];
    assert.deepEqual(call.args.slice(-2), ['--update-to', 'stable@latest']);
    assert.equal(call.file, target());
    assert.equal(call.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(call.env.TEMP, runtimeDir);
    assert.equal(call.env.TMP, runtimeDir);
    assert.equal(settings.download.ytdlpLastCheck, 5000);
    const status = manager.status();
    assert.equal(status.lastResult, 'current');
    assert.equal(status.lastCheck, 5000);
    assert.equal(status.checking, false);
    assert.equal(status.latest, BUNDLED_VERSION);
    assert.ok(events.some((event) => event.checking === true));
  });

  test('updates to nightly and remembers the new copy', async () => {
    settings.download.ytdlpChannel = 'nightly';
    const { manager, fake, events } = setup({
      script: (call) =>
        call.args.includes('--update-to')
          ? { steps: [...outSteps(fixture('update-nightly.txt')).slice(0, 3), { effect: () => fs.writeFileSync(target(), Buffer.alloc(EXE_BYTES + 5, 3)) }, ...outSteps(fixture('update-nightly.txt')).slice(3)] }
          : { steps: [{ out: 'unexpected' }] }
    });
    await manager.ensure();
    const result = await manager.update({ manual: true });
    assert.equal(result.status, 'updated');
    assert.equal(result.version, '2026.08.30.232658');
    assert.equal(result.channel, 'nightly');
    assert.deepEqual(fake.calls[0].args.slice(-1), ['nightly@latest']);
    const stat = fs.statSync(target());
    assert.deepEqual(readMeta(), { version: '2026.08.30.232658', size: stat.size, mtimeMs: stat.mtimeMs, channel: 'nightly' });
    assert.ok(events.some((event) => event.updating === true));
    await manager.ensure();
    assert.equal(fake.calls.length, 1);
    assert.equal(fs.readFileSync(target())[0], 3);
  });

  test('moves from nightly back to stable with an exact tag', async () => {
    const stat = writeUserCopy();
    writeMeta({ version: '2026.08.30.232658', size: stat.size, mtimeMs: stat.mtimeMs, channel: 'nightly' });
    const { manager, fake } = setup({
      script: (call) => {
        const to = call.args[call.args.length - 1];
        if (to === 'stable@latest') return { steps: outSteps(fixture('update-no-downgrade.txt')) };
        return { steps: [{ effect: () => fs.writeFileSync(target(), Buffer.alloc(EXE_BYTES, 1)) }, ...outSteps(fixture('update-back-to-stable.txt'))] };
      }
    });
    const result = await manager.update({ manual: true });
    assert.deepEqual(
      fake.calls.map((call) => call.args[call.args.length - 1]),
      ['stable@latest', 'stable@2026.08.19']
    );
    assert.equal(result.status, 'updated');
    assert.equal(result.channel, 'stable');
    assert.equal(readMeta().version, '2026.08.19');
  });

  test('an automatic check fails silently when offline', async () => {
    const { manager } = setup({ script: () => ({ code: 100, steps: lines(fixture('update-offline.txt')).map((line) => ({ err: line })) }) });
    const result = await manager.update({ manual: false });
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'offline');
    const status = manager.status();
    assert.equal(status.error, null);
    assert.equal(status.lastResult, null);
    assert.equal(settings.download.ytdlpLastCheck, 0);
  });

  test('a manual check explains the failure', async () => {
    const { manager } = setup({ script: () => ({ code: 100, steps: lines(fixture('update-offline.txt')).map((line) => ({ err: line })) }) });
    await manager.update({ manual: true });
    const status = manager.status();
    assert.equal(status.error, 'offline');
    assert.equal(status.errorDetail, 'Unable to obtain version info');
    assert.equal(status.lastResult, 'failed');
  });

  test('waits while downloads run and updates once idle', async () => {
    let busy = true;
    const { manager, fake } = setup({ busy: () => busy, script: () => ({ steps: outSteps(fixture('update-current.txt')) }) });
    assert.deepEqual(await manager.update({ manual: true }), { deferred: true });
    assert.equal(manager.status().pending, true);
    await delay(60);
    assert.equal(fake.calls.filter((call) => call.args.includes('--update-to')).length, 0);
    busy = false;
    for (let i = 0; i < 50 && manager.status().lastResult === null; i += 1) await delay(10);
    assert.equal(manager.status().lastResult, 'current');
    assert.equal(manager.status().pending, false);
    assert.equal(fake.calls.filter((call) => call.args.includes('--update-to')).length, 1);
  });

  test('does not update while a yt-dlp process is running', async () => {
    const { manager } = setup();
    let finish;
    manager.track(new Promise((resolve) => {
      finish = resolve;
    }));
    assert.equal(manager.live, 1);
    assert.deepEqual(await manager.update(), { deferred: true });
    finish();
    await delay(0);
    assert.equal(manager.live, 0);
  });

  test('gives up after the timeout and repairs a half written copy', async () => {
    const { manager, fake } = setup({
      script: () => ({ steps: [{ effect: () => fs.writeFileSync(target(), 'partial') }, { hang: true }] }),
      timings: { updateTimeoutMs: 40 }
    });
    await manager.ensure();
    const result = await manager.update({ manual: true });
    assert.equal(result.error, 'timeout');
    assert.equal(fake.calls[0].aborted, true);
    assert.equal(manager.status().error, 'timeout');
    assert.equal(await manager.ensure(), target());
    assert.deepEqual(fs.readFileSync(target()), fs.readFileSync(bundledPath));
    assert.equal(fake.calls.length, 1);
  });

  test('an interrupted update of an untouched copy needs no repair', async () => {
    const { manager, fake } = setup({ script: () => ({ steps: [{ hang: true }] }), timings: { updateTimeoutMs: 30 } });
    await manager.ensure();
    const before = fs.statSync(target()).mtimeMs;
    await manager.update({ manual: false });
    await manager.ensure();
    assert.equal(fs.statSync(target()).mtimeMs, before);
    assert.equal(fake.calls.length, 1);
    assert.equal(manager.status().error, null);
  });

  test('shares one update between callers and makes jobs wait for it', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { manager, fake } = setup({ script: async () => {
      await gate;
      return { steps: outSteps(fixture('update-current.txt')) };
    } });
    await manager.ensure();
    const first = manager.update();
    const second = manager.update({ manual: true });
    assert.equal(first, second);
    let ensured = false;
    const waiting = manager.ensure().then(() => {
      ensured = true;
    });
    await delay(20);
    assert.equal(ensured, false);
    release();
    await first;
    await waiting;
    assert.equal(ensured, true);
    assert.equal(fake.calls.length, 1);
  });

  test('a manual request joining an automatic update shows its failure', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { manager } = setup({ script: async () => {
      await gate;
      return { code: 100, steps: lines(fixture('update-offline.txt')).map((line) => ({ err: line })) };
    } });
    const automatic = manager.update();
    manager.update({ manual: true });
    release();
    await automatic;
    assert.equal(manager.status().error, 'offline');
  });

  test('dispose stops a running update and goes quiet', async () => {
    const { manager, fake, events } = setup({ script: () => ({ steps: [{ hang: true }] }) });
    const pending = manager.update({ manual: true });
    await delay(20);
    const count = events.length;
    manager.dispose();
    const result = await pending;
    assert.equal(result.status, 'failed');
    assert.equal(fake.calls[0].aborted, true);
    assert.equal(events.length, count);
    assert.deepEqual(await manager.update(), { status: 'failed', error: 'disposed' });
  });
});

describe('daily schedule', () => {
  test('checks once when a day has passed', async () => {
    settings.download.ytdlpLastCheck = 1000;
    const clock = { now: 1000 + 25 * 60 * 60 * 1000 };
    const { manager, fake } = setup({ now: () => clock.now, timings: { firstCheckMs: 10, intervalMs: 15 }, script: () => ({ steps: outSteps(fixture('update-current.txt')) }) });
    manager.scheduleDaily();
    await delay(120);
    assert.equal(fake.calls.filter((call) => call.args.includes('--update-to')).length, 1);
    assert.equal(settings.download.ytdlpLastCheck, clock.now);
  });

  test('skips when checked recently or when turned off', async () => {
    settings.download.ytdlpLastCheck = 1000;
    const recent = setup({ now: () => 2000, timings: { firstCheckMs: 5, intervalMs: 10 } });
    recent.manager.scheduleDaily();
    settings = { download: { ...settings.download, ytdlpLastCheck: 0, ytdlpAutoUpdate: false } };
    await delay(60);
    assert.equal(recent.fake.calls.length, 0);
  });

  test('retries a failed automatic check only after the retry delay', async () => {
    const clock = { now: 10 * 24 * 60 * 60 * 1000 };
    const { manager, fake } = setup({
      now: () => clock.now,
      timings: { firstCheckMs: 5, intervalMs: 10, retryMs: 1000 },
      script: () => ({ code: 100, steps: lines(fixture('update-offline.txt')).map((line) => ({ err: line })) })
    });
    manager.scheduleDaily();
    await delay(80);
    const updates = () => fake.calls.filter((call) => call.args.includes('--update-to')).length;
    assert.equal(updates(), 1);
    clock.now += 1000;
    await delay(60);
    assert.equal(updates(), 2);
  });
});

describe('JavaScript runtime diagnostics', () => {
  test('reports the runtime that yt-dlp accepted', async () => {
    const { manager, fake } = setup({
      script: (call) => (call.args[0] === '-v' ? { code: 2, steps: lines(fixture('probe-electron.txt', RUNTIME_FIXTURES)).map((line) => ({ err: line })) } : {})
    });
    const status = await manager.inspect();
    assert.deepEqual(status.jsRuntime, { name: 'node', version: '24.21.0', ok: true });
    assert.equal(status.version, BUNDLED_VERSION);
    const probe = fake.calls.find((call) => call.args[0] === '-v');
    assert.ok(hasFlag(probe.args, '--js-runtimes'));
    assert.equal(probe.env.ELECTRON_RUN_AS_NODE, '1');
    await manager.inspect();
    assert.equal(fake.calls.filter((call) => call.args[0] === '-v').length, 1);
  });

  test('flags a runtime that yt-dlp could not use', async () => {
    const { manager } = setup({
      script: () => ({ code: 2, steps: lines(fixture('probe-missing-env.txt', RUNTIME_FIXTURES)).map((line) => ({ err: line })) })
    });
    assert.deepEqual((await manager.inspect()).jsRuntime, { name: 'node', version: null, ok: false });
  });

  test('status before any probe leaves the runtime unknown', () => {
    const { manager } = setup();
    assert.deepEqual(manager.status().jsRuntime, { name: 'node', version: null, ok: null });
  });

  test('verdict helpers', () => {
    assert.deepEqual(runtimeVerdict(['[debug] JS runtimes: node-21.7.3'], RUNTIME), { name: 'node', version: '21.7.3', ok: false });
    assert.deepEqual(runtimeVerdict(['[debug] JS runtimes: deno-2.5.0'], RUNTIME), { name: 'node', version: null, ok: false });
    assert.deepEqual(runtimeVerdict([], null), { name: null, version: null, ok: false });
    assert.equal(meetsMinimum('node', '22.0.0'), true);
    assert.equal(meetsMinimum('deno', '2.2.9'), false);
    assert.equal(meetsMinimum('deno', '2.3'), true);
    assert.equal(meetsMinimum('quickjs', '2024.01.13'), true);
    assert.equal(meetsMinimum('node', 'x'), false);
    assert.equal(failureCode({ message: 'Unable to write to C:\\x\\yt-dlp.exe; Try running as administrator' }), 'write-failed');
    assert.equal(failureCode({ message: 'Unable to obtain version info' }), 'offline');
    assert.equal(failureCode({ message: 'Something odd' }), 'failed');
    assert.equal(failureCode(null), 'failed');
  });
});

describe('process environment and PyInstaller leftovers', () => {
  test('children get the runtime variables and a private temp folder', () => {
    const { manager } = setup();
    assert.deepEqual(manager.childEnv(), { ELECTRON_RUN_AS_NODE: '1', TEMP: runtimeDir, TMP: runtimeDir });
  });

  test('removes stale extraction folders only when no yt-dlp runs', async () => {
    fs.mkdirSync(path.join(runtimeDir, '_MEI12345', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, '_MEI12345', 'lib', 'python310.dll'), 'x');
    fs.mkdirSync(path.join(runtimeDir, 'other'), { recursive: true });
    const { manager } = setup();
    let finish;
    manager.track(new Promise((resolve) => {
      finish = resolve;
    }));
    await manager.sweepRuntime();
    assert.ok(fs.existsSync(path.join(runtimeDir, '_MEI12345')));
    finish();
    await delay(10);
    await manager.sweepRuntime();
    assert.deepEqual(fs.readdirSync(runtimeDir), ['other']);
  });

  test('sweeping a missing folder is harmless', async () => {
    const { manager } = setup();
    await manager.sweepRuntime();
    assert.equal(fs.existsSync(runtimeDir), false);
  });
});

describe('diagnostics during failures and updates', () => {
  test('a probe that could not run is retried next time', async () => {
    let attempt = 0;
    const { manager } = setup({
      script: () => {
        attempt += 1;
        if (attempt === 1) return { spawnFailed: true };
        return { code: 2, steps: lines(fixture('probe-electron.txt', RUNTIME_FIXTURES)).map((line) => ({ err: line })) };
      }
    });
    assert.deepEqual((await manager.inspect()).jsRuntime, { name: 'node', version: null, ok: false });
    assert.equal(manager.status().jsRuntime.ok, null);
    assert.deepEqual((await manager.inspect()).jsRuntime, { name: 'node', version: '24.21.0', ok: true });
    assert.equal(attempt, 2);
  });

  test('status requests during an update never touch the copy', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { manager, fake } = setup({
      script: async (call) => {
        if (!call.args.includes('--update-to')) return { code: 2, steps: [] };
        await gate;
        return { steps: outSteps(fixture('update-current.txt')) };
      }
    });
    await manager.ensure();
    const running = manager.update({ manual: true });
    for (let i = 0; i < 100 && fake.calls.length === 0; i += 1) await delay(5);
    fs.unlinkSync(target());
    const status = await manager.inspect();
    assert.equal(status.version, BUNDLED_VERSION);
    assert.equal(status.checking, true);
    assert.equal(status.jsRuntime.ok, null);
    assert.equal(fs.existsSync(target()), false);
    assert.equal(fake.calls.length, 1);
    fs.copyFileSync(bundledPath, target());
    release();
    await running;
  });
});
