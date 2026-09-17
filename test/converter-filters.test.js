const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const filters = require('../src/main/converter/filters');
const { parseProbe } = require('../src/main/converter/media');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');

function media(name, videoPatch = null) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
  if (videoPatch) Object.assign(data.streams.find((stream) => stream.codec_type === 'video'), videoPatch);
  return parseProbe(data, { path: data.format.filename });
}

const PICTURE = {
  resolution: 'keep',
  width: 1920,
  height: 1080,
  fit: 'pad',
  noUpscale: false,
  cfr: false,
  fps: 'keep',
  customFps: '',
  deinterlace: 'auto',
  deinterlaceRate: 'frame',
  ivtc: 'auto',
  squarePixels: true,
  colorConvert: 'auto',
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: { top: 0, bottom: 0, left: 0, right: 0 }
};

function picture(patch = {}) {
  return { ...PICTURE, ...patch };
}

function chain(item, pic, { analysis = null, codec = 'h264', tenBit = false, pixFmt = 'yuv420p' } = {}) {
  const interlace = filters.interlaceDecision(item, pic, analysis);
  const size = filters.planSize(item, pic);
  const rate = filters.rateDecision(item, pic, interlace);
  const color = filters.colorDecision(item, pic, size, { codec, tenBit });
  return { interlace, size, rate, color, list: filters.buildVideoFilters({ picture: pic, size, interlace, rate, color, pixFmt }) };
}

