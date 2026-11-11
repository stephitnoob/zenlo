# Opens Zalo behind the window in use (the code editor), for tests that restart Zalo.
# powershell -ExecutionPolicy Bypass -File scripts/zalo-behind.ps1 [-Exe <Zalo.exe>] [-ZaloArgs "<arguments>"]
param(
  [string]$Exe = "$env:LOCALAPPDATA\Programs\Zalo\Zalo.exe",
  [string]$ZaloArgs = ''
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ZenloWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@

$previous = [ZenloWin]::GetForegroundWindow()
$HWND_BOTTOM = [IntPtr]1
# SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
$flags = 0x0001 -bor 0x0002 -bor 0x0010

if ($ZaloArgs) { Start-Process -FilePath $Exe -ArgumentList $ZaloArgs -WorkingDirectory (Split-Path $Exe) }
else { Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) }

# Zalo shows a window and may raise itself again while it loads: keep sending it back for a while
$firstSeen = $null
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  $windows = Get-Process -Name Zalo -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
  foreach ($p in $windows) { [void][ZenloWin]::SetWindowPos($p.MainWindowHandle, $HWND_BOTTOM, 0, 0, 0, 0, $flags) }
  if ($windows) {
    if (-not $firstSeen) { $firstSeen = Get-Date }
    $front = [ZenloWin]::GetForegroundWindow()
    $frontPid = 0
    [void][ZenloWin]::GetWindowThreadProcessId($front, [ref]$frontPid)
    if ($previous -ne [IntPtr]::Zero -and ($windows.Id -contains $frontPid)) { [void][ZenloWin]::SetForegroundWindow($previous) }
    if (((Get-Date) - $firstSeen).TotalSeconds -gt 12) { break }
  }
  Start-Sleep -Milliseconds 150
}
