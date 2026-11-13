# Agent-Status-Overlay: immer im Vordergrund, zeigt ob ein Agent arbeitet
# Start: powershell -WindowStyle Hidden -File overlay.ps1   (Ende: Fenster X)
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:USERPROFILE '.agent\overlay.log'
function Log([string]$m) { Add-Content -Path $logPath -Value ("{0:HH:mm:ss}  {1}" -f (Get-Date), $m) -ErrorAction SilentlyContinue }
try {
$script:statusPath = Join-Path $env:USERPROFILE '.agent\status.json'
Log 'start'

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Agent-Status" Width="360" Height="46" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent" Topmost="True"
        ShowInTaskbar="False" ShowActivated="False">
  <Border Name="Frame" CornerRadius="10" Background="#E6121216" BorderBrush="#8C1D18" BorderThickness="1" Padding="12,0,10,0">
    <Grid>
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Ellipse Name="Dot" Grid.Column="0" Width="10" Height="10" VerticalAlignment="Center" Fill="#8E8E93" Margin="0,0,9,0"/>
      <TextBlock Name="Txt" Grid.Column="1" Text="Agent ruht" VerticalAlignment="Center" Foreground="#F2F2F7" FontSize="12" TextTrimming="CharacterEllipsis"/>
      <TextBlock Name="Time" Grid.Column="2" Text="" VerticalAlignment="Center" Foreground="#98989F" FontSize="11" Margin="8,0,6,0"/>
      <Button Name="Close" Grid.Column="3" Content="✕" Background="Transparent" Foreground="#98989F" BorderThickness="0" FontSize="12" Cursor="Hand" VerticalAlignment="Center"/>
    </Grid>
  </Border>
</Window>
"@

$script:window = [System.Windows.Markup.XamlReader]::Parse($xaml)
$script:frame  = $window.FindName('Frame')
$script:dot    = $window.FindName('Dot')
$script:txt    = $window.FindName('Txt')
$script:tim    = $window.FindName('Time')
$script:closeB = $window.FindName('Close')

# Position: rechts oben unter der oberen Kante
$wa = [System.Windows.SystemParameters]::WorkArea
$window.Left = $wa.Right - $window.Width - 18
$window.Top  = $wa.Top + 10

# Ziehen mit der Maus
$window.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch {} })
$closeB.Add_Click({ $window.Close() })

function Set-Overlay([string]$fill, [string]$text, [string]$time, [bool]$pulse, [string]$border) {
  $dot.Fill = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString($fill))
  $frame.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString($border))
  $txt.Text = $text
  $tim.Text = $time
  $anim = New-Object System.Windows.Media.Animation.DoubleAnimation(1.0, 0.25, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(900))))
  $anim.RepeatBehavior = 'Forever'; $anim.AutoReverse = $true
  $opacityProp = [System.Windows.UIElement]::OpacityProperty
  if ($pulse) { $dot.BeginAnimation($opacityProp, $anim) }
  else { $dot.BeginAnimation($opacityProp, $null) }
}

$script:pulseAnim = $null
$script:timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
  $age = $null; $state = $null; $text = $null
  try {
    $j = Get-Content $statusPath -Raw -ErrorAction Stop | ConvertFrom-Json
    $ts = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$j.ts).LocalDateTime
    $age = [int]([DateTime]::Now - $ts).TotalSeconds
    $state = $j.state; $text = $j.text
  } catch {
    Set-Overlay '#8E8E93' 'Agent: kein Status' '' $false '#55555A'
    return
  }
  $ageTxt = if ($age -lt 60) { "$age s" } elseif ($age -lt 3600) { [string][int]($age / 60) + ' min' } else { [string][int]($age / 3600) + ' h' }
  if ($state -eq 'work' -and $age -lt 150) {
    Set-Overlay '#FF9F0A' ("Agent arbeitet · " + $text) $ageTxt $true '#FF9F0A'
  } else {
    Set-Overlay '#8E8E93' ("Agent ruht (Herzschlag " + $ageTxt + " her)") $null $false '#55555A'
  }
})
$window.Add_Closed({ $timer.Stop() })
$timer.Start()

$null = $window.ShowDialog()
} catch {
  Log ('ERROR: ' + $_.Exception.GetType().FullName + ' :: ' + $_.Exception.Message)
  if ($_.Exception.InnerException) { Log ('INNER: ' + $_.Exception.InnerException.Message) }
}