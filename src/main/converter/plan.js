const { inputUrl, rateValue, rateLabel, channelLayoutLabel } = require('./media');
const filters = require('./filters');
const encoders = require('./encoders');

const CONTAINERS = Object.freeze({
  mp4: { muxer: 'mp4', extension: 'mp4', faststart: true, audioOnly: false, label: 'MP4' },
  mov: { muxer: 'mov', extension: 'mov', faststart: true, audioOnly: false, label: 'MOV' },
  mkv: { muxer: 'matroska', extension: 'mkv', faststart: false, audioOnly: false, label: 'MKV' },
  webm: { muxer: 'webm', extension: 'webm', faststart: false, audioOnly: false, label: 'WebM' },
  mp3: { muxer: 'mp3', extension: 'mp3', faststart: false, audioOnly: true, label: 'MP3' },
  m4a: { muxer: 'ipod', extension: 'm4a', faststart: true, audioOnly: true, label: 'M4A' },
  wav: { muxer: 'wav', extension: 'wav', faststart: false, audioOnly: true, label: 'WAV' },
  flac: { muxer: 'flac', extension: 'flac', faststart: false, audioOnly: true, label: 'FLAC' },
  opus: { muxer: 'opus', extension: 'opus', faststart: false, audioOnly: true, label: 'Opus' }
});

const GENPTS_CONTAINERS = new Set(['avi', 'mpeg', 'vob', 'dv', 'flv', 'asf', 'wmv', 'wma', 'rm', 'm2v', 'm4ves', 'h264', 'hevc']);
const DEEP_PROBE_CONTAINERS = new Set(['mpeg', 'vob', 'ts', 'm2ts']);
const ASYNC_AUDIO_CONTAINERS = new Set(['avi', 'flv', 'asf', 'wmv', 'rm']);
const PACKED_BFRAME_TAGS = new Set(['xvid', 'divx', 'dx50', 'div5', 'div6', 'dxgm', 'fmp4', '3iv2', '3ivx']);

const VIDEO_COPY = {
  mp4: new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4', 'mpeg2video', 'mpeg1video', 'mjpeg']),
  mov: new Set(['h264', 'hevc', 'prores', 'mpeg4', 'mjpeg', 'mpeg2video', 'mpeg1video', 'dnxhd', 'qtrle', 'png', 'av1', 'vp9']),
  webm: new Set(['vp8', 'vp9', 'av1'])
};

const AUDIO_COPY = {
  mp4: new Set(['aac', 'mp3', 'ac3', 'eac3', 'opus', 'flac', 'alac', 'mp2']),
  mov: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'mp2', 'flac', 'opus', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_s32be', 'pcm_f32le', 'pcm_u8', 'pcm_mulaw', 'pcm_alaw']),
  webm: new Set(['opus', 'vorbis']),
  mp3: new Set(['mp3']),
  m4a: new Set(['aac', 'alac', 'ac3', 'eac3']),
  wav: new Set(['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_u8', 'pcm_f32le', 'pcm_f64le', 'pcm_mulaw', 'pcm_alaw', 'adpcm_ms', 'adpcm_ima_wav']),
  flac: new Set(['flac']),
  opus: new Set(['opus'])
};

const MKV_COPY_DENY = new Set(['pcm_dvd', 'pcm_bluray', 'dvd_nav_packet', 'bin_data', 'adpcm_ima_qt']);
const MKV_SUBTITLE_COPY = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'dvd_subtitle', 'hdmv_pgs_subtitle', 'dvb_subtitle']);

const AUDIO_CODECS = {
  aac: { encoder: 'aac', maxChannels: 8, rates: [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000], label: 'AAC' },
  mp3: { encoder: 'libmp3lame', maxChannels: 2, rates: [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000], label: 'MP3' },
  opus: { encoder: 'libopus', maxChannels: 8, rates: [48000], label: 'Opus' },
  ac3: { encoder: 'ac3', maxChannels: 6, rates: [48000, 44100, 32000], label: 'AC-3' },
  pcm: { encoder: 'pcm_s16le', maxChannels: 8, rates: null, label: 'PCM' },
  flac: { encoder: 'flac', maxChannels: 8, rates: null, label: 'FLAC' },
  vorbis: { encoder: 'libvorbis', maxChannels: 8, rates: [48000, 44100], label: 'Vorbis' }
};