describe('planSize', () => {
  test('NTSC DV to 1080p pad: square pixels folded into one scale, pillarboxed', () => {
    const size = filters.planSize(media('ntsc-dv'), picture({ resolution: '1080p' }));
    assert.deepEqual(size.scale, { width: 1440, height: 1080 });
    assert.deepEqual(size.pad, { width: 1920, height: 1080, x: 240, y: 0 });
    assert.equal(size.width, 1920);
    assert.equal(size.height, 1080);
    assert.equal(size.resized, true);
  });

  test('PAL 16:9 anamorphic fills 1080p without padding', () => {
    const size = filters.planSize(media('pal-anamorphic-vob'), picture({ resolution: '1080p' }));
    assert.deepEqual(size.scale, { width: 1920, height: 1080 });
    assert.equal(size.pad, null);
  });

  test('keep resolution with square pixels scales only the anamorphic width', () => {
    const dv = filters.planSize(media('ntsc-dv'), picture());
    assert.deepEqual(dv.scale, { width: 640, height: 480 });
    const pal = filters.planSize(media('pal-anamorphic-vob'), picture());
    assert.deepEqual(pal.scale, { width: 1024, height: 576 });
  });

  test('keep resolution without square pixels keeps the storage size and SAR', () => {
    const size = filters.planSize(media('ntsc-dv'), picture({ squarePixels: false }));
    assert.equal(size.scale, null);
    assert.equal(size.resized, false);
    assert.deepEqual(size.sar, { num: 8, den: 9 });
    assert.equal(size.width, 720);
  });

  test('square sources at their own size need no scaling', () => {
    const size = filters.planSize(media('h264-1080p5994'), picture());
    assert.equal(size.scale, null);
    assert.equal(size.evenCrop, null);
    assert.equal(size.resized, false);
  });

  test('odd storage sizes are cropped to even', () => {
    const size = filters.planSize(media('no-audio-mp4', { width: 641, height: 481 }), picture());
    assert.deepEqual(size.evenCrop, { width: 640, height: 480 });
  });

  test('a 4:3 source letterboxes nothing and pillarboxes into 720p', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ resolution: '720p' }));
    assert.deepEqual(size.scale, { width: 960, height: 720 });
    assert.deepEqual(size.pad, { width: 1280, height: 720, x: 160, y: 0 });
  });

  test('cinemascope letterboxes with an even vertical offset', () => {
    const size = filters.planSize(media('h264-1080p5994', { width: 1920, height: 800 }), picture({ resolution: '720p' }));
    assert.deepEqual(size.scale, { width: 1280, height: 534 });
    assert.equal(size.pad.y % 2, 0);
    assert.equal(size.pad.y, 92);
  });

  test('crop fit covers the box and crops the centre', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ resolution: '1080p', fit: 'crop' }));
    assert.deepEqual(size.scale, { width: 1920, height: 1440 });
    assert.deepEqual(size.fill, { width: 1920, height: 1080, x: 0, y: 180 });
    assert.equal(size.pad, null);
  });

  test('stretch ignores the aspect ratio', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ resolution: '1080p', fit: 'stretch' }));
    assert.deepEqual(size.scale, { width: 1920, height: 1080 });
    assert.equal(size.width, 1920);
  });

  test('fit keeps the aspect ratio without bars', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ resolution: '720p', fit: 'fit' }));
    assert.deepEqual(size.scale, { width: 960, height: 720 });
    assert.equal(size.width, 960);
    assert.equal(size.pad, null);
  });

  test('fit turns the box for portrait video', () => {
    const size = filters.planSize(media('h264-1080p5994', { width: 1080, height: 1920 }), picture({ resolution: '720p', fit: 'fit' }));
    assert.equal(size.width, 720);
    assert.equal(size.height, 1280);
  });

  test('pad keeps a landscape frame for portrait video', () => {
    const size = filters.planSize(media('rotated-mp4'), picture({ resolution: '1080p' }));
    assert.deepEqual(size.scale, { width: 810, height: 1080 });
    assert.equal(size.width, 1920);
    assert.equal(size.pad.x, 554);
  });

  test('noUpscale keeps small sources at their natural size', () => {
    const size = filters.planSize(media('ntsc-dv'), picture({ resolution: '720p', fit: 'fit', noUpscale: true }));
    assert.deepEqual(size.scale, { width: 640, height: 480 });
    assert.equal(size.width, 640);
    assert.equal(size.pad, null);
  });

  test('noUpscale with pad does not add bars around a small picture', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ resolution: '1080p', noUpscale: true }));
    assert.equal(size.pad, null);
    assert.equal(size.width, 640);
  });

  test('noUpscale still shrinks large sources', () => {
    const size = filters.planSize(media('h264-1080p5994'), picture({ resolution: '720p', fit: 'fit', noUpscale: true }));
    assert.deepEqual(size.scale, { width: 1280, height: 720 });
  });

  test('custom resolution uses the preset width and height', () => {
    const size = filters.planSize(media('h264-1080p5994'), picture({ resolution: 'custom', width: 1024, height: 576 }));
    assert.equal(size.width, 1024);
    assert.equal(size.height, 576);
  });

  test('user rotation swaps the display size before fitting', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ rotate: 90 }));
    assert.equal(size.storageWidth, 480);
    assert.equal(size.storageHeight, 640);
    assert.equal(size.width, 480);
  });

  test('crop values shrink the source before sizing and stay even', () => {
    const size = filters.planSize(media('ntsc-dv'), picture({ crop: { top: 0, bottom: 0, left: 9, right: 8 } }));
    assert.equal(size.crop.left, 8);
    assert.equal(size.cropWidth, 704);
    assert.deepEqual(size.scale, { width: 626, height: 480 });
  });

  test('a crop that would leave nothing is ignored', () => {
    const size = filters.planSize(media('xvid-avi'), picture({ crop: { top: 300, bottom: 300, left: 0, right: 0 } }));
    assert.equal(size.crop.active, false);
  });
});

