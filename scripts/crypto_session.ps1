# crypto_session.ps1 - 4-hour crypto rotation session.
# Scans 8 crypto pairs, enters the best-scoring ones, rotates as positions close.
# Run this once to start. Schedule manage_crypto_positions.ps1 every 5 min to manage.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE   = "$PSScriptRoot\..\logs\crypto_session_state.json"
$NARR_LOG     = "$PSScriptRoot\..\logs\crypto_session_log.csv"
$TRADE_LOG    = "$PSScriptRoot\..\logs\trades_log.csv"

# All pairs to scan (Alpaca v1beta3 format)
$CRYPTO_PAIRS = @("BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","LTC/USD","BCH/USD","DOGE/USD")

# Yahoo Finance RSS ticker mapping (symbol without slash)
$NEWS_MAP = @{
    "BTC/USD"  = "BTC-USD"
    "ETH/USD"  = "ETH-USD"
    "SOL/USD"  = "SOL1-USD"
    "AVAX/USD" = "AVAX-USD"
    "LINK/USD" = "LINK-USD"
    "LTC/USD"  = "LTC-USD"
    "BCH/USD"  = "BCH-USD"
    "DOGE/USD" = "DOGE-USD"
}

$SESSION_HOURS  = 4
$MAX_POSITIONS  = 2      # up to 2 concurrent crypto positions
$RISK_PCT       = 0.006  # 0.6% equity risk per trade (crypto is more volatile)
$MAX_POS_PCT    = 0.10   # max 10% of equity per position
$MIN_SCORE      = 4.0    # minimum tech score to enter

# ATR multipliers (wider than stocks for crypto volatility)
$RUNG1_ATR     = 3.0
$RUNG2_ATR     = 5.0
$RUNG1_PCT     = 0.75
$RUNG2_PCT     = 1.25
$BE_ATR        = 2.0
$TRAIL_ATR     = 4.0
$TRAIL_PCT     = 8.0     # 8% trailing stop for crypto

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
    # Alpaca stores crypto as "ETHUSD" (no slash) even though orders use "ETH/USD"
    $noSlash = $sym -replace "/", ""
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$noSlash" -Method Get -Headers $alpacaHeaders }
    catch { }
    $encSym = [uri]::EscapeDataString($sym)
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$encSym" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return [PSCustomObject]@{ positions = @(); session_started = $null; entries_made = 0 }
}

function Save-State($state) { $state | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8 }

function Round-CryptoQty($qty) { return [math]::Floor([double]$qty * 1000000) / 1000000 }
function Round-CryptoPrice($price) {
    if ($price -ge 1000) { return [math]::Round($price, 2) }
    if ($price -ge 1)    { return [math]::Round($price, 4) }
    return [math]::Round($price, 6)
}

function Place-MarketBuy($sym, $qty) {
    $q    = Round-CryptoQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 5
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $order "crypto_entry"
    return $order
}

function Place-StopSell($sym, $qty, $stopPrice) {
    # Crypto requires stop_limit (not plain stop); limit = 0.25% below stop for fills
    $sp  = Round-CryptoPrice $stopPrice
    $lim = Round-CryptoPrice ($stopPrice * 0.9975)
    $q   = Round-CryptoQty   $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"; stop_price=$sp; limit_price=$lim; time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "initial_stop"
    return $order
}

# ---- SCAN -------------------------------------------------------------------