const AC3_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];
const LAME_VBR_KBPS = [245, 225, 190, 175, 165, 130, 115, 100, 85, 65];
const VIDEO_CODEC_LABELS = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
const LOUDNESS_LABELS = { ebu: 'EBU R128 −23 LUFS', atsc: 'ATSC A/85 −24 LKFS', streaming: 'Streaming −14 LUFS' };
const COPY_TRIM_SLACK = 10;
const PTS_ESTIMATE_SLACK = 1;
const RF64_THRESHOLD_BYTES = 2 ** 30;

const MESSAGES = {
  'unsupported-container': ['This output format is not supported.', 'Pick another preset.'],
  'source-has-no-video': ['This file has no video.', 'Pick an audio preset, such as MP3 or WAV.'],
  'source-has-no-audio': ['This file has no audio.', 'Pick a video preset instead.'],
  'nothing-to-convert': ['The preset keeps neither video nor audio from this file.', 'Pick another preset.'],
  'video-copy-incompatible': ['The video cannot be copied into this format.', 'Choose MKV, or re-encode the video.'],
  'audio-copy-incompatible': ['The audio cannot be copied into this format.', 'Choose MKV, or re-encode the audio.'],
  'trim-invalid': ['The trim range is outside the file.', 'Check the start and end times.'],
  'pass-log-missing': ['Two-pass encoding needs a temporary folder.', 'Try again.']
};

function planError(code, detail = null) {
  const [message, hint] = MESSAGES[code] || ['This conversion is not possible.', null];
  return { code, message, hint, action: null, retryable: false, detail };
}

function containerSpec(preset) {
  return CONTAINERS[preset && preset.container] || null;
}

function isAudioOnlyOutput(preset) {
  const spec = containerSpec(preset);
  return Boolean(spec) && (spec.audioOnly || preset.video.mode === 'none');
}

function outputExtension(preset) {
  const spec = containerSpec(preset);
  if (!spec) return null;
  if (preset.container === 'mkv' && preset.video.mode === 'none') return 'mka';
  return spec.extension;
}

function muxerFor(preset) {
  const spec = containerSpec(preset);
  return spec ? spec.muxer : null;
}

function formatSeconds(value) {
  return String(Number(Math.max(0, value).toFixed(3)));
}

function normalizeTrim(trim, duration) {
  if (!trim) return { trim: null };
  const start = Math.max(0, Number(trim.start) || 0);
  let end = trim.end === null || trim.end === undefined || trim.end === '' ? null : Number(trim.end);
  if (end !== null && !Number.isFinite(end)) end = null;
  if (duration > 0) {
    if (start >= duration) return { error: 'trim-invalid' };
    if (end !== null && end >= duration) end = null;
  }
  if (end !== null && end <= start) return { error: 'trim-invalid' };
  if (start === 0 && end === null) return { trim: null };
  const length = end !== null ? end - start : duration > 0 ? duration - start : null;
  return { trim: { start, end, length } };
}

function selectAudio(media, preset) {
  if (preset.audio.mode === 'none' || media.audio.length === 0) return [];
  if (preset.audio.tracks === 'all' && !containerSpec(preset).audioOnly) return media.audio.slice();
  const preferred = media.audio.find((track) => track.isDefault);
  return [preferred || media.audio[0]];
}

function mappedDuration(media, streams) {
  const known = streams.filter((stream) => stream && stream.duration > 0 && Number.isFinite(stream.startTime));
  if (streams.length === 0 || known.length !== streams.length) return media.duration || null;
  const start = Math.min(...known.map((stream) => stream.startTime));
  const end = Math.max(...known.map((stream) => stream.startTime + stream.duration));
  const span = end - start;
  if (media.duration > 0 && span > media.duration + 0.5) return media.duration;
  return span > 0 ? span : media.duration || null;
}

function nearestAllowed(rate, allowed) {
  if (!allowed) return rate;
  if (allowed.includes(rate)) return rate;
  if (allowed.includes(48000)) return 48000;
  return allowed[0];
}

function targetSampleRate(track, audio, codecInfo) {
  const wanted = audio.sampleRate === 'keep' || !audio.sampleRate ? track.sampleRate || 48000 : Number(audio.sampleRate);
  return nearestAllowed(wanted, codecInfo.rates);
}

function targetChannels(track, audio, codecInfo) {
  let channels = track.channels || 2;
  if (audio.channels === 'stereo') channels = 2;
  else if (audio.channels === 'mono') channels = 1;
  if (channels > codecInfo.maxChannels) channels = codecInfo.maxChannels === 6 ? 6 : 2;
  return channels;
}

