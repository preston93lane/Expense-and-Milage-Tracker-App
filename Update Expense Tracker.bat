@echo off
setlocal
cd /d "%~dp0"
echo.
echo   Updating Expense Tracker. Your data is stored separately and is not touched.
echo.
if exist .git (
  git pull --ff-only
  if errorlevel 1 (
    echo   Could not update automatically. Download the latest ZIP from GitHub instead.
    pause
    exit /b 1
  )
) else (
  echo   This copy was not installed with Git. Download the latest ZIP from GitHub,
  echo   unzip it over this folder, then start the app as usual.
  pause
  exit /b 0
)
node scripts\prepare.mjs
echo.
echo   Done. Start the app with "Start Expense Tracker.bat".
pause
