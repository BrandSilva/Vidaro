const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sanitizeFileName, splitExt, uniquePath, truncateText, isReservedName, MAX_PATH_BUDGET } = require('../src/main/fsnames');

describe('sanitizeFileName', () => {
  test('keeps a normal title as it is', () => {
    assert.equal(sanitizeFileName('Big Buck Bunny - Official Blender Short'), 'Big Buck Bunny - Official Blender Short');
  });

  test('keeps accents, emoji and other scripts', () => {
    assert.equal(sanitizeFileName('Canción Año – 日本語 🎬👍🏽 Ünïcödé'), 'Canción Año – 日本語 🎬👍🏽 Ünïcödé');
  });

  test('replaces every forbidden character with a consistent look-alike', () => {
    assert.equal(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j'), 'a＜b＞c：d＂e⧸f⧹g｜h？i＊j');
    assert.equal(sanitizeFileName('AC/DC: Live?'), 'AC⧸DC： Live？');
  });

  test('no ASCII character Windows forbids survives', () => {
    const all = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)).join('');
    const result = sanitizeFileName(`x${all}x`);
    assert.doesNotMatch(result, /[<>:"/\\|?*\u0000-\u001f]/);
  });

  test('turns tabs and newlines into spaces and collapses whitespace', () => {
    assert.equal(sanitizeFileName('line one\nline\ttwo\r\n   three'), 'line one line two three');
  });

  test('removes control and bidirectional override characters', () => {
    assert.equal(sanitizeFileName('clip\u0000\u0007\u001b name'), 'clip name');
    assert.equal(sanitizeFileName('video\u202Egpj.exe'), 'videogpj.exe');
    assert.equal(sanitizeFileName('\ufeffbom title\u200f'), 'bom title');
  });

  test('trims leading and trailing dots and spaces', () => {
    assert.equal(sanitizeFileName('  ..name.. . '), 'name');
    assert.equal(sanitizeFileName('What is this...'), 'What is this');
    assert.equal(sanitizeFileName('.hidden'), 'hidden');
  });

  test('uses the fallback for empty or unusable names', () => {
    assert.equal(sanitizeFileName(''), 'download');
    assert.equal(sanitizeFileName('   '), 'download');
    assert.equal(sanitizeFileName('...'), 'download');
    assert.equal(sanitizeFileName('\u0000\u0001'), 'download');
    assert.equal(sanitizeFileName(null), 'download');
    assert.equal(sanitizeFileName(undefined, { fallback: 'video' }), 'video');
    assert.equal(sanitizeFileName({}), 'download');
  });

  test('sanitizes the fallback too', () => {
    assert.equal(sanitizeFileName('', { fallback: 'a:b' }), 'a：b');
    assert.equal(sanitizeFileName('', { fallback: 'CON' }), '_CON');
  });

  test('an empty fallback returns an empty string', () => {
    assert.equal(sanitizeFileName('...', { fallback: '' }), '');
  });

  test('accepts numbers', () => {
    assert.equal(sanitizeFileName(2026), '2026');
  });

  test('protects reserved device names, with or without extension', () => {
    for (const name of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM0', 'LPT²', 'CONIN$', 'conout$']) {
      assert.equal(sanitizeFileName(name), `_${name}`, name);
    }
    assert.equal(sanitizeFileName('nul.mp4'), '_nul.mp4');
    assert.equal(sanitizeFileName('Con.tar.gz'), '_Con.tar.gz');
    assert.equal(sanitizeFileName('CON .txt'), '_CON .txt');
  });

  test('a cut that leaves a device name is protected too', () => {
    assert.equal(sanitizeFileName('CON Something', { maxLength: 4 }), '_CON');
    assert.equal(sanitizeFileName('nul. x', { maxLength: 5 }), '_nul');
    assert.equal(sanitizeFileName('LPT1 report', { maxLength: 5 }), '_LPT1');
    assert.equal(sanitizeFileName('CON', { maxLength: 3 }), '_CO');
    assert.equal(sanitizeFileName('CON', { maxLength: 1 }), 'C');
    for (const maxLength of [1, 2, 3, 4, 5, 6]) {
      const result = sanitizeFileName('aux. tail', { maxLength });
      assert.ok(result.length <= maxLength, `${maxLength}: ${result}`);
      assert.equal(isReservedName(result), false, `${maxLength}: ${result}`);
    }
  });

  test('the source file keeps its invisible character list as escapes', () => {
    const source = require('node:fs').readFileSync(require.resolve('../src/main/fsnames'), 'utf8');
    assert.doesNotMatch(source, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/u);
  });

  test('removes the rest of the bidirectional and C1 control characters', () => {
    assert.equal(sanitizeFileName('a\u{2066}b\u{2069}c\u{202a}d\x85e\x9ff\u{200e}g'), 'abcdefg');
    assert.equal(sanitizeFileName('keep\u{200d}joiners\u{200c}here'), 'keep\u{200d}joiners\u{200c}here');
  });

  test('does not touch names that only start like a device name', () => {
    for (const name of ['CONSOLE', 'Contest', 'nullable', 'COM10', 'LPT', 'auxiliary', 'prn-report']) {
      assert.equal(sanitizeFileName(name), name, name);
    }
  });

  test('cuts long names to the default length', () => {
    const result = sanitizeFileName('a'.repeat(400));
    assert.equal(result.length, 180);
  });

  test('cuts to a custom length and never beyond 255', () => {
    assert.equal(sanitizeFileName('abcdefghij', { maxLength: 4 }), 'abcd');
    assert.equal(sanitizeFileName('b'.repeat(400), { maxLength: 1000 }).length, 255);
    assert.equal(sanitizeFileName('c'.repeat(400), { maxLength: 0 }).length, 180);
  });

  test('never splits a surrogate pair when cutting', () => {
    const result = sanitizeFileName(`abc${'🎬'.repeat(10)}`, { maxLength: 6 });
    assert.equal(result, 'abc🎬');
    assert.equal(result.isWellFormed(), true);
  });

  test('never splits an emoji sequence or an accent when cutting', () => {
    assert.equal(sanitizeFileName('ab👍🏽cd', { maxLength: 4 }), 'ab');
    assert.equal(sanitizeFileName('x👨‍👩‍👧y', { maxLength: 7 }), 'x');
    assert.equal(sanitizeFileName('nq\u0301e', { maxLength: 2 }), 'n');
    assert.equal(sanitizeFileName('ne\u0301e', { maxLength: 2 }), 'n\u00e9');
  });

  test('trims trailing dots and spaces left by the cut', () => {
    assert.equal(sanitizeFileName('Title here. More', { maxLength: 12 }), 'Title here');
  });

  test('replaces lone surrogates so the name is valid UTF-16', () => {
    const result = sanitizeFileName('bad\ud83cname');
    assert.equal(result.isWellFormed(), true);
    assert.equal(result, 'bad\ufffdname');
  });

  test('normalizes to NFC so equal names compare equal', () => {
    assert.equal(sanitizeFileName('Cancio\u0301n'), 'Canción');
  });

  test('is idempotent', () => {
    const samples = ['a<b>c', ' CON ', 'x'.repeat(300), 'AC/DC: "Live" | 1979?*', 'title...', '🎬'.repeat(120), 'NUL.txt'];
    for (const sample of samples) {
      const once = sanitizeFileName(sample);
      assert.equal(sanitizeFileName(once), once, sample);
    }
  });
});

describe('truncateText', () => {
  test('returns short text unchanged', () => {
    assert.equal(truncateText('short', 10), 'short');
  });

  test('returns an empty string for a zero or negative limit', () => {
    assert.equal(truncateText('text', 0), '');
    assert.equal(truncateText('text', -3), '');
  });
});

describe('isReservedName', () => {
  test('detects device names', () => {
    assert.equal(isReservedName('aux'), true);
    assert.equal(isReservedName('aux.mkv'), true);
    assert.equal(isReservedName('auxiliary.mkv'), false);
  });
});

describe('splitExt', () => {
  test('splits a normal extension', () => {
    assert.deepEqual(splitExt('video.mp4'), { base: 'video', ext: '.mp4' });
    assert.deepEqual(splitExt('archive.tar.gz'), { base: 'archive.tar', ext: '.gz' });
  });

  test('keeps names without an extension whole', () => {
    assert.deepEqual(splitExt('video'), { base: 'video', ext: '' });
    assert.deepEqual(splitExt('.hidden'), { base: '.hidden', ext: '' });
    assert.deepEqual(splitExt('name.'), { base: 'name.', ext: '' });
    assert.deepEqual(splitExt(''), { base: '', ext: '' });
    assert.deepEqual(splitExt(undefined), { base: '', ext: '' });
  });

  test('does not treat a dotted title as an extension', () => {
    assert.deepEqual(splitExt('Blender 2.82 - Features Showcase'), { base: 'Blender 2.82 - Features Showcase', ext: '' });
    assert.deepEqual(splitExt('Version 1.5 final'), { base: 'Version 1.5 final', ext: '' });
    assert.deepEqual(splitExt('clip.verylongextension'), { base: 'clip.verylongextension', ext: '' });
  });

  test('keeps non-ASCII base names', () => {
    assert.deepEqual(splitExt('Canción 🎬.webm'), { base: 'Canción 🎬', ext: '.webm' });
  });
});

describe('uniquePath', () => {
  const folder = 'C:\\Users\\Test\\Videos\\Vidaro';

  function existing(...names) {
    const set = new Set(names.map((name) => path.win32.join(folder, name).toLowerCase()));
    const calls = [];
    const fn = (candidate) => {
      calls.push(candidate);
      return set.has(candidate.toLowerCase());
    };
    return { fn, calls };
  }

  test('returns the plain name when it is free', () => {
    const { fn } = existing();
    assert.equal(uniquePath(folder, 'Movie', '.mp4', fn), `${folder}\\Movie.mp4`);
  });

  test('accepts an extension without the dot', () => {
    const { fn } = existing();
    assert.equal(uniquePath(folder, 'Movie', 'mp4', fn), `${folder}\\Movie.mp4`);
  });

  test('accepts an empty extension', () => {
    const { fn } = existing();
    assert.equal(uniquePath(folder, 'Movie', '', fn), `${folder}\\Movie`);
    assert.equal(uniquePath(folder, 'Movie', null, fn), `${folder}\\Movie`);
  });

  test('numbers copies as (2), (3) and so on', () => {
    const { fn } = existing('Movie.mp4', 'movie (2).MP4');
    assert.equal(uniquePath(folder, 'Movie', '.mp4', fn), `${folder}\\Movie (3).mp4`);
  });

  test('checks candidates in order', () => {
    const { fn, calls } = existing('Movie.mp4');
    uniquePath(folder, 'Movie', '.mp4', fn);
    assert.deepEqual(calls, [`${folder}\\Movie.mp4`, `${folder}\\Movie (2).mp4`]);
  });

  test('sanitizes the base name', () => {
    const { fn } = existing();
    assert.equal(uniquePath(folder, 'What? Now: yes.', '.mp4', fn), `${folder}\\What？ Now： yes.mp4`);
    assert.equal(uniquePath(folder, '', '.mp4', fn), `${folder}\\download.mp4`);
  });

  test('normalizes the folder', () => {
    const { fn } = existing();
    assert.equal(uniquePath('C:/Users/Test/Videos/Vidaro/', 'a', '.mp3', fn), `${folder}\\a.mp3`);
    assert.equal(uniquePath('D:\\', 'a', '.mp3', fn), 'D:\\a.mp3');
  });

  test('keeps the full path within the budget by trimming the base', () => {
    const { fn } = existing();
    const result = uniquePath(folder, 'x'.repeat(300), '.mp4', fn, { maxLength: 255 });
    assert.equal(result.length, MAX_PATH_BUDGET);
    assert.ok(result.endsWith('x.mp4'));
  });

  test('the copy suffix stays inside the budget', () => {
    const long = 'y'.repeat(300);
    const first = uniquePath(folder, long, '.mp4', () => false, { maxLength: 255 });
    const { fn } = existing(path.win32.basename(first));
    const second = uniquePath(folder, long, '.mp4', fn, { maxLength: 255 });
    assert.ok(second.endsWith(' (2).mp4'));
    assert.equal(second.length, MAX_PATH_BUDGET);
  });

  test('honors a reserve for temporary suffixes', () => {
    const result = uniquePath(folder, 'z'.repeat(300), '.mp4', () => false, { reserve: 20, maxLength: 255 });
    assert.equal(result.length, MAX_PATH_BUDGET - 20);
  });

  test('the default name length applies before the path budget', () => {
    const result = uniquePath(folder, 'v'.repeat(300), '.mp4', () => false);
    assert.equal(path.win32.basename(result), `${'v'.repeat(180)}.mp4`);
  });

  test('honors a custom path budget', () => {
    const result = uniquePath(folder, 'w'.repeat(300), '.mkv', () => false, { maxPath: 100 });
    assert.equal(result.length, 100);
  });

  test('trimming for the budget never splits an emoji', () => {
    const result = uniquePath(folder, '🎬'.repeat(200), '.mp4', () => false);
    assert.ok(result.length <= MAX_PATH_BUDGET);
    assert.equal(result.isWellFormed(), true);
  });

  test('throws a path-too-long error when the folder leaves no room', () => {
    const deep = `C:\\${'d'.repeat(260)}`;
    assert.throws(() => uniquePath(deep, 'Movie', '.mp4', () => false), (error) => error.code === 'path-too-long');
  });

  test('gives up after too many copies', () => {
    assert.throws(() => uniquePath(folder, 'Movie', '.mp4', () => true), RangeError);
  });

  test('rejects relative folders, bad extensions and a missing callback', () => {
    assert.throws(() => uniquePath('Videos', 'a', '.mp4', () => false), TypeError);
    assert.throws(() => uniquePath(folder, 'a', '.mp4'), TypeError);
    assert.throws(() => uniquePath(folder, 'a', '.m p4', () => false), TypeError);
    assert.throws(() => uniquePath(folder, 'a', '../evil', () => false), TypeError);
  });

  test('a device name base is protected', () => {
    assert.equal(uniquePath(folder, 'NUL', '.mp4', () => false), `${folder}\\_NUL.mp4`);
  });

  test('trimming for the budget never leaves a device name', () => {
    const tight = 'C:\\V';
    assert.equal(uniquePath(tight, 'Aux trailing words', '.mp4', () => false, { maxPath: 13 }), 'C:\\V\\_Aux.mp4');
    assert.equal(uniquePath(tight, 'Aux trailing words', '.mp4', () => false, { maxPath: 12 }), 'C:\\V\\_Au.mp4');
    assert.equal(uniquePath(tight, 'Aux', '.mp4', (candidate) => candidate === 'C:\\V\\_Aux.mp4', { maxPath: 20 }), 'C:\\V\\_Aux (2).mp4');
  });

  test('odd budgets are rounded instead of ignored', () => {
    assert.equal(uniquePath(folder, 'w'.repeat(300), '.mkv', () => false, { maxPath: 100.7 }).length, 100);
    assert.equal(uniquePath(folder, 'w'.repeat(300), '.mkv', () => false, { maxPath: 100, reserve: 10.2 }).length, 89);
    assert.equal(uniquePath(folder, 'w'.repeat(300), '.mkv', () => false, { maxPath: 100, reserve: -50 }).length, 100);
    assert.equal(uniquePath(folder, 'w'.repeat(300), '.mkv', () => false, { maxPath: Number.NaN }).length, 180 + folder.length + 5);
  });

  test('rejects folders that are only rooted on the current drive', () => {
    for (const bad of ['\\Videos', '/Videos', 'C:Videos', '', 42, null]) {
      assert.throws(() => uniquePath(bad, 'a', '.mp4', () => false), TypeError, String(bad));
    }
    assert.equal(uniquePath('\\\\nas\\media', 'a', '.mp4', () => false), '\\\\nas\\media\\a.mp4');
    assert.equal(uniquePath('//nas/media', 'a', '.mp4', () => false), '\\\\nas\\media\\a.mp4');
  });
});