function bitrateRange(codec, channels) {
  const count = Math.max(1, channels || 2);
  if (codec === 'opus') return { min: 6, max: 256 * count };
  if (codec === 'vorbis') return { min: { 1: 32, 2: 45, 6: 84 }[count] || 32 * count, max: count === 2 ? 500 : 240 * count };
  if (codec === 'ac3') return { min: count > 2 ? 192 : 32, max: 640 };
  return { min: 32, max: Infinity };
}

function clampBitrate(codec, bitrate, channels) {
  const range = bitrateRange(codec, channels);
  return Math.min(range.max, Math.max(range.min, bitrate));
}

function audioBitrateArgs(codec, audio, index, channels) {
  const bitrate = clampBitrate(codec, Math.max(32, Number(audio.bitrate) || 192), channels);
  if (codec === 'mp3' && Number(audio.vbr) > 0) return [`-q:a:${index}`, String(Math.min(9, Number(audio.vbr) - 1))];
  if (codec === 'ac3') {
    const snapped = AC3_BITRATES.reduce((best, value) => (Math.abs(value - bitrate) < Math.abs(best - bitrate) ? value : best));
    return [`-b:a:${index}`, `${snapped}k`];
  }
  if (codec === 'pcm' || codec === 'flac') return [];
  if (codec === 'opus') return [`-b:a:${index}`, `${Math.min(510, bitrate)}k`, `-vbr:a:${index}`, 'on'];
  return [`-b:a:${index}`, `${bitrate}k`];
}

function subtitleCodecFor(container, track) {
  if (container === 'mp4' || container === 'mov') {
    if (!track.textBased) return null;
    return track.codec === 'mov_text' ? 'copy' : 'mov_text';
  }
  if (container === 'mkv') {
    if (MKV_SUBTITLE_COPY.has(track.codec)) return 'copy';
    return track.textBased ? 'srt' : null;
  }
  if (container === 'webm') {
    if (!track.textBased) return null;
    return track.codec === 'webvtt' ? 'copy' : 'webvtt';
  }
  return null;
}

function canCopyVideo(container, video) {
  if (container === 'mkv') return !MKV_COPY_DENY.has(video.codec);
  const allowed = VIDEO_COPY[container];
  return Boolean(allowed) && allowed.has(video.codec);
}

function canCopyAudio(container, track) {
  if (container === 'mkv') return !MKV_COPY_DENY.has(track.codec);
  const allowed = AUDIO_COPY[container];
  return Boolean(allowed) && allowed.has(track.codec);
}

function needsUnpack(video, container) {
  return video.codec === 'mpeg4' && ['mp4', 'mov', 'mkv'].includes(container) && PACKED_BFRAME_TAGS.has(String(video.codecTag || '').toLowerCase());
}

function pictureChanges(picture) {
  if (!picture) return false;
  const crop = picture.crop || {};
  return (
    picture.resolution !== 'keep' ||
    picture.fps !== 'keep' ||
    picture.deinterlace === 'on' ||
    picture.ivtc === 'on' ||
    Number(picture.rotate) !== 0 ||
    Boolean(picture.flipH || picture.flipV) ||
    Boolean(crop.top || crop.bottom || crop.left || crop.right)
  );
}

function inputArgs(media, { trim, logLevel = 'error' }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-nostats', '-loglevel', logLevel, '-progress', 'pipe:1'];
  if (GENPTS_CONTAINERS.has(media.container)) args.push('-fflags', '+genpts');
  if (DEEP_PROBE_CONTAINERS.has(media.container)) args.push('-analyzeduration', '100M', '-probesize', '100M');
  if (trim && trim.start > 0) args.push('-ss', formatSeconds(trim.start));
  args.push('-i', inputUrl(media.path));
  if (trim && trim.end !== null) args.push('-t', formatSeconds(trim.end - trim.start));
  return args;
}

