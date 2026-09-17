const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDownloadJobs, normalizeOptions, suggestName, suggestNames, OPTION_DEFAULTS } = require('../src/main/downloader/jobs');
const { summarizeInfo } = require('../src/main/downloader/info');
const settings = require('../src/main/settings');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const FOLDER = 'C:\\Users\\User\\Videos\\Vidaro';
const PRESET = { id: 'flowair-720p', name: 'FlowAir Ready 720p', container: 'mp4', builtIn: true, video: { mode: 'encode' } };

function summary(name) {
  const json = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  return summarizeInfo(json, json.webpage_url);
}

function request(overrides = {}) {
  return {
    items: [{ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', info: { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny', duration: 635 }, name: 'Big Buck Bunny' }],
    options: {},
    output: { folder: FOLDER, collision: 'rename' },
    ...overrides
  };
}

describe('buildDownloadJobs', () => {
  test('builds one queue input per item with the download spec', () => {
    const info = summary('info-youtube-video.json');
    const [input] = buildDownloadJobs(request({ items: [{ url: info.url, info, name: 'My video' }] }));
    assert.equal(input.kind, 'download');
    assert.equal(input.title, 'My video');
    assert.equal(input.groupId, undefined);
    assert.equal(input.spec.url, info.url);
    assert.deepEqual(Object.keys(input.spec).sort(), ['after', 'info', 'options', 'output', 'url']);
    assert.deepEqual(input.spec.output, { folder: FOLDER, name: 'My video', collision: 'rename' });
    assert.equal(input.spec.after, null);
    assert.deepEqual(Object.keys(input.spec.info).sort(), ['channel', 'duration', 'extractor', 'id', 'playlistIndex', 'thumbnail', 'title', 'webpageUrl']);
    assert.equal(input.spec.info.title, info.title);
    assert.equal(input.spec.info.duration, info.duration);
    assert.ok(input.spec.info.thumbnail.startsWith('https://'));
    assert.deepEqual(input.spec.options, OPTION_DEFAULTS);
  });

  test('option defaults match the settings defaults', () => {
    const download = settings.defaults().download;
    for (const [key, value] of Object.entries(OPTION_DEFAULTS)) {
      if (key === 'section') continue;
      assert.deepEqual(value, download[key], key);
    }
  });

  test('ignores unknown option keys and keeps known ones', () => {
    const [input] = buildDownloadJobs(
      request({
        options: {
          ...settings.defaults().download,
          mode: 'audio',
          audioFormat: 'm4a',
          quality: 720,
          sponsorBlock: true,
          rateLimit: ' 2M ',
          concurrentFragments: 8,
          section: { start: 10, end: 15.5 },
          folder: 'D:\\ignored',
          evil: '$(rm)'
        }
      })
    );
    const options = input.spec.options;
    assert.equal(options.mode, 'audio');
    assert.equal(options.audioFormat, 'm4a');
    assert.equal(options.quality, '720');
    assert.equal(options.sponsorBlock, true);
    assert.equal(options.rateLimit, '2M');
    assert.equal(options.concurrentFragments, 8);
    assert.deepEqual(options.section, { start: 10, end: 15.5 });
    assert.equal('folder' in options, false);
    assert.equal('evil' in options, false);
  });

  test('a section covering the whole video is no section', () => {
    assert.equal(normalizeOptions({ section: { start: 0, end: null } }).section, null);
    assert.deepEqual(normalizeOptions({ section: { end: 5 } }).section, { start: 0, end: 5 });
  });

  test('rejects options that yt-dlp would not accept', () => {
    const bad = [
      { mode: 'both' },
      { quality: '4320' },
      { container: 'avi' },
      { audioFormat: 'aac' },
      { audioQuality: '64' },
      { rateLimit: 'fast' },
      { rateLimit: 10 },
      { concurrentFragments: 0 },
      { concurrentFragments: '4' },
      { subtitles: true, subtitleLangs: 'en;rm' },
      { cookiesMode: 'magic' },
      { cookiesMode: 'browser', cookiesBrowser: 'netscape' },
      { cookiesMode: 'file', cookiesFile: '' },
      { cookiesMode: 'file', cookiesFile: 'cookies.txt' },
      { proxy: 'ftp://proxy:21' },
      { section: { start: 10, end: 5 } },
      { section: { start: -1 } },
      { section: 'all' }
    ];
    for (const options of bad) assert.throws(() => buildDownloadJobs(request({ options })), TypeError, JSON.stringify(options));
  });

  test('keeps the cookies file only in file mode', () => {
    const file = 'C:\\Users\\User\\Documents\\cookies.txt';
    assert.equal(buildDownloadJobs(request({ options: { cookiesMode: 'file', cookiesFile: file } }))[0].spec.options.cookiesFile, file);
    assert.equal(buildDownloadJobs(request({ options: { cookiesMode: 'none', cookiesFile: file } }))[0].spec.options.cookiesFile, '');
  });

  test('sanitizes names and falls back to the title', () => {
    const items = [
      { url: 'https://example.com/a', info: { title: 'A: B / C?' }, name: 'CON' },
      { url: 'https://example.com/b', info: { title: 'Title: two' }, name: '   ' },
      { url: 'https://example.com/c', info: { id: 'xyz' } },
      { url: 'https://example.com/d', info: null, name: 'Trailing dots...' }
    ];
    const names = buildDownloadJobs(request({ items })).map((input) => input.spec.output.name);
    assert.deepEqual(names, ['_CON', 'Title： two', 'xyz', 'Trailing dots']);
  });

  test('gives repeated names in one batch their own suffix', () => {
    const items = ['Clip', 'clip', 'Clip', 'Clip (2)'].map((name, index) => ({ url: `https://example.com/${index}`, info: {}, name }));
    const names = buildDownloadJobs(request({ items })).map((input) => input.title);
    assert.deepEqual(names, ['Clip', 'clip (2)', 'Clip (3)', 'Clip (2) (2)']);
  });

  test('groups playlist items', () => {
    const playlist = summary('info-youtube-playlist.json');
    const items = playlist.entries.slice(0, 3).map((entry) => ({ url: entry.url, info: entry, name: entry.title }));
    const inputs = buildDownloadJobs(request({ items, group: { title: playlist.title } }), { makeGroupId: () => 'g-test' });
    assert.equal(inputs.length, 3);
    for (const input of inputs) {
      assert.equal(input.groupId, 'g-test');
      assert.equal(input.groupTitle, 'Blender Releases');
    }
    assert.deepEqual(
      inputs.map((input) => input.spec.info.playlistIndex),
      [1, 2, 3]
    );
    assert.equal(inputs[0].spec.info.channel, 'Blender');
  });

  test('uses a random group id by default', () => {
    const items = [{ url: 'https://example.com/a', info: {}, name: 'a' }];
    const first = buildDownloadJobs(request({ items, group: { title: '' } }))[0];
    const second = buildDownloadJobs(request({ items, group: { title: 'x' } }))[0];
    assert.match(first.groupId, /^g[a-z0-9]+$/);
    assert.notEqual(first.groupId, second.groupId);
    assert.equal(first.groupTitle, undefined);
  });

  test('refuses entries that are playlists themselves', () => {
    const tab = summary('info-youtube-playlists-tab.json');
    const entry = tab.entries[0];
    assert.equal(entry.kind, 'playlist');
    assert.throws(() => buildDownloadJobs(request({ items: [{ url: entry.url, info: entry, name: entry.title }] })), /Open the playlist/);
  });

  test('keeps a preset snapshot for the conversion after download', () => {
    const [input] = buildDownloadJobs(request({ after: { preset: PRESET, keepOriginal: false } }));
    assert.deepEqual(input.spec.after, { preset: PRESET, keepOriginal: false });
    assert.notEqual(input.spec.after.preset, PRESET);
    assert.equal(buildDownloadJobs(request({ after: { preset: PRESET } }))[0].spec.after.keepOriginal, true);
    assert.throws(() => buildDownloadJobs(request({ after: { preset: { id: 'x' } } })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ after: 'mp4' })), TypeError);
  });

  test('drops unsafe info fields', () => {
    const [input] = buildDownloadJobs(
      request({
        items: [
          {
            url: 'https://example.com/v',
            info: { title: 'x'.repeat(5000), thumbnail: 'http://insecure/thumb.jpg', webpageUrl: 'javascript:alert(1)', duration: -5, index: 2.5 },
            name: 'v'
          }
        ]
      })
    );
    assert.equal(input.spec.info.title.length, 1024);
    assert.equal(input.spec.info.thumbnail, null);
    assert.equal(input.spec.info.webpageUrl, 'https://example.com/v');
    assert.equal(input.spec.info.duration, null);
    assert.equal(input.spec.info.playlistIndex, null);
  });

  test('validates the request shape', () => {
    assert.throws(() => buildDownloadJobs(request({ items: [] })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ items: 'x' })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ items: [null] })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ items: [{ url: 'file:///C:/x.mp4', info: {} }] })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ items: [{ url: 'notaurl', info: {} }] })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ output: { folder: 'Videos', collision: 'rename' } })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ output: { folder: FOLDER, collision: 'merge' } })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ output: null })), TypeError);
    assert.throws(() => buildDownloadJobs(request({ options: [] })), TypeError);
    assert.throws(() => buildDownloadJobs(), TypeError);
    const many = Array.from({ length: 5001 }, (_, i) => ({ url: `https://example.com/${i}`, info: {}, name: String(i) }));
    assert.throws(() => buildDownloadJobs(request({ items: many })), /Too many/);
  });

  test('normalizes the folder and defaults the collision policy', () => {
    const [input] = buildDownloadJobs(request({ output: { folder: 'D:/Media//Clips/' } }));
    assert.deepEqual(input.spec.output, { folder: 'D:\\Media\\Clips\\', name: 'Big Buck Bunny', collision: 'rename' });
  });
});

