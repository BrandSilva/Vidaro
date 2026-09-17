const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AppUpdater, compareVersions, pickRelease, detectInstallScope, installerArgs } = require('../src/main/updater');

const DOWNLOAD_BASE = 'https://github.com/TridentSky/Vidaro/releases/download';

function release(version, { size = 1024, draft = false, prerelease = false, assetName = 'Vidaro-Setup.exe', url } = {}) {
  return {
    tag_name: `v${version}`,
    draft,
    prerelease,
    html_url: `https://github.com/TridentSky/Vidaro/releases/tag/v${version}`,
    assets: [{ name: assetName, size, browser_download_url: url || `${DOWNLOAD_BASE}/v${version}/Vidaro-Setup.exe` }]
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vidaro-updater-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

function makeUpdater(dir, fetchImpl, { current = '1.0.0', dismissed = null } = {}) {
  const dismissedVersions = [];
  const updater = new AppUpdater({
    currentVersion: current,
    updatesDir: dir,
    getSettings: () => ({ general: { checkUpdates: true, dismissedUpdate: dismissed } }),
    dismiss: (version) => dismissedVersions.push(version),
    activeJobs: () => 0,
    fetchImpl
  });
  return { updater, dismissedVersions };
}

test('compareVersions orders plain and prerelease versions', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('v1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '2.0.0-beta.1'), 1);
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), -1);
  assert.equal(compareVersions('garbage', '1.0.0'), 0);
});

test('pickRelease only accepts newer stable releases with the official installer asset', () => {
  assert.equal(pickRelease(release('1.0.0'), '1.0.0'), null);
  assert.equal(pickRelease(release('0.9.0'), '1.0.0'), null);
  assert.equal(pickRelease(release('1.1.0', { draft: true }), '1.0.0'), null);
  assert.equal(pickRelease(release('1.1.0', { prerelease: true }), '1.0.0'), null);
  assert.equal(pickRelease(release('1.1.0', { assetName: 'Other.exe' }), '1.0.0'), null);
  assert.equal(pickRelease(release('1.1.0', { url: 'https://example.com/Vidaro-Setup.exe' }), '1.0.0'), null);
  assert.equal(pickRelease(release('1.1.0', { size: 0 }), '1.0.0'), null);
  const picked = pickRelease(release('1.1.0', { size: 2048 }), '1.0.0');
  assert.equal(picked.version, '1.1.0');
  assert.equal(picked.size, 2048);
});

test('a repository without releases counts as up to date', async (t) => {
  const dir = await tempDir(t);
  const { updater } = makeUpdater(dir, async () => new Response('{"message":"Not Found"}', { status: 404 }));
  t.after(() => updater.dispose());
  assert.equal(await updater.check(), true);
  const status = updater.status();
  assert.equal(status.available, false);
  assert.equal(status.upToDate, true);
  assert.equal(status.phase, 'idle');
});

test('a newer release is announced and a dismissed version stays quiet until checked manually', async (t) => {
  const dir = await tempDir(t);
  const { updater } = makeUpdater(dir, async () => jsonResponse(release('1.2.0')), { dismissed: '1.2.0' });
  t.after(() => updater.dispose());
  const events = [];
  updater.on('status', (status) => events.push(status.phase));
  assert.equal(await updater.check(), true);
  assert.equal(updater.status().phase, 'available');
  assert.equal(updater.status().version, '1.2.0');
  assert.equal(updater.status().dismissed, true);
  await updater.check({ manual: true });
  assert.equal(updater.status().dismissed, false);
  assert.ok(events.includes('checking'));
});

test('network failures are silent for automatic checks and reported for manual ones', async (t) => {
  const dir = await tempDir(t);
  const { updater } = makeUpdater(dir, async () => {
    throw new TypeError('fetch failed');
  });
  t.after(() => updater.dispose());
  assert.equal(await updater.check(), false);
  assert.equal(updater.status().error, null);
  assert.equal(updater.status().phase, 'idle');
  assert.equal(await updater.check({ manual: true }), false);
  assert.equal(updater.status().error, 'check-failed');
});

