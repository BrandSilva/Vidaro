const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createMetadataFetcher, networkOptions } = require('../src/main/downloader/metadata');
const { abortError } = require('../src/main/processes');
const { fakeRun, lines } = require('./fixtures/downloader-runtime/fake-run');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const EXE = 'C:\\Users\\User\\AppData\\Local\\Vidaro\\bin\\yt-dlp.exe';
const RUNTIME = { name: 'node', path: 'C:\\Program Files\\Vidaro\\Vidaro.exe', env: { ELECTRON_RUN_AS_NODE: '1' } };
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function fakeYtdlp({ ensureError = null } = {}) {
  const ytdlp = {
    tracked: 0,
    invalidated: 0,
    async ensure({ signal } = {}) {
      if (ensureError) throw ensureError;
      if (signal?.aborted) throw abortError(signal);
      return EXE;
    },
    childEnv: () => ({ ELECTRON_RUN_AS_NODE: '1', TEMP: 'C:\\runtime', TMP: 'C:\\runtime' }),
    track(promise) {
      ytdlp.tracked += 1;
      promise.catch(() => undefined);
      return promise;
    },
    invalidate() {
      ytdlp.invalidated += 1;
    }
  };
  return ytdlp;
}

function json(name) {
  return { steps: [], stdout: fixture(name).replace(/\s*\n\s*/g, ' ') };
}

function setup(script, { settings = { download: { cookiesMode: 'none', proxy: '' } }, clock = { now: 0 }, ytdlp = fakeYtdlp(), timeouts } = {}) {
  const fake = fakeRun(script);
  const fetcher = createMetadataFetcher({
    ytdlp,
    jsRuntime: RUNTIME,
    cacheDir: 'C:\\cache\\yt-dlp',
    getSettings: () => settings,
    run: fake.run,
    now: () => clock.now,
    timeouts
  });
  return { fetcher, fake, ytdlp, clock };
}

