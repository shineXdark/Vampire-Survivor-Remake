@echo off
title Kill Void Survivors Server
echo.
echo  Killing any process on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo  Found process PID: %%a — terminating...
    taskkill /PID %%a /F >nul 2>&1
    echo  Done.
)
echo  Port 3000 is now free.
echo  You can now start the server again.
echo.
pause
