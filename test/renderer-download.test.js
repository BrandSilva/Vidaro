const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { summarizeInfo } = require('../src/main/downloader/info');
const { buildDownloadJobs, suggestName, suggestNames, OPTION_DEFAULTS } = require('../src/main/downloader/jobs');
const args = require('../src/main/downloader/args');
const { NAME_TEMPLATES } = require('../src/main/downloader/templates');
const settingsSchema = require('../src/main/settings');

process.removeAllListeners('warning');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

let model;
let labels;
let strings;

test.before(async () => {
  model = {
    ...(await load('src/renderer/pages/download/model.js')),
    ...(await load('src/renderer/pages/download/selection.js')),
    ...(await load('src/renderer/pages/download/requests.js'))
  };
  labels = await load('src/renderer/pages/download/labels.js');
  strings = (await load('src/renderer/strings/index.js')).t;
});

function downloadDefaults() {
  settingsSchema.setDefaultFolders({ download: 'C:\\Users\\Test\\Videos\\Vidaro', convert: 'C:\\Users\\Test\\Videos' });
  return settingsSchema.defaults().download;
}

function entry(index, patch = {}) {
  return { kind: 'video', id: `id${index}`, url: `https://example.com/v/${index}`, title: `Clip ${index}`, duration: 60, index, ...patch };
}

