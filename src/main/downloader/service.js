const fs = require('node:fs');
const path = require('node:path');
const { createYtDlpManager } = require('./ytdlp-manager');
const { createDownloadRunner } = require('./runner');
const { createMetadataFetcher } = require('./metadata');
const { buildDownloadJobs, suggestNames } = require('./jobs');

function readBundledVersion(binDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(binDir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
    return typeof manifest['yt-dlp'] === 'string' ? manifest['yt-dlp'] : null;
  } catch {
    return null;
  }
}

function createDownloaderService({ paths, getSettings, updateSettings, isBusy = () => false }) {
  const binDir = paths.bundledBinDir();
  const tempDir = paths.tempDir();
  const cacheDir = path.join(paths.cacheDir(), 'yt-dlp');
  const jsRuntime = paths.jsRuntime();
  const ytdlp = createYtDlpManager({
    bundledPath: paths.bundledYtDlpPath(),
    bundledVersion: readBundledVersion(binDir),
    userBinDir: paths.userBinDir(),
    runtimeDir: path.join(tempDir, 'runtime'),
    jsRuntime,
    getSettings,
    updateSettings,
    isBusy
  });
  const runner = createDownloadRunner({ ytdlp, ffmpegDir: path.dirname(paths.ffmpegPath()), tempDir, cacheDir, jsRuntime });
  const fetcher = createMetadataFetcher({ ytdlp, jsRuntime, cacheDir, getSettings });
  let started = false;

  function start() {
    if (started) return;
    started = true;
    fs.promises
      .mkdir(path.join(tempDir, 'runtime'), { recursive: true })
      .then(() => ytdlp.sweepRuntime())
      .catch(() => undefined);
    ytdlp.ensure().catch(() => undefined);
    ytdlp.scheduleDaily();
  }

  function onStatus(listener) {
    ytdlp.on('status', listener);
    return () => ytdlp.off('status', listener);
  }

  function dispose() {
    fetcher.dispose();
    ytdlp.dispose();
  }

  return {
    runner,
    ytdlp,
    fetchInfo: (url, options) => fetcher.fetch(url, options),
    cancelFetch: () => fetcher.cancel(),
    suggestName: (request) => suggestNames(request),
    buildJobs: (request) => buildDownloadJobs(request),
    start,
    onStatus,
    dispose
  };
}

module.exports = { createDownloaderService, readBundledVersion };