function videoPlan(media, preset, encoderName, analysis, warnings) {
  const picture = preset.picture || {};
  const codec = preset.video.codec;
  let name = encoderName && encoders.codecOf(encoderName) === codec ? encoderName : encoders.SOFTWARE[codec];
  if (encoderName && name !== encoderName) warnings.push('encoder-mismatch');
  if (!encoders.supportsContainer(name, preset.container)) {
    name = encoders.SOFTWARE[codec];
    warnings.push('encoder-container');
  }
  const tenBit = media.video.bitDepth > 8 && encoders.supportsTenBit(name);
  const interlace = filters.interlaceDecision(media, picture, analysis);
  warnings.push(...interlace.warnings);
  const size = filters.planSize(media, picture);
  const rate = filters.rateDecision(media, picture, interlace);
  const color = filters.colorDecision(media, picture, size, { codec, tenBit });
  const pixFmt = encoders.pixFmtFor(name, tenBit && !color.tonemap);
  const chain = filters.buildVideoFilters({ picture, size, interlace, rate, color, pixFmt });
  return { name, tenBit: tenBit && !color.tonemap, interlace, size, rate, color, pixFmt, chain };
}

function videoArgs(plan, preset, container, pass, passLogFile) {
  const args = ['-filter:v:0', plan.chain.join(',')];
  const fps = rateValue(plan.rate.rate) || 30;
  args.push(...encoders.encoderArgs(plan.name, preset.video, { fps, vfr: plan.rate.passthrough, tenBit: plan.tenBit }));
  if (plan.rate.filter) args.push('-fps_mode:v:0', 'cfr');
  else if (plan.rate.passthrough) args.push('-fps_mode:v:0', 'passthrough');
  args.push(...filters.colorOutputArgs(plan.color));
  if (preset.video.codec === 'hevc' && (container === 'mp4' || container === 'mov')) args.push('-tag:v:0', 'hvc1');
  if (pass) args.push('-pass', String(pass), '-passlogfile', passLogFile);
  return args;
}

function audioTrackPlan(track, audio, media, loudness) {
  const codecInfo = AUDIO_CODECS[audio.codec] || AUDIO_CODECS.aac;
  const encoder = codecInfo.encoder;
  const sampleRate = targetSampleRate(track, audio, codecInfo);
  const channels = targetChannels(track, audio, codecInfo);
  const measured = loudness && Object.hasOwn(loudness, track.index) ? loudness[track.index] : null;
  const wantsLoudness = Boolean(filters.LOUDNESS_TARGETS[audio.loudness]);
  const silent = Boolean(measured && measured.silent);
  const target = wantsLoudness && !silent ? audio.loudness : 'off';
  const chain = filters.buildAudioFilters({
    volumeDb: audio.volumeDb,
    loudness: target,
    measured: measured && !silent ? measured : null,
    sampleRate,
    channels,
    sourceChannels: track.channels,
    codec: encoder,
    asyncFix: ASYNC_AUDIO_CONTAINERS.has(media.container)
  });
  const layoutPinned = chain.some((item) => item.startsWith('aformat=channel_layouts='));
  const forceChannels = !layoutPinned && (!track.channels || channels !== track.channels);
  return {
    track,
    codec: audio.codec,
    encoder,
    sampleRate,
    channels,
    forceChannels,
    chain,
    loudness: target,
    measured: Boolean(measured && !silent),
    needsScan: wantsLoudness && !measured,
    settings: audio
  };
}

function audioArgs(plans, preset) {
  const args = [];
  plans.forEach((plan, index) => {
    if (plan.copy) {
      args.push(`-c:a:${index}`, 'copy');
      return;
    }
    if (plan.chain.length) args.push(`-filter:a:${index}`, plan.chain.join(','));
    args.push(`-c:a:${index}`, plan.encoder);
    args.push(...audioBitrateArgs(plan.codec, plan.settings, index, plan.channels));
    args.push(`-ar:a:${index}`, String(plan.sampleRate));
    if (plan.forceChannels) args.push(`-ac:a:${index}`, String(plan.channels));
  });
  return args;
}

function pcmBytesPerSecond(plan) {
  if (plan.copy) {
    const { track } = plan;
    return (track.sampleRate || 48000) * (track.channels || 2) * Math.ceil((track.bitDepth || 16) / 8);
  }
  return plan.sampleRate * plan.channels * 2;
}

function needsRf64(audioPlans, duration) {
  if (!(duration > 0)) return true;
  const bytesPerSecond = audioPlans.reduce((sum, plan) => sum + pcmBytesPerSecond(plan), 0);
  return bytesPerSecond * duration >= RF64_THRESHOLD_BYTES;
}

function roundTime(value) {
  return value === null || value === undefined ? null : Math.round(value * 1e6) / 1e6;
}

