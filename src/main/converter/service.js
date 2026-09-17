const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isAbortError, serializeError, toJobError } = require('../errors');
const encoders = require('./encoders');
const planner = require('./plan');
const { probeMedia, createAnalyzer, createLru } = require('./probe');
const { thumbnailDataUrl } = require('./thumbnail');
const { createEncoderProbe } = require('./encoder-probe');
const { createConvertRunner, chooseEncoder, needsEncoderDetection } = require('./runner');
const { buildConvertJobs } = require('./jobs');

const PROBE_CONCURRENCY = 3;
const THUMBNAIL_CONCURRENCY = 2;

function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || waiting.length === 0) return;
    active += 1;
    const { task, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}

function pathKey(filePath) {
  return path.win32.resolve(filePath).normalize('NFC').toLowerCase();
}

function binarySignature(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return 'missing';
  }
}

function publicError(error) {
  const serialized = serializeError(toJobError(error));
  return { code: serialized.code, message: serialized.message, hint: serialized.hint };
}

function encoderView(state) {
  const details = {};
  for (const list of Object.values(encoders.CANDIDATES)) {
    for (const name of list) details[name] = { label: encoders.label(name), hardware: encoders.isHardware(name) };
  }
  return { ...state, encoders: details };
}

function hardwarePreference(getSettings) {
  try {
    return getSettings()?.convert?.hardware === 'software' ? 'software' : 'auto';
  } catch {
    return 'auto';
  }
}

function createConverterService({ paths, getSettings, appVersion, gpuInfo = async () => '' }) {
  const ffmpeg = paths.ffmpegPath();
  const ffprobe = paths.ffprobePath();
  const tempDir = paths.tempDir();
  const thumbsDir = path.join(tempDir, 'thumbs');
  const lifetime = new AbortController();
  const probeCache = createLru(200);
  const thumbCache = createLru(100);
  const analyzer = createAnalyzer({ ffmpeg });
  const analyses = new Map();
  const probeLimit = createLimiter(PROBE_CONCURRENCY);
  const thumbLimit = createLimiter(THUMBNAIL_CONCURRENCY);
  const encoderProbe = createEncoderProbe({
    ffmpeg,
    cacheFile: path.join(paths.cacheDir(), 'encoders.json'),
    cacheKey: async () => [appVersion, binarySignature(ffmpeg), await gpuInfo()].join('|')
  });
  const probe = (filePath, options = {}) => probeMedia(filePath, { ffprobe, cache: probeCache, ...options });
  const runner = createConvertRunner({ ffmpeg, ffprobe, tempDir, encoderProbe, getSettings, analyzer, probe });
  let disposed = false;

  const thumbsReady = fsp.rm(thumbsDir, { recursive: true, force: true }).catch(() => {});

  function probeOne(filePath) {
    return probeLimit(() => probe(filePath, { signal: lifetime.signal }));
  }

  async function probeMany(list) {
    const pending = new Map();
    for (const filePath of list) {
      const key = pathKey(filePath);
      if (!pending.has(key)) pending.set(key, probeOne(filePath).then((media) => ({ media }), (error) => ({ error })));
    }
    const results = [];
    for (const filePath of list) {
      const outcome = await pending.get(pathKey(filePath));
      if (outcome.error && isAbortError(outcome.error)) throw outcome.error;
      results.push(outcome.error ? { path: filePath, error: publicError(outcome.error) } : { path: filePath, media: { ...outcome.media, path: filePath } });
    }
    return results;
  }

  function analyze(filePath) {
    const key = pathKey(filePath);
    const existing = analyses.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const onLifetime = () => controller.abort('shutdown');
    lifetime.signal.addEventListener('abort', onLifetime, { once: true });
    const entry = { cancel: () => controller.abort('cancel'), promise: null };
    analyses.set(key, entry);
    entry.promise = (async () => {
      try {
        const media = await probe(filePath, { signal: controller.signal });
        if (!media.video) return null;
        const result = await analyzer.analyze(filePath, media, { signal: controller.signal });
        return { verdict: result.verdict, telecine: result.telecine, frames: result.frames };
      } catch (error) {
        if (isAbortError(error)) return null;
        throw Object.assign(new Error(publicError(error).message), { expose: true });
      } finally {
        lifetime.signal.removeEventListener('abort', onLifetime);
        if (analyses.get(key) === entry) analyses.delete(key);
      }
    })();
    return entry.promise;
  }

  function cancelAnalyze(filePath) {
    const entry = analyses.get(pathKey(filePath));
    if (!entry) return false;
    entry.cancel();
    return true;
  }

  async function thumbnail(filePath) {
    try {
      await thumbsReady;
      const media = await probeOne(filePath);
      return await thumbLimit(() => thumbnailDataUrl(filePath, media, { ffmpeg, tempDir: thumbsDir, signal: lifetime.signal, cache: thumbCache }));
    } catch {
      return null;
    }
  }

  function describe(preset, media, { trim = null } = {}) {
    const hardware = hardwarePreference(getSettings);
    const detect = needsEncoderDetection(preset, media, hardware);
    const state = encoderProbe.get();
    const choice = chooseEncoder({ preset, media, state, usable: detect ? encoderProbe.usable() : null, hardware });
    const analysis = media && media.path ? analyzer.cached(media.path, media) : null;
    let result;
    try {
      result = planner.describe(preset, media, { trim, analysis, encoder: choice.name });
    } catch {
      return { lines: [], estimateBytes: null, errors: [{ code: 'input-unreadable', message: 'This file cannot be described.' }], warnings: [], encoder: null, encodersReady: state.status === 'ready' };
    }
    return {
      ...result,
      warnings: [...new Set([...choice.warnings, ...result.warnings])],
      encoder: choice.name ? { name: choice.name, label: encoders.label(choice.name), hardware: encoders.isHardware(choice.name) } : null,
      encodersReady: !detect || state.status === 'ready'
    };
  }

  function encodersState() {
    const state = encoderProbe.get();
    if (state.status === 'unknown' && !disposed) encoderProbe.detect().catch(() => {});
    return encoderView(encoderProbe.get());
  }

  async function detectEncoders() {
    try {
      await encoderProbe.detect({ force: true });
    } catch (error) {
      if (!isAbortError(error)) throw error;
    }
    return encoderView(encoderProbe.get());
  }

  function onEncodersChanged(listener) {
    return encoderProbe.on('changed', (state) => listener(encoderView(state)));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifetime.abort('shutdown');
    for (const entry of analyses.values()) entry.cancel();
    analyses.clear();
    encoderProbe.dispose();
    probeCache.clear();
    thumbCache.clear();
    analyzer.clear();
  }

  return {
    runner,
    probe: probeMany,
    probeOne,
    analyze,
    cancelAnalyze,
    thumbnail,
    describe,
    encoders: encodersState,
    detectEncoders,
    buildJobs: (request) => buildConvertJobs(request),
    onEncodersChanged,
    dispose
  };
}

module.exports = { createConverterService, createLimiter, binarySignature };
