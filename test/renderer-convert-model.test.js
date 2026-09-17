const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseProbe } = require('../src/main/converter/media');
const plan = require('../src/main/converter/plan');
const { renderOutputName } = require('../src/main/converter/names');
const presets = require('../src/main/presets');

process.removeAllListeners('warning');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'converter');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

let model;
let strings;

test.before(async () => {
  model = await load('src/renderer/pages/convert/model.js');
  strings = (await load('src/renderer/strings/index.js')).t;
});

function media(name) {
  const file = `C:\\Media\\${name}`;
  return { ...parseProbe(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'), { path: file }), path: file };
}

function entry(id, patch = {}) {
  return {
    id,
    key: `c:\\media\\${id}.mp4`,
    path: `C:\\Media\\${id}.mp4`,
    status: 'ready',
    media: { size: 1000, duration: 10, durationReliable: true, warnings: [], video: null, audio: [] },
    trim: null,
    analysis: null,
    ...patch
  };
}

test('file keys ignore case, slash direction and Unicode form', () => {
  assert.equal(model.fileKey('C:/Videos/Clip.AVI'), model.fileKey('c:\\videos\\clip.avi'));
  assert.equal(model.fileKey('C:\\Vídeos\\a.mp4'), model.fileKey('C:\\Vi\u0301deos\\A.mp4'));
  assert.equal(model.fileKey(null), '');
});

test('mergePaths skips duplicates and respects the limit', () => {
  const result = model.mergePaths([model.fileKey('C:\\a.mp4')], ['C:\\A.MP4', 'C:\\b.mp4', 'C:/b.mp4', '', 42, 'C:\\c.mp4', 'C:\\d.mp4'], 3);
  assert.deepEqual(
    result.accepted.map((item) => item.path),
    ['C:\\b.mp4', 'C:\\c.mp4']
  );
  assert.equal(result.duplicates, 2);
  assert.equal(result.overflow, 1);
  assert.equal(result.accepted[0].key, 'c:\\b.mp4');
});

test('list totals count states, sizes and trimmed durations', () => {
  const files = [
    entry('a'),
    entry('b', { trim: { start: 2, end: 6 } }),
    entry('c', { status: 'probing', media: null }),
    entry('d', { status: 'error', media: null }),
    entry('e', { trim: { start: 4, end: null } })
  ];
  assert.deepEqual(model.listTotals(files), { count: 5, ready: 3, probing: 1, failed: 1, size: 3000, duration: 20 });
  assert.equal(model.effectiveDuration({ duration: null }, { start: 1, end: null }), null);
  assert.equal(model.effectiveDuration({ duration: null }, { start: 1, end: 5 }), 4);
  assert.equal(model.effectiveDuration(null, null), null);
});

test('media chips come from real probe fixtures', () => {
  const codes = (name, analysis = null) => model.mediaChips(media(name), analysis).map((chip) => chip.code);
  assert.deepEqual(codes('ntsc-dv'), ['interlaced', 'anamorphic']);
  assert.deepEqual(codes('xvid-avi'), ['field-order-unknown']);
  assert.deepEqual(codes('truncated-avi'), ['field-order-unknown', 'duration-estimated']);
  assert.deepEqual(codes('vfr-mp4'), ['vfr']);
  assert.deepEqual(codes('hdr10-mp4'), ['no-audio', 'hdr']);
  assert.deepEqual(codes('rotated-mp4'), ['no-audio', 'rotated']);
  assert.deepEqual(codes('cover-art-mp3'), []);
  assert.deepEqual(codes('h264-1080p5994'), []);
  const unknown = model.mediaChips(media('xvid-avi'), null)[0];
  assert.equal(unknown.analyze, true);
  assert.equal(unknown.tone, 'warning');
  const analyzed = { status: 'done', result: { verdict: 'tff', telecine: false } };
  assert.deepEqual(codes('xvid-avi', analyzed), []);
  assert.deepEqual(codes('ntsc-dv', analyzed), ['anamorphic']);
  assert.deepEqual(codes('xvid-avi', { status: 'running', result: null }), ['field-order-unknown']);
  assert.deepEqual(model.mediaChips(null), []);
});

test('every chip and media warning has a label and a hint', () => {
  const c = strings.convert;
  const warningCodes = new Set();
  for (const file of fs.readdirSync(FIXTURES).filter((name) => name.startsWith('probe-'))) {
    const parsed = parseProbe(fs.readFileSync(path.join(FIXTURES, file), 'utf8'), { path: `C:\\${file}` });
    parsed.warnings.forEach((code) => warningCodes.add(code));
  }
  for (const code of ['interlaced', 'soft-telecine', 'field-order-unknown', 'vfr', 'hdr', 'duration-estimated', 'anamorphic', 'rotated', 'bitmap-subtitles', 'no-audio', ...warningCodes]) {
    if (code === 'no-video') continue;
    assert.ok(c.chips[code], `label for ${code}`);
    assert.ok(c.chipHints[code], `hint for ${code}`);
  }
  const planCodes = ['encoder-mismatch', 'encoder-container', 'encoder-unavailable', 'ivtc-not-applicable', 'two-pass-unavailable', 'trim-keyframes', 'copy-ignores-picture', 'audio-reencoded', 'subtitles-dropped', 'no-audio'];
  for (const code of planCodes) assert.ok(c.planWarnings[code], `plan warning ${code}`);
});

test('plan warnings shown before converting cover what describe can report', () => {
  const c = strings.convert;
  const seen = new Set();
  const files = fs.readdirSync(FIXTURES).filter((name) => name.startsWith('probe-'));
  for (const file of files) {
    const parsed = media(file.slice(6, -5));
    for (const preset of presets.BUILT_IN) {
      for (const variant of [preset, { ...preset, video: { ...preset.video, twoPass: true, rateControl: 'bitrate' }, picture: { ...preset.picture, ivtc: 'on' } }]) {
        const described = plan.describe(variant, parsed, { encoder: 'h264_qsv', trim: { start: 1, end: null } });
        described.warnings.forEach((code) => seen.add(code));
      }
    }
  }
  for (const code of seen) assert.ok(c.planWarnings[code], `missing text for ${code}`);
});

test('analysis results map to a label key and tone', () => {
  assert.deepEqual(model.analysisView({ verdict: 'progressive', telecine: false }), { key: 'progressive', tone: 'success' });
  assert.deepEqual(model.analysisView({ verdict: 'bff', telecine: false }), { key: 'bff', tone: 'info' });
  assert.deepEqual(model.analysisView({ verdict: 'tff', telecine: true }), { key: 'telecine', tone: 'accent' });
  assert.deepEqual(model.analysisView({ verdict: 'unknown', telecine: false }), { key: 'unknown', tone: 'warning' });
  assert.equal(model.analysisView(null), null);
  for (const key of ['progressive', 'tff', 'bff', 'telecine', 'unknown']) {
    assert.ok(strings.convert.analysis[key]);
    assert.ok(strings.convert.analysisHints[key]);
  }
});

test('trim input is parsed and validated against the duration', () => {
  const file = { duration: 120, durationReliable: true };
  assert.deepEqual(model.parseTrim('', '', file), { ok: true, trim: null });
  assert.deepEqual(model.parseTrim('00:00:10', '', file), { ok: true, trim: { start: 10, end: null } });
  assert.deepEqual(model.parseTrim('0:10.5', '1:00', file), { ok: true, trim: { start: 10.5, end: 60 } });
  assert.deepEqual(model.parseTrim('00:00:00.000', '00:02:00', file), { ok: true, trim: null });
  assert.deepEqual(model.parseTrim('', '00:01:30.250', file), { ok: true, trim: { start: null, end: 90.25 } });
  assert.deepEqual(model.parseTrim('15', '20', file), { ok: true, trim: { start: 15, end: 20 } });
  let result = model.parseTrim('ab', '', file);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'start');
  result = model.parseTrim('', '1:75', file);
  assert.equal(result.field, 'end');
  result = model.parseTrim('00:02:00', '', file);
  assert.equal(result.field, 'start');
  assert.match(result.error, /2:00/);
  result = model.parseTrim('', '00:02:01', file);
  assert.equal(result.field, 'end');
  result = model.parseTrim('00:01:00', '00:00:30', file);
  assert.equal(result.field, 'end');
  assert.equal(result.error, strings.convert.trimErrors.startAfterEnd);
  assert.deepEqual(model.parseTrim('00:05:00', '', { duration: 120, durationReliable: false }), { ok: true, trim: { start: 300, end: null } });
});

test('trim fields and labels round-trip', () => {
  assert.deepEqual(model.trimFields(null), { start: '', end: '' });
  assert.deepEqual(model.trimFields({ start: 10.5, end: 90.25 }), { start: '00:00:10.500', end: '00:01:30.250' });
  assert.deepEqual(model.trimFields({ start: null, end: 3 }), { start: '', end: '00:00:03.000' });
  const fields = model.trimFields({ start: 3723.004, end: null });
  assert.deepEqual(model.parseTrim(fields.start, fields.end, null), { ok: true, trim: { start: 3723.004, end: null } });
  assert.equal(model.trimText(null), '');
  assert.equal(model.trimText({ start: 10, end: null }), 'Trim 00:00:10 – end');
  assert.equal(model.trimText({ start: null, end: 75 }), 'Trim 00:00:00 – 00:01:15');
});

test('name templates must keep the {name} token', () => {
  assert.equal(model.isValidTemplate('{name}'), true);
  assert.equal(model.isValidTemplate('{name}_{resolution}'), true);
  assert.equal(model.isValidTemplate('clip'), false);
  assert.equal(model.isValidTemplate('{NAME}'), false);
  assert.equal(model.isValidTemplate('   '), false);
  assert.equal(model.isValidTemplate(`{name}${'x'.repeat(300)}`), false);
  assert.equal(model.isValidTemplate(null), false);
  for (const chip of strings.convert.nameChips) assert.equal(model.isValidTemplate(chip), true, chip);
});

test('name preview matches the main renderer for common templates', () => {
  const now = new Date(2026, 8, 16).getTime();
  const cases = [
    ['{name}', { name: 'Holiday', preset: 'MP4 Universal', resolution: '720p' }],
    ['{name}_{resolution}', { name: 'Holiday', preset: 'MP4 Universal', resolution: '720p' }],
    ['{name} [{preset}]', { name: 'Holiday', preset: 'FlowAir Ready 1080p', resolution: '1080p' }],
    ['{name} [{preset}]', { name: 'Holiday', preset: '', resolution: '' }],
    ['{name}_{resolution}', { name: 'Song', preset: 'MP3 320 kbps', resolution: '' }],
    ['{date} {name}', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}<>', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}: part', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}_{resolution}_', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}_', { name: 'Clip', preset: '', resolution: '' }],
    ['a/b {name}', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}  [x]', { name: 'Clip', preset: '', resolution: '' }],
    ['{name}.', { name: 'Clip', preset: '', resolution: '' }],
    ['({preset}) {name} - {resolution}', { name: 'Día de campo 🎉', preset: '', resolution: '' }],
    ['{name} [{preset}] {resolution}', { name: 'Clip', preset: 'A/B', resolution: '480p' }],
    ['{name} {Resolution}', { name: 'Clip', preset: '', resolution: '720p' }]
  ];
  for (const [template, values] of cases) {
    const expected = renderOutputName(template, { ...values, date: now });
    assert.equal(model.previewName(template, { ...values, now }), expected, template);
  }
  assert.equal(model.previewName('{name}', { name: 'Clip', extension: 'mp4' }), 'Clip.mp4');
  assert.equal(model.previewName('bad', { name: 'Clip', extension: 'mka' }), 'Clip.mka');
  assert.equal(model.previewName('{name}', { name: '', extension: 'mp4' }), 'video.mp4');
});

