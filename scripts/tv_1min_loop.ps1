# tv_1min_loop.ps1 — Runs position manager every 60s while TradingView is open
# Run this in a terminal when you start TradingView for 1-min trading
# Ctrl+C to stop

Write-Host "=== 1-MIN POSITION LOOP STARTED ==="
Write-Host "Checking positions every 60s. Press Ctrl+C to stop."
Write-Host ""

while ($true) {
    try {
        & "$PSScriptRoot\tv_1min_positions.ps1"
    } catch {
        Write-Host "$(Get-Date -Format HH:mm:ss) Error: $($_.Exception.Message)"
    }
    Write-Host "--- Sleeping 60s ---"
    Start-Sleep -Seconds 60
}
