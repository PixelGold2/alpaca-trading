# tv_1min_positions.ps1 — Manages 1-min TradingView trade lifecycle on Alpaca
# Runs locally every ~60s while PC is on. GitHub Actions does NOT touch this state.
# LONG trail: stop = entry + (highestSeen - entry) * 0.5
# SHORT trail: stop = entry - (entry - lowestSeen) * 0.5
# T1 exits 50% at 2R, T2 exits 30% at 3R, remaining 20% trails.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\tv_1min_state.json"
$TRADE_LOG  = "$PSScriptRoot\..\logs\tv_1min_trades.csv"
$NARR_LOG   = "$PSScriptRoot\..\logs\tv_1min_log.csv"

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}
$BASE = $env:APCA_API_BASE_URL

function Write-Narr($msg) {
    if (-not (Test-Path $NARR_LOG)) { "timestamp,message" | Out-File $NARR_LOG -Encoding ascii }
    $safe = $msg -replace '"', "'"
    "$(Get-Date -Format o),""$safe""" | Add-Content $NARR_LOG
    Write-Output $msg
}

function Log-Trade($order, $note) {
    if (-not (Test-Path $TRADE_LOG)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price,note" | Out-File $TRADE_LOG -Encoding ascii
    }
    "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price),""$note""" | Add-Content $TRADE_LOG
}

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return $null
}

function Save-State($s) { $s | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding ascii }

function Get-DP($price, $atyp) {
    if ($atyp -eq "stock") { return 2 }
    if ([double]$price -ge 1000) { return 2 } elseif ([double]$price -ge 1) { return 4 } else { return 6 }
}

function TruncQty($qty, $atyp) {
    if ($atyp -eq "crypto") { return [math]::Floor([double]$qty * 1000000) / 1000000 }
    return [math]::Floor([double]$qty * 100) / 100
}

function Get-AlpacaPosition($sym) {
    try { return Invoke-RestMethod -Uri "$BASE/v2/positions/$([uri]::EscapeDataString($sym))" -Headers $hdr }
    catch { return $null }
}

function Get-Order($id) {
    try { return Invoke-RestMethod -Uri "$BASE/v2/orders/$id" -Headers $hdr }
    catch { return $null }
}

function Cancel-Order($id) {
    try { Invoke-RestMethod -Uri "$BASE/v2/orders/$id" -Method Delete -Headers $hdr | Out-Null }
    catch {}
}

function Get-Price($sym, $atyp) {
    try {
        if ($atyp -eq "crypto") {
            $enc = [uri]::EscapeDataString($sym)
            $r   = Invoke-RestMethod "https://data.alpaca.markets/v1beta3/crypto/us/latest/bars?symbols=$enc" -Headers $hdr
            return [double]($r.bars.PSObject.Properties[$sym].Value.c)
        } else {
            $enc = [uri]::EscapeDataString($sym)
            $r   = Invoke-RestMethod "https://data.alpaca.markets/v2/stocks/trades/latest?symbols=$enc&feed=iex" -Headers $hdr
            return [double]($r.trades.PSObject.Properties[$sym].Value.p)
        }
    } catch { return 0.0 }
}

function Place-StopOrder($sym, $qty, $stop, $lim, $side, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $stop $atyp
    $o  = Invoke-RestMethod "$BASE/v2/orders" -Method Post -Headers $hdr -Body (@{
        symbol        = $sym
        qty           = "$q"
        side          = $side
        type          = "stop_limit"
        stop_price    = [math]::Round($stop, $dp)
        limit_price   = [math]::Round($lim, $dp)
        time_in_force = "gtc"
    } | ConvertTo-Json)
    Log-Trade $o "1min_stop_update"
    return $o
}

function Place-LimitOrder($sym, $qty, $price, $side, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $price $atyp
    $o  = Invoke-RestMethod "$BASE/v2/orders" -Method Post -Headers $hdr -Body (@{
        symbol        = $sym
        qty           = "$q"
        side          = $side
        type          = "limit"
        limit_price   = [math]::Round($price, $dp)
        time_in_force = "gtc"
    } | ConvertTo-Json)
    Log-Trade $o "1min_limit"
    return $o
}

