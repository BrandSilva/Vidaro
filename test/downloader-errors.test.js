const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mapDownloadError, meaningfulWarnings, softFailure, cleanDetail } = require('../src/main/downloader/errors');
const { ERROR_ACTIONS } = require('../src/main/errors');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/).filter(Boolean);
}

function codeOf(lines, options) {
  return mapDownloadError(lines, options).code;
}

describe('real yt-dlp failures', () => {
  test('nonexistent video id', () => {
    const result = mapDownloadError(fixture('error-video-unavailable.txt'), { exitCode: 1 });
    assert.deepEqual(result, {
      code: 'video-unavailable',
      message: 'This video is not available.',
      hint: 'Check the link. The video may have been removed.',
      action: null,
      retryable: false,
      detail: 'This video is unavailable'
    });
  });

  test('unsupported site, ignoring the warning before it', () => {
    const result = mapDownloadError(fixture('error-unsupported-url.txt'), { exitCode: 1 });
    assert.equal(result.code, 'unsupported-url');
    assert.equal(result.detail, 'Unsupported URL: https://example.com/');
    assert.equal(result.retryable, false);
  });

  test('invalid link', () => {
    const result = mapDownloadError(fixture('error-invalid-url.txt'), { exitCode: 1 });
    assert.equal(result.code, 'unsupported-url');
    assert.equal(result.detail, "'notaurl' is not a valid URL");
  });

  test('proxy refused, with a localized Windows message', () => {
    const result = mapDownloadError(fixture('error-proxy-refused.txt'), { exitCode: 1 });
    assert.equal(result.code, 'network');
    assert.equal(result.message, 'Could not connect to the proxy.');
    assert.equal(result.action, 'open-settings');
    assert.equal(result.retryable, true);
    assert.match(result.detail, /^Unable to download API page: \('Unable to connect to proxy'/);
    assert.doesNotMatch(result.detail, /caused by/);
  });

  test('DNS failure', () => {
    const result = mapDownloadError(fixture('error-dns.txt'), { exitCode: 1 });
    assert.equal(result.code, 'network');
    assert.equal(result.message, 'Could not reach the site.');
    assert.match(result.detail, /^Unable to download webpage: HTTPSConnection/);
  });

  test('expired certificate', () => {
    const result = mapDownloadError(fixture('error-ssl.txt'), { exitCode: 1 });
    assert.equal(result.code, 'network');
    assert.equal(result.message, 'A secure connection to the site could not be made.');
    assert.doesNotMatch(result.detail, /please report/);
  });

  test('connection timeout', () => {
    const result = mapDownloadError(fixture('error-timeout.txt'), { exitCode: 1 });
    assert.equal(result.code, 'network');
    assert.equal(result.message, 'The connection timed out.');
  });

  test('age restricted video asks for cookies', () => {
    const result = mapDownloadError(fixture('error-age-restricted.txt'), { exitCode: 1 });
    assert.equal(result.code, 'age-restricted');
    assert.equal(result.action, 'cookies');
    assert.equal(result.detail, 'Sign in to confirm your age.');
  });

  test('requested format missing', () => {
    const result = mapDownloadError(fixture('error-format-unavailable.txt'), { exitCode: 1 });
    assert.equal(result.code, 'format-unavailable');
    assert.equal(result.detail, 'Requested format is not available.');
    assert.equal(result.retryable, false);
  });

  test('requested format missing because no JavaScript runtime was available', () => {
    const lines = [...fixture('warning-no-js-runtime.txt'), ...fixture('error-format-unavailable.txt')];
    const result = mapDownloadError(lines, { exitCode: 1 });
    assert.equal(result.code, 'no-js-runtime');
    assert.equal(result.action, 'update-ytdlp');
    assert.equal(result.detail, 'Requested format is not available.');
  });

  test('browser without a cookie database', () => {
    const result = mapDownloadError(fixture('error-cookies-browser-missing.txt'), { exitCode: 1 });
    assert.equal(result.code, 'cookies-missing');
    assert.equal(result.action, 'cookies');
  });

  test('missing web page', () => {
    const result = mapDownloadError(fixture('error-http-404.txt'), { exitCode: 1 });
    assert.equal(result.code, 'video-unavailable');
    assert.equal(result.detail, 'Unable to download webpage: HTTP Error 404: Not Found');
  });

  test('write denied when moving the finished file', () => {
    const result = mapDownloadError(fixture('error-access-denied.txt'), { exitCode: 1 });
    assert.equal(result.code, 'access-denied');
    assert.equal(result.message, 'Vidaro could not write the file.');
    assert.match(result.detail, /^\[Errno 13\] Permission denied/);
  });

  test('ffmpeg missing when two streams must be merged', () => {
    const result = mapDownloadError(fixture('error-ffmpeg-missing-merge.txt'), { exitCode: 1 });
    assert.equal(result.code, 'ffmpeg-missing');
    assert.equal(result.retryable, false);
    assert.equal(result.detail, 'You have requested merging of multiple formats but ffmpeg is not installed');
  });

  test('ffmpeg missing for a time range', () => {
    const result = mapDownloadError(fixture('error-ffmpeg-missing-section.txt'), { exitCode: 1 });
    assert.equal(result.code, 'ffmpeg-missing');
    assert.equal(result.detail, 'You have requested downloading the video partially, but ffmpeg is not installed');
  });

  test('a channel that does not exist', () => {
    const result = mapDownloadError(fixture('error-channel-missing.txt'), { exitCode: 1 });
    assert.equal(result.code, 'video-unavailable');
    assert.equal(result.retryable, false);
    assert.equal(result.detail, 'Unable to download API page: HTTP Error 404: Not Found');
  });

  test('a playlist that does not exist', () => {
    const result = mapDownloadError(fixture('error-playlist-missing.txt'), { exitCode: 1 });
    assert.equal(result.code, 'video-unavailable');
    assert.equal(result.detail, 'YouTube said: The playlist does not exist.');
  });

  test('a cookies file in the wrong format', () => {
    const result = mapDownloadError(fixture('error-cookies-file-invalid.txt'), { exitCode: 1 });
    assert.equal(result.code, 'cookies-missing');
    assert.equal(result.action, 'cookies');
    assert.equal(result.retryable, false);
  });

  test('SponsorBlock unreachable', () => {
    const lines = fixture('progress-sponsorblock-down.txt');
    const result = mapDownloadError(lines, { exitCode: 1 });
    assert.equal(result.code, 'sponsorblock-failed');
    assert.equal(result.retryable, true);
    assert.equal(result.action, null);
    assert.match(result.detail, /^Preprocessing: Unable to communicate with SponsorBlock API/);
    assert.equal(softFailure(lines), 'sponsorblock-failed');
    assert.ok(meaningfulWarnings(lines).includes('sponsorblock-failed'));
  });

  test('a real failure after a SponsorBlock problem is the one reported', () => {
    const lines = [
      ...fixture('progress-sponsorblock-down.txt'),
      'ERROR: unable to write data: [Errno 28] No space left on device'
    ];
    const result = mapDownloadError(lines, { exitCode: 1 });
    assert.equal(result.code, 'disk-full');
    assert.equal(result.detail, 'unable to write data: [Errno 28] No space left on device');
    assert.equal(softFailure(lines), null);
    const network = mapDownloadError(['ERROR: Preprocessing: Unable to communicate with SponsorBlock API: timed out', 'ERROR: unable to download video data: HTTP Error 403: Forbidden']);
    assert.equal(network.code, 'http-403');
  });

  test('the full stream of a failed download maps the same way', () => {
    assert.equal(codeOf(fixture('progress-access-denied.txt'), { exitCode: 1 }), 'access-denied');
  });

  test('a warning alone is never an error', () => {
    const result = mapDownloadError(fixture('warning-no-js-runtime.txt'), { exitCode: 1 });
    assert.equal(result.code, 'no-js-runtime');
    const plain = mapDownloadError(['WARNING: [generic] Falling back on generic information extractor'], { exitCode: 1 });
    assert.equal(plain.code, 'unknown');
    assert.equal(plain.detail, null);
  });
});

describe('known yt-dlp messages', () => {
  const cases = [
    ['private-video', "ERROR: [youtube] abcdefghijk: Private video. Sign in if you've been granted access to this video. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies"],
    ['private-video', 'ERROR: [youtube] abcdefghijk: Video unavailable. This video is private'],
    ['members-only', "ERROR: [youtube] abcdefghijk: This video is available to this channel's members on level: Tier 1 (or any higher level). Join this channel to get access to members-only content and other exclusive perks."],
    ['members-only', 'ERROR: [youtube] abcdefghijk: Join this channel to get access to members-only content like this video, and other exclusive perks.'],
    ['age-restricted', 'ERROR: [youtube] abcdefghijk: Sign in to confirm your age. This video may be inappropriate for some users.'],
    ['bot-check', "ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies."],
    ['bot-check', "ERROR: [youtube] abcdefghijk: Sign in to confirm you're not a bot"],
    ['login-required', 'ERROR: [vimeo] 123456: This video is only available for registered users. Use --cookies-from-browser or --cookies for the authentication.'],
    ['login-required', 'ERROR: [instagram] Cx1: Requested content is not available, rate-limit reached or login required. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (instagram) to provide account credentials'],
    ['geo-blocked', 'ERROR: [youtube] abcdefghijk: The uploader has not made this video available in your country. You might want to use a VPN or a proxy server (with --proxy) to workaround.'],
    ['geo-blocked', 'ERROR: [BBC] p0abc: This video is not available from your location due to geo restriction'],
    ['geo-blocked', 'ERROR: [niconico] sm9: Sorry, this video is not available in your region'],
    ['live-not-started', 'ERROR: [youtube] abcdefghijk: This live event will begin in 3 hours.'],
    ['live-not-started', 'ERROR: [youtube] abcdefghijk: Premieres in 2 days'],
    ['drm-protected', 'ERROR: [youtube] abcdefghijk: This video is DRM protected'],
    ['drm-protected', 'ERROR: The requested site is known to use DRM protection. It will NOT be supported.'],
    ['video-unavailable', 'ERROR: [youtube] abcdefghijk: Video unavailable. This video has been removed by the uploader'],
    ['video-unavailable', "ERROR: [youtube] abcdefghijk: Video unavailable. This content isn't available."],
    ['video-unavailable', 'ERROR: [youtube:tab] UCx: This channel does not exist.'],
    ['http-403', 'ERROR: unable to download video data: HTTP Error 403: Forbidden'],
    ['rate-limited', 'ERROR: [youtube] abcdefghijk: Unable to download API page: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)'],
    ['disk-full', 'ERROR: unable to write data: [Errno 28] No space left on device'],
    ['path-too-long', "ERROR: unable to open for writing: [WinError 206] El nombre del archivo o la extensión es demasiado largo: 'C:\\\\x'"],
    ['access-denied', "ERROR: Unable to rename file: [WinError 32] El proceso no tiene acceso al archivo porque está siendo utilizado por otro proceso: 'a.part' -> 'a.mp4'"],
    ['access-denied', "ERROR: unable to open for writing: [WinError 5] Acceso denegado: 'C:\\\\Program Files\\\\x.part'"],
    ['write-failed', "ERROR: unable to open for writing: [Errno 2] No such file or directory: 'Z:\\\\Videos\\\\x.mp4.part'"],
    ['cookies-locked', 'ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info'],
    ['cookies-locked', 'ERROR: Failed to decrypt with DPAPI. See  https://github.com/yt-dlp/yt-dlp/issues/10927  for more info'],
    ['cookies-missing', "ERROR: 'C:\\\\cookies.txt' does not look like a Netscape format cookies file"],
    ['challenge-failed', 'ERROR: [youtube] abcdefghijk: Signature extraction failed: Some formats may be missing'],
    ['challenge-failed', 'ERROR: [youtube] abcdefghijk: Failed to extract any player response; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U'],
    ['extractor-error', 'ERROR: [youtube] abcdefghijk: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U'],
    ['extractor-error', 'ERROR: [twitter] 123: Unable to extract guest token; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q='],
    ['extractor-error', "ERROR: [generic] Unable to download JSON metadata: KeyError('streams')"],
    ['ffmpeg-missing', 'ERROR: You have requested merging of multiple formats but ffmpeg is not installed. Aborting due to --abort-on-error'],
    ['ffmpeg-missing', 'ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location'],
    ['postprocessing-failed', 'ERROR: Postprocessing: Conversion failed!'],
    ['postprocessing-failed', 'ERROR: Postprocessing: Error opening output files: Invalid argument'],
    ['download-interrupted', 'ERROR: fragment 12 not found, unable to continue'],
    ['download-interrupted', 'ERROR: Did not get any data blocks'],
    ['network', 'ERROR: unable to download video data: <urlopen error [WinError 10054] Se ha forzado la interrupción de una conexión existente por el host remoto>'],
    ['network', "ERROR: [youtube] abcdefghijk: Unable to download webpage: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))"],
    ['network', 'ERROR: [youtube] abcdefghijk: Unable to download API page: [Errno 11001] getaddrinfo failed'],
    ['unsupported-url', 'ERROR: [generic] Unable to recognize the URL'],
    ['members-only', 'ERROR: [youtube] abcdefghijk: This video requires payment to watch.'],
    ['video-unavailable', 'ERROR: [youtube] abcdefghijk: This live stream recording is not available.'],
    ['video-unavailable', 'ERROR: [youtube:tab] PLx: This playlist type is unviewable.'],
    ['extractor-error', 'ERROR: [youtube] abcdefghijk: The following content is not available on this app.. Watch on the latest version of YouTube.'],
    ['subtitles-failed', "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"],
    ['sponsorblock-failed', 'ERROR: Postprocessing: Unable to communicate with SponsorBlock API: The read operation timed out'],
    ['ytdlp-broken', '[PYI-1234:ERROR] Failed to extract python310.dll: decompression resulted in return code -1!'],
    ['ytdlp-broken', 'Traceback (most recent call last):\nModuleNotFoundError: No module named yt_dlp'],
    ['bad-options', 'Usage: yt-dlp.exe [OPTIONS] URL [URL...]\n\nyt-dlp.exe: error: no such option: --made-up-option']
  ];

  for (const [code, text] of cases) {
    test(`${code}: ${text.slice(0, 70)}`, () => {
      assert.equal(codeOf(text.split('\n'), { exitCode: 1 }), code);
    });
  }

  test('every result is shaped for JobError', () => {
    for (const [, text] of cases) {
      const result = mapDownloadError(text, { exitCode: 1 });
      assert.deepEqual(Object.keys(result).sort(), ['action', 'code', 'detail', 'hint', 'message', 'retryable']);
      assert.match(result.code, /^[a-z][a-z0-9-]{0,63}$/);
      assert.ok(result.message.length > 0 && result.message.length <= 500);
      assert.ok(result.hint === null || result.hint.length <= 500);
      assert.ok(result.action === null || ERROR_ACTIONS.includes(result.action), result.action);
      assert.equal(typeof result.retryable, 'boolean');
    }
  });

  test('update-ytdlp is offered for site breakage', () => {
    for (const code of ['http-403', 'challenge-failed', 'extractor-error']) {
      const [, text] = cases.find(([name]) => name === code);
      assert.equal(mapDownloadError(text).action, 'update-ytdlp', code);
    }
  });

  test('cookie problems point to the cookie settings', () => {
    for (const code of ['private-video', 'members-only', 'age-restricted', 'bot-check', 'login-required', 'cookies-locked']) {
      const [, text] = cases.find(([name]) => name === code);
      assert.equal(mapDownloadError(text).action, 'cookies', code);
    }
  });
});

describe('context and edge cases', () => {
  test('an n challenge warning turns a missing format into a challenge failure', () => {
    const result = mapDownloadError([
      'WARNING: [youtube] abcdefghijk: n challenge solving failed: Some formats may be missing. Ensure you have a supported JavaScript runtime and challenge solver script distribution installed.',
      'ERROR: [youtube] abcdefghijk: Requested format is not available. Use --list-formats for a list of available formats'
    ]);
    assert.equal(result.code, 'challenge-failed');
  });

  test('a PO token warning turns a 403 into a challenge failure', () => {
    const result = mapDownloadError([
      'WARNING: [youtube] abcdefghijk: Some web client https formats have been skipped as they are missing a url. YouTube is forcing SABR streaming for this client.',
      'ERROR: unable to download video data: HTTP Error 403: Forbidden'
    ]);
    assert.equal(result.code, 'challenge-failed');
  });

  test('specific errors are not overridden by warnings', () => {
    const result = mapDownloadError([...fixture('warning-no-js-runtime.txt'), ...fixture('error-video-unavailable.txt')]);
    assert.equal(result.code, 'video-unavailable');
  });

  test('the last error is used for the detail', () => {
    const result = mapDownloadError(['ERROR: first problem', 'ERROR: [youtube] abc: second problem']);
    assert.equal(result.detail, 'second problem');
  });

  test('without errors the last meaningful line is the detail', () => {
    const result = mapDownloadError(['VIDARO-PP {"status":"started"}', 'frame=10', 'Something odd happened', 'WARNING: ignored'], { exitCode: 3221225477 });
    assert.equal(result.code, 'unknown');
    assert.equal(result.detail, 'Something odd happened');
    assert.equal(result.retryable, true);
  });

  test('exit code 2 without output means rejected options', () => {
    assert.equal(codeOf([], { exitCode: 2 }), 'bad-options');
    assert.equal(codeOf([], { exitCode: 1 }), 'unknown');
    assert.equal(codeOf(['ERROR: [youtube] abc: Video unavailable'], { exitCode: 2 }), 'video-unavailable');
  });

  test('accepts text, arrays with junk and nothing at all', () => {
    assert.equal(codeOf('WARNING: x\nERROR: HTTP Error 429: Too Many Requests'), 'rate-limited');
    assert.equal(codeOf([null, 42, 'ERROR: [Errno 28] No space left on device']), 'disk-full');
    assert.deepEqual(mapDownloadError(undefined), {
      code: 'unknown',
      message: 'The download failed.',
      hint: 'Retry. If it keeps failing, update yt-dlp.',
      action: null,
      retryable: true,
      detail: null
    });
    assert.equal(codeOf({}), 'unknown');
  });

  test('WARNING lines never decide the code on their own', () => {
    assert.equal(codeOf(['WARNING: HTTP Error 403: Forbidden. Retrying (1/10)...', 'ERROR: [Errno 28] No space left on device']), 'disk-full');
    assert.equal(codeOf(['WARNING: [youtube] Private video']), 'unknown');
  });

  test('long details are shortened', () => {
    const result = mapDownloadError([`ERROR: ${'x'.repeat(2000)}`]);
    assert.equal(result.detail.length, 500);
    assert.ok(result.detail.endsWith('…'));
  });
});

describe('cleanDetail', () => {
  test('removes the prefix, the site and the id', () => {
    assert.equal(cleanDetail('ERROR: [youtube] aqz-KE-bpKQ: Video unavailable'), 'Video unavailable');
    assert.equal(cleanDetail('ERROR: [youtube:tab] UCx: This channel does not exist.'), 'This channel does not exist.');
  });

  test('keeps messages without a site prefix whole', () => {
    assert.equal(cleanDetail('ERROR: Unsupported URL: https://example.com/'), 'Unsupported URL: https://example.com/');
    assert.equal(cleanDetail('ERROR: unable to download video data: HTTP Error 403: Forbidden'), 'unable to download video data: HTTP Error 403: Forbidden');
  });

  test('drops command line advice', () => {
    assert.equal(cleanDetail('ERROR: [x] y: Requested format is not available. Use --list-formats for a list of available formats'), 'Requested format is not available.');
  });
});

describe('softFailure', () => {
  test('only SponsorBlock problems are soft', () => {
    assert.equal(softFailure(['ERROR: Postprocessing: Unable to communicate with SponsorBlock API: timed out']), 'sponsorblock-failed');
    assert.equal(softFailure('WARNING: x\nERROR: Preprocessing: Unable to communicate with SponsorBlock API: refused'), 'sponsorblock-failed');
    assert.equal(softFailure(['ERROR: [youtube] abc: Video unavailable']), null);
    assert.equal(softFailure(['ERROR: [youtube] abc: SponsorBlock API is great but this video is private']), null);
    assert.equal(softFailure(['WARNING: Unable to communicate with SponsorBlock API']), null);
    assert.equal(softFailure([]), null);
    assert.equal(softFailure(undefined), null);
  });
});

describe('meaningfulWarnings', () => {
  test('reduces warnings to codes', () => {
    assert.deepEqual(
      meaningfulWarnings([
        ...fixture('warning-no-js-runtime.txt'),
        'WARNING: There are no subtitles for the requested languages',
        'WARNING: Unable to communicate with SponsorBlock API: timed out',
        'WARNING: Unable to download thumbnail: HTTP Error 404',
        'WARNING: [generic] Falling back on generic information extractor',
        'WARNING: There are no subtitles for the requested languages',
        'ERROR: not a warning'
      ]),
      ['no-js-runtime', 'no-subtitles', 'sponsorblock-failed', 'thumbnail-failed']
    );
  });

  test('handles empty input', () => {
    assert.deepEqual(meaningfulWarnings(), []);
    assert.deepEqual(meaningfulWarnings('WARNING: n challenge solving failed'), ['challenge-failed']);
  });
});
