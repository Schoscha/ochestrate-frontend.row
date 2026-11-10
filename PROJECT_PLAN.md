# Projektplan: Codex Web UI auf Sascha-Lenovo (Central-Station-Integration)

**Projekt:** Codex Web UI (Lenovo 100.68.210.112)  
**Oberbegriff:** Central-Station  
**Verantwortlich:** opencode (Claude Code)  
**Stand:** 2026-11-10  
**Lokaler Repo:** C:\Users\Neu\codex-web (git, branch `master`, initial commit `90b334f`)

---

## 1. Ziel

Codex als Web-UI auf dem kleineren Lenovo (Sascha-Lenovo, Win32, User `Neu`) laufen lassen, remote erreichbar machen (Tailscale/SSH), mit Central Station (Wissensansicht + Memory-MCP) verbinden, zuverlässig autostarten.

---

## 2. Status quo (erledigt)

| Bereich | Zustand | Beleg |
|---|---|---|
| Backend | `server.mjs` auf `0.0.0.0:8080`, Endpoints `/api/health`, `/api/events`, `/api/models`, `/api/threads`, `/api/approve`, `/api/interrupt`, `/api/wissen` | `server.mjs` |
| Health | `{"ok":true,"codex":true,"memory":"ok"}` (200 OK) | `server.log`, `curl`-Test OK |
| Codex-Spawn | Via `C:\Users\Neu\AppData\Roaming\npm\codex.cmd` mit `shell:true` | `server.mjs` |
| Memory | MCP-over-SSE `http://100.71.9.93:8798/mcp`, `/api/wissen?q=...` liefert Ergebnisse | `server.mjs` |
| Remote-Zugriff | Tailscale bestätigt: `http://100.68.210.112:8080` | Work-State |
| Autostart | Registry `HKCU\Run` Eintrag `CodexWebUI` → `start-server.cmd` | Work-State |
| Neustart-Stabilität | Nach Reboot erreichbar (PID 41572), Port 8080 LISTENING | Work-State |
| UI | `public/index.html`, `public/app.js`, `public/style.css` — "annehmbar" | `public/` |
| Tagebuch | `/test-sascha/Central-Station/2026-11_10_0500_codex-web-ui-lenovo.md` | Work-State |
| Berichte | `report.md`, `final-report.md`, `COMPLETED.md` | Work-State |
| Lokales Git | Repo initialisiert, initial commit auf `master` | gerade erstellt |

---

## 3. Offene Punkte (Next Moves)

| # | Aufgabe | Status | Priorität | Hinweis |
|---|---------|--------|-----------|---------|
| 1 | Privates GitHub-Repo anlegen (§11) | offen | hoch | `gh` CLI nicht verfügbar, nur git 2.53.0; kein GitHub-Auth konfiguriert → manuell über GitHub Web oder `git remote add` + PAT |
| 2 | User-Frage klären: "soll ich das frontend vonjemand anderen bauen lassen?" | offen | mittel | Empfehlung: **Nein**, nicht nötig. Frontend existiert, ist funktional und "annehmbar". Backend ist API-basiert → später austauschbar. |
| 3 | Browser-Tabs Lenovo ggf. F5 (502 Bad Gateway) | offen | niedrig | Nur falls auftritt |
| 4 | Tagebuch-Bericht aktualisieren / abschließen | offen | mittel | `tagebuch_eintrag` / `tagebuch_ende` mit `## Gelernt` |
| 5 | Nach GitHub-Push: nichts auf `main` ohne Ok, nie `--force` | laufend | dauerhaft | REGELN §11 |

---

## 4. Meilensteine & nächste Schritte

### M1 — GitHub-Repo erstellen (sofort)
1. Auf github.com ein **privates** Repo anlegen (z. B. `codex-web-ui-lenovo`), README nicht initialisieren (lokal existiert bereits).
2. Personal Access Token (PAT) erstellen (falls noch keines vorhanden).
3. Lokal: `git remote add origin <repo-url>` und `git push -u origin master`.
4. Danach: nach jedem Aufgabenblock committen, am Ende in den vorgesehenen Zweig pushen.

### M2 — Frontend-Entscheidung (sofort)
- Sascha fragt, ob jemand anderes das Frontend bauen soll.  
- Meine Einschätzung: **Nein**. Das aktuelle Frontend erfüllt die Anforderung "UI/UX annehmbar", alle Endpoints funktionieren, Remote-Zugriff steht. Ein externes Frontend bringt nur Kosten und Koordinationsaufwand ohne sofortigen Nutzen.  
- Bei Bedarf später: Backend (server.mjs) liefert reines JSON → Frontend jederzeit ersetzbar.

### M3 — Betrieb & Dokumentation
- Tagebuch-Bericht mit `## Gelernt` abschließen.
- `PROJECT_PLAN.md` bei Änderungen aktuell halten.
- Falls 502 auf Lenovo: Browser-F5, sonst Server-Log prüfen (`server.err.log`).

---

## 5. Definition of Done (Projekt abgeschlossen)

- [ ] Privates GitHub-Repo existiert, lokaler Stand gepusht.
- [ ] User-Frage Frontend beantwortet und Entscheidung dokumentiert.
- [ ] Tagebuch-Bericht abgeschlossen (`tagebuch_ende`, `## Gelernt`).
- [ ] Server nach Reboot noch erreichbar, Health 200 OK.
- [ ] Nichts ungepusht auf `main` ohne Ok.

---

## 6. Risiken & Entscheidungen

- **gh fehlt:** Workaround manuell via GitHub Web + PAT (kein Blocker).
- **GPO blockiert schtasks:** Autostart bereits über `HKCU\Run` gelöst (kein weiteres Action nötig).
- **PowerShell `&&`/`||`:** Nicht verfügbar, Befehle einzeln oder mit `;` verketten.
- **Kein GitHub-Auth:** PAT muss von Sascha erstellt werden, bevor gepusht werden kann.

---

## 7. Relevante Pfade

- `C:\Users\Neu\codex-web\server.mjs` — Hauptserver
- `C:\Users\Neu\codex-web\start-server.cmd` — Autostart-Routine
- `C:\Users\Neu\codex-web\public\index.html / app.js / style.css` — Frontend
- `C:\Users\Neu\codex-web\server.log / server.err.log` — Logs
- `C:\Users\Neu\codex-web\report.md / final-report.md` — Berichte
- `C:\Users\Neu\Documents\!_000_neuer Workspace\!00-SK_central.station\opencode\COMPLETED.md` — Zusammenfassung
- `/test-sascha/Central-Station/2026-11_10_0500_codex-web-ui-lenovo.md` — Tagebuch
