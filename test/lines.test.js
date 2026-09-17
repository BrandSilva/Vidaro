const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createLineReader, createTail } = require('../src/main/lines');

const MAX_PENDING = 1024 * 1024;

function collect() {
  const lines = [];
  const reader = createLineReader((line) => lines.push(line));
  return { lines, reader };
}

function feed(chunks) {
  const { lines, reader } = collect();
  for (const chunk of chunks) reader.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  reader.end();
  return lines;
}

function byteChunks(text, size) {
  const bytes = Buffer.from(text);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}

describe('createLineReader', () => {
  test('splits on LF', () => {
    assert.deepEqual(feed(['first\nsecond\n']), ['first', 'second']);
  });

  test('splits on CRLF without empty lines', () => {
    assert.deepEqual(feed(['first\r\nsecond\r\n']), ['first', 'second']);
  });

  test('splits carriage-return progress updates into separate lines', () => {
    assert.deepEqual(feed(['[download]  1.0%\r[download]  2.5%\r[download] 100%\n']), [
      '[download]  1.0%',
      '[download]  2.5%',
      '[download] 100%'
    ]);
  });

  test('skips blank lines', () => {
    assert.deepEqual(feed(['\n\n\r\n\r\r', 'a\n\n\nb\n']), ['a', 'b']);
  });

  test('keeps whitespace inside lines', () => {
    assert.deepEqual(feed(['  indented\t \n']), ['  indented\t ']);
  });

  test('joins a line split across chunks', () => {
    assert.deepEqual(feed(['out_time', '_us=1000', '\nspeed=', '1.5x\n']), ['out_time_us=1000', 'speed=1.5x']);
  });

  test('a CRLF split between chunks gives one line', () => {
    assert.deepEqual(feed(['alpha\r', '\nbeta\r', '\n']), ['alpha', 'beta']);
  });

  test('emits complete lines as soon as they arrive', () => {
    const { lines, reader } = collect();
    reader.push(Buffer.from('one\ntw'));
    assert.deepEqual(lines, ['one']);
    reader.push(Buffer.from('o\nthr'));
    assert.deepEqual(lines, ['one', 'two']);
    reader.push(Buffer.from('ee'));
    assert.deepEqual(lines, ['one', 'two']);
    reader.end();
    assert.deepEqual(lines, ['one', 'two', 'three']);
  });

  test('decodes multibyte UTF-8 split at every byte', () => {
    const text = 'Canción Año – 日本語 🎬👍🏽 Ünïcödé\nsegunda línea 🎉\n';
    for (const size of [1, 2, 3, 5]) {
      assert.deepEqual(feed(byteChunks(text, size)), ['Canción Año – 日本語 🎬👍🏽 Ünïcödé', 'segunda línea 🎉'], `chunk size ${size}`);
    }
  });

  test('keeps a 4-byte emoji split over three chunks', () => {
    const bytes = Buffer.from('🎬\n');
    assert.equal(bytes.length, 5);
    assert.deepEqual(feed([bytes.subarray(0, 1), bytes.subarray(1, 3), bytes.subarray(3)]), ['🎬']);
  });

  test('handles yt-dlp style JSON progress lines with non-ASCII titles', () => {
    const line = 'VIDARO {"status":"downloading","filename":"C:\\\\Vídeos\\\\Título 🎵.mp4","downloaded_bytes":1024}';
    const chunks = byteChunks(`${line}\r\n`, 7);
    const [result] = feed(chunks);
    assert.equal(result, line);
    assert.equal(JSON.parse(result.slice('VIDARO '.length)).filename, 'C:\\Vídeos\\Título 🎵.mp4');
  });

  test('flushes an unterminated line on end', () => {
    assert.deepEqual(feed(['no newline at the end']), ['no newline at the end']);
    assert.deepEqual(feed(['done\n', 'tail']), ['done', 'tail']);
  });

  test('end without data emits nothing and can be called twice', () => {
    const { lines, reader } = collect();
    reader.end();
    reader.push(Buffer.from('last'));
    reader.end();
    reader.end();
    assert.deepEqual(lines, ['last']);
  });

  test('an incomplete UTF-8 sequence at the end becomes a replacement character', () => {
    const bytes = Buffer.from('ok 🎬');
    const lines = feed([bytes.subarray(0, bytes.length - 2)]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], `ok ${String.fromCharCode(0xfffd)}`);
  });

  test('invalid bytes do not break later lines', () => {
    assert.deepEqual(feed([Buffer.from([0x66, 0xff, 0x6f, 0x0a]), Buffer.from('next\n')]), [
      `f${String.fromCharCode(0xfffd)}o`,
      'next'
    ]);
  });

  test('a huge line without a newline is emitted once it passes the guard', () => {
    const { lines, reader } = collect();
    const huge = 'x'.repeat(MAX_PENDING + 10);
    reader.push(Buffer.from(huge.slice(0, MAX_PENDING)));
    assert.equal(lines.length, 0);
    reader.push(Buffer.from(huge.slice(MAX_PENDING)));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].length, huge.length);
    reader.push(Buffer.from('after\n'));
    reader.end();
    assert.deepEqual(lines.slice(1), ['after']);
  });

  test('a huge chunk with many lines keeps the complete lines intact', () => {
    const many = Array.from({ length: 20000 }, (_, index) => `frame=${index}`);
    const lines = feed(byteChunks(`${many.join('\n')}\n`, 65536));
    assert.equal(lines.length, 20000);
    assert.equal(lines[0], 'frame=0');
    assert.equal(lines[19999], 'frame=19999');
  });

  test(
    'a long unterminated line arriving in small chunks is scanned in linear time',
    () => {
      const { lines, reader } = collect();
      const chunk = Buffer.alloc(1024, 0x61);
      const started = process.hrtime.bigint();
      for (let sent = 0; sent < MAX_PENDING / 2; sent += chunk.length) reader.push(chunk);
      reader.end();
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert.equal(lines.length, 1);
      assert.ok(elapsedMs < 100, `took ${elapsedMs} ms`);
    }
  );

  test('streaming many small chunks stays fast', () => {
    const text = `${'progress line with some text\r'.repeat(20000)}\n`;
    const started = process.hrtime.bigint();
    const lines = feed(byteChunks(text, 16));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(lines.length, 20000);
    assert.ok(elapsedMs < 2000, `took ${elapsedMs} ms`);
  });
});

