# FRONTEND-SPEC — Codex Web UI (Lenovo)

Stand: 2026-11-10, Version 1.1.0 · Server: `http://100.68.210.112:8080` · Code: `C:\Users\Neu\codex-web`

Dieses Dokument ist der **eingefrorene Vertrag**. Wer das Frontend baut, arbeitet **ausschließlich** in `public/`.
`server.mjs`, `providers.mjs` und `local-inventory.mjs` werden nicht angefasst. Bei API-Abweichungen: melden, nicht ändern.

---

## 1. Zielbild

Desktop-App-Layout mit drei Spalten, dunkel, wie Hermes Desktop / OpenCode Desktop / Central Station:

```
┌──────────────┬────────────────────────────────┬──────────────────┐
│ LINK         │ MITTE                           │ RECHTS           │
│ Logo         │ Kopfzeile (Status, Modell)     │ Wissen-Suche     │
│ Neue Session │ Chat-Verlauf                    │ Trefferliste     │
│ Sessions     │                                │ Provider/Modell  │
│  ├ Heute     │ Eingabefeld                     │ Werkzeuge (MCP)  │
│  ├ Gestern    │ [Senden] [Steer] [Interrupt]   │ Dateien (Baum)   │
│ Angepinnt   │                                │ Skills           │
│ Werkzeuge    │                                │ Ausgaben/Status  │
├──────────────┴────────────────────────────────┴──────────────────┤
│ Statusleiste: Codex-Status · Wissen · Provider · Version · Uptime│
└───────────────────────────────────────────────────────────────────┘
```

Referenzbilder: Hermes Desktop (linke Session-Liste, mittig Chat, rechte Werkzeugspalte),
OpenCode Desktop (linke Chat-Liste, rechts Umgebung/Konnektoren/Ausgaben).

Unter 1200 px Breite wird die rechte Spalte zu einem aufklappbaren Panel (Taste `W`).
Unter 900 px wird die linke Spalte einklappbar (Taste `S`). Der Chat bleibt immer nutzbar.

---

## 2. Technische Vorgaben

- **Kein Build-Step, kein Framework, kein npm.** Reine Dateien in `public/`: `index.html`, `app.js`, `style.css`.
- ES2020, kein Modul-Bundler. Optional `type="module"` für `app.js`.
- Keine externen CDNs, keine Webfonts aus dem Netz (Offline-Fähigkeit auf dem Lenovo).
- Keine Secrets, keine Tokens im Frontend. Alle Daten kommen über `/api/*` auf demselben Host.
- Sprache der Oberfläche: **Deutsch**.
- Barrierefreiheit: Tastaturbedienung, `aria-label` an allen Icon-Buttons, Kontrast ≥ 4.5:1, `prefers-reduced-motion` respektiert.

---

## 3. Provider-Kette (wichtig)

Es gibt **keine Abhängigkeit von einem Codex-Abo**. Die Reihenfolge ist fest:

| Tier | Provider | Anmerkung |
|---|---|---|
| 1 | **FreeLLMAPI** | lokal auf dem Homeserver, ohne Kosten, immer zuerst |
| 2 | **OpenRouter** | günstig, 400+ Modelle, Fallback wenn FreeLLMAPI nicht liefert |
| 3 | **Codex (Abo)** | nur wenn Sascha sich angemeldet hat, sonst `ready: false` |

`provider: "auto"` nimmt immer FreeLLMAPI und fällt bei Fehler auf OpenRouter zurück.
Die UI soll den Provider sichtbar machen (Kopfzeile oder Statusleiste): „FreeLLMAPI · Qwen3.5-9B".

---

## 4. API-Vertrag (eingefroren)

Basis: `http://<host>:8080`. Alle Antworten JSON, Charset UTF-8.

### 4.1 `GET /api/info`

```json
{
  "name": "Codex Web UI",
  "version": "1.1.0",
  "host": "Sascha-Lenovo",
  "urls": { "local": "http://127.0.0.1:8080", "tailscale": "http://100.68.210.112:8080" },
  "stationUrl": "https://central.sascha-kruss.de/main/",
  "vaultBase": "https://files.sascha-kruss.de/files/srv/root/Second-Brain",
  "memory": { "host": "100.71.9.93", "port": "8798" },
  "providerOrder": [{ "id": "free", "name": "FreeLLMAPI", "tier": 1 }, { "id": "openrouter", "name": "OpenRouter", "tier": 2 }, { "id": "codex", "name": "Codex (Abo)", "tier": 3 }],
  "primary": "free",
  "startedAt": 1794291950010
}
```

