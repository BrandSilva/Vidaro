export const queue = {
  title: 'Queue',
  subtitleEmpty: 'Nothing in the queue',
  counts: {
    running: (n) => `${n} running`,
    queued: (n) => `${n} waiting`,
    ready: (n) => `${n} ready`,
    paused: (n) => `${n} paused`,
    interrupted: (n) => `${n} interrupted`,
    failed: (n) => `${n} failed`,
    finished: (n) => `${n} finished`
  },

  startAll: 'Start all',
  startAllHint: 'Start every paused, ready and interrupted job',
  pauseAll: 'Pause all',
  pauseAllHint: 'Pause every running and waiting job',
  clearFinished: 'Clear finished',
  clearFinishedHint: 'Remove finished and canceled jobs from the list. The files stay on disk.',
  atOnce: 'At once',
  limitDownloads: 'Downloads',
  limitConversions: 'Conversions',
  downloadsAtOnce: 'Downloads at the same time',
  conversionsAtOnce: 'Conversions at the same time',

  filterLabel: 'Show jobs',
  filters: {
    all: 'All',
    active: 'Active',
    finished: 'Finished',
    failed: 'Failed'
  },
  searchPlaceholder: 'Filter by name',
  searchLabel: 'Filter jobs by name',
  clearSearch: 'Clear filter',
  selected: (n) => `${n} selected`,
  listLabel: 'Jobs',

  states: {
    queued: 'Waiting',
    running: 'Running',
    paused: 'Paused',
    ready: 'Ready',
    interrupted: 'Interrupted',
    done: 'Done',
    skipped: 'Skipped',
    failed: 'Failed',
    canceled: 'Canceled',
    stopping: 'Stopping'
  },
  stateHints: {
    queued: 'Starts when a slot is free',
    paused: 'Paused. Resume to continue.',
    ready: 'Added to the queue. Start it when you are ready.',
    interrupted: 'Vidaro closed before this job finished. Resume to continue.',
    skipped: 'A file with this name already existed, so nothing was written.',
    canceled: 'Canceled. Retry to start it again.',
    stopping: 'Stopping…'
  },
  stages: {
    starting: 'Starting',
    downloading: 'Downloading',
    merging: 'Merging',
    'converting-audio': 'Extracting',
    embedding: 'Embedding',
    fixing: 'Fixing',
    moving: 'Moving',
    finished: 'Finishing',
    remuxing: 'Remuxing',
    cutting: 'Cutting',
    processing: 'Processing',
    preparing: 'Preparing',
    analyzing: 'Analyzing',
    'measuring-loudness': 'Loudness',
    'encoding-pass-1': 'Pass 1 of 2',
    encoding: 'Encoding',
    verifying: 'Verifying',
    finishing: 'Finishing',
    stopping: 'Stopping'
  },
  stageHints: {
    starting: 'Starting the download',
    downloading: 'Downloading',
    merging: 'Joining video and audio into one file',
    'converting-audio': 'Converting the audio to the chosen format',
    embedding: 'Adding subtitles, thumbnail and details to the file',
    fixing: 'Repairing the downloaded file',
    moving: 'Moving the file to its folder',
    finished: 'Finishing the file',
    remuxing: 'Putting the video into the chosen format',
    cutting: 'Cutting the chosen time range',
    processing: 'Processing the downloaded file',
    preparing: 'Preparing the conversion',
    analyzing: 'Checking whether the video is interlaced',
    'measuring-loudness': 'Measuring the loudness of the audio',
    'encoding-pass-1': 'Encoding, first of two passes',
    encoding: 'Encoding',
    verifying: 'Checking the finished file',
    finishing: 'Finishing the file',
    stopping: 'Stopping'
  },

  actions: {
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    retry: 'Retry',
    cancel: 'Cancel',
    remove: 'Remove',
    openFile: 'Open file',
    showInFolder: 'Show in folder',
    openFolder: 'Open output folder',
    copyLink: 'Copy link',
    copySource: 'Copy source path',
    copyOutput: 'Copy file path',
    dragToReorder: 'Drag to reorder',
    expand: 'Expand',
    collapse: 'Collapse',
    retryFailed: 'Retry failed',
    removeGroup: 'Remove all'
  },

  target: {
    best: 'Best',
    height: (value) => `${value}p`,
    videoOnly: 'No audio',
    videoOnlyHint: 'Video only, without audio',
    audioOnly: (format) => `Audio only, ${format}`,
    thenConvert: (preset) => `Then convert with ${preset}`,
    section: (start, end) => `Only ${start} to ${end}`,
    trim: (start, end) => `Trimmed ${start} to ${end}`,
    fromStart: 'the start',
    toEnd: 'the end'
  },

  tip: {
    playlist: (title) => `From ${title}`,
    savesTo: (path) => `Saves to ${path}`,
    savedTo: (path) => `Saved to ${path}`,
    attempts: (n) => `Attempt ${n}`,
    size: (size) => `Size ${size}`
  },
  realtime: (value) => `${value}×`,
  finishedNotes: 'Finished with notes',

  conversion: 'Conversion',
  conversionHint: (state) => `Show the conversion of this download (${state})`,

  group: {
    untitled: 'Playlist',
    progress: (done, total) => `${done} of ${total} done`,
    running: 'Running',
    waiting: 'Waiting',
    paused: 'Paused',
    done: 'Done',
    failed: (n) => `${n} failed`
  },

  failure: {
    updateAndRetry: 'Update yt-dlp and retry',
    updateFailed: 'yt-dlp could not be updated. Check the internet connection and try again.',
    updateDeferred: 'yt-dlp will update as soon as the running downloads finish. Retry this job after that.',
    openSettings: 'Open settings',
    cookieSettings: 'Cookie settings',
    softwareRetry: 'Use software encoding and retry',
    softwareRetryHint: 'Switches Settings, Convert, Hardware to software encoding for all conversions.',
    details: 'Details',
    detailsLabel: 'Error details',
    copy: 'Copy',
    copied: 'Copied'
  },

  removeTitle: (n) => (n === 1 ? 'Remove this job?' : `Remove ${n} jobs?`),
  removeText: (active) =>
    active === 1
      ? 'One of them is running or waiting. It will be stopped and its unfinished files deleted. Finished files stay on disk.'
      : `${active} of them are running or waiting. They will be stopped and their unfinished files deleted. Finished files stay on disk.`,
  removeTextSingle: 'It will be stopped and its unfinished files deleted. Finished files stay on disk.',
  removeConfirm: 'Remove',
  removeKeep: 'Keep',

  fileMissing: (name) => `“${name}” was not found. It may have been moved or deleted.`,
  folderMissing: 'The output folder was not found. It may have been moved or deleted.',

  emptyTitle: 'Nothing in the queue',
  emptyText: 'Downloads and conversions you start or add to the queue show up here.',
  emptyDownload: 'Download a video',
  emptyConvert: 'Convert files',
  noMatch: 'No jobs match this filter.',
  noMatchSearch: (text) => `No jobs match “${text}”.`,
  showAll: 'Show all jobs'
};
