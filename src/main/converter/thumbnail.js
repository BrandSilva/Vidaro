const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const processes = require('../processes');
const { isAbortError } = require('../errors');
const { inputUrl } = require('./media');
const { createLru, fileKey, linkedSignal } = require('./probe');

const LONG_SIDE = 256;
const MAX_SEEK = 30;
const MAX_BYTES = 256 * 1024;
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const sharedCache = createLru(100);

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function thumbnailSize(media) {
  const video = media && media.video;
  const width = video ? video.displayWidth || video.width : 0;
  const height = video ? video.displayHeight || video.height : 0;
  if (!(width > 0) || !(height > 0)) return { width: LONG_SIDE, height: even((LONG_SIDE * 9) / 16) };
  if (width >= height) return { width: LONG_SIDE, height: even((LONG_SIDE * height) / width) };
  return { width: even((LONG_SIDE * width) / height), height: LONG_SIDE };
}

function seekTime(media) {
  const duration = media && media.duration > 0 ? media.duration : 0;
  if (!duration) return 0;
  return Math.round(Math.min(duration * 0.1, MAX_SEEK) * 1000) / 1000;
}

function videoFilters(media, size) {
  const video = media.video;
  const filters = [];
  if (video.fieldOrder === 'tff' || video.fieldOrder === 'bff') filters.push('yadif=deint=interlaced');
  if (video.isHDR) filters.push(TONEMAP);
  filters.push(`scale=${size.width}:${size.height}:flags=bicubic:out_range=pc`, 'setsar=1', 'format=yuvj420p');
  return filters.join(',');
}

function coverFilters() {
  return `scale=${LONG_SIDE}:${LONG_SIDE}:force_original_aspect_ratio=decrease:flags=bicubic:out_range=pc,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuvj420p`;
}

function thumbnailArgs(filePath, media, outputFile, { fast = true } = {}) {
  const base = ['-hide_banner', '-nostdin', '-y', '-nostats', '-loglevel', 'error'];
  const tail = ['-an', '-sn', '-dn', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '6', '-f', 'image2', '-update', '1', `file:${outputFile}`];
  if (media && media.video) {
    const args = [...base];
    const time = fast ? seekTime(media) : 0;
    if (fast) args.push('-noaccurate_seek', '-skip_frame', 'nokey');
    if (time > 0) args.push('-ss', String(time));
    args.push('-i', inputUrl(filePath), '-map', `0:${media.video.index}`, '-vf', videoFilters(media, thumbnailSize(media)), ...tail);
    return args;
  }
  if (media && media.cover) {
    return [...base, '-i', inputUrl(filePath), '-map', `0:${media.cover.index}`, '-vf', coverFilters(), ...tail];
  }
  return null;
}

async function removeQuietly(file) {
  await fsp.rm(file, { force: true, maxRetries: 3, retryDelay: 50 }).catch(() => {});
}

async function attempt(ffmpeg, args, outputFile, { signal, run }) {
  try {
    const handle = run(ffmpeg, args, { signal, tailLines: 8 });
    const result = await handle.result;
    if (result.code !== 0) return null;
    const data = await fsp.readFile(outputFile);
    if (data.length < 64 || data.length > MAX_BYTES || data[0] !== 0xff || data[1] !== 0xd8) return null;
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  } finally {
    await removeQuietly(outputFile);
  }
}

async function thumbnailDataUrl(filePath, media, { ffmpeg, tempDir = os.tmpdir(), signal, timeoutMs = 20000, cache = sharedCache, run = processes.run } = {}) {
  if (!media || (!media.video && !media.cover)) return null;
  let key = null;
  try {
    const stat = await fsp.stat(filePath);
    key = fileKey(filePath, stat);
  } catch {
    return null;
  }
  if (cache && cache.has(key)) return cache.get(key);
  await fsp.mkdir(tempDir, { recursive: true }).catch(() => {});
  const outputFile = path.join(tempDir, `thumb-${crypto.randomBytes(6).toString('hex')}.jpg`);
  const link = linkedSignal(signal, timeoutMs);
  let result = null;
  let timedOut = false;
  try {
    result = await attempt(ffmpeg, thumbnailArgs(filePath, media, outputFile, { fast: true }), outputFile, { signal: link.signal, run });
    if (!result && media.video) {
      result = await attempt(ffmpeg, thumbnailArgs(filePath, media, outputFile, { fast: false }), outputFile, { signal: link.signal, run });
    }
  } catch (error) {
    if (!isAbortError(error) || !link.timedOut()) throw error;
    timedOut = true;
  } finally {
    link.dispose();
  }
  if (cache && !timedOut) cache.set(key, result);
  return result;
}

module.exports = { thumbnailDataUrl, thumbnailArgs, thumbnailSize, seekTime };
