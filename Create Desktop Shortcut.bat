@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Expense Tracker.lnk'); $s.TargetPath='%~dp0Start Expense Tracker.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%SystemRoot%\System32\imageres.dll,109'; $s.Save()"
echo   A shortcut called "Expense Tracker" was added to your desktop.
pause
