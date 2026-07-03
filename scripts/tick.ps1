# tick.ps1 - Single trading tick for GitHub Actions.
# GitHub Actions calls this every 5 min via cron. No loop needed.

# Use env vars (set by GitHub Secrets in cloud, or config.ps1 locally)
if (-not $env:APCA_API_KEY_ID) { . "$PSScriptRoot\..\config.ps1" }

$LOGS_DIR     = "$PSScriptRoot\..\logs"
$CRYPTO_STATE = "$LOGS_DIR\bounce_session_state.json"
$MTF_STATE    = "$LOGS_DIR\mtf_session_state.json"
$STOCK_STATE  = "$LOGS_DIR\stock_session_state.json"
$MASTER_LOG   = "$LOGS_DIR\master_loop_log.csv"
$CRYPTO_H     = 5

$PS = if ($IsWindows) { "powershell.exe" } else { "pwsh" }

if (-not (Test-Path $LOGS_DIR)) { New-Item -ItemType Directory -Path $LOGS_DIR -Force | Out-Null }

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Output "$ts | $msg"
    if (-not (Test-Path $MASTER_LOG)) { "timestamp,message" | Out-File $MASTER_LOG -Encoding utf8 }
    $safe = $msg -replace '"',"'"
    "$ts,""$safe""" | Add-Content $MASTER_LOG
}

function Get-SessionAge($path) {
    if (-not (Test-Path $path)) { return 999 }
    try {
        $s = Get-Content $path -Raw | ConvertFrom-Json
        if (-not $s.session_started) { return 999 }
        return ((Get-Date) - [DateTime]::Parse($s.session_started)).TotalHours
    } catch { return 999 }
}

function Has-Positions($path, $mode) {
    if (-not (Test-Path $path)) { return $false }
    try {
        $s = Get-Content $path -Raw | ConvertFrom-Json
        return ($s.positions | Where-Object { $_.managed_mode -eq $mode }).Count -gt 0
    } catch { return $false }
}

function Run-Script($label, $file) {
    try { & $PS -ExecutionPolicy Bypass -NonInteractive -File $file | ForEach-Object { Write-Log "  [$label] $_" } }
    catch { Write-Log "  [$label] Error: $($_.Exception.Message)" }
}

Write-Log "=== TICK: $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="

# ---- CRYPTO: manage positions every tick ----
Run-Script "bounce" "$PSScriptRoot\manage_bounce_positions.ps1"
Run-Script "mtf"    "$PSScriptRoot\manage_mtf_positions.ps1"

# ---- CRYPTO: rescan when session expires and no open positions ----
if ((Get-SessionAge $CRYPTO_STATE) -ge $CRYPTO_H -and -not (Has-Positions $CRYPTO_STATE "bounce")) {
    Write-Log "Bounce session expired. Resetting..."
    Remove-Item $CRYPTO_STATE -Force -ErrorAction SilentlyContinue
    Run-Script "bounce-scan" "$PSScriptRoot\bounce_session.ps1"
}
if ((Get-SessionAge $MTF_STATE) -ge $CRYPTO_H -and -not (Has-Positions $MTF_STATE "mtf")) {
    Write-Log "MTF session expired. Resetting..."
    Remove-Item $MTF_STATE -Force -ErrorAction SilentlyContinue
    Run-Script "mtf-scan" "$PSScriptRoot\mtf_session.ps1"
}

# ---- STOCKS: market hours only ----
$mkt = & "$PSScriptRoot\market_hours.ps1"
if ($mkt.IsOpen) {
    Run-Script "stock" "$PSScriptRoot\manage_stock_positions.ps1"

    # Scan for new stocks every 30 min (when minute < 5 on the half-hour)
    $min = (Get-Date).Minute
    $shouldScan = ($min -lt 5) -or ($min -ge 30 -and $min -lt 35)
    if ($shouldScan) {
        $stockState = if (Test-Path $STOCK_STATE) { (Get-Content $STOCK_STATE -Raw | ConvertFrom-Json) } else { $null }
        $slots = 3 - (($stockState.positions | Where-Object { $_.managed_mode -eq "stock" } | Measure-Object).Count)
        if ($slots -gt 0) {
            Write-Log "Scanning stocks ($slots slot(s) free)..."
            Run-Script "stock-scan" "$PSScriptRoot\stock_session.ps1"
        }
    }
} else {
    Write-Log "Market closed."
    if (Has-Positions $STOCK_STATE "stock") { Run-Script "stock-afterhours" "$PSScriptRoot\manage_stock_positions.ps1" }
}

Write-Log "=== TICK DONE ==="


