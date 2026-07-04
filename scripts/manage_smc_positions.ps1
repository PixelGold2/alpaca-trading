# manage_smc_positions.ps1 - SMC position lifecycle manager.
# Stop trail: stop = entry + (highestPriceSeen - entry) * 0.5
# Example: buy $100, price hits $110 -> stop $105. Price hits $120 -> stop $110.
# T1 sells 50% at 2R. T2 sells 30% at 3R. Remaining 20% runs until 50% trail hits.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\smc_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\smc_session_log.csv"
$TRADE_LOG  = "$PSScriptRoot\..\logs\trades_log.csv"

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

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

function TruncCrypto($qty) { return [math]::Floor([double]$qty * 1000000) / 1000000 }
function TruncStock($qty)  { return [math]::Floor([double]$qty * 100) / 100 }

function Get-DP($price, $atyp) {
    if ($atyp -eq "stock") { return 2 }
    if ([double]$price -ge 1000) { return 2 } elseif ([double]$price -ge 1) { return 4 } else { return 6 }
}

function Get-AlpacaPosition($sym) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions/$([uri]::EscapeDataString($sym))" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Get-Account { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $alpacaHeaders }

function Get-Order($id) {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Get -Headers $alpacaHeaders }
    catch { return $null }
}

function Cancel-Order($id) {
    try { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$id" -Method Delete -Headers $alpacaHeaders | Out-Null }
    catch {}
}

function Place-StopLimit($sym, $qty, $stop, $lim, $atyp) {
    if ($atyp -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $dp   = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o    = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $atyp) {
    if ($atyp -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $dp   = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o    = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_limit"; return $o
}

function Get-Price($sym, $atyp) {
    try {
        if ($atyp -eq "crypto") {
            $enc = [uri]::EscapeDataString($sym)
            $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v1beta3/crypto/us/latest/bars?symbols=$enc" -Method Get -Headers $alpacaHeaders
            return [double]($r.bars.PSObject.Properties[$sym].Value.c)
        } else {
            $enc = [uri]::EscapeDataString($sym)
            $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v2/stocks/trades/latest?symbols=$enc&feed=iex" -Method Get -Headers $alpacaHeaders
            return [double]($r.trades.PSObject.Properties[$sym].Value.p)
        }
    } catch { return 0.0 }
}

# Raise stop to newStop. Only raises, never lowers.
function Raise-Stop($pos, $newStop, $qty, $atyp) {
    $sym     = $pos.symbol
    $dp      = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 0.9975, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $sOrd              = Place-StopLimit $sym $qty $newStop $newLim $atyp
        $pos.stop_order_id = $sOrd.id
        $pos.stop_price    = $newStop
        $pos.stop_lim      = $newLim
        Write-Narr "$sym - Stop raised to $newStop (order $($sOrd.id))"
    } catch {
        Write-Narr "$sym - Stop raise failed: $($_.Exception.Message)"
        $pos.stop_order_id = $null
    }
    return $pos
}

# ---- MAIN --------------------------------------------------------------------

$state = Get-State
if (-not $state) { Write-Narr "No SMC state found."; exit }

$positions = @($state.positions | Where-Object { $_.managed_mode -eq "smc" })
if ($positions.Count -eq 0) { Write-Narr "No active SMC positions."; exit }

Write-Narr "=== SMC MANAGE: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | $($positions.Count) position(s) ==="

try { $equity = [double](Get-Account).equity } catch { $equity = 0 }

$today = Get-Date -Format "yyyy-MM-dd"
if ($state.daily_date -ne $today) {
    $state.daily_date         = $today
    $state.daily_pnl          = 0.0
    $state.consecutive_losses = 0
    if ($equity -gt 0) { $state.daily_high_equity = $equity }
}

$updatedPositions = @()
$removedCount     = 0

foreach ($pos in $positions) {
    $sym   = $pos.symbol
    $atyp  = $pos.asset_type
    $entry = [double]$pos.entry_price
    $dp    = Get-DP $entry $atyp

    # ---- Verify position still open in Alpaca ----
    $alpPos = Get-AlpacaPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - No longer in Alpaca. Checking stop order..."
        if ($pos.stop_order_id) {
            $so = Get-Order $pos.stop_order_id
            if ($so -and $so.status -eq "filled") {
                $exitPx = [double]$so.filled_avg_price
                $pnl    = [math]::Round(($exitPx - $entry) * [double]$so.filled_qty, 2)
                Write-Narr "$sym - STOPPED OUT at $exitPx | PnL: `$$pnl"
                Log-Trade $so "smc_stop_hit"
                $state.daily_pnl = [double]$state.daily_pnl + $pnl
                if ($pnl -lt 0) { $state.consecutive_losses = [int]$state.consecutive_losses + 1 }
                else             { $state.consecutive_losses = 0 }
            }
        } else {
            Write-Narr "$sym - Fully closed (T2/trail exit)."
            $state.consecutive_losses = 0
        }
        foreach ($oid in @($pos.stop_order_id, $pos.t1_order_id, $pos.t2_order_id) | Where-Object { $_ }) {
            Cancel-Order $oid
        }
        $removedCount++
        continue
    }

    $curQty  = [double]$alpPos.qty
    $price   = Get-Price $sym $atyp
    if ($price -le 0) { Write-Narr "$sym - Price unavailable, skipping"; $updatedPositions += $pos; continue }

    $t1Fired = [bool]$pos.t1_fired
    $t2Fired = [bool]$pos.t2_fired
    $curStop = [double]$pos.stop_price

    # R-unit (T1 = entry + 2R, so R = (T1-entry)/2)
    $stopR   = ([double]$pos.t1_price - $entry) / 2.0
    $currentR = if ($stopR -gt 0) { ($price - $entry) / $stopR } else { 0 }

    # Track highest price seen for 50% trail
    $highSeen = if ($pos.highest_price) { [double]$pos.highest_price } else { $entry }
    if ($price -gt $highSeen) { $highSeen = $price; $pos.highest_price = $price }

    $profitPct = [math]::Round(($price - $entry) / $entry * 100, 3)
    Write-Narr "$sym | price=$([math]::Round($price,$dp)) entry=$entry R=$([math]::Round($currentR,2)) stop=$curStop high=$([math]::Round($highSeen,$dp)) profit=$profitPct%"

    # ---- T1 fill check (50% exit at 2R) ----
    if (-not $t1Fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            Write-Narr "$sym - T1 FILLED at $([double]$t1Ord.filled_avg_price)! (50% exited)"
            $t1Fired = $true; $pos.t1_fired = $true; $pos.phase = "t1_fired"
            Log-Trade $t1Ord "smc_t1_fill"

            # Cancel old stop, replace on remaining qty with breakeven floor
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
            $beStop = [math]::Round([math]::Max($entry, $curStop), $dp)
            $beLim  = [math]::Round($beStop * 0.9975, $dp)
            try {
                $sOrd = Place-StopLimit $sym $curQty $beStop $beLim $atyp
                $pos.stop_order_id = $sOrd.id; $pos.stop_price = $beStop; $pos.stop_lim = $beLim
                $curStop = $beStop
                Write-Narr "$sym - Stop reset to $beStop for remaining $curQty (order $($sOrd.id))"
            } catch { Write-Narr "$sym - Stop reset failed: $($_.Exception.Message)" }

            # Place T2 limit (30% at 3R)
            if (-not $pos.t2_order_id) {
                try {
                    $t2Ord = Place-LimitSell $sym ([double]$pos.t2_qty) ([double]$pos.t2_price) $atyp
                    $pos.t2_order_id = $t2Ord.id
                    Write-Narr "$sym - T2 limit at $($pos.t2_price) for $($pos.t2_qty) (order $($t2Ord.id))"
                } catch { Write-Narr "$sym - T2 placement failed: $($_.Exception.Message)" }
            }
        }
    }

    # ---- T2 fill check (30% exit at 3R) ----
    if ($t1Fired -and -not $t2Fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym - T2 FILLED at $([double]$t2Ord.filled_avg_price)! Trailing last $curQty"
            $t2Fired = $true; $pos.t2_fired = $true; $pos.phase = "trailing"
            Log-Trade $t2Ord "smc_t2_fill"
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
        }
    }

    # ---- 50% PROFIT TRAIL ----
    # Formula: stop = entry + (highestPriceSeen - entry) * 0.5
    # Kicks in once price is at or above 1R (meaningful move, not noise).
    # Minimum floor: original swing stop (before 1R), breakeven (after T1).
    if ($stopR -gt 0 -and $highSeen -gt $entry) {
        $halfTrail = $entry + ($highSeen - $entry) * 0.5
        $halfTrail = [math]::Round($halfTrail, $dp)

        # Floor: keep original tight stop until 1R, then lock in minimum at entry
        $floor = if ($t1Fired) { $entry } else { $curStop }
        $newStop = [math]::Max($floor, $halfTrail)

        if ($newStop -gt $curStop + 0.0001) {
            $gainLocked = [math]::Round(($newStop - $entry) / $entry * 100, 3)
            Write-Narr "$sym - 50% trail: high=$([math]::Round($highSeen,$dp)) -> stop $curStop -> $newStop (locking $gainLocked% gain)"
            $pos = Raise-Stop $pos $newStop $curQty $atyp
            $curStop = $newStop
        }
    }

    $updatedPositions += $pos
}

$otherPositions  = @($state.positions | Where-Object { $_.managed_mode -ne "smc" })
$state.positions = @($otherPositions) + @($updatedPositions)
Save-State $state

if ($removedCount -gt 0) { Write-Narr "$removedCount position(s) closed." }
Write-Narr "=== SMC MANAGE DONE ==="
