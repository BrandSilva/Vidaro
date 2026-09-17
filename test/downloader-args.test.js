const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDownloadArgs,
  formatArgs,
  infoArgs,
  updateArgs,
  versionArgs,
  runtimeProbeArgs,
  processEnv,
  expectedExtension,
  sectionDuration,
  tempReserve,
  TEMP_NAME_EXTRA,
  QUALITIES,
  CONTAINERS,
  AUDIO_FORMATS
} = require('../src/main/downloader/args');
const { progressArgs } = require('../src/main/downloader/progress');

const ELECTRON = 'C:\\Program Files\\Vidaro\\Vidaro.exe';
const env = {
  ffmpegDir: 'C:\\Program Files\\Vidaro\\resources\\bin',
  tempDir: 'C:\\Users\\User\\AppData\\Local\\Vidaro\\temp\\j1',
  cacheDir: 'C:\\Users\\User\\AppData\\Local\\Vidaro\\cache\\yt-dlp',
  jsRuntime: { name: 'node', path: ELECTRON, env: { ELECTRON_RUN_AS_NODE: '1' } }
};

const URL_ = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function spec(options = {}, output = {}) {
  return {
    url: URL_,
    info: { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny' },
    options: {
      mode: 'av',
      quality: 'best',
      compatible: true,
      container: 'mp4',
      audioFormat: 'mp3',
      audioQuality: 'best',
      subtitles: false,
      embedSubtitles: true,
      subtitleLangs: 'en.*,es.*',
      autoSubtitles: false,
      embedThumbnail: true,
      embedMetadata: true,
      embedChapters: true,
      sponsorBlock: false,
      rateLimit: '',
      concurrentFragments: 4,
      cookiesMode: 'none',
      cookiesBrowser: 'edge',
      cookiesFile: '',
      proxy: '',
      section: null,
      ...options
    },
    output: { folder: 'C:\\Users\\User\\Videos\\Vidaro', name: 'Big Buck Bunny', collision: 'rename', ...output }
  };
}

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function valuesOf(args, flag) {
  return args.filter((arg, index) => args[index - 1] === flag);
}

describe('buildDownloadArgs', () => {
  test('builds the full default command', () => {
    assert.deepEqual(buildDownloadArgs(spec(), env), [
      '--ignore-config',
      '--no-plugin-dirs',
      '--color',
      'never',
      '--encoding',
      'utf-8',
      '--no-js-runtimes',
      '--js-runtimes',
      `node:${ELECTRON}`,
      '--cache-dir',
      env.cacheDir,
      ...progressArgs(),
      '--ffmpeg-location',
      env.ffmpegDir,
      '--no-playlist',
      '--abort-on-error',
      '-P',
      'home:C:\\Users\\User\\Videos\\Vidaro',
      '-P',
      `temp:${env.tempDir}`,
      '-o',
      'Big Buck Bunny.%(ext)s',
      '--no-mtime',
      '--file-access-retries',
      '10',
      '-f',
      'bv*+ba/b',
      '-S',
      'vcodec:h264,lang,quality,res,fps,hdr:12,acodec:aac',
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4>mp4/m4v>mp4/mov>mp4/webm>mp4/flv>mp4/mkv',
      '--embed-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '--embed-metadata',
      '--no-embed-info-json',
      '--embed-chapters',
      '-N',
      '4',
      '--',
      URL_
    ]);
  });

  test('always ends with -- and the URL as one argument', () => {
    const args = buildDownloadArgs(spec({}, {}), env);
    assert.deepEqual(args.slice(-2), ['--', URL_]);
    const odd = buildDownloadArgs({ ...spec(), url: 'https://example.com/a video "x".mp4?q=1&b=2' }, env);
    assert.equal(odd[odd.length - 1], 'https://example.com/a%20video%20%22x%22.mp4?q=1&b=2');
  });

  test('every argument is a string', () => {
    const args = buildDownloadArgs(spec({ rateLimit: 4096, section: { start: 1, end: 2 }, subtitles: true }), env);
    assert.ok(args.every((arg) => typeof arg === 'string'));
  });

  test('escapes percent signs in the literal output name', () => {
    const args = buildDownloadArgs(spec({}, { name: 'Sale 100% off %(title)s' }), env);
    assert.equal(valueOf(args, '-o'), 'Sale 100%% off %%(title)s.%(ext)s');
  });

  test('keeps non-ASCII output names', () => {
    const args = buildDownloadArgs(spec({}, { name: 'Canción： 🎬 Año' }), env);
    assert.equal(valueOf(args, '-o'), 'Canción： 🎬 Año.%(ext)s');
  });

  test('rejects names that are not already clean', () => {
    for (const name of ['a:b', 'a/b', 'CON', '', ' spaced', 'dot.', 'x'.repeat(256), 42, null]) {
      assert.throws(() => buildDownloadArgs(spec({}, { name }), env), TypeError, String(name));
    }
  });

  test('rejects links that are not http or https', () => {
    for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://example.com/a', 'notaurl', '', '   ', null, 42, `https://e.com/${'a'.repeat(9000)}`, '-o evil']) {
      assert.throws(() => buildDownloadArgs({ ...spec(), url }, env), TypeError, String(url).slice(0, 30));
    }
  });

  test('requires absolute folders', () => {
    assert.throws(() => buildDownloadArgs(spec({}, { folder: 'Videos' }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({}, { folder: '\\Videos' }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({}, { folder: 'C:' }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), { ...env, tempDir: 'temp' }), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), { ...env, ffmpegDir: undefined }), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), { ...env, cacheDir: 'cache' }), TypeError);
  });

  test('accepts network folders and normalizes separators', () => {
    const args = buildDownloadArgs(spec({}, { folder: '\\\\nas\\media\\incoming' }), env);
    assert.equal(valueOf(args, '-P'), 'home:\\\\nas\\media\\incoming');
    const forward = buildDownloadArgs(spec({}, { folder: 'D:/Media/Clips/' }), env);
    assert.equal(valueOf(forward, '-P'), 'home:D:\\Media\\Clips\\');
  });

  test('rejects malformed specs', () => {
    assert.throws(() => buildDownloadArgs(null, env), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), null), TypeError);
    assert.throws(() => buildDownloadArgs({ ...spec(), options: [] }, env), TypeError);
    assert.throws(() => buildDownloadArgs({ ...spec(), output: null }, env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({}, { collision: 'merge' }), env), TypeError);
  });

  test('overwrite forces overwrites only on the first run so pause and resume keep working', () => {
    assert.ok(buildDownloadArgs(spec({}, { collision: 'overwrite' }), env).includes('--force-overwrites'));
    assert.ok(!buildDownloadArgs(spec({}, { collision: 'overwrite' }), { ...env, resume: true }).includes('--force-overwrites'));
    assert.ok(!buildDownloadArgs(spec({}, { collision: 'rename' }), env).includes('--force-overwrites'));
    assert.ok(!buildDownloadArgs(spec({}, { collision: 'skip' }), env).includes('--force-overwrites'));
  });

  test('stops on the first error so a missing ffmpeg never leaves unmerged files behind', () => {
    const args = buildDownloadArgs(spec(), env);
    assert.ok(args.includes('--abort-on-error'));
    assert.ok(!args.includes('--no-abort-on-error') && !args.includes('-i') && !args.includes('--ignore-errors'));
    assert.ok(!infoArgs(URL_, { env }).includes('--abort-on-error'));
  });

  test('never passes options that would break resume or simulate the download', () => {
    const args = buildDownloadArgs(spec(), env);
    for (const flag of ['--no-continue', '--no-part', '--simulate', '-s', '--quiet', '--no-progress', '--restrict-filenames', '--yes-playlist']) {
      assert.ok(!args.includes(flag), flag);
    }
  });

  test('without a cache folder yt-dlp does not write its cache in the profile', () => {
    const args = buildDownloadArgs(spec(), { ...env, cacheDir: undefined });
    assert.ok(args.includes('--no-cache-dir'));
    assert.ok(!args.includes('--cache-dir'));
  });

  test('the JavaScript runtime is explicit and validated', () => {
    const args = buildDownloadArgs(spec(), env);
    assert.deepEqual(args.slice(args.indexOf('--no-js-runtimes'), args.indexOf('--no-js-runtimes') + 3), ['--no-js-runtimes', '--js-runtimes', `node:${ELECTRON}`]);
    const deno = buildDownloadArgs(spec(), { ...env, jsRuntime: { name: 'deno', path: 'C:\\bin\\deno.exe' } });
    assert.equal(valueOf(deno, '--js-runtimes'), 'deno:C:\\bin\\deno.exe');
    const none = buildDownloadArgs(spec(), { ...env, jsRuntime: undefined });
    assert.ok(!none.includes('--js-runtimes') && !none.includes('--no-js-runtimes'));
    assert.throws(() => buildDownloadArgs(spec(), { ...env, jsRuntime: { name: 'python', path: ELECTRON } }), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), { ...env, jsRuntime: { name: 'node', path: 'node.exe' } }), TypeError);
    assert.throws(() => buildDownloadArgs(spec(), { ...env, jsRuntime: 'node' }), TypeError);
  });

  test('subtitles are embedded in videos', () => {
    const args = buildDownloadArgs(spec({ subtitles: true, autoSubtitles: true, subtitleLangs: 'en.*, es' }), env);
    assert.ok(args.includes('--write-subs'));
    assert.ok(args.includes('--write-auto-subs'));
    assert.equal(valueOf(args, '--sub-langs'), 'en.*,es');
    assert.ok(args.includes('--embed-subs'));
    assert.equal(valueOf(args, '--compat-options'), 'no-keep-subs');
    assert.ok(!args.includes('--convert-subs'));
  });

  test('subtitles become SRT files when not embedded or for audio', () => {
    const separate = buildDownloadArgs(spec({ subtitles: true, embedSubtitles: false }), env);
    assert.equal(valueOf(separate, '--convert-subs'), 'srt');
    assert.ok(!separate.includes('--embed-subs'));
    assert.ok(!separate.includes('--compat-options'));
    assert.ok(!separate.includes('--write-auto-subs'));
    const audio = buildDownloadArgs(spec({ mode: 'audio', subtitles: true }), env);
    assert.equal(valueOf(audio, '--convert-subs'), 'srt');
    assert.ok(!audio.includes('--embed-subs'));
  });

  test('no subtitle flags when subtitles are off', () => {
    const args = buildDownloadArgs(spec({ subtitles: false, autoSubtitles: true }), env);
    for (const flag of ['--write-subs', '--write-auto-subs', '--sub-langs', '--embed-subs', '--convert-subs']) assert.ok(!args.includes(flag), flag);
  });

  test('subtitle languages are validated', () => {
    assert.equal(valueOf(buildDownloadArgs(spec({ subtitles: true, subtitleLangs: 'all,-live_chat' }), env), '--sub-langs'), 'all,-live_chat');
    for (const subtitleLangs of ['', '-live_chat', 'en;rm', 'en es"', 'x'.repeat(200), 42]) {
      assert.throws(() => buildDownloadArgs(spec({ subtitles: true, subtitleLangs }), env), TypeError, String(subtitleLangs));
    }
  });

  test('thumbnails are not embedded where the container cannot hold them', () => {
    assert.ok(!buildDownloadArgs(spec({ container: 'webm' }), env).includes('--embed-thumbnail'));
    assert.ok(!buildDownloadArgs(spec({ mode: 'audio', audioFormat: 'wav' }), env).includes('--embed-thumbnail'));
    assert.ok(buildDownloadArgs(spec({ container: 'mkv' }), env).includes('--embed-thumbnail'));
    for (const audioFormat of ['mp3', 'm4a', 'opus', 'flac']) {
      assert.ok(buildDownloadArgs(spec({ mode: 'audio', audioFormat }), env).includes('--embed-thumbnail'), audioFormat);
    }
    assert.ok(!buildDownloadArgs(spec({ embedThumbnail: false }), env).includes('--convert-thumbnails'));
  });

  test('metadata and chapters follow the options', () => {
    const off = buildDownloadArgs(spec({ embedMetadata: false, embedChapters: false }), env);
    assert.ok(!off.includes('--embed-metadata'));
    assert.ok(off.includes('--no-embed-chapters'));
    assert.ok(!off.includes('--embed-chapters'));
  });

  test('SponsorBlock removes the default categories', () => {
    const args = buildDownloadArgs(spec({ sponsorBlock: true }), env);
    assert.equal(valueOf(args, '--sponsorblock-remove'), 'sponsor,selfpromo,interaction');
  });

  test('SponsorBlock is skipped for a time range', () => {
    const args = buildDownloadArgs(spec({ sponsorBlock: true, section: { start: 10, end: 20 } }), env);
    assert.ok(!args.includes('--sponsorblock-remove'));
  });

  test('time ranges cut with keyframes', () => {
    const args = buildDownloadArgs(spec({ section: { start: 12.5, end: 30 } }), env);
    assert.equal(valueOf(args, '--download-sections'), '*12.5-30');
    assert.ok(args.includes('--force-keyframes-at-cuts'));
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { start: 60, end: null } }), env), '--download-sections'), '*60-inf');
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { end: 5 } }), env), '--download-sections'), '*0-5');
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { start: 1 / 3, end: 2 / 3 } }), env), '--download-sections'), '*0.333-0.667');
  });

  test('a range covering everything is no range', () => {
    const args = buildDownloadArgs(spec({ section: { start: 0, end: null } }), env);
    assert.ok(!args.includes('--download-sections'));
    assert.ok(!args.includes('--force-keyframes-at-cuts'));
  });

  test('ranges are compared after rounding to milliseconds', () => {
    assert.throws(() => buildDownloadArgs(spec({ section: { start: 0.0001, end: 0.0004 } }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({ section: { start: 5.0004, end: 5.0001 } }), env), TypeError);
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { start: 1.0004, end: 1.0006 } }), env), '--download-sections'), '*1-1.001');
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { start: 0.0004, end: 3 } }), env), '--download-sections'), '*0-3');
    assert.ok(!buildDownloadArgs(spec({ section: { start: 0.0004, end: null } }), env).includes('--download-sections'));
    assert.equal(valueOf(buildDownloadArgs(spec({ section: { start: 3599.9995, end: 9999999 } }), env), '--download-sections'), '*3600-9999999');
  });

  test('invalid time ranges throw', () => {
    for (const section of [{ start: 10, end: 5 }, { start: 5, end: 5 }, { start: -1, end: 5 }, { start: 'a', end: 5 }, { start: 0, end: Infinity }, { start: Number.NaN }, 'x', []]) {
      assert.throws(() => buildDownloadArgs(spec({ section }), env), TypeError, JSON.stringify(section));
    }
  });

  test('rate limits are validated and normalized', () => {
    assert.equal(valueOf(buildDownloadArgs(spec({ rateLimit: '4.2M' }), env), '-r'), '4.2M');
    assert.equal(valueOf(buildDownloadArgs(spec({ rateLimit: ' 500k ' }), env), '-r'), '500K');
    assert.equal(valueOf(buildDownloadArgs(spec({ rateLimit: '2048' }), env), '-r'), '2048');
    assert.equal(valueOf(buildDownloadArgs(spec({ rateLimit: 1048576.4 }), env), '-r'), '1048576');
    assert.ok(!buildDownloadArgs(spec({ rateLimit: '' }), env).includes('-r'));
    assert.ok(!buildDownloadArgs(spec({ rateLimit: null }), env).includes('-r'));
    assert.ok(!buildDownloadArgs(spec({ rateLimit: 0 }), env).includes('-r'));
    for (const rateLimit of ['fast', '10', '0.5K', '-1M', '5T', '1e6', 100, Number.NaN, true, '1M; rm']) {
      assert.throws(() => buildDownloadArgs(spec({ rateLimit }), env), TypeError, String(rateLimit));
    }
  });

  test('concurrent fragments are validated', () => {
    assert.equal(valueOf(buildDownloadArgs(spec({ concurrentFragments: 16 }), env), '-N'), '16');
    assert.ok(!buildDownloadArgs(spec({ concurrentFragments: null }), env).includes('-N'));
    for (const concurrentFragments of [0, 17, 1.5, '4', -1]) {
      assert.throws(() => buildDownloadArgs(spec({ concurrentFragments }), env), TypeError, String(concurrentFragments));
    }
  });

  test('cookies from a browser', () => {
    const args = buildDownloadArgs(spec({ cookiesMode: 'browser', cookiesBrowser: 'firefox' }), env);
    assert.equal(valueOf(args, '--cookies-from-browser'), 'firefox');
    assert.throws(() => buildDownloadArgs(spec({ cookiesMode: 'browser', cookiesBrowser: 'safari' }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({ cookiesMode: 'browser', cookiesBrowser: 'chrome:Profile 1' }), env), TypeError);
  });

  test('cookies from a file prefer the private copy given by the runner', () => {
    const own = buildDownloadArgs(spec({ cookiesMode: 'file', cookiesFile: 'C:\\Users\\User\\cookies.txt' }), env);
    assert.equal(valueOf(own, '--cookies'), 'C:\\Users\\User\\cookies.txt');
    const copy = buildDownloadArgs(spec({ cookiesMode: 'file', cookiesFile: 'C:\\Users\\User\\cookies.txt' }), { ...env, cookiesFile: 'C:\\Temp\\j1\\cookies.txt' });
    assert.equal(valueOf(copy, '--cookies'), 'C:\\Temp\\j1\\cookies.txt');
    assert.throws(() => buildDownloadArgs(spec({ cookiesMode: 'file', cookiesFile: 'cookies.txt' }), env), TypeError);
    assert.throws(() => buildDownloadArgs(spec({ cookiesMode: 'file', cookiesFile: '' }), env), TypeError);
  });

  test('no cookie flags without a cookies mode', () => {
    const args = buildDownloadArgs(spec({ cookiesMode: 'none', cookiesFile: 'C:\\c.txt' }), env);
    assert.ok(!args.includes('--cookies') && !args.includes('--cookies-from-browser'));
    assert.throws(() => buildDownloadArgs(spec({ cookiesMode: 'magic' }), env), TypeError);
  });

  test('proxies are validated', () => {
    assert.equal(valueOf(buildDownloadArgs(spec({ proxy: 'socks5://user:pass@127.0.0.1:1080/' }), env), '--proxy'), 'socks5://user:pass@127.0.0.1:1080/');
    assert.equal(valueOf(buildDownloadArgs(spec({ proxy: 'http://proxy.local:3128' }), env), '--proxy'), 'http://proxy.local:3128');
    assert.ok(!buildDownloadArgs(spec({ proxy: '' }), env).includes('--proxy'));
    assert.ok(!buildDownloadArgs(spec({ proxy: '   ' }), env).includes('--proxy'));
    assert.ok(!buildDownloadArgs(spec({ proxy: null }), env).includes('--proxy'));
    assert.equal(valueOf(buildDownloadArgs(spec({ proxy: ' http://proxy.local:3128\n' }), env), '--proxy'), 'http://proxy.local:3128');
    for (const proxy of ['proxy.local:3128', 'ftp://p:21', 'http://a b', 'http://', 42, `http://${'a'.repeat(600)}.com`]) {
      assert.throws(() => buildDownloadArgs(spec({ proxy }), env), TypeError, String(proxy).slice(0, 30));
    }
  });
});

