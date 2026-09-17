const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProgressParser, percentOf, etaOf, parseClock } = require('../src/main/converter/progress');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'converter', 'progress.txt'), 'utf8').split(/\r?\n/);

function feed(parser, lines) {
  return lines.map((line) => parser.push(line)).filter(Boolean);
}

describe('createProgressParser', () => {
  test('emits one snapshot per block of real ffmpeg output', () => {
    const snapshots = feed(createProgressParser(), SAMPLE);
    assert.equal(snapshots.length, 7);
    assert.equal(snapshots.filter((item) => item.done).length, 1);
    assert.equal(snapshots.at(-1).done, true);
  });

  test('the first block with N/A values has no time or speed', () => {
    const [first] = feed(createProgressParser(), SAMPLE);
    assert.deepEqual(first, {
      outTimeSec: null,
      frame: 0,
      fps: 0,
      speed: null,
      totalSize: 48,
      bitrateKbps: null,
      dupFrames: 0,
      dropFrames: 0,
      done: false
    });
  });

  test('reads time, frame, fps, speed, size and a bitrate with a leading space', () => {
    const [, second] = feed(createProgressParser(), SAMPLE);
    assert.equal(second.outTimeSec, 4.245333);
    assert.equal(second.frame, 121);
    assert.equal(second.fps, 0);
    assert.equal(second.speed, 8.27);
    assert.equal(second.totalSize, 524336);
    assert.equal(second.bitrateKbps, 988.1);
  });

  test('the end block carries the encoded duration', () => {
    const parser = createProgressParser();
    const last = feed(parser, SAMPLE).at(-1);
    assert.equal(last.outTimeSec, 20);
    assert.equal(last.frame, 599);
    assert.equal(parser.lastOutTime(), 20);
  });

  test('time never goes backwards in lastOutTime and negative times clamp to zero', () => {
    const parser = createProgressParser();
    feed(parser, ['out_time_us=5000000', 'progress=continue']);
    const [snapshot] = feed(parser, ['out_time_us=-23220', 'progress=continue']);
    assert.equal(snapshot.outTimeSec, 0);
    assert.equal(parser.lastOutTime(), 5);
  });

  test('falls back to out_time_ms and then to the clock text', () => {
    assert.equal(feed(createProgressParser(), ['out_time_ms=1500000', 'progress=continue'])[0].outTimeSec, 1.5);
    assert.equal(feed(createProgressParser(), ['out_time_us=N/A', 'out_time=00:01:02.500000', 'progress=continue'])[0].outTimeSec, 62.5);
  });

  test('ignores noise, blank lines and CR endings', () => {
    const parser = createProgressParser();
    const snapshots = feed(parser, ['', 'garbage', '=value', 'frame=10\r', 'speed=1.5x\r', 'progress=continue\r']);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].frame, 10);
    assert.equal(snapshots[0].speed, 1.5);
  });

  test('fields do not leak between blocks', () => {
    const snapshots = feed(createProgressParser(), ['frame=10', 'speed=2x', 'progress=continue', 'progress=continue']);
    assert.equal(snapshots[1].frame, null);
    assert.equal(snapshots[1].speed, null);
  });

  test('reset clears state', () => {
    const parser = createProgressParser();
    feed(parser, ['frame=3', 'out_time_us=2000000', 'progress=continue', 'frame=4']);
    parser.reset();
    assert.equal(parser.lastOutTime(), null);
    assert.equal(feed(parser, ['progress=end'])[0].frame, null);
  });
});

describe('progress helpers', () => {
  test('percentOf clamps and needs a duration', () => {
    assert.equal(percentOf(5, 20), 25);
    assert.equal(percentOf(30, 20), 100);
    assert.equal(percentOf(5, 0), null);
    assert.equal(percentOf(null, 20), null);
  });

  test('etaOf uses the encoding speed', () => {
    assert.equal(etaOf(10, 70, 2), 30);
    assert.equal(etaOf(10, 70, 0), null);
    assert.equal(etaOf(80, 70, 1), 0);
  });

  test('parseClock', () => {
    assert.equal(parseClock('01:00:00.5'), 3600.5);
    assert.equal(parseClock('-00:00:01.000000'), -1);
    assert.equal(parseClock('N/A'), null);
  });
});
