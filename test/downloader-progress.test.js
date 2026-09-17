const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createDownloadParser,
  progressArgs,
  stageForPostprocessor,
  MARKERS,
  STAGES,
  DOWNLOAD_TEMPLATE,
  POSTPROCESS_TEMPLATE,
  PARTS_TEMPLATE,
  FILE_TEMPLATE
} = require('../src/main/downloader/progress');

const FIXTURES = path.join(__dirname, 'fixtures', 'downloader');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/).filter(Boolean);
}

function replay(name, options) {
  const parser = createDownloadParser(options);
  const events = [];
  for (const line of fixture(name)) {
    const event = parser.push(line);
    if (event) events.push(event);
  }
  return { parser, events };
}

function percents(events) {
  return events.filter((event) => typeof event.percent === 'number').map((event) => event.percent);
}

function assertMonotonic(events) {
  const values = percents(events);
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] >= values[i - 1], `percent went back at ${i}: ${values}`);
}

function stages(events) {
  const result = [];
  for (const event of events) if (event.stage && result[result.length - 1] !== event.stage) result.push(event.stage);
  return result;
}

describe('templates and arguments', () => {
  test('every template renders to valid JSON when fields are replaced', () => {
    for (const [template, marker] of [
      [DOWNLOAD_TEMPLATE, MARKERS.download],
      [POSTPROCESS_TEMPLATE, MARKERS.postprocess],
      [PARTS_TEMPLATE, MARKERS.parts]
    ]) {
      const body = template.slice(template.indexOf(marker) + marker.length).replace(/%\([^)]*\)j/g, 'null');
      assert.equal(typeof JSON.parse(body), 'object', template);
    }
  });

  test('templates target the right yt-dlp stages', () => {
    assert.ok(DOWNLOAD_TEMPLATE.startsWith(`download:${MARKERS.download}{`));
    assert.ok(POSTPROCESS_TEMPLATE.startsWith(`postprocess:${MARKERS.postprocess}{`));
    assert.ok(PARTS_TEMPLATE.startsWith(`video:${MARKERS.parts}{`));
    assert.equal(FILE_TEMPLATE, `after_move:${MARKERS.file}%(filepath)j`);
  });

  test('templates use JSON conversion with null defaults so any title is safe', () => {
    const fields = DOWNLOAD_TEMPLATE.match(/%\([^)]*\)j/g);
    assert.ok(fields.length >= 10);
    for (const field of fields) assert.match(field, /\|null\)j$/);
  });

  test('progressArgs keeps progress visible while printing and passes ffmpeg progress through', () => {
    const args = progressArgs();
    assert.deepEqual(args.slice(0, 4), ['--newline', '--progress', '--progress-delta', '0.5']);
    assert.deepEqual(args.filter((arg, i) => args[i - 1] === '--progress-template'), [DOWNLOAD_TEMPLATE, POSTPROCESS_TEMPLATE]);
    assert.deepEqual(args.filter((arg, i) => args[i - 1] === '--print'), [PARTS_TEMPLATE, FILE_TEMPLATE]);
    assert.ok(args.includes('--no-simulate'));
    assert.equal(args[args.indexOf('--downloader-args') + 1], 'ffmpeg:-progress pipe:1 -nostats');
  });

  test('progressArgs returns a fresh array', () => {
    const first = progressArgs();
    first.push('mutated');
    assert.ok(!progressArgs().includes('mutated'));
  });

  test('stage list contains every stage the parser can emit', () => {
    for (const name of ['Merger', 'VideoRemuxer', 'ExtractAudio', 'EmbedThumbnail', 'FixupM4a', 'ModifyChapters', 'MoveFiles', 'Unknown']) {
      assert.ok(STAGES.includes(stageForPostprocessor(name)), name);
    }
    assert.ok(STAGES.includes('starting'));
    assert.ok(STAGES.includes('downloading'));
    assert.ok(STAGES.includes('finished'));
    assert.equal(Object.isFrozen(STAGES), true);
  });
});