describe('interlaceDecision', () => {
  test('auto deinterlaces flagged interlaced sources with their parity', () => {
    const decision = filters.interlaceDecision(media('ntsc-dv'), picture());
    assert.equal(decision.mode, 'deinterlace');
    assert.equal(decision.parity, 'bff');
  });

  test('auto leaves progressive and unknown sources alone', () => {
    assert.equal(filters.interlaceDecision(media('h264-1080p5994'), picture()).mode, 'none');
    assert.equal(filters.interlaceDecision(media('xvid-avi'), picture()).mode, 'none');
  });

  test('analysis overrides the flags, both ways', () => {
    assert.equal(filters.interlaceDecision(media('xvid-avi'), picture(), { verdict: 'tff', telecine: false }).mode, 'deinterlace');
    assert.equal(filters.interlaceDecision(media('ntsc-dv'), picture(), { verdict: 'progressive', telecine: false }).mode, 'none');
  });

  test('an unknown analysis keeps the flags', () => {
    assert.equal(filters.interlaceDecision(media('ntsc-dv'), picture(), { verdict: 'unknown', telecine: false }).parity, 'bff');
  });

  test('on forces deinterlacing with auto parity when the order is unknown', () => {
    const decision = filters.interlaceDecision(media('xvid-avi'), picture({ deinterlace: 'on' }));
    assert.equal(decision.mode, 'deinterlace');
    assert.equal(decision.parity, 'auto');
  });

  test('off never deinterlaces', () => {
    assert.equal(filters.interlaceDecision(media('ntsc-dv'), picture({ deinterlace: 'off' })).mode, 'none');
  });

  test('auto inverse telecine follows the analysis on 29.97 material', () => {
    const decision = filters.interlaceDecision(media('telecine-mpeg2'), picture(), { verdict: 'tff', telecine: true });
    assert.equal(decision.mode, 'ivtc');
    assert.equal(decision.parity, 'tff');
  });

  test('inverse telecine is refused on 25 fps material and falls back to deinterlacing', () => {
    const item = media('pal-anamorphic-vob', { field_order: 'tt' });
    const decision = filters.interlaceDecision(item, picture({ ivtc: 'on' }));
    assert.equal(decision.mode, 'deinterlace');
    assert.deepEqual(decision.warnings, ['ivtc-not-applicable']);
  });

  test('field rate output is remembered', () => {
    assert.equal(filters.interlaceDecision(media('ntsc-dv'), picture({ deinterlaceRate: 'field' })).fieldRate, true);
  });
});

