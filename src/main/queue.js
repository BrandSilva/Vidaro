const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { JsonStore, isPlainObject } = require('./store');
const { JobError, toJobError, isAbortError, serializeError } = require('./errors');

const SCHEMA_VERSION = 1;
const JOB_KINDS = ['convert', 'download'];
const JOB_STATES = ['queued', 'running', 'paused', 'done', 'failed', 'canceled', 'interrupted'];
const FINISHED = new Set(['done', 'failed', 'canceled']);
const PENDING = new Set(['queued', 'paused', 'interrupted']);
const INTENT_RANK = { stall: 1, interrupt: 2, pause: 3, cancel: 4 };
const SHUTDOWN_INTENTS = { pause: 'pause', interrupt: 'interrupt', cancel: 'cancel' };
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE = 1024;
const MAX_PATH = 32767;
const MAX_LIMIT = 16;
const MAX_TIMER = 2147483647;
const DEFAULT_STALL_MS = 5 * 60 * 1000;
const EMPTY_PROGRESS = Object.freeze({ percent: null, stage: null, speed: null, eta: null, detail: null });

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function boundedText(value, max) {
  return typeof value === 'string' && value && value.length <= max ? value : null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(value) {
  const number = finite(value);
  return number === null || number < 0 ? null : number;
}

function percentOf(value) {
  const number = finite(value);
  return number === null ? null : Math.min(100, Math.max(0, number));
}

function optionalId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function emptyProgress() {
  return { ...EMPTY_PROGRESS };
}

function stoppedProgress(progress) {
  return { ...progress, stage: null, speed: null, eta: null };
}

const PROGRESS_FIELDS = {
  percent: percentOf,
  stage: (value) => text(value, 40),
  speed: nonNegative,
  eta: nonNegative,
  detail: (value) => text(value, 200)
};

function progressPatch(patch) {
  const clean = {};
  if (!isPlainObject(patch)) return clean;
  for (const [key, convert] of Object.entries(PROGRESS_FIELDS)) {
    if (!(key in patch)) continue;
    const value = patch[key] === null ? null : convert(patch[key]);
    if (value !== null || patch[key] === null) clean[key] = value;
  }
  return clean;
}

function sameProgress(a, b) {
  return Object.keys(EMPTY_PROGRESS).every((key) => a[key] === b[key]);
}

function normalizeProgress(value) {
  return { ...EMPTY_PROGRESS, ...progressPatch(value) };
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item)
    .slice(0, 32)
    .map((item) => item.slice(0, 64));
}

function normalizeResult(value) {
  if (!isPlainObject(value)) return null;
  return {
    path: boundedText(value.path, MAX_PATH),
    size: nonNegative(value.size),
    warnings: normalizeWarnings(value.warnings),
    skipped: value.skipped === true
  };
}

function normalizeError(raw) {
  if (isPlainObject(raw.error)) return serializeError(raw.error);
  return raw.state === 'failed' ? serializeError(new JobError('unexpected')) : null;
}

function normalizeJob(raw) {
  if (!isPlainObject(raw) || !optionalId(raw.id)) return null;
  if (!JOB_KINDS.includes(raw.kind) || !JOB_STATES.includes(raw.state)) return null;
  if (typeof raw.title !== 'string' || !isPlainObject(raw.spec)) return null;
  return {
    id: raw.id,
    kind: raw.kind,
    state: raw.state,
    title: raw.title.slice(0, MAX_TITLE),
    createdAt: finite(raw.createdAt) ?? 0,
    startedAt: finite(raw.startedAt),
    finishedAt: finite(raw.finishedAt),
    attempts: Number.isInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    neverStarted: raw.neverStarted === true,
    groupId: boundedText(raw.groupId, 128),
    groupTitle: text(raw.groupTitle, MAX_TITLE),
    parentId: optionalId(raw.parentId),
    spec: raw.spec,
    progress: normalizeProgress(raw.progress),
    result: normalizeResult(raw.result),
    error: normalizeError(raw)
  };
}

