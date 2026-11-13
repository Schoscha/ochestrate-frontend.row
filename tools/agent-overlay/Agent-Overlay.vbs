' Agent-Overlay: startet das Status-Overlay unsichtbar bei jeder Anmeldung
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.agent\overlay.ps1""", 0, False