describe('createTail', () => {
  test('keeps the last lines up to the limit', () => {
    const tail = createTail(3);
    for (const line of ['a', 'b', 'c', 'd', 'e']) tail.add(line);
    assert.deepEqual(tail.lines(), ['c', 'd', 'e']);
    assert.equal(tail.text(), 'c\nd\ne');
  });

  test('starts empty', () => {
    const tail = createTail(5);
    assert.deepEqual(tail.lines(), []);
    assert.equal(tail.text(), '');
  });

  test('keeps fewer lines than the limit as they are', () => {
    const tail = createTail(5);
    tail.add('only');
    assert.deepEqual(tail.lines(), ['only']);
    assert.equal(tail.text(), 'only');
  });

  test('returns a copy of the lines', () => {
    const tail = createTail(2);
    tail.add('x');
    const lines = tail.lines();
    lines.push('mutated');
    assert.deepEqual(tail.lines(), ['x']);
  });

  test('a zero limit keeps nothing', () => {
    const tail = createTail(0);
    tail.add('x');
    assert.deepEqual(tail.lines(), []);
  });

  test('works as the stderr tail of a line reader', () => {
    const tail = createTail(2);
    const reader = createLineReader((line) => tail.add(line));
    reader.push(Buffer.from('WARNING: one\r\nERROR: two\r\nERROR: three'));
    reader.end();
    assert.deepEqual(tail.lines(), ['ERROR: two', 'ERROR: three']);
  });
});
