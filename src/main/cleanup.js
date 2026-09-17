const fsp = require('node:fs/promises');
const path = require('node:path');

const UNFINISHED = new Set(['queued', 'running', 'paused', 'interrupted', 'failed']);

async function removeStaleJobDirs(root, keepIds) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || keepIds.has(entry.name)) continue;
    try {
      await fsp.rm(path.join(root, entry.name), { recursive: true, force: true });
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}

async function removeInterruptedPartials(jobs, extensionFor) {
  for (const job of jobs) {
    if (job.kind !== 'convert' || job.state === 'running' || !UNFINISHED.has(job.state)) continue;
    const folder = job.spec?.output?.folder;
    const name = job.spec?.output?.name;
    if (!folder || !name || !job.spec?.preset) continue;
    let extension;
    try {
      extension = extensionFor(job.spec.preset);
    } catch {
      continue;
    }
    await fsp.rm(path.join(folder, `${name}.${extension}.partial`), { force: true }).catch(() => {});
  }
}

async function cleanupStaleFiles({ tempDir, jobs, extensionFor }) {
  const downloads = new Set(jobs.filter((job) => job.kind === 'download' && UNFINISHED.has(job.state)).map((job) => job.id));
  const running = new Set(jobs.filter((job) => job.state === 'running').map((job) => job.id));
  await removeStaleJobDirs(path.join(tempDir, 'download'), downloads);
  await removeStaleJobDirs(path.join(tempDir, 'convert'), running);
  await removeInterruptedPartials(jobs, extensionFor);
}

module.exports = { cleanupStaleFiles, removeStaleJobDirs };
