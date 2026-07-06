# tv_1min_trader.ps1 — Enter a 1-min TradingView SMC trade on Alpaca
# Called by Claude after signal confirmed via TradingView LuxAlgo SMC indicator
# Usage: .\tv_1min_trader.ps1 -Sym AAPL -Dir LONG -Entry 189.50 -Stop 189.20 -T1 190.10 -T2 190.60 -AType stock

param(
    [string]$Sym,
    [string]$Dir,     # LONG or SHORT
    [double]$Entry,
    [double]$Stop,
    [double]$T1,
    [double]$T2,
    [string]$AType = "stock"  # stock or crypto
)

. "$PSScriptRoot\..\config.ps1"

$RISK_PCT    = if ($AType -eq "stock") { 0.05 } else { 0.04 }  # stocks 5%, crypto 4%
$MAX_POS_PCT = if ($AType -eq "stock") { 0.20 } else { 0.40 }  # stocks 20% cap, crypto 40%
$MAX_STOP_PCT = 1.0   # 1-min trades: reject if stop > 1% away

$STATE_FILE = "$PSScriptRoot\..\logs\tv_1min_state.json"
$TRADE_LOG  = "$PSScriptRoot\..\logs\tv_1min_trades.csv"

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}
$BASE = $env:APCA_API_BASE_URL

function Log-Trade($order, $note) {
    if (-not (Test-Path $TRADE_LOG)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price,note" | Out-File $TRADE_LOG -Encoding ascii
    }
    "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price),""$note""" | Add-Content $TRADE_LOG
}

function Get-DP($price, $atyp) {
    if ($atyp -eq "stock") { return 2 }
    if ([double]$price -ge 1000) { return 2 } elseif ([double]$price -ge 1) { return 4 } else { return 6 }
}

# ---- Validate inputs ----
if ($Dir -eq "LONG"  -and $Stop -ge $Entry) { Write-Error "LONG stop ($Stop) must be below entry ($Entry)"; exit 1 }
if ($Dir -eq "SHORT" -and $Stop -le $Entry) { Write-Error "SHORT stop ($Stop) must be above entry ($Entry)"; exit 1 }
if ($Dir -eq "LONG"  -and $T1 -le $Entry)  { Write-Error "LONG T1 ($T1) must be above entry ($Entry)";     exit 1 }
if ($Dir -eq "SHORT" -and $T1 -ge $Entry)  { Write-Error "SHORT T1 ($T1) must be below entry ($Entry)";    exit 1 }

$acct   = Invoke-RestMethod "$BASE/v2/account" -Headers $hdr
$equity = [double]$acct.equity
$dp     = Get-DP $Entry $AType

$stopDist = [math]::Abs($Entry - $Stop)
$stopPct  = ($stopDist / $Entry) * 100

if ($stopPct -gt $MAX_STOP_PCT) {
    Write-Error "Stop $([math]::Round($stopPct,2))% exceeds 1% max for 1-min scalp"
    exit 1
}

# Qty sizing: risk% drives it, max_pos% caps it
$qtyByRisk = ($equity * $RISK_PCT) / $stopDist
$qtyByMax  = ($equity * $MAX_POS_PCT) / $Entry

if ($AType -eq "crypto") {
    $qty   = [math]::Round([math]::Min($qtyByRisk, $qtyByMax), 4)
    $t1Qty = [math]::Round($qty * 0.50, 4)
    $t2Qty = [math]::Round($qty * 0.30, 4)
} else {
    $qty   = [math]::Min([math]::Floor($qtyByRisk), [math]::Floor($qtyByMax))
    $t1Qty = [math]::Floor($qty * 0.50)
    $t2Qty = [math]::Floor($qty * 0.30)
}

if ($qty -le 0) { Write-Error "Qty is zero. equity=$equity stop=$([math]::Round($stopPct,3))%"; exit 1 }