describe('rateDecision', () => {
  test('keep on a constant source adds no filter', () => {
    const item = media('xvid-avi');
    const rate = filters.rateDecision(item, picture(), { mode: 'none' });
    assert.deepEqual(rate, { rate: { num: 30000, den: 1001 }, filter: false, passthrough: false, lowers: false });
  });

  test('field rate deinterlacing doubles the rate', () => {
    const rate = filters.rateDecision(media('ntsc-dv'), picture(), { mode: 'deinterlace', fieldRate: true });
    assert.deepEqual(rate.rate, { num: 60000, den: 1001 });
    assert.equal(rate.filter, false);
  });

  test('inverse telecine gives 23.976', () => {
    const rate = filters.rateDecision(media('telecine-mpeg2'), picture(), { mode: 'ivtc' });
    assert.deepEqual(rate.rate, { num: 24000, den: 1001 });
  });

  test('a requested rate adds an fps filter and knows when it lowers the rate', () => {
    const rate = filters.rateDecision(media('h264-1080p5994'), picture({ fps: '30000/1001' }), { mode: 'none' });
    assert.equal(rate.filter, true);
    assert.equal(rate.lowers, true);
    const up = filters.rateDecision(media('pal-anamorphic-vob'), picture({ fps: '50' }), { mode: 'none' });
    assert.equal(up.lowers, false);
  });

  test('requesting the rate the source already has adds nothing', () => {
    assert.equal(filters.rateDecision(media('xvid-avi'), picture({ fps: '30000/1001' }), { mode: 'none' }).filter, false);
  });

  test('with cfr on, even the same requested rate is enforced', () => {
    const rate = filters.rateDecision(media('xvid-avi'), picture({ fps: '30000/1001', cfr: true }), { mode: 'none' });
    assert.equal(rate.filter, true);
    assert.deepEqual(rate.rate, { num: 30000, den: 1001 });
  });

  test('custom rates are parsed', () => {
    const rate = filters.rateDecision(media('xvid-avi'), picture({ fps: 'custom', customFps: '12.5' }), { mode: 'none' });
    assert.deepEqual(rate.rate, { num: 25, den: 2 });
  });

  test('VFR with cfr off passes timestamps through', () => {
    const rate = filters.rateDecision(media('vfr-mp4'), picture(), { mode: 'none' });
    assert.equal(rate.passthrough, true);
    assert.equal(rate.filter, false);
  });

  test('VFR with cfr on picks the nearest standard rate of the average', () => {
    const rate = filters.rateDecision(media('vfr-mp4'), picture({ cfr: true }), { mode: 'none' });
    assert.equal(rate.filter, true);
    assert.deepEqual(rate.rate, { num: 24000, den: 1001 });
  });

  test('a phone clip near its nominal 30 keeps 30 rather than 29.97', () => {
    const item = media('h264-1080p5994', { r_frame_rate: '30/1', avg_frame_rate: '2987/100' });
    assert.deepEqual(filters.rateDecision(item, picture({ cfr: true }), { mode: 'none' }).rate, { num: 30, den: 1 });
  });

  test('cfr on a constant source pins its own rate so dropped AVI frames are filled', () => {
    assert.deepEqual(filters.rateDecision(media('xvid-avi'), picture({ cfr: true }), { mode: 'none' }), {
      rate: { num: 30000, den: 1001 },
      filter: true,
      passthrough: false,
      lowers: false
    });
  });

  test('cfr follows the rate after field rate deinterlacing and inverse telecine', () => {
    assert.deepEqual(filters.rateDecision(media('ntsc-dv'), picture({ cfr: true }), { mode: 'deinterlace', fieldRate: true }).rate, { num: 60000, den: 1001 });
    const ivtc = filters.rateDecision(media('telecine-mpeg2'), picture({ cfr: true }), { mode: 'ivtc' });
    assert.deepEqual(ivtc.rate, { num: 24000, den: 1001 });
    assert.equal(ivtc.filter, true);
  });

  test('cfr without a known source rate adds nothing', () => {
    const item = media('xvid-avi', { r_frame_rate: '0/0', avg_frame_rate: '0/0' });
    const rate = filters.rateDecision(item, picture({ cfr: true }), { mode: 'none' });
    assert.equal(rate.filter, false);
    assert.equal(rate.rate, null);
  });

  test('soft telecine is normalised to constant 23.976', () => {
    const item = media('dvd-mpeg2', { r_frame_rate: '30000/1001', avg_frame_rate: '24000/1001' });
    const rate = filters.rateDecision(item, picture(), { mode: 'none' });
    assert.equal(rate.filter, true);
    assert.deepEqual(rate.rate, { num: 24000, den: 1001 });
  });
});

