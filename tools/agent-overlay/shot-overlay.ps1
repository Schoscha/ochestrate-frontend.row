param(
  [string]$State = '',
  [string]$Text  = '',
  [string]$Out   = 'C:\Users\Neu\AppData\Local\Temp\opencode\overlay-shot.png'
)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class OF {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int L, T, R, B; }
  public static IntPtr Find() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == "Agent-Status") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@ -ErrorAction SilentlyContinue

if ($State) {
  $args2 = @('-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\Neu\.agent\set-status.ps1','-State',$State)
  if ($Text) { $args2 += @('-Text',$Text) }
  & powershell $args2 | Out-Null
  Start-Sleep 2
}

$h = [OF]::Find()
if ($h -eq [IntPtr]::Zero) { 'NO-WINDOW'; exit 1 }
$r = New-Object OF+RECT
[void][OF]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
$ok = [OF]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out); $bmp.Dispose()
"ok=$ok hwnd=$h saved=$Out"
