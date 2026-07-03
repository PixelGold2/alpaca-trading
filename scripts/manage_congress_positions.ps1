# manage_congress_positions.ps1 - Lifecycle manager for active congress strategy positions.
# Runs every 10 minutes during market hours via Task Scheduler.
#
# Per active position it:
#   1. Detects if the position was closed (stop or manual) and removes it from state
#   2. When price rises +1.5x ATR above entry -> moves stop to breakeven (risk-free)
#   3. When price rises +3x ATR above entry   -> cancels stop, places trailing stop (ride the move)
#   4. When price drops 2x ATR below entry    -> fires DCA rung 1 (add 75% more shares)
#   5. When price drops 3.5x ATR below entry  -> fires DCA rung 2 (add 125% more shares)
#
# NOTE: Positions entered as bracket orders (managed_mode != "dynamic") are left alone
# since Alpaca manages their stop/target server-side.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\congress_strategy_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\congress_strategy_log.csv"
$TRADE_LOG  = "$PSScriptRoot\..\logs\trades_log.csv"

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

function Get-AlpacaPosition($symbol) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$symbol" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-CurrentPrice($symbol) {
    $r = Invoke-RestMethod -Uri "https://data.alpaca.markets/v2/stocks/$symbol/trades/latest" -Method Get -Headers $alpacaHeaders
    return [double]$r.trade.p
}

function Cancel-Order($orderId) {
    if ($orderId) {
        try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$orderId" -Method Delete -Headers $alpacaHeaders | Out-Null } catch {}
    }
}

