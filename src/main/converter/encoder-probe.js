const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const processes = require('../processes');
const { isAbortError } = require('../errors');
const { writeFileAtomicSync, isPlainObject } = require('../store');
const encoders = require('./encoders');
const { linkedSignal } = require('./probe');

const CACHE_VERSION = 1;
const CODECS = Object.keys(encoders.CANDIDATES);
const KNOWN = new Set(Object.values(encoders.CANDIDATES).flat());
const MISSING_DRIVER = /Cannot load nvEncodeAPI|nvcuda\.dll|minimum required Nvidia driver|No NVENC capable devices|DLL amfrt\d*\.dll failed|Error initializing an internal MFX session|Error creating a MFX session/i;

function emptyAvailable() {
  return Object.fromEntries(CODECS.map((codec) => [codec, []]));
}

function parseEncoderList(text) {
  const names = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

function cleanList(value) {
  return Array.isArray(value) ? [...new Set(value.filter((name) => typeof name === 'string' && KNOWN.has(name)))] : [];
}

function readCacheFile(file, key) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(data) || data.version !== CACHE_VERSION || data.key !== key || !isPlainObject(data.available)) return null;
  const available = emptyAvailable();
  for (const codec of CODECS) {
    available[codec] = cleanList(data.available[codec]).filter((name) => encoders.codecOf(name) === codec);
  }
  return {
    available,
    tenBit: cleanList(data.tenBit),
    failed: cleanList(data.failed).filter((name) => encoders.isHardware(name)),
    detectedAt: Number.isFinite(data.detectedAt) ? data.detectedAt : null
  };
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(processes.abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(processes.abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function orderLike(list, reference) {
  return reference.filter((name) => list.includes(name));
}

function createEncoderProbe({ ffmpeg, cacheFile = null, cacheKey = '', timeoutMs = 20000, run = processes.run, retryDelays = [1500, 4000] }) {
  const emitter = new EventEmitter();
  const lifetime = new AbortController();
  const broken = new Set();
  let state = { status: 'unknown', available: emptyAvailable(), tenBit: [], failed: [], detectedAt: null };
  let current = null;
  let disposed = false;
  let generation = 0;

  function snapshot() {
    return {
      status: state.status,
      available: Object.fromEntries(CODECS.map((codec) => [codec, state.available[codec].slice()])),
      tenBit: state.tenBit.slice(),
      detectedAt: state.detectedAt,
      broken: [...broken]
    };
  }

  function usable() {
    return Object.fromEntries(CODECS.map((codec) => [codec, state.available[codec].filter((name) => !broken.has(name))]));
  }

  function changed() {
    if (!disposed) emitter.emit('changed', snapshot());
  }

  async function resolveKey() {
    try {
      const value = typeof cacheKey === 'function' ? await cacheKey() : cacheKey;
      return String(value ?? '');
    } catch {
      return 'unknown';
    }
  }

  function saveCache(key) {
    if (!cacheFile) return;
    const data = { version: CACHE_VERSION, key, detectedAt: state.detectedAt, available: state.available, tenBit: state.tenBit, failed: state.failed };
    try {
      writeFileAtomicSync(cacheFile, `${JSON.stringify(data, null, 2)}\n`);
    } catch {
      return;
    }
  }

  async function listCompiled(signal) {
    const handle = run(ffmpeg, ['-hide_banner', '-nostdin', '-encoders'], { signal, captureStdout: true, tailLines: 8 });
    const result = await handle.result;
    if (result.code !== 0) return new Set();
    return parseEncoderList(result.stdout);
  }

  async function testEncoder(name, tenBit) {
    const link = linkedSignal(lifetime.signal, timeoutMs);
    try {
      const handle = run(ffmpeg, encoders.encoderTestArgs(name, { tenBit }), { signal: link.signal, tailLines: 24 });
      const result = await handle.result;
      return { ok: result.code === 0, driverMissing: result.code !== 0 && result.stderrLines.some((line) => MISSING_DRIVER.test(line)) };
    } catch (error) {
      if (isAbortError(error) && !link.timedOut()) throw error;
      return { ok: false, driverMissing: false };
    } finally {
      link.dispose();
    }
  }

  async function testWithRetry(name, tenBit) {
    let result = await testEncoder(name, tenBit);
    for (const delay of retryDelays) {
      if (result.ok || result.driverMissing) break;
      await pause(delay, lifetime.signal);
      result = await testEncoder(name, tenBit);
    }
    return result;
  }

  async function recheckFailed(names, key, owner) {
    for (const name of names) {
      if (disposed || owner !== generation) return;
      const result = await testWithRetry(name, false);
      if (disposed || owner !== generation || !result.ok) continue;
      const codec = encoders.codecOf(name);
      const tenBitOk = encoders.supportsTenBit(name) && (await testWithRetry(name, true)).ok;
      if (disposed || owner !== generation) return;
      const available = { ...state.available, [codec]: orderLike([...state.available[codec], name], encoders.CANDIDATES[codec]) };
      state = {
        ...state,
        available,
        tenBit: tenBitOk ? [...new Set([...state.tenBit, name])] : state.tenBit,
        failed: state.failed.filter((item) => item !== name)
      };
      saveCache(key);
      changed();
    }
  }

  async function runDetection() {
    const compiled = await listCompiled(lifetime.signal);
    const available = emptyAvailable();
    const tenBit = [];
    const failed = [];
    const missingFamilies = new Set();
    const queue = CODECS.flatMap((codec) => encoders.CANDIDATES[codec].map((name) => ({ codec, name }))).filter(({ name }) => compiled.has(name));
    let index = 0;
    for (const { codec, name } of queue) {
      index += 1;
      if (!encoders.isHardware(name)) {
        available[codec].push(name);
        continue;
      }
      const family = encoders.familyOf(name);
      if (missingFamilies.has(family)) continue;
      emitter.emit('progress', { name, index, total: queue.length });
      const result = await testWithRetry(name, false);
      if (result.driverMissing) missingFamilies.add(family);
      if (!result.ok) {
        if (!result.driverMissing) failed.push(name);
        continue;
      }
      available[codec].push(name);
      if (encoders.supportsTenBit(name) && (await testWithRetry(name, true)).ok) tenBit.push(name);
    }
    for (const codec of CODECS) available[codec] = orderLike(available[codec], encoders.CANDIDATES[codec]);
    return { available, tenBit, failed, compiled: compiled.size > 0 };
  }

  async function detectNow(force) {
    const key = await resolveKey();
    const cached = !force && cacheFile ? readCacheFile(cacheFile, key) : null;
    generation += 1;
    const owner = generation;
    if (cached) {
      state = { status: 'ready', ...cached };
      changed();
      if (cached.failed.length) recheckFailed(cached.failed, key, owner).catch(() => {});
      return snapshot();
    }
    const previous = state;
    state = { ...state, status: 'detecting' };
    changed();
    try {
      const found = await runDetection();
      state = { status: 'ready', available: found.available, tenBit: found.tenBit, failed: found.failed, detectedAt: Date.now() };
      if (force) broken.clear();
      if (found.compiled) saveCache(key);
    } catch (error) {
      if (isAbortError(error)) {
        state = previous;
        throw error;
      }
      state = { ...previous, status: 'ready' };
    }
    changed();
    return snapshot();
  }

  function detect({ force = false } = {}) {
    if (disposed) return Promise.resolve(snapshot());
    if (!current) {
      current = detectNow(force).finally(() => {
        current = null;
      });
    }
    return current;
  }

  function markBroken(name) {
    if (typeof name !== 'string' || !encoders.isHardware(name) || broken.has(name)) return;
    broken.add(name);
    changed();
  }

  function on(event, listener) {
    emitter.on(event, listener);
    return () => emitter.off(event, listener);
  }

  function dispose() {
    disposed = true;
    lifetime.abort('shutdown');
    emitter.removeAllListeners();
  }

  return {
    get: snapshot,
    usable,
    detect,
    markBroken,
    isBroken: (name) => broken.has(name),
    on,
    off: (event, listener) => emitter.off(event, listener),
    dispose
  };
}

module.exports = { createEncoderProbe, parseEncoderList, readCacheFile };
