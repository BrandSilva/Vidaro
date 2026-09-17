const path = require('node:path');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(message) {
  throw new ValidationError(message);
}

function text(value, { max = 4096, min = 0, name = 'value' } = {}) {
  if (typeof value !== 'string') fail(`${name} must be text`);
  if (value.length < min || value.length > max) fail(`${name} has an invalid length`);
  return value;
}

function optionalText(value, options) {
  if (value === undefined || value === null) return null;
  return text(value, options);
}

function absolutePath(value, name = 'path') {
  text(value, { min: 3, max: 32767, name });
  if (value.includes('\0')) fail(`${name} is invalid`);
  if (!path.win32.isAbsolute(value) || !/^([a-zA-Z]:[\\/]|\\\\)/.test(value)) fail(`${name} must be an absolute path`);
  return path.win32.normalize(value);
}

function pathList(value, { max = 5000, name = 'paths' } = {}) {
  if (!Array.isArray(value)) fail(`${name} must be a list`);
  if (value.length > max) fail(`Too many ${name}`);
  return value.map((item) => absolutePath(item, name));
}

function webUrl(value, name = 'url') {
  text(value, { min: 4, max: 8192, name });
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail(`${name} is not a valid link`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail(`${name} must start with http or https`);
  return parsed.toString();
}

function idList(value, { max = 5000 } = {}) {
  if (!Array.isArray(value)) fail('ids must be a list');
  if (value.length > max) fail('Too many ids');
  return value.map((id) => text(id, { min: 1, max: 64, name: 'id' }));
}

function oneOf(value, allowed, name = 'value') {
  if (!allowed.includes(value)) fail(`${name} is not supported`);
  return value;
}

function bool(value) {
  return value === true;
}

function int(value, { min, max, name = 'value' }) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} is out of range`);
  return value;
}

function object(value, name = 'value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function jsonSize(value, max, name = 'value') {
  let size;
  try {
    size = JSON.stringify(value).length;
  } catch {
    fail(`${name} is not serializable`);
  }
  if (size > max) fail(`${name} is too large`);
  return value;
}

module.exports = {
  ValidationError,
  text,
  optionalText,
  absolutePath,
  pathList,
  webUrl,
  idList,
  oneOf,
  bool,
  int,
  object,
  jsonSize
};
