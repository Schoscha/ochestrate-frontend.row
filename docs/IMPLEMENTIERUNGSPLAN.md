# Implementierungsplan — Codex Web UI (aktualisiert 2026-11-12, 21:00)

Repo: https://github.com/Schoscha/ochestrate-frontend.row · https://git.sascha-kruss.de/Schoscha/codex-web · https://git.sascha-kruss.de/Schoscha/ochestrate-frontend.row
Dienst: `http://100.68.210.112:8080` (Tailnet, auch Handy) · Code: `C:\Users\Neu\codex-web`

## Status: fertig und getestet

| Phase | Inhalt | Beleg |
|---|---|---|
| 1 | Eigenes OpenCode-Frontend (Tokens aus dem OpenCode-Repo), 3-Spalten, Handy, Farbwechsler | Browser-Screenshot `docs/workspace-ui.png` |
| 2 | Anbieterbindung raus: FreeLLMAPI → OpenRouter, kein Abo, kein Codex-App-Server | `/api/providers` = 3 Provider, health ok |
| 3 | Agent-Harness: 10 Werkzeuge, Freigaben, Plugins (DeepSeek + lokal getestet) | `/api/tools`, Test `port_check`/`system_info` |
| 4 | Rowboat komplett: Übersicht, Suche, Notiz, Briefing (Vault), Task | 300 Mails, 9 Ordner, 4 Karten im UI |
| 5 | Sessions, Leeren-Button (Chat + Terminal), Watchdog-Autostart | Browser-Test, health |
| 6 | Wave-Arbeitsfläche: Widgets als Rects, Canvas, Dock-Rail, Magnet, Tabs, Presets | Browser-Test (Drag, Magnet, X) |
| 7 | Widget-Typen: chat, term, files, process, web, wissen, rowboat, provider | 8 Icons links/rechts/oben |
| 8 | Composer volle Breite (1251/1251 px, bündig), Rails links/rechts/oben, einklappbar | Browser-Test `test-ui.mjs` |
| 9 | Modul-Leeren (Canvas) + **rote Lasche** zum Öffnen der Seitenleisten + überlappungsfreie Platzierung | diese Runde |
| 10 | Spiegelung: Gitea codex-web, GitHub ochestrate-frontend.row, Gitea ochestrate-frontend.row | `git ls-remote` |

## Offen (bewusst, ohne Rückfrage)

1. **Echtes PTY** (`node-pty`): Vollbildprogramme (vim, top). Einziger Build-Schritt (Node 24 + VS Build Tools).
2. **History-Rewrite**: das 93-MB-Video steckt noch in den ersten Commits (aus Tracking genommen, `.gitignore` gesetzt). Aufräumen = Force-Push, nur mit Ok.
3. **Codeedit** (Monaco) als Widget-Typ — optional.
4. **GPU-/3D-Module**, falls später gewünscht.

## Nächster Arbeitsblock (durchziehen, keine Rückfrage)

1. PTY-Entscheidung umsetzen: `node-pty` installieren, `terminals.mjs` auf echte PTYs umstellen, testen (`vim`, `top`).
2. Widget-Typ `codeedit`: Datei im Widget bearbeiten und speichern (`/api/fs/file` + Schreib-Freigabe).
3. `wsh`-Äquivalent: `layout.cmd --rect …`, `layout.cmd --preset …`, `layout.cmd --widget …` vollständig.
4. Abnahme: alle Widget-Typen gleichzeitig (1x + 4x Terminal), Handy 390 px, Neustart-Persistenz, 24 h Lauf.

## Aufwand

Bisher 3 Arbeitstage; nächster Block 1–2 Tage. Alles ohne Build, ohne npm (außer PTY).