test('output extension matches the converter', () => {
  for (const preset of presets.BUILT_IN) assert.equal(model.outputExtension(preset), plan.outputExtension(preset), preset.id);
  assert.equal(model.outputExtension(null), '');
  assert.equal(model.sourceBaseName('C:\\Videos\\My.Clip.avi'), 'My.Clip');
});

test('plan helpers read resolution, problems and totals', () => {
  const dv = media('ntsc-dv');
  const flowair = presets.BUILT_IN.find((preset) => preset.id === 'flowair-720p');
  const described = plan.describe(flowair, dv);
  assert.equal(model.planResolution(described), '720p');
  assert.equal(model.planResolution({ lines: ['MP3 · 320 kbps'] }), '');
  assert.equal(model.planResolution(null), '');
  assert.equal(model.planProblem(described), null);
  const noAudio = plan.describe(presets.BUILT_IN.find((preset) => preset.id === 'mp3-320'), media('no-audio-mp4'));
  assert.deepEqual(model.planProblem(noAudio), { message: 'This file has no audio.', hint: 'Pick a video preset instead.' });
  const files = [entry('a'), entry('b', { trim: { start: 0, end: 5 } }), entry('c'), entry('d', { status: 'probing' })];
  const plans = { a: { estimateBytes: 100, errors: [] }, b: { estimateBytes: 50, errors: [] } };
  assert.deepEqual(model.planTotals(files, plans), { bytes: 250, partial: true, ready: 3, convertible: 3 });
  const blocked = { ...plans, c: { estimateBytes: null, errors: [{ message: 'No' }] } };
  assert.deepEqual(model.planTotals(files, blocked), { bytes: 150, partial: false, ready: 3, convertible: 2 });
  assert.deepEqual(model.planTotals(files, {}), { bytes: null, partial: false, ready: 3, convertible: 3 });
});