describe('real download: video and audio parts', () => {
  const { parser, events } = replay('progress-two-parts.txt', { duration: 110 });

  test('learns that two parts will be downloaded', () => {
    assert.deepEqual(events[0], { type: 'stage', stage: 'starting', parts: 2 });
  });

  test('overall percent never goes back', () => {
    assertMonotonic(events);
  });

  test('parts are weighted by their size', () => {
    const video = 4703382;
    const audio = 1776735;
    const firstFinished = events.find((event) => event.type === 'progress' && event.part.index === 1 && event.eta === 0);
    assert.equal(firstFinished.percent, Math.round(((99 * video) / (video + audio)) * 10) / 10);
    assert.equal(firstFinished.downloaded, video);
    assert.equal(firstFinished.total, video + audio);
  });

  test('reports the part being downloaded', () => {
    const progress = events.filter((event) => event.type === 'progress');
    assert.equal(progress[0].part.index, 1);
    assert.equal(progress[progress.length - 1].part.index, 2);
    assert.ok(progress.every((event) => event.part.count === 2));
  });

  test('downloaded bytes are cumulative across parts', () => {
    const last = events.filter((event) => event.type === 'progress').pop();
    assert.equal(last.downloaded, 4703382 + 1776735);
    assert.equal(last.total, 4703382 + 1776735);
    assert.equal(last.percent, 99);
  });

  test('speed is in bytes per second', () => {
    const withSpeed = events.find((event) => event.type === 'progress' && event.speed);
    assert.ok(withSpeed.speed > 1000);
  });

  test('walks through the post-processing stages in order', () => {
    assert.deepEqual(stages(events), ['starting', 'downloading', 'merging', 'remuxing', 'embedding', 'moving', 'finished']);
  });

  test('ends with the real final path, including non-ASCII characters', () => {
    const last = events[events.length - 1];
    assert.deepEqual(last, {
      type: 'filepath',
      path: 'C:\\Users\\User\\Videos\\Vidaro\\E2E： Reel ñ 🎬 100% [two parts].mp4',
      stage: 'finished',
      percent: 100
    });
    assert.equal(parser.stage, 'finished');
    assert.equal(parser.percent, 100);
    assert.equal(parser.parts, 2);
  });
});

