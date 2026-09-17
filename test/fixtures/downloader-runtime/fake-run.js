const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { abortError, ProcessError } = require('../../../src/main/processes');

const FIXTURE_FOLDER = 'C:\\Users\\User\\Videos\\Vidaro';

function fakeRun(script) {
  const calls = [];
  function run(file, args, options = {}) {
    const call = { file, args, options, env: options.env ?? {}, aborted: false };
    calls.push(call);
    const signal = options.signal;
    const result = new Promise((resolve, reject) => {
      const onAbort = () => {
        call.aborted = true;
        reject(abortError(signal));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => script(call))
        .then(async (plan = {}) => {
          if (plan.spawnFailed) {
            signal?.removeEventListener('abort', onAbort);
            reject(new ProcessError('spawn failed', { code: null, stderr: '', stderrLines: [], stdout: '', spawnFailed: true, errno: 'ENOENT' }));
            return;
          }
          const stdout = [];
          const stderr = [];
          for (const step of plan.steps ?? []) {
            if (signal?.aborted) return;
            if (step.wait) await delay(step.wait);
            if (step.effect) await step.effect();
            if (step.hang) return;
            if (step.out !== undefined) {
              stdout.push(step.out);
              options.onStdoutLine?.(step.out);
            }
            if (step.err !== undefined) {
              stderr.push(step.err);
              options.onStderrLine?.(step.err);
            }
          }
          if (signal?.aborted) return;
          signal?.removeEventListener('abort', onAbort);
          resolve({
            code: plan.code ?? 0,
            exitSignal: null,
            stdout: options.captureStdout ? plan.stdout ?? stdout.join('\n') : '',
            stderr: stderr.join('\n'),
            stderrLines: stderr.slice(-(options.tailLines ?? 40)),
            overflow: false
          });
        })
        .catch(reject);
    });
    return { pid: 4242, kill: async () => {}, result };
  }
  return { run, calls };
}

function lines(text) {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function valueAfter(args, flag, prefix) {
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === flag && args[i + 1].startsWith(prefix)) return args[i + 1].slice(prefix.length);
  }
  return null;
}

function relocate(line, folder) {
  const escaped = JSON.stringify(folder).slice(1, -1);
  return line.split(JSON.stringify(FIXTURE_FOLDER).slice(1, -1)).join(escaped);
}

function replaySteps(text, { folder, stopAfter = null, stderrPattern = /^(ERROR|WARNING):/, fileBytes = 1234, tempDir = null } = {}) {
  const steps = [];
  if (tempDir) steps.push({ effect: () => fs.writeFileSync(path.join(tempDir, 'clip.f134.mp4.part'), 'partial') });
  const all = lines(text);
  for (let i = 0; i < all.length; i += 1) {
    if (stopAfter !== null && i === stopAfter) {
      steps.push({ hang: true });
      break;
    }
    const line = relocate(all[i], folder);
    if (line.startsWith('VIDARO-FILE ')) {
      const target = JSON.parse(line.slice('VIDARO-FILE '.length));
      steps.push({ effect: () => fs.writeFileSync(target, Buffer.alloc(fileBytes, 1)) });
    }
    steps.push(stderrPattern.test(line) ? { err: line } : { out: line });
  }
  return steps;
}

module.exports = { fakeRun, lines, valueAfter, replaySteps, relocate, FIXTURE_FOLDER };
