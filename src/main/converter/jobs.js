const path = require('node:path');
const { validatePreset } = require('../presets');
const { splitExt } = require('../fsnames');
const { buildPlan, normalizeTrim } = require('./plan');
const { renderOutputName, resolutionToken } = require('./names');
const { errorFor } = require('./errors');

const MAX_FILES = 2000;
const MAX_TEMPLATE = 256;
const COLLISIONS = ['rename', 'overwrite', 'skip'];
const MODES = ['source', 'folder'];
const ROOTED = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

class ConvertRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConvertRequestError';
    this.expose = true;
  }
}

class FileProblem extends Error {
  constructor(code, message, hint = null) {
    super(message);
    this.name = 'FileProblem';
    this.code = code;
    this.hint = hint;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsolutePath(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 32767 && !value.includes('\0') && ROOTED.test(value) && path.win32.isAbsolute(value);
}

function checkPreset(preset) {
  if (!isObject(preset)) throw new ConvertRequestError('Choose a preset.');
  try {
    return validatePreset(preset, { allowBuiltInId: true });
  } catch (error) {
    if (error && error.name === 'PresetError') throw new ConvertRequestError(error.message);
    throw error;
  }
}

function checkOutput(output) {
  if (!isObject(output)) throw new ConvertRequestError('Choose where to save the converted files.');
  const mode = output.mode === undefined ? 'folder' : output.mode;
  if (!MODES.includes(mode)) throw new ConvertRequestError('Choose where to save the converted files.');
  if (mode === 'folder' && !isAbsolutePath(output.folder)) throw new ConvertRequestError('Choose an output folder.');
  const template = output.nameTemplate === undefined || output.nameTemplate === null || output.nameTemplate === '' ? '{name}' : output.nameTemplate;
  if (typeof template !== 'string' || template.length > MAX_TEMPLATE || !template.trim()) throw new ConvertRequestError('The file name template is not valid.');
  const collision = output.collision === undefined ? 'rename' : output.collision;
  if (!COLLISIONS.includes(collision)) throw new ConvertRequestError('The file name conflict option is not valid.');
  return {
    mode,
    folder: mode === 'folder' ? path.win32.normalize(output.folder) : null,
    nameTemplate: template,
    collision,
    keepDate: output.keepDate === true
  };
}

function isMedia(media) {
  return (
    isObject(media) &&
    Array.isArray(media.audio) &&
    Array.isArray(media.subtitles) &&
    Array.isArray(media.warnings) &&
    typeof media.container === 'string' &&
    (media.video === null || (isObject(media.video) && Number.isInteger(media.video.index)))
  );
}

function timeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0) throw new FileProblem('trim-invalid', 'The trim times are not valid.', 'Check the start and end times.');
  return Math.round(number * 1000) / 1000;
}

function checkTrim(trim, media) {
  if (trim === null || trim === undefined) return null;
  if (!isObject(trim)) throw new FileProblem('trim-invalid', 'The trim times are not valid.', 'Check the start and end times.');
  const start = timeValue(trim.start);
  const end = timeValue(trim.end);
  const duration = media.durationReliable && media.duration > 0 ? media.duration : null;
  const result = normalizeTrim({ start: start ?? 0, end }, duration);
  if (result.error) throw new FileProblem('trim-invalid', 'The trim range is outside the file.', 'Check the start and end times.');
  if (!result.trim) return null;
  return { start: result.trim.start > 0 ? result.trim.start : null, end: result.trim.end };
}

function buildOne(file, preset, output, { now, deleteInputAfter }) {
  if (!isObject(file) || !isAbsolutePath(file.path)) throw new FileProblem('invalid-path', 'This file path is not valid.');
  const filePath = path.win32.normalize(file.path);
  if (!isMedia(file.media)) {
    const problem = errorFor('input-unreadable');
    throw new FileProblem(problem.code, problem.message, problem.hint);
  }
  const media = file.media;
  const trim = checkTrim(file.trim, media);
  const plan = buildPlan({ media, preset, outputPath: 'output', trim });
  if (plan.errors.length) {
    const [first] = plan.errors;
    throw new FileProblem(first.code, first.message, first.hint);
  }
  const video = plan.summary.video;
  const sourceName = splitExt(path.win32.basename(filePath)).base;
  const name = renderOutputName(output.nameTemplate, {
    name: sourceName,
    preset: preset.name,
    resolution: video ? resolutionToken(video.width, video.height) : '',
    date: now
  });
  return {
    kind: 'convert',
    title: path.win32.basename(filePath),
    spec: {
      input: {
        path: filePath,
        size: Number.isFinite(media.size) ? media.size : null,
        mtimeMs: Number.isFinite(media.mtimeMs) ? media.mtimeMs : null,
        duration: Number.isFinite(media.duration) ? media.duration : null,
        media: { ...media, path: filePath }
      },
      preset,
      output: {
        folder: output.mode === 'source' ? path.win32.dirname(filePath) : output.folder,
        name,
        baseName: name,
        collision: output.collision,
        keepDate: output.keepDate
      },
      trim,
      deleteInputAfter: deleteInputAfter === true
    }
  };
}

function buildConvertJobs({ files, preset, output, deleteInputAfter = false, now = Date.now() } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new ConvertRequestError('Add at least one file.');
  if (files.length > MAX_FILES) throw new ConvertRequestError(`Add at most ${MAX_FILES} files at a time.`);
  const cleanPreset = checkPreset(preset);
  const cleanOutput = checkOutput(output);
  const inputs = [];
  const errors = [];
  for (const file of files) {
    try {
      inputs.push(buildOne(file, cleanPreset, cleanOutput, { now, deleteInputAfter }));
    } catch (error) {
      if (!(error instanceof FileProblem)) throw error;
      errors.push({ path: isObject(file) && typeof file.path === 'string' ? file.path : null, code: error.code, message: error.message, hint: error.hint });
    }
  }
  return { inputs, errors };
}

module.exports = { buildConvertJobs, checkOutput, checkPreset, ConvertRequestError, MAX_FILES };