function expectedFor(media, videoOut, audioTracks, trim) {
  const streams = [...(videoOut ? [media.video] : []), ...audioTracks];
  const base = mappedDuration(media, streams);
  if (!trim) return roundTime(base);
  const remaining = base ? Math.max(0, base - trim.start) : null;
  if (trim.length === null) return roundTime(remaining);
  return roundTime(remaining === null ? trim.length : Math.min(trim.length, remaining));
}

function durationSlackFor(media, videoMode, cut, expectedDuration) {
  if (videoMode === 'copy' && cut) return COPY_TRIM_SLACK;
  if (!DEEP_PROBE_CONTAINERS.has(media.container)) return 0;
  const endFromSource = !cut || cut.end === null || !(expectedDuration >= cut.length - 1e-6);
  return endFromSource ? PTS_ESTIMATE_SLACK : 0;
}

function buildPlan({ media, preset, encoder = null, outputPath, format = null, trim = null, analysis = null, loudness = null, pass = null, passLogFile = null }) {
  const warnings = [];
  const errors = [];
  const spec = containerSpec(preset);
  const fail = (code, detail) => {
    errors.push(planError(code, detail));
    return { args: null, errors, warnings, expectedDuration: null, durationSlack: 0, steps: [], summary: null, expect: null, twoPass: false };
  };
  if (!spec) return fail('unsupported-container', preset && preset.container);
  const container = preset.container;
  const wantVideo = !spec.audioOnly && preset.video.mode !== 'none';
  const wantAudio = preset.audio.mode !== 'none';
  if (!wantVideo && !wantAudio) return fail('nothing-to-convert');
  if (wantVideo && !media.video) return fail('source-has-no-video');
  const audioTracks = wantAudio ? selectAudio(media, preset) : [];
  if (!wantVideo && audioTracks.length === 0) return fail('source-has-no-audio');
  if (wantAudio && audioTracks.length === 0) warnings.push('no-audio');
  const trimResult = normalizeTrim(trim, media.durationReliable ? media.duration : null);
  if (trimResult.error) return fail(trimResult.error);
  const cut = trimResult.trim;

  const videoMode = wantVideo ? preset.video.mode : 'none';
  if (videoMode === 'copy' && !canCopyVideo(container, media.video)) return fail('video-copy-incompatible', media.video.codec);
  const audioMode = preset.audio.mode;
  const reencodeAudio = { ...preset.audio, mode: 'encode', loudness: 'off', volumeDb: 0 };
  const twoPass = videoMode === 'encode' && preset.video.rateControl === 'bitrate' && Boolean(preset.video.twoPass);
  let video = null;
  if (videoMode === 'encode') {
    video = videoPlan(media, preset, encoder, analysis, warnings);
    if (twoPass && !encoders.supportsTwoPass(video.name)) warnings.push('two-pass-unavailable');
  }
  const useTwoPass = twoPass && video && encoders.supportsTwoPass(video.name);
  if (pass && !useTwoPass) pass = null;
  if (pass && !passLogFile) return fail('pass-log-missing');

  if (videoMode === 'copy') {
    if (cut) warnings.push('trim-keyframes');
    if (pictureChanges(preset.picture)) warnings.push('copy-ignores-picture');
  }

  const audioPlans = audioTracks.map((track) => {
    if (audioMode !== 'copy') return audioTrackPlan(track, preset.audio, media, loudness);
    if (canCopyAudio(container, track)) return { track, copy: true, codec: track.codec, needsScan: false };
    warnings.push('audio-reencoded');
    return { ...audioTrackPlan(track, reencodeAudio, media, null), reencoded: true };
  });

  const subtitles = [];
  if (wantVideo && preset.subtitles === 'keep') {
    let dropped = false;
    for (const track of media.subtitles) {
      const codec = subtitleCodecFor(container, track);
      if (codec) subtitles.push({ track, codec });
      else dropped = true;
    }
    if (dropped) warnings.push('subtitles-dropped');
  }

  const passOne = pass === 1;
  const expectedDuration = expectedFor(media, wantVideo, audioTracks, cut);
  const args = inputArgs(media, { trim: cut });
  if (wantVideo) args.push('-map', `0:${media.video.index}`);
  if (!passOne) {
    for (const plan of audioPlans) args.push('-map', `0:${plan.track.index}`);
    for (const item of subtitles) args.push('-map', `0:${item.track.index}`);
    args.push('-map_metadata', '0', '-map_chapters', '0');
  } else {
    args.push('-map_metadata', '-1', '-map_chapters', '-1');
  }
  args.push('-dn', '-max_muxing_queue_size', '9999');
  if (videoMode === 'copy' || GENPTS_CONTAINERS.has(media.container)) args.push('-avoid_negative_ts', 'make_zero');

  if (videoMode === 'encode') args.push(...videoArgs(video, preset, container, pass, passLogFile));
  else if (videoMode === 'copy') {
    args.push('-c:v:0', 'copy');
    if (needsUnpack(media.video, container)) args.push('-bsf:v:0', 'mpeg4_unpack_bframes');
    if (media.video.codec === 'hevc' && (container === 'mp4' || container === 'mov')) args.push('-tag:v:0', 'hvc1');
  } else args.push('-vn');

  if (passOne || audioPlans.length === 0) args.push('-an');
  else args.push(...audioArgs(audioPlans, preset));

  if (passOne || subtitles.length === 0) args.push('-sn');
  else subtitles.forEach((item, index) => args.push(`-c:s:${index}`, item.codec));

  if (passOne) {
    args.push('-f', 'null', 'NUL');
  } else {
    if (container === 'mp3') args.push('-id3v2_version', '3');
    if (container === 'wav' && needsRf64(audioPlans, media.durationReliable ? expectedDuration : null)) args.push('-rf64', 'auto');
    if (spec.faststart && preset.output && preset.output.faststart) args.push('-movflags', '+faststart');
    args.push('-f', format || spec.muxer, `file:${outputPath}`);
  }

  const steps = [];
  for (const plan of audioPlans) {
    if (plan.needsScan) steps.push({ type: 'loudness-scan', streamIndex: plan.track.index, target: preset.audio.loudness });
  }
  if (useTwoPass) steps.push({ type: 'pass', pass: 1 }, { type: 'encode', pass: 2 });
  else steps.push({ type: 'encode', pass: null });

  const summary = {
    container,
    extension: outputExtension(preset),
    muxer: format || spec.muxer,
    video: summarizeVideo(videoMode, video, media, preset),
    audio: audioPlans.map(summarizeAudio),
    subtitles: subtitles.map((item) => ({ index: item.track.index, codec: item.codec }))
  };
  const expect = {
    video: wantVideo,
    audio: audioPlans.length > 0,
    width: video ? video.size.width : videoMode === 'copy' ? media.video.width : null,
    height: video ? video.size.height : videoMode === 'copy' ? media.video.height : null,
    fps: video && video.rate.rate ? video.rate.rate : null,
    progressive: video ? video.interlace.mode !== 'none' || video.interlace.order === 'progressive' : null
  };
  return {
    args,
    errors,
    warnings: [...new Set(warnings)],
    expectedDuration,
    durationSlack: durationSlackFor(media, videoMode, cut, expectedDuration),
    steps,
    twoPass: Boolean(useTwoPass),
    summary,
    expect
  };
}

