# Wave-Terminal-Analyse für die Codex Web UI

Stand: 2026-11-12 · Grundlage: Doku docs.waveterm.dev, Video `docs/sascha_daten/Wave 2026-11-12 18-42-20.mp4` (Frames extrahiert), annotierter Screenshot von Sascha

## 1. Was Wave Terminal wirklich ist (Belege)

- **Fenster = Sammlung von Widgets.** Jedes Widget hat eine Kopfzeile: Icon, Titel (`Neu@Sascha-Lenovo`), Zahnrad, Maximieren, X.
- **Magnet-Layout:** Wird eine Kante gezogen, schiebt die Nachbarn weg (Screenshot: der Mittelblock wuchs, die rechten Spalten rückten nach rechts, ein 3x3-Raster unten rechts blieb).
- **Dock-Rail rechts:** Icon-Leiste (terminal, files, web, sysinfo, process, settings) blendet den passenden Widget-Typ ein.
- **Tabs oben:** `Übersicht`, `T1`, `+` → Layout-Tabs. Das Puzzle-Icon öffnet die Erweiterungen.
- **Widget-Typen laut Doku:** Term, Preview (Dateien), Codeedit, Process Viewer; **eigene Widgets** sind möglich (React, `customwidgets`).
- **`wsh`**: steuert Wave aus der Kommandozeile - Layouts und Widgets sind damit skriptbar.

## 2. Was bei uns schon da ist (Lücke schließen)

| Wave-Baustein | Bei uns | Lücke |
|---|---|---|
| Terminal-Blöcke, persistent | ja (`terminals.mjs`) | - |
| Raster 1x1 / 2x2 / 2x1 / 1x2 | ja (`layout.mjs`) | kein freies Verschieben/Größern |
| Layout als Datei + Script | ja (`data/layout.json`, `scripts/layout.cmd`) | nur Raster, keine Rects |
| Erweiterungen | ja (Plugins `plugins/<name>/plugin.json`) | noch nicht als Widget-Typen |
| Widget-Rahmen (Titel/Zahnrad/max/X) | nein | komplett |
| Dock-Rail rechts | nein (Tabs) | komplett |
| Layout-Tabs | nein | komplett |

## 3. Realisierbarkeit

| Baustein | Aufwand | In unserem Stack | Risiko |
|---|---|---|---|
| Widget-Rahmen + Dock-Rail | 2-4 h | CSS/JS, Panels existieren | gering |
| Magnet-Layout (Rects, Split/Push) | 1 Tag | `data/layout.json` mit Rects, Split-Logik in JS | mittel |
| Layout-Tabs (`Übersicht`, `T1`) | 2 h | Tab-Liste im Layout-Objekt | gering |
| Widget `files` (Baum + Vorschau) | 3 h | `/api/fs` + `/api/fs/file` vorhanden | gering |
| Widget `process` / `sysinfo` | 2 h | `tasklist`/`wmic` über unsere Terminal-Blöcke | gering |
| Widget `web` (iframe Station) | 1 h | iframe, ggf. Proxy | gering |
| Echtes PTY (Vollbildprogramme) | 1-2 Tage | `node-pty` = nativer Build (Visual Studio Build Tools, Node 24) | mittel |
| Eigene Widgets wie Wave (React) | 2-3 Tage | Build-Schritt, bricht die Regel "kein npm" | hoch |

## 4. Meinung

- **Ja, das ist der richtige Weg.** Der Mehrwert steckt nicht im Terminal, sondern im *Widget-Konzept*: alles
  (Terminal, Dateien, Prozesse, Web, Wissen, Rowboat) ist eine austauschbare Fläche mit gleichem Rahmen.
  Unsere Panel-Leisten (Wissen, Rowboat, Werkzeuge, Provider, Terminal) sind bereits die halben Widget-Typen.
- **Wir bauen die Idee nach, nicht den Code.** Wave ist Electron + Rust-Backend + node-pty. Für 80 % des
  Effekts brauchen wir Magnet-Layout, Widget-Rahmen, Dock-Rail und Layout-Tabs - alles ohne Build.
- **Unser Plugin-System ist der bessere Weg für "alles einfügen":** Ein Plugin liefert nicht nur Werkzeuge,
  sondern kann (später) einen Widget-Typ mitbringen. Damit ist die Wave-`customwidgets`-Idee ohne React abgedeckt.
- **Die eine echte Lücke ist das PTY.** Ohne PTY laufen Vollbildprogramme (vim, top, git-Graph) nicht sauber.
  Das ist eine bewusste Entscheidung: erst die Oberfläche, dann (optional) `node-pty` als einzige Baustelle mit Build.
- **Reihenfolge:** Erst Magnet-Layout und Widget-Rahmen (der eigentliche Wunsch aus dem Screenshot), dann die
  Widget-Typen aus unseren vorhandenen Endpunkten, dann Tabs. Nicht umgekehrt.

## 5. Vorschlag (Umsetzung)

- **Phase 1 (Tag 1):** Layout auf Rects umstellen, Dock-Rail rechts, Widget-Rahmen, Tab-Leiste.
  Bedienung: Kante ziehen = splitten, Nachbarn werden geschoben; Rahmen per Drag verschieben.
- **Phase 2 (Tag 1-2):** Layouts speichern und per Script setzen (`layout.cmd --rect 0,0,60,100 ...`),
  Layout-Tabs (`Übersicht`, `T1`), Zoom auf ein Widget (Wave "magnify").
- **Phase 3 (Tag 2):** Widget-Typen `files`, `process`, `sysinfo`, `web` aus den vorhandenen Endpunkten.
- **Phase 4 (optional):** `node-pty` für echtes PTY.

## 6. Offene Punkte für Sascha

- PTY ja/nein (einziger Build-Schritt, sonst keine Vollbildprogramme).
- Soll der Codex-Chat selbst auch ein Widget in dieser Fläche sein (Chat links, Terminals rechts)?
- Tab-Namen und Anzahl (`Übersicht`, `T1`, ...) sind frei konfigurierbar - Vorschlag: eine Leiste je
  Projekt (`Central-Station`, `Codex-Web`).
