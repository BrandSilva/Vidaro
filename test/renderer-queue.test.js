const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { KNOWN_ERRORS } = require('../src/main/errors');

const ROOT = path.join(__dirname, '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

let model;
let labels;
let strings;

test.before(async () => {
  model = await load('src/renderer/pages/queue/model.js');
  labels = await load('src/renderer/pages/queue/labels.js');
  strings = await load('src/renderer/strings/index.js');
});

function job(id, patch = {}) {
  return {
    id,
    kind: 'download',
    state: 'queued',
    title: `Job ${id}`,
    neverStarted: false,
    groupId: null,
    groupTitle: null,
    parentId: null,
    source: `https://example.com/${id}`,
    output: { folder: 'C:\\Videos', name: id },
    download: { mode: 'av', quality: '1080', container: 'mp4', audioFormat: 'mp3', section: null },
    preset: null,
    chained: false,
    trim: null,
    attempts: 0,
    progress: { percent: null, stage: null, speed: null, eta: null, detail: null },
    result: null,
    error: null,
    ...patch
  };
}

function sourceCodes(file, pattern) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

test('filters split jobs into active, finished and failed', () => {
  const jobs = [
    job('a', { state: 'running' }),
    job('b', { state: 'paused', neverStarted: true }),
    job('c', { state: 'done' }),
    job('d', { state: 'canceled' }),
    job('e', { state: 'failed' }),
    job('f', { state: 'interrupted' })
  ];
  assert.deepEqual(model.filterCounts(jobs), { all: 6, active: 3, finished: 2, failed: 1 });
  assert.deepEqual(model.filterJobs(jobs, 'active', []).map((item) => item.id), ['a', 'b', 'f']);
  assert.deepEqual(model.filterJobs(jobs, 'finished', []).map((item) => item.id), ['c', 'd']);
  assert.deepEqual(model.filterJobs(jobs, 'failed', []).map((item) => item.id), ['e']);
  assert.equal(model.filterJobs(jobs, 'all', []), jobs);
});

test('state counts separate ready jobs from paused ones', () => {
  const counts = model.stateCounts([
    job('a', { state: 'paused', neverStarted: true }),
    job('b', { state: 'paused' }),
    job('c', { state: 'interrupted' }),
    job('d', { state: 'running' }),
    job('e', { state: 'queued' }),
    job('f', { state: 'done' }),
    job('g', { state: 'canceled' })
  ]);
  assert.equal(counts.ready, 1);
  assert.equal(counts.paused, 1);
  assert.equal(counts.startable, 3);
  assert.equal(counts.pausable, 2);
  assert.equal(counts.clearable, 2);
  assert.equal(labels.subtitleText(counts), '1 running · 1 waiting · 1 interrupted');
  assert.equal(labels.subtitleText(model.stateCounts([job('a', { state: 'paused', neverStarted: true }), job('b', { state: 'done' })])), '1 ready · 1 finished');
  assert.equal(labels.subtitleText(model.stateCounts([job('a', { state: 'failed' }), job('b', { state: 'canceled' })])), '1 failed · 1 finished');
  assert.equal(labels.subtitleText(model.stateCounts([])), 'Nothing in the queue');
});

test('search matches every word in any field, ignoring case', () => {
  const item = job('a', { title: 'Canción ÉPICA Live', channel: 'Trident', preset: { name: 'FlowAir Ready 1080p' } });
  assert.equal(model.matchesQuery(item, model.normalizeQuery('  canción  live ')), true);
  assert.equal(model.matchesQuery(item, model.normalizeQuery('épica trident')), true);
  assert.equal(model.matchesQuery(item, model.normalizeQuery('flowair 720p')), false);
  assert.equal(model.matchesQuery(item, model.normalizeQuery('example.com/a')), true);
  assert.equal(model.matchesQuery(item, []), true);
});

test('entries group contiguous playlist runs and hide collapsed children', () => {
  const jobs = [
    job('a'),
    job('b', { groupId: 'g1', groupTitle: 'Mix' }),
    job('c', { groupId: 'g1', groupTitle: 'Mix' }),
    job('d'),
    job('e', { groupId: 'g1', groupTitle: 'Mix' }),
    job('f', { groupId: 'g1', groupTitle: 'Mix' }),
    job('g', { groupId: 'g2', groupTitle: 'Solo' })
  ];
  const entries = model.buildEntries(jobs, new Set());
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['a', 'group:g1:0', 'b', 'c', 'd', 'group:g1:1', 'e', 'f', 'g']
  );
  assert.equal(entries[1].title, 'Mix');
  assert.equal(entries[2].first, true);
  assert.equal(entries[3].last, true);
  assert.equal(entries[3].groupKey, 'group:g1:0');
  assert.equal(entries[8].groupKey, null);
  const collapsed = model.buildEntries(jobs, new Set(['g1']));
  assert.deepEqual(collapsed.map((entry) => entry.key), ['a', 'group:g1:0', 'd', 'group:g1:1', 'g']);
  assert.equal(collapsed[1].collapsed, true);
  assert.deepEqual(model.entryIds(collapsed[1]), ['b', 'c']);
});

