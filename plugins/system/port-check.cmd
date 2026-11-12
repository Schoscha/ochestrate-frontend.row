@echo off
REM Prueft, ob ein TCP-Port auf 127.0.0.1 offen ist
REM Aufruf: port-check.cmd <port>
setlocal
set PORT=%1
powershell -NoProfile -Command "$c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %PORT%); 'Port %PORT% ist offen' } catch { 'Port %PORT% ist geschlossen' } finally { $c.Close() }"
endlocal