describe('formatArgs', () => {
  test('compatible best prefers H.264 and AAC in MP4', () => {
    assert.deepEqual(formatArgs({ mode: 'av', quality: 'best', compatible: true, container: 'mp4' }), [
      '-f',
      'bv*+ba/b',
      '-S',
      'vcodec:h264,lang,quality,res,fps,hdr:12,acodec:aac',
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4>mp4/m4v>mp4/mov>mp4/webm>mp4/flv>mp4/mkv'
    ]);
  });

  test('a quality cap puts the resolution first', () => {
    const args = formatArgs({ mode: 'av', quality: '720', compatible: true, container: 'mp4' });
    assert.equal(valueOf(args, '-S'), 'res:720,vcodec:h264,lang,quality,fps,hdr:12,acodec:aac');
    assert.equal(valueOf(formatArgs({ quality: 1080 }), '-S'), 'res:1080,vcodec:h264,lang,quality,fps,hdr:12,acodec:aac');
  });

  test('without Compatible only the cap is sorted', () => {
    assert.equal(valueOf(formatArgs({ quality: '480', compatible: false }), '-S'), 'res:480');
    assert.ok(!formatArgs({ quality: 'best', compatible: false }).includes('-S'));
  });

  test('defaults are MP4, best, compatible, video and audio', () => {
    assert.deepEqual(formatArgs({}), formatArgs({ mode: 'av', quality: 'best', compatible: true, container: 'mp4' }));
    assert.deepEqual(formatArgs(), formatArgs({}));
  });

  test('MKV keeps any codec', () => {
    const args = formatArgs({ container: 'mkv' });
    assert.equal(valueOf(args, '--merge-output-format'), 'mkv');
    assert.equal(valueOf(args, '--remux-video'), 'mkv');
  });

  test('WebM prefers WebM streams and falls back to MKV', () => {
    const args = formatArgs({ container: 'webm', compatible: true, quality: '360' });
    assert.equal(valueOf(args, '-f'), 'bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b');
    assert.equal(valueOf(args, '-S'), 'res:360');
    assert.equal(valueOf(args, '--merge-output-format'), 'webm/mkv');
    assert.equal(valueOf(args, '--remux-video'), 'webm>webm/mkv');
  });

  test('video only selects video streams', () => {
    assert.equal(valueOf(formatArgs({ mode: 'video' }), '-f'), 'bv/bv*');
    assert.equal(valueOf(formatArgs({ mode: 'video', container: 'webm' }), '-f'), 'bv[ext=webm]/bv/bv*');
    assert.ok(!formatArgs({ mode: 'video' }).includes('-x'));
  });

  test('audio formats and qualities', () => {
    assert.deepEqual(formatArgs({ mode: 'audio', audioFormat: 'mp3', audioQuality: 'best' }), ['-f', 'ba[acodec^=mp3]/ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']);
    assert.deepEqual(formatArgs({ mode: 'audio', audioFormat: 'm4a', audioQuality: '192' }), ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'm4a', '--audio-quality', '192K']);
    assert.deepEqual(formatArgs({ mode: 'audio', audioFormat: 'opus', audioQuality: '128' }), ['-f', 'ba[acodec^=opus]/ba/b', '-x', '--audio-format', 'opus', '--audio-quality', '128K']);
    assert.deepEqual(formatArgs({ mode: 'audio', audioFormat: 'wav', audioQuality: '320' }), ['-f', 'ba/b', '-x', '--audio-format', 'wav']);
    assert.deepEqual(formatArgs({ mode: 'audio', audioFormat: 'flac' }), ['-f', 'ba/b', '-x', '--audio-format', 'flac']);
  });

  test('audio mode ignores video options', () => {
    const args = formatArgs({ mode: 'audio', container: 'webm', quality: '720', compatible: true });
    assert.ok(!args.includes('-S') && !args.includes('--merge-output-format') && !args.includes('--remux-video'));
  });

  test('every supported combination builds', () => {
    for (const mode of ['av', 'video', 'audio']) {
      for (const quality of QUALITIES) {
        for (const container of CONTAINERS) {
          for (const audioFormat of AUDIO_FORMATS) {
            for (const compatible of [true, false]) {
              const args = formatArgs({ mode, quality, container, audioFormat, compatible, audioQuality: '256' });
              assert.ok(args.length > 0 && args.every((arg) => typeof arg === 'string'));
            }
          }
        }
      }
    }
  });

  test('unsupported values throw', () => {
    for (const options of [
      { mode: 'both' },
      { quality: '4320' },
      { quality: '720p' },
      { container: 'avi' },
      { mode: 'audio', audioFormat: 'aac' },
      { mode: 'audio', audioQuality: '999' },
      { mode: 'audio', audioQuality: 320 }
    ]) {
      assert.throws(() => formatArgs(options), TypeError, JSON.stringify(options));
    }
    assert.throws(() => formatArgs(null), TypeError);
    assert.throws(() => formatArgs([]), TypeError);
  });
});

