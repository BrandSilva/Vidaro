const fs = require('node:fs');
const path = require('node:path');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDefaults(defaults, value) {
  if (isPlainObject(defaults)) {
    if (!isPlainObject(value)) return structuredClone(defaults);
    if (Object.keys(defaults).length === 0) return structuredClone(value);
    const result = {};
    for (const key of Object.keys(defaults)) result[key] = mergeDefaults(defaults[key], value[key]);
    return result;
  }
  if (value === undefined) return structuredClone(defaults);
  if (defaults === null) return value;
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : structuredClone(defaults);
  return typeof value === typeof defaults ? value : defaults;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetrySync(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(attempt * 25);
    }
  }
}

function writeFileAtomicSync(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renameWithRetrySync(temp, file);
}

const LOCK_CODES = ['EPERM', 'EBUSY', 'EACCES'];

function readJson(file) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (error) {
      if (attempt >= 8 || !LOCK_CODES.includes(error.code)) throw error;
      sleepSync(attempt * 50);
    }
  }
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    return;
  }
}

class JsonStore {
  constructor({ file, defaults, normalize = (data) => data, debounceMs = 250 }) {
    this.file = file;
    this.defaults = defaults;
    this.normalize = normalize;
    this.debounceMs = debounceMs;
    this.data = null;
    this.dirty = false;
    this.timer = null;
    this.listeners = new Set();
    this.recovered = false;
    this.writeBlocked = false;
  }

  load() {
    let parsed;
    try {
      parsed = readJson(this.file);
    } catch (error) {
      parsed = this.recover(error);
    }
    this.data = this.normalize(mergeDefaults(this.defaults, parsed));
    if (this.dirty) this.schedule();
    return this.data;
  }

  recover(error) {
    if (LOCK_CODES.includes(error.code)) {
      this.writeBlocked = true;
      return undefined;
    }
    const temp = `${this.file}.tmp`;
    try {
      const parsed = readJson(temp);
      this.dirty = true;
      return parsed;
    } catch {
      removeQuietly(temp);
    }
    if (error.code !== 'ENOENT') {
      try {
        fs.copyFileSync(this.file, `${this.file}.bak`);
        this.recovered = true;
      } catch {
        this.recovered = false;
      }
    }
    return undefined;
  }

  get() {
    return this.data;
  }

  update(change) {
    const next = typeof change === 'function' ? change(this.data) : change;
    this.data = this.normalize(mergeDefaults(this.defaults, next));
    this.dirty = true;
    this.schedule();
    for (const listener of this.listeners) listener(this.data);
    return this.data;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || this.writeBlocked) return;
    this.dirty = false;
    try {
      writeFileAtomicSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
    } catch {
      this.dirty = true;
    }
  }

  dispose() {
    this.flush();
    this.listeners.clear();
  }
}

module.exports = { JsonStore, mergeDefaults, writeFileAtomicSync, isPlainObject };
