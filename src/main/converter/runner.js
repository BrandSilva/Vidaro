const fsp = require('node:fs/promises');
const path = require('node:path');
const processes = require('../processes');
const { JobError, isAbortError } = require('../errors');
const { validatePreset } = require('../presets');
const planner = require('./plan');
const encoders = require('./encoders');
const names = require('./names');
const { createProgressParser } = require('./progress');
const { checkOutput } = require('./verify');
const { mapFfmpegError, errorFor, isInputProblem, isEnvironmentProblem } = require('./errors');
const { probeMedia, statInput, createAnalyzer } = require('./probe');

const STAGE_WEIGHTS = Object.freeze({
  analyzing: 0.04,
  'measuring-loudness': 0.12,
  'encoding-pass-1': 0.6,
  encoding: 1,
  verifying: 0.02
});
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROOTED = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;
const COLLISIONS = new Set(['rename', 'overwrite', 'skip']);
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const MISSING_FOLDER_CODES = new Set(['ENOENT', 'ENODEV', 'ENXIO', 'EINVAL', 'ENOTDIR', 'EEXIST']);
const DENIED_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'EBUSY']);
const RENAME_ATTEMPTS = 8;
const EARLY_FAILURE_SECONDS = 1;
const MIN_FREE_BYTES = 8 * 1024 * 1024;
const LOUDNORM_START = /Parsed_loudnorm_\d+/;
const MAX_LOUDNORM_LINES = 64;
const INPUT_SPECIFIC_HARDWARE =
  /Current (?:resolution|pixel format|frame rate|picture structure|profile|codec type|ratecontrol mode) is unsupported|Selected ratecontrol mode is unsupported|could not set output type|format negotiation failed|resolution|frame size|bit ?depth|10-bit/i;

