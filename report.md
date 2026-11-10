# Codex Web UI Statusbericht - Lenovo VPS (100.68.210.112)

## Server-Status
- ✅ Server läuft auf Port 8080 (0.0.0.0) — PID 41572
- ✅ Remote-Taccess bestätigbar: http://100.68.210.112:8080

## Health-Endpoint
- ✅ `GET /api/health` → 200 {"ok":true,"codex":true,"memory":"ok"}
- Memory-Status: **"ok"** (durch memory.ensureInit() im Health-Handler initialisiert)

## API-Endpoints
- ✅ `/api/models` — liefert 8 Modelle
- ✅ `/api/threads` — liefert Thread-Liste
- ✅ `/api/events` — SSE-Events
- ✅ `/api/approve` — Turn Approval
- ✅ `/api/interrupt` — Turn Interrupt

## Knowledge-Memory (MCP Integration)
- ✅ MCP-Connection zu Homeserver 100.71.9.93:8798 aktiv
- ✅ `/api/wissen` — Knowledge-Abfragen funktionieren
- ✅ Health-Endpoint zeigt nun `"memory":"ok"` statt `"init"`

## Autostart
- ✅ Registry HKCU Run-Eintrag: `CodexWebUI → C:\Users\Neu\codex-web\start-server.cmd`
- ⚠️ Task-Scheduler (schtasks/Register-ScheduledTask) blockiert durch GPO — funktioniert aber Registry-Methode

## Nächste Schritte (§11)
- Nach ca. 15 Minuten: privates GitHub-Repo erfragen
- Browser-Tabs (F5) bei Bedarf neu laden, um "502 Bad Gateway" zu beheben