# Raise LONG stop upward
function Raise-Stop($pos, $newStop, $qty, $atyp) {
    $dp      = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 0.9975, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $o                 = Place-StopOrder $pos.symbol $qty $newStop $newLim "sell" $atyp
        $pos.stop_order_id = $o.id
        $pos.stop_price    = $newStop
        $pos.stop_lim      = $newLim
        Write-Narr "$($pos.symbol) LONG stop raised to $newStop"
    } catch { Write-Narr "$($pos.symbol) Stop raise failed: $($_.Exception.Message)" }
    return $pos
}

# Lower SHORT stop downward
function Lower-Stop($pos, $newStop, $qty, $atyp) {
    $dp      = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 1.0025, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $o                 = Place-StopOrder $pos.symbol $qty $newStop $newLim "buy" $atyp
        $pos.stop_order_id = $o.id
        $pos.stop_price    = $newStop
        $pos.stop_lim      = $newLim
        Write-Narr "$($pos.symbol) SHORT stop lowered to $newStop"
    } catch { Write-Narr "$($pos.symbol) Short stop adjust failed: $($_.Exception.Message)" }
    return $pos
}

# ---- MAIN ----

$state = Get-State
if (-not $state) { Write-Narr "No 1-min state file found."; exit }

$positions = @($state.positions | Where-Object { $_.managed_mode -eq "tv_1min" })
if ($positions.Count -eq 0) { Write-Narr "No active 1-min positions."; exit }

Write-Narr "=== 1MIN MANAGE: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($positions.Count) position(s) ==="

$updated = @()
$removed = 0

