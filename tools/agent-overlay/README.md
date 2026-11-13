# Agent-Overlay (Desktop-Statusanzeige)

Kleines Always-on-Top-Fenster für den Agenten-PC (Lenovo), das live zeigt, ob ein Agent
(Claude Code, OpenCode, Hermes …) gerade arbeitet. **Kein Browser, kein Frontend** —
reines WPF via PowerShell, keine Abhängigkeiten.

## Funktionsweise

- Der Agent schreibt bei jedem Arbeitsschritt einen **Herzschlag** nach
  `%USERPROFILE%\.agent\status.json` (state, text, agent, ts).
- Das Overlay liest die Datei jede Sekunde:
  - `work` + Herzschlag jünger als 150 s → **orange pulsierend**: „Agent arbeitet · <Text>"
  - sonst → **grau**: „Agent ruht (Herzschlag <Alter> her)"
  - Datei fehlt/fehlerhaft → „Agent: kein Status"
- Fenster: rechts oben, dunkel, verschiebbar (Maus), ✕-Schließen, Topmost, keine Taskleiste.

## Installation

1. Dateien kopieren nach `%USERPROFILE%\.agent\` (overlay.ps1, set-status.ps1).
2. Autostart: `Agent-Overlay.vbs` in
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\` legen.

## Bedienung (für Agenten)

Herzschlag beim Beginn eines Arbeitsschritts setzen, am Ende auf idle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.agent\set-status.ps1" -State work -Text "was ich gerade tue"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.agent\set-status.ps1" -State idle
```

Screenshot-Beleg des Overlays (einzeln einfangen, weil `CopyFromScreen` Layered Windows
nicht erfasst): `shot-overlay.ps1`.

## Debugging

- `overlay.ps1` schreibt Fehler nach `%USERPROFILE%\.agent\overlay.log`.
- Datei muss **UTF-8 mit BOM** sein (Windows PowerShell 5.1 liest ohne BOM als ANSI).
- Fehlerklasse: `[System.Windows.UIElement]::OpacityProperty` (nicht `System.Windows.Media.*`).