function summarizeVideo(mode, plan, media, preset) {
  if (mode === 'none') return null;
  if (mode === 'copy') {
    return { mode, codec: media.video.codec, codecLabel: media.video.codecLabel, width: media.video.width, height: media.video.height, fps: media.video.fps };
  }
  return {
    mode,
    codec: preset.video.codec,
    codecLabel: VIDEO_CODEC_LABELS[preset.video.codec],
    encoder: plan.name,
    encoderLabel: encoders.label(plan.name),
    hardware: encoders.isHardware(plan.name),
    width: plan.size.width,
    height: plan.size.height,
    padded: Boolean(plan.size.pad),
    cropped: Boolean(plan.size.fill),
    squarePixels: plan.size.anamorphic && plan.size.sar.num === plan.size.sar.den,
    fps: plan.rate.rate,
    fpsLabel: plan.rate.rate ? rateLabel(plan.rate.rate) : null,
    constantRate: !plan.rate.passthrough,
    interlace: plan.interlace.mode,
    fieldRate: plan.interlace.fieldRate,
    colorConvert: plan.color.convert,
    tonemap: plan.color.tonemap,
    color: plan.color.out,
    pixFmt: plan.pixFmt,
    bitDepth: plan.tenBit ? 10 : 8
  };
}

function summarizeAudio(plan) {
  if (plan.copy) return { index: plan.track.index, mode: 'copy', codec: plan.track.codec, codecLabel: plan.track.codecLabel };
  return {
    index: plan.track.index,
    mode: 'encode',
    codec: plan.codec,
    codecLabel: AUDIO_CODECS[plan.codec].label,
    encoder: plan.encoder,
    bitrate: ['pcm', 'flac'].includes(plan.codec) ? null : clampBitrate(plan.codec, Math.max(32, Number(plan.settings.bitrate) || 192), plan.channels),
    vbr: plan.codec === 'mp3' && Number(plan.settings.vbr) > 0 ? Number(plan.settings.vbr) - 1 : null,
    sampleRate: plan.sampleRate,
    channels: plan.channels,
    loudness: plan.loudness,
    twoPassLoudness: plan.measured,
    reencoded: Boolean(plan.reencoded)
  };
}

