const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const media = require('../src/main/converter/media');

const FIXTURES = path.join(__dirname, 'fixtures', 'converter');

function raw(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `probe-${name}.json`), 'utf8'));
}

function load(name, file = raw(name).format.filename) {
  return media.parseProbe(raw(name), { path: file });
}

function withVideo(name, patch) {
  const data = raw(name);
  const stream = data.streams.find((item) => item.codec_type === 'video');
  Object.assign(stream, patch);
  return media.parseProbe(data, { path: data.format.filename });
}

describe('probeArgs', () => {
  test('asks ffprobe for format and streams as JSON with a file: url', () => {
    const args = media.probeArgs('C:\\Media\\clip [1].avi');
    assert.deepEqual(args, ['-v', 'error', '-hide_banner', '-show_format', '-show_streams', '-of', 'json', '-i', 'file:C:\\Media\\clip [1].avi']);
  });

  test('deep probe raises analyzeduration and probesize before the input', () => {
    const args = media.probeArgs('C:\\Media\\dvd.vob', { deep: true });
    assert.ok(args.indexOf('-probesize') < args.indexOf('-i'));
    assert.equal(args[args.indexOf('-analyzeduration') + 1], '100M');
  });

  test('keeps a path with spaces, accents and emoji as one argument', () => {
    const file = 'D:\\Archivo TV\\Año 1998 – señal 🎬.mpg';
    const args = media.probeArgs(file);
    assert.equal(args.at(-1), `file:${file}`);
  });
});

describe('parseProbe on old broadcast material', () => {
  test('NTSC DV is bottom field first, anamorphic 4:3 and ignores the bogus average rate', () => {
    const item = load('ntsc-dv');
    assert.equal(item.container, 'dv');
    assert.equal(item.video.codecLabel, 'DV');
    assert.equal(item.video.fieldOrder, 'bff');
    assert.deepEqual(item.video.sar, { num: 8, den: 9 });
    assert.deepEqual(item.video.fps, { num: 30000, den: 1001 });
    assert.equal(item.video.vfr, false);
    assert.equal(item.video.displayWidth, 640);
    assert.equal(item.video.aspectLabel, '4:3');
    assert.equal(item.video.standard, 'NTSC');
    assert.equal(item.video.isSD, true);
    assert.deepEqual(item.badges, ['DV', 'DV', '480i NTSC', '29.97', '4:3', 'PCM']);
    assert.deepEqual(item.warnings, ['anamorphic']);
  });

  test('Xvid AVI is labelled from the codec tag and its field order is unknown', () => {
    const item = load('xvid-avi');
    assert.equal(item.container, 'avi');
    assert.equal(item.containerLabel, 'AVI');
    assert.equal(item.video.codecLabel, 'Xvid');
    assert.equal(item.video.codecTag, 'XVID');
    assert.equal(item.video.fieldOrder, 'unknown');
    assert.equal(item.audio[0].codecLabel, 'MP3');
    assert.deepEqual(item.badges, ['AVI', 'Xvid', '480 NTSC', '29.97', '4:3', 'MP3']);
    assert.ok(item.warnings.includes('field-order-unknown'));
    assert.equal(item.durationReliable, true);
  });

  test('DivX and other MPEG-4 part 2 tags get readable labels', () => {
    assert.equal(withVideo('xvid-avi', { codec_tag_string: 'DX50' }).video.codecLabel, 'DivX');
    assert.equal(withVideo('xvid-avi', { codec_tag_string: 'FMP4' }).video.codecLabel, 'MPEG-4');
    assert.equal(withVideo('xvid-avi', { codec_tag_string: 'ABCD' }).video.codecLabel, 'MPEG-4 Part 2');
    assert.equal(withVideo('xvid-avi', { codec_name: 'msmpeg4v3', codec_tag_string: 'DIV3' }).video.codecLabel, 'DivX 3');
  });

  test('DVD MPEG-2 in a program stream keeps its start time and 29.97 rate', () => {
    const item = load('dvd-mpeg2');
    assert.equal(item.container, 'mpeg');
    assert.equal(item.containerLabel, 'MPEG-PS');
    assert.equal(item.video.codecLabel, 'MPEG-2');
    assert.equal(item.video.index, 1);
    assert.ok(item.startTime > 0.5);
    assert.equal(item.audio[0].codecLabel, 'AC-3');
    assert.equal(item.video.fpsLabel, '29.97');
  });

  test('a .vob extension is reported as VOB', () => {
    assert.equal(load('dvd-mpeg2', 'C:\\Media\\VTS_01_1.VOB').container, 'vob');
  });

  test('telecined MPEG-2 flagged top field first maps tt to tff', () => {
    const item = load('telecine-mpeg2');
    assert.equal(item.video.fieldOrder, 'tff');
    assert.equal(item.video.resolutionLabel, '480i');
    assert.ok(item.warnings.includes('no-audio'));
  });

  test('field orders tb and bt follow the display order', () => {
    assert.equal(withVideo('telecine-mpeg2', { field_order: 'tb' }).video.fieldOrder, 'bff');
    assert.equal(withVideo('telecine-mpeg2', { field_order: 'bt' }).video.fieldOrder, 'tff');
    assert.equal(withVideo('telecine-mpeg2', { field_order: 'bb' }).video.fieldOrder, 'bff');
  });

  test('PAL anamorphic 16:9 VOB has SAR 64:45 and a 1024 wide display', () => {
    const item = load('pal-anamorphic-vob');
    assert.equal(item.container, 'vob');
    assert.deepEqual(item.video.sar, { num: 64, den: 45 });
    assert.equal(item.video.displayWidth, 1024);
    assert.equal(item.video.aspectLabel, '16:9');
    assert.equal(item.video.standard, 'PAL');
    assert.equal(item.audio[0].codecLabel, 'MP2');
    assert.ok(item.warnings.includes('anamorphic'));
  });

  test('Motion JPEG AVI keeps full range and a PCM track without duration', () => {
    const item = load('mjpeg-pcm-avi');
    assert.equal(item.video.codecLabel, 'Motion JPEG');
    assert.equal(item.video.colorRange, 'pc');
    assert.equal(item.audio[0].codecLabel, 'PCM');
    assert.equal(item.audio[0].duration, null);
    assert.equal(item.audio[0].layout, 'mono');
    assert.equal(item.video.standard, null);
  });
});

