const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { summarizeInfo } = require('../src/main/downloader/info');
const { buildDownloadJobs, suggestNames } = require('../src/main/downloader/jobs');
const settingsSchema = require('../src/main/settings');

process.removeAllListeners('warning');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const handlers = {};
const calls = [];
const listeners = new Map();

function invoke(name) {
  return (...args) => {
    calls.push(name);
    try {
      return Promise.resolve(handlers[name] ? handlers[name](...args) : undefined);
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

function subscribe(name) {
  return (callback) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  };
}

globalThis.window = {
  vidaro: {
    settings: { get: invoke('settings.get'), update: invoke('settings.update'), reset: invoke('settings.reset'), onChanged: subscribe('settings') },
    presets: { list: invoke('presets.list'), onChanged: subscribe('presets') },
    dialogs: { pickCookiesFile: invoke('dialogs.pickCookiesFile') },
    download: {
      fetchInfo: invoke('download.fetchInfo'),
      cancelFetch: invoke('download.cancelFetch'),
      suggestName: invoke('download.suggestName'),
      enqueue: invoke('download.enqueue')
    },
    ytdlp: { update: invoke('ytdlp.update') },
    clipboard: { readUrl: invoke('clipboard.readUrl') }
  }
};

const PRESETS = [
  { id: 'flowair-1080p', name: 'FlowAir Ready 1080p', container: 'mp4', video: { mode: 'encode' } },
  { id: 'mp3-320', name: 'MP3 320 kbps', container: 'mp3', video: { mode: 'none' } }
];

let dl;
let settingsStore;
let presetsStore;
let enqueued = null;
const videoUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const video = summarizeInfo(fixture('info-youtube-video.json'), videoUrl);
const playlistUrl = 'https://www.youtube.com/playlist?list=PLa1F2ddGya_-UvuAqHAksYnB0qL9yWDO6';
const playlist = summarizeInfo(fixture('info-youtube-playlist.json'), playlistUrl);

test.before(async () => {
  dl = await import(pathToFileURL(path.join(ROOT, 'src/renderer/state/download.js')).href);
  ({ settingsStore } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/state/settings.js')).href));
  ({ presetsStore } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/state/presets.js')).href));
  settingsSchema.setDefaultFolders({ download: 'C:\\Users\\Test\\Videos\\Vidaro', convert: 'C:\\Users\\Test\\Videos' });
  settingsStore.set(settingsSchema.defaults());
  handlers['settings.update'] = (patch) => settingsSchema.applyPatch(settingsStore.get(), settingsSchema.sanitizePatch(patch));
  handlers['download.suggestName'] = (request) => suggestNames(request);
  handlers['download.enqueue'] = (request) => {
    const after = request.after ? { preset: PRESETS.find((item) => item.id === request.after.presetId), keepOriginal: request.after.keepOriginal } : null;
    const inputs = buildDownloadJobs({ items: request.items, options: request.options, output: request.output, after, group: request.group });
    enqueued = { request, inputs };
    return { ids: inputs.map((_, i) => `j${i}`) };
  };
});

function state() {
  return dl.downloadStore.get();
}

function draft() {
  return dl.computeDraft(state(), settingsStore.get().download, presetsStore.get().list);
}

async function openVideo(info = video, url = videoUrl) {
  handlers['download.fetchInfo'] = () => ({ info: structuredClone(info) });
  assert.equal(await dl.fetchLink(url), true);
  await tick();
}

test('a fetched video fills the draft and suggests a file name', async () => {
  let release;
  handlers['download.fetchInfo'] = () => new Promise((resolve) => (release = resolve));
  const pending = dl.fetchLink(videoUrl);
  assert.equal(state().status, 'fetching');
  assert.deepEqual(state().request, { url: videoUrl, playlist: false });
  release({ info: structuredClone(video) });
  assert.equal(await pending, true);
  await tick();
  assert.equal(state().status, 'ready');
  assert.equal(state().fileName, video.title);
  assert.equal(state().preview, video.title);
  assert.equal(state().nameEdited, false);
  const current = draft();
  assert.equal(current.kind, 'video');
  assert.equal(current.extension, 'mp4');
  assert.deepEqual(current.issues, []);
});

test('invalid links are flagged without calling yt-dlp', async () => {
  const before = calls.length;
  assert.equal(await dl.fetchLink('not a link'), false);
  assert.equal(state().linkInvalid, true);
  assert.equal(calls.slice(before).includes('download.fetchInfo'), false);
  dl.setUrl('https://example.com');
  assert.equal(state().linkInvalid, false);
});

test('a newer link wins over a slower earlier fetch and cancels it', async () => {
  let releaseSlow;
  handlers['download.fetchInfo'] = () => new Promise((resolve) => (releaseSlow = resolve));
  const slow = dl.fetchLink('https://example.com/slow');
  handlers['download.fetchInfo'] = () => ({ info: structuredClone(video) });
  const before = calls.filter((name) => name === 'download.cancelFetch').length;
  const fast = dl.fetchLink('https://example.com/fast');
  assert.equal(calls.filter((name) => name === 'download.cancelFetch').length, before + 1);
  assert.equal(await fast, true);
  releaseSlow({ info: { ...structuredClone(video), title: 'STALE' } });
  assert.equal(await slow, false);
  await tick();
  assert.equal(state().request.url, 'https://example.com/fast');
  assert.equal(state().info.title, video.title);
});

test('cancel returns to idle and ignores the late answer', async () => {
  let release;
  handlers['download.fetchInfo'] = () => new Promise((resolve) => (release = resolve));
  const pending = dl.fetchLink('https://example.com/cancel');
  dl.cancelFetch();
  assert.equal(state().status, 'idle');
  release({ info: structuredClone(video) });
  assert.equal(await pending, false);
  assert.equal(state().status, 'idle');
  assert.equal(state().url, 'https://example.com/cancel');
});

test('template changes replace the name, manual edits survive other changes', async () => {
  await openVideo();
  dl.setFileName('Edited');
  dl.setOption('quality', '720');
  dl.refreshNames();
  await tick();
  assert.equal(state().fileName, 'Edited');
  dl.restoreFileName();
  assert.equal(state().fileName, video.title);
  dl.setFileName('Edited again');
  dl.setOption('nameTemplate', 'channel-title');
  dl.refreshNames();
  await tick();
  assert.equal(state().fileName, `${video.channel} - ${video.title}`);
  dl.setOption('customTemplate', '%(id)s');
  dl.setOption('nameTemplate', 'custom');
  dl.refreshNames();
  await tick(260);
  assert.equal(state().fileName, video.id);
  dl.resetOptions();
  dl.refreshNames();
  await tick();
  assert.equal(state().fileName, video.title);
});

test('adding a video sends a request the main process accepts and keeps the options', async () => {
  await openVideo();
  dl.setOption('rateLimit', '2 MB');
  dl.setOption('container', 'mkv');
  dl.setSectionText('start', '0:30');
  dl.setSectionText('end', '1:30');
  dl.setFileName('Clip for air.mkv');
  assert.equal(await dl.enqueueDraft({ start: false }), true);
  assert.equal(enqueued.request.start, false);
  assert.equal(enqueued.request.group, null);
  assert.equal(enqueued.request.output.folder, 'C:\\Users\\Test\\Videos\\Vidaro');
  const [input] = enqueued.inputs;
  assert.equal(input.spec.output.name, 'Clip for air');
  assert.equal(input.spec.options.container, 'mkv');
  assert.equal(input.spec.options.rateLimit, '2M');
  assert.deepEqual(input.spec.options.section, { start: 30, end: 90 });
  assert.equal(input.spec.info.title, video.title);
  assert.equal(state().status, 'idle');
  assert.equal(state().url, '');
  assert.equal(state().sectionStart, '');
  assert.deepEqual(state().added && { count: state().added.count, started: state().added.started }, { count: 1, started: false });
  assert.equal(state().overrides.container, 'mkv');
  dl.dismissAdded();
  dl.resetOptions();
});

test('blocking issues stop the request and name the problem', async () => {
  await openVideo();
  dl.setOption('proxy', 'ftp://nope');
  const before = calls.filter((name) => name === 'download.enqueue').length;
  assert.equal(await dl.enqueueDraft(), false);
  assert.deepEqual(state().enqueueError, { issue: 'proxy' });
  assert.equal(calls.filter((name) => name === 'download.enqueue').length, before);
  dl.setOption('proxy', '');
  assert.equal(state().enqueueError, null);
  handlers['download.enqueue'] = () => {
    throw new Error("Error invoking remote method 'download:enqueue': Error: Output folder is invalid");
  };
  assert.equal(await dl.enqueueDraft(), false);
  assert.deepEqual(state().enqueueError, { message: 'Output folder is invalid' });
  assert.equal(state().enqueueing, false);
  assert.equal(state().status, 'ready');
  handlers['download.enqueue'] = (request) => {
    const inputs = buildDownloadJobs({ items: request.items, options: request.options, output: request.output, after: null, group: request.group });
    enqueued = { request, inputs };
    return { ids: inputs.map((_, i) => `j${i}`) };
  };
});

test('audio downloads cannot chain a video preset', async () => {
  presetsStore.set((current) => ({ ...current, list: PRESETS, loaded: true }));
  await openVideo();
  dl.setOption('mode', 'audio');
  dl.setOption('afterPreset', 'flowair-1080p');
  assert.equal(draft().presetIssue, 'needs-video');
  assert.ok(draft().issues.includes('preset-video'));
  dl.setOption('afterPreset', 'mp3-320');
  assert.deepEqual(draft().issues, []);
  assert.equal(draft().preset.id, 'mp3-320');
  dl.setOption('afterPreset', 'deleted-preset');
  assert.equal(draft().preset, null);
  assert.deepEqual(draft().issues, []);
  dl.resetOptions();
});

test('playlists select entries, apply ranges and add numbered jobs as one group', async () => {
  handlers['download.enqueue'] = (request) => {
    const after = request.after ? { preset: PRESETS.find((item) => item.id === request.after.presetId), keepOriginal: request.after.keepOriginal } : null;
    const inputs = buildDownloadJobs({ items: request.items, options: request.options, output: request.output, after, group: request.group });
    enqueued = { request, inputs };
    return { ids: inputs.map((_, i) => `j${i}`) };
  };
  presetsStore.set((current) => ({ ...current, list: PRESETS, loaded: true }));
  handlers['download.fetchInfo'] = (url, options) => {
    assert.equal(options.playlist, true);
    return { info: structuredClone(playlist) };
  };
  assert.equal(await dl.fetchLink(playlistUrl, { playlist: true }), true);
  await tick();
  const count = playlist.entries.length;
  assert.equal(state().selection.size, count);
  assert.match(state().preview, /^001 - /);
  dl.setRangeText('2-4, 9');
  dl.applyRange();
  assert.deepEqual([...state().selection].sort((a, b) => a - b), [2, 3, 4, 9]);
  dl.setRangeText('4-2');
  dl.applyRange();
  assert.equal(state().rangeError, true);
  assert.deepEqual([...state().selection].sort((a, b) => a - b), [2, 3, 4, 9]);
  dl.toggleEntry(9);
  dl.toggleEntry(6);
  dl.toggleEntry(8, { shift: true });
  assert.deepEqual([...state().selection].sort((a, b) => a - b), [2, 3, 4, 6, 7, 8]);
  dl.selectAllEntries(false);
  assert.deepEqual(draft().issues, ['selection']);
  dl.selectAllEntries(true);
  dl.setRangeText('1-2');
  dl.applyRange();
  dl.setOption('afterPreset', 'flowair-1080p');
  dl.setOption('keepOriginalAfterConvert', false);
  assert.equal(await dl.enqueueDraft({ start: true }), true);
  assert.equal(enqueued.inputs.length, 2);
  assert.match(enqueued.inputs[0].spec.output.name, /^001 - /);
  assert.match(enqueued.inputs[1].spec.output.name, /^002 - /);
  assert.equal(enqueued.inputs[0].groupTitle, playlist.playlistTitle);
  assert.equal(enqueued.inputs[0].groupId, enqueued.inputs[1].groupId);
  assert.equal(enqueued.inputs[0].spec.after.preset.id, 'flowair-1080p');
  assert.equal(enqueued.inputs[0].spec.after.keepOriginal, false);
  assert.equal(enqueued.inputs[1].spec.info.playlistIndex, 2);
  assert.equal(state().added.started, true);
  dl.resetOptions();
});

test('a list of playlists asks the user to open one', async () => {
  const tabs = summarizeInfo(fixture('info-youtube-playlists-tab.json'), 'https://www.youtube.com/@blender/playlists');
  handlers['download.fetchInfo'] = () => ({ info: structuredClone(tabs) });
  await dl.fetchLink('https://www.youtube.com/@blender/playlists');
  await tick();
  assert.equal(state().selection.size, 0);
  assert.deepEqual(draft().issues, ['lists-only']);
  let asked = null;
  handlers['download.fetchInfo'] = (url, options) => {
    asked = { url, playlist: options.playlist };
    return { info: structuredClone(playlist) };
  };
  dl.openEntryList(tabs.entries[0]);
  await tick();
  assert.deepEqual(asked, { url: tabs.entries[0].url, playlist: true });
});

test('fetch errors offer a yt-dlp update and retry once it is done', async () => {
  const failure = { code: 'http-403', message: 'The site refused the download.', hint: null, action: 'update-ytdlp', retryable: true, detail: 'ERROR: 403' };
  handlers['download.fetchInfo'] = () => ({ error: failure });
  assert.equal(await dl.fetchLink(videoUrl), false);
  assert.equal(state().status, 'error');
  assert.deepEqual(state().error, failure);
  handlers['ytdlp.update'] = () => ({ outcome: 'deferred' });
  await dl.updateAndRetry();
  assert.equal(state().updateNote, 'deferred');
  assert.equal(state().updating, false);
  handlers['ytdlp.update'] = () => {
    throw new Error('offline');
  };
  await dl.updateAndRetry();
  assert.equal(state().updateNote, 'failed');
  handlers['ytdlp.update'] = () => ({ outcome: 'current' });
  await dl.updateAndRetry();
  await tick();
  assert.equal(state().status, 'error');
  assert.equal(state().updateNote, 'current');
  handlers['ytdlp.update'] = () => ({ outcome: 'updated' });
  handlers['download.fetchInfo'] = () => ({ info: structuredClone(video) });
  await dl.updateAndRetry();
  await tick();
  assert.equal(state().status, 'ready');
  assert.equal(state().updateNote, null);
});

test('network overrides are sent with the fetch only when they changed', async () => {
  let seen = null;
  handlers['download.fetchInfo'] = (url, options) => {
    seen = options;
    return { info: structuredClone(video) };
  };
  await dl.fetchLink(videoUrl);
  assert.deepEqual(seen, { playlist: false });
  dl.setOption('cookiesMode', 'browser');
  dl.setOption('cookiesBrowser', 'firefox');
  await dl.fetchLink(videoUrl);
  assert.deepEqual(seen.network, { cookiesMode: 'browser', cookiesBrowser: 'firefox', cookiesFile: '', proxy: '' });
  dl.setOption('proxy', 'bad proxy');
  await dl.fetchLink(videoUrl);
  assert.equal(seen.network, undefined);
  dl.resetOptions();
  handlers['dialogs.pickCookiesFile'] = () => 'C:\\Users\\Test\\cookies.txt';
  await dl.pickCookiesFile();
  assert.equal(state().overrides.cookiesMode, 'file');
  assert.equal(state().overrides.cookiesFile, 'C:\\Users\\Test\\cookies.txt');
  handlers['dialogs.pickCookiesFile'] = () => null;
  dl.resetOptions();
  await dl.pickCookiesFile();
  assert.deepEqual(state().overrides, {});
});

test('the clipboard chip offers each new link once and never starts on its own', async () => {
  dl.resetDraft();
  handlers['clipboard.readUrl'] = () => 'https://vimeo.com/76979871';
  const fetches = calls.filter((name) => name === 'download.fetchInfo').length;
  await dl.offerClipboard(false);
  assert.equal(state().chip, null);
  await dl.offerClipboard(true);
  assert.equal(state().chip, 'https://vimeo.com/76979871');
  dl.dismissChip();
  await dl.offerClipboard(true);
  assert.equal(state().chip, null);
  assert.equal(calls.filter((name) => name === 'download.fetchInfo').length, fetches);
  handlers['clipboard.readUrl'] = () => 'https://vimeo.com/1';
  dl.setUrl('https://vimeo.com/1');
  await dl.offerClipboard(true);
  assert.equal(state().chip, null);
  handlers['clipboard.readUrl'] = () => 'https://vimeo.com/2';
  await dl.offerClipboard(true);
  handlers['download.fetchInfo'] = () => ({ info: structuredClone(video) });
  dl.acceptChip();
  assert.equal(state().chip, null);
  assert.equal(state().request.url, 'https://vimeo.com/2');
  await tick();
  handlers['clipboard.readUrl'] = () => null;
  assert.equal(await dl.pasteFromClipboard(), false);
  assert.ok(state().clipboardNote > 0);
  dl.clearClipboardNote();
  assert.equal(state().clipboardNote, 0);
});

test('save as default writes the chosen options to the settings', async () => {
  await openVideo();
  dl.setOption('subtitles', true);
  dl.setOption('rateLimit', '750k');
  dl.setOption('audioFormat', 'flac');
  dl.setOption('proxy', 'not valid');
  assert.deepEqual(draft().changed.sort(), ['audioFormat', 'proxy', 'rateLimit', 'subtitles']);
  assert.equal(await dl.saveDefaults(), true);
  const saved = settingsStore.get().download;
  assert.equal(saved.subtitles, true);
  assert.equal(saved.rateLimit, '750K');
  assert.equal(saved.audioFormat, 'flac');
  assert.equal(saved.proxy, '');
  assert.equal(draft().options.proxy, 'not valid');
  assert.equal(saved.folder, 'C:\\Users\\Test\\Videos\\Vidaro');
  assert.ok(state().savedToken > 0);
  assert.deepEqual(state().overrides, { proxy: 'not valid' });
  dl.setFolder('D:\\Archive');
  assert.equal(settingsStore.get().download.folder, 'D:\\Archive');
  dl.resetOptions();
});
