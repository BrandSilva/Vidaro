const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const processes = require('../src/main/processes');

const { run, killTree, killAll, liveCount, sweepOrphans, setLowPriority, createStallWatchdog, ProcessError, abortError } = processes;

const windowsOnly = { skip: process.platform !== 'win32' && 'Windows only', timeout: 60000 };
const SLEEP = 'setInterval(() => {}, 1000);';

function track(handle) {
  handle.exited = false;
  handle.result.then(
    () => {
      handle.exited = true;
    },
    () => {
      handle.exited = true;
    }
  );
  return handle;
}

function node(script, args = [], options = {}) {
  return track(run(process.execPath, ['-e', script, ...args], options));
}

async function stop(...handles) {
  await Promise.all(handles.filter((handle) => !handle.exited).map((handle) => handle.kill()));
  await Promise.allSettled(handles.map((handle) => handle.result));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitFor(check, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return true;
    await delay(50);
  }
  return check();
}

function stopPid(pid) {
  if (pid && isAlive(pid)) {
    try {
      process.kill(pid);
    } catch {
      return;
    }
  }
}

function waitForLine(predicate) {
  let resolveLine;
  const promise = new Promise((resolve) => {
    resolveLine = resolve;
  });
  return {
    promise,
    onLine: (line) => {
      if (predicate(line)) resolveLine(line);
    }
  };
}

after(async () => {
  await killAll();
});