test('plan signature changes with trims and analysis, not thumbnails', () => {
  const files = [entry('a'), entry('b')];
  const base = model.planSignature(files);
  assert.equal(model.planSignature([{ ...files[0], thumbnail: 'data:image/jpeg;base64,x' }, files[1]]), base);
  assert.notEqual(model.planSignature([{ ...files[0], trim: { start: 1, end: null } }, files[1]]), base);
  assert.notEqual(model.planSignature([{ ...files[0], analysis: { status: 'done', result: { verdict: 'bff', telecine: false } } }, files[1]]), base);
  assert.equal(model.planSignature([{ ...files[0], analysis: { status: 'running', result: null } }, files[1]]), base);
  assert.notEqual(model.planSignature([files[0]]), base);
  const many = Array.from({ length: model.PREVIEW_LIMIT + 5 }, (_, index) => entry(`f${index}`));
  assert.equal(model.planSignature(many).split('|').length, model.PREVIEW_LIMIT);
});

test('enqueue blocker explains what is missing, in order', () => {
  const c = strings.convert;
  const output = { mode: 'folder', folder: 'C:\\Out', nameTemplate: '{name}' };
  const totals = { probing: 0, ready: 2 };
  assert.equal(model.enqueueBlocker({ totals: { probing: 1, ready: 2 }, problems: [], output }), c.waitProbing);
  assert.equal(model.enqueueBlocker({ totals: { probing: 0, ready: 0 }, problems: [], output }), c.nothingReady);
  assert.equal(model.enqueueBlocker({ totals, problems: [{}], output }), c.fixSettings);
  assert.equal(model.enqueueBlocker({ totals, problems: [], output: { ...output, folder: '' } }), c.needFolder);
  assert.equal(model.enqueueBlocker({ totals, problems: [], output: { ...output, mode: 'source', folder: '' } }), null);
  assert.equal(model.enqueueBlocker({ totals, problems: [], output: { ...output, nameTemplate: 'x' } }), c.nameTemplateInvalid);
  assert.equal(model.enqueueBlocker({ totals, problems: [], output }), null);
});

test('enqueue outcome separates added and rejected files', () => {
  const sent = [
    { id: 'f1', key: model.fileKey('C:\\A.mp4') },
    { id: 'f2', key: model.fileKey('C:\\b.mp4') },
    { id: 'f3', key: model.fileKey('C:\\c.mp4') }
  ];
  const errors = [
    { path: 'c:/a.MP4', code: 'source-has-no-audio', message: 'This file has no audio.', hint: 'Pick a video preset instead.' },
    { path: null, code: 'invalid-path', message: 'This file path is not valid.' }
  ];
  const outcome = model.enqueueOutcome(sent, errors);
  assert.deepEqual(outcome.done, ['f2', 'f3']);
  assert.deepEqual(outcome.rejected, [{ id: 'f1', error: { message: 'This file has no audio.', hint: 'Pick a video preset instead.' } }]);
  assert.equal(outcome.orphanErrors.length, 1);
  assert.deepEqual(model.enqueueOutcome(sent, undefined).done, ['f1', 'f2', 'f3']);
});
