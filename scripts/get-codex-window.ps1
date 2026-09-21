$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class CodexWindowNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

$target = Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue |
    Where-Object {
        $_.MainWindowHandle -ne 0 -and
        (($_.Path -like '*OpenAI.Codex_*') -or ($_.MainWindowTitle -match 'Codex|ChatGPT'))
    } |
    Select-Object -First 1

if (-not $target) {
    exit 0
}

$rect = New-Object CodexWindowNative+RECT
if (-not [CodexWindowNative]::GetWindowRect($target.MainWindowHandle, [ref]$rect)) {
    exit 0
}

[ordered]@{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
    visible = [CodexWindowNative]::IsWindowVisible($target.MainWindowHandle)
    minimized = [CodexWindowNative]::IsIconic($target.MainWindowHandle)
} | ConvertTo-Json -Compress
