# manage_crypto_positions.ps1 - Lifecycle manager for crypto session positions.
# Run every 5 minutes (24/7 - crypto never sleeps).
# Same state machine as manage_congress_positions.ps1 but uses crypto price endpoint.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\crypto_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\crypto_session_log.csv"
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
    return [PSCustomObject]@{ positions = @(); session_started = $null }
}

function Save-State($state) {
    $state | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8
}

function Get-CryptoPosition($sym) {
    # Alpaca stores crypto positions as "ETHUSD" (no slash) even though orders use "ETH/USD"
    $noSlash = $sym -replace "/", ""
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$noSlash" -Method Get -Headers $alpacaHeaders }
    catch { }
    $encSym = [uri]::EscapeDataString($sym)
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$encSym" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-CryptoPrice($sym) {
    $encSym = [uri]::EscapeDataString($sym)
    $r = Invoke-RestMethod -Uri "https://data.alpaca.markets/v1beta3/crypto/us/latest/trades?symbols=$encSym" -Method Get -Headers $alpacaHeaders
    return [double]$r.trades.PSObject.Properties[$sym].Value.p
}

function Round-CryptoQty($qty) {
    # Truncate (floor) at 6 decimal places - never round UP or we exceed position qty
    return [math]::Floor([double]$qty * 1000000) / 1000000
}

function Round-CryptoPrice($price) {
    if ($price -ge 1000) { return [math]::Round($price, 2) }
    if ($price -ge 1)    { return [math]::Round($price, 4) }
    return [math]::Round($price, 6)
}

function Cancel-Order($orderId) {
    if ($orderId) {
        try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$orderId" -Method Delete -Headers $alpacaHeaders | Out-Null } catch {}
    }
}

function Place-StopSell($sym, $qty, $stopPrice) {
    # Crypto requires stop_limit; limit = 0.25% below stop
    $sp  = Round-CryptoPrice $stopPrice
    $lim = Round-CryptoPrice ($stopPrice * 0.9975)
    $q   = Round-CryptoQty   $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"; stop_price=$sp; limit_price=$lim; time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "stop_update"
    return $order
}

function Place-TrailingStopSell($sym, $qty, $trailPct) {
    $q = Round-CryptoQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="trailing_stop"; trail_percent=$trailPct; time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $order "trailing_stop"
    return $order
}

function Place-MarketBuy($sym, $qty) {
    $q    = Round-CryptoQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="gtc" } | ConvertTo-Json
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $order "dca_buy"
    return $order
}

# ---- MAIN -------------------------------------------------------------------

$state = Get-State

$dynPositions = @($state.positions | Where-Object { $_.managed_mode -eq "crypto_dynamic" })
if ($dynPositions.Count -eq 0) {
    Write-Output "$(Get-Date -Format 'HH:mm') - No crypto positions to manage."
    exit
}

Write-Narr "=== Crypto Manager: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($dynPositions.Count) position(s) ==="

# Session expiry check
if ($state.session_started) {
    $elapsed = ((Get-Date) - [DateTime]::Parse($state.session_started)).TotalHours
    if ($elapsed -ge 4) {
        Write-Narr "=== 4-HOUR SESSION EXPIRED ($([math]::Round($elapsed,1))h). No new entries. Managing exits only. ==="
    }
}

