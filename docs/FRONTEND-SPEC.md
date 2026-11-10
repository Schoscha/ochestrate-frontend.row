# FRONTEND-SPEC — Codex Web UI (Lenovo)

Stand: 2026-11-10 · Server: `http://100.68.210.112:8080` · Code: `C:\Users\Neu\codex-web`

Dieses Dokument ist der **eingefrorene Vertrag**. Wer das Frontend baut, arbeitet **ausschließlich** in `public/`.
`server.mjs` wird nicht angefasst. Bei API-Abweichungen: melden, nicht ändern.

---

## 1. Zielbild

Desktop-App-Layout mit drei Spalten, dunkel, wie Hermes Desktop / OpenCode Desktop / Central Station:

```
┌──────────────┬────────────────────────────────┬──────────────────┐
│ LINK         │ MITTE                           │ RECHTS           │
│ Logo         │ Kopfzeile (Status, Modell)     │ Wissen-Suche     │
│ Neue Session │ Chat-Verlauf                    │ Trefferliste     │
│ Sessions     │                                │ Kontext/Info     │
│  ├ Heute     │ Eingabefeld                     │ Ausgaben/Dateien │
│  ├ Gestern    │ [Senden] [Interrupt]           │                  │
│ Angepinnt   │                                │                  │
│ Werkzeuge    │                                │                  │
│ (Wissen,     │                                │                  │
│  Modelle,    │                                │                  │
│  Dateien)    │                                │                  │
├──────────────┴────────────────────────────────┴──────────────────┤
│ Statusleiste: Codex-Status · MCP/Memory · Verbindung · Version    │
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

## 3. API-Vertrag (eingefroren)

Basis: `http://<host>:8080`. Alle Antworten sind JSON, Charset UTF-8.

### 3.1 `GET /api/health`

```json
{
  "ok": true,
  "codex": true,
  "memory": "ok",
  "memoryError": null,
  "memoryLastOk": 1781100000000,
  "uptime": 4321
}
```
`memory` ist `ok` | `error` | `init`. Bei `error` steht der Grund in `memoryError`.

### 3.2 `GET /api/threads` — Sessionliste

```json
{
  "threads": [
    {
      "id": "01a1a7f9-a01b-7ac1-9558-62e055df55f2",
      "name": "Krefeld-Pinguine-Website gestalten",
      "title": "Krefeld-Pinguine-Website gestalten",
      "preview": "Du bist ein Principal UI/UX-Architekt ...",
      "model": "gpt-6-astra",
      "provider": "openai",
      "createdAt": 1793819516,
      "updatedAt": 1793893672,
      "path": "C:\\Users\\Neu\\.codex\\sessions\\2026\\11\\04\\rollout-....jsonl",
      "cwd": "C:\\Users\\Neu\\Documents\\CODEX"
    }
  ],
  "count": 3,
  "data": [ ... dieselbe Liste ... ]
}
```
`name` kann `null` sein → dann `title` aus `preview` (gekürzt). `createdAt`/`updatedAt` sind **Unix-Sekunden**.
Sortierung: `updatedAt` absteigend. Gruppierung in der UI: Heute / Gestern / Datum.

### 3.3 `GET /api/threads/{id}/turns` — Verlauf einer Session

```json
{ "turns": [ { "role": "user", "text": "hallo" }, { "role": "assistant", "text": "..." } ] }
```
Die UI muss `role` **user** vs. alles andere als *agent* behandeln.

### 3.4 `POST /api/threads` — neue Session + optionaler Start

Request: `{ "model": "gpt-6.1-sol", "prompt": "Text der Eingabe" }`
Response: `{ "id": "...", ... }` — bei `prompt` wird der Turn direkt gestartet, Antwort kommt über SSE.

### 3.5 `GET /api/events` — SSE-Stream

Endpoint liefert `text/event-stream`, standardmäßige `EventSource`-Events, `data:` ist JSON:

```json
{ "type": "connected" }
{ "type": "turnStarted", "params": { "turn": { ... } } }
{ "type": "turnCompleted", "params": { "turn": { ... } } }
{ "type": "itemStarted", "params": { "item": { "name": "..." } } }
{ "type": "itemCompleted", "params": { "item": { "name": "..." } } }
```
Bei `onerror`: 3 s warten, neu verbinden, Status auf „Verbindung verloren" setzen.

### 3.6 `GET /api/wissen?q=<begriff>&limit=8&project=central-station`

```json
{
  "results": [
    {
      "path": "10-wissen/gedaechtnis/central-station/2026-11-04_0722_central-station-finalisierung.md",
      "title": "Central Station Finalisierung: Zusammentragung aller Besprechungen",
      "snippet": "Erste 280 Zeichen des Textes ...",
      "text": "Vollständiger Text der Notiz",
      "project": "central-station",
      "category": "architecture",
      "author": "rowboat",
      "tags": "[finalisierung, verkabelung, tools]",
      "created": "2026-11-04 07:22",
      "score": 0.0387
    }
  ],
  "count": 6,
  "query": "central-station",
  "project": "central-station"
}
```
`limit` Default 8, `project` Default `central-station`. Leeres Ergebnis → `{ "results": [], "count": 0 }`.
**Kein Fehler werfen**, wenn `results` leer ist — „Keine Treffer" anzeigen.