function Score-CryptoPair($sym) {
    Write-Output "  Analyzing $sym..."

    # Technical analysis
    $tech = $null
    try { $tech = (& "$PSScriptRoot\crypto_technical_analyzer.ps1" -Symbol $sym) | ConvertFrom-Json }
    catch { Write-Narr "$sym - Tech error: $($_.Exception.Message)"; return $null }

    if (-not $tech -or $tech.signal -eq "ERROR" -or $tech.signal -eq "INSUFFICIENT_DATA") {
        Write-Narr "$sym - Skipped ($($tech.signal))"
        return $null
    }

    # Hard disqualifiers
    if ($tech.rsi -gt 78)     { Write-Narr "$sym - RSI $($tech.rsi) overbought. Skip."; return $null }
    if ($tech.rr_ratio -lt 2) { Write-Narr "$sym - R:R $($tech.rr_ratio) < 2. Skip."; return $null }

    # News sentiment
    $newsSym  = $NEWS_MAP[$sym]
    $newsScore = 0.0
    if ($newsSym) {
        try { $news = (& "$PSScriptRoot\news_analyzer.ps1" -Symbol $newsSym) | ConvertFrom-Json; $newsScore = [double]$news.score }
        catch { }
    }
    if ($newsScore -le -2.0) { Write-Narr "$sym - News strongly bearish ($newsScore). Skip."; return $null }

    $total = [math]::Round([double]$tech.score + $newsScore, 1)

    [ordered]@{
        symbol       = $sym
        total_score  = $total
        tech_score   = $tech.score
        news_score   = $newsScore
        signal       = $tech.signal
        price        = $tech.price
        atr          = $tech.atr
        stop_price   = $tech.stop_price
        target_price = $tech.target_price
        rr_ratio     = $tech.rr_ratio
        rsi          = $tech.rsi
        bos_bullish  = $tech.bos_bullish
        in_ob        = $tech.in_ob
        in_fvg       = $tech.in_fvg
        reasons      = ($tech.reasons -join "; ")
    }
}

# ---- MAIN -------------------------------------------------------------------

$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity
$bp      = [double]$account.buying_power

# Init session
if (-not $state.session_started) {
    $state.session_started = (Get-Date -Format o)
    $state.entries_made    = 0
    Save-State $state
}

$elapsed = ((Get-Date) - [DateTime]::Parse($state.session_started)).TotalHours
Write-Narr "=== CRYPTO SESSION: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $([math]::Round($elapsed,1))h/$SESSION_HOURS`h | Equity: `$$([math]::Round($equity,0)) ==="

if ($elapsed -ge $SESSION_HOURS) {
    Write-Narr "=== 4-hour session expired. Run manage_crypto_positions.ps1 to manage remaining exits. ==="
    exit
}

# Count open crypto positions
$openSymbols = @()
foreach ($p in @($state.positions | Where-Object { $_.managed_mode -eq "crypto_dynamic" })) {
    if (Get-CryptoPosition $p.symbol) { $openSymbols += $p.symbol }
}
$slotsAvail = $MAX_POSITIONS - $openSymbols.Count

Write-Narr "Open crypto positions: $($openSymbols.Count)/$MAX_POSITIONS ($($openSymbols -join ', '))"

if ($slotsAvail -le 0) {
    Write-Narr "All slots full. Run manage_crypto_positions.ps1 to monitor lifecycle."
    exit
}

# Scan all pairs
Write-Narr "Scanning $($CRYPTO_PAIRS.Count) crypto pairs..."
$candidates = @()
foreach ($sym in $CRYPTO_PAIRS) {
    if ($openSymbols -contains $sym) { Write-Narr "  $sym - already in position. Skip."; continue }
    $result = Score-CryptoPair $sym
    if ($null -ne $result -and $result.total_score -ge $MIN_SCORE) { $candidates += $result }
}

if ($candidates.Count -eq 0) {
    Write-Narr "No qualifying pairs found (need score >= $MIN_SCORE). Market conditions may not be ideal."
    Write-Narr "Will scan again on next run. Run this script again or schedule it every 30 min."
    exit
}

# Sort by score descending
$ranked = @($candidates | Sort-Object { $_.total_score } -Descending)
Write-Narr ""
Write-Narr "=== RANKED CANDIDATES ==="
foreach ($c in $ranked) {
    Write-Narr ("  $($c.symbol.PadRight(10)) score=$($c.total_score) ($($c.signal)) " +
                "price=$(Round-CryptoPrice $c.price) RSI=$($c.rsi) R:R=$($c.rr_ratio) " +
                "| $($c.reasons)")
}