describe('run', windowsOnly, () => {
  test('streams stdout and stderr lines and resolves with the exit code', async () => {
    const out = [];
    const err = [];
    const handle = node(String.raw`process.stdout.write('first\nsecond\r\nthird'); process.stderr.write('warn one\r\nwarn two'); process.exitCode = 3;`, [], {
      onStdoutLine: (line) => out.push(line),
      onStderrLine: (line) => err.push(line)
    });
    assert.ok(handle.pid > 0);
    assert.equal(typeof handle.kill, 'function');
    const result = await handle.result;
    assert.deepEqual(out, ['first', 'second', 'third']);
    assert.deepEqual(err, ['warn one', 'warn two']);
    assert.equal(result.code, 3);
    assert.equal(result.exitSignal, null);
    assert.equal(result.stderr, 'warn one\nwarn two');
    assert.deepEqual(result.stderrLines, ['warn one', 'warn two']);
    assert.equal(result.stdout, '');
    assert.equal(result.overflow, false);
    assert.equal(liveCount(), 0);
  });

  test('a clean exit resolves with code 0', async () => {
    const result = await node('process.exit(0)').result;
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stderrLines, []);
  });

  test('keeps only the last stderr lines', async () => {
    const result = await node(String.raw`for (let i = 1; i <= 50; i++) process.stderr.write('line ' + i + '\n'); process.exit(7);`, [], { tailLines: 5 }).result;
    assert.equal(result.code, 7);
    assert.deepEqual(result.stderrLines, ['line 46', 'line 47', 'line 48', 'line 49', 'line 50']);
    assert.equal(result.stderr, 'line 46\nline 47\nline 48\nline 49\nline 50');
  });

  test('keeps 40 stderr lines by default', async () => {
    const result = await node(String.raw`for (let i = 1; i <= 100; i++) process.stderr.write('e' + i + '\n');`).result;
    assert.equal(result.stderrLines.length, 40);
    assert.equal(result.stderrLines[0], 'e61');
  });

  test('a flood of stderr output never blocks the child and keeps the last lines', async () => {
    const lines = [];
    const result = await node(String.raw`const line = 'e'.repeat(199) + '\n'; for (let i = 0; i < 20000; i++) process.stderr.write(line); process.stderr.write('last one\n');`, [], {
      onStderrLine: () => lines.push(1),
      tailLines: 2
    }).result;
    assert.equal(result.code, 0);
    assert.equal(lines.length, 20001);
    assert.deepEqual(result.stderrLines, ['e'.repeat(199), 'last one']);
  });

  test('captures stdout as UTF-8 text', async () => {
    const payload = { title: 'Canción de año nuevo 🎬 – 日本', size: 12 };
    const result = await node(`process.stdout.write(JSON.stringify(${JSON.stringify(payload)}))`, [], { captureStdout: true }).result;
    assert.deepEqual(JSON.parse(result.stdout), payload);
    assert.equal(result.overflow, false);
  });

  test('captures large output split over many chunks', async () => {
    const result = await node(String.raw`const line = 'x'.repeat(99) + '\n'; for (let i = 0; i < 30000; i++) process.stdout.write(line);`, [], {
      captureStdout: true
    }).result;
    assert.equal(result.stdout.length, 3000000);
    assert.equal(result.overflow, false);
  });

  test('stops capturing past maxCapture and flags the overflow', async () => {
    const result = await node(`process.stdout.write('y'.repeat(200000))`, [], { captureStdout: true, maxCapture: 1024 }).result;
    assert.equal(result.overflow, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 1024);
  });

  test('can stream and capture stdout at the same time', async () => {
    const lines = [];
    const result = await node(String.raw`process.stdout.write('a\nb\n')`, [], { captureStdout: true, onStdoutLine: (line) => lines.push(line) }).result;
    assert.deepEqual(lines, ['a', 'b']);
    assert.equal(result.stdout, 'a\nb\n');
  });

  test('passes every argument literally, without a shell', async () => {
    const args = ['Título 🎬 ñ.mp4', 'a "quoted" & | < > %PATH% ^ !x!', 'C:\\Path With Spaces\\', '', '$(whoami)', 'line1\nline2'];
    const result = await node('process.stdout.write(JSON.stringify(process.argv.slice(1)))', args, { captureStdout: true }).result;
    assert.deepEqual(JSON.parse(result.stdout), args);
  });

  test('runs in the requested working folder, even with a non-ASCII name', async (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-test-proc-Canción 🎬-'));
    t.after(() => fs.promises.rm(cwd, { recursive: true, force: true }));
    const result = await node('process.stdout.write(process.cwd())', [], { cwd, captureStdout: true }).result;
    assert.equal(fs.realpathSync.native(result.stdout), fs.realpathSync.native(cwd));
  });

  test('sets the UTF-8 variables and strips Electron and Node variables from the parent', async (t) => {
    const saved = {
      ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
      ELECTRON_NO_ATTACH_CONSOLE: process.env.ELECTRON_NO_ATTACH_CONSOLE,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      VIDARO_TEST_PARENT: process.env.VIDARO_TEST_PARENT
    };
    t.after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.ELECTRON_NO_ATTACH_CONSOLE = '1';
    process.env.NODE_OPTIONS = '--max-old-space-size=64';
    process.env.VIDARO_TEST_PARENT = 'inherited';
    const script = [
      'const e = process.env;',
      'process.stdout.write(JSON.stringify({ utf8: e.PYTHONUTF8, io: e.PYTHONIOENCODING, run: e.ELECTRON_RUN_AS_NODE ?? null,',
      'attach: e.ELECTRON_NO_ATTACH_CONSOLE ?? null, options: e.NODE_OPTIONS ?? null, parent: e.VIDARO_TEST_PARENT ?? null,',
      'extra: e.VIDARO_TEST_EXTRA ?? null, hasPath: Boolean(e.PATH || e.Path) }));'
    ].join(' ');
    const plain = JSON.parse((await node(script, [], { captureStdout: true }).result).stdout);
    assert.deepEqual(plain, { utf8: '1', io: 'utf-8', run: null, attach: null, options: null, parent: 'inherited', extra: null, hasPath: true });
    const scoped = JSON.parse(
      (await node(script, [], { captureStdout: true, env: { ELECTRON_RUN_AS_NODE: '1', VIDARO_TEST_EXTRA: 'x', PYTHONUTF8: '0' } }).result).stdout
    );
    assert.equal(scoped.run, '1');
    assert.equal(scoped.extra, 'x');
    assert.equal(scoped.utf8, '0');
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
  });

  test('a missing executable rejects with ProcessError spawnFailed', async () => {
    const missing = path.join(os.tmpdir(), 'vidaro-test-missing', 'no-such-tool.exe');
    const handle = run(missing, ['--version']);
    await assert.rejects(handle.result, (error) => {
      assert.ok(error instanceof ProcessError);
      assert.equal(error.name, 'ProcessError');
      assert.equal(error.spawnFailed, true);
      assert.equal(error.errno, 'ENOENT');
      assert.equal(error.code, null);
      assert.deepEqual(error.stderrLines, []);
      return true;
    });
    assert.equal(liveCount(), 0);
  });

  test('tracks running processes in liveCount', async () => {
    const before = liveCount();
    const handle = node(SLEEP);
    assert.equal(liveCount(), before + 1);
    await handle.kill();
    await handle.result;
    assert.equal(liveCount(), before);
  });

  test('runs children below normal priority by default', async () => {
    const handle = node(SLEEP);
    try {
      assert.equal(os.getPriority(handle.pid), os.constants.priority.PRIORITY_BELOW_NORMAL);
    } finally {
      await stop(handle);
    }
  });

  test('priority can be left alone per call or globally', async () => {
    const parentPriority = os.getPriority();
    const perCall = node(SLEEP, [], { priority: false });
    setLowPriority(false);
    let global;
    try {
      global = node(SLEEP);
    } finally {
      setLowPriority(true);
    }
    const lowAgain = node(SLEEP);
    try {
      if (parentPriority === os.constants.priority.PRIORITY_NORMAL) {
        assert.equal(os.getPriority(perCall.pid), os.constants.priority.PRIORITY_NORMAL);
        assert.equal(os.getPriority(global.pid), os.constants.priority.PRIORITY_NORMAL);
      }
      assert.equal(os.getPriority(lowAgain.pid), os.constants.priority.PRIORITY_BELOW_NORMAL);
    } finally {
      await stop(perCall, global, lowAgain);
    }
  });

  test('kill() ends the process and the result resolves with a failure code', async () => {
    const handle = node(SLEEP);
    await handle.kill();
    const result = await handle.result;
    assert.notEqual(result.code, 0);
    assert.equal(isAlive(handle.pid), false);
  });
});

