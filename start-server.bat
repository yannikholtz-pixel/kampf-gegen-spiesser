@echo off
chcp 65001 >nul
title Spiel-Server
cd /d "%~dp0"
echo.
echo Spiel-Server laeuft. Fenster offen lassen!
echo Stoppen: dieses Fenster schliessen.
echo.
"C:\Program Files\nodejs\node.exe" server.js
echo.
echo Server wurde beendet.
pause