test('normalizeLink accepts web links and rejects everything else', () => {
  assert.equal(model.normalizeLink('  https://www.youtube.com/watch?v=abc  '), 'https://www.youtube.com/watch?v=abc');
  assert.equal(model.normalizeLink('http://example.com'), 'http://example.com/');
  assert.equal(model.normalizeLink('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(model.normalizeLink('www.vimeo.com/123'), 'https://www.vimeo.com/123');
  assert.equal(model.normalizeLink('https://ejemplo.es/vídeo ñ'), null);
  assert.equal(model.normalizeLink('https://ejemplo.es/vídeo-ñ'), 'https://ejemplo.es/v%C3%ADdeo-%C3%B1');
  for (const bad of ['', '   ', 'file:///C:/x.mp4', 'javascript:alert(1)', 'ftp://example.com/a', 'not a link', 'hello', 'C:\\Videos\\a.mp4', 'localhost:8080/x', null, 42]) {
    assert.equal(model.normalizeLink(bad), null, String(bad));
  }
  assert.equal(model.normalizeLink(`https://example.com/${'a'.repeat(9000)}`), null);
});

test('linkLabel and sameLink describe links compactly', () => {
  assert.equal(model.linkLabel('https://www.youtube.com/watch?v=abc'), 'youtube.com/watch?v=abc');
  assert.equal(model.linkLabel('https://vimeo.com/'), 'vimeo.com');
  assert.equal(model.linkLabel('nope'), 'nope');
  assert.equal(model.sameLink('youtube.com/watch?v=a', 'https://youtube.com/watch?v=a'), true);
  assert.equal(model.sameLink('https://a.com/1', 'https://a.com/2'), false);
  assert.equal(model.sameLink(null, 'https://a.com'), false);
});

test('looksLikeList recognises YouTube lists and channels', () => {
  for (const url of [
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/watch?list=PL1',
    'https://www.youtube.com/@blender',
    'https://www.youtube.com/@blender/videos',
    'https://m.youtube.com/channel/UC123/playlists',
    'https://youtube.com/c/Name'
  ]) {
    assert.equal(model.looksLikeList(url), true, url);
  }
  for (const url of [
    'https://www.youtube.com/watch?v=abc&list=PL1',
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/shorts/abc',
    'https://www.youtube.com/@blender/community/extra',
    'https://notyoutube.com/playlist',
    'https://vimeo.com/@user',
    undefined
  ]) {
    assert.equal(model.looksLikeList(url), false, String(url));
  }
});

test('option overrides only keep values that differ from the saved defaults', () => {
  const defaults = downloadDefaults();
  let overrides = model.setOverride({}, defaults, 'quality', '720');
  assert.deepEqual(overrides, { quality: '720' });
  overrides = model.setOverride(overrides, defaults, 'quality', defaults.quality);
  assert.deepEqual(overrides, {});
  assert.deepEqual(model.setOverride({}, defaults, 'folder', 'D:\\x'), {});
  overrides = model.setOverride({}, defaults, 'subtitles', true);
  assert.equal(model.effectiveOptions(defaults, overrides).subtitles, true);
  assert.deepEqual(model.changedKeys(defaults, overrides), ['subtitles']);
  assert.deepEqual(model.changedKeys({ ...defaults, subtitles: true }, overrides), []);
});

test('every option key exists in the settings schema and the value lists match the main process', () => {
  const defaults = downloadDefaults();
  for (const key of model.OPTION_KEYS) assert.ok(Object.hasOwn(defaults, key), key);
  assert.deepEqual([...model.DOWNLOAD_OPTION_KEYS, 'section'].sort(), Object.keys(OPTION_DEFAULTS).sort());
  assert.deepEqual(model.QUALITY_CHIPS, args.QUALITIES);
  assert.deepEqual(model.CONTAINERS, args.CONTAINERS);
  assert.deepEqual(model.AUDIO_FORMATS, args.AUDIO_FORMATS);
  assert.deepEqual(model.AUDIO_QUALITIES, args.AUDIO_QUALITIES);
  assert.deepEqual(model.MODES, args.MODES);
  for (const browser of model.BROWSERS) assert.ok(args.BROWSERS.includes(browser), browser);
  assert.deepEqual([...model.TEMPLATES].sort(), Object.keys(NAME_TEMPLATES).sort());
  const normalized = settingsSchema.normalize({ ...settingsSchema.defaults(), download: { ...defaults, nameTemplate: 'custom', cookiesBrowser: 'chromium' } });
  assert.equal(normalized.download.nameTemplate, 'custom');
  assert.equal(normalized.download.cookiesBrowser, 'chromium');
});

test('defaultsPatch saves clean values and drops invalid ones', () => {
  const defaults = downloadDefaults();
  const patch = model.defaultsPatch({ ...defaults, rateLimit: ' 5 MB/s ', proxy: ' socks5://127.0.0.1:1080 ', subtitleLangs: 'en.*, es' });
  assert.equal(patch.rateLimit, '5M');
  assert.equal(patch.proxy, 'socks5://127.0.0.1:1080');
  assert.equal(patch.subtitleLangs, 'en.*,es');
  const bad = model.defaultsPatch({ ...defaults, rateLimit: 'fast', proxy: 'ftp://x', subtitleLangs: '!!', concurrentFragments: 40, nameTemplate: 'custom', customTemplate: '' });
  assert.equal(Object.hasOwn(bad, 'rateLimit'), false);
  assert.equal(Object.hasOwn(bad, 'proxy'), false);
  assert.equal(Object.hasOwn(bad, 'subtitleLangs'), false);
  assert.equal(Object.hasOwn(bad, 'concurrentFragments'), false);
  assert.equal(Object.hasOwn(bad, 'nameTemplate'), false);
  assert.equal(Object.hasOwn(patch, 'folder'), false);
  const clean = settingsSchema.sanitizePatch({ download: patch });
  assert.deepEqual(Object.keys(clean.download).sort(), Object.keys(patch).sort());
});

test('parseRateLimit follows the rules of the argument builder', () => {
  assert.deepEqual(model.parseRateLimit(''), { value: '', valid: true });
  assert.equal(model.parseRateLimit('5M').value, '5M');
  assert.equal(model.parseRateLimit('500k').value, '500K');
  assert.equal(model.parseRateLimit('1.5 MiB/s').value, '1.5M');
  assert.equal(model.parseRateLimit('2048').value, '2048');
  for (const bad of ['100', '0.5K', 'fast', '5T', '-5M', '5M5']) assert.equal(model.parseRateLimit(bad).valid, false, bad);
  const env = { ffmpegDir: 'C:\\bin', tempDir: 'C:\\temp' };
  for (const good of ['5M', '500K', '1.5M', '2048', '1G']) {
    const spec = { url: 'https://example.com/v', options: { rateLimit: model.parseRateLimit(good).value }, output: { folder: 'C:\\out', name: 'x' } };
    assert.doesNotThrow(() => args.buildDownloadArgs(spec, env), good);
  }
});

test('validProxy and validSubtitleLangs match what yt-dlp accepts', () => {
  assert.equal(model.validProxy(''), true);
  assert.equal(model.validProxy('http://127.0.0.1:8080'), true);
  assert.equal(model.validProxy('socks5h://user:pass@host:1080'), true);
  assert.equal(model.validProxy('ftp://host'), false);
  assert.equal(model.validProxy('host:8080'), false);
  assert.equal(model.validProxy('http://a b'), false);
  assert.equal(model.validSubtitleLangs('en.*,es.*'), true);
  assert.equal(model.validSubtitleLangs('en, es'), true);
  assert.equal(model.validSubtitleLangs(''), false);
  assert.equal(model.validSubtitleLangs('-en'), false);
  assert.equal(model.validSubtitleLangs('en;rm'), false);
});

test('parseSection reads clock text and checks it against the duration', () => {
  assert.deepEqual(model.parseSection('', '', 600), { section: null, error: null });
  assert.deepEqual(model.parseSection('0:00', '', 600), { section: null, error: null });
  assert.deepEqual(model.parseSection('1:00', '2:30', 600), { section: { start: 60, end: 150 }, error: null });
  assert.deepEqual(model.parseSection('1:02:03', '', 7200), { section: { start: 3723, end: null }, error: null });
  assert.deepEqual(model.parseSection('90', '', 600), { section: { start: 90, end: null }, error: null });
  assert.deepEqual(model.parseSection('1:00', '20:00', 600), { section: { start: 60, end: null }, error: null });
  assert.equal(model.parseSection('abc', '', 600).error, 'start');
  assert.equal(model.parseSection('', '1:99', 600).error, 'end');
  assert.equal(model.parseSection('2:00', '1:00', 600).error, 'order');
  assert.equal(model.parseSection('11:00', '', 600).error, 'beyond');
  assert.deepEqual(model.parseSection('5:00', '6:00', null), { section: { start: 300, end: 360 }, error: null });
});

test('parseRange selects playlist positions', () => {
  assert.deepEqual(model.parseRange('', 10), { indexes: null, error: false });
  assert.deepEqual(model.parseRange('1-3, 5', 10).indexes, [1, 2, 3, 5]);
  assert.deepEqual(model.parseRange('8 - 20', 10).indexes, [8, 9, 10]);
  assert.deepEqual(model.parseRange('9-', 10).indexes, [9, 10]);
  assert.deepEqual(model.parseRange('-2 7', 10).indexes, [1, 2, 7]);
  assert.deepEqual(model.parseRange('3;3,3', 10).indexes, [3]);
  for (const bad of ['a', '0', '5-2', '11', '1--2', '-', '2-3-4']) assert.equal(model.parseRange(bad, 10).error, true, bad);
});

test('effectiveQuality falls back to what the video really has', () => {
  const heights = [1080, 720, 480, 360, 240];
  assert.equal(model.effectiveQuality('best', heights), 'best');
  assert.equal(model.effectiveQuality('720', heights), '720');
  assert.equal(model.effectiveQuality('2160', heights), '1080');
  assert.equal(model.effectiveQuality('1440', [720, 480]), '720');
  assert.equal(model.effectiveQuality('360', [1080, 720]), '720');
  assert.equal(model.effectiveQuality('720', [240, 144]), 'best');
  assert.equal(model.effectiveQuality('720', []), '720');
  assert.equal(model.effectiveQuality(1080, undefined), '1080');
  assert.equal(model.effectiveQuality('999', heights), 'best');
  assert.equal(model.qualityAvailable('2160', heights), false);
  assert.equal(model.qualityAvailable('2160', []), true);
});

test('mode, extension and compatibility helpers', () => {
  assert.equal(model.effectiveMode('av', { hasVideo: false }), 'audio');
  assert.equal(model.effectiveMode('video', { hasVideo: null }), 'video');
  assert.equal(model.effectiveMode('weird', null), 'av');
  assert.equal(model.fileExtension({ mode: 'audio', audioFormat: 'flac', container: 'mp4' }), 'flac');
  assert.equal(model.fileExtension({ mode: 'video', container: 'mkv' }), 'mkv');
  assert.equal(model.cleanName('  My clip.MP4 ', 'mp4'), 'My clip');
  assert.equal(model.cleanName('clip.mp4.part', 'mp4'), 'clip.mp4.part');
  assert.equal(model.compatibleApplies({ mode: 'av', container: 'webm' }), false);
  assert.equal(model.qualityWarning({ mode: 'av', container: 'mp4', compatible: true }, '2160', 'youtube'), 'youtube');
  assert.equal(model.qualityWarning({ mode: 'av', container: 'mp4', compatible: true }, '1440', 'Vimeo'), 'generic');
  assert.equal(model.qualityWarning({ mode: 'av', container: 'mp4', compatible: false }, '2160', 'youtube'), null);
  assert.equal(model.qualityWarning({ mode: 'av', container: 'mp4', compatible: true }, '1080', 'youtube'), null);
  assert.equal(model.qualityWarning({ mode: 'av', container: 'webm', compatible: true }, '2160', 'youtube'), null);
});

test('estimateBytes uses format sizes and the time range', () => {
  const info = summarizeInfo(fixture('info-youtube-video.json'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  const at1080 = info.sizes.find((item) => item.height <= 1080).bytes;
  assert.equal(model.estimateBytes(info, { mode: 'av', quality: 'best', compatible: true }), at1080);
  assert.equal(model.estimateBytes(info, { mode: 'av', quality: '2160', compatible: true }), at1080);
  assert.equal(model.estimateBytes(info, { mode: 'av', quality: 'best', compatible: false }), info.filesizeApprox);
  assert.equal(model.estimateBytes(info, { mode: 'av', quality: '720', compatible: true }), info.sizes.find((item) => item.height <= 720).bytes);
  const half = model.estimateBytes(info, { mode: 'av', quality: '720', section: { start: 0, end: info.duration / 2 } });
  assert.ok(Math.abs(half - info.sizes.find((item) => item.height <= 720).bytes / 2) <= 1);
  assert.equal(model.estimateBytes(info, { mode: 'audio', quality: 'best' }), null);
  assert.equal(model.estimateBytes({ kind: 'playlist' }, { mode: 'av' }), null);
  assert.equal(model.estimateBytes({ kind: 'video', sizes: [] }, { mode: 'av', quality: '720' }), null);
});

test('playlist selection helpers', () => {
  const entries = [
    entry(1),
    entry(2, { liveStatus: 'is_upcoming' }),
    entry(3, { availability: 'private' }),
    entry(4, { kind: 'playlist' }),
    entry(5, { availability: 'subscriber_only', duration: null }),
    entry(6, { url: null })
  ];
  assert.deepEqual([...model.defaultSelection(entries)], [1, 5]);
  assert.deepEqual(model.selectableIndexes(entries), [1, 2, 3, 5]);
  assert.deepEqual(entries.map(model.entryFlag), [null, 'upcoming', 'private', 'list', 'members', null]);
  let selection = model.toggleSelection(new Set(), entries, 1);
  assert.deepEqual([...selection], [1]);
  selection = model.toggleSelection(selection, entries, 5, { anchor: 1, shift: true });
  assert.deepEqual([...selection].sort(), [1, 2, 3, 5]);
  selection = model.toggleSelection(new Set([1, 2, 3, 5]), entries, 3, { anchor: 5, shift: true });
  assert.deepEqual([...selection].sort(), [1, 2, 3, 5]);
  selection = model.toggleSelection(new Set([2, 3]), entries, 1, { anchor: 5, shift: true });
  assert.deepEqual([...selection], []);
  assert.deepEqual([...model.selectionFromRange(entries, [1, 3, 4, 6, 99])], [1, 3]);
  assert.deepEqual(model.selectAllState(entries, new Set([1])), { all: false, some: true, total: 4, count: 1 });
  assert.deepEqual(model.selectAllState(entries, new Set([1, 2, 3, 5])), { all: true, some: false, total: 4, count: 4 });
  assert.deepEqual(model.durationStats(entries), { seconds: 180, count: 4, unknown: 1 });
  assert.deepEqual(model.durationStats(entries, new Set([1, 5])), { seconds: 60, count: 2, unknown: 1 });
  assert.deepEqual(model.selectedEntries(entries, new Set([4, 5])).map((item) => item.index), [5]);
  assert.equal(model.firstSelectable([entry(1, { kind: 'playlist' }), entry(2)]).index, 2);
});

test('draftIssues lists what blocks a download', () => {
  const options = { ...downloadDefaults() };
  assert.deepEqual(model.draftIssues(options, { kind: 'video', count: 1 }), []);
  assert.deepEqual(model.draftIssues(options, { kind: 'playlist', count: 0, selectable: 3 }), ['selection']);
  assert.deepEqual(model.draftIssues(options, { kind: 'playlist', count: 0, selectable: 0 }), ['lists-only']);
  assert.deepEqual(model.draftIssues(options, { kind: 'playlist', count: 6000, selectable: 6000 }), ['too-many']);
  assert.deepEqual(model.draftIssues(options, { kind: 'video', drm: true, sectionError: 'order' }), ['drm', 'section']);
  assert.deepEqual(model.draftIssues(options, { kind: 'playlist', count: 2, selectable: 2, sectionError: 'order' }), []);
  const broken = { ...options, nameTemplate: 'custom', customTemplate: 'plain', subtitles: true, subtitleLangs: '', rateLimit: 'x', concurrentFragments: 0, cookiesMode: 'file', cookiesFile: '', proxy: 'bad' };
  assert.deepEqual(model.draftIssues(broken, { kind: 'video' }), ['template', 'subtitle-langs', 'rate-limit', 'fragments', 'cookies-file', 'proxy']);
  for (const issue of ['drm', 'selection', 'lists-only', 'too-many', 'section', 'template', 'subtitle-langs', 'rate-limit', 'fragments', 'cookies-file', 'proxy', 'preset-video']) {
    assert.equal(typeof strings.download.issues[issue], 'string', issue);
  }
});

test('preset helpers detect video presets for audio downloads', () => {
  const presets = [
    { id: 'flowair-1080p', name: 'FlowAir', container: 'mp4', video: { mode: 'encode' } },
    { id: 'mp3-320', name: 'MP3', container: 'mp3', video: { mode: 'none' } },
    { id: 'extract-audio', name: 'Extract', container: 'mkv', video: { mode: 'none' } }
  ];
  assert.equal(model.findPreset(presets, 'mp3-320').name, 'MP3');
  assert.equal(model.findPreset(presets, 'gone'), null);
  assert.equal(model.findPreset(null, 'mp3-320'), null);
  assert.equal(model.presetWarning(presets[0], 'audio'), 'needs-video');
  assert.equal(model.presetWarning(presets[0], 'av'), null);
  assert.equal(model.presetWarning(presets[1], 'audio'), null);
  assert.equal(model.presetWarning(presets[2], 'audio'), null);
  assert.equal(model.presetWarning(null, 'audio'), null);
});

test('requests built by the page are accepted by the main process', () => {
  const defaults = downloadDefaults();
  const video = summarizeInfo(fixture('info-youtube-video.json'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  const options = { ...model.effectiveOptions(defaults, { rateLimit: '2 MB', proxy: ' http://127.0.0.1:3128 ', subtitles: true, subtitleLangs: 'en, es' }) };
  const section = { start: 30, end: 90 };
  const request = model.requestOptions(options, { mode: 'av', quality: '1080', section });
  assert.deepEqual(Object.keys(request).sort(), [...model.DOWNLOAD_OPTION_KEYS, 'section'].sort());
  assert.equal(request.rateLimit, '2M');
  assert.equal(request.proxy, 'http://127.0.0.1:3128');
  assert.equal(request.subtitleLangs, 'en,es');
  assert.equal(request.cookiesFile, '');
  const name = suggestName(model.nameRequest(video, { ...options, nameTemplate: 'channel-title' }));
  assert.equal(name, `${video.channel} - ${video.title}`);
  const [job] = buildDownloadJobs({
    items: [{ url: video.url, info: model.videoInfoPayload(video, video.url), name }],
    options: request,
    output: { folder: defaults.folder, collision: defaults.collision }
  });
  assert.equal(job.spec.output.name, name);
  assert.deepEqual(job.spec.options.section, section);
  assert.equal(job.spec.info.channel, video.channel);

  const playlist = summarizeInfo(fixture('info-youtube-playlist.json'), 'https://www.youtube.com/playlist?list=x');
  const entries = playlist.entries.slice(0, 3);
  const numbered = { ...options, nameTemplate: 'title', numberPlaylist: true };
  const names = suggestNames(model.batchNameRequest(playlist, numbered, entries));
  assert.equal(names.length, 3);
  const width = Math.max(3, String(model.playlistCount(playlist)).length);
  assert.equal(names[0], `${String(entries[0].index).padStart(width, '0')} - ${entries[0].title}`);
  assert.equal(suggestName(model.nameRequest(playlist, numbered, { entry: entries[0] })), names[0]);
  assert.equal(suggestName(model.nameRequest(playlist, { ...numbered, numberPlaylist: false }, { entry: entries[0] })), entries[0].title);
  const custom = { ...options, nameTemplate: 'custom', customTemplate: '%(playlist_title)s - %(title)s', numberPlaylist: false };
  assert.equal(suggestNames(model.batchNameRequest(playlist, custom, entries))[1], `${playlist.playlistTitle} - ${entries[1].title}`);
  const jobs = buildDownloadJobs({
    items: entries.map((item, i) => ({ url: item.url, info: model.entryInfoPayload(playlist, item), name: names[i] })),
    options: model.requestOptions(options, { mode: 'audio', quality: 'best', section: null }),
    output: { folder: defaults.folder, collision: 'skip' },
    group: { title: playlist.playlistTitle }
  });
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].groupTitle, playlist.playlistTitle);
  assert.equal(jobs[2].spec.info.playlistIndex, entries[2].index);
  assert.equal(jobs[0].spec.options.section, null);
});

test('nameBasis changes only when the name inputs change', () => {
  const info = { kind: 'video', id: 'a', url: 'https://x/a' };
  const base = { nameTemplate: 'title', customTemplate: '%(id)s', numberPlaylist: true };
  assert.equal(model.nameBasis(info, base), model.nameBasis(info, { ...base, customTemplate: 'changed', numberPlaylist: false }));
  assert.notEqual(model.nameBasis(info, base), model.nameBasis(info, { ...base, nameTemplate: 'custom' }));
  assert.notEqual(model.nameBasis({ ...info, kind: 'playlist' }, base), model.nameBasis({ ...info, kind: 'playlist' }, { ...base, numberPlaylist: false }));
  assert.equal(model.nameBasis(null, base), '');
  assert.equal(model.templateInvalid({ nameTemplate: 'custom', customTemplate: '%(title)s' }), false);
  assert.equal(model.templateInvalid({ nameTemplate: 'custom', customTemplate: 'name' }), true);
  assert.equal(model.templateInvalid({ nameTemplate: 'title', customTemplate: '' }), false);
});

test('remoteMessage and windowRange', () => {
  assert.equal(model.remoteMessage(new Error("Error invoking remote method 'download:enqueue': Error: Rate limit is invalid")), 'Rate limit is invalid');
  assert.equal(model.remoteMessage(new Error("Error invoking remote method 'x': TypeError: Bad")), 'Bad');
  assert.equal(model.remoteMessage('Plain'), 'Plain');
  assert.equal(model.remoteMessage(null), null);
  assert.deepEqual(model.windowRange(0, 360, 36, 1000), { start: 0, end: 16 });
  assert.deepEqual(model.windowRange(3600, 360, 36, 1000), { start: 94, end: 116 });
  assert.deepEqual(model.windowRange(35900, 360, 36, 1000), { start: 991, end: 1000 });
  assert.deepEqual(model.windowRange(0, 0, 36, 0), { start: 0, end: 0 });
});

test('labels summarize the download in plain words', () => {
  const base = { mode: 'av', quality: '1080', container: 'mp4', compatible: true, audioFormat: 'mp3', audioQuality: '320' };
  assert.equal(labels.summaryText(base, { kind: 'video', estimate: 250 * 1024 * 1024 }), 'MP4 · 1080p · H.264 + AAC · ≈ 250 MB');
  assert.equal(labels.summaryText({ ...base, mode: 'audio' }, { kind: 'playlist', count: 12 }), '12 videos · MP3 · 320 kbps');
  assert.equal(labels.summaryText({ ...base, mode: 'audio', audioFormat: 'wav' }, { kind: 'playlist', count: 1 }), '1 video · WAV');
  assert.equal(labels.summaryText({ ...base, container: 'webm', quality: '2160', mode: 'video' }, { kind: 'video' }), 'WebM · 4K · No audio');
  assert.equal(
    labels.summaryText({ ...base, quality: 'best', compatible: false }, { kind: 'video', section: { start: 60, end: 3725 }, preset: { name: 'FlowAir Ready 1080p' } }),
    'MP4 · Best quality · 01:00–01:02:05 · then FlowAir Ready 1080p'
  );
  const defaults = downloadDefaults();
  assert.equal(labels.moreSummary(defaults, { hasSection: false }), strings.download.more.defaults);
  assert.equal(
    labels.moreSummary({ ...defaults, subtitles: true, sponsorBlock: true, rateLimit: '5m', cookiesMode: 'browser', proxy: 'http://p:1' }, { hasSection: true }),
    'Subtitles · SponsorBlock · Time range · Limit 5M/s · Cookies · Proxy'
  );
  assert.equal(labels.qualityLabel('2160'), '4K');
  assert.equal(labels.qualityLabel('best'), 'Best');
  assert.equal(labels.durationText({ seconds: 3700, unknown: 1 }), '1:01:40+');
  assert.equal(labels.durationText({ seconds: 0, unknown: 3 }), '');
});

test('errorView maps known codes and keeps unknown messages', () => {
  assert.equal(labels.errorView({ code: 'private-video', message: 'x' }).message, strings.errors['private-video'].message);
  assert.equal(labels.errorView({ code: 'network', message: 'Could not connect to the proxy.' }).hint, strings.errors.network.variants['Could not connect to the proxy.'].hint);
  assert.deepEqual(labels.errorView({ code: 'mystery', message: 'Odd failure', hint: 'Try later' }), { message: 'Odd failure', hint: 'Try later' });
  assert.equal(labels.errorView({ code: 'unexpected', message: null }).message, strings.errors.unexpected.message);
  assert.deepEqual(labels.errorView(null), { message: '', hint: null });
});

test('download strings cover every template, flag and option value', () => {
  const d = strings.download;
  for (const id of model.TEMPLATES) assert.equal(typeof d.templates[id], 'string', id);
  for (const flag of ['upcoming', 'live', 'private', 'members', 'login']) {
    assert.equal(typeof d.playlist.flags[flag], 'string', flag);
    assert.equal(typeof d.playlist.flagHints[flag], 'string', flag);
  }
  for (const value of model.CONTAINERS) assert.equal(typeof d.options.containers[value], 'string');
  for (const value of model.AUDIO_FORMATS) assert.equal(typeof d.options.audioFormats[value], 'string');
  for (const value of model.AUDIO_QUALITIES) assert.equal(typeof d.options.audioQualities[value], 'string');
  for (const value of model.BROWSERS) assert.equal(typeof d.more.browsers[value], 'string');
  for (const value of model.COOKIE_MODES) assert.equal(typeof d.more.cookieModes[value], 'string');
  for (const value of model.MODES) assert.equal(typeof d.options.modes[value], 'string');
  for (const value of ['start', 'end', 'order', 'beyond']) assert.equal(typeof d.more.rangeErrors[value], 'string');
  assert.equal(d.playlist.videos(1), '1 video');
  assert.equal(d.added.started(3), '3 downloads started');
});
