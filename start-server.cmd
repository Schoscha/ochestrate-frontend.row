@echo off
REM ===================================================================
REM  Codex Web UI - Startskript (Autostart via Registry HKCU Run)
REM  Startet den Server nur, wenn Port 8080 wirklich frei ist.
REM  Verstecktes Fenster, Logs getrennt, node laeuft abgekoppelt weiter.
REM ===================================================================
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo === Codex Web UI Server ===
echo.

REM --- 1) Laeuft auf Port 8080 schon etwas? (Socket-Test, unabhaengig von der Systemsprache) ---
powershell -NoProfile -Command "$c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',8080); exit 0 } catch { exit 1 } finally { $c.Close() }"
if "%ERRORLEVEL%"=="0" (
    echo Port 8080 ist belegt - kein zweiter Start.
    powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 5).Content } catch { 'keine Antwort - bitte Port pruefen' }"
    exit /b 0
)

REM --- 2) Server abgekoppelt und versteckt starten ---
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server.mjs','--trace-uncaught','--unhandled-rejections=strict' -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0server.log' -RedirectStandardError '%~dp0server.err.log' -WindowStyle Hidden"

echo Server gestartet, warte auf Health-Check...

REM --- 3) Bereitschaft pruefen (max 15 Sekunden) ---
set READY=nein
for /l %%i in (1,1,15) do (
    if "!READY!"=="nein" (
        powershell -NoProfile -Command "Start-Sleep -Seconds 1" >nul 2>&1
        powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
        if !ERRORLEVEL! EQU 0 set READY=ja
    )
)

if "!READY!"=="ja" (
    echo OK - laeuft auf http://127.0.0.1:8080
    powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 5).Content } catch { '' }"
) else (
    echo WARNUNG - Server antwortet nach 15s nicht. Siehe server.log und server.err.log
)

REM Kein pause: haelt beim Autostart das Fenster offen.
endlocal
