const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const MANIFEST = path.join(BIN, 'manifest.json');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const PACKAGES = [
  {
    id: 'yt-dlp',
    version: '2026.08.19',
    downloads: [
      {
        urls: ['https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe'],
        sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
        target: 'yt-dlp.exe'
      },
      {
        urls: ['https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/LICENSE'],
        sha256: '7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c',
        target: 'licenses/yt-dlp.txt'
      },
      {
        urls: ['https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/THIRD_PARTY_LICENSES.txt'],
        sha256: '472aefe951c7db35e1657c1d13fd337140511ed6f2b329205105ad441c5a02b7',
        target: 'licenses/yt-dlp-third-party.txt'
      }
    ]
  },
  {
    id: 'ffmpeg',
    version: '9.0.1',
    downloads: [
      {
        urls: [
          'https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip',
          'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip'
        ],
        sha256: 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9',
        extract: {
          'ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe': 'ffmpeg.exe',
          'ffmpeg-9.0.1-essentials_build/bin/ffprobe.exe': 'ffprobe.exe',
          'ffmpeg-9.0.1-essentials_build/LICENSE': 'licenses/ffmpeg.txt',
          'ffmpeg-9.0.1-essentials_build/README.txt': 'licenses/ffmpeg-build.txt'
        }
      }
    ]
  }
];

function packageFiles(pkg) {
  return pkg.downloads.flatMap((d) => (d.extract ? Object.values(d.extract) : [d.target]));
}

const REQUIRED_FILES = PACKAGES.flatMap(packageFiles);

function say(text) {
  process.stdout.write(`${text}\n`);
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

function isInstalled(pkg, manifest) {
  if (manifest[pkg.id] !== pkg.version) return false;
  return packageFiles(pkg).every((rel) => fs.existsSync(path.join(BIN, rel)));
}

async function downloadTo(url, file) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let received = 0;
  let lastShown = 0;
  const total = Number(response.headers.get('content-length')) || 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      if (total > 8 * 1024 * 1024 && received - lastShown > total / 10) {
        lastShown = received;
        process.stdout.write(`  ${Math.round((received / total) * 100)}%\r`);
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
    if (lastShown > 0) process.stdout.write('       \r');
  }
  return hash.digest('hex');
}

async function fetchVerified(download, file) {
  let lastError;
  for (const url of download.urls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const digest = await downloadTo(url, file);
        if (digest !== download.sha256) {
          throw new Error(`SHA-256 mismatch for ${url}\n  expected ${download.sha256}\n  received ${digest}`);
        }
        return;
      } catch (error) {
        lastError = error;
        await fsp.rm(file, { force: true });
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  throw lastError;
}

async function moveInto(source, rel) {
  const target = path.join(BIN, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rm(target, { force: true });
  await fsp.copyFile(source, target);
}

async function extractMembers(archive, members, workDir) {
  const names = Object.keys(members);
  const result = spawnSync(TAR, ['-xf', archive, '-C', workDir, ...names], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not extract ${path.basename(archive)}: ${result.stderr || result.error}`);
  for (const [member, rel] of Object.entries(members)) {
    await moveInto(path.join(workDir, ...member.split('/')), rel);
  }
}

async function installPackage(pkg, workRoot) {
  const workDir = await fsp.mkdtemp(path.join(workRoot, `${pkg.id}-`));
  try {
    for (const [index, download] of pkg.downloads.entries()) {
      const file = path.join(workDir, `download-${index}`);
      say(`  ${download.urls[0].split('/').pop()}`);
      await fetchVerified(download, file);
      if (download.extract) await extractMembers(file, download.extract, workDir);
      else await moveInto(file, download.target);
    }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!fs.existsSync(TAR)) throw new Error(`tar.exe was not found at ${TAR}. Windows 10 1803 or newer is required.`);
  await fsp.mkdir(path.join(BIN, 'licenses'), { recursive: true });
  const manifest = readManifest();
  const pending = PACKAGES.filter((pkg) => force || !isInstalled(pkg, manifest));
  if (pending.length === 0) {
    say('Binaries are up to date.');
    return;
  }
  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vidaro-fetch-'));
  try {
    for (const pkg of pending) {
      say(`${pkg.id} ${pkg.version}`);
      delete manifest[pkg.id];
      await installPackage(pkg, workRoot);
      manifest[pkg.id] = pkg.version;
      await fsp.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } finally {
    await fsp.rm(workRoot, { recursive: true, force: true });
  }
  say('Binaries are ready.');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { PACKAGES, REQUIRED_FILES, BIN };
