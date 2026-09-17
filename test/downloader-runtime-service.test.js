const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createDownloaderService, readBundledVersion } = require('../src/main/downloader/service');
const { registerDownload, bridgeDownload } = require('../src/main/ipc/download');
const { ValidationError } = require('../src/main/validate');

const FOLDER = 'C:\\Users\\User\\Videos\\Vidaro';
const PRESET = { id: 'mp4-universal', name: 'MP4 Universal', container: 'mp4' };

let root;

function fakePaths() {
  const bin = path.join(root, 'resources', 'bin');
  const local = path.join(root, 'Local', 'Vidaro');
  return {
    bundledBinDir: () => bin,
    bundledYtDlpPath: () => path.join(bin, 'yt-dlp.exe'),
    ffmpegPath: () => path.join(bin, 'ffmpeg.exe'),
    userBinDir: () => path.join(local, 'bin'),
    tempDir: () => path.join(local, 'temp'),
    cacheDir: () => path.join(local, 'cache'),
    jsRuntime: () => ({ name: 'node', path: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } })
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-dlsvc-'));
  const bin = path.join(root, 'resources', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'yt-dlp.exe'), Buffer.alloc(1024 * 1024 + 1, 1));
  fs.writeFileSync(path.join(bin, 'manifest.json'), '\uFEFF{ "yt-dlp": "2026.08.19", "ffmpeg": "9.0.1" }');
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('downloader service', () => {
  test('reads the bundled version from the manifest', () => {
    assert.equal(readBundledVersion(path.join(root, 'resources', 'bin')), '2026.08.19');
    assert.equal(readBundledVersion(path.join(root, 'missing')), null);
  });

  test('wires the runner, the manager and the fetcher', async () => {
    const settings = { download: { ytdlpChannel: 'stable', ytdlpAutoUpdate: true, ytdlpLastCheck: 0, cookiesMode: 'none', proxy: '' } };
    const service = createDownloaderService({ paths: fakePaths(), getSettings: () => settings, updateSettings: () => {} });
    const statuses = [];
    const stop = service.onStatus((status) => statuses.push(status));
    assert.equal(typeof service.runner.run, 'function');
    assert.equal(typeof service.runner.cleanup, 'function');
    service.start();
    service.start();
    const local = path.join(root, 'Local', 'Vidaro');
    for (let i = 0; i < 100 && !fs.existsSync(path.join(local, 'bin', 'yt-dlp.json')); i += 1) await delay(10);
    assert.ok(fs.existsSync(path.join(local, 'bin', 'yt-dlp.exe')));
    assert.ok(fs.existsSync(path.join(local, 'temp', 'runtime')));
    const status = service.ytdlp.status();
    assert.equal(status.version, '2026.08.19');
    assert.equal(status.path, path.join(local, 'bin', 'yt-dlp.exe'));
    assert.ok(statuses.length >= 1);
    assert.deepEqual(service.ytdlp.childEnv(), { ELECTRON_RUN_AS_NODE: '1', TEMP: path.join(local, 'temp', 'runtime'), TMP: path.join(local, 'temp', 'runtime') });
    assert.equal(service.suggestName({ info: { title: 'A/B' }, template: 'title' }), 'A⧸B');
    const [input] = service.buildJobs({ items: [{ url: 'https://example.com/v', info: {}, name: 'v' }], output: { folder: FOLDER } });
    assert.equal(input.kind, 'download');
    assert.equal(service.cancelFetch(), false);
    stop();
    service.dispose();
    assert.deepEqual(await service.fetchInfo('https://example.com/v'), { canceled: true });
  });
});

