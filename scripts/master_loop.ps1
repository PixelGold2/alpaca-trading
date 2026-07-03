# master_loop.ps1 - 24/7 trading coordinator.
# Every 5 min: manages all open positions.
# Crypto: scans for new entries when slots free, resets session every 5 hours.
# Stocks: scans during market hours only, holds GTC stops overnight.
# Run once at startup; leave running in a minimized PowerShell window.

. "$PSScriptRoot\..\config.ps1"

$MASTER_LOG        = "$PSScriptRoot\..\logs\master_loop_log.csv"
$CRYPTO_STATE      = "$PSScriptRoot\..\logs\bounce_session_state.json"
$MTF_STATE         = "$PSScriptRoot\..\logs\mtf_session_state.json"
$STOCK_STATE       = "$PSScriptRoot\..\logs\stock_session_state.json"
$CRYPTO_SESSION_H  = 5    # reset crypto scan every N hours
$STOCK_SESSION_H   = 1    # re-scan stocks every hour during market hours
$LOOP_INTERVAL_S   = 300  # 5 minutes

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts | $msg"
    Write-Output $line
    if (-not (Test-Path $MASTER_LOG)) { "timestamp,message" | Out-File $MASTER_LOG -Encoding utf8 }
    $safe = $msg -replace '"',"'"
    "$ts,""$safe""" | Add-Content $MASTER_LOG
}

function Reset-State($path) {
    if (Test-Path $path) { Remove-Item $path -Force }
}

function Get-SessionAge($path) {
    if (-not (Test-Path $path)) { return 999 }
    $s = Get-Content $path -Raw | ConvertFrom-Json
    if (-not $s.session_started) { return 999 }
    return ((Get-Date) - [DateTime]::Parse($s.session_started)).TotalHours
}

function Has-OpenPositions($path, $mode) {
    if (-not (Test-Path $path)) { return $false }
    $s = Get-Content $path -Raw | ConvertFrom-Json
    if (-not $s.positions) { return $false }
    return ($s.positions | Where-Object { $_.managed_mode -eq $mode }).Count -gt 0
}

Write-Log "=== MASTER LOOP STARTED ==="
Write-Log "Crypto session: every $CRYPTO_SESSION_H hours | Stock scan: every $STOCK_SESSION_H hours during market hours"
Write-Log "Loop interval: $LOOP_INTERVAL_S seconds | Press Ctrl+C to stop."

$lastStockScan = [DateTime]::MinValue

while ($true) {
    $now = Get-Date
    Write-Log "--- Tick: $($now.ToString('HH:mm:ss')) ---"

    # ---- CRYPTO LIFECYCLE (always) ----
    try {
        Write-Log "Running bounce manager..."
        powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\manage_bounce_positions.ps1" | ForEach-Object { Write-Log "  [bounce] $_" }
    } catch { Write-Log "  [bounce] Manager error: $($_.Exception.Message)" }

    try {
        Write-Log "Running MTF manager..."
        powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\manage_mtf_positions.ps1" | ForEach-Object { Write-Log "  [mtf] $_" }
    } catch { Write-Log "  [mtf] Manager error: $($_.Exception.Message)" }

    # ---- CRYPTO SESSION RESET + SCAN ----
    $bounceAge = Get-SessionAge $CRYPTO_STATE
    $mtfAge    = Get-SessionAge $MTF_STATE

    if ($bounceAge -ge $CRYPTO_SESSION_H) {
        $hasOpen = Has-OpenPositions $CRYPTO_STATE "bounce"
        if (-not $hasOpen) {
            Write-Log "Crypto bounce session expired ($([math]::Round($bounceAge,1))h). Resetting and scanning..."
            Reset-State $CRYPTO_STATE
            try {
                powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\bounce_session.ps1" | ForEach-Object { Write-Log "  [bounce-scan] $_" }
            } catch { Write-Log "  [bounce-scan] Error: $($_.Exception.Message)" }
        } else {
            Write-Log "Bounce session expired but positions still open. Waiting for close."
        }
    }

    if ($mtfAge -ge $CRYPTO_SESSION_H) {
        $hasOpen = Has-OpenPositions $MTF_STATE "mtf"
        if (-not $hasOpen) {
            Write-Log "MTF session expired ($([math]::Round($mtfAge,1))h). Resetting and scanning..."
            Reset-State $MTF_STATE
            try {
                powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\mtf_session.ps1" | ForEach-Object { Write-Log "  [mtf-scan] $_" }
            } catch { Write-Log "  [mtf-scan] Error: $($_.Exception.Message)" }
        } else {
            Write-Log "MTF session expired but positions still open. Waiting for close."
        }
    }

    # ---- STOCK LIFECYCLE (market hours only) ----
    $mktHours = & "$PSScriptRoot\market_hours.ps1"
    if ($mktHours.IsOpen) {
        try {
            Write-Log "Market open. Running stock manager..."
            powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\manage_stock_positions.ps1" | ForEach-Object { Write-Log "  [stock] $_" }
        } catch { Write-Log "  [stock] Manager error: $($_.Exception.Message)" }

        # Scan for new stock entries every STOCK_SESSION_H hours
        $stockScanAge = ($now - $lastStockScan).TotalHours
        if ($stockScanAge -ge $STOCK_SESSION_H) {
            $hasOpenStock = Has-OpenPositions $STOCK_STATE "stock"
            $stockState   = if (Test-Path $STOCK_STATE) { (Get-Content $STOCK_STATE -Raw | ConvertFrom-Json) } else { $null }
            $stockSlots   = 3 - ($stockState.positions | Where-Object { $_.managed_mode -eq "stock" } | Measure-Object).Count
            if ($stockSlots -gt 0) {
                Write-Log "Scanning for stock setups ($stockSlots slot(s) free)..."
                try {
                    powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\stock_session.ps1" | ForEach-Object { Write-Log "  [stock-scan] $_" }
                } catch { Write-Log "  [stock-scan] Error: $($_.Exception.Message)" }
            } else {
                Write-Log "Stock slots full (3/3). No scan needed."
            }
            $lastStockScan = $now
        }
    } else {
        Write-Log "Market closed. Skipping stock scan."
        # Still manage stock positions (check GTC stops via order status)
        if (Has-OpenPositions $STOCK_STATE "stock") {
            try {
                powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\manage_stock_positions.ps1" | ForEach-Object { Write-Log "  [stock-afterhours] $_" }
            } catch { Write-Log "  [stock-afterhours] Error: $($_.Exception.Message)" }
        }
    }

    Write-Log "--- Tick done. Sleeping $LOOP_INTERVAL_S s ---"
    Start-Sleep -Seconds $LOOP_INTERVAL_S
}


