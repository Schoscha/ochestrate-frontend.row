@echo off
REM Startet den Codex Web UI Server als Hintergrund-Prozess
REM Verwendung: Doppelklick auf start-server.cmd

cd /d "%~dp0"

echo.
echo === Codex Web UI Server (Autostart) ===
echo.
echo Starte Node.js Server im Hintergrund...
echo Port: 8080
echo.

REM Starte den Server als Hintergrund-Prozess
start /b node server.mjs > server.log 2>&1

REM Warte kurz, bis der Server hochgefahren ist
timeout /t 3 /nobreak >nul

REM Prüfe, ob der Server läuft
tasklist /FI "IMAGENAME eq node.exe" /FO CSV 2>nul | find /i "node.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo Server gestartet!
    echo.
    echo Oeffnen Sie http://127.0.0.1:8080 in Ihrem Browser
) else (
    echo FEHLER: Server nicht gestartet!
    echo Pruefen Sie server.log
)

pause