describe('fetch', () => {
  test('returns the summary of a single video', async () => {
    const { fetcher, fake, ytdlp } = setup(() => json('info-youtube-video.json'));
    const result = await fetcher.fetch(VIDEO_URL);
    assert.equal(result.info.kind, 'video');
    assert.equal(result.info.id, 'aqz-KE-bpKQ');
    assert.equal(result.info.playlistHint, false);
    assert.ok(result.info.heights.length > 0);
    const call = fake.calls[0];
    assert.equal(call.file, EXE);
    assert.ok(call.args.includes('-J'));
    assert.ok(call.args.includes('--flat-playlist'));
    assert.ok(call.args.includes('--no-playlist'));
    assert.equal(call.args[call.args.indexOf('--js-runtimes') + 1], `node:${RUNTIME.path}`);
    assert.equal(call.args[call.args.indexOf('--cache-dir') + 1], 'C:\\cache\\yt-dlp');
    assert.deepEqual(call.args.slice(-2), ['--', VIDEO_URL]);
    assert.equal(call.options.captureStdout, true);
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(ytdlp.tracked, 1);
  });

  test('cookies and proxy chosen on the page win over the saved settings', async () => {
    const settings = { download: { cookiesMode: 'none', cookiesBrowser: 'edge', proxy: 'http://saved:1' } };
    const { fetcher, fake } = setup(() => json('info-youtube-video.json'), { settings });
    await fetcher.fetch(VIDEO_URL, { network: { cookiesMode: 'browser', cookiesBrowser: 'firefox', proxy: 'http://page:2' } });
    const args = fake.calls[0].args;
    assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'firefox');
    assert.equal(args[args.indexOf('--proxy') + 1], 'http://page:2');
    await fetcher.fetch(VIDEO_URL);
    const plain = fake.calls[1].args;
    assert.equal(plain.includes('--cookies-from-browser'), false);
    assert.equal(plain[plain.indexOf('--proxy') + 1], 'http://saved:1');
  });

  test('offers the whole playlist when a video link carries one', async () => {
    const { fetcher } = setup(() => json('info-youtube-video.json'));
    const result = await fetcher.fetch(`${VIDEO_URL}&list=PLa1F2ddGya_8u-HEvmfCVuS_OImW8HaLd`);
    assert.equal(result.info.playlistHint, true);
  });

  test('playlist and channel links are always listed flat', async () => {
    const { fetcher, fake } = setup(() => json('info-youtube-playlist.json'));
    const result = await fetcher.fetch('https://www.youtube.com/playlist?list=PLa1F2ddGya_8u-HEvmfCVuS_OImW8HaLd');
    assert.equal(result.info.kind, 'playlist');
    assert.equal(result.info.playlistHint, false);
    assert.ok(fake.calls[0].args.includes('--yes-playlist'));
    await fetcher.fetch('https://www.youtube.com/@BlenderOfficial');
    assert.ok(fake.calls[1].args.includes('--yes-playlist'));
    await fetcher.fetch(VIDEO_URL, { playlist: true });
    assert.ok(fake.calls[2].args.includes('--yes-playlist'));
  });

  test('passes cookies and proxy from settings', async () => {
    const settings = { download: { cookiesMode: 'browser', cookiesBrowser: 'firefox', cookiesFile: 'C:\\ignored.txt', proxy: ' socks5://127.0.0.1:1080 ' } };
    const { fetcher, fake } = setup(() => json('info-youtube-video.json'), { settings });
    await fetcher.fetch(VIDEO_URL);
    const args = fake.calls[0].args;
    assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'firefox');
    assert.equal(args[args.indexOf('--proxy') + 1], 'socks5://127.0.0.1:1080');
    assert.ok(!args.includes('--cookies'));
  });

  test('maps failures to plain errors', async () => {
    const cases = [
      ['error-age-restricted.txt', 'age-restricted', 'cookies'],
      ['error-unsupported-url.txt', 'unsupported-url', null],
      ['error-playlist-missing.txt', 'video-unavailable', null],
      ['error-proxy-refused.txt', 'network', 'open-settings']
    ];
    for (const [name, code, action] of cases) {
      const { fetcher } = setup(() => ({ code: 1, steps: lines(fixture(name)).map((line) => ({ err: line })) }));
      const result = await fetcher.fetch(VIDEO_URL);
      assert.equal(result.info, undefined, name);
      assert.equal(result.error.code, code, name);
      assert.equal(result.error.action, action, name);
      assert.ok(result.error.message, name);
    }
  });

  test('empty or broken output is an error, not a crash', async () => {
    for (const stdout of ['', 'null', '{broken', '[1,2]']) {
      const { fetcher } = setup(() => ({ code: 0, steps: [], stdout }));
      const result = await fetcher.fetch(VIDEO_URL);
      assert.ok(result.error, JSON.stringify(stdout));
    }
  });

  test('bad cookies settings are reported without starting yt-dlp', async () => {
    const settings = { download: { cookiesMode: 'file', cookiesFile: 'relative.txt', proxy: '' } };
    const { fetcher, fake } = setup(() => json('info-youtube-video.json'), { settings });
    const result = await fetcher.fetch(VIDEO_URL);
    assert.equal(result.error.code, 'invalid-options');
    assert.equal(result.error.action, 'open-settings');
    assert.equal(fake.calls.length, 0);
  });

  test('a missing or blocked yt-dlp is a tool error', async () => {
    const missing = setup(() => ({}), { ytdlp: fakeYtdlp({ ensureError: new Error('gone') }) });
    assert.equal((await missing.fetcher.fetch(VIDEO_URL)).error.code, 'tool-missing');
    const blocked = setup(() => ({ spawnFailed: true }));
    const result = await blocked.fetcher.fetch(VIDEO_URL);
    assert.equal(result.error.code, 'tool-missing');
    assert.equal(blocked.ytdlp.invalidated, 1);
  });
});

