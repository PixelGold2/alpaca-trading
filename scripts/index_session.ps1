# index_session.ps1 - 4-hour index rotation session.
# Rotation order (by score): IWM -> XLI -> DIA
# On each run: enters next available index if a slot is free and the previous closed.
# manage_congress_positions.ps1 handles the lifecycle (trailing SL + DCA rungs).

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE   = "$PSScriptRoot\..\logs\congress_strategy_state.json"
$NARR_LOG     = "$PSScriptRoot\..\logs\congress_strategy_log.csv"
$TRADE_LOG    = "$PSScriptRoot\..\logs\trades_log.csv"
$SESSION_FILE = "$PSScriptRoot\..\logs\index_session_state.json"

# Rotation queue ordered by today's score
$ROTATION = @(
    [ordered]@{ symbol="IWM"; score=8.5; note="STRONG_BUY RSI=58 in OB" },
    [ordered]@{ symbol="XLI"; score=7.5; note="STRONG_BUY RSI=60 in OB" },
    [ordered]@{ symbol="DIA"; score=7.0; note="BUY RSI=68 BOS" }
)

$SESSION_HOURS    = 4
$MAX_POSITIONS    = 1     # one index at a time during the session
$RISK_PCT         = 0.008 # 0.8% equity risk per entry
$MAX_BP_PCT       = 0.20

# ATR-based lifecycle multipliers (same as congress strategy)
$RUNG1_ATR_MULT     = 2.0
$RUNG2_ATR_MULT     = 3.5
$RUNG1_SIZE_PCT     = 0.75
$RUNG2_SIZE_PCT     = 1.25
$BREAKEVEN_ATR_MULT = 1.5
$TRAIL_ATR_MULT     = 3.0
$TRAIL_PERCENT      = 5.0

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

function Write-Narr($msg) {
    if (-not (Test-Path $NARR_LOG)) { "timestamp,message" | Out-File $NARR_LOG -Encoding utf8 }
    "$(Get-Date -Format o),""$($msg -replace '"',"'"")""" | Add-Content $NARR_LOG
    Write-Output $msg
}

function Log-Trade($order, $note) {
    if (-not (Test-Path $TRADE_LOG)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price,note" | Out-File $TRADE_LOG -Encoding utf8
    }
    "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price),""$note""" | Add-Content $TRADE_LOG
}

function Get-Account {
    Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $alpacaHeaders
}

function Get-AlpacaPosition($sym) {
    try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$sym" -Method Get -Headers $alpacaHeaders }
    catch { $null }
}

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return [PSCustomObject]@{ positions = @() }
}

function Save-State($state) {
    $state | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8
}

function Get-Session {
    if (Test-Path $SESSION_FILE) { return Get-Content $SESSION_FILE -Raw | ConvertFrom-Json }
    return [PSCustomObject]@{ started_at = $null; rotation_index = 0; completed = @() }
}

function Save-Session($s) { $s | ConvertTo-Json | Out-File $SESSION_FILE -Encoding utf8 }