# Enter top candidates up to available slots
$entered = 0
foreach ($c in $ranked) {
    if ($entered -ge $slotsAvail) { break }

    $sym      = $c.symbol
    $price    = [double]$c.price
    $atr      = [double]$c.atr
    $stopDist = $price - [double]$c.stop_price
    if ($stopDist -le 0) { Write-Narr "$sym - Invalid stop distance. Skip."; continue }

    # Position sizing: risk 0.6% equity, cap at 10% equity
    $qty    = Round-CryptoQty (($equity * $RISK_PCT) / $stopDist)
    $maxQty = Round-CryptoQty (($equity * $MAX_POS_PCT) / $price)
    if ($qty -gt $maxQty) { $qty = $maxQty }
    if ($qty -le 0)       { Write-Narr "$sym - Qty too small. Skip."; continue }

    $notional = [math]::Round($qty * $price, 2)
    Write-Narr ""
    Write-Narr ("ENTERING $sym | score=$($c.total_score) signal=$($c.signal) " +
                "price=$(Round-CryptoPrice $price) qty=$qty notional=`$$notional " +
                "stop=$(Round-CryptoPrice $c.stop_price) target=$(Round-CryptoPrice $c.target_price) R:R=$($c.rr_ratio)")

    try {
        $buyOrder  = Place-MarketBuy $sym $qty
        $fillPrice = if ([double]$buyOrder.filled_avg_price -gt 0) { [double]$buyOrder.filled_avg_price } else { $price }
        $actualQty = if ([double]$buyOrder.filled_qty -gt 0) { [double]$buyOrder.filled_qty } else { $qty }
        Write-Narr "$sym - Buy filled: $actualQty @ $(Round-CryptoPrice $fillPrice) (order $($buyOrder.id))"

        $initStop = Round-CryptoPrice ([math]::Min([double]$c.stop_price, $fillPrice - $atr * 1.8))
        $stopType = "pending"
        $stopId   = $null

        try {
            $sOrder  = Place-StopSell $sym $actualQty $initStop
            $stopId  = $sOrder.id
            $stopType = "fixed"
            Write-Narr "$sym - Initial stop placed at $initStop (order $stopId)"
        } catch {
            Write-Narr "$sym - Stop not placed yet: $($_.Exception.Message). Will place on next manager run."
        }

        $pos = [ordered]@{
            symbol              = $sym
            qty                 = $actualQty
            entry_price         = Round-CryptoPrice $fillPrice
            atr                 = $atr
            managed_mode        = "crypto_dynamic"
            protective_type     = $stopType
            protective_order_id = $stopId
            stop_price          = $initStop
            breakeven_trigger   = Round-CryptoPrice ($fillPrice + $atr * $BE_ATR)
            trail_trigger       = Round-CryptoPrice ($fillPrice + $atr * $TRAIL_ATR)
            trail_percent       = $TRAIL_PCT
            rung1_fired         = $false
            rung1_trigger       = Round-CryptoPrice ($fillPrice - $atr * $RUNG1_ATR)
            rung1_qty           = Round-CryptoQty ($actualQty * $RUNG1_PCT)
            rung2_fired         = $false
            rung2_trigger       = Round-CryptoPrice ($fillPrice - $atr * $RUNG2_ATR)
            rung2_qty           = Round-CryptoQty ($actualQty * $RUNG2_PCT)
            order_id            = $buyOrder.id
            opened_at           = (Get-Date -Format o)
            total_score         = $c.total_score
            tech_score          = $c.tech_score
            news_score          = $c.news_score
            signal              = $c.signal
        }

        $state.positions = @($state.positions) + @($pos)
        $state.entries_made++
        Save-State $state

        Write-Narr ("$sym POSITION OPEN: fill=$(Round-CryptoPrice $fillPrice) qty=$actualQty stop=$initStop " +
                    "| BE@$($pos.breakeven_trigger) trail@$($pos.trail_trigger) " +
                    "| DCA1@$($pos.rung1_trigger)(+$($pos.rung1_qty)) DCA2@$($pos.rung2_trigger)(+$($pos.rung2_qty))")

        $entered++

    } catch {
        Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)"
    }
}

Write-Narr ""
Write-Narr "=== Session summary: $entered new entries. Total open: $($openSymbols.Count + $entered)/$MAX_POSITIONS ==="
Write-Narr "=== Next: run manage_crypto_positions.ps1 every 5 min to manage lifecycle. ==="
Write-Narr "=== Run this script again to fill remaining slots or rotate after a position closes. ==="
