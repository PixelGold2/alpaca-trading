# tick.ps1 - Single trading tick for GitHub Actions.
# GitHub Actions calls this every 5 min via cron. No loop needed.

if (-not $env:APCA_API_KEY_ID) { . "$PSScriptRoot\..\config.ps1" }

$LOGS_DIR     = "$PSScriptRoot\..\logs"
$BOUNCE_STATE = "$LOGS_DIR\bounce_session_state.json"
$MTF_STATE    = "$LOGS_DIR\mtf_session_state.json"
$SMC_STATE    = "$LOGS_DIR\smc_session_state.json"
$MASTER_LOG   = "$LOGS_DIR\master_loop_log.csv"

$PS = if ($IsWindows) { "powershell.exe" } else { "pwsh" }

if (-not (Test-Path $LOGS_DIR)) { New-Item -ItemType Directory -Path $LOGS_DIR -Force | Out-Null }

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Output "$ts | $msg"
    if (-not (Test-Path $MASTER_LOG)) { "timestamp,message" | Out-File $MASTER_LOG -Encoding ascii }
    $safe = $msg -replace '"',"'"
    "$ts,""$safe""" | Add-Content $MASTER_LOG
}

function Has-Positions($path, $mode) {
    if (-not (Test-Path $path)) { return $false }
    try {
        $s = Get-Content $path -Raw | ConvertFrom-Json
        return (@($s.positions | Where-Object { $_.managed_mode -eq $mode }).Count -gt 0)
    } catch { return $false }
}

function Count-Positions($path, $mode) {
    if (-not (Test-Path $path)) { return 0 }
    try {
        $s = Get-Content $path -Raw | ConvertFrom-Json
        return @($s.positions | Where-Object { $_.managed_mode -eq $mode }).Count
    } catch { return 0 }
}

function Run-Script($label, $file) {
    try { & $PS -ExecutionPolicy Bypass -NonInteractive -File $file | ForEach-Object { Write-Log "  [$label] $_" } }
    catch { Write-Log "  [$label] Error: $($_.Exception.Message)" }
}

Write-Log "=== TICK: $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="

# ---- LEGACY: Manage existing bounce/MTF positions until they close naturally ----
if (Has-Positions $BOUNCE_STATE "bounce") {
    Run-Script "bounce" "$PSScriptRoot\manage_bounce_positions.ps1"
}
if (Has-Positions $MTF_STATE "mtf") {
    Run-Script "mtf" "$PSScriptRoot\manage_mtf_positions.ps1"
}

# ---- SMC: Manage open positions every tick ----
Run-Script "smc-manage" "$PSScriptRoot\manage_smc_positions.ps1"

# ---- Market status ----
$mkt = try { & "$PSScriptRoot\market_hours.ps1" } catch { [PSCustomObject]@{ IsOpen=$false } }
Write-Log "Market: $(if ($mkt.IsOpen) { 'OPEN' } else { 'CLOSED' })"

# ---- SMC: Scan for new entries ----
$smcCount = Count-Positions $SMC_STATE "smc"
$smcSlots = 3 - $smcCount
Write-Log "SMC slots: $smcCount/3 used, $smcSlots free"

if ($smcSlots -gt 0) {
    $min = (Get-Date).Minute
    # Crypto: scan every 30 min (always), Stocks: scan every 30 min when market open
    $shouldScan = ($min -lt 5) -or ($min -ge 30 -and $min -lt 35)
    if ($shouldScan) {
        Write-Log "Launching SMC scanner ($smcSlots slot(s) free)..."
        Run-Script "smc-scan" "$PSScriptRoot\smc_session.ps1"
    }
}

Write-Log "=== TICK DONE ==="
