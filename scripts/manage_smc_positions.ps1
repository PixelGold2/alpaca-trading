# manage_smc_positions.ps1 - Lifecycle manager for SMC institutional positions.
# Progressive stop ladder: BE at 1R, +0.5R at 1.5R, T1 at 2R, +1R at 2.5R, T2 at 3R, ATR trail.
# Tracks daily drawdown and consecutive losses.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE      = "$PSScriptRoot\..\logs\smc_session_state.json"
$NARR_LOG        = "$PSScriptRoot\..\logs\smc_session_log.csv"
$TRADE_LOG       = "$PSScriptRoot\..\logs\trades_log.csv"
$TRAIL_PCT_CRYPTO = 7.0   # trail % for crypto after T2
$TRAIL_PCT_STOCK  = 4.0   # trail % for stocks after T2

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
    $dp = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_stop_update"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $atyp) {
    if ($atyp -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $dp = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_t2"; return $o
}

function Get-DP($price, $atyp) {
    if ($atyp -eq "stock") { return 2 }
    if ([double]$price -ge 1000) { return 2 } elseif ([double]$price -ge 1) { return 4 } else { return 6 }
}

function Get-CryptoPrice($sym) {
    $enc = [uri]::EscapeDataString($sym)
    $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v1beta3/crypto/us/latest/bars?symbols=$enc" -Method Get -Headers $alpacaHeaders
    return [double]($r.bars.PSObject.Properties[$sym].Value.c)
}

function Get-StockPrice($sym) {
    $enc = [uri]::EscapeDataString($sym)
    $r   = Invoke-RestMethod -Uri "https://data.alpaca.markets/v2/stocks/trades/latest?symbols=$enc&feed=iex" -Method Get -Headers $alpacaHeaders
    return [double]($r.trades.PSObject.Properties[$sym].Value.p)
}

function Get-Price($sym, $atyp) {
    try {
        if ($atyp -eq "crypto") { return Get-CryptoPrice $sym } else { return Get-StockPrice $sym }
    } catch { return 0.0 }
}

