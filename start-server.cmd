@echo off
REM ===================================================================
REM  Codex Web UI - Startskript (Autostart via Registry HKCU Run)
REM  Startet den Watchdog. Der Watchdog startet den Server und startet
REM  ihn neu, wenn er ausfaellt. Doppelstart verhindert der Watchdog
REM  selbst (Mutex). Keine verschachtelten Anfuehrungszeichen in
REM  cmd - die stoeren den Parser.
REM ===================================================================
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo === Codex Web UI Server ===
echo.

REM --- 1) Watchdog versteckt starten (eigene Konsole, ueberlebt das Login-Fenster) ---
echo Starte Watchdog ...
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0watchdog.ps1' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

REM --- 2) Health pruefen (max 30 Sekunden) ---
echo Warte auf Health-Check ...
set READY=nein
for /l %%i in (1,1,30) do (
    if "!READY!"=="nein" (
        ping -n 2 127.0.0.1 >nul
        powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
        if !ERRORLEVEL! EQU 0 set READY=ja
    )
)

REM --- 3) Notfall: Watchdog hat nicht gestartet -> Server direkt starten ---
if "!READY!"=="nein" (
    echo Watchdog hat nicht durchgestartet - starte Server direkt ...
    powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server.mjs','--trace-uncaught','--unhandled-rejections=strict' -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0server.log' -RedirectStandardError '%~dp0server.err.log' -WindowStyle Hidden"
    ping -n 6 127.0.0.1 >nul
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 5; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if !ERRORLEVEL! EQU 0 set READY=ja
)

if "!READY!"=="ja" (
    echo OK - laeuft auf http://127.0.0.1:8080
    powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/health -TimeoutSec 5).Content } catch { '' }"
) else (
    echo WARNUNG - Server antwortet nicht. Siehe server.log, server.err.log und watchdog.log
)

REM Kein pause: haelt beim Autostart das Fenster offen.
endlocal
