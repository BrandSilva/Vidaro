const v = require('../validate');
const { validatePreset } = require('../presets');

const MAX_FILES = 2000;
const MAX_PRESET_BYTES = 64 * 1024;
const MAX_MEDIA_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const COLLISIONS = ['rename', 'overwrite', 'skip'];

function exposed(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

function presetArg(value) {
  v.jsonSize(v.object(value, 'preset'), MAX_PRESET_BYTES, 'preset');
  const named = typeof value.name === 'string' && value.name.trim() ? value : { ...value, name: 'Custom' };
  try {
    return validatePreset(named, { allowBuiltInId: true });
  } catch (error) {
    if (error && error.name === 'PresetError') throw exposed(error.message);
    throw error;
  }
}

function mediaArg(value) {
  v.jsonSize(v.object(value, 'media'), MAX_MEDIA_BYTES, 'media');
  const valid =
    Array.isArray(value.audio) &&
    Array.isArray(value.subtitles) &&
    Array.isArray(value.warnings) &&
    typeof value.container === 'string' &&
    (value.video === null || (value.video !== undefined && typeof value.video === 'object' && Number.isInteger(value.video.index)));
  if (!valid) throw new v.ValidationError('media is not valid');
  return value;
}

function seconds(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e7) throw new v.ValidationError(`${name} is out of range`);
  return value;
}

function trimArg(value) {
  if (value === null || value === undefined) return null;
  v.object(value, 'trim');
  return { start: seconds(value.start, 'trim start'), end: seconds(value.end, 'trim end') };
}

function describeOptions(value) {
  if (value === null || value === undefined) return {};
  v.object(value, 'options');
  return { trim: trimArg(value.trim) };
}

function filesArg(value) {
  if (!Array.isArray(value) || value.length === 0) throw new v.ValidationError('files must be a list');
  if (value.length > MAX_FILES) throw new v.ValidationError('Too many files');
  return value.map((item) => {
    v.object(item, 'file');
    return { path: v.absolutePath(item.path), trim: trimArg(item.trim) };
  });
}

function outputArg(value) {
  v.object(value, 'output');
  const mode = v.oneOf(value.mode, ['source', 'folder'], 'output mode');
  const folder = mode === 'folder' ? v.absolutePath(value.folder, 'output folder') : null;
  const nameTemplate = value.nameTemplate === undefined || value.nameTemplate === null ? '{name}' : v.text(value.nameTemplate, { min: 1, max: 256, name: 'name template' });
  const collision = value.collision === undefined ? 'rename' : v.oneOf(value.collision, COLLISIONS, 'collision');
  return { mode, folder, nameTemplate, collision, keepDate: v.bool(value.keepDate) };
}

async function enqueue(ctx, request) {
  v.jsonSize(v.object(request, 'request'), MAX_REQUEST_BYTES, 'request');
  const files = filesArg(request.files);
  const preset = presetArg(request.preset);
  const output = outputArg(request.output);
  const start = v.bool(request.start);
  const probed = await ctx.converter.probe(files.map((file) => file.path));
  const errors = [];
  const ready = [];
  probed.forEach((item, index) => {
    if (item.error) errors.push({ path: files[index].path, ...item.error });
    else ready.push({ path: files[index].path, media: item.media, trim: files[index].trim });
  });
  if (ready.length === 0) return { ids: [], errors };
  let built;
  try {
    built = ctx.converter.buildJobs({ files: ready, preset, output });
  } catch (error) {
    if (error && error.expose) throw exposed(error.message);
    throw error;
  }
  errors.push(...built.errors);
  const ids = built.inputs.length ? ctx.queue.add(built.inputs, { start }) : [];
  return { ids, errors };
}

function registerConvert(ctx, handle) {
  handle('convert:probe', (paths) => ctx.converter.probe(v.pathList(paths, { max: MAX_FILES })));
  handle('convert:analyze', (filePath) => ctx.converter.analyze(v.absolutePath(filePath)));
  handle('convert:cancel-analyze', (filePath) => ctx.converter.cancelAnalyze(v.absolutePath(filePath)));
  handle('convert:thumbnail', (filePath) => ctx.converter.thumbnail(v.absolutePath(filePath)));
  handle('convert:describe', (preset, media, options) => ctx.converter.describe(presetArg(preset), mediaArg(media), describeOptions(options)));
  handle('convert:encoders', () => ctx.converter.encoders());
  handle('convert:detect-encoders', () => ctx.converter.detectEncoders());
  handle('convert:enqueue', (request) => enqueue(ctx, request));
}

function bridgeConvert(ctx) {
  return ctx.converter.onEncodersChanged((view) => ctx.send('encoders:changed', view));
}

module.exports = { registerConvert, bridgeConvert, enqueue };