### 4.2 `GET /api/health`

```json
{ "ok": true, "codex": true, "memory": "ok", "memoryError": null, "memoryLastOk": 1794287350958, "uptime": 4321 }
```
`memory` ist `ok` | `error` | `init`. Bei `error` steht der Grund in `memoryError`.
Pollintervall 5 s. Bei `memory: "error"` Banner in der rechten Spalte.

### 4.3 `GET /api/providers`

```json
{
  "providers": [
    { "id": "free", "name": "FreeLLMAPI", "tier": 1, "engine": "openai-compatible", "baseUrl": "http://100.87.246.36:11434/v1", "needsAuth": false, "ready": true, "hasKey": true, "keyCount": 1, "models": null },
    { "id": "openrouter", "name": "OpenRouter", "tier": 2, "engine": "openai-compatible", "baseUrl": "https://openrouter.ai/api/v1", "needsAuth": true, "ready": true, "hasKey": true, "keyCount": 2, "models": null },
    { "id": "codex", "name": "Codex (Abo)", "tier": 3, "engine": "codex-app-server", "needsAuth": true, "ready": false, "reason": "Nicht angemeldet - codex login auf dem Lenovo noetig", "account": null }
  ],
  "primary": "free",
  "fallback": ["free", "openrouter", "codex"],
  "count": 3
}
```

### 4.4 `GET /api/models?provider=free|openrouter|codex`

Ohne `provider` = Codex-Modelle.

```json
{ "provider": "openrouter", "models": [{ "id": "openai/gpt-4o-mini", "name": "GPT-4o mini", "context": 128000, "free": false }], "count": 465 }
```
Für `provider=codex`: `{ "provider": "codex", "models": [{ "id": "gpt-6-astra", "name": "..." }], "count": 8 }`.

### 4.5 `POST /api/chat` — der normale Weg (kein Abo nötig)

Request:
```json
{ "provider": "auto", "model": null, "prompt": "Hallo", "messages": null, "temperature": 0.4, "maxTokens": 2000, "stream": false }
```
- `messages` hat Vorrang vor `prompt`. Format: `[{"role":"user","content":"..."}]`.
- `provider: "auto"` → FreeLLMAPI, bei Fehler OpenRouter.

Antwort ohne `stream`:
```json
{ "answer": "Hallo!", "provider": "free", "providerName": "FreeLLMAPI", "model": "Qwen3.5-9B-Q4_K_M.gguf", "usage": { "total_tokens": 12 } }
```

Antwort mit `stream: true` (HTTP 200, `Content-Type: text/event-stream`):
```
data: {"type":"chatStart","provider":"auto","model":null}
data: {"type":"delta","provider":"free","text":"Hallo"}
data: {"type":"delta","provider":"free","text":"!"}
data: {"type":"done","provider":"free","model":"Qwen3.5-9B-Q4_K_M.gguf","answer":"Hallo!"}
```
Bei Fehler: `data: {"type":"providerError","provider":"free","error":"..."}` und danach
`data: {"type":"error","error":"Kein Provider erreichbar"}`.
Die gleichen Ereignisse laufen **zusätzlich** über `/api/events` — dort kann die UI sie mitlesen.

### 4.6 `GET /api/threads` — Sessionliste

```json
{
  "threads": [
    { "id": "01a1...", "name": "Krefeld-Pinguine-Website gestalten", "title": "Krefeld-Pinguine-Website gestalten",
      "preview": "...", "model": "gpt-6-astra", "provider": "openai",
      "createdAt": 1793819516, "updatedAt": 1793893672,
      "path": "C:\\Users\\Neu\\.codex\\sessions\\...jsonl", "cwd": "C:\\Users\\Neu\\Documents\\CODEX" }
  ],
  "count": 3,
  "data": [ ... dieselbe Liste ... ]
}
```
`createdAt`/`updatedAt` sind **Unix-Sekunden**. `name` kann `null` sein.

### 4.7 `GET /api/threads/{id}/turns` und `GET /api/threads/{id}/items`