$updatedPositions = @()
foreach ($pos in @($state.positions)) {
    if ($pos.managed_mode -ne "crypto_dynamic") { $updatedPositions += $pos; continue }

    $sym = $pos.symbol

    # -- 1. Check if position still open
    $alpacaPos = Get-CryptoPosition $sym
    if (-not $alpacaPos) {
        Write-Narr "$sym - Position closed. Removing from state."
        continue
    }

    $curPrice = Get-CryptoPrice $sym
    $qty      = [double]$alpacaPos.qty
    $entry    = [double]$pos.entry_price
    $atr      = [double]$pos.atr
    $pnlPct   = if ($entry -gt 0) { [math]::Round(($curPrice/$entry - 1)*100, 2) } else { 0 }

    Write-Narr ("$sym - price=$(Round-CryptoPrice $curPrice) entry=$(Round-CryptoPrice $entry) qty=$qty PnL=$pnlPct% " +
                "| type=$($pos.protective_type) stop=$($pos.stop_price) " +
                "| BE@$($pos.breakeven_trigger) trail@$($pos.trail_trigger)")

    # -- 2a. Pending: place initial stop now that order has filled
    if ($pos.protective_type -eq "pending") {
        Write-Narr "$sym - Placing initial stop at $($pos.stop_price)."
        try {
            $sOrder = Place-StopSell $sym $qty ([double]$pos.stop_price)
            $pos.protective_type     = "fixed"
            $pos.protective_order_id = $sOrder.id
            Write-Narr "$sym - Initial stop placed (order $($sOrder.id))"
        } catch {
            Write-Narr "$sym - Stop placement failed: $($_.Exception.Message)"
            $updatedPositions += $pos; continue
        }
    }

    # -- 2b. Trailing: Alpaca manages; just report
    if ($pos.protective_type -eq "trailing") {
        Write-Narr "$sym - Trailing stop active (Alpaca managing)."
        $updatedPositions += $pos; continue
    }

    # -- 3. Activate trailing stop
    if ($curPrice -ge [double]$pos.trail_trigger) {
        Write-Narr "$sym - TRAIL ACTIVATE: price=$(Round-CryptoPrice $curPrice) >= $($pos.trail_trigger). Switching to $($pos.trail_percent)% trailing stop."
        Cancel-Order $pos.protective_order_id
        try {
            $tOrder = Place-TrailingStopSell $sym $qty $pos.trail_percent
            $pos.protective_type     = "trailing"
            $pos.protective_order_id = $tOrder.id
            $pos.stop_price          = 0
            Write-Narr "$sym - Trailing stop placed: $($tOrder.id)"
        } catch {
            Write-Narr "$sym - Failed to place trailing stop: $($_.Exception.Message)"
        }
        $updatedPositions += $pos; continue
    }

    # -- 4. Move to breakeven
    if ($curPrice -ge [double]$pos.breakeven_trigger -and $pos.protective_type -eq "fixed") {
        $bePrice = Round-CryptoPrice ($entry * 1.001)   # 0.1% above entry (avoids commission-in-loss on spread)
        Write-Narr "$sym - BREAKEVEN: price=$(Round-CryptoPrice $curPrice). Moving stop to $bePrice."
        Cancel-Order $pos.protective_order_id
        try {
            $bOrder = Place-StopSell $sym $qty $bePrice
            $pos.protective_type     = "breakeven"
            $pos.protective_order_id = $bOrder.id
            $pos.stop_price          = $bePrice
            Write-Narr "$sym - Breakeven stop set at $bePrice (order $($bOrder.id))."
        } catch {
            Write-Narr "$sym - Failed to move to breakeven: $($_.Exception.Message)"
        }
    }

    # -- 5. DCA Rung 1
    if (-not $pos.rung1_fired -and $curPrice -le [double]$pos.rung1_trigger) {
        $addQty = [double]$pos.rung1_qty
        Write-Narr "$sym - DCA RUNG 1: price=$(Round-CryptoPrice $curPrice). Buying $addQty more."
        try {
            $dOrder = Place-MarketBuy $sym $addQty
            $fillP  = if ([double]$dOrder.filled_avg_price -gt 0) { [double]$dOrder.filled_avg_price } else { $curPrice }
            $newTotal   = $qty + $addQty
            $newAvg     = ($qty * $entry + $addQty * $fillP) / $newTotal
            $pos.rung1_fired = $true
            Cancel-Order $pos.protective_order_id
            $newStop = Place-StopSell $sym $newTotal ([double]$pos.stop_price)
            $pos.protective_order_id = $newStop.id
            $pos.qty               = $newTotal
            $pos.entry_price       = Round-CryptoPrice $newAvg
            $pos.breakeven_trigger = Round-CryptoPrice ($newAvg + $atr * 2.0)
            $pos.trail_trigger     = Round-CryptoPrice ($newAvg + $atr * 4.0)
            Write-Narr ("$sym - DCA1 done: +$addQty @$(Round-CryptoPrice $fillP) | new avg=$(Round-CryptoPrice $newAvg) total=$newTotal " +
                        "| BE@$($pos.breakeven_trigger) trail@$($pos.trail_trigger)")
        } catch {
            Write-Narr "$sym - DCA Rung 1 failed: $($_.Exception.Message)"
        }
    }

    # -- 6. DCA Rung 2
    if (-not $pos.rung2_fired -and $curPrice -le [double]$pos.rung2_trigger) {
        $addQty = [double]$pos.rung2_qty
        Write-Narr "$sym - DCA RUNG 2: price=$(Round-CryptoPrice $curPrice). Buying $addQty more."
        try {
            $dOrder  = Place-MarketBuy $sym $addQty
            $fillP   = if ([double]$dOrder.filled_avg_price -gt 0) { [double]$dOrder.filled_avg_price } else { $curPrice }
            $curAvg  = [double]$pos.entry_price
            $curQty  = [double]$pos.qty
            $newTotal = $curQty + $addQty
            $newAvg   = ($curAvg * $curQty + $addQty * $fillP) / $newTotal
            $finalStop = Round-CryptoPrice ($curPrice * 0.92)   # 8% final stop for crypto
            $pos.rung2_fired = $true
            Cancel-Order $pos.protective_order_id
            $newStop = Place-StopSell $sym $newTotal $finalStop
            $pos.protective_type     = "final_stop"
            $pos.protective_order_id = $newStop.id
            $pos.stop_price          = $finalStop
            $pos.entry_price         = Round-CryptoPrice $newAvg
            $pos.breakeven_trigger   = Round-CryptoPrice ($newAvg + $atr * 2.0)
            $pos.trail_trigger       = Round-CryptoPrice ($newAvg + $atr * 4.0)
            $pos.qty                 = $newTotal
            Write-Narr ("$sym - DCA2 done: +$addQty @$(Round-CryptoPrice $fillP) | new avg=$(Round-CryptoPrice $newAvg) total=$newTotal " +
                        "| final_stop=$finalStop")
        } catch {
            Write-Narr "$sym - DCA Rung 2 failed: $($_.Exception.Message)"
        }
    }

    $updatedPositions += $pos
}

$state.positions = $updatedPositions
Save-State $state
Write-Narr "=== Manager done. Open positions: $($updatedPositions.Count) ==="
