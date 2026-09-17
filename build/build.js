const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REQUIRED_FILES, BIN } = require('./fetch-binaries');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, '.build', 'electron');
const UNPACKED = path.join(OUTPUT, 'win-unpacked');
const INSTALLER_DIR = path.join(ROOT, 'Installer');
const BUILD_RESOURCES = ['icon.ico', 'icon.png', 'installerSidebar.bmp', 'installerHeader.bmp', 'installer.nsh'];

function say(text) {
  process.stdout.write(`${text}\n`);
}

function fail(text) {
  throw new Error(text);
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (!('ELECTRON_RUN_AS_NODE' in extra)) delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function run(file, args, { env, cwd = ROOT, capture = false, timeout = 30 * 60 * 1000 } = {}) {
  const result = spawnSync(file, args, {
    cwd,
    env: env || cleanEnv(),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    timeout,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) fail(`${path.basename(file)} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const output = capture ? `\n${(result.stderr || result.stdout || '').trim().split('\n').slice(-15).join('\n')}` : '';
    fail(`${path.basename(file)} ${args.slice(0, 3).join(' ')} failed with exit code ${result.status}${output}`);
  }
  return result;
}

function checkInputs() {
  const missing = REQUIRED_FILES.filter((rel) => !fs.existsSync(path.join(BIN, rel)));
  if (!fs.existsSync(path.join(BIN, 'manifest.json'))) missing.push('manifest.json');
  if (missing.length) fail(`bin/ is incomplete (${missing.join(', ')}). Run: npm run fetch-binaries`);
  const resources = BUILD_RESOURCES.filter((name) => !fs.existsSync(path.join(__dirname, name)));
  if (resources.length) fail(`build/ is missing: ${resources.join(', ')}`);
}

function electronExe() {
  const electronPath = require('electron');
  if (!fs.existsSync(electronPath)) fail('Electron is not installed. Run: npm install');
  return electronPath;
}

async function smokeBinaries() {
  const ffmpeg = path.join(BIN, 'ffmpeg.exe');
  const ffprobe = path.join(BIN, 'ffprobe.exe');
  const ytdlp = path.join(BIN, 'yt-dlp.exe');
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vidaro-build-'));
  try {
    run(ffmpeg, ['-hide_banner', '-version'], { capture: true });
    run(ffmpeg, ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1', '-c:v', 'libx264', '-f', 'null', '-'], { capture: true });
    const avi = path.join(work, 'sample.avi');
    const mp4 = path.join(work, 'sample.mp4');
    run(ffmpeg, [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=30000/1001',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '2', '-c:v', 'mpeg4', '-vtag', 'XVID', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '128k', avi
    ], { capture: true });
    run(ffmpeg, [
      '-hide_banner', '-nostdin', '-y', '-fflags', '+genpts', '-i', avi,
      '-vf', 'scale=1440:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', '-f', 'mp4', mp4
    ], { capture: true });
    const probe = run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4], { capture: true });
    const info = JSON.parse(probe.stdout);
    const video = info.streams.find((s) => s.codec_type === 'video');
    const audio = info.streams.find((s) => s.codec_type === 'audio');
    const duration = Number(info.format.duration);
    if (!video || video.width !== 1920 || video.height !== 1080 || !audio || Math.abs(duration - 2) > 0.15) {
      fail(`AVI to MP4 smoke conversion produced an unexpected file (${JSON.stringify({ w: video?.width, h: video?.height, duration })})`);
    }
    const version = run(ytdlp, ['--version'], { capture: true, env: cleanEnv({ PYTHONUTF8: '1' }) }).stdout.trim();
    const manifest = JSON.parse(fs.readFileSync(path.join(BIN, 'manifest.json'), 'utf8'));
    if (version !== manifest['yt-dlp']) fail(`yt-dlp reports ${version}, manifest says ${manifest['yt-dlp']}`);
    const nodeVersion = run(electronExe(), ['--version'], { capture: true, env: cleanEnv({ ELECTRON_RUN_AS_NODE: '1' }) }).stdout.trim();
    if (!/^v(2[2-9]|[3-9]\d)\./.test(nodeVersion)) fail(`The JavaScript runtime reports ${nodeVersion}; Node 22 or newer is required by yt-dlp`);
    say(`  ffmpeg OK, yt-dlp ${version}, JS runtime node ${nodeVersion}`);
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

function verifyUnpacked() {
  const expected = [
    'Vidaro.exe',
    path.join('resources', 'app.asar'),
    path.join('resources', 'icon.ico'),
    path.join('resources', 'bin', 'manifest.json'),
    ...REQUIRED_FILES.map((rel) => path.join('resources', 'bin', ...rel.split('/')))
  ];
  const missing = expected.filter((rel) => !fs.existsSync(path.join(UNPACKED, rel)));
  if (missing.length) fail(`The packaged app is missing: ${missing.join(', ')}`);
}

async function main() {
  const started = Date.now();
  const version = require(path.join(ROOT, 'package.json')).version;
  say(`Building Vidaro ${version}`);

  say('1/7 Checking inputs');
  checkInputs();

  say('2/7 Unit tests');
  run(process.execPath, ['--test', '--test-reporter=dot', 'test/**/*.test.js'], { env: cleanEnv() });

  say('3/7 Binary smoke tests');
  await smokeBinaries();

  say('4/7 Renderer');
  await fsp.rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], { env: cleanEnv() });

  say('5/7 Packaging');
  await fsp.rm(OUTPUT, { recursive: true, force: true });
  run(process.execPath, [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--x64', '--publish', 'never'], {
    env: cleanEnv({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  });

  say('6/7 Verifying package');
  verifyUnpacked();
  const installer = path.join(OUTPUT, 'Vidaro-Setup.exe');
  if (!fs.existsSync(installer)) fail('The installer was not produced');

  say('7/7 Collecting installer');
  await fsp.mkdir(INSTALLER_DIR, { recursive: true });
  const target = path.join(INSTALLER_DIR, 'Vidaro-Setup.exe');
  await fsp.copyFile(installer, target);
  await fsp.rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
  const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
  say(`Done in ${Math.round((Date.now() - started) / 1000)} s: Installer/Vidaro-Setup.exe (${size} MB)`);
}

main().catch((error) => {
  process.stderr.write(`\nBuild failed: ${error.message}\n`);
  process.exitCode = 1;
});
