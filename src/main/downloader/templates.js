const { sanitizeFileName } = require('../fsnames');

const NAME_TEMPLATES = Object.freeze({
  title: '%(title)s',
  'channel-title': '%(channel,uploader&{} - |)s%(title)s',
  'date-title': '%(upload_date>%Y-%m-%d&{} - |)s%(title)s',
  'title-id': '%(title)s [%(id)s]',
  custom: null
});

const NA = 'NA';
const MAX_TEMPLATE_LENGTH = 512;
const TOKEN = /%(?:(%)|\(([^)]*)\)([-#0+ ]*)(\d+)?(?:\.(\d+))?([a-zA-Z]))/g;
const TRAILING_EXT = /\.%\(ext\)s$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function present(value) {
  return value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && !Number.isFinite(value));
}

function durationString(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fieldsFromInfo(info) {
  const source = info && typeof info === 'object' ? info : {};
  const fields = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^[a-z_][a-z0-9_]*$/.test(key) && ['string', 'number'].includes(typeof value)) fields[key] = value;
  }
  const pick = (...values) => values.find(present) ?? null;
  const title = pick(source.title, source.fulltitle, source.id, source.display_id);
  Object.assign(fields, {
    id: pick(source.id, source.display_id),
    title,
    fulltitle: title,
    channel: pick(source.channel, source.uploader),
    uploader: pick(source.uploader, source.channel),
    upload_date: pick(source.uploadDate, source.upload_date),
    release_date: pick(source.releaseDate, source.release_date),
    timestamp: pick(source.timestamp),
    duration: pick(source.duration),
    duration_string: durationString(source.duration),
    extractor: pick(source.extractor),
    webpage_url: pick(source.webpageUrl, source.webpage_url, source.url),
    playlist_index: pick(source.playlistIndex, source.playlist_index, source.index),
    playlist_count: pick(source.playlistCount, source.playlist_count),
    playlist_title: pick(source.playlistTitle, source.playlist_title),
    playlist: pick(source.playlistTitle, source.playlist_title, source.playlist),
    height: pick(source.height),
    ext: pick(source.ext)
  });
  return fields;
}

function toDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000);
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function strftime(value, format) {
  const date = toDate(value);
  if (!date) return null;
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const parts = {
    Y: () => String(date.getUTCFullYear()),
    y: () => pad(date.getUTCFullYear() % 100),
    m: () => pad(date.getUTCMonth() + 1),
    d: () => pad(date.getUTCDate()),
    H: () => pad(date.getUTCHours()),
    M: () => pad(date.getUTCMinutes()),
    S: () => pad(date.getUTCSeconds()),
    B: () => MONTHS[date.getUTCMonth()],
    b: () => MONTHS[date.getUTCMonth()].slice(0, 3),
    A: () => DAYS[date.getUTCDay()],
    a: () => DAYS[date.getUTCDay()].slice(0, 3),
    j: () => pad(Math.floor((date.getTime() - start) / 86400000) + 1, 3),
    '%': () => '%'
  };
  return format.replace(/%(.)/g, (match, code) => (parts[code] ? parts[code]() : match));
}

function splitUnescaped(text, separator) {
  const parts = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && text[i + 1] === separator) {
      current += separator;
      i += 1;
    } else if (text[i] === separator) {
      parts.push(current);
      current = '';
    } else {
      current += text[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseKey(key) {
  let rest = key;
  let fallback = null;
  let replacement = null;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    fallback = rest.slice(pipe + 1);
    rest = rest.slice(0, pipe);
  }
  const amp = rest.indexOf('&');
  if (amp !== -1) {
    replacement = rest.slice(amp + 1);
    rest = rest.slice(0, amp);
  }
  const alternatives = splitUnescaped(rest, ',').map((part) => {
    const gt = part.indexOf('>');
    return gt === -1 ? { field: part.trim(), format: null } : { field: part.slice(0, gt).trim(), format: part.slice(gt + 1) };
  });
  return { alternatives, fallback, replacement };
}

function lookup(fields, { field, format }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return null;
  const value = Object.hasOwn(fields, field) ? fields[field] : null;
  if (!present(value)) return null;
  if (format === null) return value;
  const formatted = strftime(value, format);
  return present(formatted) ? formatted : null;
}

function digits(count) {
  return Number.isInteger(count) && count > 0 ? String(count).length : 0;
}

function formatValue(value, field, { flags, width, precision, type }, fields) {
  const size = width ? Math.min(Number(width), 64) : 0;
  const padChar = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
  const align = (text) => (flags.includes('-') ? text.padEnd(size, ' ') : text.padStart(size, padChar));
  if (type === 'd' || type === 'i') {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const truncated = Math.trunc(number);
    const sign = truncated < 0 ? '-' : '';
    const body = String(Math.abs(truncated));
    if (padChar === '0' && !flags.includes('-')) return sign + body.padStart(Math.max(0, size - sign.length), '0');
    return align(sign + body);
  }
  if (type === 'f') {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return align(number.toFixed(precision ? Number(precision) : 6));
  }
  let text = String(value);
  if (type === 's' && field === 'playlist_index' && typeof value === 'number' && !width) {
    text = text.padStart(digits(fields.playlist_count), '0');
  }
  if (precision !== undefined) text = Array.from(text).slice(0, Number(precision)).join('');
  return align(text);
}

function renderRaw(template, fields) {
  return String(template).replace(TOKEN, (match, percent, key, flags, width, precision, type) => {
    if (percent) return '%';
    const { alternatives, fallback, replacement } = parseKey(key);
    let value = null;
    let field = null;
    for (const alternative of alternatives) {
      value = lookup(fields, alternative);
      if (value !== null) {
        field = alternative.field;
        break;
      }
    }
    if (value !== null && replacement !== null) {
      value = replacement.replace(/\{\}/g, String(value));
      field = null;
    }
    if (value === null) return fallback ?? NA;
    const formatted = formatValue(value, field, { flags, width, precision, type }, fields);
    return formatted === null ? fallback ?? NA : formatted;
  });
}

function templateFor(id, customTemplate) {
  if (!Object.hasOwn(NAME_TEMPLATES, id)) throw new TypeError('Unknown name template');
  if (id !== 'custom') return NAME_TEMPLATES[id];
  const custom = typeof customTemplate === 'string' ? customTemplate.trim().replace(TRAILING_EXT, '') : '';
  if (!custom || custom.length > MAX_TEMPLATE_LENGTH) return NAME_TEMPLATES.title;
  return custom;
}

function renderTemplate(id, info, customTemplate, { maxLength } = {}) {
  const fields = fieldsFromInfo(info);
  const rendered = renderRaw(templateFor(id, customTemplate), fields);
  const fallback = sanitizeFileName(fields.title, { fallback: fields.id ?? 'download', maxLength });
  return sanitizeFileName(rendered, { fallback, maxLength });
}

function applyNumbering(name, index, count) {
  if (!Number.isInteger(index) || index < 1) return name;
  const width = Math.max(3, digits(count));
  return `${String(index).padStart(width, '0')} - ${name}`;
}

function ytDlpLiteral(name) {
  return String(name).replaceAll('%', '%%');
}

module.exports = {
  NAME_TEMPLATES,
  MAX_TEMPLATE_LENGTH,
  renderTemplate,
  renderRaw,
  templateFor,
  fieldsFromInfo,
  applyNumbering,
  ytDlpLiteral
};
