const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { renderOutputName, outputPathFor, partialPathFor, resolutionToken, dateText } = require('../src/main/converter/names');

function existsIn(paths) {
  const set = new Set(paths.map((item) => item.toLowerCase()));
  return (candidate) => set.has(candidate.toLowerCase());
}

describe('renderOutputName', () => {
  test('replaces every token', () => {
    const date = new Date(2026, 8, 16, 12, 0, 0);
    assert.equal(renderOutputName('{date} {name} [{preset}] {resolution}', { name: 'Noticias', preset: 'FlowAir Ready 1080p', resolution: '1080p', date }), '2026-09-16 Noticias [FlowAir Ready 1080p] 1080p');
    assert.equal(renderOutputName('{name}_720p', { name: 'clip' }), 'clip_720p');
  });

  test('tokens are case insensitive and unknown ones stay literal', () => {
    assert.equal(renderOutputName('{NAME} {other}', { name: 'a' }), 'a {other}');
  });

  test('empty tokens take their separators and brackets with them', () => {
    assert.equal(renderOutputName('{name}_{resolution}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{name} [{preset}]', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{date} - {name}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{name} - {preset} - {resolution}', { name: 'clip', resolution: '720p' }), 'clip - 720p');
    assert.equal(renderOutputName('{name}{preset}{resolution}', { name: 'clip', resolution: '720p' }), 'clip720p');
    assert.equal(renderOutputName('{name} {preset} {resolution}', { name: 'clip', resolution: '720p' }), 'clip 720p');
    assert.equal(renderOutputName('{name}_{preset}_{resolution}', { name: 'clip', resolution: '720p' }), 'clip_720p');
  });

  test('several empty tokens in a row leave no dangling separators', () => {
    assert.equal(renderOutputName('{name} - {preset} - {date}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{date} - {preset} - {name}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{name}_{preset}_{date}_{resolution}', { name: 'clip', resolution: '720p' }), 'clip_720p');
    assert.equal(renderOutputName('{name} [{preset}] ({date}) {resolution}', { name: 'clip', resolution: '720p' }), 'clip 720p');
    assert.equal(renderOutputName('{preset}{date}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('[{preset}]', { name: 'clip' }), 'clip');
  });

  test('an empty token inside brackets drops only its own separator', () => {
    assert.equal(renderOutputName('{name} [{preset} {resolution}]', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{name} [{preset} {resolution}]', { name: 'clip', resolution: '720p' }), 'clip [720p]');
    assert.equal(renderOutputName('{name} [{resolution} - {preset}]', { name: 'clip', resolution: '720p' }), 'clip [720p]');
    assert.equal(renderOutputName('{name} ({preset}, {resolution})', { name: 'clip', resolution: '720p' }), 'clip (, 720p)');
  });

  test('separators inside the values are kept', () => {
    assert.equal(renderOutputName('{name}-{preset}', { name: 'my-clip' }), 'my-clip');
    assert.equal(renderOutputName('{preset} - {name}', { name: 'a - b' }), 'a - b');
  });

  test('a control character inside a value is not mistaken for an empty token', () => {
    assert.equal(renderOutputName('{name} - {preset}', { name: `a${String.fromCharCode(0)}b`, preset: 'P' }), 'ab - P');
  });

  test('the source file has no raw control characters, so git does not treat it as binary', () => {
    const source = require('node:fs').readFileSync(require.resolve('../src/main/converter/names'), 'utf8');
    assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source), false);
  });

  test('the result is sanitized for Windows', () => {
    assert.equal(renderOutputName('{name}: {preset}', { name: 'AC/DC', preset: 'MP3?' }), 'AC⧸DC： MP3？');
    assert.equal(renderOutputName('{name}', { name: 'CON' }), '_CON');
    assert.equal(renderOutputName('{name}...', { name: 'x' }), 'x');
  });

  test('keeps accents and emoji', () => {
    assert.equal(renderOutputName('{name}', { name: 'Año nuevo – señal 🎬' }), 'Año nuevo – señal 🎬');
  });

  test('an empty result falls back to the source name, then to video', () => {
    assert.equal(renderOutputName('{preset}', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('', { name: 'clip' }), 'clip');
    assert.equal(renderOutputName('{preset}', { name: '' }), 'video');
  });

  test('dateText formats dates and ISO strings', () => {
    assert.equal(dateText('2026-01-02T10:00:00Z'), '2026-01-02');
    assert.equal(dateText('yesterday'), '');
    assert.equal(dateText(null), '');
    assert.equal(dateText(new Date('invalid')), '');
  });

  test('resolutionToken uses the short side', () => {
    assert.equal(resolutionToken(1920, 1080), '1080p');
    assert.equal(resolutionToken(1080, 1920), '1080p');
    assert.equal(resolutionToken(0, 0), '');
  });
});

describe('outputPathFor', () => {
  const input = 'D:\\Archive\\Show 1998.avi';

  test('writes next to the source with the new extension', () => {
    const result = outputPathFor({ inputPath: input, useSourceFolder: true, extension: 'mp4', exists: existsIn([]) });
    assert.deepEqual(result, { path: 'D:\\Archive\\Show 1998.mp4', skip: false, overwrite: false });
  });

  test('writes into the chosen folder and accepts a dotted extension', () => {
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: '.mkv', exists: existsIn([]) });
    assert.equal(result.path, 'E:\\Out\\Show 1998.mkv');
  });

  test('without a folder the source folder is used', () => {
    assert.equal(outputPathFor({ inputPath: input, extension: 'mp4', exists: existsIn([]) }).path, 'D:\\Archive\\Show 1998.mp4');
  });

  test('rename adds a counter when the name is taken or a partial exists', () => {
    const taken = ['E:\\Out\\Show 1998.mp4', 'E:\\Out\\Show 1998 (2).mp4.partial'];
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: 'mp4', collision: 'rename', exists: existsIn(taken) });
    assert.equal(result.path, 'E:\\Out\\Show 1998 (3).mp4');
  });

  test('rename skips paths reserved by other queued jobs', () => {
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: 'mp4', exists: existsIn([]), reserved: ['e:\\out\\show 1998.mp4'] });
    assert.equal(result.path, 'E:\\Out\\Show 1998 (2).mp4');
  });

  test('overwrite keeps the name and says it will replace a file', () => {
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: 'mp4', collision: 'overwrite', exists: existsIn(['E:\\Out\\Show 1998.mp4']) });
    assert.deepEqual(result, { path: 'E:\\Out\\Show 1998.mp4', skip: false, overwrite: true });
  });

  test('skip reports an existing file', () => {
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: 'mp4', collision: 'skip', exists: existsIn(['E:\\Out\\Show 1998.mp4']) });
    assert.deepEqual(result, { path: 'E:\\Out\\Show 1998.mp4', skip: true, overwrite: false });
    const free = outputPathFor({ inputPath: input, folder: 'E:\\Out', extension: 'mp4', collision: 'skip', exists: existsIn([]) });
    assert.equal(free.skip, false);
  });

  test('never returns the input path, even with overwrite or skip', () => {
    const source = 'D:\\Archive\\clip.mp4';
    const exists = existsIn([source]);
    for (const collision of ['rename', 'overwrite', 'skip']) {
      const result = outputPathFor({ inputPath: source, useSourceFolder: true, extension: 'mp4', collision, exists });
      assert.equal(result.path, 'D:\\Archive\\clip (2).mp4', collision);
      assert.equal(result.skip, false, collision);
    }
  });

  test('the input comparison ignores case', () => {
    const result = outputPathFor({ inputPath: 'D:\\Archive\\CLIP.MP4', folder: 'd:\\archive', extension: 'mp4', collision: 'overwrite', exists: existsIn([]) });
    assert.equal(result.path, 'd:\\archive\\CLIP (2).mp4');
  });

  test('uses the template and preset tokens', () => {
    const result = outputPathFor({ inputPath: input, folder: 'E:\\Out', template: '{name} [{preset}]', preset: 'FlowAir Ready 720p', extension: 'mp4', exists: existsIn([]) });
    assert.equal(result.path, 'E:\\Out\\Show 1998 [FlowAir Ready 720p].mp4');
  });

  test('long names are shortened to keep room for the partial suffix', () => {
    const long = `D:\\In\\${'x'.repeat(240)}.avi`;
    const folder = `E:\\${'f'.repeat(60)}`;
    const result = outputPathFor({ inputPath: long, folder, extension: 'mp4', exists: existsIn([]) });
    assert.ok(partialPathFor(result.path).length <= 250);
    assert.ok(result.path.endsWith('.mp4'));
  });

  test('a relative folder is rejected', () => {
    assert.throws(() => outputPathFor({ inputPath: input, folder: 'relative\\dir', extension: 'mp4', exists: existsIn([]) }), TypeError);
  });

  test('partialPathFor appends the suffix', () => {
    assert.equal(partialPathFor('E:\\Out\\a.mp4'), 'E:\\Out\\a.mp4.partial');
  });
});