```json
{ "turns": [{ "id": "...", "status": "completed", "startedAt": 0, "items": [] }], "count": 1, "nextCursor": null }
{ "items": [{ "id": "...", "type": "agentMessage", "text": "Hallo" }], "count": 3, "nextCursor": null }
```
Item-Typen: `userMessage` (Feld `content[]`), `agentMessage` (Feld `text`), `reasoning`,
`commandExecution`, `fileChange`, `webSearch`, `todoList`, `mcpToolCall`, `error`.
Der Verlauf kommt aus dem Codex-Server — für providerbasierte Chats (4.5) hält die UI die Antwort selbst.

### 4.8 Thread-Aktionen (alle `POST`, Body JSON)

| Route | Body | Wirkung |
|---|---|---|
| `/api/threads/{id}/steer` | `{ "text": "anders machen" }` | laufenden Turn in die Richtung lenken |
| `/api/threads/{id}/name` | `{ "name": "Neuer Titel" }` | Titel setzen |
| `/api/threads/{id}/archive` | `{}` | archivieren |
| `/api/threads/{id}/delete` | `{}` | löschen |
| `/api/threads/{id}/fork` | `{}` | Kopie erzeugen |
| `/api/threads/{id}/goal` | `{ "objective": "Zieltext" }` | Ziel setzen |
| `/api/threads/{id}/resume` | `{}` | Thread fortsetzen |

Antwort: `{ "ok": true, "result": { ... } }` bzw. `{ "error": "..." }` mit HTTP 500.
`GET /api/threads/{id}/goal` liefert das gesetzte Ziel.

### 4.9 `POST /api/threads` — Codex-Session starten

Request: `{ "model": "gpt-6-astra", "approvalPolicy": null, "cwd": null, "prompt": "Text" }`
Antwort: `{ "id": "...", "model": "...", ... }`
**Wichtig:** Diese Route braucht ein angemeldetes Codex-Konto. Wenn `/api/providers` für `codex`
`ready: false` meldet, ist der normale Weg `/api/chat` (4.5).

### 4.10 Freigaben (Codex fragt, die UI antwortet)

Der Codex-Server schickt Freigabe-Anfragen als Server-Request. Die UI bekommt sie über `/api/events`:

```
data: {"type":"approval","id":42,"method":"item/commandExecution/requestApproval","params":{"command":["npm","test"]}}
```

Antworten:
```
POST /api/approve
{ "id": 42, "decision": "accept" }        // accept | acceptForSession | decline | declineForSession | abort
```
bzw. für Rückfragen:
```
POST /api/approve
{ "id": 43, "answers": [{ "id": "frage-1", "answers": ["Option A"] }] }
```
Antwort: `{ "ok": true, "method": "item/commandExecution/requestApproval" }`.
Offene Freigaben auflisten: `GET /api/threads/{id}/approvals` → `{ "approvals": [{ "id": 42, "method": "...", "summary": "..." }] }`.

### 4.11 `GET /api/wissen?q=<begriff>&limit=8&project=central-station`

```json
{
  "results": [
    { "path": "10-wissen/gedaechtnis/central-station/2026-11-04_0722_...md",
      "url": "https://files.sascha-kruss.de/files/srv/root/Second-Brain/10-wissen/gedaechtnis/central-station/2026-11-04_0722_...md",
      "title": "Central Station Finalisierung", "snippet": "Erste 280 Zeichen...",
      "text": "Volltext", "project": "central-station", "category": "architecture",
      "author": "rowboat", "tags": "[finalisierung, tools]", "created": "2026-11-04 07:22", "score": 0.0387 }
  ],
  "count": 6, "query": "central-station", "project": "central-station",
  "stationUrl": "https://central.sascha-kruss.de/main/"
}
```
`score` ist ein Ähnlichkeitswert 0–1, **kleiner = besser**. Nicht als Prozent anzeigen.
`url` ist der Direktlink auf die Notiz (Filebrowser) — als „In Vault öffnen" verlinken.

### 4.12 Werkzeuge und Skills

`GET /api/mcp`:
```json
{
  "servers": [{ "name": "agent-memory", "url": "http://100.71.9.93:8798/mcp", "command": null, "args": [], "enabled": true, "status": "configured", "transport": "http" }],
  "memory": { "name": "agent-memory", "host": "100.71.9.93", "port": "8798", "status": "ok", "error": null, "lastOk": 1794291000000 },
  "count": 1, "source": "codex-config"
}
```
`GET /api/skills`:
```json
{ "skills": [{ "id": "i-have-adhd", "name": "i-have-adhd", "description": "...", "path": "C:\\Users\\Neu\\.agents\\skills\\i-have-adhd", "file": "...", "source": "agents-skills" }], "count": 300 }
```