function loudnessScanArgs({ media, preset, streamIndex, trim = null }) {
  const track = media.audio.find((item) => item.index === streamIndex) || media.audio[0];
  if (!track) return null;
  const target = filters.LOUDNESS_TARGETS[preset.audio.loudness] ? preset.audio.loudness : 'ebu';
  const codecInfo = AUDIO_CODECS[preset.audio.codec] || AUDIO_CODECS.aac;
  const channels = targetChannels(track, preset.audio, codecInfo);
  const { trim: cut } = normalizeTrim(trim, media.durationReliable ? media.duration : null);
  const chain = [];
  if (channels !== track.channels && channels <= 2) chain.push(`aformat=channel_layouts=${channels === 1 ? 'mono' : 'stereo'}`);
  chain.push(filters.loudnormFilter(target, null, { printJson: true }));
  const args = inputArgs(media, { trim: cut || null, logLevel: 'info' });
  args.push('-map', `0:${track.index}`, '-vn', '-sn', '-dn', '-filter:a:0', chain.join(','), '-f', 'null', 'NUL');
  return args;
}

function parseLoudnorm(lines) {
  const list = Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/);
  let collecting = false;
  let seen = false;
  let buffer = [];
  let result = null;
  for (const raw of list) {
    const line = String(raw).trim();
    if (/Parsed_loudnorm/.test(line)) {
      seen = true;
      collecting = false;
      buffer = [];
      const inline = line.indexOf('{');
      if (inline >= 0) {
        collecting = true;
        buffer.push(line.slice(inline));
        if (line.endsWith('}')) {
          result = readLoudnorm(buffer.join('\n')) || result;
          collecting = false;
        }
      }
      continue;
    }
    if (!seen) continue;
    if (!collecting && line === '{') {
      collecting = true;
      buffer = ['{'];
      continue;
    }
    if (collecting) {
      buffer.push(line);
      if (line === '}') {
        result = readLoudnorm(buffer.join('\n')) || result;
        collecting = false;
      }
    }
  }
  return result;
}

function readLoudnorm(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const value = (key) => {
    const number = Number(data[key]);
    return Number.isFinite(number) ? number : null;
  };
  const measurement = {
    inputI: value('input_i'),
    inputTp: value('input_tp'),
    inputLra: value('input_lra'),
    inputThresh: value('input_thresh'),
    targetOffset: value('target_offset')
  };
  if (!('input_i' in data)) return null;
  const silent = measurement.inputI === null || measurement.inputI <= -70 || measurement.inputThresh === null || measurement.inputTp === null;
  return {
    ...measurement,
    inputLra: measurement.inputLra === null ? 0 : measurement.inputLra,
    targetOffset: measurement.targetOffset === null ? 0 : measurement.targetOffset,
    silent
  };
}

function bitsPerPixel(quality, codec, pixels) {
  const base = 0.1 * 2 ** ((20 - quality) / 6);
  const codecFactor = { h264: 1, hevc: 0.65, av1: 0.55, vp9: 0.7 }[codec] || 1;
  return base * codecFactor * (2073600 / Math.max(1, pixels)) ** 0.25;
}

function sourceVideoBitrate(media) {
  if (!media.video) return null;
  if (media.video.bitrate) return media.video.bitrate;
  if (!media.bitrate) return null;
  const audio = media.audio.reduce((sum, track) => sum + (track.bitrate || 0), 0);
  return Math.max(0, media.bitrate - audio) || null;
}

