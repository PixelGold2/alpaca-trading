# Manages the TSLA ladder + trailing-stop strategy. Idempotent - safe to run repeatedly
# (e.g. via Windows Task Scheduler every few minutes). Reads/writes state from
# ..\logs\tsla_strategy_state.json so it survives across runs and across Claude sessions.

. "$PSScriptRoot\..\config.ps1"

$SYMBOL          = "TSLA"
$TRAIL_ACTIVATE  = 1.10                   # +10% above blended avg cost -> switch to trailing
$TRAIL_PERCENT   = 5
$POST_LADDER_STOP_MULT = 0.90             # stop = 10% below price at moment laddering completes

# Ladder rungs, sized to deploy MORE capital as price gets cheaper (based on TSLA's actual
# 8-month volatility: ATR(14) ~4% of price, annualized vol ~42%, historical pullback depths
# of -10%/-15% (2x each), -20%/-25% (1x each), max drawdown -29.9% in the sample).
$RUNG1_MULT = 0.85; $RUNG1_QTY = 10   # -15% from entry: a realistic, fairly common pullback
$RUNG2_MULT = 0.75; $RUNG2_QTY = 20   # -25% from entry: near the edge of what's actually happened once
$RUNG3_MULT = 0.65; $RUNG3_QTY = 25   # -35% from entry: beyond the historical max drawdown, sized biggest

$stateFile   = "$PSScriptRoot\..\logs\tsla_strategy_state.json"
$narrLog     = "$PSScriptRoot\..\logs\tsla_strategy_log.csv"
$tradesLog   = "$PSScriptRoot\..\logs\trades_log.csv"

$headers = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

function Write-Narr($msg) {
    if (-not (Test-Path $narrLog)) {
        "timestamp,message" | Out-File -FilePath $narrLog -Encoding utf8
    }
    "$(Get-Date -Format o),""$msg""" | Add-Content -Path $narrLog
    Write-Output $msg
}

function Log-Trade($order) {
    if (-not (Test-Path $tradesLog)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price" | Out-File -FilePath $tradesLog -Encoding utf8
    }
    $line = "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price)"
    Add-Content -Path $tradesLog -Value $line
}

function Get-State {
    if (Test-Path $stateFile) {
        return Get-Content $stateFile -Raw | ConvertFrom-Json
    }
    return [PSCustomObject]@{
        entry_price      = $null      # set on first run from actual position avg cost
        rung1_fired      = $false
        rung2_fired      = $false
        rung3_fired      = $false
        protective_type  = "none"     # none | stop | trailing
        protective_order_id = $null
        strategy_closed  = $false
    }
}

function Save-State($state) {
    $state | ConvertTo-Json | Out-File -FilePath $stateFile -Encoding utf8
}

function Get-CurrentPrice {
    $resp = Invoke-RestMethod -Uri "https://data.alpaca.markets/v2/stocks/$SYMBOL/trades/latest" -Method Get -Headers $headers
    return [double]$resp.trade.p
}

function Get-Position {
    try {
        return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$SYMBOL" -Method Get -Headers $headers
    } catch {
        return $null
    }
}

