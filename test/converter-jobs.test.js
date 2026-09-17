const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildConvertJobs, checkOutput, ConvertRequestError } = require('../src/main/converter/jobs');
const { parseProbe } = require('../src/main/converter/media');
const { BUILT_IN } = require('../src/main/presets');
const { Queue } = require('../src/main/queue');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');
const NOW = new Date(2026, 8, 16, 10, 30).getTime();

function media(name, filePath, patch = null) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
  if (patch) patch(data);
  return { ...parseProbe(data, { path: filePath, size: 1000 }), mtimeMs: 1726480000000.5 };
}

function preset(id) {
  return structuredClone(BUILT_IN.find((item) => item.id === id));
}

const DV = 'D:\\Archivo\\Noticias ñ 1998.dv';
const MP3 = 'D:\\Music\\song.mp3';
const OUTPUT = { mode: 'folder', folder: 'E:\\Converted', nameTemplate: '{name}', collision: 'rename', keepDate: false };

describe('buildConvertJobs', () => {
  test('builds one queue input per file following the convert spec', () => {
    const { inputs, errors } = buildConvertJobs({
      files: [{ path: DV, media: media('ntsc-dv', DV), trim: null }],
      preset: preset('flowair-1080p'),
      output: OUTPUT,
      now: NOW
    });
    assert.deepEqual(errors, []);
    assert.equal(inputs.length, 1);
    const [input] = inputs;
    assert.equal(input.kind, 'convert');
    assert.equal(input.title, 'Noticias ñ 1998.dv');
    assert.equal(input.spec.input.path, DV);
    assert.equal(input.spec.input.size, 1000);
    assert.equal(input.spec.input.mtimeMs, 1726480000000.5);
    assert.equal(input.spec.input.media.path, DV);
    assert.ok(input.spec.input.duration > 0);
    assert.equal(input.spec.preset.id, 'flowair-1080p');
    assert.equal(input.spec.preset.builtIn, true);
    assert.deepEqual(input.spec.output, { folder: 'E:\\Converted', name: 'Noticias ñ 1998', baseName: 'Noticias ñ 1998', collision: 'rename', keepDate: false });
    assert.equal(input.spec.trim, null);
    assert.equal(input.spec.deleteInputAfter, false);
  });

  test('the spec survives the queue as plain JSON', (t) => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vidaro-jobs-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const queue = new Queue({ file: path.join(dir, 'queue.json'), runners: { convert: { run: () => new Promise(() => {}) } }, debounceMs: 0 });
    const { inputs } = buildConvertJobs({ files: [{ path: DV, media: media('ntsc-dv', DV) }], preset: preset('mp4-universal'), output: OUTPUT, now: NOW });
    const [id] = queue.add(inputs, { start: false });
    const job = queue.get(id);
    assert.equal(job.state, 'paused');
    assert.deepEqual(job.spec, JSON.parse(JSON.stringify(inputs[0].spec)));
    queue.dispose();
  });

  test('source mode writes next to each file', () => {
    const { inputs } = buildConvertJobs({
      files: [{ path: DV, media: media('ntsc-dv', DV) }],
      preset: preset('mp4-universal'),
      output: { mode: 'source', collision: 'skip', keepDate: true },
      now: NOW
    });
    assert.equal(inputs[0].spec.output.folder, 'D:\\Archivo');
    assert.equal(inputs[0].spec.output.collision, 'skip');
    assert.equal(inputs[0].spec.output.keepDate, true);
  });

  test('name templates use the output resolution, the preset name and the date', () => {
    const { inputs } = buildConvertJobs({
      files: [{ path: DV, media: media('ntsc-dv', DV) }],
      preset: preset('flowair-720p'),
      output: { ...OUTPUT, nameTemplate: '{name}_{resolution} [{preset}] {date}' },
      now: NOW
    });
    assert.equal(inputs[0].spec.output.name, 'Noticias ñ 1998_720p [FlowAir Ready 720p] 2026-09-16');
    const audio = buildConvertJobs({
      files: [{ path: DV, media: media('ntsc-dv', DV) }],
      preset: preset('mp3-320'),
      output: { ...OUTPUT, nameTemplate: '{name}_{resolution}' },
      now: NOW
    });
    assert.equal(audio.inputs[0].spec.output.name, 'Noticias ñ 1998');
  });

  test('templates cannot escape the output folder', () => {
    const { inputs } = buildConvertJobs({
      files: [{ path: DV, media: media('ntsc-dv', DV) }],
      preset: preset('mp4-universal'),
      output: { ...OUTPUT, nameTemplate: '..\\..\\{name}:?' },
      now: NOW
    });
    assert.doesNotMatch(inputs[0].spec.output.name, /[\\/:?]/);
  });

  test('a valid trim is kept, a full-length trim is dropped', () => {
    const item = media('ntsc-dv', DV);
    const { inputs } = buildConvertJobs({
      files: [
        { path: DV, media: item, trim: { start: 0.5, end: 1.25 } },
        { path: DV, media: item, trim: { start: 0, end: null } },
        { path: DV, media: item, trim: { start: null, end: 1 } },
        { path: DV, media: item, trim: { start: 1, end: item.duration + 5 } }
      ],
      preset: preset('mp4-universal'),
      output: OUTPUT,
      now: NOW
    });
    assert.deepEqual(inputs.map((input) => input.spec.trim), [{ start: 0.5, end: 1.25 }, null, { start: null, end: 1 }, { start: 1, end: null }]);
  });

  test('bad files are reported one by one and do not block the others', () => {
    const item = media('ntsc-dv', DV);
    const { inputs, errors } = buildConvertJobs({
      files: [
        { path: DV, media: item, trim: { start: item.duration + 1, end: null } },
        { path: DV, media: item, trim: { start: 2, end: 1 } },
        { path: DV, media: item, trim: { start: -1 } },
        { path: DV, media: item, trim: { start: '1' } },
        { path: 'relative\\clip.avi', media: item },
        { path: DV, media: null },
        { path: MP3, media: media('cover-art-mp3', MP3) },
        null,
        { path: DV, media: item }
      ],
      preset: preset('mp4-universal'),
      output: OUTPUT,
      now: NOW
    });
    assert.equal(inputs.length, 1);
    assert.deepEqual(
      errors.map((error) => error.code),
      ['trim-invalid', 'trim-invalid', 'trim-invalid', 'trim-invalid', 'invalid-path', 'input-unreadable', 'source-has-no-video', 'invalid-path']
    );
    assert.equal(errors[6].path, MP3);
    assert.equal(errors[7].path, null);
    for (const error of errors) {
      assert.equal(typeof error.message, 'string');
      assert.ok(error.message.length > 0);
    }
  });

  test('audio presets accept audio-only files', () => {
    const { inputs, errors } = buildConvertJobs({ files: [{ path: MP3, media: media('cover-art-mp3', MP3) }], preset: preset('wav-48k'), output: OUTPUT, now: NOW });
    assert.deepEqual(errors, []);
    assert.equal(inputs[0].spec.preset.container, 'wav');
  });

  test('deleteInputAfter is only set when asked', () => {
    const { inputs } = buildConvertJobs({ files: [{ path: DV, media: media('ntsc-dv', DV) }], preset: preset('mp4-universal'), output: OUTPUT, deleteInputAfter: true, now: NOW });
    assert.equal(inputs[0].spec.deleteInputAfter, true);
  });

  test('user presets are normalized, unknown fields dropped', () => {
    const custom = { ...preset('mp4-universal'), id: 'my-preset', name: '  Mine  ', builtIn: true, extra: 'x', video: { ...preset('mp4-universal').video, quality: 99 } };
    const { inputs } = buildConvertJobs({ files: [{ path: DV, media: media('ntsc-dv', DV) }], preset: custom, output: OUTPUT, now: NOW });
    const snapshot = inputs[0].spec.preset;
    assert.equal(snapshot.id, 'my-preset');
    assert.equal(snapshot.name, 'Mine');
    assert.equal(snapshot.builtIn, false);
    assert.equal(snapshot.video.quality, 51);
    assert.equal('extra' in snapshot, false);
  });

  test('request level problems throw exposed errors', () => {
    const file = { path: DV, media: media('ntsc-dv', DV) };
    const cases = [
      { files: [], preset: preset('mp4-universal'), output: OUTPUT },
      { files: 'nope', preset: preset('mp4-universal'), output: OUTPUT },
      { files: Array.from({ length: 2001 }, () => file), preset: preset('mp4-universal'), output: OUTPUT },
      { files: [file], preset: null, output: OUTPUT },
      { files: [file], preset: { ...preset('mp4-universal'), name: '' }, output: OUTPUT },
      { files: [file], preset: preset('mp4-universal'), output: null },
      { files: [file], preset: preset('mp4-universal'), output: { ...OUTPUT, folder: 'relative' } },
      { files: [file], preset: preset('mp4-universal'), output: { ...OUTPUT, mode: 'desktop' } },
      { files: [file], preset: preset('mp4-universal'), output: { ...OUTPUT, collision: 'ask' } },
      { files: [file], preset: preset('mp4-universal'), output: { ...OUTPUT, nameTemplate: 'x'.repeat(257) } },
      { files: [file], preset: preset('mp4-universal'), output: { ...OUTPUT, nameTemplate: '   ' } }
    ];
    for (const request of cases) {
      assert.throws(
        () => buildConvertJobs(request),
        (error) => error instanceof ConvertRequestError && error.expose === true && error.message.length > 0
      );
    }
  });

  test('checkOutput fills defaults', () => {
    assert.deepEqual(checkOutput({ folder: 'C:\\Out' }), { mode: 'folder', folder: 'C:\\Out', nameTemplate: '{name}', collision: 'rename', keepDate: false });
    assert.deepEqual(checkOutput({ mode: 'source', folder: 42 }), { mode: 'source', folder: null, nameTemplate: '{name}', collision: 'rename', keepDate: false });
    assert.equal(checkOutput({ folder: '\\\\server\\share\\out' }).folder, '\\\\server\\share\\out');
  });
});