function estimateVideoBits(plan, preset, media) {
  const video = plan.summary.video;
  if (!video) return 0;
  if (video.mode === 'copy') return sourceVideoBitrate(media) || 0;
  if (preset.video.rateControl === 'bitrate') return (Number(preset.video.bitrate) || 0) * 1000;
  const pixels = video.width * video.height;
  const fps = video.fps ? rateValue(video.fps) : 30;
  let bits = bitsPerPixel(Number(preset.video.quality) || 23, video.codec, pixels) * pixels * fps;
  if (Number(preset.video.maxrate) > 0) bits = Math.min(bits, Number(preset.video.maxrate) * 1000);
  const source = sourceVideoBitrate(media);
  const sourcePixels = media.video.width * media.video.height;
  if (source && pixels <= sourcePixels * 1.05) bits = Math.min(bits, source * 1.3);
  return bits;
}

function estimateAudioBits(item, track) {
  if (item.mode === 'copy') return track.bitrate || 192000;
  if (item.codec === 'pcm') return item.sampleRate * item.channels * 16;
  if (item.codec === 'flac') return item.sampleRate * item.channels * 16 * 0.55;
  if (item.vbr !== null && item.vbr !== undefined) return (LAME_VBR_KBPS[item.vbr] || 190) * 1000;
  return (item.bitrate || 192) * 1000;
}

function audioLine(item) {
  if (item.mode === 'copy') return `Audio copy (${item.codecLabel})`;
  const parts = [item.codecLabel];
  if (item.vbr !== null && item.vbr !== undefined) parts.push(`VBR V${item.vbr}`);
  else if (item.bitrate) parts.push(`${item.bitrate} kbps`);
  parts.push(`${Number((item.sampleRate / 1000).toFixed(1))} kHz`);
  parts.push(channelLayoutLabel(item.channels, null));
  if (item.loudness !== 'off') parts.push(LOUDNESS_LABELS[item.loudness]);
  return parts.join(' · ');
}

function videoLines(video) {
  if (!video) return [];
  if (video.mode === 'copy') return [`Video copy · ${video.codecLabel} · ${video.width}x${video.height}`];
  const first = [`${video.width}x${video.height}`];
  if (video.fpsLabel) first.push(`${video.fpsLabel} fps`);
  first.push(video.codecLabel);
  if (video.bitDepth > 8) first.push('10-bit');
  const steps = [];
  if (video.interlace === 'ivtc') steps.push('Inverse telecine');
  if (video.interlace === 'deinterlace') steps.push(video.fieldRate ? 'Deinterlace (double rate)' : 'Deinterlace');
  if (video.squarePixels) steps.push('Square pixels');
  if (video.padded) steps.push('Padded');
  if (video.cropped) steps.push('Cropped to fill');
  if (!video.constantRate) steps.push('Variable frame rate kept');
  if (video.colorConvert) steps.push('BT.601 → BT.709');
  if (video.tonemap) steps.push('HDR → SDR');
  return steps.length ? [first.join(' · '), steps.join(' · ')] : [first.join(' · ')];
}

function describe(preset, media, { trim = null, analysis = null, encoder = null } = {}) {
  const plan = buildPlan({ media, preset, encoder, outputPath: 'output', trim, analysis });
  if (plan.errors.length) return { lines: plan.errors.map((error) => error.message), estimateBytes: null, errors: plan.errors, warnings: plan.warnings };
  const lines = [...videoLines(plan.summary.video)];
  if (plan.summary.video === null && !isAudioOnlyOutput(preset)) lines.push('No video');
  if (plan.summary.audio.length === 0) lines.push('No audio');
  const audioText = plan.summary.audio.map(audioLine);
  if (audioText.length > 1 && new Set(audioText).size === 1) lines.push(`${audioText[0]} · ${audioText.length} tracks`);
  else lines.push(...audioText);
  if (plan.summary.subtitles.length) lines.push(plan.summary.subtitles.length === 1 ? '1 subtitle track' : `${plan.summary.subtitles.length} subtitle tracks`);
  let estimateBytes = null;
  if (plan.expectedDuration > 0) {
    const videoBits = estimateVideoBits(plan, preset, media);
    const audioBits = plan.summary.audio.reduce((sum, item) => sum + estimateAudioBits(item, media.audio.find((track) => track.index === item.index) || {}), 0);
    estimateBytes = Math.round(((videoBits + audioBits) * plan.expectedDuration * 1.015) / 8);
  }
  return { lines, estimateBytes, errors: [], warnings: plan.warnings };
}

module.exports = {
  CONTAINERS,
  buildPlan,
  loudnessScanArgs,
  parseLoudnorm,
  describe,
  outputExtension,
  muxerFor,
  isAudioOnlyOutput,
  canCopyVideo,
  canCopyAudio,
  subtitleCodecFor,
  normalizeTrim
};
