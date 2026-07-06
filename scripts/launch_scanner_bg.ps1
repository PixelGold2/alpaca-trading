# launch_scanner_bg.ps1 — Start/stop the background SMC scanner
# Usage: .\launch_scanner_bg.ps1          (start)
#        .\launch_scanner_bg.ps1 -Stop    (stop)
#        .\launch_scanner_bg.ps1 -Status  (check)

param(
    [switch]$Stop,
    [switch]$Status
)

$PID_FILE = "$PSScriptRoot\..\logs\tv_scanner.pid"
$SCAN_LOG  = "$PSScriptRoot\..\logs\tv_scanner.log"
$SCRIPT    = "$PSScriptRoot\tv_1min_scanner.ps1"

if ($Status) {
    if (Test-Path $PID_FILE) {
        $savedPid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
        $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Scanner RUNNING (PID $savedPid, started $($proc.StartTime))"
        } else {
            Write-Host "Scanner NOT running (stale PID file)"
        }
    } else {
        Write-Host "Scanner NOT running (no PID file)"
    }
    if (Test-Path $SCAN_LOG) {
        Write-Host "`nLast 5 log lines:"
        Get-Content $SCAN_LOG -Tail 5
    }
    exit
}

if ($Stop) {
    if (-not (Test-Path $PID_FILE)) { Write-Host "Scanner not running."; exit }
    $savedPid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
    $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $savedPid -Force
        Write-Host "Scanner stopped (PID $savedPid)."
    } else {
        Write-Host "No process found for PID $savedPid (already stopped)."
    }
    Remove-Item $PID_FILE -ErrorAction SilentlyContinue
    exit
}

# --- START ---
if (Test-Path $PID_FILE) {
    $savedPid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
    $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Scanner already running (PID $savedPid). Use -Stop first."
        exit
    }
}

$p = Start-Process powershell.exe `
    -ArgumentList "-NonInteractive -File `"$SCRIPT`"" `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Background scanner started (PID $($p.Id))."
Write-Host "Log:  $SCAN_LOG"
Write-Host "Stop: .\launch_scanner_bg.ps1 -Stop"
Write-Host "Check: .\launch_scanner_bg.ps1 -Status"
