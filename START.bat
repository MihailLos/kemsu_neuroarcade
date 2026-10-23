@echo off
cd /d "%~dp0"
if not exist "assets\vision_bundle.mjs" (
  echo Для игры с камерой сначала запустите SETUP_ASSETS.ps1 при наличии интернета.
  echo Играть мышью можно и без распознавания руки.
  pause
)
start "" "http://localhost:8767"
where py >nul 2>nul
if %errorlevel%==0 (py -3 server.py) else (python server.py)
pause
