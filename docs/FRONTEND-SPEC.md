# FRONTEND-SPEC — Codex Web UI (Lenovo)

Stand: 2026-11-12, Version 1.2.0 · Server: `http://100.68.210.112:8080` · Code: `C:\Users\Neu\codex-web`
Look: OpenCode-V2 (Tokens aus `packages/ui/styles/tokens` des OpenCode-Repos), eigenes Frontend, kein Build.

**Wichtig:** Der Server ist **ohne Codex-Abo** lauffähig. Die Codex-App-Server-Anbindung ist entfernt.
Der Codex-Provider ist nur noch eine optionale Stufe in der Provider-Kette (siehe 3.).

---

## 1. Zielbild

Dunkle 3-Spalten-Desktop-App wie OpenCode/Hermes:

```
┌──────────────┬────────────────────────────────┬──────────────────┐
│ LINK         │ MITTE                           │ RECHTS (Tabs)    │
│ Neue Session │ Kopfzeile (Provider, Modell)   │ Wissen           │
│ Suche        │ Chat-Verlauf                    │ Rowboat          │
│ Sessions     │                                │ Werkzeuge        │
│  ├ Heute     │ Composer (Pille)               │ Provider         │
│  ├ Gestern    │ [Agent-Modus] [Stopp] [Senden] │                  │
├──────────────┴────────────────────────────────┴──────────────────┤
│ Statusleiste: Provider · Modell · Wissen · Rowboat · Version      │
└───────────────────────────────────────────────────────────────────┘
```

Unter 1180 px wird die rechte Spalte zum Overlay (Taste `W`), unter 860 px auch die linke (Taste `S`).
Der Chat bleibt immer nutzbar, das Eingabefeld immer sichtbar.

---

## 2. Technische Vorgaben

- **Kein Build-Step, kein Framework, kein npm.** `public/index.html`, `public/app.js`, `public/style.css`.
- Keine CDNs, keine Webfonts aus dem Netz. Sprache Deutsch.
- Tastaturbedienung, `aria-label` an Icon-Buttons, Kontrast ≥ 4.5:1, `prefers-reduced-motion` respektiert.
- **Niemals `innerHTML` mit API-Inhalten** — immer `textContent`.
- Farbwechsler: Button in der Kopfleiste, `document.documentElement.dataset.theme = 'dark' | 'light'`,
  Auswahl in `localStorage` unter `cx.theme`. Vor dem ersten Malen setzen (Inline-Skript im `<head>`),
  damit nichts flackert.

---

## 3. Provider-Kette

| Tier | Provider | Anmerkung |
|---|---|---|
| 1 | **FreeLLMAPI** | lokal auf dem Homeserver, ohne Kosten, immer zuerst |
| 2 | **OpenRouter** | 369 Modelle, Fallback wenn FreeLLMAPI nicht liefert |
| 3 | **Codex (Abo)** | nur mit eigenem ChatGPT-Konto, im Regelfall `ready: false` |

