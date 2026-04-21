@echo off
title Void Survivors
cd /d "%~dp0"

echo.
echo ======================================
echo   VOID SURVIVORS v3.3.0
echo ======================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Check server.js
if not exist "server.js" (
    echo ERROR: server.js not found in this folder.
    echo Make sure all game files are in the same folder as this bat file.
    echo.
    pause
    exit /b 1
)

:: Check index.html
if not exist "index.html" (
    if not exist "public\index.html" (
        echo ERROR: index.html not found.
        echo Make sure index.html is in the same folder as server.js.
        echo.
        pause
        exit /b 1
    )
)

:: Install dependencies if missing
if not exist "node_modules" (
    echo Installing dependencies, please wait...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed.
        echo Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed OK.
    echo.
)

echo Starting server...
echo Your browser will open automatically.
echo.
echo To stop the server: close this window or press Ctrl+C
echo.

node server.js

echo.
echo Server stopped.
pause