test('selection supports single, toggle and range clicks across groups', () => {
  const jobs = [job('a'), job('b', { groupId: 'g' }), job('c', { groupId: 'g' }), job('d'), job('e')];
  const entries = model.buildEntries(jobs, new Set(['g']));
  let selection = model.selectEntry(model.EMPTY_SELECTION, entries, 'a');
  assert.deepEqual([...selection.ids], ['a']);
  selection = model.selectEntry(selection, entries, 'd', { range: true });
  assert.deepEqual([...selection.ids].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(selection.anchor, 'a');
  assert.equal(selection.cursor, 'd');
  assert.equal(model.isEntrySelected(entries[1], selection.ids), true);
  selection = model.selectEntry(selection, entries, 'group:g:0', { toggle: true });
  assert.deepEqual([...selection.ids].sort(), ['a', 'd']);
  selection = model.selectEntry(selection, entries, 'e', { toggle: true });
  assert.deepEqual([...selection.ids].sort(), ['a', 'd', 'e']);
  selection = model.selectEntry(selection, entries, 'a', { toggle: true, range: true });
  assert.deepEqual([...selection.ids].sort(), ['a', 'b', 'c', 'd', 'e']);
  selection = model.selectEntry(selection, entries, 'd');
  assert.deepEqual([...selection.ids], ['d']);
  assert.equal(model.selectEntry(selection, entries, 'missing'), selection);
  const all = model.selectAll(selection, entries);
  assert.equal(all.ids.size, 5);
  assert.equal(all.cursor, 'd');
});

test('keyboard cursor moves, extends and clamps', () => {
  const entries = model.buildEntries([job('a'), job('b'), job('c'), job('d')], new Set());
  let selection = model.moveCursor(model.EMPTY_SELECTION, entries, 1);
  assert.equal(selection.cursor, 'a');
  selection = model.moveCursor(selection, entries, 1);
  assert.deepEqual([...selection.ids], ['b']);
  selection = model.moveCursor(selection, entries, 1, { extend: true });
  assert.deepEqual([...selection.ids].sort(), ['b', 'c']);
  selection = model.moveCursor(selection, entries, 'end', { extend: true });
  assert.deepEqual([...selection.ids].sort(), ['b', 'c', 'd']);
  selection = model.moveCursor(selection, entries, -10);
  assert.equal(selection.cursor, 'a');
  selection = model.moveCursor(selection, entries, 'end');
  assert.deepEqual([...selection.ids], ['d']);
  assert.equal(model.moveCursor(selection, [], 1), selection);
});

test('pruning keeps the same selection object when nothing changed', () => {
  const entries = model.buildEntries([job('a'), job('b')], new Set());
  const selection = model.selectEntry(model.EMPTY_SELECTION, entries, 'a');
  assert.equal(model.pruneSelection(selection, entries, new Set(['a', 'b'])), selection);
  const pruned = model.pruneSelection(selection, [entries[1]], new Set(['b']));
  assert.equal(pruned.ids.size, 0);
  assert.equal(pruned.cursor, null);
  assert.equal(pruned.anchor, null);
});

test('drop resolution computes the job to insert before', () => {
  const jobs = [job('a'), job('b'), job('c', { groupId: 'g' }), job('d', { groupId: 'g' }), job('e')];
  const entries = model.buildEntries(jobs, new Set());
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const moving = new Set(['a']);
  assert.deepEqual(model.resolveDrop({ jobs, entry: byKey.get('b'), half: 'bottom', moving }), {
    beforeId: 'c',
    indicator: { key: 'b', edge: 'after' }
  });
  assert.deepEqual(model.resolveDrop({ jobs, entry: byKey.get('e'), half: 'bottom', moving }), {
    beforeId: null,
    indicator: { key: 'e', edge: 'after' }
  });
  assert.equal(model.resolveDrop({ jobs, entry: byKey.get('a'), half: 'top', moving }), null);
  assert.deepEqual(model.resolveDrop({ jobs, entry: byKey.get('c'), half: 'top', moving }), {
    beforeId: 'c',
    indicator: { key: 'group:g:0', edge: 'before' }
  });
  assert.deepEqual(model.resolveDrop({ jobs, entry: byKey.get('d'), half: 'top', moving: new Set(['c']) }), {
    beforeId: 'd',
    indicator: { key: 'd', edge: 'before' }
  });
  assert.deepEqual(model.resolveDrop({ jobs, entry: byKey.get('group:g:0'), half: 'bottom', moving }), {
    beforeId: 'c',
    indicator: { key: 'group:g:0', edge: 'before' }
  });
  const collapsed = model.buildEntries(jobs, new Set(['g']));
  const header = collapsed.find((entry) => entry.type === 'group');
  assert.deepEqual(model.resolveDrop({ jobs, entry: header, half: 'bottom', moving }), {
    beforeId: 'e',
    indicator: { key: 'group:g:0', edge: 'after' }
  });
  assert.equal(model.resolveDrop({ jobs, entry: header, half: 'top', moving: new Set(['c', 'd']) }), null);
  assert.equal(model.resolveDrop({ jobs, entry: byKey.get('b'), half: 'top', moving: new Set() }), null);
});

test('dragging a selected row carries only the selected pending jobs', () => {
  const jobs = [job('a', { state: 'running' }), job('b', { state: 'paused' }), job('c'), job('d', { state: 'done' })];
  assert.deepEqual(model.dragIds(jobs, new Set(['a', 'b', 'c', 'd']), 'c'), ['b', 'c']);
  assert.deepEqual(model.dragIds(jobs, new Set(['a']), 'c'), ['c']);
});

test('row actions and bulk plans follow the queue engine rules', () => {
  assert.deepEqual(model.rowActions(job('a', { state: 'running' })), ['pause', 'cancel']);
  assert.deepEqual(model.rowActions(job('a', { state: 'running' }), true), ['cancel']);
  assert.deepEqual(model.rowActions(job('a', { state: 'paused', neverStarted: true })), ['start', 'remove']);
  assert.deepEqual(model.rowActions(job('a', { state: 'paused' })), ['resume', 'cancel']);
  assert.deepEqual(model.rowActions(job('a', { state: 'interrupted' })), ['resume', 'cancel']);
  assert.deepEqual(model.rowActions(job('a', { state: 'done', result: { path: 'C:\\a.mp4' } })), ['open', 'show', 'remove']);
  assert.deepEqual(model.rowActions(job('a', { state: 'done', result: { path: null } })), ['show', 'remove']);
  assert.deepEqual(model.rowActions(job('a', { state: 'failed' })), ['retry', 'remove']);
  const jobs = [job('a', { state: 'running' }), job('b', { state: 'paused' }), job('c', { state: 'failed' }), job('d', { state: 'done' })];
  assert.deepEqual(model.togglePlan(jobs), { action: 'pause', ids: ['a'] });
  assert.deepEqual(model.togglePlan(jobs.slice(1)), { action: 'resume', ids: ['b'] });
  assert.equal(model.togglePlan(jobs.slice(2)), null);
  const plan = model.bulkPlan(jobs);
  assert.deepEqual(plan.retry, ['c']);
  assert.deepEqual(plan.cancel, ['a', 'b']);
  assert.equal(plan.confirm, 2);
  assert.equal(model.needsRemoveConfirm(job('x', { state: 'done' })), false);
  assert.deepEqual(model.revealTarget(job('x', { state: 'queued' })), { folder: 'C:\\Videos' });
  assert.deepEqual(model.revealTarget(job('x', { result: { path: 'C:\\x.mp4' } })), { file: 'C:\\x.mp4' });
});

test('group progress averages members and ignores canceled ones', () => {
  const members = [
    job('a', { state: 'done' }),
    job('b', { state: 'running', progress: { percent: 10, speed: 100 } }),
    job('c', { state: 'queued' }),
    job('d', { state: 'canceled', progress: { percent: 90 } }),
    job('e', { state: 'running', kind: 'convert', progress: { percent: 50, speed: 2 } })
  ];
  const live = { b: { percent: 40, speed: 1000 } };
  assert.equal(model.groupPercent(members, live), 47.5);
  assert.equal(model.groupSpeed(members, live), 1000);
  assert.equal(model.groupPercent([], {}), 0);
  assert.equal(model.groupState(members).state, 'running');
  assert.equal(model.groupState([job('a', { state: 'failed' }), job('b', { state: 'done' })]).state, 'failed');
  assert.equal(model.groupState([job('a', { state: 'paused' }), job('b', { state: 'failed' })]).state, 'paused');
  assert.equal(model.groupState([job('a', { state: 'done' }), job('b', { state: 'canceled' })]).state, 'done');
  const view = labels.groupView([job('a', { state: 'done' }), job('b', { state: 'failed' }), job('c', { state: 'queued' })]);
  assert.equal(view.summary, '1 of 3 done · 1 failed');
  assert.equal(view.badge.label, 'Waiting');
});

test('stable jobs keep object identity for unchanged jobs', () => {
  const first = model.stabilizeJobs(null, [job('a'), job('b')]);
  const second = model.stabilizeJobs(first, [job('a'), job('b', { state: 'running' })]);
  assert.equal(second.list[0], first.list[0]);
  assert.notEqual(second.list[1], first.list[1]);
  const third = model.stabilizeJobs(second, [job('a'), job('b', { state: 'running' })]);
  assert.equal(third.list, second.list);
  const fourth = model.stabilizeJobs(third, [job('b', { state: 'running' })]);
  assert.equal(fourth.list[0], second.list[1]);
  assert.equal(fourth.list.length, 1);
});

test('collapsed groups are forgotten once their jobs are gone', () => {
  const collapsed = new Set(['g1', 'g2']);
  assert.equal(model.forgetMissingGroups(collapsed, [job('a', { groupId: 'g1' }), job('b', { groupId: 'g2' })]), collapsed);
  assert.deepEqual([...model.forgetMissingGroups(collapsed, [job('a', { groupId: 'g2' })])], ['g2']);
  const empty = new Set();
  assert.equal(model.forgetMissingGroups(empty, []), empty);
});

test('children index maps a download to its conversion', () => {
  const index = model.childIndex([job('a'), job('b', { kind: 'convert', parentId: 'a' }), job('c', { parentId: 'a' })]);
  assert.equal(index.get('a').id, 'b');
  assert.equal(index.has('b'), false);
});

test('chunks and height estimates cover every entry', () => {
  const jobs = Array.from({ length: 95 }, (_, index) => job(`j${index}`, { state: index === 3 ? 'failed' : 'queued' }));
  const entries = model.buildEntries(jobs, new Set());
  const chunks = model.chunkEntries(entries, 40);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [40, 40, 15]);
  assert.equal(model.estimateHeight(chunks[0]), 40 * model.ROW_HEIGHT + model.FAILURE_ESTIMATE);
  assert.notEqual(model.chunkSignature(chunks[0]), model.chunkSignature(chunks[1]));
});

