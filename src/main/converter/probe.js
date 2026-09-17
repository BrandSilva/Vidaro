const fsp = require('node:fs/promises');
const path = require('node:path');
const processes = require('../processes');
const { JobError, isAbortError } = require('../errors');
const { probeArgs, parseProbe, needsDeepProbe } = require('./media');
const { idetArgs, parseIdet } = require('./analysis');
const { createProgressParser } = require('./progress');
const { mapFfmpegError, errorFor } = require('./errors');

const DEEP_EXTENSIONS = new Set(['.mpg', '.mpeg', '.vob', '.ts', '.m2ts', '.mts', '.m2p', '.mod', '.tod', '.vro', '.trp']);
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR', 'ENXIO', 'ENODEV']);
const LOCKED_CODES = new Set(['EACCES', 'EPERM', 'EBUSY']);
const IDET_LINE = /Parsed_idet_\d+/;
const MAX_IDET_LINES = 64;

function createLru(limit) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    has: (key) => map.has(key),
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    }
  };
}

const sharedProbeCache = createLru(200);

function fileKey(filePath, stat) {
  return `${path.win32.resolve(filePath).normalize('NFC').toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
}

function inputError(key, detail = null) {
  return JobError.from(errorFor(key, detail));
}

async function statInput(filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (LOCKED_CODES.has(error.code)) throw inputError('input-locked', error.message);
    if (MISSING_CODES.has(error.code) || error.code === 'EINVAL') throw inputError('input-missing', error.message);
    throw inputError('input-unreadable', error.message);
  }
  if (!stat.isFile()) throw inputError('input-unreadable', 'This is not a file.');
  return stat;
}

function linkedSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort('timeout');
        }, timeoutMs)
      : null;
  return {
    signal: controller.signal,
    timedOut: () => timedOut && !signal?.aborted,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

async function runProbe(ffprobe, filePath, { deep, signal, run }) {
  const handle = run(ffprobe, probeArgs(filePath, { deep }), { signal, captureStdout: true, tailLines: 20 });
  const result = await handle.result;
  if (result.code !== 0) {
    const mapped = mapFfmpegError(result.stderrLines, { exitCode: result.code, stage: 'probe' });
    throw JobError.from(mapped.code === 'input-missing' || mapped.code === 'input-unreadable' ? mapped : { ...errorFor('input-unreadable'), detail: mapped.detail });
  }
  if (result.overflow) throw inputError('input-unreadable', 'The file information is too large.');
  return result.stdout;
}

function parseOutput(stdout, filePath, stat) {
  try {
    return parseProbe(stdout, { path: filePath, size: stat.size });
  } catch (error) {
    throw inputError('input-unreadable', error && error.name === 'SyntaxError' ? 'The file information could not be read.' : error?.message);
  }
}

async function probeMedia(filePath, { ffprobe, signal, timeoutMs = 60000, cache = sharedProbeCache, run = processes.run } = {}) {
  const stat = await statInput(filePath);
  const key = fileKey(filePath, stat);
  const cached = cache ? cache.get(key) : undefined;
  if (cached) return structuredClone(cached);
  const link = linkedSignal(signal, timeoutMs);
  try {
    const deepFirst = DEEP_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    let media = parseOutput(await runProbe(ffprobe, filePath, { deep: deepFirst, signal: link.signal, run }), filePath, stat);
    if (!deepFirst && needsDeepProbe(media)) {
      try {
        media = parseOutput(await runProbe(ffprobe, filePath, { deep: true, signal: link.signal, run }), filePath, stat);
      } catch (error) {
        if (isAbortError(error)) throw error;
      }
    }
    if (!media.video && media.audio.length === 0) throw inputError('input-unreadable', 'The file has no audio or video.');
    media.mtimeMs = stat.mtimeMs;
    if (cache) cache.set(key, media);
    return structuredClone(media);
  } catch (error) {
    if (isAbortError(error) && link.timedOut()) throw inputError('input-unreadable', 'Reading the file took too long.');
    throw error;
  } finally {
    link.dispose();
  }
}

function analysisKey(filePath, media) {
  return `${path.win32.resolve(filePath).normalize('NFC').toLowerCase()}|${media?.size ?? ''}|${media?.mtimeMs ?? ''}`;
}

function createAnalyzer({ ffmpeg, frames = 600, cacheSize = 200, timeoutMs = 10 * 60 * 1000, run = processes.run }) {
  const cache = createLru(cacheSize);

  function cached(filePath, media) {
    if (!media || !Number.isFinite(media.mtimeMs)) return null;
    return cache.get(analysisKey(filePath, media)) || null;
  }

  async function analyze(filePath, media, { signal, onProgress } = {}) {
    const hit = cached(filePath, media);
    if (hit) return hit;
    const parser = createProgressParser();
    const lines = [];
    const link = linkedSignal(signal, timeoutMs);
    let lastFrame = -1;
    try {
      const handle = run(ffmpeg, idetArgs(filePath, media, { frames }), {
        signal: link.signal,
        tailLines: 20,
        onStdoutLine: (line) => {
          const snapshot = parser.push(line);
          if (!snapshot || snapshot.frame === null || snapshot.frame <= lastFrame) return;
          lastFrame = snapshot.frame;
          if (onProgress) onProgress({ fraction: Math.min(1, snapshot.frame / frames), speed: snapshot.speed });
        },
        onStderrLine: (line) => {
          if (IDET_LINE.test(line) && lines.length < MAX_IDET_LINES) lines.push(line);
        }
      });
      const result = await handle.result;
      if (result.code !== 0) throw JobError.from(mapFfmpegError(result.stderrLines, { exitCode: result.code }));
      const verdict = parseIdet(lines);
      const analysis = { verdict: verdict.verdict, telecine: verdict.telecine, frames: verdict.frames, counts: verdict.counts };
      if (Number.isFinite(media?.mtimeMs)) cache.set(analysisKey(filePath, media), analysis);
      return analysis;
    } catch (error) {
      if (isAbortError(error) && link.timedOut()) throw inputError('input-unreadable', 'The analysis took too long.');
      throw error;
    } finally {
      link.dispose();
    }
  }

  return { analyze, cached, clear: () => cache.clear() };
}

module.exports = { probeMedia, createAnalyzer, createLru, statInput, fileKey, linkedSignal, DEEP_EXTENSIONS };
