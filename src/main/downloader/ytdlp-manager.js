const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const processes = require('../processes');
const { writeFileAtomicSync, isPlainObject } = require('../store');
const { updateArgs, versionArgs, runtimeProbeArgs, processEnv } = require('./args');
const { parseVersion, isNewer, parseUpdateOutput, parseJsRuntimes } = require('./versions');

const EXE_NAME = 'yt-dlp.exe';
const META_NAME = 'yt-dlp.json';
const MIN_EXE_BYTES = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMINGS = Object.freeze({
  firstCheckMs: 2 * 60 * 1000,
  intervalMs: 60 * 60 * 1000,
  retryMs: 6 * 60 * 60 * 1000,
  deferPollMs: 15 * 1000,
  updateTimeoutMs: 3 * 60 * 1000,
  probeTimeoutMs: 60 * 1000,
  renameRetries: 6,
  renameDelayMs: 150
});
const RUNTIME_MINIMUMS = { node: [22, 0, 0], deno: [2, 3, 0], bun: [1, 0, 31] };
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function safely(fn) {
  try {
    fn();
  } catch {
    return;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameFile(stat, meta) {
  return Boolean(stat && meta && stat.size === meta.size && Math.round(stat.mtimeMs) === Math.round(meta.mtimeMs));
}

function semver(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function meetsMinimum(name, version) {
  const minimum = RUNTIME_MINIMUMS[name];
  if (!minimum) return true;
  const parts = semver(version);
  if (!parts) return false;
  for (let i = 0; i < 3; i += 1) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

function runtimeVerdict(lines, runtime) {
  const list = parseJsRuntimes(lines);
  if (!runtime) return { name: null, version: null, ok: false };
  const found = (list ?? []).find((item) => item.name === runtime.name);
  if (!found) return { name: runtime.name, version: null, ok: false };
  return { name: runtime.name, version: found.version, ok: found.supported && meetsMinimum(runtime.name, found.version) };
}

function failureCode(result) {
  const message = result?.message ?? '';
  if (/unable to write|permission|access is denied|try running as administrator/i.test(message)) return 'write-failed';
  if (/obtain version info|connect|resolve|network|timed out|urlopen|ssl|certificate/i.test(message)) return 'offline';
  return 'failed';
}

function readMeta(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlainObject(data) || !parseVersion(data.version) || !Number.isFinite(data.size) || !Number.isFinite(data.mtimeMs)) return null;
    return { version: data.version, size: data.size, mtimeMs: data.mtimeMs, channel: data.channel === 'nightly' ? 'nightly' : 'stable' };
  } catch {
    return null;
  }
}

async function statFile(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function channelOf(version, fallback) {
  const parsed = parseVersion(version);
  if (parsed?.channel === 'nightly' || parsed?.channel === 'stable') return parsed.channel;
  return fallback === 'nightly' ? 'nightly' : 'stable';
}

function createYtDlpManager({
  bundledPath,
  bundledVersion,
  userBinDir,
  runtimeDir = null,
  jsRuntime = null,
  getSettings,
  updateSettings = () => {},
  isBusy = () => false,
  now = () => Date.now(),
  run = processes.run,
  timings = {}
}) {
  const times = { ...DEFAULT_TIMINGS, ...timings };
  const emitter = new EventEmitter();
  const target = path.join(userBinDir, EXE_NAME);
  const metaFile = path.join(userBinDir, META_NAME);
  let meta = null;
  let metaLoaded = false;
  let active = null;
  let ensuring = null;
  let updating = null;
  let updateController = null;
  let pending = null;
  let deferTimer = null;
  let dailyTimer = null;
  let attemptedAt = null;
  let manualWanted = false;
  let live = 0;
  let sweeping = null;
  let disposed = false;
  let runtimeInfo = null;
  let runtimeProbe = null;
  const state = { checking: false, updating: false, lastResult: null, latest: null, error: null, errorDetail: null };

  function settings() {
    try {
      return getSettings()?.download ?? {};
    } catch {
      return {};
    }
  }

  function usingBundled() {
    return active !== null && active === bundledPath && active !== target;
  }

  function status() {
    const current = settings();
    return {
      version: usingBundled() ? bundledVersion ?? null : meta?.version ?? null,
      channel: usingBundled() ? 'stable' : meta?.channel ?? null,
      targetChannel: current.ytdlpChannel === 'nightly' ? 'nightly' : 'stable',
      bundledVersion: bundledVersion ?? null,
      path: active,
      usingBundled: usingBundled(),
      checking: state.checking,
      updating: state.updating,
      pending: pending !== null,
      autoUpdate: current.ytdlpAutoUpdate !== false,
      lastCheck: Number.isFinite(current.ytdlpLastCheck) && current.ytdlpLastCheck > 0 ? current.ytdlpLastCheck : null,
      lastResult: state.lastResult,
      latest: state.latest,
      error: state.error,
      errorDetail: state.errorDetail,
      jsRuntime: runtimeInfo ?? { name: jsRuntime?.name ?? null, version: null, ok: null }
    };
  }

  function publish() {
    if (!disposed) emitter.emit('status', status());
  }

  function set(patch) {
    Object.assign(state, patch);
    publish();
  }

  function childEnv() {
    const env = processEnv({ jsRuntime });
    if (runtimeDir) {
      env.TEMP = runtimeDir;
      env.TMP = runtimeDir;
    }
    return env;
  }

  function loadMeta() {
    if (!metaLoaded) {
      meta = readMeta(metaFile);
      metaLoaded = true;
    }
    return meta;
  }

  function saveMeta(next) {
    meta = next;
    metaLoaded = true;
    try {
      writeFileAtomicSync(metaFile, `${JSON.stringify(next, null, 2)}\n`);
    } catch {
      return;
    }
  }

  function track(promise) {
    live += 1;
    const settle = () => {
      live -= 1;
      if (live === 0) sweepRuntime();
    };
    Promise.resolve(promise).then(settle, settle);
    return promise;
  }

  function exec(file, args, options = {}) {
    let handle;
    try {
      handle = run(file, args, { ...options, env: { ...childEnv(), ...options.env } });
    } catch (error) {
      return Promise.reject(error);
    }
    return track(handle.result);
  }

  async function capture(file, args, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const lines = [];
    try {
      const result = await exec(file, args, {
        signal: controller.signal,
        captureStdout: true,
        onStderrLine: (line) => lines.push(line),
        tailLines: 1
      });
      return { code: result.code, stdout: result.stdout, lines: [...result.stdout.split(/\r?\n/), ...lines] };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeVersion(file) {
    try {
      const result = await capture(file, versionArgs(), times.probeTimeoutMs);
      if (result.code !== 0) return null;
      return parseVersion(result.stdout.trim())?.text ?? null;
    } catch {
      return null;
    }
  }

  async function removeLeftovers() {
    let entries;
    try {
      entries = await fsp.readdir(userBinDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === `${EXE_NAME}.old` || (name.startsWith(`${EXE_NAME}.`) && name.endsWith('.tmp'))) {
        await fsp.rm(path.join(userBinDir, name), { force: true }).catch(() => {});
      }
    }
  }

  async function replaceTarget(temp) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await fsp.rename(temp, target);
        return;
      } catch (error) {
        if (attempt >= times.renameRetries || !LOCK_CODES.has(error.code)) throw error;
        await delay(times.renameDelayMs * attempt);
      }
    }
  }

  async function install() {
    await fsp.mkdir(userBinDir, { recursive: true });
    const temp = path.join(userBinDir, `${EXE_NAME}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      await fsp.copyFile(bundledPath, temp);
      await replaceTarget(temp);
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    const stat = await statFile(target);
    if (!stat) throw new Error('yt-dlp copy is missing');
    runtimeInfo = null;
    const installed = parseVersion(bundledVersion)?.text ?? (await probeVersion(target));
    if (installed) saveMeta({ version: installed, size: stat.size, mtimeMs: stat.mtimeMs, channel: channelOf(installed, 'stable') });
    else invalidate();
    return target;
  }

  async function verifyExisting(stat) {
    const known = loadMeta();
    if (sameFile(stat, known)) return known.version;
    if (stat.size < MIN_EXE_BYTES) return null;
    const version = await probeVersion(target);
    if (!version) return null;
    saveMeta({ version, size: stat.size, mtimeMs: stat.mtimeMs, channel: channelOf(version, known?.channel) });
    runtimeInfo = null;
    return version;
  }

  async function resolve() {
    const hasBundled = Boolean(bundledPath) && (await statFile(bundledPath)) !== null;
    const stat = await statFile(target);
    const version = stat ? await verifyExisting(stat) : null;
    if (version && !(hasBundled && isNewer(bundledVersion, version))) return target;
    if (!hasBundled) {
      const error = new Error('yt-dlp is missing');
      error.code = 'ENOENT';
      throw error;
    }
    try {
      await removeLeftovers();
      return await install();
    } catch {
      return version ? target : bundledPath;
    }
  }

  function ensureNow() {
    if (!ensuring) {
      ensuring = resolve()
        .then((file) => {
          const changed = file !== active;
          active = file;
          if (changed) publish();
          return file;
        })
        .finally(() => {
          ensuring = null;
        });
    }
    return ensuring;
  }

  function untilAborted(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(processes.abortError(signal));
    return new Promise((resolvePromise, reject) => {
      const onAbort = () => reject(processes.abortError(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolvePromise(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  async function ensure({ signal } = {}) {
    if (updating) await untilAborted(updating.catch(() => undefined), signal);
    return untilAborted(ensureNow(), signal);
  }

  async function version() {
    if (!updating) {
      try {
        await ensureNow();
      } catch {
        return null;
      }
    }
    if (usingBundled()) return bundledVersion ?? null;
    return meta?.version ?? null;
  }

  function invalidate() {
    metaLoaded = false;
    meta = null;
    runtimeInfo = null;
  }

  async function probeRuntime() {
    if (!jsRuntime) return { name: null, version: null, ok: false };
    if (runtimeInfo) return runtimeInfo;
    if (updating) return null;
    if (!runtimeProbe) {
      runtimeProbe = (async () => {
        try {
          const file = await ensureNow();
          const result = await capture(file, runtimeProbeArgs({ jsRuntime }), times.probeTimeoutMs);
          const verdict = runtimeVerdict(result.lines, jsRuntime);
          if (parseJsRuntimes(result.lines) !== null) runtimeInfo = verdict;
          return verdict;
        } catch {
          return { name: jsRuntime.name, version: null, ok: false };
        }
      })().finally(() => {
        runtimeProbe = null;
      });
    }
    return runtimeProbe;
  }

  async function inspect() {
    await version();
    const probed = await probeRuntime();
    const snapshot = status();
    return probed && !runtimeInfo ? { ...snapshot, jsRuntime: probed } : snapshot;
  }

  function busy() {
    let external = false;
    try {
      external = Boolean(isBusy());
    } catch {
      external = false;
    }
    return external || live > 0;
  }

  function armDeferred() {
    clearTimeout(deferTimer);
    if (disposed || pending === null) return;
    deferTimer = setTimeout(() => {
      deferTimer = null;
      if (disposed || pending === null) return;
      if (busy() || updating) {
        armDeferred();
        return;
      }
      const request = pending;
      pending = null;
      update(request).catch(() => undefined);
    }, times.deferPollMs);
  }

  async function runUpdate(file, channel, tag, controller) {
    const lines = [];
    const collect = (line) => {
      lines.push(line);
      if (/^Updating to /.test(line.trim()) && !state.updating) set({ updating: true });
    };
    const result = await exec(file, updateArgs(channel, { tag }), {
      signal: controller.signal,
      onStdoutLine: collect,
      onStderrLine: collect,
      tailLines: 1
    });
    return parseUpdateOutput(lines, { exitCode: result.code });
  }

  async function performUpdate(manual) {
    const channel = settings().ytdlpChannel === 'nightly' ? 'nightly' : 'stable';
    const controller = new AbortController();
    updateController = controller;
    const timer = setTimeout(() => controller.abort('timeout'), times.updateTimeoutMs);
    set({ checking: true, updating: false, error: null, errorDetail: null });
    let outcome;
    try {
      const file = await ensureNow();
      if (file !== target) {
        outcome = { status: 'failed', code: 'not-updatable', detail: null };
      } else {
        let result = await runUpdate(file, channel, null, controller);
        if (result.status === 'current' && channel === 'stable' && result.version?.channel === 'nightly' && result.latest?.channel === 'stable') {
          result = await runUpdate(file, channel, result.latest.text, controller);
        }
        if (result.status === 'failed') {
          outcome = { status: 'failed', code: failureCode(result), detail: result.message, latest: result.latest?.text ?? null };
        } else {
          const stat = await statFile(target);
          const installed = result.version?.text ?? (await probeVersion(target));
          if (stat && installed) {
            saveMeta({ version: installed, size: stat.size, mtimeMs: stat.mtimeMs, channel: channelOf(result.version ?? installed, channel) });
          } else {
            invalidate();
          }
          if (result.status === 'updated') {
            runtimeInfo = null;
            await removeLeftovers();
          }
          outcome = { status: result.status, latest: result.latest?.text ?? installed ?? null };
        }
      }
    } catch (error) {
      const timedOut = controller.signal.aborted && controller.signal.reason === 'timeout';
      if (controller.signal.aborted && !timedOut) outcome = { status: 'failed', code: 'canceled', detail: null };
      else outcome = { status: 'failed', code: timedOut ? 'timeout' : 'failed', detail: timedOut ? null : error?.message ?? null };
      if (timedOut) invalidate();
    } finally {
      clearTimeout(timer);
      updateController = null;
    }
    if (outcome.status !== 'failed') safely(() => updateSettings({ download: { ytdlpLastCheck: now() } }));
    const silent = !(manual || manualWanted) && outcome.status === 'failed';
    manualWanted = false;
    set({
      checking: false,
      updating: false,
      lastResult: silent ? state.lastResult : outcome.status,
      latest: outcome.latest ?? state.latest,
      error: silent || outcome.status !== 'failed' ? null : outcome.code,
      errorDetail: silent || outcome.status !== 'failed' ? null : outcome.detail ?? null
    });
    return {
      status: outcome.status,
      version: meta?.version ?? null,
      channel: meta?.channel ?? null,
      error: outcome.status === 'failed' ? outcome.code : null
    };
  }

  function update({ manual = false } = {}) {
    if (disposed) return Promise.resolve({ status: 'failed', error: 'disposed' });
    if (updating) {
      if (manual) manualWanted = true;
      return updating;
    }
    if (busy()) {
      pending = { manual: Boolean(manual) || Boolean(pending?.manual) };
      armDeferred();
      publish();
      return Promise.resolve({ deferred: true });
    }
    pending = null;
    clearTimeout(deferTimer);
    deferTimer = null;
    attemptedAt = now();
    updating = performUpdate(Boolean(manual)).finally(() => {
      updating = null;
    });
    return updating;
  }

  function dailyTick() {
    dailyTimer = null;
    if (disposed) return;
    const current = settings();
    const last = Number.isFinite(current.ytdlpLastCheck) ? current.ytdlpLastCheck : 0;
    const due = now() - last >= DAY_MS && (attemptedAt === null || now() - attemptedAt >= times.retryMs);
    if (current.ytdlpAutoUpdate !== false && due && !updating && pending === null) update({ manual: false }).catch(() => undefined);
    dailyTimer = setTimeout(dailyTick, times.intervalMs);
  }

  function scheduleDaily() {
    if (disposed) return;
    clearTimeout(dailyTimer);
    dailyTimer = setTimeout(dailyTick, times.firstCheckMs);
  }

  function sweepRuntime() {
    if (!runtimeDir || live > 0 || sweeping || disposed) return sweeping ?? Promise.resolve();
    sweeping = (async () => {
      let entries;
      try {
        entries = await fsp.readdir(runtimeDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (live > 0) return;
        if (!entry.isDirectory() || !/^_MEI\d+$/i.test(entry.name)) continue;
        await fsp.rm(path.join(runtimeDir, entry.name), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(() => {});
      }
    })().finally(() => {
      sweeping = null;
    });
    return sweeping;
  }

  function dispose() {
    disposed = true;
    clearTimeout(deferTimer);
    clearTimeout(dailyTimer);
    deferTimer = null;
    dailyTimer = null;
    pending = null;
    if (updateController) updateController.abort('shutdown');
    emitter.removeAllListeners();
  }

  return {
    ensure,
    version,
    status,
    inspect,
    update,
    scheduleDaily,
    invalidate,
    sweepRuntime,
    childEnv,
    track,
    dispose,
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    get jsRuntime() {
      return jsRuntime;
    },
    get live() {
      return live;
    },
    targetPath: target
  };
}

module.exports = { createYtDlpManager, runtimeVerdict, meetsMinimum, failureCode };
