# Opens Zalo minimized to the taskbar, for tests, so it does not cover the window in use, then or later.
# powershell -ExecutionPolicy Bypass -File scripts/zalo-behind.ps1 [-Exe <Zalo.exe>] [-ZaloArgs "<arguments>"]
# Zalo restores its own window a moment after it shows (measured 11/2026: minimized at 7.5 s, back at 7.9 s),
# so while it loads, a Zalo window that is not minimized is minimized again. The keyboard goes back to the window
# that was in use only while Zalo holds it (doing so every moment blocked the user's clicks).
param(
  [string]$Exe = "$env:LOCALAPPDATA\Programs\Zalo\Zalo.exe",
  [string]$ZaloArgs = ''
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ZenloWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@

# SW_SHOWMINNOACTIVE: minimized, and the window in use stays active
$SW_SHOWMINNOACTIVE = 7
# The window in use now gets the keyboard back if minimized Zalo keeps it
$previous = [ZenloWin]::GetForegroundWindow()

# Zenlo inside Zalo then keeps Zalo's windows from coming up by themselves for as long as it runs
$env:ZENLO_BEHIND = '1'

if ($ZaloArgs) { Start-Process -FilePath $Exe -ArgumentList $ZaloArgs -WorkingDirectory (Split-Path $Exe) -WindowStyle Minimized }
else { Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) -WindowStyle Minimized }

# Zalo.exe in the root folder only starts the real Zalo and exits, so its window comes later: wait for it,
# then keep it minimized until Zalo has finished loading
$firstSeen = $null
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  foreach ($p in (Get-Process -Name Zalo -ErrorAction SilentlyContinue)) {
    $hwnd = $p.MainWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) { continue }
    if (-not $firstSeen) { $firstSeen = Get-Date }
    if (-not [ZenloWin]::IsIconic($hwnd)) { [void][ZenloWin]::ShowWindow($hwnd, $SW_SHOWMINNOACTIVE) }
  }
  # Only while Zalo holds the keyboard, so a click elsewhere is never undone
  $frontPid = 0
  [void][ZenloWin]::GetWindowThreadProcessId([ZenloWin]::GetForegroundWindow(), [ref]$frontPid)
  $zaloPids = @(Get-Process -Name Zalo -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($previous -ne [IntPtr]::Zero -and $zaloPids -contains [int]$frontPid) { [void][ZenloWin]::SetForegroundWindow($previous) }
  if ($firstSeen -and ((Get-Date) - $firstSeen).TotalSeconds -gt 20) { break }
  Start-Sleep -Milliseconds 100
}
