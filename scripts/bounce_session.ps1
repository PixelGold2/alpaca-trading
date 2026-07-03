# bounce_session.ps1 - Oversold bounce strategy entry scanner.
# Finds deeply-oversold crypto where 4H MACD is turning and 1H is building.
# Partial exits: 50pct at T1 (1.5R), 30pct at T2 (2.5R), trail 20pct with 4pct stop.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE  = "$PSScriptRoot\..\logs\bounce_session_state.json"
$NARR_LOG    = "$PSScriptRoot\..\logs\bounce_session_log.csv"
$TRADE_LOG   = "$PSScriptRoot\..\logs\trades_log.csv"

$PAIRS         = @("BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","BCH/USD","LTC/USD","DOGE/USD")
$SESSION_HOURS = 5
$MAX_POSITIONS = 3
$RISK_PCT      = 0.005    # 0.5pct per trade - conservative since counter-trend
$MAX_POS_PCT   = 0.08     # max 8pct equity per position
$MIN_SCORE     = 5.0
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

function Get-CryptoPosition($sym) {
    $noSlash = $sym -replace "/", ""
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$noSlash" -Method Get -Headers $alpacaHeaders }
    catch { }
    $enc = [uri]::EscapeDataString($sym)
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$enc" -Method Get -Headers $alpacaHeaders }
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
function TruncQty($qty) { return [math]::Floor([double]$qty * 1000000) / 1000000 }
function RoundPx($price) {
    if ($price -ge 1000) { return [math]::Round($price, 2) }
    if ($price -ge 1)    { return [math]::Round($price, 4) }
    return [math]::Round($price, 6)
}

function Place-MarketBuy($sym, $qty) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 5
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "bounce_entry"; return $o
}

function Place-StopLimit($sym, $qty, $stop, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=(RoundPx $stop); limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "bounce_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"
               limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "bounce_t1"; return $o
}

# ---- MAIN -------------------------------------------------------------------

$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity

if (-not $state.session_started) { $state.session_started = (Get-Date -Format o); Save-State $state }

$elapsed = ((Get-Date) - [DateTime]::Parse($state.session_started)).TotalHours
Write-Narr "=== BOUNCE SESSION: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $([math]::Round($elapsed,1))h/$SESSION_HOURS`h | Equity: `$$([math]::Round($equity,0)) ==="

if ($elapsed -ge $SESSION_HOURS) { Write-Narr "Session expired."; exit }

$activePairs = @()
foreach ($p in @($state.positions | Where-Object { $_.managed_mode -eq "bounce" })) {
    if (Get-CryptoPosition $p.symbol) { $activePairs += $p.symbol }
}
$slots = $MAX_POSITIONS - $activePairs.Count
Write-Narr "Active bounce positions: $($activePairs.Count)/$MAX_POSITIONS"
if ($slots -le 0) { Write-Narr "All slots full."; exit }

Write-Narr "Scanning $($PAIRS.Count) pairs for oversold bounces (min score $MIN_SCORE)..."
$candidates = @()
foreach ($sym in $PAIRS) {
    if ($activePairs -contains $sym) { continue }
    Write-Host "  Analyzing $sym..." -ForegroundColor Cyan
    $out = $null
    try { $out = (powershell.exe -NonInteractive -File "$PSScriptRoot\bounce_analyzer.ps1" -Symbol $sym 2>&1) | Out-String | ConvertFrom-Json }
    catch { Write-Narr "  $sym - error"; continue }
    if (-not $out) { continue }
    if ($out.signal -eq "SKIP" -or $out.signal -eq "ERROR" -or $out.signal -eq "INSUFFICIENT_DATA") {
        $reason = if ($out.reason) { $out.reason } else { $out.signal }
        Write-Narr "  $sym - SKIP: $reason"
        continue
    }
    if ([double]$out.score -lt $MIN_SCORE) { Write-Narr "  $sym - score $($out.score) below $MIN_SCORE"; continue }
    Write-Narr "  $sym - QUALIFIED score=$($out.score) D-RSI=$($out.daily_rsi) 4H-turn=$($out.h4_improving) 1H-RSI=$($out.h1_rsi) stop=$($out.stop_pct)pct"
    $candidates += $out
}

if ($candidates.Count -eq 0) {
    Write-Narr "No bounce setups qualified. Conditions may improve - run again in 30-60 min."
    exit
}

$ranked = @($candidates | Sort-Object { [double]$_.score } -Descending)
Write-Narr "=== BOUNCE CANDIDATES ==="
foreach ($c in $ranked) {
    $reasonStr = ($c.reasons | Select-Object -First 3) -join " + "
    Write-Narr "  $($c.symbol) score=$($c.score) ($($c.signal)) price=$(RoundPx $c.price) | $reasonStr"
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
    Write-Narr "ENTERING $sym bounce | score=$($c.score) price=$(RoundPx $price) qty=$qty (~`$$notional) stop=$($c.stop_price) T1=$($c.t1_price) T2=$($c.t2_price)"

    try {
        $buyOrder  = Place-MarketBuy $sym $qty
        $fillPrice = if ([double]$buyOrder.filled_avg_price -gt 0) { [double]$buyOrder.filled_avg_price } else { $price }
        $fillQty   = if ([double]$buyOrder.filled_qty -gt 0) { [double]$buyOrder.filled_qty } else { $qty }
        $fillStr   = RoundPx $fillPrice
        Write-Narr "$sym - Filled: $fillQty @ $fillStr"

        $fillStop  = RoundPx ([double]$c.stop_price)
        $fillStopL = RoundPx ($fillStop * 0.9975)
        $fillT1    = RoundPx ($fillPrice + $stopDist * 1.5)
        $fillT2    = RoundPx ($fillPrice + $stopDist * 2.5)

        $t1Qty    = TruncQty ($fillQty * $T1_PCT)
        $t2Qty    = TruncQty ($fillQty * $T2_PCT)
        $trailQty = TruncQty ($fillQty - $t1Qty - $t2Qty)

        $stopId = $null; $t1Id = $null; $phase = "pending"

        try {
            $sOrd   = Place-StopLimit $sym $fillQty $fillStop $fillStopL
            $stopId = $sOrd.id
            Write-Narr "$sym - Stop at $fillStop (order $stopId)"
        } catch { Write-Narr "$sym - Stop failed: $($_.Exception.Message)" }

        try {
            $t1Ord = Place-LimitSell $sym $t1Qty $fillT1
            $t1Id  = $t1Ord.id
            Write-Narr "$sym - T1 limit at $fillT1 for $t1Qty (order $t1Id)"
            $phase = "active"
        } catch { Write-Narr "$sym - T1 limit failed: $($_.Exception.Message)" }

        if ($stopId) { $phase = "active" }

        $pos = [ordered]@{
            symbol        = $sym
            managed_mode  = "bounce"
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
        Write-Narr "$sym LIVE | fill=$fillStr stop=$fillStop risk=`$$riskAmt T1=$fillT1 [50pct] T2=$fillT2 [30pct] trail [20pct]"
        $entered++

    } catch {
        Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)"
    }
}

Write-Narr "=== Done: $entered bounce entries. Run manage_bounce_positions.ps1 every 5 min. ==="