describe('cancel and cache', () => {
  test('a new link cancels the previous fetch', async () => {
    const { fetcher, fake } = setup((call) => (call.args.at(-1) === VIDEO_URL ? { steps: [{ hang: true }] } : json('info-archive-org.json')));
    const first = fetcher.fetch(VIDEO_URL);
    await delay(10);
    const second = await fetcher.fetch('https://archive.org/details/BigBuckBunny_328');
    assert.deepEqual(await first, { canceled: true });
    assert.equal(fake.calls[0].aborted, true);
    assert.equal(second.info.kind, 'video');
  });

  test('cancel stops the running fetch', async () => {
    const { fetcher, fake } = setup(() => ({ steps: [{ hang: true }] }));
    const pending = fetcher.fetch(VIDEO_URL);
    await delay(10);
    assert.equal(fetcher.cancel(), true);
    assert.deepEqual(await pending, { canceled: true });
    assert.equal(fake.calls[0].aborted, true);
    assert.equal(fetcher.cancel(), false);
  });

  test('a slow site times out with a clear error', async () => {
    const { fetcher, fake } = setup(() => ({ steps: [{ hang: true }] }), { timeouts: { single: 30 } });
    const result = await fetcher.fetch(VIDEO_URL);
    assert.equal(result.error.code, 'network');
    assert.equal(fake.calls[0].aborted, true);
  });

  test('reuses recent results for ten minutes', async () => {
    const { fetcher, fake, clock } = setup(() => json('info-youtube-video.json'));
    const first = await fetcher.fetch(VIDEO_URL);
    first.info.title = 'changed by the caller';
    const second = await fetcher.fetch(VIDEO_URL);
    assert.equal(fake.calls.length, 1);
    assert.notEqual(second.info.title, 'changed by the caller');
    clock.now += 10 * 60 * 1000 + 1;
    await fetcher.fetch(VIDEO_URL);
    assert.equal(fake.calls.length, 2);
    await fetcher.fetch(VIDEO_URL, { playlist: true });
    assert.equal(fake.calls.length, 3);
  });

  test('errors are not cached and the cache holds twenty links', async () => {
    let fail = true;
    const { fetcher, fake } = setup(() => (fail ? { code: 1, steps: [{ err: 'ERROR: [generic] x: Unable to download webpage: timed out' }] } : json('info-youtube-video.json')));
    assert.ok((await fetcher.fetch(VIDEO_URL)).error);
    fail = false;
    assert.ok((await fetcher.fetch(VIDEO_URL)).info);
    assert.equal(fake.calls.length, 2);
    for (let i = 0; i < 20; i += 1) await fetcher.fetch(`https://example.com/v${i}`);
    await fetcher.fetch(VIDEO_URL);
    assert.equal(fake.calls.length, 23);
    await fetcher.fetch('https://example.com/v19');
    assert.equal(fake.calls.length, 23);
  });

  test('cookies changes bypass the cache', async () => {
    const settings = { download: { cookiesMode: 'none', proxy: '' } };
    const { fetcher, fake } = setup(() => json('info-youtube-video.json'), { settings });
    await fetcher.fetch(VIDEO_URL);
    settings.download = { cookiesMode: 'browser', cookiesBrowser: 'edge', proxy: '' };
    await fetcher.fetch(VIDEO_URL);
    assert.equal(fake.calls.length, 2);
  });

  test('dispose cancels and refuses new work', async () => {
    const { fetcher, fake } = setup(() => ({ steps: [{ hang: true }] }));
    const pending = fetcher.fetch(VIDEO_URL);
    await delay(10);
    fetcher.dispose();
    assert.deepEqual(await pending, { canceled: true });
    assert.deepEqual(await fetcher.fetch(VIDEO_URL), { canceled: true });
    assert.equal(fake.calls.length, 1);
  });
});

describe('networkOptions', () => {
  test('keeps only what the metadata call needs', () => {
    assert.deepEqual(networkOptions({ cookiesMode: 'none', cookiesBrowser: 'edge', cookiesFile: 'x', proxy: '' }), { cookiesMode: 'none', proxy: '' });
    assert.deepEqual(networkOptions({ cookiesMode: 'file', cookiesFile: 'C:\\c.txt' }), { cookiesMode: 'file', proxy: '', cookiesFile: 'C:\\c.txt' });
    assert.deepEqual(networkOptions({ cookiesMode: 'weird' }), { cookiesMode: 'none', proxy: '' });
    assert.deepEqual(networkOptions(), { cookiesMode: 'none', proxy: '' });
  });
});
