# manage_mtf_positions.ps1 - Lifecycle manager for MTF Confluence strategy.
# State machine: fixed stop + T1 limit ??? breakeven stop + T2 limit ??? trailing stop
# Run every 5 minutes (24/7 crypto).

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\mtf_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\mtf_session_log.csv"
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

function Save-State($state) { $state | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding utf8 }

function Get-CryptoPosition($sym) {
    $noSlash = $sym -replace "/", ""
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$noSlash" -Method Get -Headers $alpacaHeaders }
    catch { }
    $enc = [uri]::EscapeDataString($sym)
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$enc" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-CryptoPrice($sym) {
    $enc = [uri]::EscapeDataString($sym)
    $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v1beta3/crypto/us/latest/trades?symbols=$enc" -Method Get -Headers $alpacaHeaders
    return [double]$r.trades.PSObject.Properties[$sym].Value.p
}

function Get-Order($id) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Cancel-Order($id) {
    if ($id) { try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Delete -Headers $alpacaHeaders | Out-Null } catch {} }
}

function TruncQty($qty) { return [math]::Floor([double]$qty * 1000000) / 1000000 }

function RoundPx($price) {
    if ($price -ge 1000) { return [math]::Round($price, 2) }
    if ($price -ge 1)    { return [math]::Round($price, 4) }
    return [math]::Round($price, 6)
}

function Place-StopLimit($sym, $qty, $stop, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=(RoundPx $stop); limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "stop_limit"; return $o
}

function Place-LimitSell($sym, $qty, $lim) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"
               limit_price=(RoundPx $lim); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "limit_target"; return $o
}

function Place-TrailingStop($sym, $qty, $pct) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="trailing_stop"
               trail_percent=$pct; time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "trailing_stop"; return $o
}

function Place-MarketSell($sym, $qty) {
    $q    = TruncQty $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="market"; time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "market_sell"; return $o
}

# ---- MAIN -------------------------------------------------------------------

$state = Get-State
$dynPos = @($state.positions | Where-Object { $_.managed_mode -eq "mtf" })
if ($dynPos.Count -eq 0) { Write-Output "$(Get-Date -Format 'HH:mm') - No MTF positions."; exit }

Write-Narr "=== MTF Manager: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($dynPos.Count) position(s) ==="

# Session expiry: if 4 hours past session start, close any open positions
$sessionExpired = $false
if ($state.session_started) {
    $elapsed = ((Get-Date) - [DateTime]::Parse($state.session_started)).TotalHours
    if ($elapsed -ge 4) {
        Write-Narr "=== SESSION EXPIRED ($([math]::Round($elapsed,1))h). Closing all positions. ==="
        $sessionExpired = $true
    }
}

$updatedPositions = @()