test('download writes the installer, verifies its size and becomes ready', async (t) => {
  const dir = await tempDir(t);
  const size = 300000;
  const { updater } = makeUpdater(dir, async (url) => {
    if (url.startsWith('https://api.github.com/')) return jsonResponse(release('1.3.0', { size }));
    return new Response(new Uint8Array(size).fill(7), { status: 200 });
  });
  t.after(() => updater.dispose());
  await updater.check();
  assert.equal(await updater.download(), true);
  assert.equal(updater.status().phase, 'ready');
  const installer = path.join(dir, 'Vidaro-Setup-1.3.0.exe');
  assert.equal(fs.statSync(installer).size, size);
  assert.equal(fs.existsSync(`${installer}.partial`), false);
  await updater.check();
  assert.equal(updater.status().phase, 'ready');
});

test('a truncated download is discarded and the update stays available', async (t) => {
  const dir = await tempDir(t);
  const { updater } = makeUpdater(dir, async (url) => {
    if (url.startsWith('https://api.github.com/')) return jsonResponse(release('1.3.0', { size: 5000 }));
    return new Response(new Uint8Array(1200), { status: 200 });
  });
  t.after(() => updater.dispose());
  await updater.check();
  assert.equal(await updater.download(), false);
  assert.equal(updater.status().phase, 'available');
  assert.equal(updater.status().error, 'download-failed');
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('a failed HTTP download leaves no files behind', async (t) => {
  const dir = await tempDir(t);
  const { updater } = makeUpdater(dir, async (url) => {
    if (url.startsWith('https://api.github.com/')) return jsonResponse(release('1.3.0'));
    return new Response('nope', { status: 503 });
  });
  t.after(() => updater.dispose());
  await updater.check();
  assert.equal(await updater.download(), false);
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('cleanupOld removes installers that are not newer than the running version and partial files', async (t) => {
  const dir = await tempDir(t);
  for (const name of ['Vidaro-Setup-0.9.0.exe', 'Vidaro-Setup-1.0.0.exe', 'Vidaro-Setup-1.1.0.exe', 'Vidaro-Setup-1.2.0.exe.partial', 'notes.txt']) {
    await fsp.writeFile(path.join(dir, name), 'x');
  }
  const { updater } = makeUpdater(dir, async () => jsonResponse({}));
  t.after(() => updater.dispose());
  await updater.cleanupOld();
  assert.deepEqual((await fsp.readdir(dir)).sort(), ['Vidaro-Setup-1.1.0.exe', 'notes.txt']);
});

test('dismiss records the version and hides the current announcement', async (t) => {
  const dir = await tempDir(t);
  const { updater, dismissedVersions } = makeUpdater(dir, async () => jsonResponse(release('1.4.0')));
  t.after(() => updater.dispose());
  await updater.check();
  updater.dismiss('1.4.0');
  assert.deepEqual(dismissedVersions, ['1.4.0']);
  assert.equal(updater.status().dismissed, true);
});

test('the install scope comes from the installer registry key of this folder', async () => {
  const registry = (values) => async (hive) => values[hive] ?? null;
  assert.equal(await detectInstallScope('C:\\Program Files\\Vidaro', registry({ HKLM: 'C:\\Program Files\\Vidaro' })), 'allusers');
  assert.equal(await detectInstallScope('C:\\Program Files\\Vidaro\\', registry({ HKLM: 'c:\\program files\\vidaro' })), 'allusers');
  assert.equal(
    await detectInstallScope('C:\\Users\\Ana\\AppData\\Local\\Programs\\Vidaro', registry({ HKCU: 'C:\\Users\\Ana\\AppData\\Local\\Programs\\Vidaro', HKLM: 'C:\\Program Files\\Vidaro' })),
    'currentuser'
  );
  assert.equal(await detectInstallScope('D:\\Portable\\Vidaro', registry({ HKLM: 'C:\\Program Files\\Vidaro' })), null);
  assert.equal(await detectInstallScope('D:\\Portable\\Vidaro', registry({})), null);
});

test('the installer runs in update mode and skips the install mode page when the scope is known', () => {
  assert.deepEqual(installerArgs('allusers'), ['--updated', '/allusers']);
  assert.deepEqual(installerArgs('currentuser'), ['--updated', '/currentuser']);
  assert.deepEqual(installerArgs(null), ['--updated']);
});

test('dispose stops scheduled checks', async (t) => {
  const dir = await tempDir(t);
  let calls = 0;
  const { updater } = makeUpdater(dir, async () => {
    calls += 1;
    return jsonResponse({});
  });
  updater.start();
  updater.dispose();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 0);
});