function Place-MarketBuy($qty) {
    $body = @{ symbol = $SYMBOL; qty = $qty; side = "buy"; type = "market"; time_in_force = "day" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $headers -Body $body
    Start-Sleep -Seconds 2
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $headers
    Log-Trade $order
    return $order
}

function Cancel-Order($orderId) {
    if ($orderId) {
        try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$orderId" -Method Delete -Headers $headers | Out-Null } catch {}
    }
}

function Place-StopSell($qty, $stopPrice) {
    $body = @{ symbol = $SYMBOL; qty = $qty; side = "sell"; type = "stop"; stop_price = [math]::Round($stopPrice,2); time_in_force = "gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $headers -Body $body
    Log-Trade $order
    return $order
}

function Place-TrailingStopSell($qty, $trailPercent) {
    $body = @{ symbol = $SYMBOL; qty = $qty; side = "sell"; type = "trailing_stop"; trail_percent = $trailPercent; time_in_force = "gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $headers -Body $body
    Log-Trade $order
    return $order
}

# ---- main ----

$state = Get-State
if ($state.strategy_closed) {
    Write-Narr "Strategy already closed. Nothing to do."
    exit
}

$position = Get-Position
if (-not $position -or [int]$position.qty -eq 0) {
    $state.strategy_closed = $true
    Save-State $state
    Write-Narr "Position is flat (0 shares) - strategy considered closed (stopped out or manually sold)."
    exit
}

$currentPrice = Get-CurrentPrice
$avgCost = [double]$position.avg_entry_price
$qty = [int]$position.qty

if (-not $state.entry_price) {
    $state.entry_price = $avgCost
    Save-State $state
    Write-Narr "Initialized strategy entry_price = $avgCost (blended avg cost of current $qty-share position)."
}
$ENTRY_PRICE   = [double]$state.entry_price
$RUNG1_TRIGGER = $ENTRY_PRICE * $RUNG1_MULT
$RUNG2_TRIGGER = $ENTRY_PRICE * $RUNG2_MULT
$RUNG3_TRIGGER = $ENTRY_PRICE * $RUNG3_MULT

Write-Narr "Check: price=$currentPrice avgCost=$avgCost qty=$qty entryPrice=$ENTRY_PRICE rung1=$($state.rung1_fired) rung2=$($state.rung2_fired) rung3=$($state.rung3_fired) protective=$($state.protective_type)"

if ($state.protective_type -eq "trailing") {
    # Alpaca manages the ratchet server-side. Just confirm it's still open.
    exit
}

if ($currentPrice -ge ($avgCost * $TRAIL_ACTIVATE)) {
    if ($state.protective_type -eq "stop") {
        Cancel-Order $state.protective_order_id
    }
    $order = Place-TrailingStopSell -qty $qty -trailPercent $TRAIL_PERCENT
    $state.protective_type = "trailing"
    $state.protective_order_id = $order.id
    Save-State $state
    Write-Narr "PROFIT TRAIL ACTIVATED: price $currentPrice is +10% over avg cost $avgCost. Placed trailing_stop sell, qty=$qty, trail_percent=$TRAIL_PERCENT (order $($order.id))."
    exit
}

if (-not $state.rung1_fired -and $currentPrice -le $RUNG1_TRIGGER) {
    $order = Place-MarketBuy -qty $RUNG1_QTY
    $state.rung1_fired = $true
    Save-State $state
    Write-Narr "LADDER RUNG 1 FIRED: price $currentPrice <= $RUNG1_TRIGGER (-15% from entry $ENTRY_PRICE). Bought $RUNG1_QTY more shares, filled @ $($order.filled_avg_price) (order $($order.id))."
}

if (-not $state.rung2_fired -and $currentPrice -le $RUNG2_TRIGGER) {
    $order = Place-MarketBuy -qty $RUNG2_QTY
    $state.rung2_fired = $true
    Save-State $state
    Write-Narr "LADDER RUNG 2 FIRED: price $currentPrice <= $RUNG2_TRIGGER (-25% from entry $ENTRY_PRICE). Bought $RUNG2_QTY more shares, filled @ $($order.filled_avg_price) (order $($order.id))."
}

if (-not $state.rung3_fired -and $currentPrice -le $RUNG3_TRIGGER) {
    $order = Place-MarketBuy -qty $RUNG3_QTY
    $state.rung3_fired = $true
    Save-State $state
    Write-Narr "LADDER RUNG 3 FIRED: price $currentPrice <= $RUNG3_TRIGGER (-35% from entry $ENTRY_PRICE). Bought $RUNG3_QTY more shares, filled @ $($order.filled_avg_price) (order $($order.id))."

    $position = Get-Position
    $qty = [int]$position.qty
    $stopPrice = $currentPrice * $POST_LADDER_STOP_MULT
    $stopOrder = Place-StopSell -qty $qty -stopPrice $stopPrice
    $state.protective_type = "stop"
    $state.protective_order_id = $stopOrder.id
    Save-State $state
    Write-Narr "LADDERING COMPLETE: placed protective stop-loss sell, qty=$qty, stop_price=$([math]::Round($stopPrice,2)) (10% below price when rung 3 filled) (order $($stopOrder.id))."
}
