export function cx(...parts) {
  let result = '';
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string') result += (result ? ' ' : '') + part;
    else if (typeof part === 'object') {
      for (const [name, on] of Object.entries(part)) if (on) result += (result ? ' ' : '') + name;
    }
  }
  return result;
}
