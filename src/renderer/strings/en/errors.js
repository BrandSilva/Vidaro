const UPDATE_HINT = 'Update yt-dlp and retry. Sites change often and updates usually fix this.';
const COOKIES_HINT = 'Use cookies from a browser where you are signed in (Settings, Download, Cookies).';
const NETWORK_HINT = 'Check the internet connection and retry.';
const WRITE_HINT =
  'Choose another output folder, or close any program that is using the file. Antivirus software can also block writes.';

export const errors = {
  unexpected: {
    message: 'Something went wrong while processing this job.',
    hint: 'Try again. If it keeps failing, restart Vidaro.'
  },
  unknown: {
    message: 'The download failed.',
    hint: 'Retry. If it keeps failing, update yt-dlp.'
  },
  'tool-missing': {
    message: 'A required tool could not be started.',
    hint: 'Reinstall Vidaro and check that your antivirus did not block or quarantine it.'
  },
  stalled: {
    message: 'The job stopped making progress.',
    hint: 'Retry the job. If it stalls again, check the network connection or the source file.'
  },
  'disk-full': {
    message: 'There is not enough free space on the disk.',
    hint: 'Free some space on the target drive or choose another folder, then retry.'
  },
  'access-denied': {
    message: 'Vidaro could not write the file.',
    hint: WRITE_HINT,
    variants: {
      'Vidaro could not write the output file.': {
        message: 'Vidaro could not write the output file.',
        hint: WRITE_HINT
      }
    }
  },

  'ytdlp-broken': {
    message: 'yt-dlp could not start correctly.',
    hint: 'Update yt-dlp. If it keeps failing, check that your antivirus is not blocking it.'
  },
  'bad-options': {
    message: 'This yt-dlp version did not accept the download options.',
    hint: 'Update yt-dlp. If it keeps failing, reinstall Vidaro.'
  },
  'path-too-long': {
    message: 'The file path is too long for Windows.',
    hint: 'Choose a shorter file name or a folder closer to the drive root.',
    variants: {
      'The output path is too long for Windows.': {
        message: 'The output path is too long for Windows.',
        hint: 'Choose a shorter name template or a folder closer to the drive root.'
      }
    }
  },
  'cookies-locked': {
    message: "The browser's cookies could not be read.",
    hint: 'Close the browser completely and retry, or use Firefox or a cookies file instead.'
  },
  'cookies-missing': {
    message: 'No cookies were found for the chosen browser or file.',
    hint: 'Pick the browser where you are signed in, or choose a valid cookies file.',
    variants: {
      'The cookies file could not be found.': {
        message: 'The cookies file could not be found.',
        hint: 'Choose the cookies file again in Settings.'
      }
    }
  },
  'drm-protected': {
    message: 'This video is protected by DRM and cannot be downloaded.',
    hint: 'There is no way around DRM protection.'
  },
  'sponsorblock-failed': {
    message: 'SponsorBlock could not be reached.',
    hint: 'Retry later, or turn off SponsorBlock for this download.'
  },
  'subtitles-failed': {
    message: 'The subtitles could not be downloaded.',
    hint: 'Retry later, or turn off subtitles for this download.'
  },
  'bot-check': {
    message: 'The site asked to confirm you are not a bot.',
    hint: `${COOKIES_HINT} Waiting a while can also help.`
  },
  'age-restricted': {
    message: 'This video is age restricted.',
    hint: 'Use cookies from a browser where you are signed in with an adult account.'
  },
  'members-only': {
    message: 'This video is only for channel members or subscribers.',
    hint: 'Use cookies from a browser where your account has access.'
  },
  'private-video': {
    message: 'This video is private.',
    hint: 'If your account has access, use cookies from a browser where you are signed in.'
  },
  'geo-blocked': {
    message: 'This video is not available in your country.',
    hint: 'A proxy in an allowed country may work (Settings, Download, Proxy).'
  },
  'live-not-started': {
    message: 'This live stream or premiere has not started yet.',
    hint: 'Try again once it has started.'
  },
  'login-required': {
    message: 'This video requires signing in.',
    hint: COOKIES_HINT
  },
  'video-unavailable': {
    message: 'This video is not available.',
    hint: 'Check the link. The video may have been removed.'
  },
  'rate-limited': {
    message: 'The site is limiting requests right now.',
    hint: 'Wait a few minutes and retry. Cookies from a signed-in browser can also help.'
  },
  'http-403': {
    message: 'The site refused the download.',
    hint: UPDATE_HINT
  },
  network: {
    message: 'The network connection failed.',
    hint: NETWORK_HINT,
    variants: {
      'Could not connect to the proxy.': {
        message: 'Could not connect to the proxy.',
        hint: 'Check the proxy address in Settings, or clear it.'
      },
      'Could not reach the site.': {
        message: 'Could not reach the site.',
        hint: 'Make sure this PC is connected to the internet, then retry.'
      },
      'A secure connection to the site could not be made.': {
        message: 'A secure connection to the site could not be made.',
        hint: "Check the PC's date and time. Antivirus HTTPS scanning can also cause this."
      },
      'The connection timed out.': {
        message: 'The connection timed out.',
        hint: NETWORK_HINT
      },
      'The site stopped sending the video.': {
        message: 'The site stopped sending the video.',
        hint: 'Retry the download. If it keeps failing, update yt-dlp.'
      }
    }
  },
  'download-interrupted': {
    message: 'The download was interrupted.',
    hint: 'Retry. The part already downloaded is kept.'
  },
  'challenge-failed': {
    message: "The site's video protection could not be solved.",
    hint: UPDATE_HINT
  },
  'extractor-error': {
    message: "The site's page could not be read.",
    hint: UPDATE_HINT
  },
  'format-unavailable': {
    message: 'The chosen quality or format is not available for this video.',
    hint: 'Pick another quality or format and retry.'
  },
  'unsupported-url': {
    message: 'This link is not supported.',
    hint: 'Check the link. If the site should work, updating yt-dlp may help.'
  },
  'ffmpeg-missing': {
    message: 'The media tools that Vidaro needs are missing.',
    hint: 'Reinstall Vidaro and check that your antivirus did not quarantine ffmpeg.'
  },
  'postprocessing-failed': {
    message: 'Processing the downloaded file failed.',
    hint: 'Retry with the MKV container, or turn off the embedding options.'
  },
  'invalid-options': {
    message: 'The download options are not valid.',
    hint: 'Add the video again with other options.'
  },
  'output-missing': {
    message: 'The downloaded file could not be found.',
    hint: 'Retry the download. Antivirus software can remove or block new files.'
  },
  'write-failed': {
    message: 'Vidaro could not write the file.',
    hint: 'Check that the output folder exists, that the drive is connected, and that the file name is not too long.'
  },
  'no-js-runtime': {
    message: 'YouTube needs a JavaScript runtime that could not be used.',
    hint: 'Update yt-dlp and retry. If it keeps failing, reinstall Vidaro.'
  },

  'input-missing': {
    message: 'The source file could not be found.',
    hint: 'It may have been moved, renamed or deleted, or its drive is disconnected. Add it again or reconnect the drive.'
  },
  'input-unreadable': {
    message: 'The source file could not be read. It may be damaged or incomplete.',
    hint: 'Check that the file plays in a media player. If it is still being copied or downloaded, wait and retry.',
    variants: {
      'The source file could not be opened.': {
        message: 'The source file could not be opened.',
        hint: 'Close any program that is using the file, then retry. Antivirus software can also block it.'
      }
    }
  },
  'output-folder-missing': {
    message: 'The output folder is not available.',
    hint: 'Reconnect the drive or choose another output folder, then retry.'
  },
  'encoder-failed': {
    message: 'The video encoder could not start.',
    hint: 'Update the graphics driver, or switch hardware encoding to Software in Settings.',
    variants: {
      'The encoder did not accept these settings.': {
        message: 'The encoder did not accept these settings.',
        hint: 'Try another preset, or lower the quality or bitrate settings.'
      }
    }
  },
  'unsupported-codec': {
    message: 'This file uses a format Vidaro cannot decode.',
    hint: 'Try another copy of the file, or the Archive copy preset, which keeps the tracks as they are.'
  },
  'unsupported-copy': {
    message: 'A track cannot be copied into the chosen format.',
    hint: 'Choose MKV, or a preset that re-encodes the tracks.'
  },
  'verify-failed': {
    message: 'The converted file could not be checked.',
    hint: 'Retry. If it keeps failing, choose another output folder.'
  },
  'verify-duration': {
    message: 'The converted file does not have the expected length.',
    hint: 'Retry. If it happens again, the source may be damaged: try another preset or the Archive copy preset.'
  },
  'verify-streams': {
    message: 'The converted file is missing its video or audio.',
    hint: 'Retry, or try another preset.'
  },
  'invalid-job': {
    message: 'This job cannot run because its settings are damaged.',
    hint: 'Remove it and add the file again.'
  },
  'convert-failed': {
    message: 'The conversion failed.',
    hint: 'Retry. If it keeps failing, try another preset or check that the source file plays.'
  },
  'unsupported-container': {
    message: 'This output format is not supported.',
    hint: 'Pick another preset.'
  },
  'source-has-no-video': {
    message: 'This file has no video.',
    hint: 'Pick an audio preset, such as MP3 or WAV.'
  },
  'source-has-no-audio': {
    message: 'This file has no audio.',
    hint: 'Pick a video preset instead.'
  },
  'nothing-to-convert': {
    message: 'The preset keeps neither video nor audio from this file.',
    hint: 'Pick another preset.'
  },
  'video-copy-incompatible': {
    message: 'The video cannot be copied into this format.',
    hint: 'Choose MKV, or re-encode the video.'
  },
  'audio-copy-incompatible': {
    message: 'The audio cannot be copied into this format.',
    hint: 'Choose MKV, or re-encode the audio.'
  },
  'trim-invalid': {
    message: 'The trim range is outside the file.',
    hint: 'Check the start and end times.'
  },
  'pass-log-missing': {
    message: 'Two-pass encoding needs a temporary folder.',
    hint: 'Try again.'
  },

  warnings: {
    'hardware-fallback': 'The graphics encoder failed, so the file was encoded with the software encoder.',
    'encoder-unavailable': 'The chosen encoder is not available on this PC, so another one was used.',
    'encoder-mismatch': 'A different encoder than the one in the preset was used.',
    'encoder-container': 'The codec did not fit the chosen format, so a compatible one was used.',
    'audio-reencoded': 'The audio could not be copied, so it was re-encoded.',
    'sponsorblock-failed': 'SponsorBlock could not be reached, so sponsor segments were not removed.',
    'subtitles-failed': 'The subtitles could not be downloaded.',
    'no-subtitles': 'No subtitles were available in the chosen languages.',
    'thumbnail-failed': 'The thumbnail could not be added to the file.',
    'source-duration-unreliable': 'The source file reported a wrong duration. The converted file uses the real length.',
    'bitmap-subtitles': 'Picture-based subtitles could not be kept in this format.',
    'subtitles-dropped': 'Some subtitle tracks could not be kept in this format.',
    'two-pass-unavailable': 'Two-pass encoding is not available with this encoder, so one pass was used.',
    'trim-keyframes': 'The cut snapped to the nearest keyframes because the video was copied.',
    'copy-ignores-picture': 'Picture changes were skipped because the video was copied.',
    'ivtc-not-applicable': 'Inverse telecine was skipped because the video is not telecined.',
    'no-audio': 'The source has no audio, so the file has no sound.',
    'challenge-failed': "YouTube's protection was only partly solved. Some qualities may be missing.",
    'no-js-runtime': 'No JavaScript runtime was available. Some qualities may be missing.',
    'analysis-failed': 'The interlace check could not run, so the video was treated as the file describes itself.',
    'keep-date-failed': 'The original file date could not be copied to the new file.',
    'source-not-deleted': 'The original download could not be deleted after the conversion.',
    'skipped-existing': 'A file with this name already existed, so it was left untouched.'
  }
};
