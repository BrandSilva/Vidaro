<p align="center">
  <img src="brand/logo-512.png" width="112" alt="Vidaro logo">
</p>

<h1 align="center">Vidaro</h1>

<p align="center">Download and convert video on Windows, in one clean app.</p>

---

Vidaro saves videos and music from links, and turns any media file into one that plays everywhere. Paste a link from YouTube or one of the hundreds of other sites supported by yt-dlp, name the file however you want, and pick the quality. Or drop in an old AVI, a DV tape capture or an NTSC/PAL SD file and get a clean MP4 or MP3.

> **Status:** Vidaro is in active development. Version 1.0.0 will be published on the [Releases](https://github.com/TridentSky/Vidaro/releases) page.

## Features

### Downloader
- Paste a link and preview the title, channel, duration and thumbnail before downloading
- **Choose the file name**: type it, or use a template such as *Channel - Title* or *Date - Title*
- Video + audio, video only or audio only (MP3, M4A, Opus, WAV, FLAC), in any available quality up to 4K
- A *Compatible* mode that prefers MP4 (H.264 + AAC), so files play on any TV, phone or editor
- Playlists and channels, with the items you want selected
- Subtitles, embedded thumbnails, metadata and chapters, time ranges, speed limit, cookies for private content
- A queue with pause, resume, cancel and retry
- The download engine updates itself, so sites keep working without reinstalling Vidaro

### Converter
- See what a file really contains: codec, resolution, aspect ratio, frame rate, interlacing, audio format
- Convert AVI, MKV, MOV, WMV, FLV, MPEG, TS, DV, VOB and more to MP4, MKV, MOV or WebM
- Extract or convert audio to MP3, M4A, WAV, FLAC or Opus
- Choose resolution, frame rate, bitrate or quality, codec and audio settings, or just pick a preset
- Made for archive material: deinterlacing, inverse telecine, correct 4:3 and 16:9 handling, SD to HD color conversion and loudness normalization
- Uses the graphics card when there is one (Intel Quick Sync, NVIDIA NVENC, AMD AMF)
- Save your own presets and share them as files
- Convert automatically after a download

### App
- Dark, compact interface built for the keyboard, with customizable shortcuts
- Nothing is lost when you close it: the queue is saved and interrupted jobs can be resumed
- Discreet in-app update notices, never a popup
- Clean installation and uninstallation

## Install

Once version 1.0.0 is released:

1. Download **Vidaro-Setup.exe** from [Releases](https://github.com/TridentSky/Vidaro/releases/latest)
2. Run it. Windows may show **"Windows protected your PC"** because the app is not code-signed yet: click **More info**, then **Run anyway**
3. Choose whether to install Vidaro only for you (no administrator rights needed) or for all users

Everything Vidaro needs is included. There is nothing else to install.

**Requirements:** Windows 10 or Windows 11, 64-bit.

## Build from source

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run fetch-binaries
START.bat
```

`npm run fetch-binaries` downloads `yt-dlp.exe`, `ffmpeg.exe` and `ffprobe.exe` into `bin/`. They are not stored in the repository.

To build the installer:

```
npm run dist
```

The installer is written to `Installer/Vidaro-Setup.exe`.

### Project structure

```
Vidaro/
├── src/main/      Main process: queue, downloader, converter, settings, updates
├── src/preload/   The safe bridge between the app window and the main process
├── src/renderer/  User interface (React)
├── build/         Installer resources and build scripts
├── brand/         Logo sources
├── bin/           yt-dlp, FFmpeg (not included in the repository)
└── START.bat      Development launcher
```

## Responsible use

Vidaro is a tool. Only download content you own, content that is in the public domain or under a license that allows it, or content you have permission to download. Respect the terms of service of each website and the copyright laws of your country.

## Built With

- [Electron](https://www.electronjs.org) and [React](https://react.dev) — desktop app
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — downloads ([Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE))
- [FFmpeg](https://ffmpeg.org) — conversion and media analysis ([GPL](https://ffmpeg.org/legal.html))
- Developed with [Claude Code](https://claude.com/claude-code)

## License

MIT License — see [LICENSE](LICENSE) for details.

yt-dlp and FFmpeg are independent projects with their own licenses. Their license texts are installed next to their executables.