describe('infoArgs', () => {
  test('single video metadata', () => {
    assert.deepEqual(infoArgs(URL_, { env }), [
      '--ignore-config',
      '--no-plugin-dirs',
      '--color',
      'never',
      '--encoding',
      'utf-8',
      '--no-js-runtimes',
      '--js-runtimes',
      `node:${ELECTRON}`,
      '--cache-dir',
      env.cacheDir,
      '-J',
      '--no-download',
      '--flat-playlist',
      '--no-playlist',
      '--',
      URL_
    ]);
  });

  test('single mode stays flat so a playlist link never extracts every video', () => {
    const args = infoArgs('https://www.youtube.com/playlist?list=PLx', { env });
    assert.ok(args.includes('--flat-playlist'));
    assert.ok(args.includes('--no-playlist'));
    assert.ok(!args.includes('--yes-playlist'));
  });

  test('playlist metadata is flat', () => {
    const args = infoArgs('https://www.youtube.com/playlist?list=PLx', { playlist: true, env });
    assert.ok(args.includes('--flat-playlist'));
    assert.ok(args.includes('--yes-playlist'));
    assert.ok(!args.includes('--no-playlist'));
  });

  test('can limit the number of entries', () => {
    const args = infoArgs(URL_, { playlist: true, env, maxEntries: 500 });
    assert.equal(valueOf(args, '-I'), '1:500');
    assert.throws(() => infoArgs(URL_, { maxEntries: 0 }), TypeError);
    assert.throws(() => infoArgs(URL_, { maxEntries: 2.5 }), TypeError);
  });

  test('passes cookies and proxy through', () => {
    const args = infoArgs(URL_, { env, options: { cookiesMode: 'browser', cookiesBrowser: 'edge', proxy: 'http://p:8080' } });
    assert.equal(valueOf(args, '--cookies-from-browser'), 'edge');
    assert.equal(valueOf(args, '--proxy'), 'http://p:8080');
    assert.deepEqual(args.slice(-2), ['--', URL_]);
  });

  test('works without an environment', () => {
    const args = infoArgs(URL_);
    assert.ok(args.includes('--no-cache-dir'));
    assert.ok(!args.includes('--js-runtimes'));
  });

  test('never downloads or prints progress', () => {
    const args = infoArgs(URL_, { env });
    for (const flag of ['--progress', '--newline', '--print', '--no-simulate', '-o']) assert.ok(!args.includes(flag), flag);
  });

  test('rejects bad links', () => {
    assert.throws(() => infoArgs('file:///C:/x.mp4'), TypeError);
    assert.throws(() => infoArgs(undefined), TypeError);
  });
});

