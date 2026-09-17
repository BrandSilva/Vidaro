const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { idetArgs, parseIdet } = require('../src/main/converter/analysis');
const { parseProbe } = require('../src/main/converter/media');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');

function lines(name) {
  return fs.readFileSync(path.join(FIXTURES, `idet-${name}.txt`), 'utf8').split(/\r?\n/);
}

function media(name) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
  return parseProbe(data, { path: data.format.filename });
}

function summary({ repeated = [0, 0, 0], single = [0, 0, 0, 0], multi = [0, 0, 0, 0], id = '0000000000000001' }) {
  const prefix = `[Parsed_idet_0 @ ${id}]`;
  return [
    `${prefix} Repeated Fields: Neither: ${repeated[0]} Top: ${repeated[1]} Bottom: ${repeated[2]}`,
    `${prefix} Single frame detection: TFF: ${single[0]} BFF: ${single[1]} Progressive: ${single[2]} Undetermined: ${single[3]}`,
    `${prefix} Multi frame detection: TFF: ${multi[0]} BFF: ${multi[1]} Progressive: ${multi[2]} Undetermined: ${multi[3]}`
  ];
}

describe('idetArgs', () => {
  test('starts 10% into a long file, keeps only video and prints the idet summary', () => {
    const item = { ...media('h264-1080p5994'), duration: 600, durationReliable: true };
    const args = idetArgs('C:\\Media\\long clip.mp4', item, { frames: 600 });
    assert.deepEqual(args.slice(0, 5), ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info']);
    assert.equal(args[args.indexOf('-progress') + 1], 'pipe:1');
    assert.ok(args.indexOf('-progress') < args.indexOf('-i'));
    assert.equal(args[args.indexOf('-ss') + 1], '60');
    assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
    assert.equal(args[args.indexOf('-i') + 1], 'file:C:\\Media\\long clip.mp4');
    assert.equal(args[args.indexOf('-map') + 1], '0:0');
    assert.equal(args[args.indexOf('-vf') + 1], 'idet');
    assert.equal(args[args.indexOf('-frames:v') + 1], '600');
    assert.deepEqual(args.slice(-3), ['-f', 'null', 'NUL']);
    for (const flag of ['-an', '-sn', '-dn']) assert.ok(args.includes(flag));
  });

  test('a short file is analyzed from the start', () => {
    const args = idetArgs('C:\\Media\\short.mpg', media('telecine-mpeg2'), { frames: 600 });
    assert.equal(args.includes('-ss'), false);
    assert.equal(args[args.indexOf('-map') + 1], '0:0');
  });

  test('the seek never runs past the frames that must be read', () => {
    const item = { ...media('ntsc-dv'), duration: 25, durationReliable: true };
    const args = idetArgs('C:\\Media\\a.dv', item, { frames: 600 });
    const start = Number(args[args.indexOf('-ss') + 1]);
    assert.ok(start + 600 / (30000 / 1001) <= 25 + 1e-6);
  });

  test('an unreliable duration disables seeking', () => {
    const item = { ...media('xvid-avi'), duration: 900, durationReliable: false };
    assert.equal(idetArgs('C:\\Media\\a.avi', item).includes('-ss'), false);
  });

  test('uses the real video stream index', () => {
    const args = idetArgs('C:\\Media\\dvd.mpg', media('dvd-mpeg2'));
    assert.equal(args[args.indexOf('-map') + 1], '0:1');
  });
});

describe('parseIdet with real ffmpeg output', () => {
  test('hard telecine is top field first with a steady share of repeated fields', () => {
    const result = parseIdet(lines('telecine'));
    assert.equal(result.verdict, 'tff');
    assert.equal(result.telecine, true);
    assert.equal(result.frames, 180);
    assert.deepEqual(result.counts.repeated, { neither: 108, top: 36, bottom: 36 });
  });

  test('true interlaced top field first has no repeated fields', () => {
    const result = parseIdet(lines('interlaced-tff'));
    assert.equal(result.verdict, 'tff');
    assert.equal(result.telecine, false);
  });

  test('interlaced DV is bottom field first', () => {
    const result = parseIdet(lines('interlaced-bff'));
    assert.equal(result.verdict, 'bff');
    assert.equal(result.telecine, false);
  });

  test('clean progressive material is progressive', () => {
    const result = parseIdet(lines('progressive'));
    assert.equal(result.verdict, 'progressive');
    assert.equal(result.telecine, false);
  });

  test('synthetic edges that split between TFF and BFF stay unknown', () => {
    assert.equal(parseIdet(lines('mixed-short')).verdict, 'unknown');
    assert.equal(parseIdet(lines('mixed-long')).verdict, 'unknown');
  });

  test('all undetermined frames stay unknown', () => {
    assert.equal(parseIdet(lines('undetermined')).verdict, 'unknown');
  });

  test('the empty first filter instance is ignored in favour of the one with counts', () => {
    const result = parseIdet(lines('telecine'));
    assert.ok(result.counts.multi.tff > 0);
  });
});

describe('parseIdet thresholds', () => {
  test('no output gives unknown with no counts', () => {
    assert.deepEqual(parseIdet([]), { verdict: 'unknown', telecine: false, counts: null, frames: 0 });
    assert.equal(parseIdet('').verdict, 'unknown');
  });

  test('fewer than 20 decided frames is unknown', () => {
    assert.equal(parseIdet(summary({ multi: [10, 0, 5, 300], single: [10, 0, 5, 300] })).verdict, 'unknown');
  });

  test('under 10% interlaced frames is progressive', () => {
    assert.equal(parseIdet(summary({ multi: [9, 0, 91, 0] })).verdict, 'progressive');
  });

  test('between 10% and 20% interlaced frames is unknown', () => {
    assert.equal(parseIdet(summary({ multi: [15, 0, 85, 0], single: [15, 0, 85, 0] })).verdict, 'unknown');
  });

  test('from 20% one-sided interlaced frames decide the field order', () => {
    assert.equal(parseIdet(summary({ multi: [20, 0, 80, 0] })).verdict, 'tff');
    assert.equal(parseIdet(summary({ multi: [3, 40, 57, 0] })).verdict, 'bff');
  });

  test('a minority field order above 20% of interlaced frames is unknown', () => {
    assert.equal(parseIdet(summary({ multi: [70, 30, 0, 0], single: [70, 30, 0, 0] })).verdict, 'unknown');
  });

  test('an undecided multi frame result falls back to single frame detection', () => {
    assert.equal(parseIdet(summary({ multi: [0, 0, 0, 200], single: [150, 0, 50, 0] })).verdict, 'tff');
  });

  test('telecine needs at least 15% repeated fields with 5% or more on each side', () => {
    assert.equal(parseIdet(summary({ repeated: [80, 10, 10], multi: [100, 0, 0, 0] })).telecine, true);
    assert.equal(parseIdet(summary({ repeated: [90, 5, 5], multi: [100, 0, 0, 0] })).telecine, false);
    assert.equal(parseIdet(summary({ repeated: [80, 20, 0], multi: [100, 0, 0, 0] })).telecine, false);
  });

  test('telecine is rejected above 60% repeated fields', () => {
    assert.equal(parseIdet(summary({ repeated: [30, 35, 35], multi: [100, 0, 0, 0] })).telecine, false);
  });

  test('repeated fields on progressive material are not telecine', () => {
    assert.equal(parseIdet(summary({ repeated: [60, 20, 20], multi: [0, 0, 100, 0] })).telecine, false);
  });

  test('accepts a single text blob as input', () => {
    const text = summary({ multi: [0, 100, 0, 0] }).join('\r\n');
    assert.equal(parseIdet(text).verdict, 'bff');
  });
});
