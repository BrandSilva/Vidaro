const processes = require('../processes');
const { KNOWN_ERRORS } = require('../errors');
const { infoArgs } = require('./args');
const { summarizeInfo, parseInfoOutput, urlKind } = require('./info');
const { mapDownloadError } = require('./errors');

const CACHE_LIMIT = 20;
const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUTS = Object.freeze({ single: 2 * 60 * 1000, playlist: 5 * 60 * 1000 });
const PLAYLIST_KINDS = new Set(['playlist', 'channel']);

const TIMEOUT_ERROR = Object.freeze({
  code: 'network',
  message: 'The site took too long to answer.',
  hint: 'Check the internet connection and retry.',
  action: null,
  retryable: true,
  detail: null
});

function plainError(code, { message, hint = null, action = null, retryable = true, detail = null } = {}) {
  const known = KNOWN_ERRORS[code];
  return { code, message: message ?? known?.message ?? KNOWN_ERRORS.unexpected.message, hint: hint ?? known?.hint ?? null, action, retryable, detail };
}

function networkOptions(download = {}) {
  const mode = ['browser', 'file'].includes(download.cookiesMode) ? download.cookiesMode : 'none';
  const options = { cookiesMode: mode, proxy: typeof download.proxy === 'string' ? download.proxy.trim() : '' };
  if (mode === 'browser') options.cookiesBrowser = download.cookiesBrowser;
  if (mode === 'file') options.cookiesFile = download.cookiesFile;
  return options;
}

function createMetadataFetcher({
  ytdlp,
  jsRuntime = null,
  cacheDir = null,
  getSettings = () => ({}),
  run = processes.run,
  now = () => Date.now(),
  timeouts = {}
}) {
  const limits = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const cache = new Map();
  let current = null;
  let disposed = false;

  function readCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (now() - hit.at > CACHE_MS) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, hit);
    return structuredClone(hit.info);
  }

  function writeCache(key, info) {
    cache.delete(key);
    cache.set(key, { at: now(), info: structuredClone(info) });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  function cancel() {
    if (!current) return false;
    current.abort('canceled');
    current = null;
    return true;
  }

  function settingsSnapshot() {
    try {
      return getSettings()?.download ?? {};
    } catch {
      return {};
    }
  }

  async function execute(url, playlist, options, controller) {
    let file;
    try {
      file = await ytdlp.ensure({ signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { error: plainError('tool-missing', { retryable: false, detail: error?.message ?? null }) };
    }
    let args;
    try {
      args = infoArgs(url, { playlist, env: { jsRuntime, cacheDir }, options });
    } catch (error) {
      return {
        error: plainError('invalid-options', {
          message: error.message,
          hint: 'Check the cookies and proxy in Settings.',
          action: 'open-settings',
          retryable: false
        })
      };
    }
    const handle = run(file, args, { signal: controller.signal, captureStdout: true, env: ytdlp.childEnv(), tailLines: 80 });
    ytdlp.track(handle.result);
    const result = await handle.result;
    const json = result.overflow ? null : parseInfoOutput(result.stdout);
    if (!json) return { error: mapDownloadError(result.stderrLines, { exitCode: result.code }) };
    try {
      return { info: summarizeInfo(json, url) };
    } catch (error) {
      return { error: plainError('extractor-error', { message: "The site's page could not be read.", detail: error.message, action: 'update-ytdlp' }) };
    }
  }

  async function fetch(url, { playlist = false, network = null } = {}) {
    if (disposed) return { canceled: true };
    cancel();
    const controller = new AbortController();
    current = controller;
    const kind = urlKind(url);
    const wantPlaylist = playlist === true || PLAYLIST_KINDS.has(kind);
    const base = settingsSnapshot();
    const options = networkOptions(network && typeof network === 'object' ? { ...base, ...network } : base);
    const key = JSON.stringify([wantPlaylist, url, options]);
    const cached = readCache(key);
    if (cached) {
      if (current === controller) current = null;
      return { info: cached };
    }
    const timer = setTimeout(() => controller.abort('timeout'), wantPlaylist ? limits.playlist : limits.single);
    try {
      const outcome = await execute(url, wantPlaylist, options, controller);
      if (!outcome.info) return outcome;
      const info = outcome.info;
      info.playlistHint = !wantPlaylist && kind === 'mixed' && info.kind === 'video';
      writeCache(key, info);
      return { info };
    } catch (error) {
      if (controller.signal.aborted) {
        return controller.signal.reason === 'timeout' ? { error: { ...TIMEOUT_ERROR } } : { canceled: true };
      }
      if (error?.spawnFailed) {
        ytdlp.invalidate();
        return { error: plainError('tool-missing', { retryable: false, detail: error.message ?? null }) };
      }
      return { error: plainError('unexpected', { detail: error?.message ?? null }) };
    } finally {
      clearTimeout(timer);
      if (current === controller) current = null;
    }
  }

  function dispose() {
    disposed = true;
    cancel();
    cache.clear();
  }

  return { fetch, cancel, dispose };
}

module.exports = { createMetadataFetcher, networkOptions };
