# manage_stock_positions.ps1 - Lifecycle manager for stock/index positions.
# State machine: stop+T1 -> breakeven stop+T2 -> 5% trailing stop
# Run every 5 minutes during market hours.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\stock_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\stock_session_log.csv"
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

function Get-StockPosition($sym) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$sym" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-StockPrice($sym) {
    $enc = [uri]::EscapeDataString($sym)
    $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v2/stocks/trades/latest?symbols=$enc&feed=iex" -Method Get -Headers $alpacaHeaders
    return [double]$r.trades.PSObject.Properties[$sym].Value.p
}

function Get-Order($id) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Cancel-Order($id) {
    if ($id) { try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Delete -Headers $alpacaHeaders | Out-Null } catch {} }
}

function TruncQty($qty) { return [math]::Floor([double]$qty * 100) / 100 }
function RoundPx($p) { return [math]::Round($p, 2) }

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
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="market"; time_in_force="day" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "market_sell"; return $o
}

# ---- MAIN -------------------------------------------------------------------

$state  = Get-State
$dynPos = @($state.positions | Where-Object { $_.managed_mode -eq "stock" })
if ($dynPos.Count -eq 0) { Write-Output "$(Get-Date -Format 'HH:mm') - No stock positions."; exit }

Write-Narr "=== Stock Manager: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($dynPos.Count) position(s) ==="

# Check if market is still open; if closed, cancel open orders and hold (GTC stops remain)
$mktHours = & "$PSScriptRoot\market_hours.ps1"
$mktOpen  = $mktHours.IsOpen

$updatedPositions = @()

foreach ($pos in @($state.positions)) {
    if ($pos.managed_mode -ne "stock") { $updatedPositions += $pos; continue }

    $sym = $pos.symbol

    $alpPos = Get-StockPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - Position gone. Removing."
        Cancel-Order $pos.stop_order_id
        Cancel-Order $pos.t1_order_id
        Cancel-Order $pos.t2_order_id
        continue
    }

    $curQty   = [double]$alpPos.qty
    $curPrice = try { Get-StockPrice $sym } catch { [double]$alpPos.current_price }
    $entry    = [double]$pos.entry_price
    $pnlPct   = [math]::Round(($curPrice / $entry - 1) * 100, 2)

    Write-Narr ("$sym - price=$(RoundPx $curPrice) entry=$(RoundPx $entry) qty=$curQty PnL=$pnlPct% " +
                "| phase=$($pos.phase) t1_fired=$($pos.t1_fired) t2_fired=$($pos.t2_fired)")

    # ---- PHASE: "pending" - place initial orders ----
    if ($pos.phase -eq "pending") {
        $stopPlaced = $false

        $t1AlreadyOut = [bool]$pos.t1_order_id
        $stopQty = if ($t1AlreadyOut) { TruncQty ($curQty - [double]$pos.t1_qty) } else { $curQty }

        if ($stopQty -gt 0) {
            try {
                $sOrder = Place-StopLimit $sym $stopQty ([double]$pos.stop_price) ([double]$pos.stop_lim)
                $pos.stop_order_id = $sOrder.id; $stopPlaced = $true
                Write-Narr "$sym - Stop at $($pos.stop_price) for $stopQty (order $($sOrder.id))"
            } catch { Write-Narr "$sym - Stop failed: $($_.Exception.Message)" }
        }

        if (-not $pos.t1_order_id) {
            try {
                $t1Qty = TruncQty ([double]$pos.t1_qty)
                $t1Ord = Place-LimitSell $sym $t1Qty ([double]$pos.t1_price)
                $pos.t1_order_id = $t1Ord.id
                Write-Narr "$sym - T1 limit at $($pos.t1_price) for $t1Qty (order $($t1Ord.id))"
            } catch { Write-Narr "$sym - T1 failed: $($_.Exception.Message)" }
        } else { Write-Narr "$sym - T1 already placed ($($pos.t1_order_id))" }

        if ($stopPlaced) { $pos.phase = "active" }
        $updatedPositions += $pos; continue
    }

    # ---- PHASE: "trailing" ----
    if ($pos.phase -eq "trailing") {
        Write-Narr "$sym - Trailing stop active."
        $updatedPositions += $pos; continue
    }

    # ---- CHECK T2 ----
    if ($pos.t1_fired -and -not $pos.t2_fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym - T2 HIT. Switching $($pos.trail_qty) to 5% trailing stop."
            Cancel-Order $pos.stop_order_id
            $pos.t2_fired = $true
            try {
                $trailOrd          = Place-TrailingStop $sym ([double]$pos.trail_qty) 5.0
                $pos.phase         = "trailing"
                $pos.stop_order_id = $trailOrd.id
                Write-Narr "$sym - 5% trailing stop placed: $($trailOrd.id)"
            } catch { Write-Narr "$sym - Trailing stop failed: $($_.Exception.Message)" }
            $updatedPositions += $pos; continue
        }
    }

    # ---- CHECK T1 ----
    if (-not $pos.t1_fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            $t1Fill = if ([double]$t1Ord.filled_avg_price -gt 0) { [double]$t1Ord.filled_avg_price } else { [double]$pos.t1_price }
            Write-Narr "$sym - T1 HIT @ $(RoundPx $t1Fill). Moving stop to breakeven."
            $pos.t1_fired = $true
            Cancel-Order $pos.stop_order_id
            $remainQty = TruncQty $curQty
            $bePrice   = RoundPx ([double]$pos.entry_price * 1.001)
            $beLim     = RoundPx ($bePrice * 0.9975)
            $pos.stop_order_id = $null
            try {
                $beOrd = Place-StopLimit $sym $remainQty $bePrice $beLim
                $pos.stop_order_id = $beOrd.id
                $pos.stop_price    = $bePrice
                Write-Narr "$sym - Breakeven stop at $bePrice (order $($beOrd.id))"
            } catch { Write-Narr "$sym - Breakeven stop failed: $($_.Exception.Message)" }
            $pos.t2_order_id = $null
            try {
                $t2Ord = Place-LimitSell $sym ([double]$pos.t2_qty) ([double]$pos.t2_price)
                $pos.t2_order_id = $t2Ord.id
                Write-Narr "$sym - T2 limit at $($pos.t2_price) (order $($t2Ord.id))"
            } catch { Write-Narr "$sym - T2 failed: $($_.Exception.Message)" }
            $updatedPositions += $pos; continue
        }
    }

    # ---- CHECK STOP ----
    if ($pos.stop_order_id) {
        $sOrd = Get-Order $pos.stop_order_id
        if ($sOrd -and $sOrd.status -in @("filled","partially_filled")) {
            Write-Narr "$sym - STOP HIT. Cleaning up."
            Cancel-Order $pos.t1_order_id
            Cancel-Order $pos.t2_order_id
            continue
        }
    }

    $updatedPositions += $pos
}

$state.positions = $updatedPositions
Save-State $state
Write-Narr "=== Stock Manager done. Open positions: $($updatedPositions.Count) ==="

