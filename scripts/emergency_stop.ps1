# emergency_stop.ps1 - Kills the master loop and optionally closes all positions.
# Usage: .\emergency_stop.ps1 [-ClosePositions]
param([switch]$ClosePositions)

. "$PSScriptRoot\..\config.ps1"

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

Write-Host "=== EMERGENCY STOP ===" -ForegroundColor Red

# Kill master_loop.ps1 PowerShell processes
$killed = 0
Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
    $cmdLine = $_.CommandLine
    if ($cmdLine -like "*master_loop*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Killed master_loop process (PID $($_.ProcessId))" -ForegroundColor Yellow
        $killed++
    }
}
if ($killed -eq 0) { Write-Host "No master_loop process found running." -ForegroundColor Gray }

# Cancel ALL open orders
Write-Host "Cancelling all open orders..."
try {
    $orders = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders?status=open" -Method Get -Headers $alpacaHeaders
    if ($orders.Count -gt 0) {
        Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Delete -Headers $alpacaHeaders | Out-Null
        Write-Host "Cancelled $($orders.Count) open order(s)." -ForegroundColor Yellow
    } else { Write-Host "No open orders." -ForegroundColor Gray }
} catch { Write-Host "Order cancel error: $($_.Exception.Message)" -ForegroundColor Red }

# Close all positions if requested
if ($ClosePositions) {
    Write-Host "Closing ALL positions (market sell)..." -ForegroundColor Red
    try {
        $positions = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions" -Method Get -Headers $alpacaHeaders
        if ($positions.Count -gt 0) {
            Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions?cancel_orders=true" -Method Delete -Headers $alpacaHeaders | Out-Null
            Write-Host "Closed $($positions.Count) position(s)." -ForegroundColor Yellow
        } else { Write-Host "No open positions." -ForegroundColor Gray }
    } catch { Write-Host "Position close error: $($_.Exception.Message)" -ForegroundColor Red }
} else {
    Write-Host "Positions left open with GTC stops intact. Run with -ClosePositions to also flatten." -ForegroundColor Cyan
}

# Clear state files so master_loop starts fresh on next run
$stateFiles = @(
    "$PSScriptRoot\..\logs\bounce_session_state.json",
    "$PSScriptRoot\..\logs\mtf_session_state.json",
    "$PSScriptRoot\..\logs\stock_session_state.json"
)
foreach ($f in $stateFiles) {
    if (Test-Path $f) { Remove-Item $f -Force; Write-Host "Cleared: $(Split-Path $f -Leaf)" -ForegroundColor Gray }
}

Write-Host "=== STOP COMPLETE ===" -ForegroundColor Red

