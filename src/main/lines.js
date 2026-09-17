const { StringDecoder } = require('node:string_decoder');

const MAX_PENDING = 1024 * 1024;

function createLineReader(onLine) {
  const decoder = new StringDecoder('utf8');
  let parts = [];
  let pendingLength = 0;

  function takePending(tail) {
    parts.push(tail);
    const line = parts.join('');
    parts = [];
    pendingLength = 0;
    return line;
  }

  function consume(text) {
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code !== 10 && code !== 13) continue;
      const piece = text.slice(start, i);
      const line = parts.length ? takePending(piece) : piece;
      if (line) onLine(line);
      start = i + 1;
    }
    if (start >= text.length) return;
    parts.push(text.slice(start));
    pendingLength += text.length - start;
    if (pendingLength > MAX_PENDING) onLine(takePending(''));
  }

  return {
    push(chunk) {
      consume(decoder.write(chunk));
    },
    end() {
      consume(decoder.end());
      if (parts.length === 0) return;
      const line = takePending('');
      if (line) onLine(line);
    }
  };
}

function createTail(limit) {
  const lines = [];
  return {
    add(line) {
      lines.push(line);
      if (lines.length > limit) lines.shift();
    },
    lines: () => lines.slice(),
    text: () => lines.join('\n')
  };
}

module.exports = { createLineReader, createTail, MAX_PENDING };
