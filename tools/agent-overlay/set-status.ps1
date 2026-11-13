# Schreibt den Agenten-Status fuer das Overlay (Herzschlag)
param(
  [string]$State = 'work',   # work | idle
  [string]$Text = 'arbeitet',
  [string]$Agent = 'opencode'
)
$dir = Join-Path $env:USERPROFILE '.agent'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@{
  state = $State
  text  = $Text
  agent = $Agent
  ts    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $dir 'status.json') -Encoding UTF8
