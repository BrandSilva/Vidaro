const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.mjs'),
    logLevel: 'warn',
    clearScreen: false
  });
  await server.listen();

  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { cwd: ROOT, env, stdio: 'inherit' });

  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    await server.close().catch(() => {});
    process.exit(code ?? 0);
  };

  child.once('exit', (code) => stop(code));
  child.once('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    stop(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(signal, () => {
      if (child.exitCode === null) child.kill();
      else stop(0);
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