### 4.13 Konto und Limits

`GET /api/account` → `{ "account": null, "requiresOpenaiAuth": true, "rateLimits": { "error": "..." }, "accountError": null }`.
Ohne Anmeldung ist `account` `null` — die UI blendet dann den Abo-Zug aus.

### 4.14 Dateibaum

`GET /api/fs?path=C:\Users\Neu\Documents` →
```json
{ "path": "C:\\Users\\Neu\\Documents", "entries": [{ "name": "CODEX", "path": "C:\\Users\\Neu\\Documents\\CODEX", "kind": "dir", "size": null }], "count": 12 }
```
`GET /api/fs/file?path=<datei>` → `{ "path": "...", "content": "Textinhalt", "encoding": "utf-8" }`

### 4.15 `GET /api/events` — SSE-Stream

`text/event-stream`, alle 15 Sekunden ein `: ping` (Kommentar, hält die Verbindung über Mobilfunk offen).
Ereignisse (alle über `data:`, JSON):

| Typ | Inhalt |
|---|---|
| `connected` | Verbindung steht |
| `chatStart` | `{ provider, model }` — providerbasierter Chat beginnt |
| `delta` | `{ provider, text }` — Textstück |
| `done` | `{ provider, model, answer }` — fertig |
| `providerError` | `{ provider, error }` |
| `error` | `{ error }` |
| `approval` | `{ id, method, params }` — Freigabe nötig |
| `item/started`, `item/completed` | `{ params: { item } }` — Codex-Elemente |
| `turn/started`, `turn/completed` | `{ params: { turn } }` |
| `thread/status/changed` | Statuswechsel einer Session |

Bei `onerror`: 3 s warten, neu verbinden, Status auf „Verbindung verloren".

---

## 5. Design-Tokens

| Rolle | Wert |
|---|---|
| App-Hintergrund | `#0d0d0d` |
| Panel/Spalte | `#141414` / `#181818` |
| Rahmen | `#262626` |
| Text primär | `#e8e8e8` |
| Text sekundär | `#9a9a9a` |
| Akzent (Aktion, aktiv) | `#3b82f6` |
| Erfolg / verbunden | `#4ade80` |
| Warnung / wartet | `#fbbf24` |
| Fehler | `#f87171` |

Typografie: System-UI-Stack (`-apple-system, "Segoe UI", Roboto, …`). Keine Webfonts.
Größen: Kopfzeile 14 px/600, Fließtext 14 px/1.55, Titel 18 px/600, Meta 12 px/500, Monospace nur für Pfade.
Abstände: 4-8-12-16-24-32 px. Radien: 6 px (Buttons/Inputs), 10 px (Panels), 999 px (Pill-Status).
Keine harten 1-px-Keylines als Haupttrenner — Flächen und Schatten trennen.

---

## 6. Verhalten