describe('parseProbe on modern files', () => {
  test('1080p 59.94 H.264 is HD with no standard', () => {
    const item = load('h264-1080p5994');
    assert.equal(item.video.resolutionLabel, '1080p');
    assert.equal(item.video.fpsLabel, '59.94');
    assert.deepEqual(item.video.fps, { num: 60000, den: 1001 });
    assert.equal(item.video.isSD, false);
    assert.equal(item.video.standard, null);
    assert.deepEqual(item.badges, ['MP4', 'H.264', '1080p', '59.94', '16:9', 'AAC']);
    assert.deepEqual(item.warnings, []);
  });

  test('HEVC 10-bit in MKV reads stream durations from tags', () => {
    const item = load('hevc10-mkv');
    assert.equal(item.container, 'mkv');
    assert.equal(item.video.bitDepth, 10);
    assert.equal(item.video.duration, 3);
    assert.equal(item.audio[0].codecLabel, 'Opus');
    assert.ok(item.badges.includes('10-bit'));
  });

  test('the plain DURATION tag wins over a stale language-suffixed copy in any order', () => {
    const item = withVideo('hevc10-mkv', { tags: { 'DURATION-eng': '01:00:00.000000000', DURATION: '00:00:02.500000000' } });
    assert.equal(item.video.duration, 2.5);
    const localizedOnly = withVideo('hevc10-mkv', { tags: { 'DURATION-eng': '00:00:02.000000000' } });
    assert.equal(localizedOnly.video.duration, 2);
    const garbage = withVideo('hevc10-mkv', { tags: { DURATION: 'N/A', 'DURATION-spa': '00:00:01.000000000' } });
    assert.equal(garbage.video.duration, 1);
  });

  test('a delayed MKV track whose DURATION tag is its end time is cut to the container end', () => {
    const data = raw('hevc10-mkv');
    const audio = data.streams.find((stream) => stream.codec_type === 'audio');
    data.format.duration = '3.621000';
    audio.start_time = '0.600000';
    audio.tags = { ...(audio.tags || {}), DURATION: '00:00:03.621000000' };
    const item = media.parseProbe(data, { path: data.format.filename });
    assert.equal(item.audio[0].duration, 3.021);
    assert.equal(item.duration, 3.621);
  });

  test('streams inside the container and negative starts are left alone', () => {
    const data = raw('h264-1080p5994');
    const audio = data.streams.find((stream) => stream.codec_type === 'audio');
    audio.start_time = '-0.021333';
    audio.duration = String(Number(data.format.duration) + 0.021333);
    const item = media.parseProbe(data, { path: data.format.filename });
    assert.equal(item.audio[0].duration, Number(audio.duration));
    const untouched = load('dvd-mpeg2');
    const rawDvd = raw('dvd-mpeg2');
    assert.deepEqual(
      untouched.audio.map((track) => track.duration),
      rawDvd.streams.filter((stream) => stream.codec_type === 'audio').map((stream) => Number(stream.duration))
    );
  });

  test('N/A and empty numeric fields do not become numbers', () => {
    const item = withVideo('hevc10-mkv', { bit_rate: 'N/A', nb_frames: '', width: 'N/A', start_time: 'N/A' });
    assert.equal(item.video.bitrate, null);
    assert.equal(item.video.frames, null);
    assert.equal(item.video.width, 0);
    assert.equal(item.video.startTime, null);
    assert.equal(item.video.isSD, false);
    assert.ok(item.badges.every((badge) => typeof badge === 'string' && !badge.includes('NaN')));
  });

  test('an empty or broken probe gives an empty media summary instead of throwing', () => {
    const empty = media.parseProbe({}, { path: 'C:\\x\\empty.bin' });
    assert.equal(empty.video, null);
    assert.deepEqual(empty.audio, []);
    assert.equal(empty.durationReliable, false);
    assert.ok(empty.warnings.includes('no-video'));
    assert.ok(empty.warnings.includes('no-audio'));
    assert.equal(media.parseProbe(null, { path: 'C:\\x\\n.bin' }).video, null);
    assert.throws(() => media.parseProbe('{not json', { path: 'C:\\x\\n.bin' }), SyntaxError);
  });

  test('a .webm and a .mka file are told apart from mkv', () => {
    assert.equal(load('hevc10-mkv', 'C:\\x\\a.webm').container, 'webm');
    assert.equal(load('hevc10-mkv', 'C:\\x\\a.mka').containerLabel, 'MKA');
  });

  test('HDR10 is detected from the PQ transfer', () => {
    const item = load('hdr10-mp4');
    assert.equal(item.video.isHDR, true);
    assert.equal(item.video.colorTransfer, 'smpte2084');
    assert.ok(item.badges.includes('HDR10'));
    assert.ok(item.warnings.includes('hdr'));
  });

  test('HLG is HDR too', () => {
    const item = withVideo('hdr10-mp4', { color_transfer: 'arib-std-b67' });
    assert.equal(item.video.isHDR, true);
    assert.ok(item.badges.includes('HLG'));
  });

  test('a 90 degree display matrix swaps the display size', () => {
    const item = load('rotated-mp4');
    assert.equal(item.video.rotation, 270);
    assert.equal(item.video.displayWidth, 480);
    assert.equal(item.video.displayHeight, 640);
    assert.equal(item.video.aspectLabel, '3:4');
    assert.ok(item.warnings.includes('rotated'));
  });

  test('a phone rotation of -90 means 90 degrees clockwise', () => {
    const data = raw('rotated-mp4');
    data.streams[0].side_data_list[0].rotation = -90;
    const item = media.parseProbe(data, { path: 'C:\\x\\phone.mp4' });
    assert.equal(item.video.rotation, 90);
    assert.equal(item.video.displayHeight, 640);
  });

  test('the legacy rotate tag is honoured', () => {
    const data = raw('no-audio-mp4');
    data.streams[0].tags = { rotate: '180' };
    assert.equal(media.parseProbe(data, { path: 'C:\\x\\a.mp4' }).video.rotation, 180);
  });

  test('5.1 audio shows its layout in the badge', () => {
    const item = load('surround-mkv');
    assert.equal(item.audio[0].channels, 6);
    assert.ok(item.badges.includes('AC-3 5.1'));
  });

  test('multiple audio tracks keep language, title and default flag', () => {
    const item = load('multi-track-mkv');
    assert.equal(item.audio.length, 2);
    assert.equal(item.audio[0].language, 'eng');
    assert.equal(item.audio[1].language, 'spa');
    assert.equal(item.audio[1].title, 'Spanish dub');
    assert.equal(item.audio[0].isDefault, true);
    assert.equal(item.subtitles.length, 1);
    assert.equal(item.subtitles[0].textBased, true);
    assert.ok(item.badges.includes('2 audio tracks'));
  });

  test('bitmap subtitles raise a warning', () => {
    const data = raw('multi-track-mkv');
    data.streams[3].codec_name = 'hdmv_pgs_subtitle';
    const item = media.parseProbe(data, { path: 'C:\\x\\a.mkv' });
    assert.equal(item.subtitles[0].textBased, false);
    assert.ok(item.warnings.includes('bitmap-subtitles'));
  });

  test('cover art is not treated as video', () => {
    const item = load('cover-art-mp3');
    assert.equal(item.video, null);
    assert.equal(item.audio.length, 1);
    assert.deepEqual(item.badges, ['MP3', 'MP3', 'Mono', '44.1 kHz', '192 kbps']);
    assert.ok(item.warnings.includes('no-video'));
  });

  test('a file without audio warns no-audio', () => {
    const item = load('no-audio-mp4');
    assert.equal(item.audio.length, 0);
    assert.deepEqual(item.warnings, ['no-audio']);
  });
});

