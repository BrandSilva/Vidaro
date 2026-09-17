const ERROR_ACTIONS = ['update-ytdlp', 'cookies', 'open-settings', 'retry-software'];

const KNOWN_ERRORS = {
  unexpected: {
    message: 'Something went wrong while processing this job.',
    hint: 'Try again. If it keeps failing, restart Vidaro.'
  },
  'tool-missing': {
    message: 'A required tool could not be started.',
    hint: 'Reinstall Vidaro and check that your antivirus did not block or quarantine it.'
  },
  stalled: {
    message: 'The job stopped making progress.',
    hint: 'Retry the job. If it stalls again, check the network connection or the source file.'
  },
  'disk-full': {
    message: 'There is not enough free space on the disk.',
    hint: 'Free some space on the target drive or choose another folder, then retry.'
  },
  'access-denied': {
    message: 'Vidaro could not write the file.',
    hint: 'Choose another output folder, or close any program that is using the file, then retry.'
  }
};

const CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const DISK_FULL_CODES = new Set(['ENOSPC', 'EDQUOT']);
const ACCESS_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'EBUSY']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function text(value, max) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function isCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

function knownError(code) {
  return Object.hasOwn(KNOWN_ERRORS, code) ? KNOWN_ERRORS[code] : null;
}

function describe(error) {
  if (typeof error === 'string') return text(error, 2000);
  if (isObject(error)) return text(error.message, 2000);
  return null;
}

class JobError extends Error {
  constructor(code, { message, detail, hint, retryable, action } = {}) {
    const safeCode = isCode(code) ? code : 'unexpected';
    const known = knownError(safeCode);
    super(text(message, 500) || known?.message || KNOWN_ERRORS.unexpected.message);
    this.name = 'JobError';
    this.code = safeCode;
    this.detail = text(detail, 2000);
    this.hint = hint === undefined ? known?.hint ?? null : text(hint, 500);
    this.retryable = retryable !== false;
    this.action = ERROR_ACTIONS.includes(action) ? action : null;
  }

  static from(mapped) {
    return new JobError(mapped?.code, isObject(mapped) ? mapped : {});
  }

  toJSON() {
    return serializeError(this);
  }
}

function isAbortError(error) {
  return isObject(error) && error.name === 'AbortError';
}

function isMappedError(error) {
  if (!isObject(error) || Array.isArray(error) || !isCode(error.code)) return false;
  return error instanceof Error ? error.name === 'JobError' : true;
}

function toJobError(error) {
  if (error instanceof JobError) return error;
  if (isAbortError(error)) return error;
  if (isObject(error) && error.name === 'ProcessError' && error.spawnFailed) {
    return new JobError('tool-missing', { detail: describe(error) });
  }
  if (isMappedError(error)) return JobError.from(error);
  if (isObject(error) && DISK_FULL_CODES.has(error.code)) return new JobError('disk-full', { detail: describe(error) });
  if (isObject(error) && ACCESS_CODES.has(error.code)) return new JobError('access-denied', { detail: describe(error) });
  return new JobError('unexpected', { detail: describe(error) });
}

function serializeError(value) {
  if (!isObject(value)) return null;
  const code = isCode(value.code) ? value.code : 'unexpected';
  return {
    code,
    message: text(value.message, 500) || knownError(code)?.message || KNOWN_ERRORS.unexpected.message,
    detail: text(value.detail, 2000),
    hint: text(value.hint, 500),
    action: ERROR_ACTIONS.includes(value.action) ? value.action : null,
    retryable: value.retryable !== false
  };
}

module.exports = { JobError, toJobError, isAbortError, serializeError, ERROR_ACTIONS, KNOWN_ERRORS };
