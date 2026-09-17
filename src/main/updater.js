const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

function electronFetch(url, init) {
  return require('electron').net.fetch(url, init);
}

const RELEASES_URL = 'https://api.github.com/repos/TridentSky/Vidaro/releases/latest';
const ASSET_NAME = 'Vidaro-Setup.exe';
const FIRST_CHECK_MS = 20 * 1000;
const RETRY_DELAYS_MS = [2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 1000;

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] || '' };
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

function pickRelease(release, currentVersion) {
  if (!release || release.draft || release.prerelease) return null;
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version) || compareVersions(version, currentVersion) <= 0) return null;
  const asset = (release.assets || []).find((item) => item.name === ASSET_NAME);
  if (!asset || !Number.isFinite(asset.size) || asset.size <= 0) return null;
  const downloadUrl = String(asset.browser_download_url || '');
  if (!downloadUrl.startsWith('https://github.com/TridentSky/Vidaro/releases/download/')) return null;
  return { version, size: asset.size, downloadUrl, notesUrl: String(release.html_url || '') };
}

class AppUpdater extends EventEmitter {
  constructor({ currentVersion, updatesDir, getSettings, dismiss, activeJobs, fetchImpl = electronFetch }) {
    super();
    this.currentVersion = currentVersion;
    this.updatesDir = updatesDir;
    this.getSettings = getSettings;
    this.dismissVersion = dismiss;
    this.activeJobs = activeJobs;
    this.fetch = fetchImpl;
    this.timer = null;
    this.failures = 0;
    this.release = null;
    this.downloadAbort = null;
    this.disposed = false;
    this.state = { phase: 'idle', available: false, version: null, notesUrl: null, percent: null, error: null, dismissed: false };
  }

  status() {
    return { ...this.state, activeJobs: this.activeJobs() };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.status());
  }

  start() {
    this.cleanupOld().catch(() => {});
    this.schedule(FIRST_CHECK_MS);
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(() => this.automaticCheck(), delay);
  }

  async automaticCheck() {
    if (!this.getSettings().general.checkUpdates) {
      this.schedule(INTERVAL_MS);
      return;
    }
    const ok = await this.check();
    if (ok) {
      this.failures = 0;
      this.schedule(INTERVAL_MS);
    } else {
      const delay = RETRY_DELAYS_MS[this.failures] ?? INTERVAL_MS;
      this.failures += 1;
      this.schedule(delay);
    }
  }

  async check({ manual = false } = {}) {
    if (this.state.phase === 'downloading' || this.state.phase === 'checking') return true;
    const previous = this.state.phase;
    this.set({ phase: 'checking', error: null });
    try {
      const response = await this.fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Vidaro/${this.currentVersion}` },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
      });
      if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      const release = response.status === 404 ? null : pickRelease(await response.json(), this.currentVersion);
      this.release = release;
      if (!release) {
        this.set({ phase: 'idle', available: false, version: null, notesUrl: null, checkedAt: Date.now(), upToDate: true });
        return true;
      }
      const dismissed = !manual && this.getSettings().general.dismissedUpdate === release.version;
      const ready = await this.isDownloaded(release);
      this.set({
        phase: ready ? 'ready' : 'available',
        available: true,
        version: release.version,
        notesUrl: release.notesUrl,
        dismissed,
        percent: ready ? 100 : null,
        checkedAt: Date.now(),
        upToDate: false
      });
      return true;
    } catch {
      this.set({ phase: previous, error: manual ? 'check-failed' : null });
      return false;
    }
  }

  installerPath(release) {
    return path.join(this.updatesDir, `Vidaro-Setup-${release.version}.exe`);
  }

  async isDownloaded(release) {
    try {
      const stat = await fsp.stat(this.installerPath(release));
      return stat.size === release.size;
    } catch {
      return false;
    }
  }

  async download() {
    const release = this.release;
    if (!release || this.state.phase === 'downloading') return false;
    if (await this.isDownloaded(release)) {
      this.set({ phase: 'ready', percent: 100 });
      return true;
    }
    const target = this.installerPath(release);
    const partial = `${target}.partial`;
    const controller = new AbortController();
    this.downloadAbort = controller;
    this.set({ phase: 'downloading', percent: 0, error: null, dismissed: false });
    let out = null;
    try {
      await fsp.mkdir(this.updatesDir, { recursive: true });
      const response = await this.fetch(release.downloadUrl, { signal: controller.signal, headers: { 'User-Agent': `Vidaro/${this.currentVersion}` } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      out = fs.createWriteStream(partial);
      let received = 0;
      let lastEmit = 0;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        const now = Date.now();
        if (now - lastEmit > 400) {
          lastEmit = now;
          this.set({ percent: Math.min(99, (received / release.size) * 100) });
        }
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
      out = null;
      const stat = await fsp.stat(partial);
      if (stat.size !== release.size) throw new Error('Size mismatch');
      await fsp.rm(target, { force: true });
      await fsp.rename(partial, target);
      this.set({ phase: 'ready', percent: 100 });
      return true;
    } catch {
      if (out) {
        const stream = out;
        const closed = stream.closed ? Promise.resolve() : new Promise((resolve) => stream.once('close', resolve));
        stream.destroy();
        await closed;
      }
      await fsp.rm(partial, { force: true }).catch(() => {});
      if (!this.disposed) this.set({ phase: 'available', percent: null, error: 'download-failed' });
      return false;
    } finally {
      this.downloadAbort = null;
    }
  }

  async launchInstaller() {
    const release = this.release;
    if (!release || !(await this.isDownloaded(release))) return false;
    const child = spawn(this.installerPath(release), ['--updated'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return true;
  }

  dismiss(version) {
    this.dismissVersion(version);
    if (this.state.version === version) this.set({ dismissed: true });
  }

  async cleanupOld() {
    let entries;
    try {
      entries = await fsp.readdir(this.updatesDir);
    } catch {
      return;
    }
    for (const name of entries) {
      const match = /^Vidaro-Setup-(.+?)\.exe(\.partial)?$/.exec(name);
      if (!match) continue;
      if (match[2] || compareVersions(match[1], this.currentVersion) <= 0) {
        await fsp.rm(path.join(this.updatesDir, name), { force: true }).catch(() => {});
      }
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.downloadAbort?.abort();
    this.removeAllListeners();
  }
}

module.exports = { AppUpdater, compareVersions, pickRelease, parseVersion };