describe('suggestName', () => {
  const info = summary('info-youtube-video.json');

  test('renders the built-in templates', () => {
    assert.equal(suggestName({ info, template: 'title' }), info.title);
    assert.equal(suggestName({ info, template: 'channel-title' }), `${info.channel} - ${info.title}`);
    assert.match(suggestName({ info, template: 'date-title' }), /^\d{4}-\d{2}-\d{2} - /);
    assert.equal(suggestName({ info, template: 'title-id' }), `${info.title} [${info.id}]`);
  });

  test('renders a custom template and falls back on bad input', () => {
    assert.equal(suggestName({ info, template: 'custom', custom: '%(channel)s_%(id)s.%(ext)s' }), `${info.channel}_${info.id}`);
    assert.equal(suggestName({ info, template: 'custom', custom: '' }), info.title);
    assert.equal(suggestName({ info, template: 'nope' }), info.title);
    assert.equal(suggestName({ info: null, template: 'title' }), 'NA');
  });

  test('numbers playlist entries', () => {
    assert.equal(suggestName({ info: { title: 'Intro' }, template: 'title', index: 7, count: 12 }), '007 - Intro');
    assert.equal(suggestName({ info: { title: 'Intro' }, template: 'title', index: 7, count: 1500 }), '0007 - Intro');
    assert.equal(suggestName({ info: { title: 'Intro' }, template: 'title', index: 0 }), 'Intro');
  });

  test('names a whole list at once', () => {
    const playlist = summary('info-youtube-playlist.json');
    const items = playlist.entries.slice(0, 2).map((entry) => ({ info: entry, index: entry.index }));
    assert.deepEqual(suggestNames({ template: 'title', numbered: true, count: playlist.playlistCount, items }), [
      `001 - ${playlist.entries[0].title}`,
      `002 - ${playlist.entries[1].title}`
    ]);
    assert.deepEqual(suggestNames({ template: 'title', items }), [playlist.entries[0].title, playlist.entries[1].title]);
    assert.equal(suggestNames({ info, template: 'title' }), info.title);
    assert.throws(() => suggestNames('x'), TypeError);
  });
});
