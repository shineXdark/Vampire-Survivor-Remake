@echo off
title Void Survivors - Network Fix
echo.
echo  ============================================
echo   VOID SURVIVORS - LAN Network Fix
echo  ============================================
echo.
echo  This will:
echo   1. Set your network profile to Private
echo   2. Open port 3000 in Windows Firewall
echo   3. Allow Node.js through the firewall
echo.
echo  Run this as Administrator if prompted.
echo.

REM Set all connected networks to Private
powershell -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private" 2>nul

REM Open port 3000 TCP inbound
netsh advfirewall firewall delete rule name="VoidSurvivors-3000" >nul 2>&1
netsh advfirewall firewall add rule name="VoidSurvivors-3000" protocol=TCP dir=in localport=3000 action=allow
netsh advfirewall firewall add rule name="VoidSurvivors-3000-out" protocol=TCP dir=out localport=3000 action=allow

REM Allow node.exe through firewall (common install paths)
netsh advfirewall firewall delete rule name="NodeJS-VoidSurvivors" >nul 2>&1
netsh advfirewall firewall add rule name="NodeJS-VoidSurvivors" program="%ProgramFiles%\nodejs\node.exe" action=allow dir=in
netsh advfirewall firewall add rule name="NodeJS-VoidSurvivors-x86" program="%ProgramFiles(x86)%\nodejs\node.exe" action=allow dir=in 2>nul

echo.
echo  Done! Your LAN IP address is:
powershell -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.InterfaceAlias -notlike '*VMware*' -and $_.InterfaceAlias -notlike '*VirtualBox*' }).IPAddress"
echo.
echo  Share the above IP with your friends like:
echo  http://YOUR_IP:3000
echo.
echo  Now run: npm start
echo  Or double-click: start-game.bat
echo.
pause