test('target labels describe downloads and conversions', () => {
  assert.equal(labels.targetLabel(job('a')), 'MP4 · 1080p');
  assert.equal(labels.targetLabel(job('a', { download: { mode: 'audio', audioFormat: 'mp3' } })), 'MP3');
  assert.equal(labels.targetLabel(job('a', { download: { mode: 'video', quality: 'best', container: 'mkv' } })), 'MKV · Best · No audio');
  assert.equal(labels.targetLabel(job('a', { kind: 'convert', download: null, preset: { name: 'FlowAir Ready 720p' } })), 'FlowAir Ready 720p');
  assert.deepEqual(
    labels.targetLines(
      job('a', {
        chained: true,
        preset: { name: 'MP4 Universal' },
        download: { mode: 'av', quality: '720', container: 'mp4', section: { start: 60, end: null } }
      })
    ),
    ['MP4 · 720p', 'Only 1:00 to the end', 'Then convert with MP4 Universal']
  );
  assert.deepEqual(
    labels.targetLines(job('a', { kind: 'convert', download: null, preset: { name: 'X' }, trim: { start: null, end: 90 } })),
    ['X', 'Trimmed the start to 1:30']
  );
});

test('badges, progress and speed follow the job state', () => {
  const running = job('a', { state: 'running' });
  assert.deepEqual(labels.badgeFor(running, { stage: 'merging' }), {
    label: 'Merging',
    tone: 'accent',
    hint: 'Joining video and audio into one file'
  });
  assert.equal(labels.badgeFor(running, { stage: 'encoding-pass-1', detail: 'Part 1 of 2' }).hint, 'Encoding, first of two passes · Part 1 of 2');
  assert.equal(labels.badgeFor(running, { stage: 'mystery' }).label, 'Running');
  assert.equal(labels.badgeFor(running, { stage: 'stopping' }).label, 'Stopping');
  assert.equal(labels.badgeFor(job('a', { state: 'paused', neverStarted: true })).label, 'Ready');
  assert.equal(labels.badgeFor(job('a', { state: 'done', result: { skipped: true } })).label, 'Skipped');
  assert.equal(labels.badgeFor(job('a', { state: 'canceled' })).tone, 'muted');

  assert.deepEqual(labels.progressView(running, { percent: 42.7 }), { stopping: false, value: 42.7, tone: undefined, text: '42%' });
  assert.equal(labels.progressView(running, { percent: null }).value, null);
  assert.deepEqual(labels.progressView(job('a', { state: 'queued' }), null), { stopping: false, value: 0, tone: 'muted', text: '' });
  assert.equal(labels.progressView(job('a', { state: 'done' }), null).text, '100%');
  assert.equal(labels.progressView(job('a', { state: 'done' }), null).tone, 'success');
  assert.equal(labels.progressView(job('a', { state: 'done', result: { skipped: true } }), null).tone, 'muted');
  assert.equal(labels.progressView(job('a', { state: 'failed', progress: { percent: 30 } }), null).tone, 'danger');
  assert.equal(labels.progressView(running, { percent: 30, stage: 'stopping' }).tone, 'muted');

  assert.equal(labels.speedText(running, { speed: 1536, eta: 75 }), '1.5 KB/s');
  assert.equal(labels.etaText(running, { speed: 1536, eta: 75 }), '1m 15s');
  assert.equal(labels.speedText({ ...running, kind: 'convert' }, { speed: 2.345 }), '2.3×');
  assert.equal(labels.speedText({ ...running, kind: 'convert' }, { speed: 12.6 }), '13×');
  assert.equal(labels.speedText(running, { speed: 0 }), '');
  assert.equal(labels.speedText(job('a', { state: 'done', result: { size: 1048576 } }), null), '1.0 MB');
  assert.equal(labels.etaText(job('a', { state: 'paused' }), { eta: 10 }), '');
  assert.equal(labels.liveProgress(job('a', { state: 'done', progress: { percent: 100 } }), { percent: 12 }).percent, 100);
});