function Place-MarketBuy($sym, $qty) {
    $body  = @{ symbol=$sym; qty=$qty; side="buy"; type="market"; time_in_force="day" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 3
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $order "index_session"
    return $order
}

function Place-StopSell($sym, $qty, $stopPrice) {
    $body  = @{ symbol=$sym; qty=$qty; side="sell"; type="stop"; stop_price=[math]::Round($stopPrice,2); time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "initial_stop"
    return $order
}

# ---- MAIN -------------------------------------------------------------------

$session = Get-Session
$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity
$bp      = [double]$account.buying_power

# Init session timer
if (-not $session.started_at) {
    $session.started_at = (Get-Date -Format o)
    Save-Session $session
    Write-Narr "=== INDEX SESSION STARTED: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Duration: $SESSION_HOURS hours ==="
} else {
    $elapsed = ((Get-Date) - [DateTime]::Parse($session.started_at)).TotalHours
    if ($elapsed -ge $SESSION_HOURS) {
        Write-Narr "=== SESSION ENDED: $([math]::Round($elapsed,1))h elapsed. Completed: $($session.completed -join ', ') ==="
        exit
    }
    Write-Narr "=== Index Session Check: $(Get-Date -Format 'HH:mm') | $([math]::Round($elapsed,2))h/$($SESSION_HOURS)h ==="
}

# Find current index position managed by this session
$activeSymbols = @($state.positions | Where-Object { $_.managed_mode -eq "dynamic" } | ForEach-Object { $_.symbol })

# Check if the current rotation symbol is still open
if ($session.rotation_index -lt $ROTATION.Count) {
    $current = $ROTATION[$session.rotation_index]
    $sym     = $current.symbol
    $alpPos  = Get-AlpacaPosition $sym

    if ($activeSymbols -contains $sym -and $alpPos) {
        # Position is live - report status
        $curPrice = try {
            $r = Invoke-RestMethod "https://data.alpaca.markets/v2/stocks/$sym/trades/latest" -Method Get -Headers $alpacaHeaders
            [double]$r.trade.p
        } catch { 0 }
        $pos  = $state.positions | Where-Object { $_.symbol -eq $sym }
        $pnl  = if ($curPrice -gt 0) { [math]::Round(($curPrice - [double]$pos.entry_price) * [int]$alpPos.qty, 2) } else { "N/A" }
        $pnlP = if ($curPrice -gt 0 -and [double]$pos.entry_price -gt 0) { [math]::Round(($curPrice / [double]$pos.entry_price - 1) * 100, 2) } else { 0 }
        Write-Narr ("$sym LIVE: price=$curPrice entry=$($pos.entry_price) qty=$($alpPos.qty) " +
                    "PnL=`$$pnl ($pnlP%) | stop=$($pos.stop_price) type=$($pos.protective_type)")
        Write-Narr "Next up after $sym exits: $($ROTATION[($session.rotation_index+1)..$($ROTATION.Count-1)] | ForEach-Object { $_.symbol } | ForEach-Object { $_ } | Out-String -Stream | Where-Object { $_ } | ForEach-Object { $_ } ; $ROTATION[($session.rotation_index+1)..$($ROTATION.Count-1)] | ForEach-Object { $_.symbol } | Select-Object -First 5 | ForEach-Object { $_ })"
        exit
    } elseif ($activeSymbols -contains $sym -and -not $alpPos) {
        # Position was closed - advance rotation
        Write-Narr "$sym - Position closed. Advancing to next index."
        $session.completed += $sym
        $session.rotation_index++
        $state.positions = @($state.positions | Where-Object { $_.symbol -ne $sym })
        Save-State $state
        Save-Session $session
    }
}

# Enter next available index in rotation
if ($session.rotation_index -ge $ROTATION.Count) {
    Write-Narr "All indices in rotation completed: $($session.completed -join ' -> '). Session done."
    exit
}

$next    = $ROTATION[$session.rotation_index]
$sym     = $next.symbol
$note    = $next.note

Write-Narr "Entering $sym ($note)..."

# Run technical analysis for live levels
$tech = $null
try {
    $tech = (& "$PSScriptRoot\technical_analyzer.ps1" -Symbol $sym) | ConvertFrom-Json
} catch {
    Write-Narr "$sym - Tech analysis failed: $($_.Exception.Message)"; exit
}

$entryEst = $tech.price
$atr      = $tech.atr
$stopDist = $entryEst - $tech.stop_price
if ($stopDist -le 0) { Write-Narr "$sym - Invalid stop. Exit."; exit }

$qty    = [math]::Floor(($equity * $RISK_PCT) / $stopDist)
$maxBP  = [math]::Floor($bp * $MAX_BP_PCT / $entryEst)
if ($qty -gt $maxBP) { $qty = $maxBP }
if ($qty -lt 1) { Write-Narr "$sym - Insufficient qty. Exit."; exit }

Write-Narr ("$sym ENTERING: qty=$qty entry~$entryEst stop=$($tech.stop_price) target=$($tech.target_price) " +
            "R:R=$($tech.rr_ratio) ATR=$atr | $note")

try {
    $buyOrder  = Place-MarketBuy $sym $qty
    $fillPrice = if ($buyOrder.filled_avg_price -and [double]$buyOrder.filled_avg_price -gt 0) {
        [double]$buyOrder.filled_avg_price } else { $entryEst }

    # Place initial stop-sell. If market is closed the buy hasn't filled yet,
    # so the stop will fail - save the entry without a stop and let
    # manage_congress_positions.ps1 place it on the next run once filled.
    $initStop     = if ($tech.stop_price -gt 0 -and $tech.stop_price -lt $fillPrice) { $tech.stop_price } else { [math]::Round($fillPrice - $atr * 1.5, 2) }
    $stopOrderId  = $null
    $protType     = "pending"   # will become "fixed" once stop is placed
    try {
        $stopOrder   = Place-StopSell $sym $qty $initStop
        $stopOrderId = $stopOrder.id
        $protType    = "fixed"
        Write-Narr "$sym - Initial stop placed at $initStop (order $stopOrderId)"
    } catch {
        Write-Narr "$sym - Stop not placed yet (market closed / order not filled). Will place on next lifecycle run."
    }

    $pos = [ordered]@{
        symbol              = $sym
        qty                 = $qty
        entry_price         = $fillPrice
        atr                 = $atr
        managed_mode        = "dynamic"
        protective_type     = $protType
        protective_order_id = $stopOrderId
        stop_price          = $initStop
        breakeven_trigger   = [math]::Round($fillPrice + $atr * $BREAKEVEN_ATR_MULT, 2)
        trail_trigger       = [math]::Round($fillPrice + $atr * $TRAIL_ATR_MULT, 2)
        trail_percent       = $TRAIL_PERCENT
        rung1_fired         = $false
        rung1_trigger       = [math]::Round($fillPrice - $atr * $RUNG1_ATR_MULT, 2)
        rung1_qty           = [math]::Max(1, [math]::Floor($qty * $RUNG1_SIZE_PCT))
        rung2_fired         = $false
        rung2_trigger       = [math]::Round($fillPrice - $atr * $RUNG2_ATR_MULT, 2)
        rung2_qty           = [math]::Max(1, [math]::Floor($qty * $RUNG2_SIZE_PCT))
        order_id            = $buyOrder.id
        opened_at           = (Get-Date -Format o)
        session_trade       = $true
        note                = $note
    }

    $state.positions = @($state.positions) + @($pos)
    Save-State $state
    Save-Session $session

    Write-Narr ("$sym ENTERED: fill=$fillPrice initial_stop=$initStop " +
                "| BE@$($pos.breakeven_trigger) trail@$($pos.trail_trigger) " +
                "| DCA1@$($pos.rung1_trigger)(+$($pos.rung1_qty)sh) DCA2@$($pos.rung2_trigger)(+$($pos.rung2_qty)sh)")
    Write-Narr "Next in queue: $($ROTATION[($session.rotation_index+1)..$($ROTATION.Count-1)] | ForEach-Object { $_.symbol } | ForEach-Object { $_ } | Out-String -Stream | Where-Object { $_ } | ForEach-Object { $_ } ; $ROTATION[($session.rotation_index+1)..$($ROTATION.Count-1)] | ForEach-Object { $_.symbol } | Select-Object -First 5 | ForEach-Object { $_ })"

} catch {
    Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)"
}