describe('abort', windowsOnly, () => {
  test('an already aborted signal rejects without starting anything', async () => {
    const controller = new AbortController();
    controller.abort('cancel');
    const before = liveCount();
    const handle = node(SLEEP, [], { signal: controller.signal });
    assert.equal(handle.pid, 0);
    assert.equal(liveCount(), before);
    await handle.kill();
    await assert.rejects(handle.result, (error) => error.name === 'AbortError' && error.reason === 'cancel');
  });

  test('aborting kills the whole tree, grandchildren included', async () => {
    const controller = new AbortController();
    const ready = waitForLine((line) => line.startsWith('grandchild '));
    const script = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(SLEEP)}], { stdio: 'ignore' });`,
      "process.stdout.write('grandchild ' + child.pid + '\\n');",
      SLEEP
    ].join('\n');
    const handle = node(script, [], { signal: controller.signal, onStdoutLine: ready.onLine });
    let grandchild = 0;
    try {
      grandchild = Number((await ready.promise).split(' ')[1]);
      assert.ok(grandchild > 0);
      assert.equal(isAlive(grandchild), true);
      controller.abort('pause');
      await assert.rejects(handle.result, (error) => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.reason, 'pause');
        return true;
      });
      assert.equal(await waitFor(() => !isAlive(handle.pid)), true);
      assert.equal(await waitFor(() => !isAlive(grandchild)), true);
      assert.equal(liveCount(), 0);
    } finally {
      await stop(handle);
      stopPid(grandchild);
    }
  });

  test('aborting after the process ended does nothing harmful', async () => {
    const controller = new AbortController();
    const result = await node('process.exit(0)', [], { signal: controller.signal }).result;
    controller.abort('cancel');
    assert.equal(result.code, 0);
  });

  test('the abort reason travels with the error for every queue reason', async () => {
    for (const reason of ['cancel', 'shutdown', 'stall']) {
      const controller = new AbortController();
      const handle = node(SLEEP, [], { signal: controller.signal });
      setImmediate(() => controller.abort(reason));
      await assert.rejects(handle.result, (error) => error.name === 'AbortError' && error.reason === reason);
      assert.equal(await waitFor(() => !isAlive(handle.pid)), true);
    }
  });

  test('aborting in the same tick as the spawn still stops the process', async () => {
    const controller = new AbortController();
    const handle = node(SLEEP, [], { signal: controller.signal });
    assert.ok(handle.pid > 0);
    controller.abort('cancel');
    await assert.rejects(handle.result, (error) => error.name === 'AbortError' && error.reason === 'cancel');
    assert.equal(await waitFor(() => !isAlive(handle.pid)), true);
    assert.equal(liveCount(), 0);
  });

  test('abortError builds a named error', () => {
    const controller = new AbortController();
    controller.abort('stall');
    const error = abortError(controller.signal);
    assert.equal(error.name, 'AbortError');
    assert.equal(error.reason, 'stall');
    assert.equal(abortError(undefined).reason, undefined);
  });
});

describe('killTree and killAll', windowsOnly, () => {
  test('killTree resolves for no pid and for a pid that does not exist', async () => {
    await killTree(0);
    await killTree(undefined);
    await killTree(2147483644);
  });

  test(
    'kill() after the process exited does not run taskkill on a pid Windows may have reused',
    async () => {
      const childProcess = require('node:child_process');
      const original = childProcess.spawn;
      const spawned = [];
      const modulePath = require.resolve('../src/main/processes');
      const cached = require.cache[modulePath];
      childProcess.spawn = function spawnSpy(file, ...rest) {
        spawned.push(file);
        return original.call(this, file, ...rest);
      };
      let fresh;
      try {
        delete require.cache[modulePath];
        fresh = require('../src/main/processes');
      } finally {
        childProcess.spawn = original;
        require.cache[modulePath] = cached;
      }
      const handle = fresh.run(process.execPath, ['-e', 'process.exit(0)']);
      await handle.result;
      spawned.length = 0;
      await handle.kill();
      assert.deepEqual(spawned, []);
    }
  );

  test('killAll stops every running process and waits for them', async () => {
    const handles = [node(SLEEP), node(SLEEP), node(SLEEP)];
    assert.equal(liveCount(), 3);
    await killAll();
    assert.equal(liveCount(), 0);
    const results = await Promise.all(handles.map((handle) => handle.result));
    for (const result of results) assert.notEqual(result.code, 0);
    for (const handle of handles) assert.equal(isAlive(handle.pid), false);
  });

  test('killAll with nothing running returns at once', async () => {
    const started = Date.now();
    await killAll(5000);
    assert.ok(Date.now() - started < 1000);
  });
});

const FAKE_TOOL = 'yt-dlp.exe';

function runningImageCount(name) {
  const tasklist = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
  const output = execFileSync(tasklist, ['/FI', `IMAGENAME eq ${name}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
  return output.split(/\r?\n/).filter((line) => line.toLowerCase().startsWith(`"${name}"`)).length;
}

