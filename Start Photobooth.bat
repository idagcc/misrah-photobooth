@echo off
cd /d "%~dp0"
if exist "runtime\python.exe" (
  "runtime\python.exe" server.py %*
  goto done
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 server.py %*
) else (
  python server.py %*
)
:done
pause