function normalizeQueueFile(data) {
  const seen = new Set();
  const jobs = [];
  for (const raw of Array.isArray(data?.jobs) ? data.jobs : []) {
    const job = normalizeJob(raw);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    jobs.push(job);
  }
  return { version: SCHEMA_VERSION, jobs };
}

function restoreJob(job, autoResume) {
  const restored = { ...job };
  const unfinished = job.state === 'running' || job.state === 'queued' || (autoResume && job.state === 'interrupted');
  if (unfinished) restored.state = autoResume ? 'queued' : 'interrupted';
  restored.progress = FINISHED.has(restored.state) ? stoppedProgress(job.progress) : emptyProgress();
  return restored;
}

function checkInput(input) {
  if (!isPlainObject(input)) throw new TypeError('Job input must be an object');
  if (!JOB_KINDS.includes(input.kind)) throw new TypeError('Unknown job kind');
  if (typeof input.title !== 'string') throw new TypeError('Job title must be a string');
  if (!isPlainObject(input.spec)) throw new TypeError('Job spec must be an object');
  for (const key of ['groupId', 'groupTitle', 'parentId']) {
    if (input[key] !== undefined && input[key] !== null && typeof input[key] !== 'string') {
      throw new TypeError(`Job ${key} must be a string`);
    }
  }
}

function cloneJob(job) {
  return structuredClone(job);
}

function pickStrings(value, limits) {
  if (!isPlainObject(value)) return null;
  const picked = {};
  for (const [key, max] of Object.entries(limits)) {
    const item = boundedText(value[key], max);
    if (item) picked[key] = item;
  }
  return Object.keys(picked).length ? picked : null;
}

function infoPatch(value) {
  if (!isPlainObject(value)) return null;
  const picked = pickStrings(value, { title: MAX_TITLE, channel: 512 }) ?? {};
  const duration = nonNegative(value.duration);
  if (duration !== null) picked.duration = duration;
  const thumbnail = boundedText(value.thumbnail, 4096);
  if (thumbnail && thumbnail.startsWith('https://')) picked.thumbnail = thumbnail;
  return Object.keys(picked).length ? picked : null;
}

function differs(current, patch) {
  return Object.entries(patch).some(([key, value]) => current[key] !== value);
}