describe('sweepOrphans', windowsOnly, () => {
  test('stops only tool processes whose executable lives in the given folders', async (t) => {
    if (runningImageCount(FAKE_TOOL) > 0) {
      t.skip(`a real ${FAKE_TOOL} is running, so the sweep is not exercised`);
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-test-sweep-'));
    const binDir = path.join(root, 'bin');
    const otherDir = path.join(root, 'bin-other');
    const handles = [];
    t.after(async () => {
      await stop(...handles);
      fs.rmSync(root, { recursive: true, force: true });
    });
    for (const dir of [binDir, otherDir]) {
      fs.mkdirSync(dir);
      const target = path.join(dir, FAKE_TOOL);
      try {
        fs.linkSync(process.execPath, target);
      } catch {
        fs.copyFileSync(process.execPath, target);
      }
    }
    const start = (dir) => {
      const handle = track(run(path.join(dir, FAKE_TOOL), ['-e', SLEEP]));
      handles.push(handle);
      return handle;
    };
    const inside = start(binDir);
    const outside = start(otherDir);
    const unrelated = node(SLEEP);
    handles.push(unrelated);
    assert.equal(await waitFor(() => isAlive(inside.pid) && isAlive(outside.pid)), true);

    await sweepOrphans([binDir]);
    assert.equal(await waitFor(() => !isAlive(inside.pid)), true);
    assert.equal(isAlive(outside.pid), true);
    assert.equal(isAlive(unrelated.pid), true);

    const again = start(binDir);
    await sweepOrphans([path.join(root, 'BIN') + path.sep, path.join(root, 'missing')]);
    assert.equal(await waitFor(() => !isAlive(again.pid)), true);
    assert.equal(isAlive(outside.pid), true);

    await sweepOrphans([]);
    assert.equal(isAlive(outside.pid), true);
    assert.equal(isAlive(unrelated.pid), true);
  });
});

describe('createStallWatchdog', () => {
  test('fires once when no progress arrives in time', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stalls = 0;
    const watchdog = createStallWatchdog({ timeoutMs: 1000, onStall: () => (stalls += 1) });
    watchdog.start();
    t.mock.timers.tick(999);
    assert.equal(stalls, 0);
    t.mock.timers.tick(1);
    assert.equal(stalls, 1);
    t.mock.timers.tick(10000);
    assert.equal(stalls, 1);
    watchdog.stop();
  });

  test('progress pushes the deadline forward, however slow the machine is', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stalls = 0;
    const watchdog = createStallWatchdog({ timeoutMs: 1000, onStall: () => (stalls += 1) });
    watchdog.start();
    for (let i = 0; i < 100; i += 1) {
      t.mock.timers.tick(900);
      watchdog.progress();
    }
    assert.equal(stalls, 0);
    t.mock.timers.tick(1000);
    assert.equal(stalls, 1);
    watchdog.stop();
  });

  test('does nothing before start and after stop', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stalls = 0;
    const watchdog = createStallWatchdog({ timeoutMs: 500, onStall: () => (stalls += 1) });
    t.mock.timers.tick(5000);
    assert.equal(stalls, 0);
    watchdog.start();
    t.mock.timers.tick(400);
    watchdog.stop();
    t.mock.timers.tick(5000);
    assert.equal(stalls, 0);
    watchdog.stop();
  });

  test('start can re-arm a watchdog that already fired', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stalls = 0;
    const watchdog = createStallWatchdog({ timeoutMs: 100, onStall: () => (stalls += 1) });
    watchdog.start();
    t.mock.timers.tick(100);
    watchdog.start();
    t.mock.timers.tick(100);
    assert.equal(stalls, 2);
    watchdog.stop();
  });

  test(
    'a late progress call after stop does not re-arm the timer',
    (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let stalls = 0;
      const watchdog = createStallWatchdog({ timeoutMs: 100, onStall: () => (stalls += 1) });
      watchdog.start();
      watchdog.stop();
      watchdog.progress();
      t.mock.timers.tick(1000);
      watchdog.stop();
      assert.equal(stalls, 0);
    }
  );
});
