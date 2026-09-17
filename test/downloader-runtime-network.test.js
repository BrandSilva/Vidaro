const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const processes = require('../src/main/processes');
const { createYtDlpManager } = require('../src/main/downloader/ytdlp-manager');
const { createDownloadRunner } = require('../src/main/downloader/runner');
const { createMetadataFetcher } = require('../src/main/downloader/metadata');
const { buildDownloadJobs } = require('../src/main/downloader/jobs');
const { readBundledVersion } = require('../src/main/downloader/service');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const URL_ = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const enabled = process.env.VIDARO_NETWORK_TESTS === '1';
const ready = fs.existsSync(path.join(BIN, 'yt-dlp.exe')) && fs.existsSync(path.join(BIN, 'ffprobe.exe')) && fs.existsSync(ELECTRON);

async function probeDuration(file) {
  const handle = processes.run(path.join(BIN, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { captureStdout: true });
  const result = await handle.result;
  return Number(JSON.parse(result.stdout).format.duration);
}

test(
  'downloads a five second section from YouTube with the real yt-dlp and the Electron runtime',
  { skip: !enabled ? 'set VIDARO_NETWORK_TESTS=1 to run' : !ready && 'bin or electron missing', timeout: 10 * 60 * 1000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaro-dlnet-ñ-'));
    const local = path.join(root, 'Local');
    const jsRuntime = { name: 'node', path: ELECTRON, env: { ELECTRON_RUN_AS_NODE: '1' } };
    let settings = { download: { ytdlpChannel: 'stable', ytdlpAutoUpdate: false, ytdlpLastCheck: 0, cookiesMode: 'none', proxy: '' } };
    const ytdlp = createYtDlpManager({
      bundledPath: path.join(BIN, 'yt-dlp.exe'),
      bundledVersion: readBundledVersion(BIN),
      userBinDir: path.join(local, 'bin'),
      runtimeDir: path.join(local, 'temp', 'runtime'),
      jsRuntime,
      getSettings: () => settings,
      updateSettings: (patch) => {
        settings = { download: { ...settings.download, ...patch.download } };
      }
    });
    const cacheDir = path.join(local, 'cache', 'yt-dlp');
    const tempDir = path.join(local, 'temp');
    const runner = createDownloadRunner({ ytdlp, ffmpegDir: BIN, tempDir, cacheDir, jsRuntime });
    const fetcher = createMetadataFetcher({ ytdlp, jsRuntime, cacheDir, getSettings: () => settings });
    try {
      fs.mkdirSync(path.join(local, 'temp', 'runtime'), { recursive: true });
      const status = await ytdlp.inspect();
      assert.equal(status.jsRuntime.ok, true, JSON.stringify(status.jsRuntime));

      const fetched = await fetcher.fetch(URL_);
      assert.ok(fetched.info, JSON.stringify(fetched.error));
      assert.equal(fetched.info.id, 'aqz-KE-bpKQ');
      assert.ok(fetched.info.heights.includes(360));

      const folder = path.join(root, 'Videos ñ');
      const [input] = buildDownloadJobs({
        items: [{ url: URL_, info: fetched.info, name: 'Big Buck Bunny – ñ 🎬 100%' }],
        options: { quality: '360', section: { start: 30, end: 35 } },
        output: { folder, collision: 'rename' },
        after: { preset: { id: 'mp4-universal', name: 'MP4 Universal', container: 'mp4' }, keepOriginal: true }
      });
      const job = { id: 'jnet1', kind: 'download', title: input.title, progress: { percent: null }, spec: input.spec };
      const updates = [];
      const ctx = { signal: new AbortController().signal, progress: (patch) => updates.push(patch), note: () => {}, settings: () => settings };
      const result = await runner.run(job, ctx);
      assert.equal(result.path, path.join(folder, 'Big Buck Bunny – ñ 🎬 100%.mp4'));
      assert.ok(result.size > 10000);
      assert.ok(fs.existsSync(result.path));
      const duration = await probeDuration(result.path);
      assert.ok(Math.abs(duration - 5) < 1, `duration ${duration}`);
      assert.equal(fs.existsSync(path.join(tempDir, 'download', 'jnet1')), false);
      assert.ok(updates.some((update) => update.stage === 'downloading'));
      assert.equal(updates.at(-1).percent, 100);
      assert.equal(result.followUps.length, 1);
      assert.equal(result.followUps[0].spec.input.path, result.path);
      assert.equal(result.followUps[0].spec.input.duration, 5);
      await ytdlp.sweepRuntime();
      const leftovers = fs.readdirSync(path.join(local, 'temp', 'runtime'));
      assert.deepEqual(leftovers, []);
      assert.equal(processes.liveCount(), 0);
    } finally {
      fetcher.dispose();
      ytdlp.dispose();
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
);