describe('real download: time range through the ffmpeg downloader', () => {
  test('uses ffmpeg progress blocks with the section length', () => {
    const { events } = replay('progress-section-ffmpeg.txt', { duration: 5, singlePart: true });
    assertMonotonic(events);
    const ffmpeg = events.filter((event) => event.type === 'progress' && event.time !== undefined);
    assert.ok(ffmpeg.length >= 4);
    assert.equal(ffmpeg[0].percent, Math.round(((99 * 0.13932) / 5) * 10) / 10);
    assert.equal(ffmpeg[ffmpeg.length - 1].percent, 99);
    assert.ok(ffmpeg.some((event) => event.realtime > 0));
    assert.ok(ffmpeg.some((event) => event.downloaded > 0));
    assert.ok(ffmpeg.every((event) => event.part.count === 1 && event.speed === null && event.total === null));
  });

  test('treats a combined format id as a single part', () => {
    const { events, parser } = replay('progress-section-ffmpeg.txt', { duration: 5 });
    const finished = events.find((event) => event.type === 'progress' && event.time === undefined);
    assert.deepEqual(finished.part, { index: 1, count: 1 });
    assert.equal(finished.downloaded, finished.total);
    assert.equal(parser.parts, 1);
  });

  test('a single part hint reports one part from the start', () => {
    const { events } = replay('progress-section-ffmpeg.txt', { duration: 5, singlePart: true });
    assert.deepEqual(events[0], { type: 'stage', stage: 'starting', parts: 1 });
    const plain = replay('progress-section-ffmpeg.txt', { duration: 5 });
    assert.deepEqual(plain.events[0], { type: 'stage', stage: 'starting', parts: 2 });
  });

  test('reports an ETA from the realtime speed', () => {
    const { events } = replay('progress-section-ffmpeg.txt', { duration: 5 });
    const block = events.find((event) => event.time > 1 && event.realtime);
    assert.equal(block.eta, Math.max(0, Math.round((5 - block.time) / block.realtime)));
  });

  test('without a known duration the percent stays unknown until the end', () => {
    const { events } = replay('progress-section-ffmpeg.txt', { singlePart: true });
    const ffmpeg = events.filter((event) => event.time !== undefined);
    assert.ok(ffmpeg.slice(0, -1).every((event) => event.percent === null));
    assert.equal(ffmpeg[ffmpeg.length - 1].percent, 99);
  });

  test('a range is detected from the parts line, with its length, without any hint', () => {
    const { events, parser } = replay('progress-section-detected.txt');
    assert.deepEqual(events[0], { type: 'stage', stage: 'starting', parts: 1 });
    assert.equal(parser.duration, 2);
    const ffmpeg = events.filter((event) => event.type === 'progress' && event.time !== undefined);
    assert.equal(ffmpeg[0].percent, Math.round(((99 * 0.13932) / 2) * 10) / 10);
    assert.equal(ffmpeg[1].percent, Math.round(((99 * 0.348299) / 2) * 10) / 10);
    assert.equal(ffmpeg[2].percent, 99);
    assert.ok(ffmpeg.every((event) => event.part.count === 1));
    assertMonotonic(events);
    assert.deepEqual(stages(events), ['starting', 'downloading', 'remuxing', 'moving', 'finished']);
    assert.ok(events[events.length - 1].path.endsWith('\\E2E BBB range.mp4'));
  });

  test('a runner duration wins over the one in the parts line', () => {
    const { parser, events } = replay('progress-section-detected.txt', { duration: 4 });
    assert.equal(parser.duration, 4);
    const first = events.find((event) => event.time !== undefined);
    assert.equal(first.percent, Math.round(((99 * 0.13932) / 4) * 10) / 10);
  });

  test('a range starting at zero or running to the end is still a range', () => {
    const fromZero = createDownloadParser();
    const event = fromZero.push('VIDARO-PARTS {"format":"134+140","protocol":"https+https","ext":"mp4","duration":635,"sectionStart":0,"sectionEnd":2,"parts":[{"format_id":"134","vcodec":"avc1","acodec":"none","filesize":100},{"format_id":"140","vcodec":"none","acodec":"mp4a","filesize":50}]}');
    assert.equal(event.parts, 1);
    assert.equal(fromZero.duration, 2);
    const toEnd = createDownloadParser();
    toEnd.push('VIDARO-PARTS {"format":"18","protocol":"https","duration":635,"sectionStart":632,"sectionEnd":null,"parts":[]}');
    assert.equal(toEnd.duration, 3);
    const broken = createDownloadParser();
    broken.push('VIDARO-PARTS {"format":"18","duration":"635","sectionStart":700,"sectionEnd":10,"parts":[]}');
    assert.equal(broken.duration, null);
  });

  test('the media duration from the parts line is used for whole downloads', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-PARTS {"format":"140","protocol":"https","ext":"m4a","duration":49,"sectionStart":null,"sectionEnd":null,"parts":[]}');
    assert.equal(parser.duration, 49);
    assert.equal(createDownloadParser().duration, null);
  });

  test('a long webm section with N/A times stays monotonic and reports frames', () => {
    const { events } = replay('progress-webm-section.txt', { duration: 3 });
    assertMonotonic(events);
    assert.ok(events.some((event) => event.time === null && event.frames > 0));
    assert.deepEqual(stages(events), ['starting', 'downloading', 'remuxing', 'embedding', 'moving', 'finished']);
    assert.ok(events[events.length - 1].path.endsWith('E2E BBB webm.webm'));
  });

  test('video only into MKV', () => {
    const { events } = replay('progress-video-only-mkv.txt', { duration: 2 });
    assertMonotonic(events);
    assert.ok(events[events.length - 1].path.endsWith('E2E BBB video only.mkv'));
  });

  test('a non-YouTube source (archive.org) with a single format', () => {
    const { events, parser } = replay('progress-archive-section.txt', { duration: 3 });
    assert.deepEqual(events[0], { type: 'stage', stage: 'starting', parts: 1 });
    assertMonotonic(events);
    assert.equal(parser.percent, 100);
    assert.ok(events[events.length - 1].path.endsWith('E2E archive section.mp4'));
  });
});

