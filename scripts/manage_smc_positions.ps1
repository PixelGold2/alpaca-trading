# manage_smc_positions.ps1 - SMC position lifecycle manager.
# LONG: stop = entry + (highestSeen - entry) * 0.5   (trail moves up)
# SHORT: stop = entry - (entry - lowestSeen) * 0.5   (trail moves down)
# T1 sells/covers 50% at 2R. T2 at 3R. Remaining 20% trails.

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

function TruncQty($qty, $atyp) {
    if ($atyp -eq "crypto") { return TruncCrypto $qty } else { return TruncStock $qty }
}

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

# LONG stop: sell stop_limit below price
function Place-SellStopLimit($sym, $qty, $stop, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_long_stop"; return $o
}

# SHORT stop: buy stop_limit above price
function Place-BuyStopLimit($sym, $qty, $stop, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_short_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_long_t2"; return $o
}

function Place-LimitBuy($sym, $qty, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_short_t2"; return $o
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

# Raise LONG stop upward (tightening toward profit)
function Raise-Stop($pos, $newStop, $qty, $atyp) {
    $sym     = $pos.symbol
    $dp      = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 0.9975, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $sOrd              = Place-SellStopLimit $sym $qty $newStop $newLim $atyp
        $pos.stop_order_id = $sOrd.id
        $pos.stop_price    = $newStop
        $pos.stop_lim      = $newLim
        Write-Narr "$sym - LONG stop raised to $newStop"
    } catch {
        Write-Narr "$sym - Stop raise failed: $($_.Exception.Message)"
        $pos.stop_order_id = $null
    }
    return $pos
}

# Lower SHORT stop downward (tightening toward profit)
function Lower-Stop($pos, $newStop, $qty, $atyp) {
    $sym     = $pos.symbol
    $dp      = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 1.0025, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $sOrd              = Place-BuyStopLimit $sym $qty $newStop $newLim $atyp
        $pos.stop_order_id = $sOrd.id
        $pos.stop_price    = $newStop
        $pos.stop_lim      = $newLim
        Write-Narr "$sym - SHORT stop lowered to $newStop"
    } catch {
        Write-Narr "$sym - Short stop adjust failed: $($_.Exception.Message)"
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
    $sym    = $pos.symbol
    $atyp   = $pos.asset_type
    $entry  = [double]$pos.entry_price
    $dp     = Get-DP $entry $atyp
    $isLong = ($pos.direction -ne "SHORT")

    # ---- Verify position still open in Alpaca ----
    $alpPos = Get-AlpacaPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - No longer in Alpaca. Checking stop order..."
        if ($pos.stop_order_id) {
            $so = Get-Order $pos.stop_order_id
            if ($so -and $so.status -eq "filled") {
                $exitPx = [double]$so.filled_avg_price
                $pnl    = if ($isLong) {
                    [math]::Round(($exitPx - $entry) * [double]$so.filled_qty, 2)
                } else {
                    [math]::Round(($entry - $exitPx) * [double]$so.filled_qty, 2)
                }
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

    $stopR = [math]::Abs([double]$pos.t1_price - $entry) / 2.0
    $currentR = if ($stopR -gt 0 -and $isLong) {
        ($price - $entry) / $stopR
    } elseif ($stopR -gt 0) {
        ($entry - $price) / $stopR
    } else { 0 }

    # Track extreme price (high for LONG, low for SHORT)
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
    $dirTag = if ($isLong) { "LONG" } else { "SHORT" }
    Write-Narr "$sym $dirTag | price=$([math]::Round($price,$dp)) entry=$entry R=$([math]::Round($currentR,2)) stop=$curStop profit=$profitPct%"

    # ---- T1 fill check (50% exit at 2R) ----
    if (-not $t1Fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            Write-Narr "$sym - T1 FILLED at $([double]$t1Ord.filled_avg_price)! (50% exited)"
            $t1Fired = $true; $pos.t1_fired = $true; $pos.phase = "t1_fired"
            Log-Trade $t1Ord "smc_t1_fill"
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }

            # Move stop to breakeven
            $beStop = [math]::Round($entry, $dp)
            try {
                if ($isLong) {
                    $beLim = [math]::Round($beStop * 0.9975, $dp)
                    $sOrd  = Place-SellStopLimit $sym $curQty $beStop $beLim $atyp
                } else {
                    $beLim = [math]::Round($beStop * 1.0025, $dp)
                    $sOrd  = Place-BuyStopLimit $sym $curQty $beStop $beLim $atyp
                }
                $pos.stop_order_id = $sOrd.id; $pos.stop_price = $beStop; $pos.stop_lim = $beLim
                $curStop = $beStop
                Write-Narr "$sym - Stop moved to breakeven $beStop"
            } catch { Write-Narr "$sym - BE stop failed: $($_.Exception.Message)" }

            # Place T2
            if (-not $pos.t2_order_id) {
                try {
                    $t2Ord = if ($isLong) {
                        Place-LimitSell $sym ([double]$pos.t2_qty) ([double]$pos.t2_price) $atyp
                    } else {
                        Place-LimitBuy $sym ([double]$pos.t2_qty) ([double]$pos.t2_price) $atyp
                    }
                    $pos.t2_order_id = $t2Ord.id
                    Write-Narr "$sym - T2 placed at $($pos.t2_price) for $($pos.t2_qty)"
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
    if ($stopR -gt 0) {
        if ($isLong -and $highSeen -gt $entry) {
            $halfTrail = [math]::Round($entry + ($highSeen - $entry) * 0.5, $dp)
            $floor     = if ($t1Fired) { $entry } else { $curStop }
            $newStop   = [math]::Max($floor, $halfTrail)
            if ($newStop -gt $curStop + 0.0001) {
                $gainLocked = [math]::Round(($newStop - $entry) / $entry * 100, 3)
                Write-Narr "$sym - Trail: high=$([math]::Round($highSeen,$dp)) -> stop $curStop -> $newStop (+$gainLocked%)"
                $pos = Raise-Stop $pos $newStop $curQty $atyp
                $curStop = $newStop
            }
        } elseif (-not $isLong -and $lowSeen -lt $entry) {
            $halfTrail = [math]::Round($entry - ($entry - $lowSeen) * 0.5, $dp)
            $ceiling   = if ($t1Fired) { $entry } else { $curStop }
            $newStop   = [math]::Min($ceiling, $halfTrail)
            if ($newStop -lt $curStop - 0.0001) {
                $gainLocked = [math]::Round(($entry - $newStop) / $entry * 100, 3)
                Write-Narr "$sym - Trail: low=$([math]::Round($lowSeen,$dp)) -> stop $curStop -> $newStop (+$gainLocked%)"
                $pos = Lower-Stop $pos $newStop $curQty $atyp
                $curStop = $newStop
            }
        }
    }

    $updatedPositions += $pos
}

$otherPositions  = @($state.positions | Where-Object { $_.managed_mode -ne "smc" })
$state.positions = @($otherPositions) + @($updatedPositions)
Save-State $state

if ($removedCount -gt 0) { Write-Narr "$removedCount position(s) closed." }
Write-Narr "=== SMC MANAGE DONE ==="