- **Eingabe:** `Enter` sendet, `Shift+Enter` macht Zeilenumbruch. Textarea wächst mit (max. 30 % Fensterhöhe).
- **Standardweg:** Der Chat nutzt `POST /api/chat` mit `provider: "auto"`. **Nicht** über `/api/threads`, solange Codex nicht angemeldet ist.
- **Antwort anzeigen:** Tokens live über `stream: true` (Ereignis `delta`) einblenden, bei `done` den finalen Text setzen.
- **Provider-Anzeige:** Aktiven Provider und Modell in der Kopfzeile anzeigen („FreeLLMAPI · Qwen3.5-9B").
- **Modellwahl:** Dropdown aus `/api/models?provider=<aktuell>`; beim Wechsel des Providers die Liste neu laden.
- **Statusleiste (unten, immer sichtbar):** Provider · Modell · Wissen-Status (`ok`/`error`) · Codex-Status · Version · Uptime.
- **Wissen-Panel:** Suche erst bei `Enter` oder nach 400 ms Debounce. Treffer als Karte: Titel, Kategorie, Autor, Datum, Score, Tags. Klick auf Karte → Volltext im Detailbereich. Treffer können als Kontext in den Chat übernommen werden („Antworte mit Quellen").
- **Fehlerzustände:** `memory: "error"` → Banner mit `memoryError`. `/api/wissen` mit `error` → Fehlertext inline. Provider-Fehler → roter Hinweis mit „Erneut versuchen" (anderer Provider).
- **Leere Zustände:** „Keine Sessions", „Keine Treffer", „Noch keine Nachricht" — nie eine leere Fläche.
- **Tastatur:** `Strg+K` = neue Session, `Strg+/` = Wissenssuche fokussieren, `S` = linke Spalte, `W` = rechte Spalte, `Esc` = Modal schließen.

---

## 7. Handy und Remote

Die App ist **über das Tailnet auch am Handy nutzbar**: `http://100.68.210.112:8080` (Tailscale auf dem Handy aktiv).
Der Server bindet auf `0.0.0.0:8080`, der SSE-Stream sendet alle 15 s einen Heartbeat (mobil relevant).

Für die Handy-Ansicht gilt:
- Unter 900 px: linke und rechte Spalte einklappbar, Chat volle Breite.
- Eingabefeld bleibt am unteren Rand sichtbar (kein Scrollen nötig).
- Buttons mindestens 44 × 44 px (Fingerbedienung).
- `meta viewport` ist gesetzt; zusätzlich `user-scalable=no` nicht verwenden.
- Kein `hover`-Zustand als einzige Information.
- Touch-Ziele für Thread-Auswahl, Senden, Freigabe.

---

## 8. Dateien

| Datei | Aufgabe |
|---|---|
| `public/index.html` | Struktur der drei Spalten, keine Logik |
| `public/style.css` | Tokens, Layout, Zustände, responsiv, Handy |
| `public/app.js` | API-Aufrufe, SSE, State, Rendering |

Keine weiteren Dateien nötig. Wenn doch: `public/lib/*.js` als ES-Module.
Optional sinnvoll: `public/manifest.webmanifest` (Name, Farben, `display: standalone`) für „App zum Homescreen".

---

## 9. Abnahmekriterien

1. `http://127.0.0.1:8080` lädt ohne Konsolenfehler.
2. Linke Spalte zeigt die Sessions mit Titel und Datum, Gruppierung Heute/Gestern.
3. Eine Frage wird über `POST /api/chat` (`provider: "auto"`) gesendet; die Antwort erscheint live als `delta` und final als `done`.
4. Provider und Modell sind sichtbar; ein Wechsel auf OpenRouter funktioniert.
5. Wissen-Suche „central-station" liefert Treffer mit Titel/Autor/Datum; Klick zeigt den Volltext, „In Vault öffnen" verlinkt.
6. Der Statusleisten-Text nennt Provider, Wissen-Status und Version.
7. Layout bricht nicht zwischen 900 px und 1440 px um (kein horizontaler Scrollbalken).
8. Tastaturbedienung vollständig (Tab-Reihenfolge, kein Fokusverlust).
9. Keine `innerHTML`-Injection aus API-Inhalten — Text immer über `textContent` oder escapen.
10. Auf einem 390 px breiten Fenster (Handy) ist der Chat ohne horizontales Scrollen bedienbar.

---

## 10. Bekannte Stolperstellen

- Der Codex-Server auf dem Lenovo ist **nicht angemeldet** (`requiresOpenaiAuth: true`). Der Abo-Pfad liefert 401 von api.openai.com, bis Sascha `codex login` ausführt. Die App muss ohne Abo voll funktionieren.
- `thread/turns/list` und `thread/items/list` antworten in dieser Alpha-Version des Codex-Servers nicht (Timeout nach 15 s). Die UI darf darauf nicht warten — Verlauf aus `/api/threads/{id}/turns` anzeigen, Fehler in den Hintergrund.
- Der Codex-Server kennt `skills/list` und `mcpServerStatus/list` nicht; Skills und MCP-Server kommen aus `/api/skills` und `/api/mcp` (lokal aus `~/.agents/skills` und `~/.codex/config.toml`).
- Der erste OpenRouter-Key im Vault liefert 401 („User not found") — der Server probiert automatisch den zweiten Key. Die UI muss die Provider-Anzeige nicht selbst reparieren.
- Umlaute in manchen Sessiontiteln kommen als Ersatzzeichen (`Ǭ` statt `ü`) — Datenqualität im Vault, nicht im Frontend.
- `score` ist ein Ähnlichkeitswert 0–1, kleiner = besser.
