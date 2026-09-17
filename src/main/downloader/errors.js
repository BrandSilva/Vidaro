const UPDATE_HINT = 'Update yt-dlp and retry. Sites change often and updates usually fix this.';
const COOKIES_HINT = 'Use cookies from a browser where you are signed in (Settings, Download, Cookies).';
const NETWORK_HINT = 'Check the internet connection and retry.';

const RULES = [
  {
    code: 'ytdlp-broken',
    pattern: /\[PYI-\d+:ERROR\]|Error loading Python DLL|Could not load PyInstaller|Failed to extract .*(?:PKG|python)|Traceback \(most recent call last\)|ModuleNotFoundError|ImportError:/i,
    scope: 'all',
    message: 'yt-dlp could not start correctly.',
    hint: 'Update yt-dlp. If it keeps failing, check that your antivirus is not blocking it.',
    action: 'update-ytdlp'
  },
  {
    code: 'bad-options',
    pattern: /yt-dlp(?:\.exe)?: error: /i,
    scope: 'all',
    message: 'This yt-dlp version did not accept the download options.',
    hint: 'Update yt-dlp. If it keeps failing, reinstall Vidaro.',
    action: 'update-ytdlp',
    retryable: false
  },
  {
    code: 'disk-full',
    pattern: /Errno 28\b|No space left on device|ENOSPC|WinError 112\b|not enough space on the disk/i,
    message: 'There is not enough free space on the disk.',
    hint: 'Free some space on the target drive or choose another folder, then retry.'
  },
  {
    code: 'path-too-long',
    pattern: /WinError 206\b|filename or extension is too long|File name too long|ENAMETOOLONG|Errno 36\b/i,
    message: 'The file path is too long for Windows.',
    hint: 'Choose a shorter file name or a folder closer to the drive root.',
    retryable: false
  },
  {
    code: 'access-denied',
    pattern: /Errno 13\b|Errno 30\b|Permission denied|WinError (?:5|32|33)\b|Access is denied|being used by another process|Read-only file system|EACCES|EPERM/i,
    message: 'Vidaro could not write the file.',
    hint: 'Choose another output folder, or close any program that is using the file. Antivirus software can also block writes.'
  },
  {
    code: 'cookies-locked',
    pattern: /Could not copy \S+ cookie database|Failed to decrypt with DPAPI|app[- ]?bound encryption|cookie database is locked|Unable to read cookie|failed to (?:load|read) cookies|could not decrypt/i,
    message: "The browser's cookies could not be read.",
    hint: 'Close the browser completely and retry, or use Firefox or a cookies file instead.',
    action: 'cookies'
  },
  {
    code: 'cookies-missing',
    pattern: /could not find \S+ cookies database|could not find \S+ cookies|does not look like a Netscape format cookies file|cookies file .*(?:does not exist|not found)/i,
    message: 'No cookies were found for the chosen browser or file.',
    hint: 'Pick the browser where you are signed in, or choose a valid cookies file.',
    action: 'cookies',
    retryable: false
  },
  {
    code: 'drm-protected',
    pattern: /DRM[- ]protect|is DRM|use DRM|\bDRM\b.*not (?:be )?supported|Widevine|PlayReady/i,
    message: 'This video is protected by DRM and cannot be downloaded.',
    hint: 'There is no way around DRM protection.',
    retryable: false
  },
  {
    code: 'sponsorblock-failed',
    pattern: /SponsorBlock API/i,
    message: 'SponsorBlock could not be reached.',
    hint: 'Retry later, or turn off SponsorBlock for this download.'
  },
  {
    code: 'subtitles-failed',
    pattern: /Unable to download video subtitles/i,
    message: 'The subtitles could not be downloaded.',
    hint: 'Retry later, or turn off subtitles for this download.'
  },
  {
    code: 'bot-check',
    pattern: /confirm (?:that )?you(?:'|’| a)?re not a bot|not a robot|captcha/i,
    message: 'The site asked to confirm you are not a bot.',
    hint: `${COOKIES_HINT} Waiting a while can also help.`,
    action: 'cookies'
  },
  {
    code: 'age-restricted',
    pattern: /confirm your age|age[- ]restricted|inappropriate for some users|age[- ]gate|age verification/i,
    message: 'This video is age restricted.',
    hint: 'Use cookies from a browser where you are signed in with an adult account.',
    action: 'cookies'
  },
  {
    code: 'members-only',
    pattern: /members[- ]only|available to this channel's members|join this channel|channel membership|subscriber_only|premium_only|YouTube Premium|requires a (?:paid )?subscription|requires payment/i,
    message: 'This video is only for channel members or subscribers.',
    hint: 'Use cookies from a browser where your account has access.',
    action: 'cookies',
    retryable: false
  },
  {
    code: 'private-video',
    pattern: /private video|video is private|this video is private|playlist is private|is a private/i,
    message: 'This video is private.',
    hint: 'If your account has access, use cookies from a browser where you are signed in.',
    action: 'cookies',
    retryable: false
  },
  {
    code: 'geo-blocked',
    pattern: /not (?:made )?(?:this video )?available (?:in|from) your (?:country|location|region)|geo[- ]?restrict|blocked it in your country|not available in your region|available in your country/i,
    message: 'This video is not available in your country.',
    hint: 'A proxy in an allowed country may work (Settings, Download, Proxy).',
    action: 'open-settings',
    retryable: false
  },
  {
    code: 'live-not-started',
    pattern: /live event will begin|premieres? (?:in|will begin)|has not (?:yet )?started|not started yet|is_upcoming|scheduled to start|waiting for scheduled stream|will begin in|stream is offline|not currently live/i,
    message: 'This live stream or premiere has not started yet.',
    hint: 'Try again once it has started.'
  },
  {
    code: 'login-required',
    pattern: /login required|log in to (?:view|watch|access)|requires? (?:authentication|an account|login)|authentication required|only available for registered users/i,
    message: 'This video requires signing in.',
    hint: COOKIES_HINT,
    action: 'cookies'
  },
  {
    code: 'video-unavailable',
    pattern: /video unavailable|video is unavailable|video (?:has been|was) removed|no longer available|(?:video|page|playlist|channel|user|media) does not exist|HTTP Error 404|404: Not Found|account .*terminated|content (?:isn't|is not) available(?! on this app)|video not found|(?:video|page|content|media) could not be found|has been deleted|recording is not available|playlist type is unviewable/i,
    message: 'This video is not available.',
    hint: 'Check the link. The video may have been removed.',
    retryable: false
  },
  {
    code: 'login-required',
    pattern: /\bsign in\b|\blog ?in\b|registered users|needs_auth|use --cookies|HTTP Error 401/i,
    message: 'This video requires signing in.',
    hint: COOKIES_HINT,
    action: 'cookies'
  },
  {
    code: 'rate-limited',
    pattern: /HTTP Error 429|Too Many Requests|rate[- ]limit|ffmpeg exited with code (?:3335375624|-959591672)\b/i,
    message: 'The site is limiting requests right now.',
    hint: 'Wait a few minutes and retry. Cookies from a signed-in browser can also help.'
  },
  {
    code: 'http-403',
    pattern: /HTTP Error 403|403: Forbidden|403 Forbidden|ffmpeg exited with code (?:3436169992|-858797304)\b/i,
    message: 'The site refused the download.',
    hint: UPDATE_HINT,
    action: 'update-ytdlp'
  },
  {
    code: 'network',
    pattern: /ffmpeg exited with code (?:3486501640|-808465656|3469724424|-825242872|3419392776|-875574520|2812791560|-1482175736|2812791304|-1482175992)\b/i,
    message: 'The site stopped sending the video.',
    hint: 'Retry the download. If it keeps failing, update yt-dlp.'
  },
  {
    code: 'network',
    pattern: /Unable to connect to proxy|ProxyError|Tunnel connection failed|proxy authentication/i,
    message: 'Could not connect to the proxy.',
    hint: 'Check the proxy address in Settings, or clear it.',
    action: 'open-settings'
  },
  {
    code: 'network',
    pattern: /getaddrinfo failed|Failed to resolve|Name or service not known|nodename nor servname|Temporary failure in name resolution|Errno 1100[14]\b|No address associated/i,
    message: 'Could not reach the site.',
    hint: 'Make sure this PC is connected to the internet, then retry.'
  },
  {
    code: 'network',
    pattern: /CERTIFICATE_VERIFY_FAILED|certificate verify failed|\[SSL[:\]]|SSLError|TLS/,
    message: 'A secure connection to the site could not be made.',
    hint: "Check the PC's date and time. Antivirus HTTPS scanning can also cause this."
  },
  {
    code: 'network',
    pattern: /timed out|timeout|WinError 10060\b/i,
    message: 'The connection timed out.',
    hint: NETWORK_HINT
  },
  {
    code: 'network',
    pattern: /WinError 100\d\d\b|Connection (?:refused|reset|aborted)|Network is unreachable|No route to host|RemoteDisconnected|urlopen error|TransportError|connection (?:was )?(?:closed|lost|broken)|EOF occurred|IncompleteRead|Errno 10[0-9]\b|Errno 11[0-3]\b/i,
    message: 'The network connection failed.',
    hint: NETWORK_HINT
  },
  {
    code: 'download-interrupted',
    pattern: /fragment \S+ not found|giving up after \d+ (?:fragment )?retries|did not get any data blocks|content too short|download was interrupted|unable to download video data/i,
    message: 'The download was interrupted.',
    hint: 'Retry. The part already downloaded is kept.'
  },
  {
    code: 'challenge-failed',
    pattern: /n challenge|nsig|sig(?:nature)? (?:extraction|function|cipher|solving)|challenge solv|Failed to extract any player response|PO Token|po_token/i,
    message: "The site's video protection could not be solved.",
    hint: UPDATE_HINT,
    action: 'update-ytdlp'
  },
  {
    code: 'extractor-error',
    pattern: /No video formats found|not available on this app/i,
    message: "The site's page could not be read.",
    hint: UPDATE_HINT,
    action: 'update-ytdlp'
  },
  {
    code: 'format-unavailable',
    pattern: /requested format (?:is )?not available|format is not available|no formats? (?:found|available)/i,
    message: 'The chosen quality or format is not available for this video.',
    hint: 'Pick another quality or format and retry.',
    retryable: false
  },
  {
    code: 'unsupported-url',
    pattern: /Unsupported URL|is not a valid URL|no suitable InfoExtractor|Unable to recognize/i,
    message: 'This link is not supported.',
    hint: 'Check the link. If the site should work, updating yt-dlp may help.',
    retryable: false
  },
  {
    code: 'ffmpeg-missing',
    pattern: /ff(?:mpeg|probe)(?: and ff(?:mpeg|probe))? (?:is |are )?not (?:installed|found)|ffmpeg-location .*does not exist/i,
    message: 'The media tools that Vidaro needs are missing.',
    hint: 'Reinstall Vidaro and check that your antivirus did not quarantine ffmpeg.',
    retryable: false
  },
  {
    code: 'postprocessing-failed',
    pattern: /Postprocessing:|Conversion failed|ffmpeg exited with code|Error opening output|Invalid data found when processing input|Unable to embed|Error muxing|Could not write header|Error while opening encoder|Unable to remux|merging of multiple formats/i,
    message: 'Processing the downloaded file failed.',
    hint: 'Retry with the MKV container, or turn off the embedding options.'
  },
  {
    code: 'write-failed',
    pattern: /unable to (?:open for writing|write data|rename file|create directory)|Errno 2\b|No such file or directory|Errno 22\b/i,
    message: 'Vidaro could not write the file.',
    hint: 'Check that the output folder exists, that the drive is connected, and that the file name is not too long.'
  },
  {
    code: 'extractor-error',
    pattern: /Unable to extract|please report this issue|latest version|KeyError|IndexError|TypeError|AttributeError|ExtractorError|Unable to download (?:API page|webpage|JSON|XML|m3u8|MPD)|Failed to parse|JSONDecodeError|Unable to find|incomplete data|Got error/i,
    message: "The site's page could not be read.",
    hint: UPDATE_HINT,
    action: 'update-ytdlp'
  }
];

const CONTEXT_RULES = [
  {
    code: 'no-js-runtime',
    pattern: /No supported JavaScript runtime|JavaScript runtime could not|js runtime/i,
    message: 'YouTube needs a JavaScript runtime that could not be used.',
    hint: 'Update yt-dlp and retry. If it keeps failing, reinstall Vidaro.',
    action: 'update-ytdlp'
  },
  {
    code: 'challenge-failed',
    pattern: /n challenge|nsig|signature (?:extraction|function|solving)|challenge solv|PO Token|po_token|SABR/i,
    message: "The site's video protection could not be solved.",
    hint: UPDATE_HINT,
    action: 'update-ytdlp'
  }
];

const CONTEXT_CODES = new Set(['format-unavailable', 'extractor-error', 'http-403', 'unknown']);

const UNKNOWN = {
  code: 'unknown',
  message: 'The download failed.',
  hint: 'Retry. If it keeps failing, update yt-dlp.',
  action: null
};

const BOILERPLATE = [
  /;?\s*please report this issue on\s+\S+.*$/i,
  /\s*Confirm you are on the latest version using\s+yt-dlp -U.*$/i,
  /\s*Use --cookies-from-browser or --cookies for the authentication\..*$/i,
  /\s*Use --list-formats for a list of available formats/i,
  /\.?\s*Aborting(?: due to --abort-on-error)?\.?\s*$/i,
  /\s*\(caused by .*$/i,
  /\s*See\s+https?:\/\/\S+\s+for .*$/i
];

const MAX_DETAIL = 500;
const SOFT_ERROR = /^ERROR: (?:Preprocessing|Postprocessing): Unable to communicate with SponsorBlock API\b/;

function toLines(value) {
  if (Array.isArray(value)) return value.filter((line) => typeof line === 'string');
  if (typeof value === 'string') return value.split(/\r?\n/);
  return [];
}

function cleanDetail(line) {
  let text = line.trim().replace(/^ERROR:\s*/, '');
  const site = /^\[[^\]\s]+\]\s+/.exec(text);
  if (site) {
    text = text.slice(site[0].length);
    const id = /^[^\s:]{1,80}:\s+/.exec(text);
    if (id) text = text.slice(id[0].length);
  }
  for (const pattern of BOILERPLATE) text = text.replace(pattern, '');
  text = text.trim();
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function isNoise(line) {
  return !line.trim() || line.startsWith('WARNING:') || line.startsWith('VIDARO-') || /^[a-z_0-9]+=/.test(line);
}

function build(rule, detail) {
  return {
    code: rule.code,
    message: rule.message,
    hint: rule.hint ?? null,
    action: rule.action ?? null,
    retryable: rule.retryable !== false,
    detail: detail || null
  };
}

function mapDownloadError(stderrLines, { exitCode = null } = {}) {
  const lines = toLines(stderrLines).map((line) => line.replace(/\s+$/, ''));
  const allErrors = lines.filter((line) => line.startsWith('ERROR:'));
  const hardErrors = allErrors.filter((line) => !SOFT_ERROR.test(line));
  const errors = hardErrors.length > 0 ? hardErrors : allErrors;
  const warnings = lines.filter((line) => line.startsWith('WARNING:'));
  const others = lines.filter((line) => !isNoise(line) && !line.startsWith('ERROR:'));
  const errorText = errors.join('\n');
  const allText = [...errors, ...others].join('\n');
  const lastError = errors[errors.length - 1];
  const detail = lastError ? cleanDetail(lastError) : others.length > 0 ? cleanDetail(others[others.length - 1]) : null;

  let match = null;
  for (const rule of RULES) {
    const haystack = rule.scope === 'all' ? allText : errorText;
    if (haystack && rule.pattern.test(haystack)) {
      match = rule;
      break;
    }
  }
  if (!match && exitCode === 2 && !lastError) match = RULES.find((rule) => rule.code === 'bad-options');
  const code = match ? match.code : 'unknown';
  if (CONTEXT_CODES.has(code) && warnings.length > 0) {
    const warningText = warnings.join('\n');
    const context = CONTEXT_RULES.find((rule) => rule.pattern.test(warningText));
    if (context) return build(context, detail);
  }
  return build(match ?? UNKNOWN, detail);
}

function softFailure(stderrLines) {
  const errors = toLines(stderrLines).filter((line) => line.startsWith('ERROR:'));
  if (errors.length === 0) return null;
  return errors.every((line) => SOFT_ERROR.test(line)) ? 'sponsorblock-failed' : null;
}

function meaningfulWarnings(lines) {
  const result = [];
  for (const line of toLines(lines)) {
    if (!line.startsWith('WARNING:')) continue;
    const text = line.slice(8).trim();
    if (/no supported javascript runtime/i.test(text)) result.push('no-js-runtime');
    else if (/n challenge|nsig|signature|challenge solv|po token/i.test(text)) result.push('challenge-failed');
    else if (/no subtitles|subtitles? .*not available|There are no subtitles/i.test(text)) result.push('no-subtitles');
    else if (/sponsorblock/i.test(text)) result.push('sponsorblock-failed');
    else if (/thumbnail/i.test(text)) result.push('thumbnail-failed');
  }
  return [...new Set(result)];
}

module.exports = { mapDownloadError, meaningfulWarnings, softFailure, cleanDetail };
