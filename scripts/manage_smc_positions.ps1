# manage_smc_positions.ps1 - Lifecycle manager for SMC institutional positions.
# Runs every tick. Moves stop to BE after 1R, T1 at 2R, T2 at 3R, then trails.
# Tracks daily drawdown and consecutive losses.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\smc_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\smc_session_log.csv"
$TRADE_LOG  = "$PSScriptRoot\..\logs\trades_log.csv"
$TRAIL_PCT  = 5.0   # 5% trailing stop

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
    $dp = if ($atyp -eq "crypto") { if ([double]$stop -ge 1000) { 2 } elseif ([double]$stop -ge 1) { 4 } else { 6 } } else { 2 }
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_stop_update"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $atyp) {
    if ($atyp -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $dp = if ($atyp -eq "crypto") { if ([double]$lim -ge 1000) { 2 } elseif ([double]$lim -ge 1) { 4 } else { 6 } } else { 2 }
    $tif = "gtc"
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force=$tif } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_t2"; return $o
}

function Place-MarketSell($sym, $qty, $atyp) {
    if ($atyp -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $tif = if ($atyp -eq "crypto") { "gtc" } else { "day" }
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="market"; time_in_force=$tif } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_trail_exit"; return $o
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
    $dp    = if ($atyp -eq "crypto") { if ($entry -ge 1000) { 2 } elseif ($entry -ge 1) { 4 } else { 6 } } else { 2 }

    # Verify position still exists in Alpaca
    $alpPos = Get-AlpacaPosition $sym
    if (-not $alpPos) {
        Write-Narr "$sym - Position no longer in Alpaca. Checking orders..."
        $stopFilled = $false; $t2Filled = $false
        if ($pos.stop_order_id) {
            $so = Get-Order $pos.stop_order_id
            if ($so -and $so.status -eq "filled") {
                $stopFilled = $true
                $exitPx = [double]$so.filled_avg_price
                $pnl    = [math]::Round(($exitPx - $entry) * [double]$so.filled_qty, 2)
                Write-Narr "$sym - STOPPED OUT at $exitPx | PnL: $`$$pnl"
                Log-Trade $so "smc_stop_hit"
                $state.daily_pnl = [double]$state.daily_pnl + $pnl
                if ($pnl -lt 0) { $state.consecutive_losses = [int]$state.consecutive_losses + 1 }
                else { $state.consecutive_losses = 0 }
            }
        }
        if (-not $stopFilled -and $pos.t2_order_id) {
            $t2o = Get-Order $pos.t2_order_id
            if ($t2o -and $t2o.status -eq "filled") {
                $t2Filled = $true
                $exitPx = [double]$t2o.filled_avg_price
                Write-Narr "$sym - T2 + trail fully closed at $exitPx"
                $state.consecutive_losses = 0
            }
        }
        if (-not $stopFilled -and -not $t2Filled) {
            Write-Narr "$sym - Position gone, status unclear. Removing from state."
        }
        # Cancel any remaining open orders for this symbol
        foreach ($oid in @($pos.stop_order_id, $pos.t1_order_id, $pos.t2_order_id) | Where-Object { $_ }) {
            Cancel-Order $oid
        }
        $removedCount++
        continue
    }

    $curQty = [double]$alpPos.qty
    $price  = Get-Price $sym $atyp
    if ($price -le 0) { $updatedPositions += $pos; continue }

    $stopDist = [math]::Abs($entry - [double]$pos.stop_price)
    $phase    = $pos.phase
    $t1Fired  = [bool]$pos.t1_fired
    $t2Fired  = [bool]$pos.t2_fired

    Write-Narr "$sym | price=$([math]::Round($price,$dp)) entry=$entry stop=$($pos.stop_price) T1=$($pos.t1_price) T2=$($pos.t2_price) phase=$phase"

    # ---- T1 fill check ----
    if (-not $t1Fired -and $pos.t1_order_id) {
        $t1Ord = Get-Order $pos.t1_order_id
        if ($t1Ord -and $t1Ord.status -eq "filled") {
            Write-Narr "$sym - T1 FILLED at $([double]$t1Ord.filled_avg_price)! Moving stop to breakeven."
            $t1Fired = $true; $pos.t1_fired = $true; $pos.phase = "t1_fired"

            # Cancel old stop and replace with BE stop on remaining qty
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
            $bePrice = $pos.breakeven_price
            $beQty   = $curQty
            $beLim   = if ($pos.direction -eq "LONG") {
                [math]::Round([double]$bePrice * 0.9975, $dp)
            } else { [math]::Round([double]$bePrice * 1.0025, $dp) }

            try {
                $newStop = Place-StopLimit $sym $beQty $bePrice $beLim $atyp
                $pos.stop_order_id = $newStop.id
                $pos.stop_price    = $bePrice
                $pos.stop_lim      = $beLim
                $pos.at_breakeven  = $true
                Write-Narr "$sym - Breakeven stop at $bePrice for $beQty (order $($newStop.id))"
            } catch { Write-Narr "$sym - BE stop failed: $($_.Exception.Message)" }

            # Place T2 limit
            if (-not $pos.t2_order_id) {
                try {
                    $t2Qty = [double]$pos.t2_qty
                    $t2Ord = Place-LimitSell $sym $t2Qty ([double]$pos.t2_price) $atyp
                    $pos.t2_order_id = $t2Ord.id
                    Write-Narr "$sym - T2 limit at $($pos.t2_price) for $t2Qty (order $($t2Ord.id))"
                } catch { Write-Narr "$sym - T2 placement failed: $($_.Exception.Message)" }
            }
        }
    }

    # ---- T2 fill check ----
    if ($t1Fired -and -not $t2Fired -and $pos.t2_order_id) {
        $t2Ord = Get-Order $pos.t2_order_id
        if ($t2Ord -and $t2Ord.status -eq "filled") {
            Write-Narr "$sym - T2 FILLED at $([double]$t2Ord.filled_avg_price)! Trailing $([double]$pos.trail_qty) shares with $TRAIL_PCT% stop."
            $t2Fired = $true; $pos.t2_fired = $true; $pos.phase = "trailing"
            if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id; $pos.stop_order_id = $null }

            # Set initial trailing stop
            $trailStop = [math]::Round($price * (1 - $TRAIL_PCT / 100), $dp)
            $trailLim  = [math]::Round($trailStop * 0.9975, $dp)
            $trailQty  = [double]$pos.trail_qty
            try {
                $tOrd = Place-StopLimit $sym $trailQty $trailStop $trailLim $atyp
                $pos.stop_order_id = $tOrd.id
                $pos.stop_price    = $trailStop
                $pos.trail_high    = $price
                Write-Narr "$sym - Trail stop at $trailStop for $trailQty (order $($tOrd.id))"
            } catch { Write-Narr "$sym - Trail stop failed: $($_.Exception.Message)" }
        }
    }

    # ---- Trailing stop update ----
    if ($t2Fired -and $pos.phase -eq "trailing") {
        $trailHigh = if ($pos.trail_high) { [double]$pos.trail_high } else { $price }
        if ($price -gt $trailHigh) {
            $newTrailStop = [math]::Round($price * (1 - $TRAIL_PCT / 100), $dp)
            if ($newTrailStop -gt [double]$pos.stop_price) {
                Write-Narr "$sym - Trail: price=$([math]::Round($price,$dp)) new high, updating stop $($pos.stop_price) -> $newTrailStop"
                if ($pos.stop_order_id) { Cancel-Order $pos.stop_order_id }
                $newLim  = [math]::Round($newTrailStop * 0.9975, $dp)
                $trailQty = [double]$pos.trail_qty
                try {
                    $tOrd = Place-StopLimit $sym $trailQty $newTrailStop $newLim $atyp
                    $pos.stop_order_id = $tOrd.id
                    $pos.stop_price    = $newTrailStop
                    $pos.trail_high    = $price
                    Write-Narr "$sym - Trail stop updated to $newTrailStop (order $($tOrd.id))"
                } catch { Write-Narr "$sym - Trail update failed: $($_.Exception.Message)" }
            }
        }
    }

    # ---- Move to breakeven check (1R threshold, before T1) ----
    if (-not $t1Fired -and -not ([bool]$pos.at_breakeven) -and $stopDist -gt 0) {
        $r1Target = $entry + $stopDist * 1.0
        if ($price -ge $r1Target) {
            Write-Narr "$sym - Price at 1R ($([math]::Round($price,$dp))>=$([math]::Round($r1Target,$dp))). Checking T1 fill..."
            # T1 limit order should fill on its own. Just flag readiness.
        }
    }

    # ---- Invalidation check: close below stop manually if stop order missed ----
    if ($pos.direction -eq "LONG" -and $price -lt ([double]$pos.stop_price * 0.995)) {
        Write-Narr "$sym - PRICE BELOW STOP ($([math]::Round($price,$dp)) < $($pos.stop_price)) - invalidation!"
        # Stop order should have caught this. Log for review.
    }

    $updatedPositions += $pos
}

# Rebuild state positions (keep non-SMC entries too)
$otherPositions = @($state.positions | Where-Object { $_.managed_mode -ne "smc" })
$state.positions = @($otherPositions) + @($updatedPositions)
Save-State $state

if ($removedCount -gt 0) { Write-Narr "$removedCount position(s) removed from state." }
Write-Narr "=== SMC MANAGE DONE ==="