$rr = [math]::Round([math]::Abs($T1 - $Entry) / $stopDist, 2)
Write-Host "=== 1-MIN TRADE: $Sym $Dir ==="
Write-Host "Equity: `$$([math]::Round($equity,0)) | Risk: `$$([math]::Round($equity*$RISK_PCT,0)) | Qty: $qty | Stop: $([math]::Round($stopPct,3))% | RR: $rr"
Write-Host "Entry: $Entry | Stop: $Stop | T1: $T1 (qty=$t1Qty) | T2: $T2 (qty=$t2Qty)"

# ---- Entry: market order ----
# TIF rules:
#   Crypto  — gtc for all (market runs 24/7, no EOD expiry needed)
#   Stocks  — day for entry + T1 (expire at close, don't leave stale scalp orders),
#              gtc for stop (always protect the position, including after-hours)
$tifEntry = if ($AType -eq "crypto") { "gtc" } else { "day" }
$tifStop  = "gtc"   # stop must always survive after-hours / weekend gaps
$tifT1    = if ($AType -eq "crypto") { "gtc" } else { "day" }

$entrySide = if ($Dir -eq "LONG") { "buy" } else { "sell" }
$entryOrd  = Invoke-RestMethod "$BASE/v2/orders" -Method Post -Headers $hdr -Body (@{
    symbol        = $Sym
    qty           = "$qty"
    side          = $entrySide
    type          = "market"
    time_in_force = $tifEntry
} | ConvertTo-Json)
Write-Host "Entry: $($entryOrd.id) status=$($entryOrd.status)"
Log-Trade $entryOrd "1min_entry_$Dir"

Start-Sleep -Seconds 2

# ---- Stop: stop_limit on full qty — always gtc ----
$stopPrice = [math]::Round($Stop, $dp)
$stopLim   = if ($Dir -eq "LONG") {
    [math]::Round($Stop * 0.9975, $dp)
} else {
    [math]::Round($Stop * 1.0025, $dp)
}
$stopOrd = Invoke-RestMethod "$BASE/v2/orders" -Method Post -Headers $hdr -Body (@{
    symbol        = $Sym
    qty           = "$qty"
    side          = if ($Dir -eq "LONG") { "sell" } else { "buy" }
    type          = "stop_limit"
    stop_price    = $stopPrice
    limit_price   = $stopLim
    time_in_force = $tifStop
} | ConvertTo-Json)
Write-Host "Stop: $($stopOrd.id) @ $stopPrice (tif=gtc)"
Log-Trade $stopOrd "1min_stop"

# ---- T1: limit order for 50% qty ----
$t1Price = [math]::Round($T1, $dp)
$t1Ord   = Invoke-RestMethod "$BASE/v2/orders" -Method Post -Headers $hdr -Body (@{
    symbol        = $Sym
    qty           = "$t1Qty"
    side          = if ($Dir -eq "LONG") { "sell" } else { "buy" }
    type          = "limit"
    limit_price   = $t1Price
    time_in_force = $tifT1
} | ConvertTo-Json)
Write-Host "T1: $($t1Ord.id) @ $t1Price (qty=$t1Qty)"
Log-Trade $t1Ord "1min_t1"

# ---- Save state ----
$state = if (Test-Path $STATE_FILE) {
    Get-Content $STATE_FILE -Raw | ConvertFrom-Json
} else {
    [PSCustomObject]@{ positions = @() }
}

$newPos = [PSCustomObject]@{
    id            = $entryOrd.id
    symbol        = $Sym
    direction     = $Dir
    asset_type    = $AType
    entry_price   = $Entry
    stop_price    = $stopPrice
    stop_lim      = $stopLim
    stop_order_id = $stopOrd.id
    t1_price      = $T1
    t1_qty        = $t1Qty
    t1_order_id   = $t1Ord.id
    t1_fired      = $false
    t2_price      = $T2
    t2_qty        = $t2Qty
    t2_order_id   = $null
    t2_fired      = $false
    qty           = $qty
    highest_price = $Entry
    lowest_price  = $Entry
    opened_at     = (Get-Date -Format "o")
    managed_mode  = "tv_1min"
    timeframe     = "1min"
    phase         = "open"
}

$positions = @($state.positions) + @($newPos)
[PSCustomObject]@{ positions = $positions } | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding ascii
Write-Host "State saved ($($positions.Count) total positions)"