`provider: "auto"` = FreeLLMAPI, bei Fehler OpenRouter. Provider und Modell sichtbar in der Kopfleiste
und in der Statusleiste anzeigen („FreeLLMAPI · Qwen3.5-9B").

---

## 4. API-Vertrag

Basis `http://<host>:8080`, alles JSON (UTF-8).

### 4.1 `GET /api/info`
```json
{ "name": "Codex Web UI", "version": "1.2.0", "host": "Sascha-Lenovo",
  "urls": { "local": "http://127.0.0.1:8080", "tailscale": "http://100.68.210.112:8080" },
  "stationUrl": "https://central.sascha-kruss.de/main/",
  "vaultBase": "https://files.sascha-kruss.de/files/srv/root/Second-Brain",
  "memory": { "host": "100.71.9.93", "port": "8798" }, "startedAt": 1794482501009 }
```

### 4.2 `GET /api/health`
```json
{ "ok": true, "memory": "ok", "memoryError": null, "memoryLastOk": 1794482501009,
  "plugins": 1, "sessions": 2, "uptime": 804 }
```
`memory`: `ok` | `error` | `init`. Pollintervall 5 s.

### 4.3 `GET /api/providers`
```json
{ "providers": [
  { "id": "free", "name": "FreeLLMAPI", "tier": 1, "engine": "openai-compatible",
    "baseUrl": "http://100.87.246.36:11434/v1", "needsAuth": false, "ready": true, "hasKey": true, "keyCount": 1 },
  { "id": "openrouter", "name": "OpenRouter", "tier": 2, "engine": "openai-compatible",
    "baseUrl": "https://openrouter.ai/api/v1", "needsAuth": true, "ready": true, "hasKey": true, "keyCount": 2 },
  { "id": "codex", "name": "Codex (Abo)", "tier": 3, "engine": "codex-app-server",
    "needsAuth": true, "ready": false, "reason": "Nicht angemeldet - codex login auf dem Lenovo noetig" }
], "primary": "free", "fallback": ["free", "openrouter"], "count": 3 }
```

### 4.4 `GET /api/models?provider=free|openrouter`
```json
{ "provider": "openrouter", "models": [{ "id": "deepseek/deepseek-v4.1-flash", "name": "...", "context": 1048576, "free": false }], "count": 369 }
```

### 4.5 `POST /api/chat` — Chats (ohne Abo)
Request: `{ "provider": "auto", "model": null, "prompt": "Hallo", "messages": null, "temperature": 0.4, "maxTokens": 2000, "stream": true }`
`messages` hat Vorrang vor `prompt`.

Antwort ohne `stream`:
```json
{ "answer": "Hallo!", "provider": "free", "providerName": "FreeLLMAPI", "model": "Qwen3.5-9B-Q4_K_M.gguf", "usage": { "total_tokens": 12 } }
```

Antwort mit `stream: true` (HTTP 200, `text/event-stream`):
```
data: {"type":"chatStart","provider":"auto","model":null}
data: {"type":"delta","provider":"free","text":"Hallo"}
data: {"type":"done","provider":"free","model":"Qwen3.5-9B-Q4_K_M.gguf","answer":"Hallo!"}
data: {"type":"providerError","provider":"free","error":"..."}
data: {"type":"error","error":"Kein Provider erreichbar"}
```

### 4.6 `POST /api/chat` mit `"agent": true` — der Agent arbeitet
Zusätzliche SSE-Ereignisse:
```
data: {"type":"toolStart","tool":"read_file","args":{"path":"C:\\..."}}
data: {"type":"toolEnd","tool":"read_file","ok":true,"result":{...}}
data: {"type":"done","provider":"free","model":"...","answer":"...","tools":[{"tool":"read_file","ok":true}],"iterations":2}
```

Werkzeuge des Agenten (`GET /api/tools` liefert die Liste):
`read_file`, `list_dir`, `write_file`, `run_command`, `search_wissen`, `search_rowboat`,
`write_briefing`, `start_task` sowie alle Werkzeuge aus installierten Plugins.

**Freigabe-Ablauf** (für `write_file`, `run_command`, `write_briefing`, `start_task` und Plugin-Werkzeuge
mit `approval: true`):
1. Server sendet `data: {"type":"approval","id":"harness-1","method":"harness/tool","params":{"tool":"run_command","args":{...},"reason":"Befehl: ..."}}`
2. UI zeigt den Grund **sichtbar über dem Eingabefeld** und fragt nach
3. Antwort: `POST /api/approve` mit `{"id":"harness-1","decision":"accept"}` (oder `decline`)
4. Server führt aus und meldet `toolEnd`. Ohne Antwort nach 10 Minuten: automatisch abgelehnt.

### 4.7 Sessions (eigener Store, kein Codex)
| Route | Methode | Body | Wirkung |
|---|---|---|---|
| `/api/sessions` | GET | | `{ "sessions": [...], "count": n }` |
| `/api/sessions` | POST | `{ "name", "model", "provider" }` | Session anlegen |
| `/api/sessions/{id}` | GET | | ganze Session mit `messages[]` |
| `/api/sessions/{id}/messages` | POST | `{ "role", "content" }` | Nachricht anhängen |
| `/api/sessions/{id}/rename` | POST | `{ "name" }` | umbenennen |
| `/api/sessions/{id}/archive` | POST | `{}` | archivieren |
| `/api/sessions/{id}/delete` | POST | `{}` | löschen |

Session-Objekt: `{ "id", "name", "title", "preview", "model", "provider", "createdAt", "updatedAt", "archived" }` (Unix-Sekunden).

### 4.8 Wissen (agent-memory MCP, inkl. Vault und Rowboat-Mails)
`GET /api/wissen?q=<begriff>&limit=8&project=`
```json
{ "results": [
  { "path": "10-wissen/gedaechtnis/central-station/2026-11-04_0722_...md",
    "url": "https://files.sascha-kruss.de/files/srv/root/Second-Brain/10-wissen/...",
    "title": "Central Station Finalisierung", "snippet": "Erste 280 Zeichen...", "text": "Volltext",
    "project": "central-station", "category": "architecture", "author": "rowboat",
    "tags": "[finalisierung, tools]", "created": "2026-11-04 07:22", "score": 0.0387 }
], "count": 6, "query": "central-station", "project": "", "stationUrl": "https://central.sascha-kruss.de/main/" }
```
`score` ist ein Ähnlichkeitswert 0–1, **kleiner = besser**. Nicht als Prozent anzeigen.

### 4.9 Rowboat (alle Funktionen des Hüters des Wissens)
| Route | Methode | Inhalt |
|---|---|---|
| `/api/rowboat/overview` | GET | `{ "connected": true, "health": {...}, "counts": {...}, "topLevel": [...], "files": [...], "meetings": [...], "people": [...], "projects": [...], "mails": [...], "mailCount": 300 }` |
| `/api/rowboat/search?q=&limit=` | GET | Rowboat-Wissen aus dem Index (`rowboat/...`) |
| `/api/rowboat/note?path=` | GET | eine Notiz vollständig |
| `/api/rowboat/briefing` | POST | `{ "title", "text" }` → Briefing-Markdown ins Vault, Pfad + Link zurück |
| `/api/rowboat/task` | POST | `{ "agent": "codex\|claude\|opencode", "prompt" }` → Task starten (mit Freigabe) |

Funktionen dahinter: Wissen sammeln (Mails/Meetings/Personen/Projekte), Kontext liefern (MCP),
Gespräche sichern (`POST /api/memory`), Briefings schreiben, Orchestrieren (Task), Überblick (Karten).

### 4.10 Werkzeuge, Skills, Plugins, Dateien
- `GET /api/skills` → `{ "skills": [{ "id", "name", "description", "path" }], "count": 300 }`
- `GET /api/mcp` → `{ "servers": [...], "memory": { "status": "ok" }, "count": 3 }`
- `GET /api/plugins` → `{ "plugins": [{ "id", "name", "description", "version", "tools": [...] }], "count": 1 }`
- `POST /api/plugins/reload` → Plugins neu einlesen
- `GET /api/tools` → alle Werkzeuge, die das Modell sieht
- `GET /api/fs?path=` → `{ "path", "entries": [{ "name", "path", "kind", "size" }], "count" }`
- `GET /api/fs/file?path=` → `{ "path", "content", "encoding" }`
- `POST /api/memory` → `{ "content", "title", "category", "project" }` — Wissen dauerhaft ablegen

### 4.11 `GET /api/events` — SSE
`text/event-stream`, alle 15 s `: ping` (hält die Verbindung über Mobilfunk offen).
Ereignisse: `connected`, `chatStart`, `delta`, `done`, `providerError`, `error`,
`approval`, `toolStart`, `toolEnd`. Bei `onerror`: 3 s warten, neu verbinden.

---

## 5. Design-Tokens

| Rolle | Dunkel | Hell |
|---|---|---|
| App-Hintergrund | `#161616` | `#fafafa` |
| Panel | `#242424` | `#ffffff` |
| Spalte tiefer | `#2e2e2e` | `#f2f2f2` |
| Text primär | `#f2f2f2` | `#161616` |
| Text gedämpft | `#aeaeae` | `#5c5c5c` |
| Akzent | `#3b5cf6` | `#3b5cf6` |
| Erfolg | `#6bd586` | `#6bd586` |
| Warnung | `#f2cf76` | `#f2cf76` |
| Fehler | `#f17471` | `#f17471` |

Typografie: System-UI-Stack. Größen: Kopfzeile 13,5 px, Titel 13,5 px/600, Meta 11–12 px.
Radien: 4/6/10 px, Pills 999 px. Rahmen: `rgba(0,0,0,.10)`, dünn.

---

## 6. Verhalten

- `Enter` sendet, `Shift+Enter` neue Zeile. Textarea wächst mit (max. 30 % Fensterhöhe).
- **Der Standardweg ist `POST /api/chat` mit `provider: "auto"`** — kein Codex, kein Abo.
- **Agent-Modus** (Schalter über dem Eingabefeld): `"agent": true`. Das Modell arbeitet dann selbst
  und fragt bei Schreib-/Ausführungsaktionen nach. Der Freigabe-Block gehört **sichtbar über dem Eingabefeld**.
- Session wird nach jeder Antwort automatisch angelegt bzw. fortgeschrieben (`POST /api/sessions/{id}/messages`).
- Wissen-Suche: `Enter` oder 400 ms Debounce. Treffer als Karte mit Titel, Autor, Datum, Kategorie,
  „In Vault öffnen"-Link; Klick zeigt den Volltext.
- Rowboat-Tab: Karten (Mails, Wissensordner, Notizen, Verbindung), Briefing-Formular, Task-Formular,
  Listen für Ordner, Mails, Meetings, Personen, Projekte.
- Tastatur: `Strg+K` neue Session, `Strg+/` Wissenssuche, `S` links, `W` rechts, `Esc` schließen.

---

## 7. Handy

`http://100.68.210.112:8080` (Tailscale aktiv). Unter 860 px: Chat volle Breite, Spalten als Overlays.
Touch-Ziele ≥ 44 px, Eingabefeld bleibt sichtbar, kein `user-scalable=no`, kein `hover` als einzige Information.

---

## 8. Abnahmekriterien

1. Kein Konsolenfehler, kein horizontaler Scrollbalken zwischen 900 und 1440 px.
2. Frage senden → Antwort streamt live (`delta`) und final (`done`); Session erscheint links.
3. Provider und Modell sichtbar und umschaltbar; Wissen, Rowboat, Werkzeuge, Provider erreichbar.
4. Wissen-Suche liefert Treffer mit Volltext und Vault-Link.
5. Rowboat-Tab zeigt Mails, Ordner, Meetings, Personen, Projekte und die Verbindungsart.
6. Briefing-Formular legt eine Datei im Vault ab und meldet den Pfad.
7. Agent-Modus: Werkzeugaufrufe erscheinen als Chips; Schreibbefehle lösen eine Freigabe aus, die
   mit einem Klick freigegeben wird und dann wirklich ausgeführt wird.
8. Farbwechsler hell/dunkel funktioniert und bleibt nach dem Neuladen erhalten.
9. Handy (390 px) bedienbar.

---

## 9. Bekannte Stolperstellen

- Der lokale FreeLLMAPI (Qwen3.5-9B) bevorzugt `run_command` gegenüber Plugin-Werkzeugen. Für präzise
  Werkzeugnutzung ein stärkeres Modell wählen (z. B. DeepSeek über OpenRouter).
- Umlaute in manchen Vault-Titeln kommen als Ersatzzeichen (`Ǭ` statt `ü`) — Datenqualität, nicht UI.
- `/api/threads` (Codex) existiert nicht mehr — Sessions laufen über `/api/sessions`.
