# congress_strategy.ps1 - Pre-market ENTRY script.
# Scans congressional buys + news + SMC/indicators + P/E to find high-conviction setups,
# then places a market buy + initial protective stop-sell (NOT a static bracket).
# manage_congress_positions.ps1 handles the lifecycle: raises SL to breakeven,
# switches to trailing stop, and fires DCA buy rungs on dips.
#
# Run 3x pre-market: 2pm, 3pm, 4pm local (7am, 8am, 9am ET).
# Thresholds: congress picks >= 8.0, watchlist-only >= 9.0. Max 3 concurrent positions.

param([switch]$Force)

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE   = "$PSScriptRoot\..\logs\congress_strategy_state.json"
$NARR_LOG     = "$PSScriptRoot\..\logs\congress_strategy_log.csv"
$TRADE_LOG    = "$PSScriptRoot\..\logs\trades_log.csv"

$MAX_POSITIONS       = 3
$RISK_PCT            = 0.008  # 0.8% equity risk per entry (leaves room for DCA rungs)
$MIN_SCORE_CONGRESS  = 8.0
$MIN_SCORE_WATCHLIST = 9.0
$MIN_RR              = 2.0
$MAX_BP_PCT          = 0.20   # cap initial position at 20% of buying power

# DCA / trailing parameters (ATR multiples)
$RUNG1_ATR_MULT      = 2.0    # buy rung 1 when price drops 2x ATR from entry
$RUNG2_ATR_MULT      = 3.5    # buy rung 2 when price drops 3.5x ATR from entry
$RUNG1_SIZE_PCT      = 0.75   # rung 1 qty = 75% of initial qty
$RUNG2_SIZE_PCT      = 1.25   # rung 2 qty = 125% of initial qty
$BREAKEVEN_ATR_MULT  = 1.5    # move SL to breakeven when +1.5x ATR above entry
$TRAIL_ATR_MULT      = 3.0    # switch to trailing stop when +3x ATR above entry
$TRAIL_PERCENT       = 5.0    # trailing stop width

$WATCHLIST = @(
    "AAPL","MSFT","GOOGL","AMZN","META",
    "NVDA","AMD","AVGO","QCOM","MU",
    "CRM","ORCL","NOW","ADBE","PANW",
    "JPM","V","MA","BAC","GS",
    "UNH","LLY","ABBV","JNJ","MRK",
    "COST","WMT","HD","NKE","AMGN",
    "XOM","CVX",
    "CAT","HON","DE",
    "TSLA","GM"
)

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

function Get-Account {
    return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $alpacaHeaders
}

function Get-OpenPositions {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions" -Method Get -Headers $alpacaHeaders }
    catch { return @() }
}

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return [PSCustomObject]@{ positions = @(); last_scan = $null; total_trades_placed = 0 }
}

function Save-State($state) {
    $state | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8
}