describe('frame rate and VFR detection', () => {
  test('an average far below the real rate is VFR', () => {
    const item = load('vfr-mp4');
    assert.equal(item.video.vfr, true);
    assert.deepEqual(item.video.fps, { num: 30, den: 1 });
    assert.deepEqual(item.video.avgFps, { num: 900, den: 59 });
    assert.equal(item.video.fpsLabel, '~15.25');
    assert.ok(item.badges.includes('VFR ~15.25'));
    assert.ok(item.warnings.includes('vfr'));
  });

  test('29.97 written as a decimal is not VFR against 30000/1001', () => {
    const item = withVideo('h264-1080p5994', { r_frame_rate: '30000/1001', avg_frame_rate: '2997/100' });
    assert.equal(item.video.vfr, false);
    assert.deepEqual(item.video.fps, { num: 30000, den: 1001 });
  });

  test('an average of 0/0 falls back to the real rate', () => {
    const item = withVideo('h264-1080p5994', { avg_frame_rate: '0/0' });
    assert.equal(item.video.vfr, false);
    assert.deepEqual(item.video.fps, { num: 60000, den: 1001 });
  });

  test('a phone clip at 30 with a 29.87 average is VFR', () => {
    const item = withVideo('h264-1080p5994', { r_frame_rate: '30/1', avg_frame_rate: '2987/100' });
    assert.equal(item.video.vfr, true);
  });

  test('a field rate twice the average is the interlaced quirk, not VFR', () => {
    const item = withVideo('h264-1080p5994', { r_frame_rate: '50/1', avg_frame_rate: '25/1', field_order: 'tt' });
    assert.equal(item.video.vfr, false);
    assert.deepEqual(item.video.fps, { num: 25, den: 1 });
    assert.equal(item.video.resolutionLabel, '1080i');
  });

  test('soft telecine MPEG-2 reads as progressive 23.976', () => {
    const item = withVideo('dvd-mpeg2', { r_frame_rate: '30000/1001', avg_frame_rate: '24000/1001', field_order: 'tt' });
    assert.equal(item.video.vfr, false);
    assert.equal(item.video.softTelecine, true);
    assert.equal(item.video.fieldOrder, 'progressive');
    assert.equal(item.video.fpsLabel, '23.976');
  });

  test('a timebase-like real rate uses the average and flags VFR', () => {
    const item = withVideo('hevc10-mkv', { r_frame_rate: '1000/1', avg_frame_rate: '24/1' });
    assert.equal(item.video.vfr, true);
    assert.deepEqual(item.video.fps, { num: 24, den: 1 });
  });
});

