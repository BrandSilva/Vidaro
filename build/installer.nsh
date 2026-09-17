!include "getProcessInfo.nsh"
Var pid

!macro vidaroStopTools
  ${if} $IsPowerShellAvailable == 0
    nsExec::ExecToStack `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dirs = @((Join-Path $$env:LOCALAPPDATA 'Vidaro\bin\'), (Join-Path '$INSTDIR' 'resources\bin\')); Get-CimInstance Win32_Process | Where-Object { @('yt-dlp.exe','ffmpeg.exe','ffprobe.exe') -contains $$_.Name -and $$_.ExecutablePath } | ForEach-Object { $$p = $$_; foreach ($$d in $$dirs) { if ($$p.ExecutablePath.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $$p.ProcessId -Force -ErrorAction SilentlyContinue; break } } }"`
    Pop $R8
    Pop $R9
  ${endIf}
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !insertmacro vidaroStopTools
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    RMDir /r "$LOCALAPPDATA\Vidaro"
    RMDir /r "$TEMP\Vidaro Crashes"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.tridentsky.vidaro"
    DeleteRegKey /ifempty HKCU "Software\TridentSky"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\TridentSky"
  ${endIf}
!macroend
