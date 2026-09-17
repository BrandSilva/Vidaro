const v = require('../validate');
const { exposed } = require('../ipc');

const MAX_REQUEST_CHARS = 8 * 1024 * 1024;

function asExposed(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw exposed(error.message);
    throw error;
  }
}

function resolveAfter(ctx, after) {
  if (after === undefined || after === null) return null;
  const request = v.object(after, 'after');
  const preset = ctx.presets.get(v.text(request.presetId, { min: 1, max: 64, name: 'preset' }));
  if (!preset) throw exposed('The chosen preset no longer exists.');
  return { preset, keepOriginal: request.keepOriginal !== false };
}

const COOKIE_MODES = ['none', 'browser', 'file'];

function networkArg(value) {
  if (value === undefined || value === null) return null;
  const request = v.object(value, 'network');
  const network = {};
  if (request.cookiesMode !== undefined) network.cookiesMode = v.oneOf(request.cookiesMode, COOKIE_MODES, 'cookies mode');
  if (request.cookiesBrowser !== undefined) network.cookiesBrowser = v.text(request.cookiesBrowser, { min: 1, max: 32, name: 'browser' });
  if (request.cookiesFile !== undefined && request.cookiesFile !== '') network.cookiesFile = v.absolutePath(request.cookiesFile, 'cookies file');
  if (request.proxy !== undefined) network.proxy = v.text(request.proxy, { max: 512, name: 'proxy' });
  return network;
}

function registerDownload(ctx, handle) {
  handle('download:fetch-info', (url, options) => {
    const link = v.webUrl(url);
    const request = options === undefined || options === null ? {} : v.object(options, 'options');
    return ctx.downloader.fetchInfo(link, { playlist: v.bool(request.playlist), network: networkArg(request.network) });
  });

  handle('download:cancel-fetch', () => ctx.downloader.cancelFetch());

  handle('download:suggest-name', (request) => {
    const clean = v.jsonSize(v.object(request, 'request'), MAX_REQUEST_CHARS, 'request');
    return asExposed(() => ctx.downloader.suggestName(clean));
  });

  handle('download:enqueue', (request) => {
    const clean = v.jsonSize(v.object(request, 'request'), MAX_REQUEST_CHARS, 'request');
    const after = resolveAfter(ctx, clean.after);
    const inputs = asExposed(() =>
      ctx.downloader.buildJobs({
        items: clean.items,
        options: clean.options,
        output: clean.output,
        after,
        group: clean.group ?? null
      })
    );
    const ids = ctx.queue.add(inputs, { start: clean.start !== false });
    return { ids };
  });

  handle('ytdlp:status', () => ctx.downloader.ytdlp.inspect());
  handle('ytdlp:update', async () => {
    const result = await ctx.downloader.ytdlp.update({ manual: true });
    return {
      outcome: result.deferred ? 'deferred' : result.status ?? 'failed',
      error: result.error ?? null,
      status: ctx.downloader.ytdlp.status()
    };
  });
}

function bridgeDownload(ctx) {
  return ctx.downloader.onStatus((status) => ctx.send('ytdlp:status', status));
}

module.exports = { registerDownload, bridgeDownload };