# Raise stop to a new level. Always verify it's higher than current before calling.
function Raise-Stop($pos, $newStop, $qty, $atyp) {
    $sym = $pos.symbol
    $dp  = Get-DP $newStop $atyp
    $newStop = [math]::Round($newStop, $dp)
    $newLim  = [math]::Round($newStop * 0.9975, $dp)
    if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
    try {
        $sOrd = Place-StopLimit $sym $qty $newStop $newLim $atyp
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

try { $account = Get-Account; $equity = [double]$account.equity } catch { $equity = 0 }

# Reset daily counters on new day
$today = Get-Date -Format "yyyy-MM-dd"
if ($state.daily_date -ne $today) {
    $state.daily_date         = $today
    $state.daily_pnl          = 0.0
    $state.consecutive_losses = 0
    if ($equity -gt 0) { $state.daily_high_equity = $equity }
}

$updatedPositions = @()
$removedCount = 0

foreach ($pos in $positions) {
    $sym   = $pos.symbol
    $atyp  = $pos.asset_type
    $entry = [double]$pos.entry_price
    $dp    = Get-DP $entry $atyp

    # ---- Verify position still open in Alpaca ----
    $alpPos = Get-AlpacaPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - No longer in Alpaca, checking orders..."
        $stopFilled = $false
        if ($pos.stop_order_id) {
            $so = Get-Order $pos.stop_order_id
            if ($so -and $so.status -eq "filled") {
                $stopFilled = $true
                $exitPx = [double]$so.filled_avg_price
                $pnl    = [math]::Round(($exitPx - $entry) * [double]$so.filled_qty, 2)
                Write-Narr "$sym - STOPPED OUT at $exitPx | PnL: `$$pnl"
                Log-Trade $so "smc_stop_hit"
                $state.daily_pnl = [double]$state.daily_pnl + $pnl
                if ($pnl -lt 0) { $state.consecutive_losses = [int]$state.consecutive_losses + 1 }
                else { $state.consecutive_losses = 0 }
            }
        }
        if (-not $stopFilled) { Write-Narr "$sym - Position closed (T2/trail). Resetting loss streak." ; $state.consecutive_losses = 0 }
        foreach ($oid in @($pos.stop_order_id, $pos.t1_order_id, $pos.t2_order_id) | Where-Object { $_ }) {
            Cancel-Order $oid
        }
        $removedCount++
        continue
    }

    $curQty   = [double]$alpPos.qty
    $price    = Get-Price $sym $atyp
    if ($price -le 0) { Write-Narr "$sym - Could not get price, skipping"; $updatedPositions += $pos; continue }

    # R-unit derived from T1: T1 = entry + 2R, so R = (T1 - entry) / 2
    $stopR    = ([double]$pos.t1_price - $entry) / 2.0
    $t1Fired  = [bool]$pos.t1_fired
    $t2Fired  = [bool]$pos.t2_fired
    $curStop  = [double]$pos.stop_price
    $currentR = if ($stopR -gt 0) { ($price - $entry) / $stopR } else { 0 }
    $profitPct = [math]::Round(($price - $entry) / $entry * 100, 2)

    Write-Narr "$sym | price=$([math]::Round($price,$dp)) entry=$entry curR=$([math]::Round($currentR,2)) stop=$curStop phase=$($pos.phase)"

    # ---- T1 fill check ----
    if (-not $t1Fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            Write-Narr "$sym - T1 FILLED at $([double]$t1Ord.filled_avg_price)!"
            $t1Fired = $true; $pos.t1_fired = $true; $pos.phase = "t1_fired"
            Log-Trade $t1Ord "smc_t1_fill"

            # Cancel old stop, replace with BE stop on remaining qty
            $bePrice  = [math]::Round($entry, $dp)
            $beLim    = [math]::Round($bePrice * 0.9975, $dp)
            $remaining = $curQty
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
            try {
                $newStop = Place-StopLimit $sym $remaining $bePrice $beLim $atyp
                $pos.stop_order_id = $newStop.id; $pos.stop_price = $bePrice; $pos.stop_lim = $beLim
                $pos.at_breakeven  = $true
                Write-Narr "$sym - BE stop at $bePrice for $remaining (order $($newStop.id))"
            } catch { Write-Narr "$sym - BE stop failed: $($_.Exception.Message)" }

            # Place T2 limit
            if (-not $pos.t2_order_id) {
                try {
                    $t2Ord = Place-LimitSell $sym ([double]$pos.t2_qty) ([double]$pos.t2_price) $atyp
                    $pos.t2_order_id = $t2Ord.id
                    Write-Narr "$sym - T2 limit at $($pos.t2_price) for $($pos.t2_qty) (order $($t2Ord.id))"
                } catch { Write-Narr "$sym - T2 placement failed: $($_.Exception.Message)" }
            }
        }
    }

    # ---- T2 fill check ----
    if ($t1Fired -and -not $t2Fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym - T2 FILLED at $([double]$t2Ord.filled_avg_price)! Moving to trail phase."
            $t2Fired = $true; $pos.t2_fired = $true; $pos.phase = "trailing"
            Log-Trade $t2Ord "smc_t2_fill"

            # Cancel existing stop and start ATR-safe trail on remaining qty
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }
            $trailPct  = if ($atyp -eq "crypto") { $TRAIL_PCT_CRYPTO } else { $TRAIL_PCT_STOCK }
            $trailStop = [math]::Round($price * (1 - $trailPct / 100), $dp)
            $trailLim  = [math]::Round($trailStop * 0.9975, $dp)
            $trailQty  = $curQty
            try {
                $tOrd = Place-StopLimit $sym $trailQty $trailStop $trailLim $atyp
                $pos.stop_order_id = $tOrd.id; $pos.stop_price = $trailStop; $pos.stop_lim = $trailLim
                $pos.trail_high    = $price
                Write-Narr "$sym - Trail stop at $trailStop ($trailPct%) for $trailQty (order $($tOrd.id))"
            } catch { Write-Narr "$sym - Trail stop failed: $($_.Exception.Message)" }
        }
    }

    # ---- Progressive stop ladder (BEFORE T1 fires) ----
    if (-not $t1Fired) {
        # 1.5R milestone: move stop to entry + 0.5R (locks in 0.5R profit even if T1 pulls back)
        $target15R = $entry + $stopR * 1.5
        $stop05R   = $entry + $stopR * 0.5
        if ($currentR -ge 1.5 -and $curStop -lt $stop05R - 0.0001) {
            Write-Narr "$sym - Price at $([math]::Round($currentR,2))R. Raising stop to +0.5R ($([math]::Round($stop05R,$dp)))"
            $pos = Raise-Stop $pos $stop05R $curQty $atyp
            $curStop = [double]$pos.stop_price
        }
        # 1R milestone: move stop to breakeven
        elseif ($currentR -ge 1.0 -and -not [bool]$pos.at_breakeven -and $curStop -lt $entry - 0.0001) {
            Write-Narr "$sym - Price at 1R. Moving stop to breakeven ($([math]::Round($entry,$dp)))"
            $pos = Raise-Stop $pos $entry $curQty $atyp
            $pos.at_breakeven = $true
            $curStop = [double]$pos.stop_price
        }
    }

    # ---- Progressive stop ladder (AFTER T1, before T2) ----
    if ($t1Fired -and -not $t2Fired) {
        # 2.5R milestone: move stop to +1R (guaranteed 1R profit on remaining after T1 banked 50%)
        $stop1R = $entry + $stopR * 1.0
        if ($currentR -ge 2.5 -and $curStop -lt $stop1R - 0.0001) {
            Write-Narr "$sym - Price at $([math]::Round($currentR,2))R. Raising stop to +1R ($([math]::Round($stop1R,$dp)))"
            $pos = Raise-Stop $pos $stop1R $curQty $atyp
            $curStop = [double]$pos.stop_price
        }
    }

    # ---- Trailing phase: raise stop whenever price makes new high ----
    if ($t2Fired -and $pos.phase -eq "trailing") {
        $trailHigh = if ($pos.trail_high) { [double]$pos.trail_high } else { $price }
        $trailPct  = if ($atyp -eq "crypto") { $TRAIL_PCT_CRYPTO } else { $TRAIL_PCT_STOCK }
        if ($price -gt $trailHigh + 0.0001) {
            $newTrailStop = [math]::Round($price * (1 - $trailPct / 100), $dp)
            if ($newTrailStop -gt $curStop + 0.0001) {
                Write-Narr "$sym - New high $([math]::Round($price,$dp)) (+$profitPct%). Trailing stop $curStop -> $newTrailStop"
                $pos = Raise-Stop $pos $newTrailStop $curQty $atyp
                $pos.trail_high = $price
            }
        }
    }

    $updatedPositions += $pos
}

# Rebuild positions (preserve non-SMC entries)
$otherPositions  = @($state.positions | Where-Object { $_.managed_mode -ne "smc" })
$state.positions = @($otherPositions) + @($updatedPositions)
Save-State $state

if ($removedCount -gt 0) { Write-Narr "$removedCount position(s) closed and removed." }
Write-Narr "=== SMC MANAGE DONE ==="
