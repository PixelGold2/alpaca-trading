# mtf_session.ps1 - MTF Confluence strategy entry scanner.
# Scans crypto pairs for 3-timeframe alignment, enters high-conviction setups.
# Partial exits: 50% at T1 (1:1), 30% at T2 (2:1), trail 20% with 5% trailing stop.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE  = "$PSScriptRoot\..\logs\mtf_session_state.json"
$NARR_LOG    = "$PSScriptRoot\..\logs\mtf_session_log.csv"
$TRADE_LOG   = "$PSScriptRoot\..\logs\trades_log.csv"

# Scan universe ??? top liquid pairs only
$PAIRS = @("BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","BCH/USD")

# Session parameters
$SESSION_HOURS = 5
$MAX_POSITIONS = 2
$RISK_PCT      = 0.008   # 0.8% equity risk per trade
$MAX_POS_PCT   = 0.12    # 12% equity max per position
$MIN_SCORE     = 7.0     # strict ??? requires Daily + 4H + 1H alignment

# Partial-exit split: 50% at T1, 30% at T2, 20% trailing
$T1_PCT   = 0.50
$T2_PCT   = 0.30
$TRAIL_PCT = 0.20

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
    Log-Trade $o "mtf_entry"; return $o
}

function Place-StopLimit($sym, $qty, $stop, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=(RoundPx $stop); limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "initial_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"
               limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "t1_limit"; return $o
}

# ---- SCAN -------------------------------------------------------------------

function Score-Pair($sym) {
    Write-Host "  Analyzing $sym..." -ForegroundColor Cyan
    $a = $null
    try { $a = (& "$PSScriptRoot\mtf_analyzer.ps1" -Symbol $sym) | ConvertFrom-Json }
    catch { Write-Narr "  $sym - Analyzer error: $($_.Exception.Message)"; return $null }

    if (-not $a -or $a.signal -eq "ERROR" -or $a.signal -eq "INSUFFICIENT_DATA") { return $null }
    if ($a.score -lt $MIN_SCORE) { return $null }

    # Hard disqualifiers
    if ($a.h1_rsi -gt 70) { Write-Narr "  $sym - 1H RSI $($a.h1_rsi) overbought. Skip."; return $null }
    if ($a.stop_pct -gt 5.0) { Write-Narr "  $sym - Stop $($a.stop_pct)% too wide. Skip."; return $null }
    if (-not $a.btc_bullish -and $sym -ne "BTC/USD") { Write-Narr "  $sym - BTC bearish macro. Skip."; return $null }

    return $a
}

# ---- MAIN -------------------------------------------------------------------

$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity
$bp      = [double]$account.buying_power

# Init session
if (-not $state.session_started) {
    $state.session_started = (Get-Date -Format o)
    Save-State $state
}

$elapsed = ((Get-Date) - [DateTime]::Parse($state.session_started)).TotalHours
Write-Narr "=== MTF CONFLUENCE SESSION: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $([math]::Round($elapsed,1))h/$SESSION_HOURS`h | Equity: `$$([math]::Round($equity,0)) ==="

if ($elapsed -ge $SESSION_HOURS) {
    Write-Narr "Session expired. Run manage_mtf_positions.ps1 to close remaining positions."
    exit
}

# Count active MTF positions
$activePairs = @()
foreach ($p in @($state.positions | Where-Object { $_.managed_mode -eq "mtf" })) {
    if (Get-CryptoPosition $p.symbol) { $activePairs += $p.symbol }
}
$slots = $MAX_POSITIONS - $activePairs.Count
Write-Narr "Active: $($activePairs.Count)/$MAX_POSITIONS ($($activePairs -join ', '))"

if ($slots -le 0) {
    Write-Narr "All slots full. Run manage_mtf_positions.ps1 to manage lifecycle."
    exit
}

# Scan
Write-Narr "Scanning $($PAIRS.Count) pairs for MTF confluence (min score $MIN_SCORE)..."
$candidates = @()
foreach ($sym in $PAIRS) {
    if ($activePairs -contains $sym) { Write-Host "  $sym - already open. Skip." -ForegroundColor Yellow; continue }
    $result = Score-Pair $sym
    if ($null -ne $result) { $candidates += $result }
}

if ($candidates.Count -eq 0) {
    Write-Narr "No pairs met the $MIN_SCORE score threshold. Market not in optimal confluence."
    Write-Narr "This is correct behavior ??? the strategy only trades when ALL conditions align."
    exit
}

# Rank by score
$ranked = @($candidates | Sort-Object { [double]$_.score } -Descending)
Write-Narr ""
Write-Narr "=== QUALIFIED SETUPS ==="
foreach ($c in $ranked) {
    $macroDir  = if ([double]$c.h4_macd_hist -gt 0) { "bull" } else { "bear" }
    $stopStr   = "$($c.stop_pct)pct"
    $reasonStr = ($c.reasons | Select-Object -First 4) -join " + "
    Write-Narr ("  $($c.symbol) score=$($c.score) ($($c.signal)) " +
                "price=$(RoundPx $c.price) | D-RSI=$($c.daily_rsi) 4H-MACD=$macroDir 1H-RSI=$($c.h1_rsi) stop=$stopStr " +
                "| $reasonStr")
}

