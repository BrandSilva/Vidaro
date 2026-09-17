const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const download = {
  title: 'Download',
  subtitle: 'Paste a link from YouTube or hundreds of other sites',

  link: {
    label: 'Link to download',
    placeholder: 'Paste a link…',
    paste: 'Paste',
    pasteHint: 'Paste the link from the clipboard',
    get: 'Get',
    getHint: 'Get the video details',
    clear: 'Clear the link',
    invalid: 'Enter a link that starts with http:// or https://',
    clipboardEmpty: 'The clipboard does not contain a link.',
    chip: 'Paste link',
    chipDismiss: 'Hide this suggestion'
  },

  idle: {
    title: 'Paste a link to start',
    text: 'Single videos, playlists and channels. Pick the quality, the format and where to save it.',
    shortcutBefore: 'Press',
    shortcutAfter: 'anywhere on this page, or drop a link on the window.'
  },

  fetching: {
    video: 'Getting video details…',
    playlist: 'Getting the list of videos…',
    cancel: 'Cancel'
  },

  error: {
    retry: 'Retry',
    update: 'Update yt-dlp and retry',
    updating: 'Updating yt-dlp…',
    openSettings: 'Open settings',
    updateDeferred: 'yt-dlp will update as soon as the running downloads finish. Retry after that.',
    updateFailed: 'yt-dlp could not be updated. Check the internet connection and try again.',
    upToDate: 'yt-dlp is already up to date.'
  },

  video: {
    live: 'LIVE',
    liveNotice: 'This is a live stream. The download keeps recording until the stream ends.',
    upcomingNotice: 'This live stream or premiere has not started yet, so it cannot be downloaded now.',
    drmNotice: 'This video is protected by DRM and cannot be downloaded.',
    ageNotice: 'This video is age restricted. If the download fails, use cookies from a browser where you are signed in.',
    audioOnly: 'This link has audio only.',
    wholePlaylist: 'Download the whole playlist',
    wholePlaylistHint: 'This video is part of a playlist. Open the playlist to choose its videos.',
    fileName: 'File name',
    fileNameLabel: 'File name, without extension',
    extensionHint: 'The extension follows the chosen format',
    restoreName: 'Use the name from the template'
  },

  templates: {
    title: 'Title',
    'channel-title': 'Channel - Title',
    'date-title': 'Date - Title',
    'title-id': 'Title [id]',
    custom: 'Custom…'
  },

  template: {
    label: 'Name template',
    customLabel: 'Custom template',
    customPlaceholder: '%(title)s',
    customHint: 'yt-dlp fields, for example %(channel)s - %(title)s',
    customInvalid: 'Use at least one field, for example %(title)s',
    example: 'Example',
    fileNames: 'File names'
  },

  options: {
    title: 'Options',
    what: 'What to download',
    modes: {
      av: 'Video + audio',
      video: 'Video only',
      audio: 'Audio only'
    },
    quality: 'Quality',
    best: 'Best',
    fourK: '4K',
    height: (h) => `${h}p`,
    unavailable: 'Not available for this video',
    format: 'Format',
    containers: {
      mp4: 'MP4',
      mkv: 'MKV',
      webm: 'WebM'
    },
    compatible: 'Compatible',
    compatibleHint: 'H.264 + AAC in MP4, plays everywhere (FlowAir, TVs, editors)',
    compatibleWebm: 'Not used with WebM, which has its own codecs',
    compatibleYoutube: 'YouTube offers H.264 only up to 1080p',
    compatibleGeneric: 'H.264 is rarely offered above 1080p, so a lower quality may be used',
    audioFormats: {
      mp3: 'MP3',
      m4a: 'M4A (AAC)',
      opus: 'Opus',
      wav: 'WAV',
      flac: 'FLAC'
    },
    audioQualities: {
      best: 'Best',
      320: '320 kbps',
      256: '256 kbps',
      192: '192 kbps',
      128: '128 kbps'
    },
    lossless: 'Lossless',
    saveTo: 'Save to',
    chooseFolder: 'Choose a folder'
  },

  more: {
    title: 'More options',
    defaults: 'Defaults',
    saveDefault: 'Save as default',
    saveDefaultHint: 'Use these options for every new download',
    useDefaults: 'Use defaults',
    useDefaultsHint: 'Go back to the saved default options',
    groups: {
      subtitles: 'Subtitles',
      embed: 'Inside the file',
      transfer: 'Transfer',
      access: 'Access'
    },
    subtitles: 'Download subtitles',
    subtitlesHint: 'When the video has them',
    languages: 'Subtitle languages',
    languagesHint: 'For example en.*,es.*',
    languagesInvalid: 'Use codes like en.*,es.*',
    autoSubtitles: 'Auto-generated subtitles',
    autoSubtitlesHint: 'Include subtitles created automatically by the site',
    embedSubtitles: 'Embed subtitles',
    embedSubtitlesHint: 'Inside the video instead of separate .srt files',
    embedThumbnail: 'Embed thumbnail',
    embedThumbnailHint: 'Shown as cover art in players and Explorer',
    embedMetadata: 'Embed metadata',
    embedMetadataHint: 'Title, channel, date and description',
    embedChapters: 'Embed chapters',
    embedChaptersHint: 'Chapter marks from the site',
    sponsorBlock: 'Remove sponsor segments',
    sponsorBlockHint: 'YouTube only. Skips sponsors and self promotion',
    timeRange: 'Time range',
    timeRangeHint: 'Download only this part of the video, for example 1:30 to 2:45',
    start: 'From',
    end: 'To',
    startPlaceholder: '0:00',
    endPlaceholder: 'End',
    rangeErrors: {
      start: 'Write the start as 1:30 or 1:02:30',
      end: 'Write the end as 1:30 or 1:02:30',
      order: 'The end must be after the start',
      beyond: 'The start is after the end of the video'
    },
    speedLimit: 'Speed limit',
    speedPlaceholder: 'No limit',
    speedHint: 'For example 500K or 5M (per second)',
    speedInvalid: 'Use a value like 500K or 5M',
    fragments: 'Parallel fragments',
    fragmentsHint: 'Pieces fetched at once (1 to 16)',
    cookies: 'Cookies',
    cookiesHint: 'For private, age restricted or members-only videos',
    cookieModes: {
      none: 'None',
      browser: 'From browser',
      file: 'From file'
    },
    browser: 'Browser',
    browserHint: 'Close the browser if its cookies cannot be read',
    browsers: {
      edge: 'Microsoft Edge',
      chrome: 'Google Chrome',
      firefox: 'Firefox',
      brave: 'Brave',
      opera: 'Opera',
      vivaldi: 'Vivaldi',
      chromium: 'Chromium'
    },
    cookiesFile: 'Cookies file',
    cookiesFileHint: 'A cookies.txt file in Netscape format',
    chooseFile: 'Choose file…',
    noFile: 'No file chosen',
    proxy: 'Proxy',
    proxyPlaceholder: 'No proxy',
    proxyHint: 'For example http://host:8080 or socks5://host:1080',
    proxyInvalid: 'Use an http, https or socks address',
    active: {
      subtitles: 'Subtitles',
      noEmbeds: 'No embedding',
      sponsorBlock: 'SponsorBlock',
      range: 'Time range',
      speed: (value) => `Limit ${value}/s`,
      fragments: (n) => `${n} fragments`,
      cookies: 'Cookies',
      proxy: 'Proxy'
    }
  },

  after: {
    title: 'After download',
    off: 'Nothing',
    summary: (name) => `Convert with ${name}`,
    preset: 'Convert with preset',
    presetHint: 'Runs right after the download',
    none: 'None',
    keepOriginal: 'Keep the original file',
    keepOriginalOn: 'Both files are kept',
    keepOriginalOff: 'The download is deleted once converted',
    needsVideo: 'This preset makes a video, but only audio is downloaded. Choose an audio preset.',
    missing: 'The saved preset no longer exists.'
  },

  playlist: {
    fallbackTitle: 'Playlist',
    videos: (n) => plural(n, 'video', 'videos'),
    selected: (n, total) => `${n} of ${total} selected`,
    toggleAll: 'Select all videos',
    range: 'Range',
    rangePlaceholder: '1-10, 15',
    rangeHint: 'Select by position, for example 1-10, 15 or 20-',
    rangeInvalid: 'Use positions like 1-10, 15 or 20-',
    rangeApply: 'Select',
    numberFiles: 'Number files',
    numberFilesHint: 'Start each file name with its position, like 001 - Title',
    showing: (shown, total) => `Showing the first ${shown} of ${total}`,
    moreDuration: (text) => `${text}+`,
    open: 'Open',
    openHint: 'Open this list to choose its videos',
    listLabel: 'Videos in the playlist',
    empty: 'This list has no videos that can be downloaded.',
    flags: {
      upcoming: 'Upcoming',
      live: 'Live',
      private: 'Private',
      members: 'Members',
      login: 'Sign-in'
    },
    flagHints: {
      upcoming: 'Not started yet, so it is not selected',
      live: 'Live now. It records until the stream ends',
      private: 'Private video, so it is not selected. It needs cookies from an account with access',
      members: 'Members only. It needs cookies from an account with access',
      login: 'Needs signing in. It needs cookies from a browser where you are signed in'
    }
  },

  footer: {
    idle: 'Paste a link to start',
    loading: 'Getting details…',
    videos: (n) => plural(n, 'video', 'videos'),
    best: 'Best quality',
    height: (h) => `${h}p`,
    fourK: '4K',
    compatible: 'H.264 + AAC',
    videoOnly: 'No audio',
    kbps: (n) => `${n} kbps`,
    size: (text) => `≈ ${text}`,
    range: (from, to) => `${from}–${to}`,
    then: (name) => `then ${name}`,
    addToQueue: 'Add to queue',
    addToQueueHint: 'Add as Ready and start it later from the Queue',
    download: 'Download',
    downloadHint: 'Start downloading now'
  },

  issues: {
    drm: 'This video is protected by DRM.',
    selection: 'Select at least one video.',
    'lists-only': 'This page lists other playlists. Open one to choose its videos.',
    'too-many': 'Select at most 5000 videos at once.',
    section: 'Check the time range in More options.',
    template: 'Check the custom name template.',
    'subtitle-langs': 'Check the subtitle languages in More options.',
    'rate-limit': 'Check the speed limit in More options.',
    fragments: 'Parallel fragments must be between 1 and 16.',
    'cookies-file': 'Choose a cookies file in More options.',
    proxy: 'Check the proxy in More options.',
    'preset-video': 'The conversion preset needs video. Choose an audio preset or download the video.'
  },

  added: {
    started: (n) => (n === 1 ? 'Download started' : `${n} downloads started`),
    ready: (n) => (n === 1 ? 'Added to the queue as Ready' : `${n} downloads added to the queue as Ready`),
    readyHint: 'Start them from the Queue when you want.',
    viewQueue: 'View queue',
    failed: 'The download could not be added'
  }
};
