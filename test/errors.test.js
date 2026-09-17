const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { JobError, toJobError, isAbortError, serializeError, KNOWN_ERRORS } = require('../src/main/errors');
const { run, ProcessError, abortError } = require('../src/main/processes');

test('JobError keeps the given fields', () => {
  const error = new JobError('private-video', {
    message: 'This video is private.',
    detail: 'ERROR: [youtube] abc: Private video',
    hint: 'Sign in with cookies.',
    retryable: false,
    action: 'cookies'
  });
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'JobError');
  assert.equal(error.code, 'private-video');
  assert.equal(error.message, 'This video is private.');
  assert.equal(error.detail, 'ERROR: [youtube] abc: Private video');
  assert.equal(error.hint, 'Sign in with cookies.');
  assert.equal(error.retryable, false);
  assert.equal(error.action, 'cookies');
});

test('JobError defaults: retryable, no action, known message and hint', () => {
  const error = new JobError('stalled');
  assert.equal(error.message, KNOWN_ERRORS.stalled.message);
  assert.equal(error.hint, KNOWN_ERRORS.stalled.hint);
  assert.equal(error.detail, null);
  assert.equal(error.retryable, true);
  assert.equal(error.action, null);
});

test('JobError with an explicit null hint does not fall back to the known hint', () => {
  assert.equal(new JobError('stalled', { hint: null }).hint, null);
});

test('JobError with an unknown code still has a readable message', () => {
  const error = new JobError('encoder-failed');
  assert.equal(error.code, 'encoder-failed');
  assert.equal(error.message, KNOWN_ERRORS.unexpected.message);
  assert.equal(error.hint, null);
});

test('JobError rejects invalid codes and unknown actions', () => {
  assert.equal(new JobError('Not A Code').code, 'unexpected');
  assert.equal(new JobError(42).code, 'unexpected');
  assert.equal(new JobError('x', { action: 'format-disk' }).action, null);
  for (const action of ['update-ytdlp', 'cookies', 'open-settings', 'retry-software']) {
    assert.equal(new JobError('x', { action }).action, action);
  }
});

test('JobError truncates long texts', () => {
  const error = new JobError('x', { message: 'm'.repeat(900), detail: 'd'.repeat(5000), hint: 'h'.repeat(900) });
  assert.equal(error.message.length, 500);
  assert.equal(error.detail.length, 2000);
  assert.equal(error.hint.length, 500);
});

test('JobError.from wraps a plain mapper result', () => {
  const mapped = { code: 'http-403', message: 'The site refused the download.', hint: 'Update yt-dlp.', action: 'update-ytdlp', retryable: true, detail: 'HTTP Error 403' };
  const error = JobError.from(mapped);
  assert.ok(error instanceof JobError);
  assert.deepEqual(error.toJSON(), mapped);
});

test('JobError serializes through JSON.stringify', () => {
  const error = new JobError('verify-duration', { message: 'Output is shorter than expected.', detail: '10.0 vs 12.5' });
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    code: 'verify-duration',
    message: 'Output is shorter than expected.',
    detail: '10.0 vs 12.5',
    hint: null,
    action: null,
    retryable: true
  });
});

test('toJobError returns JobError instances unchanged', () => {
  const error = new JobError('encoder-failed');
  assert.equal(toJobError(error), error);
});

test('toJobError keeps AbortError recognizable', () => {
  const error = abortError({ reason: 'pause' });
  const result = toJobError(error);
  assert.equal(result, error);
  assert.ok(isAbortError(result));
  const controller = new AbortController();
  controller.abort();
  assert.ok(isAbortError(controller.signal.reason));
  assert.equal(toJobError(controller.signal.reason), controller.signal.reason);
});

test('isAbortError is false for other values', () => {
  assert.equal(isAbortError(new Error('x')), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError('AbortError'), false);
});

test('toJobError maps a spawn failure to tool-missing', () => {
  const error = new ProcessError('spawn C:\\bin\\ffmpeg.exe ENOENT', { spawnFailed: true, errno: 'ENOENT' });
  const result = toJobError(error);
  assert.equal(result.code, 'tool-missing');
  assert.equal(result.message, KNOWN_ERRORS['tool-missing'].message);
  assert.equal(result.detail, 'spawn C:\\bin\\ffmpeg.exe ENOENT');
  assert.equal(result.retryable, true);
});

test('toJobError maps a real failed spawn from processes.run to tool-missing', async () => {
  const missing = path.join(os.tmpdir(), 'vidaro-missing-tool', 'missing-tool.exe');
  const handle = run(missing, ['--version']);
  const error = await handle.result.then(
    () => null,
    (reason) => reason
  );
  assert.ok(error);
  assert.equal(toJobError(error).code, 'tool-missing');
});

