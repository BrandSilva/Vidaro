const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseVersion, compareYtDlpVersions, isNewer, parseUpdateOutput } = require('../src/main/downloader/versions');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('parseVersion', () => {
  test('parses a stable version as printed by --version', () => {
    assert.deepEqual(parseVersion('2026.08.19\r\n'), { year: 2026, month: 8, day: 19, build: 0, channel: null, text: '2026.08.19' });
  });

  test('parses a nightly version', () => {
    assert.deepEqual(parseVersion('2026.08.30.232658'), { year: 2026, month: 8, day: 30, build: 232658, channel: 'nightly', text: '2026.08.30.232658' });
  });

  test('parses a stable hotfix version', () => {
    assert.deepEqual(parseVersion('2024.07.02.1'), { year: 2024, month: 7, day: 2, build: 1, channel: null, text: '2024.07.02.1' });
  });

  test('reads the channel from updater text', () => {
    assert.equal(parseVersion('stable@2026.08.19 from yt-dlp/yt-dlp').channel, 'stable');
    assert.equal(parseVersion('Updated yt-dlp to nightly@2026.08.30.232658 from yt-dlp/yt-dlp-nightly-builds').channel, 'nightly');
    assert.equal(parseVersion('master@2026.09.01.101010').channel, 'master');
    assert.equal(parseVersion('Updated yt-dlp to stable@2026.08.19.').text, '2026.08.19');
  });

  test('rejects text that is not a version', () => {
    for (const value of ['', 'abc', '2026.8.19', '2026.13.01', '2026.00.10', '2026.01.32', '12026.08.19', '2026.08.190', null, undefined, 20260819, {}]) {
      assert.equal(parseVersion(value), null, String(value));
    }
  });

  test('passes an already parsed version through', () => {
    const parsed = parseVersion('2026.08.19');
    assert.equal(parseVersion(parsed), parsed);
  });
});

describe('compareYtDlpVersions', () => {
  test('orders by date and build', () => {
    assert.equal(compareYtDlpVersions('2026.08.19', '2026.08.19'), 0);
    assert.equal(compareYtDlpVersions('2026.08.19', '2026.08.30.232658'), -1);
    assert.equal(compareYtDlpVersions('2026.08.30.232658', '2026.08.19'), 1);
    assert.equal(compareYtDlpVersions('2026.08.30', '2026.08.30.000001'), -1);
    assert.equal(compareYtDlpVersions('2025.12.31', '2026.01.01'), -1);
    assert.equal(compareYtDlpVersions('2026.02.01', '2026.01.31'), 1);
  });

  test('ignores the channel when comparing', () => {
    assert.equal(compareYtDlpVersions('stable@2026.08.19', 'nightly@2026.08.19'), 0);
  });

  test('unknown versions sort first', () => {
    assert.equal(compareYtDlpVersions(null, '2026.08.19'), -1);
    assert.equal(compareYtDlpVersions('2026.08.19', 'garbage'), 1);
    assert.equal(compareYtDlpVersions('x', 'y'), 0);
  });

  test('sorts a list', () => {
    const list = ['2026.08.30.232658', '2025.01.01', '2026.08.19', 'broken', '2026.08.19.1'];
    assert.deepEqual([...list].sort(compareYtDlpVersions), ['broken', '2025.01.01', '2026.08.19', '2026.08.19.1', '2026.08.30.232658']);
  });

  test('isNewer tells when the bundled copy should replace the local one', () => {
    assert.equal(isNewer('2026.08.19', '2026.07.01'), true);
    assert.equal(isNewer('2026.08.19', '2026.08.19'), false);
    assert.equal(isNewer('2026.08.19', '2026.08.30.232658'), false);
    assert.equal(isNewer('2026.08.19', null), true);
    assert.equal(isNewer(null, '2026.08.19'), false);
  });
});

describe('parseUpdateOutput with real updater output', () => {
  test('already up to date', () => {
    const result = parseUpdateOutput(fixture('update-current.txt'), { exitCode: 0 });
    assert.equal(result.status, 'current');
    assert.equal(result.version.text, '2026.08.19');
    assert.equal(result.version.channel, 'stable');
    assert.equal(result.latest.text, '2026.08.19');
    assert.equal(result.message, null);
  });

  test('updated to nightly', () => {
    const result = parseUpdateOutput(fixture('update-nightly.txt'), { exitCode: 0 });
    assert.equal(result.status, 'updated');
    assert.equal(result.version.text, '2026.08.30.232658');
    assert.equal(result.version.channel, 'nightly');
    assert.equal(result.previous.text, '2026.08.19');
    assert.equal(result.latest.channel, 'nightly');
  });

  test('switched back to stable with an explicit tag', () => {
    const result = parseUpdateOutput(fixture('update-back-to-stable.txt'), { exitCode: 0 });
    assert.equal(result.status, 'updated');
    assert.equal(result.version.text, '2026.08.19');
    assert.equal(result.version.channel, 'stable');
    assert.equal(result.previous.channel, 'nightly');
  });

  test('a plain channel name does not downgrade from nightly', () => {
    const result = parseUpdateOutput(fixture('update-no-downgrade.txt'), { exitCode: 0 });
    assert.equal(result.status, 'current');
    assert.equal(result.version.channel, 'nightly');
    assert.equal(result.latest.channel, 'stable');
  });

  test('offline update fails with a short message', () => {
    const result = parseUpdateOutput(fixture('update-offline.txt'), { exitCode: 100 });
    assert.equal(result.status, 'failed');
    assert.equal(result.message, 'Unable to obtain version info');
    assert.equal(result.version, null);
  });

  test('accepts an array of lines', () => {
    const result = parseUpdateOutput(fixture('update-current.txt').split(/\r?\n/), { exitCode: 0 });
    assert.equal(result.status, 'current');
  });
});

describe('parseUpdateOutput edge cases', () => {
  test('a write error after the check is a failure', () => {
    const result = parseUpdateOutput(
      [
        'Current version: stable@2026.08.19 from yt-dlp/yt-dlp',
        'Latest version: stable@2026.09.10 from yt-dlp/yt-dlp',
        'Updating to stable@2026.09.10 from yt-dlp/yt-dlp ...',
        "ERROR: Unable to write to C:\\Users\\User\\AppData\\Local\\Vidaro\\bin\\yt-dlp.exe; Try running as administrator"
      ],
      { exitCode: 100 }
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.version.text, '2026.08.19');
    assert.equal(result.latest.text, '2026.09.10');
    assert.match(result.message, /^Unable to write to/);
  });

  test('no output at all', () => {
    assert.deepEqual(parseUpdateOutput('', { exitCode: 1 }), {
      status: 'failed',
      version: null,
      previous: null,
      latest: null,
      message: 'The update could not be completed.'
    });
    assert.equal(parseUpdateOutput(undefined).status, 'failed');
    assert.equal(parseUpdateOutput([null, 5]).status, 'failed');
  });
});