describe('updateArgs and versionArgs', () => {
  test('updates to the latest build of a channel', () => {
    assert.deepEqual(updateArgs('stable'), ['--ignore-config', '--no-plugin-dirs', '--color', 'never', '--encoding', 'utf-8', '--update-to', 'stable@latest']);
    assert.equal(valueOf(updateArgs('nightly'), '--update-to'), 'nightly@latest');
    assert.equal(valueOf(updateArgs(), '--update-to'), 'stable@latest');
  });

  test('rejects unknown channels', () => {
    for (const channel of ['master', 'yt-dlp/yt-dlp@2020.01.01', '', null]) assert.throws(() => updateArgs(channel), TypeError, String(channel));
  });

  test('pins an exact version to move from nightly back to stable', () => {
    assert.equal(valueOf(updateArgs('stable', { tag: '2026.08.19' }), '--update-to'), 'stable@2026.08.19');
    assert.equal(valueOf(updateArgs('nightly', { tag: '2026.08.30.232658' }), '--update-to'), 'nightly@2026.08.30.232658');
    assert.equal(valueOf(updateArgs('stable', { tag: null }), '--update-to'), 'stable@latest');
  });

  test('rejects tags that are not versions', () => {
    for (const tag of ['latest', '2026.8.19', '2026.08.19;x', ' 2026.08.19', 'yt-dlp/yt-dlp@2026.08.19', 20260819, '']) {
      assert.throws(() => updateArgs('stable', { tag }), TypeError, String(tag));
    }
  });

  test('version check', () => {
    assert.deepEqual(versionArgs(), ['--ignore-config', '--no-plugin-dirs', '--version']);
  });

  test('runtime probe prints the debug header with the chosen runtime', () => {
    const args = runtimeProbeArgs(env);
    assert.equal(args[0], '-v');
    assert.equal(valueOf(args, '--js-runtimes'), `node:${ELECTRON}`);
    assert.ok(args.includes('--ignore-config'));
    assert.ok(!args.includes('--'));
    assert.deepEqual(runtimeProbeArgs().slice(0, 2), ['-v', '--ignore-config']);
  });
});