function within(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class Queue extends EventEmitter {
  constructor({
    file,
    runners = {},
    limits = () => ({}),
    stallMs = () => DEFAULT_STALL_MS,
    ready = Promise.resolve(),
    autoResume = () => false,
    settings = () => null,
    now = () => Date.now(),
    abortGraceMs = 15000,
    shutdownTimeoutMs = 10000,
    progressMs = 200,
    maxFinished = 500,
    debounceMs = 300
  }) {
    super();
    this.runners = runners;
    this.limitsSource = limits;
    this.stallSource = stallMs;
    this.autoResumeSource = autoResume;
    this.settingsSource = settings;
    this.now = now;
    this.abortGraceMs = abortGraceMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.progressMs = progressMs;
    this.maxFinished = maxFinished;
    this.store = new JsonStore({
      file,
      defaults: { version: SCHEMA_VERSION, jobs: [] },
      normalize: normalizeQueueFile,
      debounceMs
    });
    this.jobs = [];
    this.byId = new Map();
    this.active = new Map();
    this.cleanups = new Set();
    this.pendingProgress = new Set();
    this.progressTimer = null;
    this.sequence = 0;
    this.loaded = false;
    this.isReady = false;
    this.closing = false;
    this.disposed = false;
    this.dirty = false;
    this.scheduleWanted = false;
    this.tickQueued = false;
    this.busy = false;
    this.period = new Set();
    this.periodWorked = false;
    this.shutdownPromise = null;
    Promise.resolve(ready).then(
      () => this.markReady(),
      () => this.markReady()
    );
  }

  get recovered() {
    return this.store.recovered;
  }

  load() {
    if (this.loaded || this.disposed) return this.list();
    let stored;
    try {
      stored = this.store.load();
    } catch {
      return this.list();
    }
    this.loaded = true;
    const autoResume = this.readAutoResume();
    const restored = stored.jobs.map((job) => restoreJob(job, autoResume));
    const restoredIds = new Set(restored.map((job) => job.id));
    this.setJobs([...restored, ...this.jobs.filter((job) => !restoredIds.has(job.id))]);
    this.prune();
    this.touch();
    return this.list();
  }

  list() {
    return this.jobs.map(cloneJob);
  }

  get(id) {
    const job = this.byId.get(id);
    return job ? cloneJob(job) : null;
  }

  add(inputs, { start = true } = {}) {
    if (this.closing || this.disposed) throw new Error('The queue is closed');
    const list = Array.isArray(inputs) ? inputs : [inputs];
    for (const input of list) this.checkRunnable(input);
    const jobs = list.map((input) => this.createJob(input, start ? 'queued' : 'paused'));
    if (!jobs.length) return [];
    this.setJobs([...this.jobs, ...jobs]);
    this.touch();
    return jobs.map((job) => job.id);
  }

  pause(ids) {
    return this.changeEach(ids, (job) => {
      if (job.state === 'running') {
        const entry = this.active.get(job.id);
        if (!entry) return false;
        entry.resumeAfter = false;
        return this.requestAbort(entry, 'pause', 'pause');
      }
      if (job.state !== 'queued' && job.state !== 'interrupted') return false;
      job.state = 'paused';
      return true;
    });
  }

  resume(ids) {
    if (this.closing) return [];
    return this.changeEach(ids, (job) => {
      if (job.state === 'running') {
        const entry = this.active.get(job.id);
        if (!entry || entry.intent !== 'pause') return false;
        entry.resumeAfter = true;
        return true;
      }
      if (job.state !== 'paused' && job.state !== 'interrupted') return false;
      job.state = 'queued';
      job.neverStarted = false;
      return true;
    });
  }

  cancel(ids) {
    return this.changeEach(ids, (job) => {
      if (job.state === 'running') return this.abortJob(job, 'cancel', 'cancel');
      if (!PENDING.has(job.state)) return false;
      this.cancelPending(job);
      return true;
    });
  }

  retry(ids) {
    if (this.closing) return [];
    return this.changeEach(ids, (job) => {
      if (job.state !== 'failed' && job.state !== 'canceled' && job.state !== 'interrupted') return false;
      job.state = 'queued';
      job.error = null;
      job.result = null;
      job.finishedAt = null;
      job.neverStarted = false;
      job.progress = emptyProgress();
      return true;
    });
  }

  remove(ids) {
    const removed = new Set();
    for (const job of this.pick(ids)) {
      const entry = job.state === 'running' ? this.active.get(job.id) : null;
      if (entry) {
        entry.removed = true;
        entry.latest = cloneJob(job);
        this.requestAbort(entry, 'cancel', 'cancel');
      } else if (PENDING.has(job.state) || job.state === 'failed') {
        this.cleanup(job);
      }
      removed.add(job.id);
    }
    if (removed.size) {
      this.setJobs(this.jobs.filter((job) => !removed.has(job.id)));
      this.touch();
    }
    return [...removed];
  }

  reorder(ids, beforeId = null) {
    const moving = new Set(this.pick(ids).filter((job) => PENDING.has(job.state)).map((job) => job.id));
    if (!moving.size) return false;
    if (beforeId !== null && (!this.byId.has(beforeId) || moving.has(beforeId))) return false;
    const moved = this.jobs.filter((job) => moving.has(job.id));
    const rest = this.jobs.filter((job) => !moving.has(job.id));
    const index = beforeId === null ? rest.length : rest.findIndex((job) => job.id === beforeId);
    rest.splice(index, 0, ...moved);
    if (rest.every((job, position) => job === this.jobs[position])) return false;
    this.setJobs(rest);
    this.touch();
    return true;
  }

  clearFinished() {
    if (this.disposed) return [];
    const removed = this.jobs.filter((job) => job.state === 'done' || job.state === 'canceled').map((job) => job.id);
    if (!removed.length) return [];
    const ids = new Set(removed);
    this.setJobs(this.jobs.filter((job) => !ids.has(job.id)));
    this.touch();
    return removed;
  }

  pauseAll() {
    return this.pause(this.idsWhere((job) => job.state === 'running' || job.state === 'queued'));
  }

  startAll() {
    return this.resume(this.idsWhere((job) => job.state === 'paused' || job.state === 'interrupted'));
  }

  reschedule() {
    if (this.disposed) return;
    this.scheduleWanted = true;
    this.requestTick();
  }

  counts() {
    const counts = { running: 0, queued: 0, paused: 0, interrupted: 0, done: 0, failed: 0, canceled: 0, active: 0 };
    for (const job of this.jobs) counts[job.state] += 1;
    counts.active = counts.running + counts.queued;
    return counts;
  }

  activeSummary() {
    let downloads = 0;
    let conversions = 0;
    let speedBytes = 0;
    let percentTotal = 0;
    let percentCount = 0;
    for (const job of this.jobs) {
      if (job.state !== 'running') continue;
      if (job.kind === 'download') {
        downloads += 1;
        speedBytes += job.progress.speed ?? 0;
      } else {
        conversions += 1;
      }
      if (job.progress.percent !== null) {
        percentTotal += job.progress.percent;
        percentCount += 1;
      }
    }
    return { downloads, conversions, speedBytes, percent: percentCount ? percentTotal / percentCount : null };
  }

  shutdown(mode = 'pause') {
    if (this.disposed) return Promise.resolve();
    if (!this.shutdownPromise) {
      this.closing = true;
      this.shutdownPromise = this.runShutdown(SHUTDOWN_INTENTS[mode] ?? 'pause');
    }
    return this.shutdownPromise;
  }

  dispose() {
    if (this.disposed) return;
    this.closing = true;
    this.removeAllListeners();
    clearTimeout(this.progressTimer);
    this.progressTimer = null;
    this.pendingProgress.clear();
    for (const entry of [...this.active.values()]) {
      this.stopForShutdown(entry, 'interrupt', 'shutdown');
      this.settle(entry, { ok: false, forced: true });
    }
    this.commit();
    this.disposed = true;
    this.store.dispose();
  }

  async runShutdown(intent) {
    const reason = intent === 'cancel' ? 'cancel' : 'shutdown';
    for (const job of this.jobs) {
      if (job.state !== 'queued') continue;
      if (intent === 'cancel') this.cancelPending(job);
      else job.state = intent === 'pause' ? 'paused' : 'interrupted';
    }
    for (const entry of [...this.active.values()]) this.stopForShutdown(entry, intent, reason);
    this.touch();
    const startedAt = Date.now();
    await within(Promise.all([...this.active.values()].map((entry) => entry.done)), this.shutdownTimeoutMs);
    for (const entry of [...this.active.values()]) this.settle(entry, { ok: false, forced: true });
    await within(Promise.all([...this.cleanups]), this.shutdownTimeoutMs - (Date.now() - startedAt));
    if (this.disposed) return;
    try {
      this.commit();
    } finally {
      this.store.flush();
    }
  }

  stopForShutdown(entry, intent, reason) {
    if (entry.resumeAfter && entry.intent === 'pause') entry.intent = intent;
    entry.resumeAfter = false;
    this.requestAbort(entry, intent, reason);
  }

  markReady() {
    if (this.disposed) return;
    this.isReady = true;
    this.reschedule();
  }

  changeEach(ids, change) {
    const changed = [];
    for (const job of this.pick(ids)) {
      if (change(job)) changed.push(job.id);
    }
    if (changed.length) this.touch();
    return changed;
  }

  pick(ids) {
    if (this.disposed) return [];
    const seen = new Set();
    const jobs = [];
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      const job = this.byId.get(id);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  idsWhere(predicate) {
    return this.jobs.filter(predicate).map((job) => job.id);
  }

  setJobs(jobs) {
    this.jobs = jobs;
    this.byId = new Map(jobs.map((job) => [job.id, job]));
  }

  checkRunnable(input) {
    checkInput(input);
    if (!this.runners[input.kind]) throw new TypeError(`No runner for ${input.kind} jobs`);
  }

  newId() {
    let id;
    do {
      this.sequence += 1;
      const time = Math.max(0, Math.floor(finite(this.now()) ?? Date.now())).toString(36);
      id = `j${time}${this.sequence.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    } while (this.byId.has(id));
    return id;
  }

  createJob(input, state) {
    return {
      id: this.newId(),
      kind: input.kind,
      state,
      title: input.title.slice(0, MAX_TITLE),
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      neverStarted: state === 'paused',
      groupId: boundedText(input.groupId, 128),
      groupTitle: text(input.groupTitle, MAX_TITLE),
      parentId: optionalId(input.parentId),
      spec: JSON.parse(JSON.stringify(input.spec)),
      progress: emptyProgress(),
      result: null,
      error: null
    };
  }

  cancelPending(job) {
    job.state = 'canceled';
    job.finishedAt = this.now();
    job.progress = stoppedProgress(job.progress);
    this.cleanup(job);
  }

  abortJob(job, intent, reason) {
    const entry = this.active.get(job.id);
    return entry ? this.requestAbort(entry, intent, reason) : false;
  }

  touch() {
    this.dirty = true;
    this.scheduleWanted = true;
    this.requestTick();
  }

  requestTick() {
    if (this.tickQueued || this.disposed) return;
    this.tickQueued = true;
    queueMicrotask(() => this.tick());
  }

  tick() {
    this.tickQueued = false;
    if (this.disposed) return;
    if (this.scheduleWanted) {
      this.scheduleWanted = false;
      this.schedulePass();
    }
    if (this.dirty) this.commit();
  }

  commit() {
    this.dirty = false;
    this.prune();
    if (this.loaded) this.store.update(this.persisted());
    const wasBusy = this.busy;
    this.busy = this.active.size > 0 || this.jobs.some((job) => job.state === 'queued');
    if (this.busy) this.trackPeriod();
    const drained = wasBusy && !this.busy && this.endPeriod();
    try {
      this.emit('changed');
    } finally {
      if (drained) this.emit('idle', this.counts());
    }
  }

  trackPeriod() {
    for (const job of this.jobs) {
      if (job.state === 'running' || job.state === 'queued') this.period.add(job.id);
    }
  }

  endPeriod() {
    const tracked = [...this.period];
    const worked = this.periodWorked;
    this.period.clear();
    this.periodWorked = false;
    if (this.closing || !worked) return false;
    return tracked.every((id) => {
      const job = this.byId.get(id);
      return job === undefined || FINISHED.has(job.state);
    });
  }

  persisted() {
    return {
      version: SCHEMA_VERSION,
      jobs: this.jobs.map((job) => ({ ...job, progress: { ...job.progress, speed: null, eta: null } }))
    };
  }

  prune() {
    const finished = this.jobs.filter((job) => FINISHED.has(job.state));
    const excess = finished.length - this.maxFinished;
    if (excess <= 0) return;
    const position = new Map(this.jobs.map((job, index) => [job, index]));
    finished.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0) || position.get(a) - position.get(b));
    const dropped = new Set(finished.slice(0, excess));
    for (const job of dropped) {
      if (job.state === 'failed') this.cleanup(job);
    }
    this.setJobs(this.jobs.filter((job) => !dropped.has(job)));
  }

  schedulePass() {
    if (!this.isReady || this.closing || this.disposed) return;
    const limits = this.readLimits();
    const running = Object.fromEntries(JOB_KINDS.map((kind) => [kind, 0]));
    for (const entry of this.active.values()) running[entry.kind] += 1;
    const jobs = this.jobs;
    for (const job of jobs) {
      if (JOB_KINDS.every((kind) => running[kind] >= limits[kind])) break;
      if (job.state !== 'queued' || running[job.kind] >= limits[job.kind]) continue;
      if (this.byId.get(job.id) !== job || this.closing) continue;
      running[job.kind] += 1;
      this.start(job);
    }
  }

  start(job) {
    job.state = 'running';
    job.attempts += 1;
    job.startedAt = this.now();
    job.finishedAt = null;
    job.neverStarted = false;
    job.result = null;
    job.error = null;
    job.progress = emptyProgress();
    const entry = {
      id: job.id,
      kind: job.kind,
      controller: new AbortController(),
      intent: null,
      signalReason: null,
      settled: false,
      removed: false,
      resumeAfter: false,
      latest: null,
      graceTimer: null,
      stallTimer: null,
      done: null,
      resolveDone: null
    };
    entry.done = new Promise((resolve) => {
      entry.resolveDone = resolve;
    });
    this.active.set(job.id, entry);
    this.armStall(entry);
    this.touch();
    const ctx = {
      signal: entry.controller.signal,
      progress: (patch) => this.applyProgress(entry, patch),
      note: (patch) => this.applyNote(entry, patch),
      settings: () => this.readSettings()
    };
    let pending;
    try {
      const runner = this.runners[job.kind];
      pending = runner
        ? Promise.resolve(runner.run(cloneJob(job), ctx))
        : Promise.reject(new JobError('unexpected', { detail: `No runner for ${job.kind} jobs` }));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (value) => this.settle(entry, { ok: true, value }),
      (error) => this.settle(entry, { ok: false, error })
    );
  }

  armStall(entry) {
    clearTimeout(entry.stallTimer);
    entry.stallTimer = setTimeout(() => this.requestAbort(entry, 'stall', 'stall'), this.readStallMs());
  }

  requestAbort(entry, intent, reason) {
    if (entry.settled) return false;
    if (!entry.intent || INTENT_RANK[intent] > INTENT_RANK[entry.intent]) entry.intent = intent;
    if (entry.controller.signal.aborted) return true;
    entry.signalReason = reason;
    clearTimeout(entry.stallTimer);
    entry.graceTimer = setTimeout(() => this.settle(entry, { ok: false, forced: true }), this.abortGraceMs);
    entry.controller.abort(reason);
    const job = this.byId.get(entry.id);
    if (job && !entry.removed && !entry.settled && job.state === 'running') {
      job.progress = { ...job.progress, stage: 'stopping', speed: null, eta: null };
      this.pendingProgress.delete(job.id);
      this.emitProgress(job.id);
    }
    return true;
  }

  settle(entry, outcome) {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.graceTimer);
    clearTimeout(entry.stallTimer);
    if (this.active.get(entry.id) === entry) this.active.delete(entry.id);
    this.pendingProgress.delete(entry.id);
    entry.resolveDone();
    const job = entry.removed ? null : this.byId.get(entry.id);
    if (!job) {
      if (entry.removed) this.cleanup(entry.latest);
      this.touch();
      return;
    }
    if (outcome.ok) this.complete(job, outcome.value, entry);
    else if (entry.intent) this.applyIntent(job, entry);
    else this.fail(job, outcome.error);
    if (job.state === 'canceled' && (outcome.forced || entry.signalReason !== 'cancel')) this.cleanup(job);
    if (job.state === 'done' || job.state === 'failed') this.periodWorked = true;
    this.touch();
    if (FINISHED.has(job.state) && !this.closing) this.emit('job-finished', cloneJob(job));
  }

  complete(job, value, entry) {
    job.state = 'done';
    job.result = normalizeResult(value) ?? { path: null, size: null, warnings: [], skipped: false };
    job.error = null;
    job.finishedAt = this.now();
    job.progress = { ...EMPTY_PROGRESS, percent: 100 };
    const followUps = isPlainObject(value) && Array.isArray(value.followUps) ? value.followUps : [];
    this.insertFollowUps(job, followUps, entry.intent ? 'paused' : 'queued');
  }

  insertFollowUps(parent, inputs, state) {
    const created = [];
    for (const input of inputs) {
      if (!isPlainObject(input)) continue;
      const merged = {
        ...input,
        groupId: input.groupId ?? parent.groupId,
        groupTitle: input.groupTitle ?? parent.groupTitle,
        parentId: parent.id
      };
      try {
        this.checkRunnable(merged);
        created.push(this.createJob(merged, state));
      } catch {
        continue;
      }
    }
    if (!created.length) return;
    const next = this.jobs.slice();
    next.splice(next.indexOf(parent) + 1, 0, ...created);
    this.setJobs(next);
  }

  applyIntent(job, entry) {
    job.progress = stoppedProgress(job.progress);
    if (entry.intent === 'pause') {
      job.state = entry.resumeAfter ? 'queued' : 'paused';
    } else if (entry.intent === 'interrupt') {
      job.state = 'interrupted';
    } else if (entry.intent === 'cancel') {
      job.state = 'canceled';
      job.finishedAt = this.now();
    } else {
      job.state = 'failed';
      job.error = serializeError(new JobError('stalled'));
      job.finishedAt = this.now();
    }
  }

  fail(job, error) {
    const jobError = isAbortError(error)
      ? new JobError('unexpected', { detail: 'The job was aborted unexpectedly.' })
      : toJobError(error);
    job.state = 'failed';
    job.error = serializeError(jobError);
    job.result = null;
    job.finishedAt = this.now();
    job.progress = stoppedProgress(job.progress);
  }

  applyProgress(entry, patch) {
    if (entry.settled || entry.intent) return;
    const job = this.byId.get(entry.id);
    if (!job) return;
    this.armStall(entry);
    const next = { ...job.progress, ...progressPatch(patch) };
    if (sameProgress(next, job.progress)) return;
    job.progress = next;
    this.queueProgress(job.id);
  }

  queueProgress(id) {
    if (this.progressMs <= 0) {
      this.emitProgress(id);
      return;
    }
    this.pendingProgress.add(id);
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => this.flushProgress(), this.progressMs);
  }

  flushProgress() {
    this.progressTimer = null;
    const ids = [...this.pendingProgress];
    this.pendingProgress.clear();
    for (const id of ids) this.emitProgress(id);
  }

  emitProgress(id) {
    const job = this.byId.get(id);
    if (!job || job.state !== 'running') return;
    this.emit('progress', id, { ...job.progress });
  }

  applyNote(entry, patch) {
    if (entry.settled || entry.removed || !isPlainObject(patch)) return;
    const job = this.byId.get(entry.id);
    if (!job) return;
    let changed = false;
    const title = typeof patch.title === 'string' ? patch.title.trim().slice(0, MAX_TITLE) : '';
    if (title && title !== job.title) {
      job.title = title;
      changed = true;
    }
    for (const [key, picked] of [
      ['output', pickStrings(patch.output, { name: 255, folder: MAX_PATH })],
      ['info', job.kind === 'download' ? infoPatch(patch.info) : null]
    ]) {
      const current = isPlainObject(job.spec[key]) ? job.spec[key] : {};
      if (!picked || !differs(current, picked)) continue;
      job.spec = { ...job.spec, [key]: { ...current, ...picked } };
      changed = true;
    }
    if (changed) this.touch();
  }

  cleanup(job) {
    const runner = job ? this.runners[job.kind] : null;
    if (!runner || typeof runner.cleanup !== 'function') return;
    const snapshot = cloneJob(job);
    const task = Promise.resolve()
      .then(() => runner.cleanup(snapshot))
      .catch(() => undefined)
      .finally(() => this.cleanups.delete(task));
    this.cleanups.add(task);
  }

  readLimits() {
    let value = null;
    try {
      value = this.limitsSource();
    } catch {
      value = null;
    }
    const limits = {};
    for (const kind of JOB_KINDS) {
      const number = Math.floor(Number(value?.[kind]));
      limits[kind] = Number.isFinite(number) && number >= 1 ? Math.min(number, MAX_LIMIT) : 1;
    }
    return limits;
  }

  readStallMs() {
    let value = NaN;
    try {
      value = Number(this.stallSource());
    } catch {
      value = NaN;
    }
    return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_TIMER) : DEFAULT_STALL_MS;
  }

  readAutoResume() {
    try {
      return this.autoResumeSource() === true;
    } catch {
      return false;
    }
  }

  readSettings() {
    try {
      return this.settingsSource();
    } catch {
      return null;
    }
  }
}

module.exports = { Queue, normalizeQueueFile, SCHEMA_VERSION, JOB_KINDS, JOB_STATES };
