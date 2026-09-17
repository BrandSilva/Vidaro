@echo off
setlocal EnableExtensions
title Vidaro (development)
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Get it from https://nodejs.org
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Installed:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" goto install
if not exist "node_modules\electron\package.json" goto install
if not exist "node_modules\react\package.json" goto install
goto binaries

:install
echo Installing dependencies...
call npm install --cache "%TEMP%\vidaro-npm-cache" --no-audit --no-fund
if errorlevel 1 (
  pause
  exit /b 1
)

:binaries
if not exist "bin\ffmpeg.exe" goto fetch
if not exist "bin\ffprobe.exe" goto fetch
if not exist "bin\yt-dlp.exe" goto fetch
goto electron

:fetch
echo The bundled tools (yt-dlp, FFmpeg) are missing from bin\.
choice /c YN /m "Download them now (about 130 MB)"
if errorlevel 2 exit /b 1
call npm run fetch-binaries
if errorlevel 1 (
  pause
  exit /b 1
)

:electron
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron...
  node node_modules\electron\install.js
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node build\dev.js %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%
