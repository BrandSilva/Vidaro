const { parseRational, rateValue, rateString, sameRate, nearestStandardRate, snapRate } = require('./media');

const RESOLUTION_BOXES = Object.freeze({
  '480p': [854, 480],
  '576p': [1024, 576],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '2160p': [3840, 2160]
});

const STANDARD_OUTPUT_RATES = ['24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60'];
const NTSC_FRAME = { num: 30000, den: 1001 };
const PAL_MATRIX = 'bt470bg';
const NTSC_MATRIX = 'smpte170m';
const REC601_MATRICES = new Set(['smpte170m', 'bt470bg']);
const RGB_PIXEL_FORMATS = /^(?:rgb|bgr|argb|abgr|gbr|0rgb|0bgr|x2rgb|x2bgr|pal8)/;
const TRC_ALIASES = { gamma22: 'bt470m', gamma28: 'bt470bg' };
const PRIMARIES = new Set(['bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'film', 'bt2020', 'smpte428', 'smpte431', 'smpte432', 'jedec-p22', 'ebu3213']);
const TRANSFERS = new Set(['bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'linear', 'log100', 'log316', 'iec61966-2-4', 'bt1361e', 'iec61966-2-1', 'bt2020-10', 'bt2020-12', 'smpte2084', 'smpte428', 'arib-std-b67']);
const MATRICES = new Set(['bt709', 'fcc', 'bt470bg', 'smpte170m', 'smpte240m', 'ycgco', 'bt2020nc', 'bt2020c', 'smpte2085', 'chroma-derived-nc', 'chroma-derived-c', 'ictcp']);
const TONEMAP_CHAIN = ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv'];
const OPUS_LAYOUTS = { 1: 'mono', 2: 'stereo', 3: '3.0', 4: 'quad', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' };
const ASYNC_RESAMPLE = 'async=1:min_hard_comp=0.100000:first_pts=0';

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function evenDown(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function isSwapAngle(angle) {
  return angle === 90 || angle === 270;
}

function normalizedCrop(crop, width, height) {
  const value = (key) => Math.max(0, Math.floor((Number(crop && crop[key]) || 0) / 2) * 2);
  let left = value('left');
  let right = value('right');
  let top = value('top');
  let bottom = value('bottom');
  if (width - left - right < 16) {
    left = 0;
    right = 0;
  }
  if (height - top - bottom < 16) {
    top = 0;
    bottom = 0;
  }
  return { left, right, top, bottom, active: left + right + top + bottom > 0 };
}

function geometry(media, picture = {}) {
  const video = media.video;
  const mediaSwap = isSwapAngle(video.rotation);
  const baseWidth = mediaSwap ? video.height : video.width;
  const baseHeight = mediaSwap ? video.width : video.height;
  const crop = normalizedCrop(picture.crop, baseWidth, baseHeight);
  const width = baseWidth - crop.left - crop.right;
  const height = baseHeight - crop.top - crop.bottom;
  const sar = video.sar || { num: 1, den: 1 };
  const factor = sar.num / sar.den;
  let displayWidth = mediaSwap ? width : width * factor;
  let displayHeight = mediaSwap ? height * factor : height;
  const userSwap = isSwapAngle(Number(picture.rotate) || 0);
  let storageWidth = width;
  let storageHeight = height;
  if (userSwap) {
    [displayWidth, displayHeight] = [displayHeight, displayWidth];
    [storageWidth, storageHeight] = [storageHeight, storageWidth];
  }
  return {
    crop,
    cropWidth: width,
    cropHeight: height,
    storageWidth,
    storageHeight,
    anamorphic: sar.num !== sar.den,
    displayWidth,
    displayHeight
  };
}

function boxFor(picture, geo) {
  if (picture.resolution === 'custom') {
    const width = even(Number(picture.width) || 0);
    const height = even(Number(picture.height) || 0);
    return width >= 16 && height >= 16 ? { width, height } : null;
  }
  const box = RESOLUTION_BOXES[picture.resolution];
  if (!box) return null;
  const [width, height] = box;
  if (picture.fit === 'fit' && geo.displayHeight > geo.displayWidth) return { width: height, height: width };
  return { width, height };
}

function planSize(media, picture = {}) {
  const geo = geometry(media, picture);
  const squarePixels = picture.squarePixels !== false;
  const box = boxFor(picture, geo);
  const natural = { width: even(geo.displayWidth), height: even(geo.displayHeight) };
  if (!box) {
    if (geo.anamorphic && squarePixels) {
      return { ...geo, scale: natural, pad: null, fill: null, width: natural.width, height: natural.height, resized: true, sar: { num: 1, den: 1 } };
    }
    const width = evenDown(geo.storageWidth);
    const height = evenDown(geo.storageHeight);
    const trim = width !== geo.storageWidth || height !== geo.storageHeight;
    return {
      ...geo,
      scale: null,
      pad: null,
      fill: null,
      evenCrop: trim ? { width, height } : null,
      width,
      height,
      resized: false,
      sar: geo.anamorphic ? { ...media.video.sar } : { num: 1, den: 1 }
    };
  }
  const fit = ['pad', 'crop', 'stretch', 'fit'].includes(picture.fit) ? picture.fit : 'pad';
  const noUpscale = Boolean(picture.noUpscale);
  if (fit === 'stretch') {
    const width = noUpscale ? Math.min(box.width, natural.width) : box.width;
    const height = noUpscale ? Math.min(box.height, natural.height) : box.height;
    return { ...geo, scale: { width, height }, pad: null, fill: null, width, height, resized: true, sar: { num: 1, den: 1 } };
  }
  const sx = box.width / geo.displayWidth;
  const sy = box.height / geo.displayHeight;
  let factor = fit === 'crop' ? Math.max(sx, sy) : Math.min(sx, sy);
  const capped = noUpscale && factor > 1;
  if (capped) factor = 1;
  let contentWidth = even(geo.displayWidth * factor);
  let contentHeight = even(geo.displayHeight * factor);
  if (fit === 'crop') {
    if (!capped) {
      contentWidth = Math.max(contentWidth, box.width);
      contentHeight = Math.max(contentHeight, box.height);
    }
    const width = Math.min(box.width, contentWidth);
    const height = Math.min(box.height, contentHeight);
    const fill =
      width < contentWidth || height < contentHeight
        ? { width, height, x: Math.floor((contentWidth - width) / 4) * 2, y: Math.floor((contentHeight - height) / 4) * 2 }
        : null;
    return { ...geo, scale: { width: contentWidth, height: contentHeight }, pad: null, fill, width, height, resized: true, sar: { num: 1, den: 1 } };
  }
  contentWidth = Math.min(contentWidth, box.width);
  contentHeight = Math.min(contentHeight, box.height);
  const scale = { width: contentWidth, height: contentHeight };
  if (fit === 'fit' || capped) {
    return { ...geo, scale, pad: null, fill: null, width: contentWidth, height: contentHeight, resized: true, sar: { num: 1, den: 1 } };
  }
  const pad =
    contentWidth === box.width && contentHeight === box.height
      ? null
      : {
          width: box.width,
          height: box.height,
          x: Math.floor((box.width - contentWidth) / 4) * 2,
          y: Math.floor((box.height - contentHeight) / 4) * 2
        };
  return { ...geo, scale, pad, fill: null, width: box.width, height: box.height, resized: true, sar: { num: 1, den: 1 } };
}

function interlaceDecision(media, picture = {}, analysis = null) {
  const video = media.video;
  const analyzed = analysis && ['tff', 'bff', 'progressive'].includes(analysis.verdict) ? analysis.verdict : null;
  const order = analyzed || video.fieldOrder;
  const interlaced = order === 'tff' || order === 'bff';
  const parity = interlaced ? order : 'auto';
  const fieldRate = picture.deinterlaceRate === 'field';
  const telecineSource = !video.softTelecine && Boolean(video.fps) && !video.vfr && (sameRate(video.fps, NTSC_FRAME, 0.001) || sameRate(video.fps, { num: 30, den: 1 }, 0.001));
  const warnings = [];
  const wantsIvtc = picture.ivtc === 'on' || (picture.ivtc === 'auto' && Boolean(analysis && analysis.telecine));
  if (wantsIvtc && telecineSource) return { mode: 'ivtc', parity, fieldRate: false, order, warnings };
  if (picture.ivtc === 'on') warnings.push('ivtc-not-applicable');
  if (picture.deinterlace === 'on' || (picture.deinterlace === 'auto' && interlaced)) {
    return { mode: 'deinterlace', parity, fieldRate, order, warnings };
  }
  return { mode: 'none', parity, fieldRate: false, order, warnings };
}

function sourceRate(video) {
  return video.vfr ? video.avgFps || video.fps : video.fps;
}

function multiplyRate(rate, num, den) {
  if (!rate) return null;
  return snapRate({ num: rate.num * num, den: rate.den * den });
}

function requestedRate(picture) {
  if (picture.fps === 'custom') return parseRational(picture.customFps || '');
  if (picture.fps && picture.fps !== 'keep') return parseRational(String(picture.fps));
  return null;
}

function cfrTarget(video) {
  const avg = video.avgFps || video.fps;
  if (!avg) return parseRational('30000/1001');
  const hint = video.fps;
  if (hint && STANDARD_OUTPUT_RATES.some((rate) => sameRate(parseRational(rate), hint, 0.0005)) && Math.abs(rateValue(avg) - rateValue(hint)) / rateValue(hint) < 0.05) {
    return snapRate(hint);
  }
  return nearestStandardRate(avg, STANDARD_OUTPUT_RATES);
}

function rateDecision(media, picture = {}, interlace = { mode: 'none' }) {
  const video = media.video;
  let base = sourceRate(video);
  if (interlace.mode === 'deinterlace' && interlace.fieldRate) base = multiplyRate(base, 2, 1);
  if (interlace.mode === 'ivtc') base = multiplyRate(base, 4, 5);
  const constantSource = !video.vfr;
  const requested = requestedRate(picture);
  if (requested) {
    const filter = Boolean(picture.cfr) || !(constantSource && base && sameRate(base, requested, 0.0005));
    return { rate: requested, filter, passthrough: false, lowers: Boolean(base) && rateValue(requested) < rateValue(base) - 0.001 };
  }
  if (video.vfr && picture.cfr) {
    const rate = cfrTarget(video);
    return { rate, filter: true, passthrough: false, lowers: false };
  }
  if (video.softTelecine && interlace.mode !== 'ivtc') {
    return { rate: { num: 24000, den: 1001 }, filter: true, passthrough: false, lowers: false };
  }
  if (picture.cfr && constantSource && base) {
    return { rate: base, filter: true, passthrough: false, lowers: false };
  }
  return { rate: base || null, filter: false, passthrough: Boolean(video.vfr), lowers: false };
}

function isHdrToSdr(media, { codec, tenBit }) {
  return Boolean(media.video.isHDR) && (codec === 'h264' || !tenBit);
}

function normalizeTransfer(value) {
  const name = TRC_ALIASES[value] || value;
  return TRANSFERS.has(name) ? name : null;
}

function isRgbInput(video) {
  return RGB_PIXEL_FORMATS.test(video.pixFmt || '') || video.colorSpace === 'gbr';
}

function rgbColorDecision(video, outputHd, pal) {
  const sdMatrix = pal ? PAL_MATRIX : NTSC_MATRIX;
  const space = outputHd ? 'bt709' : sdMatrix;
  const sourceTrc = normalizeTransfer(video.colorTransfer);
  return {
    convert: false,
    tonemap: false,
    pcRange: false,
    rgb: true,
    inMatrix: null,
    outMatrix: outputHd ? 'bt709' : 'bt601',
    out: {
      space,
      primaries: PRIMARIES.has(video.colorPrimaries) ? video.colorPrimaries : outputHd ? 'bt709' : sdMatrix,
      trc: !sourceTrc || sourceTrc === 'iec61966-2-1' ? (outputHd ? 'bt709' : 'smpte170m') : sourceTrc
    }
  };
}

function colorDecision(media, picture = {}, size, { codec = 'h264', tenBit = false } = {}) {
  const video = media.video;
  const outputHd = Math.min(size.width, size.height) >= 720 || Math.max(size.width, size.height) >= 1280;
  const pal = video.standard === 'PAL';
  const rgb = isRgbInput(video);
  const pcRange = !rgb && (video.colorRange === 'pc' || /^yuvj/.test(video.pixFmt || ''));
  if (isHdrToSdr(media, { codec, tenBit })) {
    return { convert: false, tonemap: true, pcRange: false, inMatrix: null, out: { space: 'bt709', primaries: 'bt709', trc: 'bt709' } };
  }
  if (video.isHDR) {
    return {
      convert: false,
      tonemap: false,
      pcRange,
      rgb,
      inMatrix: null,
      outMatrix: rgb ? 'bt2020' : null,
      out: {
        space: !rgb && MATRICES.has(video.colorSpace) ? video.colorSpace : 'bt2020nc',
        primaries: PRIMARIES.has(video.colorPrimaries) ? video.colorPrimaries : 'bt2020',
        trc: normalizeTransfer(video.colorTransfer)
      }
    };
  }
  if (rgb) return rgbColorDecision(video, outputHd, pal);
  const assumed = video.isSD ? (pal ? PAL_MATRIX : NTSC_MATRIX) : 'bt709';
  const matrix = MATRICES.has(video.colorSpace) ? video.colorSpace : assumed;
  const rec601 = REC601_MATRICES.has(matrix);
  const convert = picture.colorConvert !== 'off' && rec601 && outputHd;
  if (convert) {
    return { convert: true, tonemap: false, pcRange, inMatrix: 'bt601', out: { space: 'bt709', primaries: 'bt709', trc: 'bt709' } };
  }
  if (rec601) {
    const defaultPrimaries = matrix === PAL_MATRIX ? 'bt470bg' : 'smpte170m';
    return {
      convert: false,
      tonemap: false,
      pcRange,
      inMatrix: null,
      out: {
        space: matrix,
        primaries: PRIMARIES.has(video.colorPrimaries) ? video.colorPrimaries : defaultPrimaries,
        trc: normalizeTransfer(video.colorTransfer) || 'smpte170m'
      }
    };
  }
  const primaries = PRIMARIES.has(video.colorPrimaries) ? video.colorPrimaries : matrix === 'bt709' ? 'bt709' : null;
  const trc = normalizeTransfer(video.colorTransfer) || (matrix === 'bt709' ? 'bt709' : null);
  return { convert: false, tonemap: false, pcRange, inMatrix: null, out: { space: matrix, primaries, trc } };
}

function rotateFilters(picture = {}) {
  const filters = [];
  const angle = Number(picture.rotate) || 0;
  if (angle === 90) filters.push('transpose=clock');
  else if (angle === 270) filters.push('transpose=cclock');
  else if (angle === 180) filters.push('hflip', 'vflip');
  if (picture.flipH) filters.push('hflip');
  if (picture.flipV) filters.push('vflip');
  return filters;
}

function interlaceFilters(interlace) {
  if (interlace.mode === 'ivtc') return [`fieldmatch=order=${interlace.parity}:combmatch=full`, 'yadif=deint=interlaced', 'decimate'];
  if (interlace.mode === 'deinterlace') {
    return [`bwdif=mode=${interlace.fieldRate ? 'send_field' : 'send_frame'}:parity=${interlace.parity}:deint=all`];
  }
  return [];
}

function scaleFilter(size, color) {
  const options = [];
  if (size.scale) options.push(`${size.scale.width}:${size.scale.height}`, 'flags=lanczos');
  if (color.convert) options.push(`in_color_matrix=${color.inMatrix}`, 'out_color_matrix=bt709');
  else if (color.outMatrix) options.push(`out_color_matrix=${color.outMatrix}`);
  if (color.pcRange) options.push('in_range=pc', 'out_range=tv');
  else if (color.rgb) options.push('out_range=tv');
  return options.length ? `scale=${options.join(':')}` : null;
}

function setParamsFilter(color) {
  const options = ['range=tv'];
  if (color.out.primaries) options.push(`color_primaries=${color.out.primaries}`);
  if (color.out.trc) options.push(`color_trc=${color.out.trc}`);
  if (color.out.space) options.push(`colorspace=${color.out.space}`);
  return `setparams=${options.join(':')}`;
}

function buildVideoFilters({ picture = {}, size, interlace, rate, color, pixFmt }) {
  const filters = [];
  if (size.crop.active) filters.push(`crop=${size.cropWidth}:${size.cropHeight}:${size.crop.left}:${size.crop.top}`);
  filters.push(...interlaceFilters(interlace));
  filters.push(...rotateFilters(picture));
  const fpsFilter = rate.filter && rate.rate ? `fps=${rateString(rate.rate)}` : null;
  if (fpsFilter && rate.lowers) filters.push(fpsFilter);
  if (size.evenCrop) filters.push(`crop=${size.evenCrop.width}:${size.evenCrop.height}:0:0`);
  const scale = scaleFilter(size, color);
  if (scale) filters.push(scale);
  if (size.fill) filters.push(`crop=${size.fill.width}:${size.fill.height}:${size.fill.x}:${size.fill.y}`);
  if (size.pad) filters.push(`pad=${size.pad.width}:${size.pad.height}:${size.pad.x}:${size.pad.y}:black`);
  if (size.resized) filters.push('setsar=1');
  if (fpsFilter && !rate.lowers) filters.push(fpsFilter);
  if (color.tonemap) filters.push(...TONEMAP_CHAIN);
  if (pixFmt) filters.push(`format=${pixFmt}`);
  filters.push(setParamsFilter(color));
  return filters;
}

function colorOutputArgs(color) {
  const args = ['-color_range', 'tv'];
  if (color.out.primaries) args.push('-color_primaries', color.out.primaries);
  if (color.out.trc) args.push('-color_trc', color.out.trc);
  if (color.out.space) args.push('-colorspace', color.out.space);
  return args;
}

const LOUDNESS_TARGETS = Object.freeze({
  ebu: Object.freeze({ i: -23, tp: -2, lra: 11 }),
  atsc: Object.freeze({ i: -24, tp: -2, lra: 11 }),
  streaming: Object.freeze({ i: -14, tp: -1, lra: 11 })
});

function formatNumber(value, decimals = 2) {
  return String(Number(Number(value).toFixed(decimals)));
}

function loudnormFilter(target, measured = null, { printJson = false } = {}) {
  const goal = LOUDNESS_TARGETS[target];
  if (!goal) return null;
  const lra = measured ? Math.min(50, Math.max(goal.lra, Math.ceil(measured.inputLra + 1))) : goal.lra;
  const parts = [`I=${goal.i}`, `TP=${goal.tp}`, `LRA=${lra}`];
  if (measured) {
    parts.push(
      `measured_I=${formatNumber(measured.inputI)}`,
      `measured_TP=${formatNumber(measured.inputTp)}`,
      `measured_LRA=${formatNumber(measured.inputLra)}`,
      `measured_thresh=${formatNumber(measured.inputThresh)}`,
      `offset=${formatNumber(measured.targetOffset)}`,
      'linear=true'
    );
  }
  parts.push(`print_format=${printJson ? 'json' : 'none'}`);
  return `loudnorm=${parts.join(':')}`;
}

function downmixFilter(channels) {
  if (channels === 1) return 'aformat=channel_layouts=mono';
  if (channels === 2) return 'aformat=channel_layouts=stereo';
  return null;
}

function buildAudioFilters({ volumeDb = 0, loudness = 'off', measured = null, sampleRate = null, channels = null, sourceChannels = 0, codec = null, asyncFix = false }) {
  const filters = [];
  const normalize = Boolean(LOUDNESS_TARGETS[loudness]);
  if (normalize && channels && channels !== sourceChannels) {
    const downmix = downmixFilter(channels);
    if (downmix) filters.push(downmix);
  }
  if (!normalize && Number(volumeDb)) filters.push(`volume=${formatNumber(volumeDb, 1)}dB`);
  if (normalize) filters.push(loudnormFilter(loudness, measured));
  if (sampleRate || asyncFix || normalize) {
    const options = [];
    if (sampleRate) options.push(String(sampleRate));
    if (asyncFix) options.push(ASYNC_RESAMPLE);
    if (options.length) filters.push(`aresample=${options.join(':')}`);
  }
  const finalChannels = channels || sourceChannels;
  if (codec === 'libopus' && finalChannels > 2 && OPUS_LAYOUTS[finalChannels]) filters.push(`aformat=channel_layouts=${OPUS_LAYOUTS[finalChannels]}`);
  return filters;
}

module.exports = {
  RESOLUTION_BOXES,
  LOUDNESS_TARGETS,
  geometry,
  planSize,
  interlaceDecision,
  rateDecision,
  colorDecision,
  isHdrToSdr,
  isRgbInput,
  buildVideoFilters,
  buildAudioFilters,
  colorOutputArgs,
  loudnormFilter,
  rotateFilters,
  normalizedCrop
};
