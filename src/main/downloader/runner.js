const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const processes = require('../processes');
const { createTail } = require('../lines');
const { JobError, isAbortError } = require('../errors');
const { uniquePath, splitExt } = require('../fsnames');
const { buildDownloadArgs, expectedExtension, tempReserve, sectionDuration } = require('./args');
const { createDownloadParser } = require('./progress');
const { mapDownloadError, meaningfulWarnings, softFailure } = require('./errors');

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ALTERNATES = { mp4: ['mkv'], webm: ['mkv'] };
const SIDECARS = new Set([
  'srt', 'vtt', 'ass', 'ssa', 'lrc', 'ttml', 'srv1', 'srv2', 'srv3', 'json3', 'sbv',
  'jpg', 'jpeg', 'png', 'webp', 'json', 'description', 'annotations', 'url', 'webloc', 'desktop'
]);
const LEFTOVERS = new Set(['part', 'ytdl', 'tmp', 'temp', 'partial']);
const MAX_LINES = 200;
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 6, retryDelay: 200 };
const TRANSIENT_CODES = new Set(['http-403', 'network']);

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(processes.abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(processes.abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function lastExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isProgressLine(line) {
  return line.startsWith('VIDARO-') || /^[a-z_0-9]+=/.test(line);
}

function sameName(a, b) {
  return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
}

async function statFile(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function removeDir(dir) {
  await fsp.rm(dir, REMOVE_OPTIONS).catch(() => {});
}

async function removeFile(file) {
  await fsp.rm(file, { force: true, maxRetries: 3, retryDelay: 150 }).catch(() => {});
}

function invalidOptions(error) {
  return new JobError('invalid-options', {
    message: 'The download options are not valid.',
    detail: error?.message ?? null,
    hint: 'Add the video again with other options.',
    retryable: false
  });
}

function folderError(error) {
  if (['ENOENT', 'ENOTDIR', 'EINVAL', 'ENODEV'].includes(error?.code)) {
    return new JobError('output-folder-missing', {
      message: 'The output folder is not available.',
      detail: error.message,
      hint: 'Reconnect the drive or choose another output folder, then retry.'
    });
  }
  return error;
}

function pathTooLong() {
  return new JobError('path-too-long', {
    message: 'The file path is too long for Windows.',
    hint: 'Choose a shorter file name or a folder closer to the drive root.',
    retryable: false
  });
}

function outputMissing() {
  return new JobError('output-missing', {
    message: 'The downloaded file could not be found.',
    hint: 'Retry the download. Antivirus software can remove or block new files.'
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw processes.abortError(signal);
}

async function hasResumeData(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isFile() && !SIDECARS.has(lastExtension(entry.name)));
}

async function findByName(folder, name, extensions) {
  let entries;
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const { base, ext } = splitExt(entry.name);
    const extension = ext.slice(1).toLowerCase();
    if (!ext || SIDECARS.has(extension) || LEFTOVERS.has(extension) || !sameName(base, name)) continue;
    const full = path.win32.join(folder, entry.name);
    const stat = await statFile(full);
    if (!stat) continue;
    const rank = extensions.indexOf(extension);
    found.push({ path: full, stat, rank: rank === -1 ? extensions.length : rank });
  }
  found.sort((a, b) => a.rank - b.rank || b.stat.mtimeMs - a.stat.mtimeMs);
  return found[0] ?? null;
}

function combinePercent(previous, next) {
  if (next === null || next === undefined) return previous;
  if (previous === null || previous === undefined) return next;
  return Math.max(previous, next);
}

function createDownloadRunner({ ytdlp, ffmpegDir, tempDir, cacheDir = null, jsRuntime = null, run = processes.run, automaticRetries = 1, retryDelayMs = 2500 }) {
  const reserved = new Map();
  const percents = new Map();
  const runtime = jsRuntime ?? ytdlp.jsRuntime ?? null;

  function jobTempDir(id) {
    return path.win32.join(tempDir, 'download', id);
  }

  function reservedByOther(key, jobId) {
    return reserved.has(key) && reserved.get(key) !== jobId;
  }

  function claimTarget(jobId, folder, name, extension, collision, jobTemp) {
    const extensions = [extension, ...(ALTERNATES[extension] ?? [])];
    const reserve = tempReserve({ folder, tempDir: jobTemp, extension });
    const baseOf = (candidate) => candidate.slice(0, -(extension.length + 1));
    const keyOf = (candidate) => baseOf(candidate).normalize('NFC').toLowerCase();
    const existing = (candidate) => extensions.map((ext) => `${baseOf(candidate)}.${ext}`).find((file) => fs.existsSync(file)) ?? null;
    const fit = (existsFn) => {
      try {
        return uniquePath(folder, name, extension, existsFn, { reserve });
      } catch (error) {
        if (error?.code === 'path-too-long') throw pathTooLong();
        throw error;
      }
    };
    const claim = (candidate, extra = {}) => {
      const key = keyOf(candidate);
      reserved.set(key, jobId);
      return { path: candidate, name: path.win32.basename(baseOf(candidate)), key, extensions, ...extra };
    };
    const direct = fit(() => false);
    if (collision === 'skip') {
      const found = existing(direct);
      if (found || reservedByOther(keyOf(direct), jobId)) return { skipped: true, path: found ?? direct };
      return claim(direct);
    }
    if (collision === 'overwrite' && !reservedByOther(keyOf(direct), jobId)) return claim(direct);
    return claim(fit((candidate) => reservedByOther(keyOf(candidate), jobId) || existing(candidate) !== null));
  }

  function release(target, jobId) {
    if (target?.key && reserved.get(target.key) === jobId) reserved.delete(target.key);
  }

  async function removePartialTargets(target) {
    const base = target.path.slice(0, -(target.extensions[0].length + 1));
    for (const ext of target.extensions) await removeFile(`${base}.${ext}`);
  }

  async function confirmOutput(finalPath, folder, target) {
    if (finalPath) {
      const resolved = path.win32.resolve(folder, finalPath);
      const stat = await statFile(resolved);
      if (stat) return { path: resolved, size: stat.size, mtimeMs: stat.mtimeMs };
    }
    const found = await findByName(folder, target.name, target.extensions);
    return found ? { path: found.path, size: found.stat.size, mtimeMs: found.stat.mtimeMs } : null;
  }

  function followUpsFor(job, file, duration) {
    const after = job.spec.after;
    if (!isPlainObject(after) || !isPlainObject(after.preset)) return [];
    const fileName = path.win32.basename(file.path);
    const { base } = splitExt(fileName);
    return [
      {
        kind: 'convert',
        title: fileName,
        spec: {
          input: { path: file.path, size: file.size, mtimeMs: file.mtimeMs, duration, media: null },
          preset: after.preset,
          output: { folder: path.win32.dirname(file.path), name: base, baseName: base, collision: 'rename', keepDate: false },
          trim: null,
          deleteInputAfter: after.keepOriginal === false
        }
      }
    ];
  }

  function expectedDuration(options, info, parser) {
    if (parser.duration) return parser.duration;
    try {
      return sectionDuration(options, info?.duration ?? null);
    } catch {
      return null;
    }
  }

  function createReporter(job, ctx, parser) {
    let last = { stage: null, bytes: null, percent: null, time: null, detail: null };
    let percent = combinePercent(job.progress?.percent ?? null, percents.get(job.id) ?? null);
    const send = (stage, event) => {
      percent = combinePercent(percent, event?.percent ?? null);
      const bytes = event?.downloaded ?? null;
      const time = event?.time ?? null;
      const live = event?.type === 'progress';
      const part = live ? event.part : null;
      const detail = part && part.count > 1 ? `${part.index}/${part.count}` : null;
      const moved =
        stage !== last.stage ||
        (bytes !== null && bytes !== last.bytes) ||
        percent !== last.percent ||
        (time !== null && time !== last.time) ||
        detail !== last.detail;
      if (!moved) return;
      last = { stage, bytes: bytes ?? last.bytes, percent, time: time ?? last.time, detail };
      if (percent !== null) percents.set(job.id, percent);
      ctx.progress({ percent, stage, speed: live ? event.speed ?? null : null, eta: live ? event.eta ?? null : null, detail });
    };
    return {
      start: () => send('starting', null),
      event: (event) => {
        if (event.type === 'progress' || event.type === 'stage' || event.type === 'filepath') send(event.stage ?? parser.stage, event);
      }
    };
  }

  async function ensureTool(signal) {
    try {
      return await ytdlp.ensure({ signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new JobError('tool-missing', { detail: error?.message ?? null });
    }
  }

  async function prepare(folder, jobTemp) {
    try {
      await fsp.mkdir(folder, { recursive: true });
    } catch (error) {
      throw folderError(error);
    }
    const resume = await hasResumeData(jobTemp);
    await fsp.mkdir(jobTemp, { recursive: true });
    return resume;
  }

  async function execute(job, ctx, state) {
    const spec = job.spec;
    const options = isPlainObject(spec.options) ? spec.options : {};
    const output = isPlainObject(spec.output) ? spec.output : {};
    const signal = ctx.signal;
    const jobTemp = jobTempDir(job.id);
    let extension;
    try {
      extension = expectedExtension(options);
      if (typeof output.folder !== 'string' || !path.win32.isAbsolute(output.folder)) throw new TypeError('Output folder is invalid');
      if (typeof output.name !== 'string' || !output.name) throw new TypeError('Output name is invalid');
    } catch (error) {
      throw invalidOptions(error);
    }
    const folder = path.win32.normalize(output.folder);
    const collision = ['rename', 'overwrite', 'skip'].includes(output.collision) ? output.collision : 'rename';
    const parser = createDownloadParser();
    const reporter = createReporter(job, ctx, parser);
    reporter.start();

    const exe = await ensureTool(signal);
    throwIfAborted(signal);
    const resume = await prepare(folder, jobTemp);
    throwIfAborted(signal);

    const target = claimTarget(job.id, folder, output.name, extension, collision, jobTemp);
    if (target.skipped) {
      await removeDir(jobTemp);
      percents.delete(job.id);
      const stat = await statFile(target.path);
      return { path: target.path, size: stat ? stat.size : null, warnings: [], skipped: true, followUps: [] };
    }
    state.target = target;
    if (target.name !== output.name) ctx.note({ output: { name: target.name } });

    if (options.cookiesMode === 'file' && (typeof options.cookiesFile !== 'string' || !fs.existsSync(options.cookiesFile))) {
      throw new JobError('cookies-missing', {
        message: 'The cookies file could not be found.',
        hint: 'Choose the cookies file again in Settings.',
        action: 'cookies',
        retryable: false
      });
    }
    let args;
    try {
      args = buildDownloadArgs(
        { url: spec.url, options, output: { folder, name: target.name, collision } },
        { ffmpegDir, tempDir: jobTemp, jsRuntime: runtime, cacheDir, resume }
      );
    } catch (error) {
      throw invalidOptions(error);
    }

    const tail = createTail(MAX_LINES);
    state.parser = parser;
    const onLine = (line) => {
      if (!isProgressLine(line)) tail.add(line);
      const event = parser.push(line);
      if (!event) return;
      if (event.type === 'filepath') state.finalPath = event.path;
      reporter.event(event);
    };
    const handle = run(exe, args, { signal, env: ytdlp.childEnv(), onStdoutLine: onLine, onStderrLine: onLine, tailLines: 5 });
    ytdlp.track(handle.result);
    let result;
    try {
      result = await handle.result;
    } catch (error) {
      if (error?.spawnFailed) ytdlp.invalidate();
      throw error;
    }

    const lines = tail.lines();
    const file = await confirmOutput(state.finalPath, folder, target);
    const soft = result.code === 0 ? null : softFailure(lines);
    if (result.code !== 0 && !(soft && file)) throw JobError.from(mapDownloadError(lines, { exitCode: result.code }));
    if (!file) throw outputMissing();
    state.done = true;
    const warnings = meaningfulWarnings(lines);
    if (soft && !warnings.includes(soft)) warnings.push(soft);
    await removeDir(jobTemp);
    percents.delete(job.id);
    return {
      path: file.path,
      size: file.size,
      warnings,
      skipped: false,
      followUps: followUpsFor(job, file, expectedDuration(options, spec.info, parser))
    };
  }

  async function afterFailure(job, reason, state) {
    const moving = state.parser?.stage === 'moving' && !state.finalPath && !state.done;
    if (moving && state.target) await removePartialTargets(state.target);
    if (reason === 'cancel') {
      percents.delete(job.id);
      await removeDir(jobTempDir(job.id));
    }
  }

  async function runJob(job, ctx) {
    if (!isPlainObject(job) || !JOB_ID.test(job.id ?? '') || !isPlainObject(job.spec)) {
      throw new JobError('invalid-options', { message: 'The download options are not valid.', retryable: false });
    }
    for (let attempt = 0; ; attempt += 1) {
      const state = { target: null, parser: null, finalPath: null, done: false };
      try {
        return await execute(job, ctx, state);
      } catch (error) {
        const aborted = isAbortError(error);
        await afterFailure(job, aborted ? ctx.signal?.reason : null, state);
        if (aborted || attempt >= automaticRetries || !TRANSIENT_CODES.has(error?.code)) throw error;
      } finally {
        release(state.target, job.id);
      }
      await pause(retryDelayMs, ctx.signal);
    }
  }

  async function cleanup(job) {
    if (!isPlainObject(job) || !JOB_ID.test(job.id ?? '')) return;
    percents.delete(job.id);
    await removeDir(jobTempDir(job.id));
  }

  return { run: runJob, cleanup };
}

module.exports = { createDownloadRunner, hasResumeData, findByName };