# Enter top setups
$entered = 0
foreach ($c in $ranked) {
    if ($entered -ge $slots) { break }

    $sym       = $c.symbol
    $price     = [double]$c.price
    $stopDist  = $price - [double]$c.stop_price
    if ($stopDist -le 0) { Write-Narr "$sym - Invalid stop. Skip."; continue }

    # Size: risk RISK_PCT of equity, cap at MAX_POS_PCT
    $qty    = TruncQty (($equity * $RISK_PCT) / $stopDist)
    $maxQty = TruncQty (($equity * $MAX_POS_PCT) / $price)
    if ($qty -gt $maxQty) { $qty = $maxQty }
    if ($qty -le 0)       { Write-Narr "$sym - Qty too small. Skip."; continue }

    $notional = [math]::Round($qty * $price, 2)
    $stopPctStr = "$($c.stop_pct)pct"
    Write-Narr ""
    Write-Narr ("ENTERING $sym | score=$($c.score) signal=$($c.signal) " +
                "price=$(RoundPx $price) qty=$qty (~`$$notional) " +
                "| stop=$($c.stop_price) (+$stopPctStr) T1=$($c.t1_price) T2=$($c.t2_price)")

    try {
        $buyOrder  = Place-MarketBuy $sym $qty
        $fillPrice = if ([double]$buyOrder.filled_avg_price -gt 0) { [double]$buyOrder.filled_avg_price } else { $price }
        $fillQty   = if ([double]$buyOrder.filled_qty -gt 0) { [double]$buyOrder.filled_qty } else { $qty }
        $fillPriceStr = RoundPx $fillPrice
        Write-Narr "$sym - Filled: $fillQty @ $fillPriceStr"

        # Recalculate exact stop/targets from fill price
        $stopFromAnalysis = [double]$c.stop_price
        $fillStop  = RoundPx ([math]::Min($stopFromAnalysis, $fillPrice - $stopDist))
        $fillStopL = RoundPx ($fillStop * 0.9975)
        $fillStop1 = RoundPx ($fillPrice + $stopDist * 1.0)
        $fillStop2 = RoundPx ($fillPrice + $stopDist * 2.0)

        # Partial qty splits
        $t1Qty    = TruncQty ($fillQty * $T1_PCT)
        $t2Qty    = TruncQty ($fillQty * $T2_PCT)
        $trailQty = TruncQty ($fillQty - $t1Qty - $t2Qty)

        # Place stop + T1 limit simultaneously
        $stopId = $null; $t1Id = $null; $phase = "pending"

        try {
            $sOrd   = Place-StopLimit $sym $fillQty $fillStop $fillStopL
            $stopId = $sOrd.id; Write-Narr "$sym - Stop placed at $fillStop (order $stopId)"
        } catch { Write-Narr "$sym - Stop failed: $($_.Exception.Message)" }

        try {
            $t1Ord = Place-LimitSell $sym $t1Qty $fillStop1
            $t1Id  = $t1Ord.id; Write-Narr "$sym - T1 limit placed at $fillStop1 for $t1Qty (order $t1Id)"
            $phase = "active"
        } catch { Write-Narr "$sym - T1 limit failed: $($_.Exception.Message)" }

        if ($stopId) { $phase = "active" }

        $pos = [ordered]@{
            symbol        = $sym
            managed_mode  = "mtf"
            phase         = $phase
            entry_price   = RoundPx $fillPrice
            total_qty     = $fillQty
            t1_qty        = $t1Qty
            t2_qty        = $t2Qty
            trail_qty     = $trailQty
            stop_price    = $fillStop
            stop_lim      = $fillStopL
            t1_price      = $fillStop1
            t2_price      = $fillStop2
            t1_fired      = $false
            t2_fired      = $false
            stop_order_id = $stopId
            t1_order_id   = $t1Id
            t2_order_id   = $null
            order_id      = $buyOrder.id
            opened_at     = (Get-Date -Format o)
            score         = $c.score
            signal        = $c.signal
            daily_rsi     = $c.daily_rsi
            h4_cross      = $c.h4_macd_cross
            h1_rsi        = $c.h1_rsi
        }

        $state.positions = @($state.positions) + @($pos)
        Save-State $state

        $riskDollars = [math]::Round($fillQty * ($fillPrice - $fillStop), 2)
        Write-Narr ("$sym LIVE | fill=$fillPriceStr stop=$fillStop risk=`$$riskDollars" +
                    " | T1=$fillStop1 [50pct] T2=$fillStop2 [30pct] trail [20pct]")

        $entered++

    } catch {
        Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)"
    }
}

Write-Narr ""
Write-Narr "=== Done: $entered new entries. Total active: $($activePairs.Count + $entered)/$MAX_POSITIONS ==="
Write-Narr "Run manage_mtf_positions.ps1 every 5 min to manage partial exits."