function Place-MarketBuy($symbol, $qty) {
    $body = @{ symbol = $symbol; qty = $qty; side = "buy"; type = "market"; time_in_force = "day" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 3   # let it fill
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $order "initial_entry"
    return $order
}

function Place-StopSell($symbol, $qty, $stopPrice) {
    $body = @{ symbol = $symbol; qty = $qty; side = "sell"; type = "stop";
               stop_price = [math]::Round($stopPrice, 2); time_in_force = "gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "initial_stop"
    return $order
}

function Score-Symbol($sym, $congScore) {
    # P/E fundamentals
    $fund = $null
    try { $fund = (& "$PSScriptRoot\fundamental_filter.ps1" -Symbol $sym) | ConvertFrom-Json } catch {}
    if ($fund -and $fund.skip) { Write-Narr "$sym SKIP (fundamentals): $($fund.skip_reason)"; return $null }
    $peScore = if ($fund) { $fund.pe_score } else { 0.0 }
    $peLabel = if ($fund) { $fund.pe_label } else { "N/A" }

    # Technical (SMC + indicators)
    $tech = $null
    try { $tech = (& "$PSScriptRoot\technical_analyzer.ps1" -Symbol $sym) | ConvertFrom-Json } catch {
        Write-Narr "$sym - Tech error: $($_.Exception.Message)"; return $null
    }
    if ($tech.signal -eq "ERROR" -or $tech.signal -eq "INSUFFICIENT_DATA") {
        Write-Narr "$sym - $($tech.signal): $($tech.error)"; return $null
    }

    # Uptrend filter: must be above EMA21 or showing BOS — not in a downtrend
    $inUptrend = ($tech.price -gt $tech.ema21) -or $tech.bos_bullish
    if (-not $inUptrend) {
        Write-Narr "$sym SKIP - Not in uptrend (price=$($tech.price) EMA21=$($tech.ema21) BOS=$($tech.bos_bullish))"
        return $null
    }

    # News sentiment
    $news = $null
    try { $news = (& "$PSScriptRoot\news_analyzer.ps1" -Symbol $sym) | ConvertFrom-Json } catch {
        $news = [PSCustomObject]@{ news_score = 0; sentiment = "NEUTRAL" }
    }

    $totalScore = [math]::Round($congScore + $tech.score + [double]$news.news_score + $peScore, 1)
    $threshold  = if ($congScore -gt 0) { $MIN_SCORE_CONGRESS } else { $MIN_SCORE_WATCHLIST }

    Write-Narr ("$sym SCORE=$totalScore/$threshold " +
                "(cong=$([math]::Round($congScore,1)) tech=$($tech.score) news=$($news.news_score) pe=$peScore/$peLabel) " +
                "| RSI=$($tech.rsi) R:R=$($tech.rr_ratio) $($tech.signal)")

    if ($null -ne $tech.rsi -and $tech.rsi -gt 75) {
        Write-Narr "$sym DISQ - RSI $($tech.rsi) overbought"; return $null
    }
    if ($tech.rr_ratio -lt $MIN_RR) {
        Write-Narr "$sym DISQ - R:R $($tech.rr_ratio) < $MIN_RR"; return $null
    }
    if ($null -ne $news -and $news.news_score -le -2.0) {
        Write-Narr "$sym DISQ - News too bearish ($($news.news_score))"; return $null
    }
    if ($totalScore -lt $threshold) {
        Write-Narr "$sym - Below threshold. Skip."; return $null
    }

    return [PSCustomObject]@{
        symbol      = $sym
        total_score = $totalScore
        cong_score  = $congScore
        pe_score    = $peScore
        pe_label    = $peLabel
        tech        = $tech
        news        = $news
    }
}

# ---- TIME GUARD ---------------------------------------------------------------
if (-not $Force) {
    try { $etNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Eastern Standard Time") }
    catch { $etNow = (Get-Date).ToUniversalTime().AddHours(-4) }
    $etH = $etNow.Hour + $etNow.Minute / 60.0
    if ($etH -lt 7.0 -or $etH -ge 16.5) {
        Write-Narr "Outside window (ET $([math]::Round($etH,1))h). Use -Force to override."
        exit
    }
}

# ---- STATE & ACCOUNT ---------------------------------------------------------
Write-Narr "=== Congress Entry Scan: $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
$state       = Get-State
$account     = Get-Account
$equity      = [double]$account.equity
$buyingPower = [double]$account.buying_power
$openPosList = Get-OpenPositions
$heldSymbols = @($openPosList | ForEach-Object { $_.symbol })

Write-Narr "equity=$([math]::Round($equity,2)) bp=$([math]::Round($buyingPower,2)) open=$($openPosList.Count)"

# Clean closed positions
$activePosSymbols = @()
$updatedPositions = @()
foreach ($p in @($state.positions)) {
    if ($heldSymbols -contains $p.symbol) {
        $updatedPositions += $p; $activePosSymbols += $p.symbol
    } else {
        Write-Narr "$($p.symbol) - position closed. Slot freed."
    }
}
$state.positions = $updatedPositions
Save-State $state

$slotsAvailable = $MAX_POSITIONS - $activePosSymbols.Count
if ($slotsAvailable -le 0) {
    Write-Narr "At max positions ($MAX_POSITIONS). Exiting."
    exit
}
Write-Narr "Slots free: $slotsAvailable / $MAX_POSITIONS"

# ---- CONGRESS TRADES ---------------------------------------------------------
Write-Narr "Fetching congressional purchases..."
$congTrades = @()
try {
    $congTrades = (& "$PSScriptRoot\congress_watcher.ps1" -DaysBack 7) | ConvertFrom-Json
    Write-Narr "$($congTrades.Count) disclosure(s) found."
} catch { Write-Narr "Congress watcher error: $($_.Exception.Message). Watchlist only." }

$tickerMap = @{}
foreach ($t in @($congTrades)) {
    $sym = $t.ticker
    if (-not $tickerMap[$sym]) { $tickerMap[$sym] = @{ politicians=@(); max_amount=0 } }
    $tickerMap[$sym].politicians += $t.politician
    if ($t.amount_high -gt $tickerMap[$sym].max_amount) { $tickerMap[$sym].max_amount = $t.amount_high }
}

$congTickers = @($tickerMap.GetEnumerator() | Sort-Object { $_.Value.politicians.Count } -Descending | ForEach-Object { $_.Key })
$watchExtra  = @($WATCHLIST | Where-Object { $congTickers -notcontains $_ } | Get-Random -Count ([math]::Min(20, $WATCHLIST.Count)))
$scanOrder   = @($congTickers) + @($watchExtra)

Write-Narr "Congress: $($congTickers -join ', ') | Watchlist: $($watchExtra -join ', ')"

# ---- SCAN & SCORE ------------------------------------------------------------
$candidates = @()
foreach ($sym in $scanOrder) {
    if ($activePosSymbols -contains $sym) { continue }
    if ($candidates.Count -ge $slotsAvailable * 3) { break }

    $congScore = 0.0
    if ($tickerMap.ContainsKey($sym)) {
        $info = $tickerMap[$sym]
        $congScore = [math]::Min($info.politicians.Count * 1.5, 3.0)
        if ($info.max_amount -gt 100000) { $congScore += 1.0 }
        if ($info.max_amount -gt 500000) { $congScore += 1.0 }
        $congScore = [math]::Min($congScore, 5.0)
    }

    $c = Score-Symbol $sym $congScore
    if ($null -ne $c -and $c.symbol) { $candidates += $c }
    Start-Sleep -Milliseconds 400
}

$candidates = @($candidates | Where-Object { $null -ne $_ -and $_.symbol } | Sort-Object total_score -Descending)
Write-Narr "Qualified: $(($candidates | ForEach-Object { "$($_.symbol)=$($_.total_score)" }) -join ', ')"

# ---- PLACE ORDERS ------------------------------------------------------------
$placed = 0
foreach ($c in $candidates) {
    if ($placed -ge $slotsAvailable) { break }
    if ($null -eq $c -or -not $c.symbol) { continue }

    $sym      = $c.symbol
    $entryEst = $c.tech.price
    $atr      = $c.tech.atr
    $stopDist = $entryEst - $c.tech.stop_price
    if ($stopDist -le 0) { continue }

    # Initial qty: 0.8% equity risk
    $qty = [math]::Floor(($equity * $RISK_PCT) / $stopDist)
    $maxByBP = [math]::Floor($buyingPower * $MAX_BP_PCT / $entryEst)
    if ($qty -gt $maxByBP) { $qty = $maxByBP }
    if ($qty -lt 1) { Write-Narr "$sym - qty < 1. Skip."; continue }

    $label = if ($c.cong_score -gt 0) { "CONGRESS+TECH" } else { "WATCHLIST" }
    Write-Narr "$sym - ENTERING ($label): qty=$qty entry~$entryEst stop=$($c.tech.stop_price) score=$($c.total_score) P/E=$($c.pe_label)"
    Write-Narr "$sym - Tech reasons: $($c.tech.reasons -join ' | ')"

    try {
        # 1. Place market buy
        $buyOrder = Place-MarketBuy $sym $qty
        $fillPrice = if ($buyOrder.filled_avg_price -and [double]$buyOrder.filled_avg_price -gt 0) {
            [double]$buyOrder.filled_avg_price } else { $entryEst }

        # 2. Place initial protective stop-sell
        $initStop = [math]::Round($fillPrice - $atr * 1.5, 2)
        $stopOrder = Place-StopSell $sym $qty $initStop

        # 3. Compute all lifecycle trigger levels from actual fill price
        $pos = [ordered]@{
            symbol              = $sym
            qty                 = $qty
            entry_price         = $fillPrice
            atr                 = $atr
            managed_mode        = "dynamic"
            protective_type     = "fixed"
            protective_order_id = $stopOrder.id
            stop_price          = $initStop
            # Raise SL to breakeven when price reaches this
            breakeven_trigger   = [math]::Round($fillPrice + $atr * $BREAKEVEN_ATR_MULT, 2)
            # Switch to trailing stop when price reaches this
            trail_trigger       = [math]::Round($fillPrice + $atr * $TRAIL_ATR_MULT, 2)
            trail_percent       = $TRAIL_PERCENT
            # DCA rungs
            rung1_fired         = $false
            rung1_trigger       = [math]::Round($fillPrice - $atr * $RUNG1_ATR_MULT, 2)
            rung1_qty           = [math]::Max(1, [math]::Floor($qty * $RUNG1_SIZE_PCT))
            rung2_fired         = $false
            rung2_trigger       = [math]::Round($fillPrice - $atr * $RUNG2_ATR_MULT, 2)
            rung2_qty           = [math]::Max(1, [math]::Floor($qty * $RUNG2_SIZE_PCT))
            # Meta
            order_id            = $buyOrder.id
            opened_at           = (Get-Date -Format o)
            total_score         = $c.total_score
            cong_score          = $c.cong_score
            pe_label            = $c.pe_label
            tech_signal         = $c.tech.signal
        }

        $state.positions = @($state.positions) + @($pos)
        $state.total_trades_placed++
        $activePosSymbols += $sym
        $buyingPower -= ($qty * $fillPrice)
        Save-State $state

        Write-Narr ("$sym - ENTERED: fill=$fillPrice stop=$initStop " +
                    "| breakeven@$($pos.breakeven_trigger) trail@$($pos.trail_trigger) " +
                    "| DCA1@$($pos.rung1_trigger)(+$($pos.rung1_qty)sh) DCA2@$($pos.rung2_trigger)(+$($pos.rung2_qty)sh)")
        $placed++

    } catch {
        Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)"
    }
}

$state.last_scan = (Get-Date -Format o)
Save-State $state
Write-Narr "=== Scan done. $placed entry order(s). Active: $($state.positions.Count)/$MAX_POSITIONS ==="