describe('processEnv', () => {
  test('returns only the runtime variables', () => {
    assert.deepEqual(processEnv(env), { ELECTRON_RUN_AS_NODE: '1' });
  });

  test('ignores missing or invalid values', () => {
    assert.deepEqual(processEnv({}), {});
    assert.deepEqual(processEnv(), {});
    assert.deepEqual(processEnv({ jsRuntime: { env: { 'bad key': '1', lower: '1', NUM: 1, OK_1: 'yes' } } }), { OK_1: 'yes' });
    assert.deepEqual(processEnv({ jsRuntime: { env: null } }), {});
  });
});

describe('expectedExtension', () => {
  test('matches the container or audio format', () => {
    assert.equal(expectedExtension({ mode: 'av', container: 'mkv' }), 'mkv');
    assert.equal(expectedExtension({ mode: 'video', container: 'webm' }), 'webm');
    assert.equal(expectedExtension({ mode: 'audio', audioFormat: 'opus', container: 'mkv' }), 'opus');
    assert.equal(expectedExtension({}), 'mp4');
    assert.throws(() => expectedExtension({ container: 'avi' }), TypeError);
  });
});

describe('sectionDuration', () => {
  test('is the section length, capped by the media duration', () => {
    assert.equal(sectionDuration({ section: { start: 10, end: 25 } }, 600), 15);
    assert.equal(sectionDuration({ section: { start: 590, end: 700 } }, 600), 10);
    assert.equal(sectionDuration({ section: { start: 60, end: null } }, 600), 540);
    assert.equal(sectionDuration({ section: { start: 10, end: 25 } }), 15);
  });

  test('falls back to the media duration or null', () => {
    assert.equal(sectionDuration({}, 635), 635);
    assert.equal(sectionDuration({ section: null }, 0), null);
    assert.equal(sectionDuration({ section: { start: 60, end: null } }), null);
    assert.equal(sectionDuration({ section: { start: 700, end: null } }, 600), null);
  });
});