describe('colorDecision', () => {
  test('SD NTSC going to HD converts BT.601 to BT.709', () => {
    const color = filters.colorDecision(media('ntsc-dv'), picture(), { width: 1920, height: 1080 });
    assert.equal(color.convert, true);
    assert.equal(color.inMatrix, 'bt601');
    assert.deepEqual(color.out, { space: 'bt709', primaries: 'bt709', trc: 'bt709' });
  });

  test('SD staying SD is tagged BT.601 for its standard', () => {
    const ntsc = filters.colorDecision(media('ntsc-dv'), picture(), { width: 640, height: 480 });
    assert.equal(ntsc.convert, false);
    assert.deepEqual(ntsc.out, { space: 'smpte170m', primaries: 'smpte170m', trc: 'smpte170m' });
    const pal = filters.colorDecision(media('pal-anamorphic-vob'), picture(), { width: 1024, height: 576 });
    assert.deepEqual(pal.out, { space: 'bt470bg', primaries: 'bt470bg', trc: 'smpte170m' });
  });

  test('colorConvert off keeps the BT.601 matrix on HD output', () => {
    const color = filters.colorDecision(media('ntsc-dv'), picture({ colorConvert: 'off' }), { width: 1920, height: 1080 });
    assert.equal(color.convert, false);
    assert.equal(color.out.space, 'smpte170m');
  });

  test('HD sources are tagged BT.709 without conversion', () => {
    const color = filters.colorDecision(media('h264-1080p5994'), picture(), { width: 1920, height: 1080 });
    assert.equal(color.convert, false);
    assert.deepEqual(color.out, { space: 'bt709', primaries: 'bt709', trc: 'bt709' });
  });

  test('an HD file tagged BT.601 is converted', () => {
    const item = media('h264-1080p5994', { color_space: 'smpte170m' });
    assert.equal(filters.colorDecision(item, picture(), { width: 1280, height: 720 }).convert, true);
  });

  test('portrait 720x1280 output counts as HD', () => {
    assert.equal(filters.colorDecision(media('xvid-avi'), picture(), { width: 720, height: 1280 }).convert, true);
  });

  test('full range sources are brought to limited range', () => {
    const color = filters.colorDecision(media('mjpeg-pcm-avi'), picture(), { width: 640, height: 480 });
    assert.equal(color.pcRange, true);
    assert.equal(color.out.space, 'bt470bg');
  });

  test('HDR to H.264 is tone mapped to BT.709', () => {
    const color = filters.colorDecision(media('hdr10-mp4'), picture(), { width: 1920, height: 1080 }, { codec: 'h264' });
    assert.equal(color.tonemap, true);
    assert.deepEqual(color.out, { space: 'bt709', primaries: 'bt709', trc: 'bt709' });
  });

  test('HDR to 10-bit HEVC keeps its HDR tags', () => {
    const color = filters.colorDecision(media('hdr10-mp4'), picture(), { width: 1920, height: 1080 }, { codec: 'hevc', tenBit: true });
    assert.equal(color.tonemap, false);
    assert.deepEqual(color.out, { space: 'bt2020nc', primaries: 'bt2020', trc: 'smpte2084' });
  });

  test('HDR to an 8-bit only encoder is tone mapped', () => {
    assert.equal(filters.colorDecision(media('hdr10-mp4'), picture(), { width: 1280, height: 720 }, { codec: 'hevc', tenBit: false }).tonemap, true);
  });

  test('RGB sources are converted with the matrix of the output size, not the default BT.601', () => {
    const png = media('h264-1080p5994', { pix_fmt: 'rgb24', color_space: 'gbr', color_transfer: 'iec61966-2-1', color_range: 'pc' });
    const hd = filters.colorDecision(png, picture(), { width: 1920, height: 1080 });
    assert.equal(hd.rgb, true);
    assert.equal(hd.convert, false);
    assert.equal(hd.pcRange, false);
    assert.equal(hd.outMatrix, 'bt709');
    assert.deepEqual(hd.out, { space: 'bt709', primaries: 'bt709', trc: 'bt709' });
    const sd = filters.colorDecision(png, picture(), { width: 640, height: 360 });
    assert.equal(sd.outMatrix, 'bt601');
    assert.deepEqual(sd.out, { space: 'smpte170m', primaries: 'smpte170m', trc: 'smpte170m' });
  });

  test('planar RGB and palette formats count as RGB, gray and YUV do not', () => {
    for (const pixFmt of ['gbrp', 'gbrp10le', 'bgr0', 'rgb48le', 'argb', 'pal8', 'x2rgb10le']) {
      assert.equal(filters.isRgbInput({ pixFmt, colorSpace: null }), true, pixFmt);
    }
    for (const pixFmt of ['yuv420p', 'yuvj422p', 'nv12', 'gray', 'p010le', 'uyvy422', null]) {
      assert.equal(filters.isRgbInput({ pixFmt, colorSpace: 'bt709' }), false, String(pixFmt));
    }
    assert.equal(filters.isRgbInput({ pixFmt: 'yuv444p', colorSpace: 'gbr' }), true);
  });

  test('HDR RGB kept in 10-bit is converted with the BT.2020 matrix', () => {
    const item = media('hdr10-mp4', { pix_fmt: 'gbrp10le', color_space: 'gbr' });
    const color = filters.colorDecision(item, picture(), { width: 1920, height: 1080 }, { codec: 'hevc', tenBit: true });
    assert.equal(color.outMatrix, 'bt2020');
    assert.equal(color.out.space, 'bt2020nc');
  });

  test('gamma28 transfer is renamed for setparams', () => {
    const item = media('pal-anamorphic-vob', { color_transfer: 'gamma28' });
    assert.equal(filters.colorDecision(item, picture(), { width: 1024, height: 576 }).out.trc, 'bt470bg');
  });
});