foreach ($pos in @($state.positions)) {
    if ($pos.managed_mode -ne "mtf") { $updatedPositions += $pos; continue }

    $sym = $pos.symbol

    # Check if position still exists in Alpaca
    $alpPos = Get-CryptoPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - Position gone. Removing."
        Cancel-Order $pos.stop_order_id
        Cancel-Order $pos.t1_order_id
        Cancel-Order $pos.t2_order_id
        continue
    }

    $curQty   = [double]$alpPos.qty
    $curPrice = Get-CryptoPrice $sym
    $entry    = [double]$pos.entry_price
    $pnlPct   = [math]::Round(($curPrice / $entry - 1) * 100, 2)

    Write-Narr ("$sym - price=$(RoundPx $curPrice) entry=$(RoundPx $entry) qty=$curQty PnL=$pnlPct% " +
                "| phase=$($pos.phase) t1_fired=$($pos.t1_fired) t2_fired=$($pos.t2_fired)")

    # ---- SESSION EXPIRED: market-close everything ----
    if ($sessionExpired) {
        Write-Narr "$sym - Session expired. Closing position."
        Cancel-Order $pos.stop_order_id
        Cancel-Order $pos.t1_order_id
        Cancel-Order $pos.t2_order_id
        try { Place-MarketSell $sym $curQty | Out-Null; Write-Narr "$sym - Market sell placed for $curQty" }
        catch { Write-Narr "$sym - Market sell failed: $($_.Exception.Message)" }
        continue
    }

    # ---- PHASE: "pending" ??? place initial orders ----
    if ($pos.phase -eq "pending") {
        Write-Narr "$sym - Phase pending. Placing stop + T1 limit."
        $stopPlaced = $false; $t1Placed = $false

        try {
            $sOrder = Place-StopLimit $sym $curQty ([double]$pos.stop_price) ([double]$pos.stop_lim)
            $pos.stop_order_id = $sOrder.id; $stopPlaced = $true
            Write-Narr "$sym - Stop placed at $($pos.stop_price) (order $($sOrder.id))"
        } catch { Write-Narr "$sym - Stop failed: $($_.Exception.Message)" }

        if (-not $pos.t1_order_id) {
            try {
                $t1Qty  = TruncQty ([double]$pos.t1_qty)
                $t1Ord  = Place-LimitSell $sym $t1Qty ([double]$pos.t1_price)
                $pos.t1_order_id = $t1Ord.id; $t1Placed = $true
                Write-Narr "$sym - T1 limit placed at $($pos.t1_price) for $t1Qty (order $($t1Ord.id))"
            } catch { Write-Narr "$sym - T1 limit failed: $($_.Exception.Message)" }
        } else { $t1Placed = $true; Write-Narr "$sym - T1 already placed ($($pos.t1_order_id))" }

        if ($stopPlaced) { $pos.phase = "active" }
        $updatedPositions += $pos
        continue
    }

    # ---- PHASE: "trailing" ??? Alpaca manages, just check alive ----
    if ($pos.phase -eq "trailing") {
        Write-Narr "$sym - Trailing stop active (Alpaca manages)."
        $updatedPositions += $pos; continue
    }

    # ---- CHECK T2 LIMIT (if placed and t1 already fired) ----
    if ($pos.t1_fired -and -not $pos.t2_fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym - T2 HIT: sold $($pos.t2_qty) @ $(RoundPx $curPrice). Switching remaining $($pos.trail_qty) to trailing stop."
            Cancel-Order $pos.stop_order_id
            $pos.t2_fired = $true
            try {
                $trailOrd = Place-TrailingStop $sym ([double]$pos.trail_qty) 5.0
                $pos.phase         = "trailing"
                $pos.stop_order_id = $trailOrd.id
                Write-Narr "$sym - 5% trailing stop placed: $($trailOrd.id)"
            } catch { Write-Narr "$sym - Trailing stop failed: $($_.Exception.Message)" }
            $updatedPositions += $pos; continue
        }
    }

    # ---- CHECK T1 LIMIT ----
    if (-not $pos.t1_fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            $t1Fill = if ([double]$t1Ord.filled_avg_price -gt 0) { [double]$t1Ord.filled_avg_price } else { [double]$pos.t1_price }
            Write-Narr "$sym - T1 HIT: sold $($pos.t1_qty) @ $(RoundPx $t1Fill). Moving stop to breakeven."
            $pos.t1_fired = $true

            # Cancel old full-qty stop; place breakeven stop for remaining qty
            Cancel-Order $pos.stop_order_id
            $remainQty  = TruncQty ($curQty)   # Alpaca already shows reduced qty
            $bePrice    = RoundPx ([double]$pos.entry_price * 1.001)
            $beLim      = RoundPx ($bePrice * 0.9975)
            $pos.stop_order_id = $null
            try {
                $beOrd = Place-StopLimit $sym $remainQty $bePrice $beLim
                $pos.stop_order_id = $beOrd.id
                $pos.stop_price    = $bePrice
                Write-Narr "$sym - Breakeven stop at $bePrice (order $($beOrd.id))"
            } catch { Write-Narr "$sym - Breakeven stop failed: $($_.Exception.Message)" }

            # Place T2 limit sell for t2_qty
            $pos.t2_order_id = $null
            try {
                $t2Ord = Place-LimitSell $sym ([double]$pos.t2_qty) ([double]$pos.t2_price)
                $pos.t2_order_id = $t2Ord.id
                Write-Narr "$sym - T2 limit placed at $($pos.t2_price) for $($pos.t2_qty) (order $($t2Ord.id))"
            } catch { Write-Narr "$sym - T2 limit failed: $($_.Exception.Message)" }

            $updatedPositions += $pos; continue
        }
    }

    # ---- CHECK STOP (position closed by stop) ----
    if ($pos.stop_order_id) {
        $sOrd = Get-Order $pos.stop_order_id
        if ($sOrd -and $sOrd.status -in @("filled","partially_filled")) {
            Write-Narr "$sym - STOP HIT. Position closed. Cleaning up."
            Cancel-Order $pos.t1_order_id
            Cancel-Order $pos.t2_order_id
            continue   # remove from state
        }
    }

    $updatedPositions += $pos
}

$state.positions = $updatedPositions
Save-State $state
Write-Narr "=== MTF Manager done. Open positions: $($updatedPositions.Count) ==="