describe('tempReserve', () => {
  const { uniquePath } = require('../src/main/fsnames');
  const longest = `.fdash-video=4000000.webm.part-Frag12345.part`;

  test('reserves room so temporary files in a longer folder still fit', () => {
    const folder = 'D:\\V';
    const tempDir = 'C:\\Users\\Someone With A Long Name\\AppData\\Local\\Vidaro\\temp\\jmfx3k2a9q1';
    const reserve = tempReserve({ folder, tempDir, extension: 'mp4' });
    assert.equal(reserve, tempDir.length + 1 + TEMP_NAME_EXTRA - (folder.length + 1) - 4);
    const final = uniquePath(folder, 'n'.repeat(400), '.mp4', () => false, { reserve, maxLength: 255 });
    const base = final.slice(folder.length + 1, -4);
    assert.ok(final.length <= 250);
    assert.ok(`${tempDir}\\${base}${longest}`.length <= 250, `${tempDir}\\${base}${longest}`.length);
    assert.ok(longest.length <= TEMP_NAME_EXTRA);
  });

  test('needs no reserve when the output folder is longer than the temporary one', () => {
    assert.equal(tempReserve({ folder: `C:\\${'x'.repeat(120)}`, tempDir: 'C:\\T\\j1', extension: '.mkv' }), 0);
  });

  test('accepts an extension with or without the dot, or none', () => {
    const base = { folder: 'D:\\V', tempDir: 'C:\\Temp\\Vidaro\\j1' };
    assert.equal(tempReserve({ ...base, extension: '.mp4' }), tempReserve({ ...base, extension: 'mp4' }));
    assert.equal(tempReserve(base), tempReserve({ ...base, extension: 'mp4' }) + 4);
  });

  test('handles trailing separators and rejects relative folders', () => {
    assert.equal(tempReserve({ folder: 'D:\\', tempDir: 'C:\\T\\' }), tempReserve({ folder: 'D:\\', tempDir: 'C:\\T' }));
    assert.throws(() => tempReserve({ folder: 'V', tempDir: 'C:\\T' }), TypeError);
    assert.throws(() => tempReserve({ folder: 'D:\\V' }), TypeError);
    assert.throws(() => tempReserve(), TypeError);
  });
});

describe('module boundaries', () => {
  test('downloader modules load without Electron', () => {
    for (const name of ['args', 'progress', 'errors', 'info', 'templates', 'versions']) require(`../src/main/downloader/${name}`);
    require('../src/main/fsnames');
    assert.ok(!Object.keys(require.cache).some((key) => /[\\/]node_modules[\\/]electron[\\/]/.test(key)));
  });
});