class StepFailure extends Error {
  constructor(mapped, outTime, lines) {
    super(mapped.message);
    this.name = 'StepFailure';
    this.mapped = mapped;
    this.outTime = outTime;
    this.lines = lines;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsolutePath(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 32767 && !value.includes('\0') && ROOTED.test(value) && path.win32.isAbsolute(value);
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unique(list) {
  return [...new Set(list.filter((item) => typeof item === 'string' && item))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw processes.abortError(signal);
}

function raceAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(processes.abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function invalidJob(detail) {
  return JobError.from({ ...errorFor('invalid-job'), detail });
}

function isMedia(media) {
  return (
    isObject(media) &&
    Array.isArray(media.audio) &&
    Array.isArray(media.subtitles) &&
    Array.isArray(media.warnings) &&
    typeof media.container === 'string' &&
    typeof media.durationReliable === 'boolean' &&
    (media.video === null || (isObject(media.video) && Number.isInteger(media.video.index)))
  );
}

function readTrim(trim) {
  if (trim === null || trim === undefined) return null;
  if (!isObject(trim)) throw invalidJob('trim');
  const start = trim.start === null || trim.start === undefined ? null : finiteOrNull(trim.start);
  const end = trim.end === null || trim.end === undefined ? null : finiteOrNull(trim.end);
  if ((trim.start !== null && trim.start !== undefined && start === null) || (trim.end !== null && trim.end !== undefined && end === null)) throw invalidJob('trim');
  if ((start !== null && start < 0) || (end !== null && end <= (start || 0))) throw invalidJob('trim');
  return start || end !== null ? { start, end } : null;
}

function readSpec(job) {
  if (!isObject(job) || typeof job.id !== 'string' || !JOB_ID.test(job.id)) throw invalidJob('job');
  const spec = job.spec;
  if (!isObject(spec) || !isObject(spec.input) || !isAbsolutePath(spec.input.path)) throw invalidJob('input');
  if (!isObject(spec.output) || !isAbsolutePath(spec.output.folder)) throw invalidJob('output folder');
  const base = typeof spec.output.baseName === 'string' && spec.output.baseName.trim() ? spec.output.baseName : spec.output.name;
  if (typeof base !== 'string' || !base.trim() || base.length > 255 || /[\\/]/.test(base)) throw invalidJob('output name');
  let preset;
  try {
    preset = validatePreset(spec.preset, { allowBuiltInId: true });
  } catch {
    throw invalidJob('preset');
  }
  return {
    input: {
      path: path.win32.normalize(spec.input.path),
      size: finiteOrNull(spec.input.size),
      mtimeMs: finiteOrNull(spec.input.mtimeMs),
      media: spec.input.media
    },
    preset,
    output: {
      folder: path.win32.normalize(spec.output.folder),
      baseName: base,
      collision: COLLISIONS.has(spec.output.collision) ? spec.output.collision : 'rename',
      keepDate: spec.output.keepDate === true
    },
    trim: readTrim(spec.trim),
    deleteInputAfter: spec.deleteInputAfter === true
  };
}

function wantsVideoEncode(preset, media) {
  return Boolean(media && media.video) && preset.video.mode === 'encode' && !planner.isAudioOnlyOutput(preset);
}

function chooseEncoder({ preset, media, state = null, usable = null, hardware = 'auto' }) {
  const warnings = [];
  if (!wantsVideoEncode(preset, media)) return { name: null, warnings };
  const codec = preset.video.codec;
  const deep = media.video.bitDepth > 8 && codec !== 'h264';
  const tenBit = new Set((state && state.tenBit) || []);
  const listed = (usable && usable[codec]) || [];
  const list = listed.filter((name) => !deep || !encoders.isHardware(name) || !encoders.supportsTenBit(name) || tenBit.has(name));
  const forced = preset.video.encoder || 'auto';
  const name = encoders.pickEncoder(codec, list, hardware === 'software' ? 'software' : 'auto', forced, preset.container);
  if (forced !== 'auto' && name !== forced) {
    warnings.push(listed.includes(forced) && !encoders.supportsContainer(forced, preset.container) ? 'encoder-container' : 'encoder-unavailable');
  }
  return { name, warnings };
}

function needsEncoderDetection(preset, media, hardware) {
  if (!wantsVideoEncode(preset, media)) return false;
  const forced = preset.video.encoder || 'auto';
  return hardware !== 'software' || (forced !== 'auto' && encoders.isHardware(forced));
}

function isTelecineRate(fps) {
  if (!fps || !(fps.den > 0)) return false;
  const value = fps.num / fps.den;
  return Math.abs(value - 30000 / 1001) < 0.01 || Math.abs(value - 30) < 0.01;
}

function needsAnalysis(media, preset) {
  if (!wantsVideoEncode(preset, media)) return false;
  const video = media.video;
  const picture = preset.picture || {};
  const autoDeinterlace = picture.deinterlace === 'auto';
  const autoIvtc = picture.ivtc === 'auto';
  if (!autoDeinterlace && !autoIvtc) return false;
  if (video.fieldOrder === 'unknown' || (media.warnings || []).includes('field-order-unknown')) return true;
  if (!autoIvtc || video.softTelecine || video.vfr) return false;
  return (video.fieldOrder === 'tff' || video.fieldOrder === 'bff') && isTelecineRate(video.fps);
}

function planStages({ analyze = false, scans = 0, twoPass = false }) {
  const stages = [];
  if (analyze) stages.push('analyzing');
  for (let index = 0; index < scans; index += 1) stages.push('measuring-loudness');
  if (twoPass) stages.push('encoding-pass-1');
  stages.push('encoding', 'verifying');
  return stages;
}

function createTracker(stages) {
  const weights = stages.map((stage) => STAGE_WEIGHTS[stage] || 0);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let position = -1;
  let finished = false;
  const doneWeight = () => weights.slice(0, Math.max(0, position)).reduce((sum, value) => sum + value, 0);
  return {
    begin(stage) {
      if (stage === 'finishing') {
        finished = true;
        return 100;
      }
      const next = stages.indexOf(stage, position + 1);
      if (next >= 0) position = next;
      else if (position < 0 || stages[position] !== stage) {
        const earlier = stages.lastIndexOf(stage);
        if (earlier >= 0) position = earlier;
      }
      return this.percent(0);
    },
    percent(fraction) {
      if (finished) return 100;
      if (position < 0) return 0;
      if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return null;
      const share = Math.min(1, Math.max(0, fraction));
      return Math.round(((doneWeight() + weights[position] * share) / total) * 1000) / 10;
    }
  };
}

function createReporter(ctx, tracker) {
  let stage = null;
  let detail = null;
  return {
    stage(name, { detail: text = null } = {}) {
      stage = name;
      detail = text;
      ctx.progress({ percent: tracker.begin(name), stage, speed: null, eta: null, detail });
    },
    advance(fraction, { speed = null, eta = null } = {}) {
      ctx.progress({ percent: tracker.percent(fraction), stage, speed, eta, detail });
    }
  };
}

function diskShortfall({ free, estimate, exact = false }) {
  if (!Number.isFinite(free)) return false;
  const need = Math.max(MIN_FREE_BYTES, estimate > 0 ? estimate * (exact ? 0.95 : 0.5) : 0);
  return free < need;
}

function isExactEstimate(preset) {
  const audioOnly = planner.isAudioOnlyOutput(preset);
  if (audioOnly) return preset.audio.codec === 'pcm' || preset.audio.mode === 'copy';
  if (preset.video.mode === 'copy') return preset.audio.mode !== 'encode' || preset.audio.codec !== 'flac';
  return preset.video.rateControl === 'bitrate';
}

function megabytes(bytes) {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

function secondsText(value) {
  return value === null || value === undefined ? 'unknown' : `${Number(value.toFixed(2))} s`;
}

async function removeFile(file) {
  if (!file) return;
  await fsp.rm(file, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}

async function removeDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !LOCK_CODES.has(error.code)) throw error;
      await sleep(100 * attempt);
    }
  }
}

async function ensureFolder(folder) {
  try {
    await fsp.mkdir(folder, { recursive: true });
  } catch (error) {
    if (DENIED_CODES.has(error.code)) throw JobError.from({ ...errorFor('access-denied'), detail: error.message });
    if (error.code === 'ENOSPC') throw JobError.from({ ...errorFor('disk-full'), detail: error.message });
    if (MISSING_FOLDER_CODES.has(error.code)) throw JobError.from({ ...errorFor('output-folder-missing'), detail: error.message });
    throw error;
  }
  const stat = await fsp.stat(folder).catch(() => null);
  if (!stat || !stat.isDirectory()) throw JobError.from({ ...errorFor('output-folder-missing'), detail: folder });
}

function toJobError(error) {
  if (isAbortError(error)) return error;
  if (error instanceof StepFailure) return JobError.from(error.mapped);
  if (error && error.code === 'path-too-long') return JobError.from(errorFor('path-too-long'));
  return error;
}

function shouldFallback(error, encoder) {
  if (!encoder || !encoders.isHardware(encoder) || !(error instanceof StepFailure)) return false;
  const { code } = error.mapped;
  if (code === 'encoder-failed') return true;
  if (isInputProblem(code) || isEnvironmentProblem(code)) return false;
  return !(error.outTime > EARLY_FAILURE_SECONDS);
}

function isInputSpecificFailure(lines) {
  return (lines || []).some((line) => INPUT_SPECIFIC_HARDWARE.test(line));
}

function createConvertRunner({ ffmpeg, ffprobe, tempDir, encoderProbe = null, getSettings = () => null, analyzer = null, probe = null, run = processes.run }) {
  const reservations = new Map();
  const running = new Set();
  const inspect = analyzer || createAnalyzer({ ffmpeg, run });
  const probeFile = probe || ((filePath, options) => probeMedia(filePath, { ffprobe, run, ...options }));

  function readSettings(ctx) {
    let value = null;
    try {
      value = typeof ctx.settings === 'function' ? ctx.settings() : null;
    } catch {
      value = null;
    }
    if (value) return value;
    try {
      return getSettings() || null;
    } catch {
      return null;
    }
  }

  function reservedExcept(jobId) {
    return [...reservations.entries()].filter(([id]) => id !== jobId).map(([, reserved]) => reserved);
  }

  function resolveTarget(jobId, spec, extension) {
    try {
      return names.outputPathFor({
        inputPath: spec.input.path,
        folder: spec.output.folder,
        baseName: spec.output.baseName,
        extension,
        collision: spec.output.collision,
        reserved: reservedExcept(jobId),
        replaceInput: spec.deleteInputAfter
      });
    } catch (error) {
      if (error && error.code === 'path-too-long') throw JobError.from(errorFor('path-too-long'));
      throw error;
    }
  }

  function nameOf(filePath, extension) {
    return path.win32.basename(filePath).slice(0, -(extension.length + 1));
  }

  async function runFfmpeg(args, { signal, hardware = false, onProgress = null, onStderrLine = null }) {
    const parser = createProgressParser();
    let lastTime = -1;
    let lastFrame = -1;
    let lastSize = -1;
    const handle = run(ffmpeg, args, {
      signal,
      tailLines: 64,
      onStdoutLine: (line) => {
        const snapshot = parser.push(line);
        if (!snapshot) return;
        const time = snapshot.outTimeSec ?? -1;
        const frame = snapshot.frame ?? -1;
        const size = snapshot.totalSize ?? -1;
        if (time <= lastTime && frame <= lastFrame && size <= lastSize) return;
        lastTime = Math.max(lastTime, time);
        lastFrame = Math.max(lastFrame, frame);
        lastSize = Math.max(lastSize, size);
        if (onProgress) onProgress(snapshot);
      },
      onStderrLine: onStderrLine || undefined
    });
    const result = await handle.result;
    if (result.code !== 0) {
      throw new StepFailure(mapFfmpegError(result.stderrLines, { exitCode: result.code, hardware }), parser.lastOutTime(), result.stderrLines);
    }
    return { outTime: parser.lastOutTime() };
  }

  function encodeProgress(report, total, extraPasses) {
    return (snapshot) => {
      const time = snapshot.outTimeSec;
      const fraction = total > 0 && time !== null ? time / total : null;
      const speed = snapshot.speed > 0 ? snapshot.speed : null;
      const eta = total > 0 && speed && time !== null ? (Math.max(0, total - time) + total * extraPasses) / speed : null;
      report.advance(fraction, { speed, eta });
    };
  }

  async function resolveEncoder(preset, media, settings, ctx, warnings) {
    if (!wantsVideoEncode(preset, media)) return null;
    const hardware = settings && settings.convert && settings.convert.hardware === 'software' ? 'software' : 'auto';
    const detect = encoderProbe && needsEncoderDetection(preset, media, hardware);
    if (detect && encoderProbe.get().status !== 'ready') {
      const off = encoderProbe.on('progress', () => ctx.progress({ stage: 'preparing' }));
      try {
        await raceAbort(encoderProbe.detect(), ctx.signal);
      } catch (error) {
        if (isAbortError(error) && ctx.signal.aborted) throw error;
      } finally {
        off();
      }
    }
    const choice = chooseEncoder({
      preset,
      media,
      state: detect ? encoderProbe.get() : null,
      usable: detect ? encoderProbe.usable() : null,
      hardware
    });
    warnings.push(...choice.warnings);
    return choice.name;
  }

  async function loadSource(spec, signal) {
    const stat = await statInput(spec.input.path);
    const stored = spec.input.media;
    if (isMedia(stored) && stat.size === spec.input.size && stat.mtimeMs === spec.input.mtimeMs) {
      return { ...stored, path: spec.input.path, mtimeMs: stat.mtimeMs };
    }
    const fresh = await probeFile(spec.input.path, { signal });
    return { ...fresh, path: spec.input.path };
  }

  async function checkDiskSpace(spec, media, encoder) {
    let estimate = null;
    try {
      estimate = planner.describe(spec.preset, media, { trim: spec.trim, encoder }).estimateBytes;
    } catch {
      estimate = null;
    }
    let free;
    try {
      const stats = await fsp.statfs(spec.output.folder);
      free = Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return;
    }
    if (!diskShortfall({ free, estimate, exact: isExactEstimate(spec.preset) })) return;
    const detail = estimate > 0 ? `About ${megabytes(estimate)} MB are needed and ${megabytes(free)} MB are free.` : `${megabytes(free)} MB are free.`;
    throw JobError.from({ ...errorFor('disk-full'), detail });
  }

  async function analyze(spec, media, report, signal, warnings) {
    report.stage('analyzing');
    try {
      return await inspect.analyze(spec.input.path, media, {
        signal,
        onProgress: ({ fraction, speed }) => report.advance(fraction, { speed: speed > 0 ? speed : null })
      });
    } catch (error) {
      if (isAbortError(error) && signal.aborted) throw error;
      warnings.push('analysis-failed');
      return null;
    }
  }

  async function measureLoudness(spec, media, streamIndex, total, report, signal) {
    report.stage('measuring-loudness');
    const args = planner.loudnessScanArgs({ media, preset: spec.preset, streamIndex, trim: spec.trim });
    if (!args) return null;
    const lines = [];
    await runFfmpeg(args, {
      signal,
      onProgress: (snapshot) => {
        const fraction = total > 0 && snapshot.outTimeSec !== null ? snapshot.outTimeSec / total : null;
        report.advance(fraction, { speed: snapshot.speed > 0 ? snapshot.speed : null });
      },
      onStderrLine: (line) => {
        if (LOUDNORM_START.test(line)) lines.length = 0;
        if ((lines.length > 0 || LOUDNORM_START.test(line)) && lines.length < MAX_LOUDNORM_LINES) lines.push(line);
      }
    });
    return planner.parseLoudnorm(lines);
  }

  async function encodeOnce(job, encoder) {
    const { spec, media, analysis, loudness, partial, jobTemp, report, signal } = job;
    const passLogFile = path.join(jobTemp, 'pass');
    const common = { media, preset: spec.preset, encoder, analysis, loudness, trim: spec.trim, outputPath: partial, passLogFile };
    const single = planner.buildPlan(common);
    if (single.errors.length) throw JobError.from(single.errors[0]);
    const video = single.summary.video;
    const used = video && video.mode === 'encode' ? video.encoder : null;
    const hardware = Boolean(used) && encoders.isHardware(used);
    const detail = used ? encoders.label(used) : null;
    const total = single.expectedDuration;
    const step = async (args, options) => {
      try {
        return await runFfmpeg(args, { signal, hardware, ...options });
      } catch (error) {
        if (error instanceof StepFailure) error.encoder = used;
        throw error;
      }
    };
    if (!single.twoPass) {
      report.stage('encoding', { detail });
      const done = await step(single.args, { onProgress: encodeProgress(report, total, 0) });
      return { plan: single, outTime: done.outTime };
    }
    await fsp.mkdir(jobTemp, { recursive: true });
    const first = planner.buildPlan({ ...common, pass: 1 });
    report.stage('encoding-pass-1', { detail });
    await step(first.args, { onProgress: encodeProgress(report, total, 1) });
    throwIfAborted(signal);
    const second = planner.buildPlan({ ...common, pass: 2 });
    report.stage('encoding', { detail });
    const done = await step(second.args, { onProgress: encodeProgress(report, total, 0) });
    return { plan: second, outTime: done.outTime };
  }

  async function encode(job) {
    try {
      return await encodeOnce(job, job.encoder);
    } catch (error) {
      const used = error instanceof StepFailure ? error.encoder : null;
      if (!shouldFallback(error, used)) throw error;
      throwIfAborted(job.signal);
      if (encoderProbe && !isInputSpecificFailure(error.lines)) encoderProbe.markBroken(used);
      job.warnings.push('hardware-fallback');
      await removeFile(job.partial);
      await removeDir(job.jobTemp);
      return encodeOnce(job, encoders.SOFTWARE[job.spec.preset.video.codec]);
    }
  }

  async function verify(job, encoded) {
    let output;
    try {
      output = await probeFile(job.partial, { signal: job.signal, cache: null });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw JobError.from({ ...errorFor('verify-failed'), detail: error && (error.detail || error.message) });
    }
    const { plan } = encoded;
    const check = checkOutput(output, {
      expectedDuration: plan.expectedDuration,
      expectVideo: plan.expect.video,
      expectAudio: plan.expect.audio,
      sourceDurationReliable: job.media.durationReliable,
      encodedDuration: encoded.outTime,
      durationSlack: plan.durationSlack
    });
    if (check.ok) return check;
    if (check.problems.length === 1 && check.problems[0] === 'duration-mismatch') {
      const detail = `Expected ${secondsText(plan.expectedDuration)}, got ${secondsText(check.duration)}.`;
      throw JobError.from({ ...errorFor('verify-duration'), detail });
    }
    throw JobError.from({ ...errorFor('verify-streams'), detail: check.problems.join(', ') });
  }

  async function finalize(jobId, spec, target, partial, extension, ctx) {
    throwIfAborted(ctx.signal);
    let finalPath = target.path;
    const replacing = spec.deleteInputAfter && names.samePath(spec.input.path, finalPath);
    if (!replacing && spec.output.collision !== 'overwrite' && (await exists(finalPath))) {
      if (spec.output.collision === 'skip') return { path: finalPath, skipped: true };
      finalPath = resolveTarget(jobId, spec, extension).path;
      reservations.set(jobId, finalPath);
      ctx.note({ output: { name: nameOf(finalPath, extension) } });
    }
    try {
      await renameWithRetry(partial, finalPath);
    } catch (error) {
      if (DENIED_CODES.has(error.code)) throw JobError.from({ ...errorFor('access-denied'), detail: error.message });
      if (error.code === 'ENOENT') throw JobError.from({ ...errorFor('verify-failed'), detail: error.message });
      throw error;
    }
    return { path: finalPath, skipped: false };
  }

  async function afterSuccess(spec, finalPath, warnings) {
    if (spec.output.keepDate) {
      try {
        const source = await fsp.stat(spec.input.path);
        await fsp.utimes(finalPath, new Date(), source.mtime);
      } catch {
        warnings.push('keep-date-failed');
      }
    }
    if (spec.deleteInputAfter && !names.samePath(spec.input.path, finalPath)) {
      try {
        await fsp.rm(spec.input.path, { maxRetries: 5, retryDelay: 200 });
      } catch {
        warnings.push('source-not-deleted');
      }
    }
    const stat = await fsp.stat(finalPath).catch(() => null);
    return stat ? stat.size : null;
  }

  async function skipped(filePath, warnings) {
    const stat = await fsp.stat(filePath).catch(() => null);
    return { path: filePath, size: stat ? stat.size : null, warnings: unique([...warnings, 'skipped-existing']), skipped: true, followUps: [] };
  }

  async function runJob(job, ctx) {
    const spec = readSpec(job);
    const signal = ctx.signal;
    const jobTemp = path.join(tempDir, 'convert', job.id);
    const warnings = [];
    let partial = null;
    running.add(job.id);
    try {
      ctx.progress({ percent: 0, stage: 'preparing', speed: null, eta: null, detail: null });
      const media = await loadSource(spec, signal);
      throwIfAborted(signal);
      const encoder = await resolveEncoder(spec.preset, media, readSettings(ctx), ctx, warnings);
      const base = planner.buildPlan({ media, preset: spec.preset, encoder, outputPath: 'output', trim: spec.trim });
      if (base.errors.length) throw JobError.from(base.errors[0]);
      await ensureFolder(spec.output.folder);
      throwIfAborted(signal);
      const extension = planner.outputExtension(spec.preset);
      const target = resolveTarget(job.id, spec, extension);
      ctx.note({ output: { name: nameOf(target.path, extension) } });
      if (target.skip) return await skipped(target.path, warnings);
      reservations.set(job.id, target.path);
      await checkDiskSpace(spec, media, encoder);
      const analyzeFirst = needsAnalysis(media, spec.preset);
      const scans = base.steps.filter((step) => step.type === 'loudness-scan');
      const report = createReporter(ctx, createTracker(planStages({ analyze: analyzeFirst, scans: scans.length, twoPass: base.twoPass })));
      const analysis = analyzeFirst ? await analyze(spec, media, report, signal, warnings) : null;
      const loudness = {};
      for (const step of scans) {
        throwIfAborted(signal);
        const measured = await measureLoudness(spec, media, step.streamIndex, base.expectedDuration, report, signal);
        if (measured) loudness[step.streamIndex] = measured;
      }
      throwIfAborted(signal);
      partial = names.partialPathFor(target.path);
      const work = { spec, media, analysis, loudness, partial, jobTemp, report, signal, encoder, warnings };
      const encoded = await encode(work);
      throwIfAborted(signal);
      report.stage('verifying');
      const check = await verify(work, encoded);
      warnings.push(...encoded.plan.warnings, ...check.warnings);
      report.stage('finishing');
      const finished = await finalize(job.id, spec, target, partial, extension, ctx);
      if (finished.skipped) {
        await removeFile(partial);
        partial = null;
        return await skipped(finished.path, warnings);
      }
      partial = null;
      const size = await afterSuccess(spec, finished.path, warnings);
      return { path: finished.path, size, warnings: unique(warnings), skipped: false, followUps: [] };
    } catch (error) {
      if (partial) await removeFile(partial);
      throw toJobError(error);
    } finally {
      reservations.delete(job.id);
      running.delete(job.id);
      await removeDir(jobTemp);
    }
  }

  function partialFor(job) {
    const spec = job && job.spec;
    if (!isObject(spec) || !isObject(spec.output) || !isAbsolutePath(spec.output.folder)) return null;
    const name = spec.output.name;
    if (typeof name !== 'string' || !name.trim() || /[\\/]/.test(name) || name === '.' || name === '..') return null;
    let extension;
    try {
      extension = planner.outputExtension(spec.preset);
    } catch {
      return null;
    }
    if (!extension) return null;
    return path.win32.join(spec.output.folder, `${name}.${extension}${names.PARTIAL_SUFFIX}`);
  }

  function reservedByOther(partial, jobId) {
    for (const [id, reserved] of reservations) {
      if (id !== jobId && names.samePath(names.partialPathFor(reserved), partial)) return true;
    }
    return false;
  }

  async function cleanup(job) {
    if (!isObject(job) || typeof job.id !== 'string' || !JOB_ID.test(job.id) || running.has(job.id)) return;
    const tasks = [removeDir(path.join(tempDir, 'convert', job.id))];
    const partial = partialFor(job);
    if (partial && !reservedByOther(partial, job.id)) tasks.push(removeFile(partial));
    await Promise.all(tasks);
  }

  return {
    run: runJob,
    cleanup,
    activeOutputs: () => [...reservations.values()],
    isRunning: (id) => running.has(id)
  };
}

module.exports = {
  createConvertRunner,
  chooseEncoder,
  needsAnalysis,
  needsEncoderDetection,
  planStages,
  createTracker,
  diskShortfall,
  isExactEstimate,
  shouldFallback,
  readSpec,
  StepFailure,
  STAGE_WEIGHTS
};
