# Implementierungsplan — Codex Web UI, Arbeitsfläche im Wave-Modell

Stand: 2026-11-12 · Laptop: `C:\Users\Neu\codex-web` · Dienst: `http://100.68.210.112:8080`
Repo: https://git.sascha-kruss.de/Schoscha/codex-web (privat)

## Ausgangslage
Läuft bereits: eigener Server ohne Anbieterbindung (FreeLLMAPI → OpenRouter), Agent-Harness mit
10 Werkzeugen + Freigaben, Rowboat (Wissen/Mails/Briefings/Tasks), Plugins, Sessions, Terminal-Blöcke,
Farbwechsler, Watchdog-Autostart. Fehlt: freies Anordnen und Skalieren der Flächen.

Ziel: Arbeitsfläche nach dem Wave-Modell — Widgets frei anordnen und skalieren, Icon-Leiste rechts,
Layouts speicherbar und per Script setzbar.

## Phase 1 — Layout-Engine (Tag 1, ~5 h)
1. Layout von Raster auf **Rects** umstellen: `data/layout.json` → `{ widgets: [{ id, type, x, y, w, h, focus }] }`
2. **Canvas** im Chat-Bereich: Widgets absolut positioniert, Kopfzeile wie Wave (Icon, Titel, Zahnrad, Maximieren, X)
3. **Dock-Rail rechts**: Icon-Leiste (Terminal, Files, Process, Web, Wissen, Rowboat, Provider) — Klick fügt ein Widget hinzu
4. **Fokus** (grüner Rahmen) und **Magnify** (Widget füllt die Fläche)
5. Widget-Typen anbinden: term, files, process, web, wissen, rowboat, provider

**Abnahme:** Layout überlebt Neuladen; Widget hinzufügen/entfernen; verschieben; Größe per Trennlinie ändern; Fokus/Magnify wirken.

## Phase 2 — Magnet-Verhalten (Tag 1–2, ~4 h)
6. **Header ziehen**: grüne Vorschau; halbes Fenster = dazwischen, ganzes = Plätze tauschen; beim Loslassen räumt der Rest auf
7. **Trennlinien** zwischen Widgets ziehen (grün) → Nachbarn schrumpfen mit
8. **Layout-Tabs** (`Übersicht`, `T1`, `+`) mit Speichern/Laden
9. **Script**: `scripts\layout.cmd --rect <id> <x,y,w,h>`, `layout.cmd --preset <name>`, `layout.cmd --list`
   (ersetzt die bisherigen Raster-Chips; Chips bleiben als Schnellwahl)

**Abnahme:** Layout per Script setzbar und nach Neuladen identisch; Ziehen und Skalieren ohne Überlappung.

## Phase 3 — Widget-Arten (Tag 2, ~4 h)
10. `files`: Verzeichnisbaum + Vorschau (Text, Markdown gerendert, Bilder)
11. `process`: live PID/Befehl/CPU/RAM (Quelle: `tasklist` über unsere Terminal-Blöcke), sortierbar, Filter
12. `web`: iframe (Central Station, GitHub, Doku)
13. `wissen`, `rowboat`, `provider` als Widget (Daten existieren bereits über `/api/*`)

**Abnahme:** Jeder Widget-Typ liefert Daten und lässt sich anordnen; `files` öffnet eine Datei in einem eigenen Widget.

## Phase 4 — Optional
14. **Echtes PTY** (`node-pty`): Vollbildprogramme (vim, top, git-Graph). Einziger Build-Schritt
    (Node 24 + Visual Studio Build Tools). Ohne: Pipes, Vollbild geht nicht.
15. **Codeedit** (Monaco) zum Bearbeiten von Dateien im Widget.

## Reihenfolge und Abhängigkeiten
Phase 1 → Phase 2 → Phase 3. Phase 4 nur auf Zuruf. Alles ohne Build, ohne npm.

## Risiken
- **Pipes statt PTY:** Vollbildprogramme laufen nicht (Phase 4 löst das).
- **Magnet-Logik** ist der teuerste Teil (1 Tag); sichtbare Fehler sind überlappende Widgets — Layout-Datei wird vor jeder Änderung gesichert.
- **93-MB-Video** liegt im Git-Repo (`docs/sascha_daten/`) — kann rausgenommen werden.
- Der Codex-Chat ist weiterhin fest links; er wird erst optional ein Widget (offene Entscheidung).

## Aufwand
- Ohne PTY: **2 Tage** (Phase 1–3)
- Mit PTY: **3–4 Tage**

## Nicht in diesem Plan (bewusst)
- Ausbau zu einem echten Wave-Terminal (Electron, Rust, eigenes Layout-Backend) — wir bauen die Regeln, nicht die Plattform.
- React-Custom-Widgets — unser Plugin-System deckt „alles einfügen" ab.