function Place-StopSell($symbol, $qty, $stopPrice) {
    $body = @{ symbol = $symbol; qty = $qty; side = "sell"; type = "stop";
               stop_price = [math]::Round($stopPrice, 2); time_in_force = "gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "stop_update"
    return $order
}

function Place-TrailingStopSell($symbol, $qty, $trailPercent) {
    $body = @{ symbol = $symbol; qty = $qty; side = "sell"; type = "trailing_stop";
               trail_percent = $trailPercent; time_in_force = "gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "trailing_stop"
    return $order
}

function Place-MarketBuy($symbol, $qty) {
    $body = @{ symbol = $symbol; qty = $qty; side = "buy"; type = "market"; time_in_force = "day" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 3
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $order "dca_buy"
    return $order
}

# ---- MAIN -------------------------------------------------------------------

$state = Get-State

$dynamicPositions = @($state.positions | Where-Object { $_.managed_mode -eq "dynamic" })
if ($dynamicPositions.Count -eq 0) {
    Write-Output "$(Get-Date -Format o) - No dynamic positions to manage."
    exit
}

Write-Narr "=== Position Manager: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($dynamicPositions.Count) dynamic position(s) ==="

$updatedPositions = @()
foreach ($origPos in @($state.positions)) {
    # Pass through bracket-mode positions unchanged
    if ($origPos.managed_mode -ne "dynamic") {
        $updatedPositions += $origPos
        continue
    }

    $pos = $origPos   # reference to mutate
    $sym = $pos.symbol

    # ---- 1. Check if position still open in Alpaca ----
    $alpacaPos = Get-AlpacaPosition $sym
    if (-not $alpacaPos -or [int]$alpacaPos.qty -eq 0) {
        Write-Narr "$sym - Position closed (stop/target/manual). Freeing slot."
        continue   # don't add to updatedPositions - effectively removes it
    }

    $curPrice = Get-CurrentPrice $sym
    $qty      = [int]$alpacaPos.qty   # actual Alpaca qty (may have grown from DCA)
    $entry    = [double]$pos.entry_price
    $atr      = [double]$pos.atr

    Write-Narr ("$sym - price=$curPrice entry=$entry qty=$qty " +
                "| stop_type=$($pos.protective_type) stop=$([math]::Round([double]$pos.stop_price,2)) " +
                "| BE_trigger=$($pos.breakeven_trigger) trail_trigger=$($pos.trail_trigger) " +
                "| rung1_fired=$($pos.rung1_fired) rung1_trig=$($pos.rung1_trigger) " +
                "| rung2_fired=$($pos.rung2_fired) rung2_trig=$($pos.rung2_trigger)")

    # ---- 2a. Pending stop: position just filled, place initial stop now ----
    if ($pos.protective_type -eq "pending") {
        Write-Narr "$sym - Position confirmed open. Placing initial stop at $($pos.stop_price)."
        try {
            $sOrder = Place-StopSell $sym $qty ([double]$pos.stop_price)
            $pos.protective_type     = "fixed"
            $pos.protective_order_id = $sOrder.id
            Save-State @{ positions = $updatedPositions + @($pos) + @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" -and $_.symbol -ne $sym }) }
            Write-Narr "$sym - Initial stop placed at $($pos.stop_price) (order $($sOrder.id))"
        } catch {
            Write-Narr "$sym - Failed to place initial stop: $($_.Exception.Message)"
            $updatedPositions += $pos; continue
        }
    }

    # ---- 2b. Trailing stop: Alpaca manages server-side, just verify ----
    if ($pos.protective_type -eq "trailing") {
        Write-Narr "$sym - Trailing stop active. Alpaca managing."
        $updatedPositions += $pos
        continue
    }

    # ---- 3. Activate trailing stop when price >= trail_trigger ----
    if ($curPrice -ge [double]$pos.trail_trigger) {
        Write-Narr "$sym - TRAIL ACTIVATE: price=$curPrice >= $($pos.trail_trigger). Switching to $($pos.trail_percent)% trailing stop."
        Cancel-Order $pos.protective_order_id
        try {
            $tOrder = Place-TrailingStopSell $sym $qty $pos.trail_percent
            $pos.protective_type      = "trailing"
            $pos.protective_order_id  = $tOrder.id
            $pos.stop_price           = 0   # managed by Alpaca
            Save-State @{ positions = $updatedPositions + @($pos) + @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" -and $_.symbol -ne $sym }) }
            Write-Narr "$sym - Trailing stop order placed: id=$($tOrder.id)"
        } catch {
            Write-Narr "$sym - Failed to place trailing stop: $($_.Exception.Message)"
        }
        $updatedPositions += $pos
        continue
    }

    # ---- 4. Move stop to breakeven when price >= breakeven_trigger ----
    if ($curPrice -ge [double]$pos.breakeven_trigger -and $pos.protective_type -eq "fixed") {
        $bePrice = [math]::Round($entry + 0.02, 2)   # 2 cents above entry - guarantees small profit
        Write-Narr "$sym - BREAKEVEN: price=$curPrice >= $($pos.breakeven_trigger). Moving stop from $($pos.stop_price) to $bePrice."
        Cancel-Order $pos.protective_order_id
        try {
            $bOrder = Place-StopSell $sym $qty $bePrice
            $pos.protective_type     = "breakeven"
            $pos.protective_order_id = $bOrder.id
            $pos.stop_price          = $bePrice
            Save-State @{ positions = $updatedPositions + @($pos) + @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" -and $_.symbol -ne $sym }) }
            Write-Narr "$sym - Breakeven stop set at $bePrice (order $($bOrder.id))."
        } catch {
            Write-Narr "$sym - Failed to move stop to breakeven: $($_.Exception.Message)"
        }
    }

    # ---- 5. DCA Rung 1: price dropped to rung1_trigger ----
    if (-not $pos.rung1_fired -and $curPrice -le [double]$pos.rung1_trigger) {
        $addQty = [int]$pos.rung1_qty
        Write-Narr "$sym - DCA RUNG 1: price=$curPrice <= $($pos.rung1_trigger). Buying $addQty more shares."
        try {
            $dOrder = Place-MarketBuy $sym $addQty
            $fillP  = if ($dOrder.filled_avg_price -and [double]$dOrder.filled_avg_price -gt 0) {
                [double]$dOrder.filled_avg_price } else { $curPrice }
            $pos.rung1_fired = $true
            $newTotalQty     = $qty + $addQty

            # Cancel old stop, replace covering all shares at same stop level
            Cancel-Order $pos.protective_order_id
            $newStop = Place-StopSell $sym $newTotalQty ([double]$pos.stop_price)
            $pos.protective_order_id = $newStop.id
            $pos.qty = $newTotalQty

            # Recalculate blended avg cost and update triggers
            $newAvg = ($qty * $entry + $addQty * $fillP) / $newTotalQty
            $pos.entry_price       = [math]::Round($newAvg, 2)
            $pos.breakeven_trigger = [math]::Round($newAvg + $atr * 1.5, 2)
            $pos.trail_trigger     = [math]::Round($newAvg + $atr * 3.0, 2)

            Save-State @{ positions = $updatedPositions + @($pos) + @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" -and $_.symbol -ne $sym }) }
            Write-Narr ("$sym - DCA1 done: bought $addQty @$fillP. New avg=$($pos.entry_price) total=$newTotalQty " +
                        "| new BE=$($pos.breakeven_trigger) trail=$($pos.trail_trigger)")
        } catch {
            Write-Narr "$sym - DCA Rung 1 failed: $($_.Exception.Message)"
        }
    }

    # ---- 6. DCA Rung 2: price dropped to rung2_trigger ----
    if (-not $pos.rung2_fired -and $curPrice -le [double]$pos.rung2_trigger) {
        $addQty = [int]$pos.rung2_qty
        Write-Narr "$sym - DCA RUNG 2: price=$curPrice <= $($pos.rung2_trigger). Buying $addQty more shares."
        try {
            $dOrder = Place-MarketBuy $sym $addQty
            $fillP  = if ($dOrder.filled_avg_price -and [double]$dOrder.filled_avg_price -gt 0) {
                [double]$dOrder.filled_avg_price } else { $curPrice }
            $pos.rung2_fired = $true
            $newTotalQty     = [int]$pos.qty + $addQty
            $curAvg          = [double]$pos.entry_price

            # Final protective stop: 10% below the current (deep dip) price
            $finalStop = [math]::Round($curPrice * 0.90, 2)
            Cancel-Order $pos.protective_order_id
            $newStop = Place-StopSell $sym $newTotalQty $finalStop
            $pos.protective_type     = "final_stop"
            $pos.protective_order_id = $newStop.id
            $pos.stop_price          = $finalStop

            # New blended avg
            $newAvg = ($curAvg * [int]$pos.qty + $addQty * $fillP) / $newTotalQty
            $pos.entry_price       = [math]::Round($newAvg, 2)
            $pos.breakeven_trigger = [math]::Round($newAvg + $atr * 1.5, 2)
            $pos.trail_trigger     = [math]::Round($newAvg + $atr * 3.0, 2)
            $pos.qty               = $newTotalQty

            Save-State @{ positions = $updatedPositions + @($pos) + @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" -and $_.symbol -ne $sym }) }
            Write-Narr ("$sym - DCA2 done: bought $addQty @$fillP. New avg=$($pos.entry_price) total=$newTotalQty " +
                        "| final_stop=$finalStop BE=$($pos.breakeven_trigger) trail=$($pos.trail_trigger)")
        } catch {
            Write-Narr "$sym - DCA Rung 2 failed: $($_.Exception.Message)"
        }
    }

    $updatedPositions += $pos
}

# Rebuild state: dynamic positions (updated) + any bracket positions (untouched)
$bracketPositions = @($state.positions | Where-Object { $_.managed_mode -ne "dynamic" })
$state.positions  = @($updatedPositions) + @($bracketPositions)
Save-State $state

Write-Narr "=== Manager done. Active dynamic positions: $($updatedPositions.Count) ==="
