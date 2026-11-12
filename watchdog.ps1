# ---------------------------------------------------------------
#  Watchdog fuer den Codex Web UI Server
#  Haelt den Server am Leben: prueft alle 30 Sekunden den Health-
#  Endpoint und startet den Server neu, wenn er nicht antwortet.
#  Laeuft versteckt, einmal pro Anmeldung (Mutex).
# ---------------------------------------------------------------
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'watchdog.log'

function Log([string]$m) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
    Add-Content -Path $log -Value $line -Encoding UTF8
}

# Nur eine Instanz
$mutex = New-Object System.Threading.Mutex($false, 'Local\CodexWebUIWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }

Log 'Watchdog gestartet'
# Startschutz erst nach dem ersten Lauf: der Server soll sofort starten duerfen
$lastStart = (Get-Date).AddSeconds(-120)

while ($true) {
    $healthy = $false
    try {
        $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/api/health' -TimeoutSec 8
        $healthy = ($r.StatusCode -eq 200)
    } catch { $healthy = $false }

    if (-not $healthy) {
        # Port belegt, aber kein Health? Dann laeuft etwas anderes - nicht eingreifen.
        $portBusy = $false
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $c.Connect('127.0.0.1', 8080)
            $portBusy = $true
            $c.Close()
        } catch { $portBusy = $false }

        if ($portBusy) {
            Log 'Port 8080 belegt, aber Health antwortet nicht - kein Eingriff'
        } elseif (((Get-Date) - $lastStart).TotalSeconds -lt 60) {
            Log 'Server nicht erreichbar - warte (Startschutz 60s)'
        } else {
            Log 'Server nicht erreichbar - starte neu'
            $lastStart = Get-Date
            Start-Process -FilePath 'node' `
                -ArgumentList 'server.mjs', '--trace-uncaught', '--unhandled-rejections=strict' `
                -WorkingDirectory $dir `
                -RedirectStandardOutput (Join-Path $dir 'server.log') `
                -RedirectStandardError (Join-Path $dir 'server.err.log') `
                -WindowStyle Hidden
            Start-Sleep -Seconds 10
            try {
                $r2 = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/api/health' -TimeoutSec 8
                Log ('Neustart erfolgreich, Health ' + $r2.StatusCode)
            } catch {
                Log 'Neustart nicht erreichbar - versuche es spaeter erneut'
            }
        }
    }

    Start-Sleep -Seconds 30
}
