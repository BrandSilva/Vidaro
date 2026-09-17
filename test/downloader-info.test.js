const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeInfo, availableHeights, sizeEstimates, heightClass, parseInfoOutput, urlKind, HEIGHT_LADDER } = require('../src/main/downloader/info');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

const SUMMARY_KEYS = [
  'ageLimit',
  'autoSubtitles',
  'availability',
  'channel',
  'chapters',
  'drm',
  'duration',
  'entries',
  'extractor',
  'filesizeApprox',
  'hasAudio',
  'hasVideo',
  'heights',
  'id',
  'isLive',
  'kind',
  'liveStatus',
  'playlistCount',
  'playlistIndex',
  'playlistTitle',
  'site',
  'sizes',
  'subtitles',
  'thumbnail',
  'title',
  'uploadDate',
  'url',
  'webpageUrl'
];

describe('summarizeInfo with a real YouTube video', () => {
  const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  const summary = summarizeInfo(load('info-youtube-video.json'), url);

  test('has the contract shape', () => {
    assert.deepEqual(Object.keys(summary).sort(), SUMMARY_KEYS);
  });

  test('describes the video', () => {
    assert.equal(summary.kind, 'video');
    assert.equal(summary.id, 'aqz-KE-bpKQ');
    assert.equal(summary.url, url);
    assert.equal(summary.webpageUrl, url);
    assert.equal(summary.title, 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
    assert.equal(summary.channel, 'Blender');
    assert.equal(summary.uploadDate, '20141110');
    assert.equal(summary.duration, 635);
    assert.equal(summary.extractor, 'youtube');
    assert.equal(summary.site, 'youtube.com');
    assert.equal(summary.availability, 'public');
    assert.equal(summary.ageLimit, 0);
  });

  test('uses the https thumbnail', () => {
    assert.equal(summary.thumbnail, 'https://i.ytimg.com/vi_webp/aqz-KE-bpKQ/maxresdefault.webp');
  });

  test('lists the real heights, without storyboards', () => {
    assert.deepEqual(summary.heights, [2160, 1440, 1080, 720, 480, 360, 240, 144]);
  });

  test('knows it has video and audio and is not live or protected', () => {
    assert.equal(summary.hasVideo, true);
    assert.equal(summary.hasAudio, true);
    assert.equal(summary.isLive, false);
    assert.equal(summary.liveStatus, 'not_live');
    assert.equal(summary.drm, false);
  });

  test('estimates the size of the default download', () => {
    assert.equal(summary.filesizeApprox, 712445280 + 10202210);
  });

  test('estimates sizes per height, preferring H.264 plus AAC', () => {
    const byHeight = Object.fromEntries(summary.sizes.map((item) => [item.height, item.bytes]));
    assert.equal(byHeight[1080], 257619653 + 10271496);
    assert.equal(byHeight[720], 150524867 + 10271496);
    assert.equal(byHeight[2160], 1362269481 + 10271496);
    assert.deepEqual(summary.sizes.map((item) => item.height), summary.heights);
  });

  test('has no playlist data', () => {
    assert.deepEqual(summary.entries, []);
    assert.equal(summary.playlistTitle, null);
    assert.equal(summary.playlistCount, null);
    assert.equal(summary.playlistIndex, null);
    assert.deepEqual(summary.subtitles, []);
    assert.equal(summary.autoSubtitles, false);
    assert.equal(summary.chapters, 0);
  });

  test('the summary is small enough to send to the window', () => {
    assert.ok(JSON.stringify(summary).length < 4096);
  });
});

describe('summarizeInfo with a real flat playlist', () => {
  const url = 'https://www.youtube.com/playlist?list=PLa1F2ddGya_86Vmu2clTpAfBvBWnfLc9s';
  const summary = summarizeInfo(load('info-youtube-playlist.json'), url);

  test('describes the playlist', () => {
    assert.equal(summary.kind, 'playlist');
    assert.equal(summary.title, 'Blender Releases');
    assert.equal(summary.playlistTitle, 'Blender Releases');
    assert.equal(summary.playlistCount, 19);
    assert.equal(summary.channel, 'Blender');
    assert.equal(summary.extractor, 'youtube:tab');
    assert.deepEqual(summary.heights, []);
    assert.equal(summary.hasVideo, null);
    assert.equal(summary.hasAudio, null);
    assert.equal(summary.filesizeApprox, null);
  });

  test('lists every entry in order', () => {
    assert.equal(summary.entries.length, 19);
    assert.deepEqual(summary.entries.map((entry) => entry.index), Array.from({ length: 19 }, (_, i) => i + 1));
    assert.deepEqual(summary.entries[0], {
      kind: 'video',
      id: 'g4OXlrxqIx0',
      url: 'https://www.youtube.com/watch?v=g4OXlrxqIx0',
      title: "What's New in Blender 5.2 LTS! Official Overview",
      duration: 2217,
      index: 1,
      thumbnail: summary.entries[0].thumbnail,
      channel: 'Blender',
      liveStatus: null,
      availability: null
    });
    assert.equal(summary.entries[18].id, 'EfF2wDXalgU');
    assert.equal(summary.entries[18].duration, 50);
  });

  test('entry thumbnails are small https images', () => {
    for (const entry of summary.entries) assert.match(entry.thumbnail, /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/hqdefault\.jpg/);
  });
});

describe('summarizeInfo with real channel data', () => {
  test('flattens channel tabs into one list', () => {
    const summary = summarizeInfo(load('info-youtube-channel.json'), 'https://www.youtube.com/@BlenderOfficial');
    assert.equal(summary.kind, 'playlist');
    assert.equal(summary.title, 'Blender');
    assert.equal(summary.entries.length, 24);
    assert.equal(summary.playlistCount, 24);
    assert.ok(summary.entries.every((entry) => entry.kind === 'video'));
    assert.ok(summary.entries.some((entry) => entry.url.startsWith('https://www.youtube.com/shorts/')));
    assert.equal(new Set(summary.entries.map((entry) => entry.id)).size, 24);
    assert.deepEqual(summary.entries.map((entry) => entry.index), Array.from({ length: 24 }, (_, i) => i + 1));
  });

  test('marks playlists listed on a channel', () => {
    const summary = summarizeInfo(load('info-youtube-playlists-tab.json'), 'https://www.youtube.com/@BlenderOfficial/playlists');
    assert.equal(summary.entries.length, 15);
    assert.ok(summary.entries.every((entry) => entry.kind === 'playlist'));
    assert.ok(summary.entries.every((entry) => entry.channel === null));
    assert.equal(summary.entries[0].url, 'https://www.youtube.com/playlist?list=PLa1F2ddGya_8u-HEvmfCVuS_OImW8HaLd');
  });
});

describe('summarizeInfo with a real non-YouTube source', () => {
  const summary = summarizeInfo(load('info-archive-org.json'), 'https://archive.org/details/BigBuckBunny_124');

  test('handles formats without codec information', () => {
    assert.equal(summary.kind, 'video');
    assert.deepEqual(summary.heights, [720, 360]);
    assert.equal(summary.hasVideo, true);
    assert.equal(summary.hasAudio, true);
    assert.equal(summary.filesizeApprox, 332243668);
    assert.equal(summary.channel, 'jake@archive.org');
    assert.equal(summary.extractor, 'archive.org');
    assert.equal(summary.duration, 596.46);
    assert.match(summary.thumbnail, /^https:\/\/archive\.org\//);
  });
});

describe('summarizeInfo edge cases', () => {
  test('throws when there is no information', () => {
    for (const value of [null, undefined, 'null', [], 42]) assert.throws(() => summarizeInfo(value, 'https://x.com'), TypeError);
  });

  test('a minimal object still produces a full summary', () => {
    const summary = summarizeInfo({}, 'https://example.com/v');
    assert.deepEqual(Object.keys(summary).sort(), SUMMARY_KEYS);
    assert.equal(summary.kind, 'video');
    assert.equal(summary.title, null);
    assert.equal(summary.url, 'https://example.com/v');
    assert.equal(summary.hasVideo, null);
    assert.deepEqual(summary.heights, []);
  });

  test('ignores unsafe or wrong typed values', () => {
    const summary = summarizeInfo(
      {
        id: 42,
        title: '   ',
        fulltitle: 'Full title',
        channel: { name: 'x' },
        uploader: 'Uploader',
        upload_date: '2020-01-01',
        release_date: '20200102',
        duration: -5,
        thumbnail: 'javascript:alert(1)',
        thumbnails: [{ url: 'http://insecure.example/a.jpg' }, { url: 'https://ok.example/b.jpg', preference: -5 }, { url: 'https://ok.example/c.jpg', preference: 1 }],
        webpage_url: 'file:///C:/x',
        original_url: 'https://example.com/original',
        age_limit: 18
      },
      'not a url'
    );
    assert.equal(summary.id, null);
    assert.equal(summary.title, 'Full title');
    assert.equal(summary.channel, 'Uploader');
    assert.equal(summary.uploadDate, '20200102');
    assert.equal(summary.duration, null);
    assert.equal(summary.thumbnail, 'https://ok.example/c.jpg');
    assert.equal(summary.url, 'https://example.com/original');
    assert.equal(summary.webpageUrl, 'https://example.com/original');
    assert.equal(summary.ageLimit, 18);
  });

  test('live streams are flagged', () => {
    assert.equal(summarizeInfo({ is_live: true }, 'https://x.com').isLive, true);
    const upcoming = summarizeInfo({ live_status: 'is_upcoming' }, 'https://x.com');
    assert.equal(upcoming.isLive, false);
    assert.equal(upcoming.liveStatus, 'is_upcoming');
    assert.equal(summarizeInfo({ live_status: 'is_live' }, 'https://x.com').isLive, true);
  });

  test('DRM is flagged when every format is protected', () => {
    assert.equal(summarizeInfo({ formats: [{ has_drm: true, height: 720 }] }, 'https://x.com').drm, true);
    assert.equal(summarizeInfo({ formats: [{ has_drm: true, height: 720 }, { height: 360 }] }, 'https://x.com').drm, false);
    assert.equal(summarizeInfo({ _has_drm: true }, 'https://x.com').drm, true);
    const protectedOnly = summarizeInfo({ formats: [{ has_drm: true, height: 720, vcodec: 'avc1' }] }, 'https://x.com');
    assert.deepEqual(protectedOnly.heights, []);
    assert.equal(protectedOnly.hasVideo, false);
  });

  test('subtitle languages and chapters', () => {
    const summary = summarizeInfo(
      {
        subtitles: { en: [], 'es-419': [], live_chat: [], 'bad lang!': [] },
        automatic_captions: { fr: [] },
        chapters: [{}, {}, {}]
      },
      'https://x.com'
    );
    assert.deepEqual(summary.subtitles, ['en', 'es-419']);
    assert.equal(summary.autoSubtitles, true);
    assert.equal(summary.chapters, 3);
  });

  test('a playlist entry of a playlist video keeps its index', () => {
    const summary = summarizeInfo({ id: 'v', playlist_index: 4, playlist_count: 10, playlist_title: 'List' }, 'https://x.com');
    assert.equal(summary.playlistIndex, 4);
    assert.equal(summary.playlistCount, 10);
    assert.equal(summary.playlistTitle, 'List');
  });

  test('multi video results are playlists', () => {
    const summary = summarizeInfo({ _type: 'multi_video', title: 'Parts', entries: [{ url: 'https://x.com/1', title: 'One' }] }, 'https://x.com');
    assert.equal(summary.kind, 'playlist');
    assert.equal(summary.playlistCount, 1);
  });

  test('entries without a usable link are dropped and duplicates removed', () => {
    const summary = summarizeInfo(
      {
        _type: 'playlist',
        entries: [
          null,
          'text',
          { id: 'abcdefghijk', ie_key: 'Youtube', url: 'abcdefghijk', title: 'Id only' },
          { id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Duplicate' },
          { id: 'x', url: 'javascript:alert(1)' },
          { id: 'y', url: '/relative/path', webpage_url: 'https://site.example/y' },
          { url: 'https://site.example/z' },
          { id: 'short', ie_key: 'Youtube', url: 'short' },
          { id: 'pl', url: 'https://www.youtube.com/watch?list=PL1' }
        ]
      },
      'https://x.com'
    );
    assert.deepEqual(
      summary.entries.map((entry) => [entry.id, entry.url, entry.title, entry.kind]),
      [
        ['abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 'Id only', 'video'],
        ['y', 'https://site.example/y', 'y', 'video'],
        [null, 'https://site.example/z', 'https://site.example/z', 'video'],
        ['pl', 'https://www.youtube.com/watch?list=PL1', 'pl', 'playlist']
      ]
    );
    assert.equal(summary.playlistCount, 4);
  });

  test('only YouTube links are guessed to be playlists from their address', () => {
    const summary = summarizeInfo(
      {
        _type: 'playlist',
        entries: [
          { id: 'a', url: 'https://videos.example/watch?list=festival&id=a' },
          { id: 'b', url: 'https://videos.example/playlist' },
          { id: 'c', url: 'https://m.youtube.com/playlist?list=PLc' },
          { id: 'd', url: 'https://music.youtube.com/watch?list=PLd' }
        ]
      },
      'https://x.com'
    );
    assert.deepEqual(summary.entries.map((entry) => entry.kind), ['video', 'video', 'playlist', 'playlist']);
  });

  test('a huge playlist is capped', () => {
    const entries = Array.from({ length: 10050 }, (_, i) => ({ id: `id${i}`, url: `https://x.com/${i}` }));
    const summary = summarizeInfo({ _type: 'playlist', entries, playlist_count: 10050 }, 'https://x.com');
    assert.equal(summary.entries.length, 10000);
    assert.equal(summary.playlistCount, 10050);
  });

  test('long texts are cut', () => {
    assert.equal(summarizeInfo({ title: 'x'.repeat(5000) }, 'https://x.com').title.length, 1024);
  });
});

describe('availableHeights', () => {
  test('ignores storyboards, images, audio and protected formats', () => {
    assert.deepEqual(
      availableHeights([
        { format_note: 'storyboard', ext: 'mhtml', protocol: 'mhtml', vcodec: 'none', height: 180 },
        { ext: 'jpg', height: 1080 },
        { vcodec: 'none', acodec: 'opus', height: null },
        { vcodec: 'avc1', height: 2160, has_drm: true },
        { vcodec: 'avc1', height: 720, width: 1280 },
        null,
        'x'
      ]),
      [720]
    );
  });

  test('uses the short side so vertical and wide videos land in the right class', () => {
    assert.equal(heightClass(1080, 1920), 1080);
    assert.equal(heightClass(720, 1280), 720);
    assert.equal(heightClass(1920, 800), 1080);
    assert.equal(heightClass(1280, 536), 720);
    assert.equal(heightClass(3840, 1600), 2160);
    assert.equal(heightClass(720, 480), 480);
    assert.equal(heightClass(720, 576), 720);
    assert.equal(heightClass(960, 540), 720);
    assert.equal(heightClass(1920, 1088), 1080);
    assert.equal(heightClass(7680, 4320), 4320);
    assert.equal(heightClass(15360, 8640), 4320);
    assert.equal(heightClass(160, 90), 144);
    assert.equal(heightClass(null, 1080), 1080);
    assert.equal(heightClass(1920, null), null);
    assert.equal(heightClass(1920, 0), null);
  });

  test('dedupes and sorts from high to low', () => {
    assert.deepEqual(
      availableHeights([
        { vcodec: 'vp9', height: 360, width: 640 },
        { vcodec: 'avc1', height: 1080, width: 1920 },
        { vcodec: 'av01', height: 1080, width: 1920 },
        { vcodec: 'avc1', height: 480, width: 854 }
      ]),
      [1080, 480, 360]
    );
  });

  test('audio files without codec information are not video', () => {
    const formats = [
      { format_id: 'mp3', ext: 'mp3', video_ext: 'mp3', audio_ext: 'none', filesize: 100 },
      { format_id: 'flac', ext: 'FLAC', video_ext: 'flac', audio_ext: 'none', filesize: 300 }
    ];
    const summary = summarizeInfo({ formats }, 'https://archive.org/details/x');
    assert.equal(summary.hasVideo, false);
    assert.equal(summary.hasAudio, true);
    assert.deepEqual(summary.heights, []);
    assert.equal(summarizeInfo({ formats: [...formats, { ext: 'mp4', video_ext: 'mp4', audio_ext: 'none' }] }, 'https://x.com').hasVideo, true);
    assert.equal(summarizeInfo({ formats: [{ ext: 'mp3', height: 720 }] }, 'https://x.com').hasVideo, true);
  });

  test('handles missing lists', () => {
    assert.deepEqual(availableHeights(undefined), []);
    assert.deepEqual(availableHeights({}), []);
  });

  test('the ladder covers the quality chips', () => {
    for (const chip of [2160, 1440, 1080, 720, 480, 360]) assert.ok(HEIGHT_LADDER.includes(chip));
  });
});

describe('sizeEstimates', () => {
  test('adds the best AAC audio to video-only formats', () => {
    assert.deepEqual(
      sizeEstimates([
        { vcodec: 'none', acodec: 'opus', filesize: 900 },
        { vcodec: 'none', acodec: 'mp4a.40.2', filesize: 500 },
        { vcodec: 'vp9', acodec: 'none', height: 720, filesize: 3000 },
        { vcodec: 'avc1.4d401f', acodec: 'none', height: 720, filesize: 4000 },
        { vcodec: 'avc1', acodec: 'mp4a', height: 360, filesize_approx: 1000 },
        { vcodec: 'avc1', acodec: 'none', height: 240 }
      ]),
      [
        { height: 720, bytes: 4500 },
        { height: 360, bytes: 1000 }
      ]
    );
  });

  test('uses any audio when there is no AAC and the biggest video without H.264', () => {
    assert.deepEqual(
      sizeEstimates([
        { vcodec: 'none', acodec: 'opus', filesize: 100 },
        { vcodec: 'vp9', acodec: 'none', height: 1080, filesize: 2000 },
        { vcodec: 'av01', acodec: 'none', height: 1080, filesize: 1500 }
      ]),
      [{ height: 1080, bytes: 2100 }]
    );
  });

  test('handles missing lists', () => {
    assert.deepEqual(sizeEstimates(null), []);
  });
});

describe('parseInfoOutput', () => {
  test('parses the JSON line', () => {
    assert.deepEqual(parseInfoOutput('{"id":"x"}\n'), { id: 'x' });
    assert.deepEqual(parseInfoOutput('noise\r\n{"id":"y"}\r\n'), { id: 'y' });
  });

  test('returns null for failures', () => {
    for (const value of ['null', 'null\n', '', '   ', '{broken', '[1,2]', 'plain text', undefined, 42]) {
      assert.equal(parseInfoOutput(value), null, String(value));
    }
  });

  test('parses a real dump', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'info-archive-org.json'), 'utf8');
    assert.equal(parseInfoOutput(text).id, 'BigBuckBunny_124');
  });
});

describe('urlKind', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'video'],
    ['https://youtube.com/watch?v=aqz-KE-bpKQ&t=30', 'video'],
    ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'video'],
    ['https://www.youtube.com/shorts/Ic_GZ9LyCHU', 'video'],
    ['https://www.youtube.com/live/abcdefghijk', 'video'],
    ['https://youtu.be/aqz-KE-bpKQ', 'video'],
    ['https://youtu.be/aqz-KE-bpKQ?list=PLx', 'mixed'],
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PLx&index=2', 'mixed'],
    ['https://www.youtube.com/playlist?list=PLa1F2ddGya_86Vmu2clTpAfBvBWnfLc9s', 'playlist'],
    ['https://www.youtube.com/playlist', 'unknown'],
    ['https://www.youtube.com/@BlenderOfficial', 'channel'],
    ['https://www.youtube.com/@BlenderOfficial/videos', 'channel'],
    ['https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg', 'channel'],
    ['https://www.youtube.com/c/BlenderFoundation', 'channel'],
    ['https://www.youtube.com/user/BlenderFoundation', 'channel'],
    ['https://music.youtube.com/watch?v=abcdefghijk', 'video'],
    ['https://www.youtube.com/', 'unknown'],
    ['https://archive.org/details/BigBuckBunny_124', 'unknown'],
    ['https://vimeo.com/1084537', 'unknown'],
    ['https://evil.com/www.youtube.com/watch?v=x', 'unknown'],
    ['https://www.youtube.com/watch?list=PLa1F2ddGya_86Vmu2clTpAfBvBWnfLc9s', 'playlist'],
    ['https://www.youtube.com/watch', 'unknown'],
    ['https://youtu.be/', 'unknown'],
    ['https://youtu.be/?list=PLx', 'unknown'],
    ['ftp://www.youtube.com/watch?v=x', 'invalid'],
    ['not a link', 'invalid'],
    [null, 'invalid']
  ];

  for (const [url, kind] of cases) {
    test(`${url} is ${kind}`, () => {
      assert.equal(urlKind(url), kind);
    });
  }
});