function fakeCtx({ preset = PRESET } = {}) {
  const handlers = new Map();
  const added = [];
  const listeners = new Set();
  const sent = [];
  const ctx = {
    presets: { get: (id) => (preset && id === preset.id ? structuredClone(preset) : null) },
    queue: {
      add: (inputs, options) => {
        added.push({ inputs, options });
        return inputs.map((_, index) => `j${index}`);
      }
    },
    downloader: {
      fetchInfo: async (url, options) => ({ url, options }),
      cancelFetch: () => true,
      suggestName: (request) => (Array.isArray(request.items) ? request.items.map(() => 'name') : 'name'),
      buildJobs: (request) => {
        if (request.items === 'boom') throw new TypeError('Nothing to download');
        return request.items.map((item) => ({ kind: 'download', title: item.name, spec: { after: request.after, group: request.group } }));
      },
      ytdlp: {
        inspect: async () => ({ version: '2026.08.19' }),
        update: async () => ({ deferred: true }),
        status: () => ({ pending: true })
      },
      onStatus: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    send: (channel, payload) => sent.push({ channel, payload })
  };
  registerDownload(ctx, (channel, fn) => handlers.set(channel, fn));
  return { ctx, handlers, added, listeners, sent };
}

describe('download IPC', () => {
  test('registers the preload channels', () => {
    const { handlers } = fakeCtx();
    assert.deepEqual([...handlers.keys()].sort(), [
      'download:cancel-fetch',
      'download:enqueue',
      'download:fetch-info',
      'download:suggest-name',
      'ytdlp:status',
      'ytdlp:update'
    ]);
  });

  test('validates links before fetching', async () => {
    const { handlers } = fakeCtx();
    const fetch = handlers.get('download:fetch-info');
    assert.deepEqual(await fetch(' https://example.com/v ', { playlist: true }), { url: 'https://example.com/v', options: { playlist: true } });
    assert.deepEqual(await fetch('https://example.com/v'), { url: 'https://example.com/v', options: { playlist: false } });
    assert.deepEqual(await fetch('https://example.com/v', { playlist: 'yes' }), { url: 'https://example.com/v', options: { playlist: false } });
    assert.throws(() => fetch('file:///C:/x'), ValidationError);
    assert.throws(() => fetch(42), ValidationError);
    assert.throws(() => fetch('https://example.com/v', 'playlist'), ValidationError);
    assert.equal(handlers.get('download:cancel-fetch')(), true);
  });

  test('enqueue resolves the preset and starts by default', () => {
    const { handlers, added } = fakeCtx();
    const enqueue = handlers.get('download:enqueue');
    const result = enqueue({
      items: [{ url: 'https://example.com/v', info: {}, name: 'v' }],
      options: {},
      output: { folder: FOLDER, collision: 'rename' },
      after: { presetId: 'mp4-universal', keepOriginal: false },
      group: { title: 'List' }
    });
    assert.deepEqual(result, { ids: ['j0'] });
    assert.deepEqual(added[0].options, { start: true });
    assert.deepEqual(added[0].inputs[0].spec.after, { preset: PRESET, keepOriginal: false });
    assert.deepEqual(added[0].inputs[0].spec.group, { title: 'List' });
    enqueue({ items: [{ url: 'https://example.com/v', name: 'v' }], output: { folder: FOLDER }, start: false });
    assert.deepEqual(added[1].options, { start: false });
    assert.equal(added[1].inputs[0].spec.after, null);
    assert.equal(added[1].inputs[0].spec.group, null);
  });

  test('enqueue explains bad requests', () => {
    const { handlers } = fakeCtx();
    const enqueue = handlers.get('download:enqueue');
    assert.throws(() => enqueue({ items: [], after: { presetId: 'gone' } }), (error) => error.expose === true && /preset/.test(error.message));
    assert.throws(() => enqueue({ items: 'boom' }), (error) => error.expose === true && error.message === 'Nothing to download');
    assert.throws(() => enqueue(null), ValidationError);
    assert.throws(() => enqueue({ items: [], after: { presetId: 5 } }), ValidationError);
  });

  test('suggests names and reports yt-dlp state', async () => {
    const { handlers } = fakeCtx();
    assert.equal(handlers.get('download:suggest-name')({ info: {} }), 'name');
    assert.deepEqual(handlers.get('download:suggest-name')({ items: [{}, {}] }), ['name', 'name']);
    assert.throws(() => handlers.get('download:suggest-name')('x'), ValidationError);
    assert.deepEqual(await handlers.get('ytdlp:status')(), { version: '2026.08.19' });
    assert.deepEqual(await handlers.get('ytdlp:update')(), { outcome: 'deferred', error: null, status: { pending: true } });
  });

  test('bridges status events until disposed', () => {
    const { ctx, listeners, sent } = fakeCtx();
    const dispose = bridgeDownload(ctx);
    for (const listener of listeners) listener({ checking: true });
    dispose();
    assert.equal(listeners.size, 0);
    assert.deepEqual(sent, [{ channel: 'ytdlp:status', payload: { checking: true } }]);
  });
});