test('toJobError maps other process errors to unexpected', () => {
  const error = new ProcessError('boom', { spawnFailed: false });
  assert.equal(toJobError(error).code, 'unexpected');
  assert.equal(toJobError(error).detail, 'boom');
});

test('toJobError maps disk full and access errors', () => {
  const full = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  assert.equal(toJobError(full).code, 'disk-full');
  assert.equal(toJobError(full).detail, full.message);
  for (const code of ['EACCES', 'EPERM', 'EROFS', 'EBUSY']) {
    const error = Object.assign(new Error(`${code}: denied`), { code });
    assert.equal(toJobError(error).code, 'access-denied');
  }
});

test('toJobError does not treat Node error codes as mapped job codes', () => {
  const error = Object.assign(new Error('boom'), { code: 'ENOENT' });
  assert.equal(toJobError(error).code, 'unexpected');
  const lower = Object.assign(new Error('boom'), { code: 'bad-thing' });
  assert.equal(toJobError(lower).code, 'unexpected');
});

test('toJobError wraps plain mapper objects and duck-typed JobErrors', () => {
  const mapped = toJobError({ code: 'unavailable', message: 'Not available in your country.', retryable: false });
  assert.ok(mapped instanceof JobError);
  assert.equal(mapped.code, 'unavailable');
  assert.equal(mapped.retryable, false);
  const foreign = Object.assign(new Error('Encoder failed.'), { name: 'JobError', code: 'encoder-failed', action: 'retry-software' });
  const wrapped = toJobError(foreign);
  assert.equal(wrapped.code, 'encoder-failed');
  assert.equal(wrapped.action, 'retry-software');
});

test('toJobError accepts a mapper object without a message', () => {
  const mapped = toJobError({ code: 'stalled', detail: 'no bytes for 5 minutes' });
  assert.ok(mapped instanceof JobError);
  assert.equal(mapped.code, 'stalled');
  assert.equal(mapped.message, KNOWN_ERRORS.stalled.message);
  assert.equal(mapped.hint, KNOWN_ERRORS.stalled.hint);
  assert.equal(mapped.detail, 'no bytes for 5 minutes');
  const custom = toJobError({ code: 'private-video', hint: 'Use cookies.', action: 'cookies', retryable: false });
  assert.equal(custom.code, 'private-video');
  assert.equal(custom.message, KNOWN_ERRORS.unexpected.message);
  assert.equal(custom.action, 'cookies');
  assert.equal(custom.retryable, false);
});

test('toJobError keeps the message of plain objects without a code as detail', () => {
  const result = toJobError({ message: 'worker crashed' });
  assert.equal(result.code, 'unexpected');
  assert.equal(result.detail, 'worker crashed');
  assert.equal(toJobError([{ code: 'x' }]).code, 'unexpected');
  assert.equal(toJobError(Object.assign(new Error('bad'), { name: 'JobError', code: 'Bad Code' })).code, 'unexpected');
});

test('codes that match Object.prototype members never borrow their fields', () => {
  const error = new JobError('constructor');
  assert.equal(error.code, 'constructor');
  assert.equal(error.message, KNOWN_ERRORS.unexpected.message);
  assert.equal(error.hint, null);
  assert.equal(serializeError({ code: 'constructor' }).message, KNOWN_ERRORS.unexpected.message);
  assert.equal(new JobError('tostring').hint, null);
});

test('toJobError turns anything else into unexpected', () => {
  assert.equal(toJobError(new TypeError('x is undefined')).code, 'unexpected');
  assert.equal(toJobError(new TypeError('x is undefined')).detail, 'x is undefined');
  assert.equal(toJobError('text failure').detail, 'text failure');
  assert.equal(toJobError(undefined).code, 'unexpected');
  assert.equal(toJobError(null).detail, null);
  assert.equal(toJobError({ weird: true }).code, 'unexpected');
});

test('serializeError produces a plain, bounded object', () => {
  assert.equal(serializeError(null), null);
  assert.equal(serializeError('x'), null);
  const serialized = serializeError({ code: 'BAD CODE', message: '', detail: 5, hint: 'h', action: 'nope', retryable: 0 });
  assert.deepEqual(serialized, {
    code: 'unexpected',
    message: KNOWN_ERRORS.unexpected.message,
    detail: null,
    hint: 'h',
    action: null,
    retryable: true
  });
  assert.deepEqual(serializeError({ code: 'stalled', retryable: false }), {
    code: 'stalled',
    message: KNOWN_ERRORS.stalled.message,
    detail: null,
    hint: null,
    action: null,
    retryable: false
  });
});
