# Codex Web UI

Web-Oberfläche für den Codex-CLI-Agenten auf dem Sascha-Lenovo Laptop.

## Status
- [x] Node.js Server (port 8080)
- [x] Codex App-Server Integration
- [x] SSE-Streaming (Ereignisse)
- [x] Thread-Management
- [x] Wissenssuche (über agent-memory MCP)
- [ ] Autostart (geplante Aufgabe)

## Start

### Manuell:
```
start-server.cmd
```
Dann öffnen Sie `http://127.0.0.1:8080` in Ihrem Browser.

### Automatischer Start:
```
start-server.cmd (als Admin)
```
Startet den Server als Hintergrund-Prozess.

## Struktur
- `server.mjs` - Node.js Server (keine npm-Abhängigkeiten)
- `public/` - Frontend (HTML, CSS, JS)
- `server.log` - Server-Protokoll

## API-Endpunkte
- `GET /api/health` - Status-Check
- `GET /api/events` - SSE-Stream (Ereignisse)
- `GET /api/models` - Liste der verfügbaren Modelle
- `GET /api/threads` - Liste der Threads
- `GET /api/threads/:id/turns` - Lade Thread-Turns
- `POST /api/threads` - Erstelle Thread + Turn
- `POST /api/approve` - Genehmige Freigabe
- `POST /api/interrupt` - Unterbreche Turn
- `GET /api/wissen?q=...` - Wissenssuche

## Anforderungen
- Node.js 22+ (vorinstalliert)
- Codex CLI 0.164+ (vorinstalliert)
- agent-memory MCP Server (100.71.9.93:8798)