describe('real download: audio and fragments', () => {
  test('audio extraction stages', () => {
    const { events } = replay('progress-audio-m4a.txt', { duration: 110 });
    assertMonotonic(events);
    assert.deepEqual(stages(events), ['starting', 'downloading', 'fixing', 'converting-audio', 'embedding', 'moving', 'finished']);
    assert.ok(events[events.length - 1].path.endsWith('E2E reel audio.m4a'));
  });

  test('HLS fragments use the fragment count, not the early byte estimate', () => {
    const { events } = replay('progress-hls-fragments.txt', { duration: 110 });
    const progress = events.filter((event) => event.type === 'progress');
    assert.equal(progress[0].percent, 0);
    assert.deepEqual(progress[0].fragment, { index: 0, count: 22 });
    assert.equal(progress[2].percent, Math.round(((99 * 7) / 22) * 10) / 10);
    assert.equal(progress[2].total, 661573);
    assert.equal(progress[progress.length - 1].percent, 99);
    assert.equal(progress[progress.length - 1].fragment, null);
    assertMonotonic(events);
    assert.deepEqual(stages(events), ['starting', 'downloading', 'fixing', 'converting-audio', 'moving', 'finished']);
  });

  test('an estimate without fragments never reaches the end early', () => {
    const parser = createDownloadParser();
    const event = parser.push('VIDARO-DL {"status":"downloading","downloaded":1024,"total":null,"estimate":1024,"speed":10,"eta":null,"frag":null,"frags":null,"format":"x","file":"a"}');
    assert.equal(event.percent, 94.1);
  });
});

describe('real download: subtitles, SponsorBlock and every embed option', () => {
  const { parser, events } = replay('progress-subtitles-sponsorblock.txt', { duration: 110 });

  test('the subtitle file download does not move the video progress', () => {
    const progress = events.filter((event) => event.type === 'progress');
    assert.equal(progress[0].percent, 0);
    assert.equal(progress[0].part.index, 1);
    assert.equal(progress.length, 5);
    assertMonotonic(events);
  });

  test('the SponsorBlock lookup before the download is not a stage', () => {
    assert.deepEqual(events[0], { type: 'stage', stage: 'starting', parts: 2 });
  });

  test('segment removal after the download is reported as cutting', () => {
    assert.deepEqual(stages(events), ['starting', 'downloading', 'merging', 'remuxing', 'embedding', 'cutting', 'embedding', 'moving', 'finished']);
  });

  test('finishes with the final path', () => {
    assert.equal(events[events.length - 1].path, 'C:\\Users\\User\\Videos\\Vidaro\\2026-07-14 - Blender 5.2 LTS - Showcase Reel.mp4');
    assert.equal(parser.percent, 100);
  });

  test('a progress line without a format is still used when no format is known', () => {
    const plain = createDownloadParser();
    const event = plain.push('VIDARO-DL {"status":"downloading","downloaded":50,"total":100,"format":null,"file":"x"}');
    assert.equal(event.percent, 49.5);
  });
});

describe('real download: resume, existing file and failure', () => {
  test('a resumed download starts from the bytes already on disk', () => {
    const { events } = replay('progress-resumed.txt', { duration: 110 });
    const progress = events.filter((event) => event.type === 'progress');
    assert.ok(progress[0].percent > 20, `first percent ${progress[0].percent}`);
    assert.equal(progress[0].downloaded, 929654);
    assertMonotonic(events);
    assert.ok(events[events.length - 1].path.endsWith('Resume test.mp4'));
  });

  test('an already downloaded file still finishes with its path', () => {
    const { events, parser } = replay('progress-already-downloaded.txt');
    assert.equal(events.filter((event) => event.type === 'progress').length, 0);
    assert.deepEqual(stages(events), ['starting', 'remuxing', 'embedding', 'moving', 'finished']);
    assert.equal(parser.percent, 100);
  });

  test('a failed move reports the error and never a path', () => {
    const { events, parser } = replay('progress-access-denied.txt', { duration: 2 });
    assert.equal(events.some((event) => event.type === 'filepath'), false);
    const error = events.find((event) => event.type === 'error');
    assert.match(error.text, /^\[Errno 13\] Permission denied/);
    assert.equal(parser.stage, 'moving');
    assert.equal(parser.percent, 99);
  });
});