describe('buildVideoFilters', () => {
  test('FlowAir-style chain for NTSC DV', () => {
    const { list } = chain(media('ntsc-dv'), picture({ resolution: '1080p', cfr: true }));
    assert.deepEqual(list, [
      'bwdif=mode=send_frame:parity=bff:deint=all',
      'scale=1440:1080:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709',
      'pad=1920:1080:240:0:black',
      'setsar=1',
      'fps=30000/1001',
      'format=yuv420p',
      'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    ]);
  });

  test('an RGB source picks the output matrix and limited range inside its only scale', () => {
    const { list } = chain(media('h264-1080p5994', { pix_fmt: 'rgb24', color_space: 'gbr' }), picture({ resolution: '720p' }));
    assert.deepEqual(list, [
      'scale=1280:720:flags=lanczos:out_color_matrix=bt709:out_range=tv',
      'setsar=1',
      'format=yuv420p',
      'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    ]);
  });

  test('an RGB source kept at its size still gets an explicit conversion', () => {
    const hd = chain(media('h264-1080p5994', { pix_fmt: 'bgra' }), picture());
    assert.equal(hd.list[0], 'scale=out_color_matrix=bt709:out_range=tv');
    const sd = chain(media('xvid-avi', { pix_fmt: 'pal8' }), picture());
    assert.equal(sd.list[0], 'scale=out_color_matrix=bt601:out_range=tv');
    assert.equal(sd.list.at(-1), 'setparams=range=tv:color_primaries=smpte170m:color_trc=smpte170m:colorspace=smpte170m');
  });

  test('inverse telecine chain order', () => {
    const { list } = chain(media('telecine-mpeg2'), picture(), { analysis: { verdict: 'tff', telecine: true } });
    assert.deepEqual(list.slice(0, 3), ['fieldmatch=order=tff:combmatch=full', 'yadif=deint=interlaced', 'decimate']);
  });

  test('crop comes first, then deinterlace, rotation and scaling', () => {
    const pic = picture({ crop: { top: 0, bottom: 0, left: 8, right: 8 }, rotate: 90, flipH: true, resolution: '720p' });
    const { list } = chain(media('ntsc-dv'), pic);
    assert.equal(list[0], 'crop=704:480:8:0');
    assert.ok(list[1].startsWith('bwdif='));
    assert.equal(list[2], 'transpose=clock');
    assert.equal(list[3], 'hflip');
    assert.ok(list[4].startsWith('scale='));
  });

  test('rotation filters', () => {
    assert.deepEqual(filters.rotateFilters({ rotate: 270 }), ['transpose=cclock']);
    assert.deepEqual(filters.rotateFilters({ rotate: 180, flipV: true }), ['hflip', 'vflip', 'vflip']);
    assert.deepEqual(filters.rotateFilters({}), []);
  });

  test('a lower frame rate is applied before scaling, a higher one after', () => {
    const down = chain(media('h264-1080p5994'), picture({ fps: '30000/1001', resolution: '720p' })).list;
    assert.ok(down.indexOf('fps=30000/1001') < down.findIndex((item) => item.startsWith('scale=')));
    const up = chain(media('pal-anamorphic-vob'), picture({ fps: '50', resolution: '720p' })).list;
    assert.ok(up.indexOf('fps=50') > up.findIndex((item) => item.startsWith('scale=')));
  });

  test('full range sources get an explicit range conversion even without resizing', () => {
    const { list } = chain(media('mjpeg-pcm-avi'), picture());
    assert.equal(list[0], 'scale=in_range=pc:out_range=tv');
  });

  test('HDR tone mapping runs after scaling and before the pixel format', () => {
    const { list } = chain(media('hdr10-mp4'), picture({ resolution: '1080p' }));
    const scale = list.findIndex((item) => item.startsWith('scale='));
    const tonemap = list.findIndex((item) => item.startsWith('tonemap='));
    const format = list.indexOf('format=yuv420p');
    assert.ok(scale < tonemap && tonemap < format);
    assert.equal(list[scale], 'scale=1920:1080:flags=lanczos');
  });

  test('a clean HD source only gets format and tags', () => {
    const { list } = chain(media('h264-1080p5994'), picture(), { pixFmt: 'nv12' });
    assert.deepEqual(list, ['format=nv12', 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709']);
  });

  test('colorOutputArgs mirrors the tags', () => {
    const color = filters.colorDecision(media('ntsc-dv'), picture(), { width: 640, height: 480 });
    assert.deepEqual(filters.colorOutputArgs(color), ['-color_range', 'tv', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-colorspace', 'smpte170m']);
  });
});

describe('buildAudioFilters', () => {
  test('plain resample to 48 kHz', () => {
    assert.deepEqual(filters.buildAudioFilters({ sampleRate: 48000, channels: 2, sourceChannels: 2, codec: 'aac' }), ['aresample=48000']);
  });

  test('AVI sync repair is merged into the resampler', () => {
    assert.deepEqual(filters.buildAudioFilters({ sampleRate: 48000, asyncFix: true, codec: 'aac' }), ['aresample=48000:async=1:min_hard_comp=0.100000:first_pts=0']);
  });

  test('volume is applied only without loudness normalization', () => {
    assert.deepEqual(filters.buildAudioFilters({ volumeDb: -3.25, sampleRate: 48000 }), ['volume=-3.3dB', 'aresample=48000']);
    const list = filters.buildAudioFilters({ volumeDb: 6, loudness: 'ebu', sampleRate: 48000 });
    assert.equal(list.some((item) => item.startsWith('volume')), false);
  });

  test('one-pass loudness normalization downmixes first and resamples after', () => {
    const list = filters.buildAudioFilters({ loudness: 'ebu', sampleRate: 48000, channels: 2, sourceChannels: 6, codec: 'aac' });
    assert.deepEqual(list, ['aformat=channel_layouts=stereo', 'loudnorm=I=-23:TP=-2:LRA=11:print_format=none', 'aresample=48000']);
  });

  test('two-pass loudness uses the measurements in linear mode and keeps a wider LRA', () => {
    const measured = { inputI: -41.61, inputTp: -31.04, inputLra: 14.2, inputThresh: -53.86, targetOffset: -0.11 };
    const [loudnorm] = filters.buildAudioFilters({ loudness: 'atsc', measured, sampleRate: 48000 });
    assert.equal(loudnorm, 'loudnorm=I=-24:TP=-2:LRA=16:measured_I=-41.61:measured_TP=-31.04:measured_LRA=14.2:measured_thresh=-53.86:offset=-0.11:linear=true:print_format=none');
  });

  test('streaming target', () => {
    assert.equal(filters.loudnormFilter('streaming'), 'loudnorm=I=-14:TP=-1:LRA=11:print_format=none');
    assert.equal(filters.loudnormFilter('off'), null);
    assert.equal(filters.loudnormFilter('ebu', null, { printJson: true }), 'loudnorm=I=-23:TP=-2:LRA=11:print_format=json');
  });

  test('Opus above stereo gets a layout libopus accepts', () => {
    assert.deepEqual(filters.buildAudioFilters({ sampleRate: 48000, channels: 6, sourceChannels: 6, codec: 'libopus' }), ['aresample=48000', 'aformat=channel_layouts=5.1']);
    assert.deepEqual(filters.buildAudioFilters({ sampleRate: 48000, channels: 2, sourceChannels: 6, codec: 'libopus' }), ['aresample=48000']);
  });
});