describe('SAR and aspect handling', () => {
  test('a missing SAR is treated as square', () => {
    const item = withVideo('xvid-avi', { sample_aspect_ratio: undefined, display_aspect_ratio: undefined });
    assert.deepEqual(item.video.sar, { num: 1, den: 1 });
    assert.deepEqual(item.video.dar, { num: 4, den: 3 });
  });

  test('a 0:1 SAR is treated as square', () => {
    const item = withVideo('xvid-avi', { sample_aspect_ratio: '0:1', display_aspect_ratio: '0:1' });
    assert.deepEqual(item.video.sar, { num: 1, den: 1 });
    assert.equal(item.warnings.includes('anamorphic'), false);
  });

  test('ITU 10:11 NTSC is still labelled 4:3', () => {
    const item = withVideo('ntsc-dv', { sample_aspect_ratio: '10:11', display_aspect_ratio: '15:11' });
    assert.equal(item.video.aspectLabel, '4:3');
  });

  test('32:27 NTSC widescreen is 16:9', () => {
    const item = withVideo('ntsc-dv', { sample_aspect_ratio: '32:27', display_aspect_ratio: '16:9' });
    assert.equal(item.video.aspectLabel, '16:9');
    assert.equal(item.video.displayWidth, 853);
  });

  test('aspectLabel covers cinema ratios and falls back to a decimal', () => {
    assert.equal(media.aspectLabel(1920, 800), '2.39:1');
    assert.equal(media.aspectLabel(1920, 1038), '1.85:1');
    assert.equal(media.aspectLabel(1000, 700), '1.43:1');
    assert.equal(media.aspectLabel(1080, 1920), '9:16');
  });
});