describe('parser robustness', () => {
  test('ignores garbage without throwing', () => {
    const parser = createDownloadParser({ duration: 10 });
    const garbage = [
      '',
      '   ',
      'random text',
      '[download] 50% of 10MiB',
      'VIDARO-DL',
      'VIDARO-DL ',
      'VIDARO-DL {broken json',
      'VIDARO-DL null',
      'VIDARO-DL []',
      'VIDARO-DL "text"',
      'VIDARO-DL {"status":"error"}',
      'VIDARO-PP {"status":"finished","pp":"Merger"}',
      'VIDARO-PP not json',
      'VIDARO-PARTS {nope',
      'VIDARO-PARTS 42',
      'VIDARO-FILE 42',
      'VIDARO-FILE ""',
      'VIDARO-FILE {"path":"x"}',
      'foo=bar',
      '=value',
      '__proto__=1',
      'constructor=1',
      'VIDARO-DLX {}',
      '\u0000\u0001',
      'x'.repeat(100000)
    ];
    for (const line of garbage) assert.doesNotThrow(() => parser.push(line), line.slice(0, 40));
    for (const value of [null, undefined, 42, {}, [], Buffer.from('VIDARO-FILE "x"')]) assert.equal(parser.push(value), null);
    assert.equal(parser.percent, null);
    assert.equal(parser.stage, 'starting');
  });

  test('a downloading line with bad numbers keeps the percent unknown', () => {
    const parser = createDownloadParser();
    assert.equal(parser.push('VIDARO-DL {"status":"downloading","downloaded":"12","total":"x"}').percent, null);
    const event = parser.push('VIDARO-DL {"status":"downloading","downloaded":-5,"total":0,"estimate":null,"speed":-1,"eta":"soon","frag":null,"frags":0,"format":null,"file":null}');
    assert.equal(event.percent, null);
    assert.equal(event.downloaded, null);
    assert.equal(event.speed, null);
    assert.equal(event.eta, null);
    assert.equal(event.fragment, null);
  });

  test('error and warning lines become events', () => {
    const parser = createDownloadParser();
    assert.deepEqual(parser.push('ERROR: [youtube] abc: Video unavailable'), { type: 'error', text: '[youtube] abc: Video unavailable' });
    assert.deepEqual(parser.push('WARNING: [youtube] Falling back'), { type: 'warning', text: '[youtube] Falling back' });
    assert.equal(parser.push('  ERROR: indented is still an error').type, 'error');
  });

  test('post-processing stage changes are reported once', () => {
    const parser = createDownloadParser();
    assert.deepEqual(parser.push('VIDARO-PP {"status":"started","pp":"Metadata"}'), { type: 'stage', stage: 'embedding' });
    assert.equal(parser.push('VIDARO-PP {"status":"started","pp":"EmbedThumbnail"}'), null);
    assert.equal(parser.push('VIDARO-PP {"status":"started","pp":"ThumbnailsConvertor"}'), null);
    assert.deepEqual(parser.push('VIDARO-PP {"status":"started","pp":"SomethingNew"}'), { type: 'stage', stage: 'processing' });
    assert.deepEqual(parser.push('VIDARO-PP {"status":"started","pp":null}'), null);
    assert.equal(parser.push('VIDARO-PP {"status":"started","pp":"SponsorBlock"}'), null);
    assert.deepEqual(parser.push('VIDARO-PP {"status":"started","pp":"ModifyChapters"}'), { type: 'stage', stage: 'cutting' });
  });

  test('stageForPostprocessor maps known names and ignores prototype keys', () => {
    assert.equal(stageForPostprocessor('Merger'), 'merging');
    assert.equal(stageForPostprocessor('FixupM3u8'), 'fixing');
    assert.equal(stageForPostprocessor('ExtractAudio'), 'converting-audio');
    assert.equal(stageForPostprocessor('ThumbnailsConvertor'), null);
    assert.equal(stageForPostprocessor('constructor'), 'processing');
    assert.equal(stageForPostprocessor(''), 'processing');
    assert.equal(stageForPostprocessor(undefined), 'processing');
  });

  test('without format ids a new file after a finished part moves to the next part', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-PARTS {"format":null,"protocol":"https+https","ext":"mp4","parts":[{"format_id":"a","vcodec":"avc1","acodec":"none","filesize":null,"filesize_approx":null},{"format_id":"b","vcodec":"none","acodec":"mp4a","filesize":null,"filesize_approx":null}]}');
    const first = parser.push('VIDARO-DL {"status":"downloading","downloaded":50,"total":100,"format":null,"file":"one"}');
    assert.equal(first.percent, Math.round(0.85 * 0.5 * 99 * 10) / 10);
    const same = parser.push('VIDARO-DL {"status":"finished","downloaded":100,"total":100,"format":null,"file":"one"}');
    assert.equal(same.part.index, 1);
    const second = parser.push('VIDARO-DL {"status":"downloading","downloaded":10,"total":100,"format":null,"file":"two"}');
    assert.equal(second.part.index, 2);
    assert.equal(second.percent, Math.round((0.85 + 0.15 * 0.1) * 99 * 10) / 10);
    const again = parser.push('VIDARO-DL {"status":"downloading","downloaded":20,"total":100,"format":null,"file":"two"}');
    assert.equal(again.part.index, 2);
    assert.equal(second.total, 200);
    assert.equal(second.downloaded, 110);
  });

  test('unknown part sizes fall back to fixed weights', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-PARTS {"format":"v+a","parts":[{"format_id":"v","vcodec":"vp9","acodec":"none","filesize":1000},{"format_id":"a","vcodec":"none","acodec":"opus"}]}');
    const event = parser.push('VIDARO-DL {"status":"finished","downloaded":1000,"total":1000,"format":"v","file":"v.part"}');
    assert.equal(event.percent, Math.round(0.85 * 99 * 10) / 10);
  });

  test('parts with missing ids are ignored', () => {
    const parser = createDownloadParser();
    assert.deepEqual(parser.push('VIDARO-PARTS {"format":"x","parts":[null,{"vcodec":"none"},{"format_id":""}]}'), { type: 'stage', stage: 'starting', parts: 1 });
  });

  test('a lone ffmpeg end marker completes the download phase', () => {
    const parser = createDownloadParser();
    const event = parser.push('progress=end');
    assert.equal(event.percent, 99);
    assert.equal(event.time, null);
  });

  test('ffmpeg values are parsed from their own block only', () => {
    const parser = createDownloadParser({ duration: 10 });
    parser.push('out_time_us=5000000');
    parser.push('speed=2.5x');
    const first = parser.push('progress=continue');
    assert.equal(first.percent, 49.5);
    assert.equal(first.eta, 2);
    const second = parser.push('progress=continue');
    assert.equal(second.time, null);
    assert.equal(second.percent, 49.5);
    assert.equal(second.realtime, null);
  });

  test('invalid durations are ignored', () => {
    for (const duration of [0, -5, Number.NaN, Infinity, '10', null]) {
      const parser = createDownloadParser({ duration });
      parser.push('out_time_us=1000000');
      assert.equal(parser.push('progress=continue').percent, null, String(duration));
    }
  });

  test('the file path event needs a JSON string', () => {
    const parser = createDownloadParser();
    assert.deepEqual(parser.push('VIDARO-FILE "C:\\\\V\\\\a \\ud83c\\udfac.mp4"'), {
      type: 'filepath',
      path: 'C:\\V\\a 🎬.mp4',
      stage: 'finished',
      percent: 100
    });
  });

  test('each parser keeps its own state', () => {
    const a = createDownloadParser();
    const b = createDownloadParser();
    a.push('VIDARO-FILE "x"');
    assert.equal(a.percent, 100);
    assert.equal(b.percent, null);
  });

  test('a post-processing line read before the last download line keeps its stage', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-PARTS {"format":"v+a","protocol":"https+https","parts":[{"format_id":"v","vcodec":"avc1","acodec":"none","filesize":300},{"format_id":"a","vcodec":"none","acodec":"mp4a","filesize":100}]}');
    parser.push('VIDARO-DL {"status":"finished","downloaded":300,"total":300,"format":"v","file":"x.fv.mp4"}');
    parser.push('VIDARO-DL {"status":"downloading","downloaded":50,"total":100,"format":"a","file":"x.fa.m4a"}');
    assert.deepEqual(parser.push('VIDARO-PP {"status":"started","pp":"Merger"}'), { type: 'stage', stage: 'merging' });
    const late = parser.push('VIDARO-DL {"status":"finished","downloaded":100,"total":100,"format":"a","file":"x.fa.m4a"}');
    assert.equal(late.stage, 'merging');
    assert.equal(late.percent, 99);
    assert.equal(parser.stage, 'merging');
  });

  test('a post-processing line read after the final path does not reopen the job', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-PARTS {"format":"18","protocol":"https","parts":[]}');
    parser.push('VIDARO-DL {"status":"finished","downloaded":10,"total":10,"format":"18","file":"a"}');
    assert.equal(parser.push('VIDARO-FILE "C:\\\\V\\\\a.mp4"').type, 'filepath');
    assert.equal(parser.push('VIDARO-PP {"status":"started","pp":"MoveFiles"}'), null);
    assert.equal(parser.push('VIDARO-DL {"status":"downloading","downloaded":5,"total":10,"format":"18","file":"a"}'), null);
    assert.equal(parser.push('progress=end'), null);
    assert.equal(parser.stage, 'finished');
    assert.equal(parser.percent, 100);
    assert.equal(parser.push('ERROR: late failure').type, 'error');
  });

  test('a new item after a finished one starts again without lowering the percent', () => {
    const parser = createDownloadParser();
    parser.push('VIDARO-FILE "C:\\\\V\\\\a.mp4"');
    assert.deepEqual(parser.push('VIDARO-PARTS {"format":"18","protocol":"https","parts":[]}'), { type: 'stage', stage: 'starting', parts: 1 });
    const event = parser.push('VIDARO-DL {"status":"downloading","downloaded":5,"total":10,"format":"18","file":"b"}');
    assert.equal(event.stage, 'downloading');
    assert.equal(event.percent, 100);
  });

  test('ffmpeg downloading one part of several advances by that part only', () => {
    const parser = createDownloadParser({ duration: 10 });
    parser.push('VIDARO-PARTS {"format":"hls-1+aud","protocol":"m3u8+https","parts":[{"format_id":"hls-1","vcodec":"avc1","acodec":"none","filesize":null},{"format_id":"aud","vcodec":"none","acodec":"mp4a","filesize":null}]}');
    parser.push('out_time_us=5000000');
    const half = parser.push('progress=continue');
    assert.equal(half.percent, Math.round(0.85 * 0.5 * 99 * 10) / 10);
    assert.deepEqual(half.part, { index: 1, count: 2 });
    assert.equal(parser.push('progress=end').percent, Math.round(0.85 * 99 * 10) / 10);
    const done = parser.push('VIDARO-DL {"status":"finished","downloaded":700,"total":700,"format":"hls-1","file":"x.fhls-1.mp4"}');
    assert.equal(done.percent, Math.round(0.85 * 99 * 10) / 10);
    const audio = parser.push('VIDARO-DL {"status":"downloading","downloaded":50,"total":100,"format":"aud","file":"x.faud.m4a"}');
    assert.equal(audio.percent, Math.round((0.85 + 0.15 * 0.5) * 99 * 10) / 10);
  });

  test('ffmpeg progress after a finished part belongs to the next part', () => {
    const parser = createDownloadParser({ duration: 10 });
    parser.push('VIDARO-PARTS {"format":"v+hls-a","protocol":"https+m3u8","parts":[{"format_id":"v","vcodec":"avc1","acodec":"none","filesize":800},{"format_id":"hls-a","vcodec":"none","acodec":"mp4a","filesize":200}]}');
    parser.push('VIDARO-DL {"status":"finished","downloaded":800,"total":800,"format":"v","file":"x.fv.mp4"}');
    parser.push('out_time_us=5000000');
    parser.push('total_size=100');
    const event = parser.push('progress=continue');
    assert.deepEqual(event.part, { index: 2, count: 2 });
    assert.equal(event.percent, Math.round((0.8 + 0.2 * 0.5) * 99 * 10) / 10);
    assert.equal(event.downloaded, 900);
    assert.equal(event.total, 1000);
  });

  test('two HLS streams merged by ffmpeg in one pass are one part', () => {
    const parser = createDownloadParser({ duration: 10 });
    const start = parser.push('VIDARO-PARTS {"format":"hls-v+hls-a","protocol":"m3u8+m3u8","parts":[{"format_id":"hls-v","vcodec":"avc1","acodec":"none"},{"format_id":"hls-a","vcodec":"none","acodec":"mp4a"}]}');
    assert.equal(start.parts, 1);
    parser.push('out_time_us=5000000');
    assert.equal(parser.push('progress=continue').percent, 49.5);
    const native = createDownloadParser();
    assert.equal(native.push('VIDARO-PARTS {"format":"v+a","protocol":"m3u8_native+m3u8_native","parts":[{"format_id":"v"},{"format_id":"a"}]}').parts, 2);
  });

  test('handles a long stream of progress lines quickly', () => {
    const parser = createDownloadParser();
    const started = process.hrtime.bigint();
    for (let i = 0; i <= 50000; i += 1) {
      parser.push(`VIDARO-DL {"status":"downloading","downloaded":${i * 100},"total":5000000,"estimate":null,"speed":1000,"eta":5,"frag":null,"frags":null,"format":"18","file":"C:\\\\x.mp4"}`);
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(parser.percent, 99);
    assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  });
});