test('error texts prefer UI strings and keep main variants', () => {
  assert.deepEqual(labels.errorText({ code: 'private-video', message: 'x', hint: 'y' }), {
    message: 'This video is private.',
    hint: 'If your account has access, use cookies from a browser where you are signed in.'
  });
  assert.deepEqual(labels.errorText({ code: 'network', message: 'Could not connect to the proxy.', hint: null }), {
    message: 'Could not connect to the proxy.',
    hint: 'Check the proxy address in Settings, or clear it.'
  });
  assert.equal(labels.errorText({ code: 'network', message: 'Something new.' }).message, 'The network connection failed.');
  assert.deepEqual(labels.errorText({ code: 'brand-new-code', message: 'Main text.', hint: 'Main hint.' }), {
    message: 'Main text.',
    hint: 'Main hint.'
  });
  assert.equal(labels.errorText({ code: 'warnings', message: 'Main text.' }).message, 'Main text.');
  assert.deepEqual(labels.errorText(null), { message: '', hint: null });
  assert.deepEqual(labels.warningLines(['hardware-fallback', 'unknown-code', 'hardware-fallback']), [
    'The graphics encoder failed, so the file was encoded with the software encoder.'
  ]);
  assert.deepEqual(labels.warningLines(null), []);
});

test('every error code produced by main has a UI string', () => {
  const errors = strings.t.errors;
  const optional = (file, pattern) => (fs.existsSync(path.join(ROOT, file)) ? sourceCodes(file, pattern) : []);
  const converterMessages = optional('src/main/converter/errors.js', /^\s{2}'?([a-z0-9-]+)'?: \{/gm);
  const converterCodes = optional('src/main/converter/errors.js', /code: '([a-z0-9-]+)'/g);
  const codes = new Set([
    ...Object.keys(KNOWN_ERRORS),
    ...sourceCodes('src/main/downloader/errors.js', /code: '([a-z0-9-]+)'/g),
    ...sourceCodes('src/main/converter/plan.js', /^\s+'([a-z0-9-]+)': \['/gm),
    ...optional('src/main/downloader/runner.js', /new JobError\('([a-z0-9-]+)'/g),
    ...converterCodes,
    ...converterMessages.filter((key) => !['input-locked', 'encoder-settings', 'unknown'].includes(key)),
    'input-missing',
    'input-unreadable',
    'output-folder-missing',
    'encoder-failed',
    'unsupported-codec',
    'unsupported-copy',
    'verify-failed',
    'verify-duration'
  ]);
  assert.ok(codes.size > 40);
  for (const code of codes) {
    assert.equal(typeof errors[code]?.message, 'string', `missing message for ${code}`);
    assert.equal(typeof errors[code]?.hint, 'string', `missing hint for ${code}`);
  }
});

test('alternate main messages keep their own hints', () => {
  assert.equal(labels.errorText({ code: 'encoder-failed', message: 'The encoder did not accept these settings.' }).hint, 'Try another preset, or lower the quality or bitrate settings.');
  assert.equal(labels.errorText({ code: 'input-unreadable', message: 'The source file could not be opened.' }).message, 'The source file could not be opened.');
  assert.equal(labels.errorText({ code: 'cookies-missing', message: 'The cookies file could not be found.' }).hint, 'Choose the cookies file again in Settings.');
  assert.equal(labels.errorText({ code: 'path-too-long', message: 'The output path is too long for Windows.' }).hint, 'Choose a shorter name template or a folder closer to the drive root.');
  for (const [code, entry] of Object.entries(strings.t.errors)) {
    if (code === 'warnings') continue;
    for (const [message, variant] of Object.entries(entry.variants || {})) {
      assert.equal(variant.message, message, `${code} variant key must equal its message`);
      assert.equal(typeof variant.hint, 'string', `${code} variant needs a hint`);
    }
  }
});

test('every job warning code has a plain text', () => {
  const warnings = strings.t.errors.warnings;
  const codes = new Set([
    'hardware-fallback',
    'encoder-unavailable',
    'encoder-container',
    'audio-reencoded',
    'sponsorblock-failed',
    'subtitles-failed',
    'source-duration-unreliable',
    'bitmap-subtitles',
    'analysis-failed',
    'keep-date-failed',
    'source-not-deleted',
    'skipped-existing',
    ...sourceCodes('src/main/converter/runner.js', /warnings\.push\('([a-z0-9-]+)'\)/g),
    ...sourceCodes('src/main/downloader/runner.js', /warnings?\.push\('([a-z0-9-]+)'\)/g),
    ...sourceCodes('src/main/converter/plan.js', /warnings\.push\('([a-z0-9-]+)'\)/g),
    ...sourceCodes('src/main/converter/filters.js', /warnings\.push\('([a-z0-9-]+)'\)/g),
    ...sourceCodes('src/main/converter/verify.js', /warnings\.push\('([a-z0-9-]+)'\)/g),
    ...sourceCodes('src/main/downloader/errors.js', /result\.push\('([a-z0-9-]+)'\)/g)
  ]);
  for (const code of codes) assert.equal(typeof warnings[code], 'string', `missing warning text for ${code}`);
});

test('every stage code has a short label and a hint', () => {
  const stages = [
    'starting', 'downloading', 'merging', 'converting-audio', 'embedding', 'fixing', 'moving', 'finished',
    'preparing', 'analyzing', 'measuring-loudness', 'encoding-pass-1', 'encoding', 'verifying', 'finishing', 'stopping',
    'remuxing', 'cutting', 'processing',
    ...sourceCodes('src/main/downloader/progress.js', /stage: '([a-z0-9-]+)'/g),
    ...sourceCodes('src/main/converter/runner.js', /stage: '([a-z0-9-]+)'/g)
  ].filter((stage) => stage !== 'probe');
  const queue = strings.t.queue;
  for (const stage of stages) {
    assert.ok(queue.stages[stage] && queue.stages[stage].length <= 12, stage);
    assert.equal(typeof queue.stageHints[stage], 'string', stage);
  }
});
