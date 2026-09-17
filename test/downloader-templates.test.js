const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  NAME_TEMPLATES,
  renderTemplate,
  renderRaw,
  templateFor,
  fieldsFromInfo,
  applyNumbering,
  ytDlpLiteral
} = require('../src/main/downloader/templates');

const info = {
  kind: 'video',
  id: 'aqz-KE-bpKQ',
  url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  webpageUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
  channel: 'Blender',
  uploadDate: '20141110',
  duration: 635,
  extractor: 'youtube'
};

const entry = { id: 'EfF2wDXalgU', title: 'Blender 2.82 - Features Showcase', duration: 50, playlistIndex: 7, playlistCount: 19, playlistTitle: 'Blender Releases' };

describe('NAME_TEMPLATES', () => {
  test('has every id the settings allow', () => {
    assert.deepEqual(Object.keys(NAME_TEMPLATES), ['title', 'channel-title', 'date-title', 'title-id', 'custom']);
  });

  test('is frozen', () => {
    assert.equal(Object.isFrozen(NAME_TEMPLATES), true);
  });
});

describe('renderTemplate built-ins', () => {
  test('title', () => {
    assert.equal(renderTemplate('title', info), 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
  });

  test('channel - title', () => {
    assert.equal(renderTemplate('channel-title', info), 'Blender - Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
  });

  test('date - title', () => {
    assert.equal(renderTemplate('date-title', info), '2014-11-10 - Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
  });

  test('title [id]', () => {
    assert.equal(renderTemplate('title-id', info), 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film [aqz-KE-bpKQ]');
  });

  test('channel and date parts disappear when a flat playlist entry lacks them', () => {
    assert.equal(renderTemplate('channel-title', entry), 'Blender 2.82 - Features Showcase');
    assert.equal(renderTemplate('date-title', entry), 'Blender 2.82 - Features Showcase');
  });

  test('uploader is used when there is no channel', () => {
    assert.equal(renderTemplate('channel-title', { title: 'Clip', uploader: 'jake@archive.org' }), 'jake@archive.org - Clip');
  });

  test('the result is sanitized for Windows', () => {
    const tricky = { ...info, title: 'AC/DC: "Live" | 1979?', channel: 'CON' };
    assert.equal(renderTemplate('title', tricky), 'AC⧸DC： ＂Live＂ ｜ 1979？');
    assert.equal(renderTemplate('title', { title: 'NUL' }), '_NUL');
    assert.equal(renderTemplate('channel-title', { title: 'x.', channel: 'CON' }), 'CON - x');
  });

  test('keeps emoji and accents', () => {
    assert.equal(renderTemplate('title', { title: 'Canción 🎬 – Año 2026 100%' }), 'Canción 🎬 – Año 2026 100%');
  });

  test('a missing title falls back to the id, then to download', () => {
    assert.equal(renderTemplate('title', { id: 'abc123' }), 'abc123');
    assert.equal(renderTemplate('title', { id: 'abc123', title: '   ' }), 'abc123');
    assert.equal(renderTemplate('title', { title: '...' }), 'download');
    assert.equal(renderTemplate('title-id', {}), 'NA [NA]');
  });

  test('an empty rendering falls back to a sanitized title or id', () => {
    assert.equal(renderTemplate('custom', { id: 'abc123' }, '%(missing|)s'), 'abc123');
    assert.equal(renderTemplate('custom', { title: 'T: 1' }, '%(missing|)s'), 'T： 1');
    assert.equal(renderTemplate('custom', {}, '%(missing|)s'), 'download');
  });

  test('long names are cut to the default length', () => {
    assert.equal(renderTemplate('title', { title: 'x'.repeat(400) }).length, 180);
    assert.equal(renderTemplate('title', { title: 'x'.repeat(400) }, null, { maxLength: 50 }).length, 50);
  });

  test('unknown ids throw', () => {
    assert.throws(() => renderTemplate('nope', info), TypeError);
    assert.throws(() => templateFor('__proto__'), TypeError);
  });
});

describe('renderTemplate custom', () => {
  test('supports plain string fields', () => {
    assert.equal(renderTemplate('custom', info, '%(channel)s — %(title)s'), 'Blender — Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
  });

  test('unknown fields become NA', () => {
    assert.equal(renderTemplate('custom', info, '%(title)s %(nonexistent)s'), 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film NA');
  });

  test('supports zero padded playlist numbers', () => {
    assert.equal(renderTemplate('custom', entry, '%(playlist_index)03d - %(title)s'), '007 - Blender 2.82 - Features Showcase');
  });

  test('pads a string playlist index to the playlist size like yt-dlp', () => {
    assert.equal(renderTemplate('custom', entry, '%(playlist_index)s %(title)s'), '07 Blender 2.82 - Features Showcase');
  });

  test('supports playlist title and duration', () => {
    assert.equal(renderTemplate('custom', entry, '%(playlist)s - %(duration)ds - %(duration_string)s'), 'Blender Releases - 50s - 0：50');
  });

  test('supports date formatting', () => {
    assert.equal(renderTemplate('custom', info, '%(upload_date>%d.%m.%y)s %(title).9s'), '10.11.14 Big Buck');
    assert.equal(renderTemplate('custom', info, '%(upload_date>%B %j %A)s'), 'November 314 Monday');
    assert.equal(renderTemplate('custom', info, '%(upload_date>%b %a %Q)s'), 'Nov Mon %Q');
  });

  test('supports timestamps in date formatting', () => {
    assert.equal(renderTemplate('custom', { timestamp: 1415628355 }, '%(timestamp>%Y-%m-%d %H-%M-%S)s'), '2014-11-10 14-05-55');
  });

  test('an invalid date gives NA or the default', () => {
    assert.equal(renderTemplate('custom', { uploadDate: 'soon' }, '%(upload_date>%Y)s'), 'NA');
    assert.equal(renderTemplate('custom', { uploadDate: 'soon' }, '%(upload_date>%Y|unknown)s'), 'unknown');
  });

  test('supports alternatives and defaults', () => {
    assert.equal(renderTemplate('custom', { title: 'T' }, '%(release_date,upload_date|undated)s %(title)s'), 'undated T');
    assert.equal(renderTemplate('custom', { title: 'T', uploadDate: '20200102' }, '%(release_date>%Y,upload_date>%Y|x)s'), '2020');
  });

  test('supports replacements', () => {
    assert.equal(renderTemplate('custom', info, '%(channel&by {})s'), 'by Blender');
    assert.equal(renderTemplate('custom', { title: 'T' }, '%(channel&by {}|anon)s'), 'anon');
  });

  test('supports precision and escaped percent', () => {
    assert.equal(renderTemplate('custom', info, '100%% %(title).3s'), '100% Big');
  });

  test('precision never splits an emoji', () => {
    assert.equal(renderTemplate('custom', { title: '🎬🎬🎬' }, '%(title).2s'), '🎬🎬');
  });

  test('a trailing .%(ext)s is ignored because Vidaro adds the extension', () => {
    assert.equal(renderTemplate('custom', info, '%(title)s [%(id)s].%(ext)s'), 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film [aqz-KE-bpKQ]');
  });

  test('path separators in a custom template do not create folders', () => {
    assert.equal(renderTemplate('custom', info, '%(channel)s/%(title).3s'), 'Blender⧸Big');
  });

  test('an empty or oversized custom template falls back to the title', () => {
    assert.equal(renderTemplate('custom', info, ''), info.title);
    assert.equal(renderTemplate('custom', info, '   '), info.title);
    assert.equal(renderTemplate('custom', info, undefined), info.title);
    assert.equal(renderTemplate('custom', info, `%(id)s${'x'.repeat(600)}`), info.title);
  });

  test('field names with maths or traversal are not evaluated', () => {
    assert.equal(renderTemplate('custom', info, '%(duration-60)s %(formats.0.url)s %(__proto__)s %(constructor)s'), 'NA NA NA NA');
  });

  test('a stray percent sign is kept', () => {
    assert.equal(renderTemplate('custom', info, '50% off %(id)s'), '50% off aqz-KE-bpKQ');
  });

  test('integer and float conversions', () => {
    const fields = { n: 5, neg: -7, text: 'abc', f: 2.5 };
    assert.equal(renderRaw('[%(n)5d][%(n)-4d][%(neg)04d][%(f).2f][%(f)f][%(text)d][%(n)x]', fields), '[    5][5   ][-007][2.50][2.500000][NA][5]');
  });

  test('huge widths are capped', () => {
    assert.equal(renderRaw('%(n)99999999d', { n: 1 }).length, 64);
    assert.equal(renderRaw('%(n).99999999s', { n: 'ab' }), 'ab');
  });

  test('a non numeric value with an integer conversion uses the default', () => {
    assert.equal(renderRaw('%(text|none)d', { text: 'abc' }), 'none');
  });

  test('never throws on hostile templates', () => {
    const templates = ['%(', '%()s', '%(|)s', '%(&)s', '%(>)s', '%(,,,)s', '%(a>%)s', '%%%%(title)s', '%(title)', '%(title)0000000000000000000000d'];
    for (const template of templates) assert.equal(typeof renderTemplate('custom', info, template), 'string', template);
  });
});

describe('fieldsFromInfo', () => {
  test('maps the summary shape to yt-dlp field names', () => {
    const fields = fieldsFromInfo(info);
    assert.equal(fields.upload_date, '20141110');
    assert.equal(fields.uploader, 'Blender');
    assert.equal(fields.webpage_url, info.webpageUrl);
    assert.equal(fields.duration_string, '10:35');
  });

  test('accepts raw yt-dlp names too', () => {
    const fields = fieldsFromInfo({ title: 'T', upload_date: '20200101', playlist_index: 3, playlist_count: 150, uploader: 'U' });
    assert.equal(fields.upload_date, '20200101');
    assert.equal(fields.playlist_index, 3);
    assert.equal(fields.channel, 'U');
    assert.equal(renderRaw('%(playlist_index)s', fields), '003');
  });

  test('formats long durations with hours', () => {
    assert.equal(fieldsFromInfo({ duration: 3725.4 }).duration_string, '1:02:05');
    assert.equal(fieldsFromInfo({ duration: -1 }).duration_string, null);
  });

  test('ignores objects and non-object input', () => {
    assert.equal(fieldsFromInfo({ formats: [1], title: 'T' }).formats, undefined);
    assert.equal(fieldsFromInfo(null).title, null);
    assert.equal(fieldsFromInfo('text').id, null);
  });
});

describe('applyNumbering', () => {
  test('prefixes a three digit number', () => {
    assert.equal(applyNumbering('Title', 7, 19), '007 - Title');
  });

  test('uses more digits for big playlists', () => {
    assert.equal(applyNumbering('Title', 42, 12000), '00042 - Title');
  });

  test('leaves the name alone without a valid index', () => {
    assert.equal(applyNumbering('Title', null, 10), 'Title');
    assert.equal(applyNumbering('Title', 0, 10), 'Title');
    assert.equal(applyNumbering('Title', 1.5, 10), 'Title');
  });
});

describe('ytDlpLiteral', () => {
  test('escapes percent signs', () => {
    assert.equal(ytDlpLiteral('100% real %(title)s'), '100%% real %%(title)s');
  });

  test('keeps everything else', () => {
    assert.equal(ytDlpLiteral('Canción 🎬 – ＜ok＞'), 'Canción 🎬 – ＜ok＞');
  });
});