### 3.7 `POST /api/approve`

Request: `{ "thread_id": "...", "item_id": "..." }` → Antwort egal, nur Fehler behandeln.

### 3.8 `POST /api/interrupt`

Request: `{ "thread_id": "..." }`.

### 3.9 Fehlerformat

Alle Fehler: `{ "error": "Text", "results": [] }` bzw. `{ "error": "Text" }`, HTTP 4xx/5xx.

---

## 4. Design-Tokens

Farben (dunkel, wie in den Referenzen):

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
Größen: Kopfzeile 14 px/600, Fließtext 14 px/1.55, Titel 18 px/600, Meta 12 px/500, Monospace nur für Pfade (`ui-monospace, Consolas`).
Abstände: 4-8-12-16-24-32 px. Radien: 6 px (Buttons/Inputs), 10 px (Panels), 999 px (Pill-Status).
Keine harten 1-px-Keylines als Haupttrenner — Flächen und Schatten trennen.

---

## 5. Verhalten

- **Eingabe:** `Enter` sendet, `Shift+Enter` macht Zeilenumbruch. Textarea wächst mit (max. 30 % Fensterhöhe).
- **Statusleiste (unten, immer sichtbar):** Codex-Status (`Verbunden` / `Warte auf Codex` / `Verbindung verloren`), Memory-Status (`Wissen ok` / `Wissen-Fehler: <text>`), aktuelles Modell, Server-Uptime.
- **Wissen-Panel:** Suche erst bei `Enter` oder nach 400 ms Debounce. Treffer als Karte: Titel, Kategorie, Autor, Datum, Score, Tags. Klick auf Karte → Volltext in einem Modal/Detailbereich rechts anzeigen. Leertaste/Enter im Suchfeld löst die Suche aus.
- **Fehlerzustände:** Wenn `/api/health` `memory: "error"` meldet, Banner in der rechten Spalte mit `memoryError`. Wenn `/api/wissen` `error` liefert, Fehltext inline statt stillem Nichts.
- **Leere Zustände:** „Keine Sessions", „Keine Treffer", „Noch keine Nachricht" — nie eine leere weiße Fläche.
- **Freigaben (`/api/approve`):** Wenn SSE ein Item mit `requiresApproval` liefert, erscheint ein Button-Block „Freigeben" über dem Eingabefeld. (Ist derzeit noch nicht aktiv — Platzhalter einbauen.)
- **Tastatur:** `Strg+K` = neue Session, `Strg+/` = Wissenssuche fokussieren, `S` = linke Spalte, `W` = rechte Spalte, `Esc` = Modal schließen.

---

## 6. Dateien

| Datei | Aufgabe |
|---|---|
| `public/index.html` | Struktur der drei Spalten, keine Logik |
| `public/style.css` | Tokens, Layout, Zustände, responsiv |
| `public/app.js` | API-Aufrufe, SSE, State, Rendering |

Keine weiteren Dateien nötig. Wenn doch: `public/lib/*.js` als ES-Module.

---

## 7. Abnahmekriterien

1. `http://127.0.0.1:8080` lädt ohne Konsolenfehler.
2. Linke Spalte zeigt die 3 vorhandenen Sessions mit Titel und Datum, Gruppierung Heute/Gestern.
3. Klick auf eine Session lädt den Verlauf (`/api/threads/{id}/turns`) in die Mitte.
4. Eingabe + „Senden" erzeugt eine Session; Antwort erscheint über SSE in der Mitte.
5. Wissen-Suche „central-station" liefert 6 Treffer mit Titel/Autor/Datum; Klick zeigt den Volltext.
6. „Interrupt" ist während eines laufenden Turns aktiv, danach ausgegraut.
7. Layout bricht nicht zwischen 900 px und 1440 px um (kein horizontaler Scrollbalken).
8. Tastaturbedienung vollständig (Tab-Reihenfolge, kein Fokusverlust).
9. Keine `innerHTML`-Injection aus API-Inhalten — Text immer über `textContent` oder escapen.

---

## 8. Bekannte Stolperstellen

- Der Codex-Server liefert Umlaute in manchen Sessiontiteln als Ersatzzeichen (`Ǭ` statt `ü`) — das ist Datenqualität im Vault, kein Frontend-Fehler. Nicht „reparieren", nur anzeigen.
- `score` ist ein Ähnlichkeitswert 0–1, **kleiner = besser**. Im UI als „Trefferqualität" darstellen, nicht als Prozent.
- Der SSE-Stream kann beim ersten Verbinden erst ein `connected`-Event liefern — die UI darf nicht auf ein anderes Ereignis warten, um „Verbunden" anzuzeigen.
- Der Server kann unter Windows sporadisch neu starten → alle 5 s `/api/health` pollen und bei Fehler den SSE neu aufbauen.
