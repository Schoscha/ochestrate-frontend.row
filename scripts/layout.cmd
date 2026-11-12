@echo off
REM ===================================================================
REM  Layout der Codex Web UI setzen (Leisten und Terminal-Aufteilung)
REM  Aufruf:  scripts\layout.cmd [raster] [leiste ...]
REM  Beispiele:
REM    scripts\layout.cmd 2x2 terminal wissen werkzeuge
REM    scripts\layout.cmd 1x1
REM    scripts\layout.cmd -            (nur Raster aendern)
REM  Ohne Argument: aktuelles Layout anzeigen
REM ===================================================================
setlocal
set API=http://127.0.0.1:8080

if "%~1"=="" goto show

set CX_GRID=%~1
set CX_A2=%~2
set CX_A3=%~3
set CX_A4=%~4
set CX_A5=%~5
set CX_A6=%~6
set CX_A7=%~7
set CX_A8=%~8
set CX_A9=%~9

powershell -NoProfile -Command ^
  "$b = @{};" ^
  "if ($env:CX_GRID -and $env:CX_GRID -ne '-') { $b['grid'] = $env:CX_GRID };" ^
  "$raw = @($env:CX_A2,$env:CX_A3,$env:CX_A4,$env:CX_A5,$env:CX_A6,$env:CX_A7,$env:CX_A8,$env:CX_A9) -join ' ';" ^
  "$p = @($raw -split '[, ]+' | Where-Object { $_ -ne '' });" ^
  "if ($p.Count -gt 0) { $b['panels'] = $p };" ^
  "try {" ^
  "  $r = Invoke-RestMethod -Uri ($env:API + '/api/layout') -Method Post -ContentType 'application/json' -Body ($b | ConvertTo-Json -Depth 4);" ^
  "  Write-Host ('Raster: ' + $r.grid + '   Leisten: ' + ($r.panels -join ', '));" ^
  "} catch { Write-Host ('Fehler: ' + $_.Exception.Message) }"

goto :eof

:show
powershell -NoProfile -Command ^
  "try { $r = Invoke-RestMethod -Uri ($env:API + '/api/layout');" ^
  "  Write-Host ('Raster: ' + $r.grid);" ^
  "  Write-Host ('Leisten: ' + ($r.panels -join ', ')); }" ^
  "catch { Write-Host ('Fehler: ' + $_.Exception.Message) }"

endlocal
