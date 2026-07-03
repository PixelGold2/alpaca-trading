# stock_session.ps1 - MTF entry scanner for stocks and indices.
# Runs during market hours. Scans indices + top stocks, enters highest-scoring setups.
# Partial exits: 50% at T1 (1R), 30% at T2 (2R), trail 20% with 5% stop.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE  = "$PSScriptRoot\..\logs\stock_session_state.json"
$NARR_LOG    = "$PSScriptRoot\..\logs\stock_session_log.csv"
$TRADE_LOG   = "$PSScriptRoot\..\logs\trades_log.csv"

$PAIRS = @(
    "SPY","QQQ","IWM","DIA",
    "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","JPM"
)

$MAX_POSITIONS = 4
$RISK_PCT      = 0.007   # 0.7% equity risk per trade
$MAX_POS_PCT   = 0.10    # 10% equity max per position
$MIN_SCORE     = 7.0
$T1_PCT        = 0.50
$T2_PCT        = 0.30
$TRAIL_PCT     = 0.20

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

function Write-Narr($msg) {
    if (-not (Test-Path $NARR_LOG)) { "timestamp,message" | Out-File $NARR_LOG -Encoding utf8 }
    $safe = $msg -replace '"', "'"
    "$(Get-Date -Format o),""$safe""" | Add-Content $NARR_LOG
    Write-Output $msg
}

function Log-Trade($order, $note) {
    if (-not (Test-Path $TRADE_LOG)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price,note" | Out-File $TRADE_LOG -Encoding utf8
    }
    "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price),""$note""" | Add-Content $TRADE_LOG
}

function Get-Account { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $alpacaHeaders }

function Get-StockPosition($sym) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$sym" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return [PSCustomObject]@{ positions = @(); session_started = $null }
}

function Save-State($s) { $s | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8 }
function TruncQty($qty) { return [math]::Floor([double]$qty * 100) / 100 }
function RoundPx($p) { return [math]::Round($p, 2) }

function Place-MarketBuy($sym, $qty) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="day" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "stock_entry"; return $o
}

function Place-StopLimit($sym, $qty, $stop, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=(RoundPx $stop); limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "stock_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"
               limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "stock_t1"; return $o
}

# ---- MAIN -------------------------------------------------------------------

$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity

if (-not $state.session_started) { $state.session_started = (Get-Date -Format o); Save-State $state }

Write-Narr "=== STOCK SESSION: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Equity: $([math]::Round($equity,0)) ==="

$activePairs = @()
foreach ($p in @($state.positions | Where-Object { $_.managed_mode -eq "stock" })) {
    if (Get-StockPosition $p.symbol) { $activePairs += $p.symbol }
}
$slots = $MAX_POSITIONS - $activePairs.Count
Write-Narr "Active stock positions: $($activePairs.Count)/$MAX_POSITIONS"
if ($slots -le 0) { Write-Narr "All slots full."; exit }

Write-Narr "Scanning $($PAIRS.Count) symbols (min score $MIN_SCORE)..."
$candidates = @()
foreach ($sym in $PAIRS) {
    if ($activePairs -contains $sym) { continue }
    Write-Host "  Analyzing $sym..." -ForegroundColor Cyan
    $out = $null
    try { $out = (powershell.exe -NonInteractive -File "$PSScriptRoot\stock_analyzer.ps1" -Symbol $sym 2>&1) | Out-String | ConvertFrom-Json }
    catch { Write-Narr "  $sym - error"; continue }
    if (-not $out) { continue }
    if ($out.signal -in @("SKIP","ERROR","INSUFFICIENT_DATA")) {
        $reason = if ($out.reason) { $out.reason } else { $out.signal }
        Write-Narr "  $sym - $reason"
        continue
    }
    if ([double]$out.score -lt $MIN_SCORE) { Write-Narr "  $sym - score $($out.score) < $MIN_SCORE"; continue }
    if ($out.stop_pct -gt 5.0) { Write-Narr "  $sym - stop $($out.stop_pct)% too wide"; continue }
    Write-Narr "  $sym - QUALIFIED score=$($out.score) D-RSI=$($out.daily_rsi) 1H-RSI=$($out.h1_rsi) stop=$($out.stop_pct)%"
    $candidates += $out
}

