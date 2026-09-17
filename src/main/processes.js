const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { createLineReader, createTail } = require('./lines');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const TASKKILL = path.join(SYSTEM32, 'taskkill.exe');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const STRIPPED_ENV = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'NODE_OPTIONS'];

const live = new Map();
let lowPriority = true;

function baseEnv() {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of STRIPPED_ENV) delete env[key];
  return env;
}

function setLowPriority(enabled) {
  lowPriority = Boolean(enabled);
}

function applyPriority(pid) {
  if (!lowPriority || !pid) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    return;
  }
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    const killer = spawn(TASKKILL, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => resolve());
    killer.once('close', () => resolve());
  });
}

class ProcessError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ProcessError';
    Object.assign(this, details);
  }
}

function run(file, args, options = {}) {
  const {
    cwd,
    env,
    signal,
    onStdoutLine,
    onStderrLine,
    captureStdout = false,
    maxCapture = 64 * 1024 * 1024,
    tailLines = 40,
    priority = true
  } = options;

  if (signal?.aborted) {
    return { pid: 0, kill: () => Promise.resolve(), result: Promise.reject(abortError(signal)) };
  }

  const child = spawn(file, args, {
    cwd,
    env: { ...baseEnv(), ...env },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const pid = child.pid;
  if (pid) live.set(pid, child);
  if (priority) applyPriority(pid);

  const stderrTail = createTail(tailLines);
  const chunks = [];
  let captured = 0;
  let overflow = false;
  const stdoutReader = onStdoutLine ? createLineReader(onStdoutLine) : null;
  const stderrReader = createLineReader((line) => {
    stderrTail.add(line);
    if (onStderrLine) onStderrLine(line);
  });

  child.stdout.on('data', (chunk) => {
    if (stdoutReader) stdoutReader.push(chunk);
    if (captureStdout && !overflow) {
      captured += chunk.length;
      if (captured > maxCapture) overflow = true;
      else chunks.push(chunk);
    }
  });
  child.stderr.on('data', (chunk) => stderrReader.push(chunk));

  let aborted = false;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const onAbort = () => {
    aborted = true;
    if (!exited()) killTree(pid);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const kill = () => (exited() ? Promise.resolve() : killTree(pid));

  const result = new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      if (pid) live.delete(pid);
      signal?.removeEventListener('abort', onAbort);
    };
    child.once('error', (error) => {
      if (settled || pid) return;
      cleanup();
      reject(new ProcessError(error.message, { code: null, stderr: '', stderrLines: [], stdout: '', spawnFailed: true, errno: error.code }));
    });
    child.once('close', (code, exitSignal) => {
      if (settled) return;
      cleanup();
      stdoutReader?.end();
      stderrReader.end();
      if (aborted || signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      resolve({
        code,
        exitSignal,
        stderr: stderrTail.text(),
        stderrLines: stderrTail.lines(),
        stdout: captureStdout ? Buffer.concat(chunks).toString('utf8') : '',
        overflow
      });
    });
  });

  return { pid, kill, result };
}

function abortError(signal) {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  error.reason = signal?.reason;
  return error;
}

async function killAll(timeoutMs = 5000) {
  const pending = [...live.entries()].map(
    ([pid, child]) =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('close', resolve);
        killTree(pid);
      })
  );
  if (pending.length === 0) return;
  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function liveCount() {
  return live.size;
}

const SWEEP_SCRIPT = [
  "$dirs = $env:VIDARO_SWEEP_DIRS -split '\\|' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\\') + '\\' }",
  "$names = \"Name='ffmpeg.exe' OR Name='ffprobe.exe' OR Name='yt-dlp.exe'\"",
  'Get-CimInstance Win32_Process -Filter $names | ForEach-Object {',
  '  $exe = $_.ExecutablePath',
  '  if ($exe) { foreach ($d in $dirs) { if ($exe.StartsWith($d, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; break } } }',
  '}'
].join('\n');

async function sweepOrphans(dirs) {
  const handle = run(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SWEEP_SCRIPT], {
    env: { VIDARO_SWEEP_DIRS: dirs.join('|') }
  });
  try {
    await handle.result;
  } catch {
    return;
  }
}

function createStallWatchdog({ timeoutMs, onStall }) {
  let timer = null;
  let stopped = true;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(onStall, timeoutMs);
  };
  return {
    start() {
      stopped = false;
      arm();
    },
    progress() {
      if (!stopped) arm();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };
}

module.exports = {
  run,
  killTree,
  killAll,
  liveCount,
  sweepOrphans,
  setLowPriority,
  createStallWatchdog,
  ProcessError,
  abortError
};