describe('duration reliability', () => {
  test('a truncated AVI whose index disagrees with its length is estimated', () => {
    const item = load('truncated-avi');
    assert.equal(item.durationReliable, false);
    assert.ok(item.warnings.includes('duration-estimated'));
  });

  test('a truncated MPEG whose streams disagree is estimated', () => {
    assert.equal(load('truncated-mpeg').durationReliable, false);
  });

  test('a clean MPEG program stream is reliable', () => {
    assert.equal(load('dvd-mpeg2').durationReliable, true);
  });

  test('indexed containers are trusted', () => {
    assert.equal(load('vfr-mp4').durationReliable, true);
    assert.equal(load('multi-track-mkv').durationReliable, true);
  });

  test('a missing duration is not reliable', () => {
    const data = raw('xvid-avi');
    delete data.format.duration;
    for (const stream of data.streams) delete stream.duration;
    const item = media.parseProbe(data, { path: 'C:\\x\\a.avi' });
    assert.equal(item.duration, null);
    assert.equal(item.durationReliable, false);
  });

  test('raw elementary streams are always estimated', () => {
    const data = raw('h264-1080p5994');
    data.format.format_name = 'h264';
    assert.equal(media.parseProbe(data, { path: 'C:\\x\\a.264' }).durationReliable, false);
  });

  test('an iTunes style .m4v file is a trusted MP4, a raw MPEG-4 stream is not', () => {
    const itunes = media.parseProbe(raw('h264-1080p5994'), { path: 'C:\\x\\episode.m4v' });
    assert.equal(itunes.container, 'm4v');
    assert.equal(itunes.containerLabel, 'M4V');
    assert.equal(itunes.durationReliable, true);
    assert.equal(itunes.warnings.includes('duration-estimated'), false);
    const data = raw('xvid-avi');
    data.format.format_name = 'm4v';
    const stream = media.parseProbe(data, { path: 'C:\\x\\clip.m4v' });
    assert.equal(stream.container, 'm4ves');
    assert.equal(stream.durationReliable, false);
  });
});

describe('rational helpers', () => {
  test('parseRational accepts fractions, decimals and rejects zero', () => {
    assert.deepEqual(media.parseRational('30000/1001'), { num: 30000, den: 1001 });
    assert.deepEqual(media.parseRational('29.97'), { num: 30000, den: 1001 });
    assert.deepEqual(media.parseRational('25'), { num: 25, den: 1 });
    assert.equal(media.parseRational('0/0'), null);
    assert.equal(media.parseRational('abc'), null);
  });

  test('rateLabel prints NTSC rates the usual way', () => {
    assert.equal(media.rateLabel({ num: 24000, den: 1001 }), '23.976');
    assert.equal(media.rateLabel({ num: 60000, den: 1001 }), '59.94');
    assert.equal(media.rateLabel({ num: 25, den: 1 }), '25');
  });

  test('nearestStandardRate picks the closest broadcast rate', () => {
    assert.deepEqual(media.nearestStandardRate({ num: 2987, den: 100 }), { num: 30000, den: 1001 });
    assert.deepEqual(media.nearestStandardRate({ num: 49, den: 1 }), { num: 50, den: 1 });
  });

  test('resolutionLabel uses the short side and falls back to WxH', () => {
    assert.equal(media.resolutionLabel(1080, 1920, 'progressive'), '1080p');
    assert.equal(media.resolutionLabel(1920, 800, 'progressive'), '1080p');
    assert.equal(media.resolutionLabel(640, 352, 'progressive'), '640x352');
    assert.equal(media.resolutionLabel(720, 576, 'tff'), '576i');
  });
});
