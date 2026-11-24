@echo off
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  "%LOCALAPPDATA%\Programs\nodejs\node.exe" %*
  exit /b %ERRORLEVEL%
)
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
  set ELECTRON_RUN_AS_NODE=1
  "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" %*
  exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\Antigravity\Antigravity.exe" (
  set ELECTRON_RUN_AS_NODE=1
  "%ProgramFiles%\Antigravity\Antigravity.exe" %*
  exit /b %ERRORLEVEL%
)
echo [error] Node.js runtime not found >&2
exit /b 1