if ($candidates.Count -eq 0) { Write-Narr "No stock setups qualified."; exit }

$ranked = @($candidates | Sort-Object { [double]$_.score } -Descending)
Write-Narr "=== QUALIFIED STOCK SETUPS ==="
foreach ($c in $ranked) {
    $rStr = ($c.reasons | Select-Object -First 3) -join " + "
    Write-Narr "  $($c.symbol) score=$($c.score) ($($c.signal)) price=$($c.price) | $rStr"
}

$entered = 0
foreach ($c in $ranked) {
    if ($entered -ge $slots) { break }

    $sym      = $c.symbol
    $price    = [double]$c.price
    $stopDist = $price - [double]$c.stop_price
    if ($stopDist -le 0) { continue }

    $qty    = TruncQty (($equity * $RISK_PCT) / $stopDist)
    $maxQty = TruncQty (($equity * $MAX_POS_PCT) / $price)
    if ($qty -gt $maxQty) { $qty = $maxQty }
    if ($qty -le 0) { continue }

    $notional = [math]::Round($qty * $price, 2)
    Write-Narr "ENTERING $sym | score=$($c.score) price=$price qty=$qty (~`$$notional) stop=$($c.stop_price) T1=$($c.t1_price) T2=$($c.t2_price)"

    try {
        $buyOrder  = Place-MarketBuy $sym $qty
        $fillPrice = if ([double]$buyOrder.filled_avg_price -gt 0) { [double]$buyOrder.filled_avg_price } else { $price }
        $fillQty   = if ([double]$buyOrder.filled_qty -gt 0) { [double]$buyOrder.filled_qty } else { $qty }
        Write-Narr "$sym - Filled: $fillQty @ $(RoundPx $fillPrice)"

        $fillStop  = RoundPx ([double]$c.stop_price)
        $fillStopL = RoundPx ($fillStop * 0.9975)
        $fillT1    = RoundPx ($fillPrice + $stopDist * 1.0)
        $fillT2    = RoundPx ($fillPrice + $stopDist * 2.0)

        $t1Qty    = TruncQty ($fillQty * $T1_PCT)
        $t2Qty    = TruncQty ($fillQty * $T2_PCT)
        $trailQty = TruncQty ($fillQty - $t1Qty - $t2Qty)

        $stopId = $null; $t1Id = $null; $phase = "pending"

        try {
            $sOrd   = Place-StopLimit $sym $fillQty $fillStop $fillStopL
            $stopId = $sOrd.id; Write-Narr "$sym - Stop at $fillStop (order $stopId)"
        } catch { Write-Narr "$sym - Stop failed: $($_.Exception.Message)" }

        try {
            $t1Ord = Place-LimitSell $sym $t1Qty $fillT1
            $t1Id  = $t1Ord.id; Write-Narr "$sym - T1 limit at $fillT1 for $t1Qty (order $t1Id)"
        } catch { Write-Narr "$sym - T1 limit failed: $($_.Exception.Message)" }

        if ($stopId) { $phase = "active" }

        $pos = [ordered]@{
            symbol        = $sym
            managed_mode  = "stock"
            phase         = $phase
            entry_price   = RoundPx $fillPrice
            total_qty     = $fillQty
            t1_qty        = $t1Qty
            t2_qty        = $t2Qty
            trail_qty     = $trailQty
            stop_price    = $fillStop
            stop_lim      = $fillStopL
            t1_price      = $fillT1
            t2_price      = $fillT2
            t1_fired      = $false
            t2_fired      = $false
            stop_order_id = $stopId
            t1_order_id   = $t1Id
            t2_order_id   = $null
            order_id      = $buyOrder.id
            opened_at     = (Get-Date -Format o)
            score         = $c.score
            daily_rsi     = $c.daily_rsi
            h1_rsi        = $c.h1_rsi
        }

        $state.positions = @($state.positions) + @($pos)
        Save-State $state
        $riskAmt = [math]::Round($fillQty * ($fillPrice - $fillStop), 2)
        Write-Narr "$sym LIVE | fill=$(RoundPx $fillPrice) stop=$fillStop risk=`$$riskAmt T1=$fillT1 T2=$fillT2"
        $entered++

    } catch { Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)" }
}

Write-Narr "=== Done: $entered stock entries. ==="