foreach ($pos in $positions) {
    $sym    = $pos.symbol
    $atyp   = $pos.asset_type
    $entry  = [double]$pos.entry_price
    $dp     = Get-DP $entry $atyp
    $isLong = ($pos.direction -ne "SHORT")

    # Check if position still open in Alpaca
    $alpPos = Get-AlpacaPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - Not in Alpaca. Checking stop..."
        if ($pos.stop_order_id) {
            $so = Get-Order $pos.stop_order_id
            if ($so -and $so.status -eq "filled") {
                $exitPx = [double]$so.filled_avg_price
                $pnl    = if ($isLong) {
                    [math]::Round(($exitPx - $entry) * [double]$so.filled_qty, 2)
                } else {
                    [math]::Round(($entry - $exitPx) * [double]$so.filled_qty, 2)
                }
                Write-Narr "$sym STOPPED OUT @ $exitPx | PnL: `$$pnl"
                Log-Trade $so "1min_stop_hit"
            }
        } else {
            Write-Narr "$sym Fully closed (T2/trail exit)."
        }
        foreach ($oid in @($pos.stop_order_id, $pos.t1_order_id, $pos.t2_order_id) | Where-Object { $_ }) {
            Cancel-Order $oid
        }
        $removed++
        continue
    }

    $curQty  = [double]$alpPos.qty
    $price   = Get-Price $sym $atyp
    if ($price -le 0) { Write-Narr "$sym Price unavailable, skipping"; $updated += $pos; continue }

    $t1Fired = [bool]$pos.t1_fired
    $t2Fired = [bool]$pos.t2_fired
    $curStop = [double]$pos.stop_price

    # R calculation from T1 (T1 is at 2R so R = |T1 - entry| / 2)
    $stopR    = [math]::Abs([double]$pos.t1_price - $entry) / 2.0
    $currentR = if ($stopR -gt 0 -and $isLong) {
        ($price - $entry) / $stopR
    } elseif ($stopR -gt 0) {
        ($entry - $price) / $stopR
    } else { 0 }

    # Track extremes
    if ($isLong) {
        $highSeen = if ($pos.highest_price) { [double]$pos.highest_price } else { $entry }
        if ($price -gt $highSeen) { $highSeen = $price; $pos.highest_price = $price }
    } else {
        $lowSeen = if ($pos.lowest_price) { [double]$pos.lowest_price } else { $entry }
        if ($price -lt $lowSeen) { $lowSeen = $price; $pos.lowest_price = $price }
    }

    $profitPct = if ($isLong) {
        [math]::Round(($price - $entry) / $entry * 100, 3)
    } else {
        [math]::Round(($entry - $price) / $entry * 100, 3)
    }
    $tag = if ($isLong) { "LONG" } else { "SHORT" }
    Write-Narr "$sym $tag | px=$([math]::Round($price,$dp)) entry=$entry R=$([math]::Round($currentR,2)) stop=$curStop profit=$profitPct%"

    # ---- T1 fill check ----
    if (-not $t1Fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            Write-Narr "$sym T1 FILLED @ $([double]$t1Ord.filled_avg_price) — 50% out"
            $t1Fired = $true; $pos.t1_fired = $true; $pos.phase = "t1_fired"
            Log-Trade $t1Ord "1min_t1_fill"

            # Cancel existing stop, move to breakeven
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
            $beStop = [math]::Round($entry, $dp)
            try {
                if ($isLong) {
                    $beLim = [math]::Round($beStop * 0.9975, $dp)
                    $beOrd = Place-StopOrder $sym $curQty $beStop $beLim "sell" $atyp
                } else {
                    $beLim = [math]::Round($beStop * 1.0025, $dp)
                    $beOrd = Place-StopOrder $sym $curQty $beStop $beLim "buy" $atyp
                }
                $pos.stop_order_id = $beOrd.id; $pos.stop_price = $beStop; $pos.stop_lim = $beLim
                $curStop = $beStop
                Write-Narr "$sym Stop moved to breakeven $beStop"
            } catch { Write-Narr "$sym BE stop failed: $($_.Exception.Message)" }

            # Place T2 limit
            if (-not $pos.t2_order_id) {
                try {
                    $t2Side = if ($isLong) { "sell" } else { "buy" }
                    $t2Ord  = Place-LimitOrder $sym ([double]$pos.t2_qty) ([double]$pos.t2_price) $t2Side $atyp
                    $pos.t2_order_id = $t2Ord.id
                    Write-Narr "$sym T2 placed @ $($pos.t2_price) qty=$($pos.t2_qty)"
                } catch { Write-Narr "$sym T2 placement failed: $($_.Exception.Message)" }
            }
        }
    }

    # ---- T2 fill check ----
    if ($t1Fired -and -not $t2Fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym T2 FILLED @ $([double]$t2Ord.filled_avg_price) — trailing 20%"
            $t2Fired = $true; $pos.t2_fired = $true; $pos.phase = "trailing"
            Log-Trade $t2Ord "1min_t2_fill"
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
        }
    }

    # ---- 50% profit trail ----
    if ($stopR -gt 0) {
        if ($isLong -and $highSeen -gt $entry) {
            $halfTrail = [math]::Round($entry + ($highSeen - $entry) * 0.5, $dp)
            $floor     = if ($t1Fired) { $entry } else { $curStop }
            $newStop   = [math]::Max($floor, $halfTrail)
            if ($newStop -gt ($curStop + 0.0001)) {
                Write-Narr "$sym Trail: high=$([math]::Round($highSeen,$dp)) -> stop $curStop -> $newStop"
                $pos     = Raise-Stop $pos $newStop $curQty $atyp
                $curStop = $newStop
            }
        } elseif (-not $isLong -and $lowSeen -lt $entry) {
            $halfTrail = [math]::Round($entry - ($entry - $lowSeen) * 0.5, $dp)
            $ceiling   = if ($t1Fired) { $entry } else { $curStop }
            $newStop   = [math]::Min($ceiling, $halfTrail)
            if ($newStop -lt ($curStop - 0.0001)) {
                Write-Narr "$sym Trail: low=$([math]::Round($lowSeen,$dp)) -> stop $curStop -> $newStop"
                $pos     = Lower-Stop $pos $newStop $curQty $atyp
                $curStop = $newStop
            }
        }
    }

    $updated += $pos
}

$state.positions = $updated
Save-State $state
if ($removed -gt 0) { Write-Narr "$removed position(s) closed and removed." }
Write-Narr "=== 1MIN MANAGE DONE ==="
