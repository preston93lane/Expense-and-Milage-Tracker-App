@echo off
setlocal
title Expense ^& Mileage Tracker
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed yet.
  echo   Opening nodejs.org - install the "LTS" version, then double-click this file again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

node scripts\prepare.mjs
if errorlevel 1 (
  echo.
  echo   Setup did not finish. See the messages above.
  pause
  exit /b 1
)

call npm run serve --silent
echo.
echo   Expense Tracker has stopped.
pause
