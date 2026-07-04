# smc_session.ps1 - SMC institutional strategy entry scanner.
# Scans full crypto market (24/7) and stocks (market hours).
# Supports LONG and SHORT entries. Max 3 simultaneous positions.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\smc_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\smc_session_log.csv"
$TRADE_LOG  = "$PSScriptRoot\..\logs\trades_log.csv"

$CRYPTO_PAIRS = @(
    "AAVE/USD","ADA/USD","ARB/USD","AVAX/USD","BAT/USD","BCH/USD","BONK/USD",
    "BTC/USD","CRV/USD","DOGE/USD","DOT/USD","ETH/USD","FIL/USD","GRT/USD",
    "HYPE/USD","LDO/USD","LINK/USD","LTC/USD","ONDO/USD","PEPE/USD","POL/USD",
    "RENDER/USD","SHIB/USD","SOL/USD","SUSHI/USD","TRUMP/USD","UNI/USD",
    "WIF/USD","XRP/USD","XTZ/USD","YFI/USD"
)
# Indices, sector ETFs, and large-cap stocks — scanned during pre-market + regular hours
$STOCK_PAIRS  = @(
    # Major indices
    "SPY","QQQ","DIA","IWM",
    # Sector ETFs
    "XLK","XLF","XLE","XLV","XLI","XLY","XLC",
    # Commodities / macro
    "GLD","SLV","TLT",
    # Mega-cap tech
    "AAPL","NVDA","MSFT","TSLA","META","AMZN","GOOGL","NFLX","AMD","AVGO","CRM",
    # Finance
    "JPM","GS","BAC","MS","V","MA",
    # Energy
    "XOM","CVX",
    # Other large-cap
    "WMT","COST","JNJ","ABBV","UNH",
    # High-vol / crypto-adjacent
    "COIN","MSTR","PLTR","UBER","SNOW"
)

$MAX_POSITIONS = 3
$RISK_PCT      = 0.02    # 2% equity risk per trade
$MAX_POS_PCT   = 0.30    # 30% equity max per position
$MIN_GRADE     = 80      # A- scalp threshold
$T1_PCT        = 0.50
$T2_PCT        = 0.30

$PS = if ($IsWindows) { "powershell.exe" } else { "pwsh" }

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

function Get-Account { Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $alpacaHeaders }

function Get-State {
    if (Test-Path $STATE_FILE) {
        $s = Get-Content $STATE_FILE -Raw | ConvertFrom-Json
        if (-not $s.positions) { $s | Add-Member -NotePropertyName positions -NotePropertyValue @() -Force }
        return $s
    }
    return [PSCustomObject]@{
        positions          = @()
        session_started    = (Get-Date -Format o)
        consecutive_losses = 0
        daily_pnl          = 0.0
        daily_date         = (Get-Date -Format "yyyy-MM-dd")
        daily_high_equity  = 0.0
    }
}

function Save-State($s) { $s | ConvertTo-Json -Depth 10 | Out-File $STATE_FILE -Encoding ascii }

function TruncCrypto($qty) { return [math]::Floor([double]$qty * 1000000) / 1000000 }
function TruncStock($qty)  { return [math]::Floor([double]$qty * 100) / 100 }

function Get-DP($price, $atyp) {
    if ($atyp -eq "stock") { return 2 }
    if ([double]$price -ge 1000) { return 2 } elseif ([double]$price -ge 1) { return 4 } else { return 6 }
}

function TruncQty($qty, $atyp) {
    if ($atyp -eq "crypto") { return TruncCrypto $qty } else { return TruncStock $qty }
}

# ---- LONG order helpers ----
# Extended-hours stocks use limit orders; crypto and regular session use market orders.
function Place-MarketBuy($sym, $qty, $atyp, $extended = $false) {
    $q = TruncQty $qty $atyp
    if ($extended -and $atyp -eq "stock") {
        # Pre/after-market: limit buy slightly above ask to ensure fill
        $quote = Get-Quote $sym $atyp
        $lim   = [math]::Round($quote * 1.002, 2)
        $body  = @{ symbol=$sym; qty="$q"; side="buy"; type="limit"; limit_price=$lim; time_in_force="day"; extended_hours=$true } | ConvertTo-Json
    } else {
        $tif  = if ($atyp -eq "crypto") { "gtc" } else { "day" }
        $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force=$tif } | ConvertTo-Json
    }
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "smc_long_entry"; return $o
}

function Place-SellStopLimit($sym, $qty, $stop, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_long_stop"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_long_t1"; return $o
}

# ---- SHORT order helpers ----
function Place-MarketSell($sym, $qty, $atyp, $extended = $false) {
    $q = TruncQty $qty $atyp
    if ($extended -and $atyp -eq "stock") {
        $quote = Get-Quote $sym $atyp
        $lim   = [math]::Round($quote * 0.998, 2)
        $body  = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=$lim; time_in_force="day"; extended_hours=$true } | ConvertTo-Json
    } else {
        $tif  = if ($atyp -eq "crypto") { "gtc" } else { "day" }
        $body = @{ symbol=$sym; qty="$q"; side="sell"; type="market"; time_in_force=$tif } | ConvertTo-Json
    }
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "smc_short_entry"; return $o
}

function Place-BuyStopLimit($sym, $qty, $stop, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $stop $atyp
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_short_stop"; return $o
}

function Place-LimitBuy($sym, $qty, $lim, $atyp) {
    $q  = TruncQty $qty $atyp
    $dp = Get-DP $lim $atyp
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_short_t1"; return $o
}

function Get-Quote($sym, $atyp) {
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

function Get-OtherStateSymbols {
    $syms = @()
    foreach ($f in @("bounce_session_state.json","mtf_session_state.json","stock_session_state.json")) {
        $p = "$PSScriptRoot\..\logs\$f"
        if (Test-Path $p) {
            try {
                $s = Get-Content $p -Raw | ConvertFrom-Json
                if ($s.positions) { $syms += $s.positions | ForEach-Object { $_.symbol } }
            } catch {}
        }
    }
    return $syms
}

# ---- MAIN --------------------------------------------------------------------

$state   = Get-State
$account = Get-Account
$equity  = [double]$account.equity

$today = Get-Date -Format "yyyy-MM-dd"
if ($state.daily_date -ne $today) {
    $state.daily_date         = $today
    $state.daily_pnl          = 0.0
    $state.consecutive_losses = 0
    $state.daily_high_equity  = $equity
}
if (-not $state.daily_high_equity -or [double]$state.daily_high_equity -eq 0) {
    $state.daily_high_equity = $equity
}

Write-Narr "=== SMC SESSION: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Equity: $([math]::Round($equity,0)) ==="

$dailyDDPct = if ([double]$state.daily_high_equity -gt 0) {
    ($equity - [double]$state.daily_high_equity) / [double]$state.daily_high_equity * 100
} else { 0.0 }

if ($dailyDDPct -le -3.0) {
    Write-Narr "DAILY DRAWDOWN LIMIT HIT ($([math]::Round($dailyDDPct,2))%) - no new trades today."
    Save-State $state; exit
}
if ([int]$state.consecutive_losses -ge 3) {
    Write-Narr "3 CONSECUTIVE LOSSES - no new trades today. Reset tomorrow."
    Save-State $state; exit
}

$openPositions = @($state.positions | Where-Object { $_.managed_mode -eq "smc" })
$slots = $MAX_POSITIONS - $openPositions.Count
Write-Narr "SMC positions: $($openPositions.Count)/$MAX_POSITIONS | Consec.losses: $($state.consecutive_losses) | Daily DD: $([math]::Round($dailyDDPct,2))%"

if ($slots -le 0) { Write-Narr "All SMC slots full."; Save-State $state; exit }

$takenSymbols = @($openPositions | ForEach-Object { $_.symbol })
$takenSymbols += Get-OtherStateSymbols
$takenSymbols = $takenSymbols | Select-Object -Unique

$mkt = try { & "$PSScriptRoot\market_hours.ps1" } catch { [PSCustomObject]@{ IsOpen=$false; IsPreMarket=$false; IsExtended=$false } }

$scanList = @()
$CRYPTO_PAIRS | ForEach-Object { $scanList += @{ sym=$_; type="crypto"; extended=$false } }
# Stocks: scan during pre-market AND regular session
if ($mkt.IsOpen -or $mkt.IsPreMarket) {
    $isExt = -not $mkt.IsOpen  # true when pre-market only
    $STOCK_PAIRS | ForEach-Object { $scanList += @{ sym=$_; type="stock"; extended=$isExt } }
    $sessionTag = if ($mkt.IsOpen) { "regular session" } else { "PRE-MARKET" }
    Write-Narr "Stock session: $sessionTag"
}

Write-Narr "Scanning $($scanList.Count) symbols (min score $MIN_GRADE, LONG + SHORT)..."

$candidates = @()
foreach ($item in $scanList) {
    $sym  = $item.sym
    $atyp = $item.type
    if ($takenSymbols -contains $sym) { Write-Narr "  $sym - already held, skip"; continue }

    try {
        $outRaw = & $PS -ExecutionPolicy Bypass -NonInteractive -File "$PSScriptRoot\smc_analyzer.ps1" -Symbol $sym -AssetType $atyp 2>&1
        $outStr = ($outRaw | Out-String).Trim()
        if (-not $outStr) { Write-Narr "  $sym - no output"; continue }
        $out = $outStr | ConvertFrom-Json
    } catch {
        Write-Narr "  $sym - parse error: $($_.Exception.Message)"
        continue
    }

    if ($out.signal -ne "TRADE") {
        $reason = if ($out.reason) { $out.reason } else { "score=$($out.confidence) grade=$($out.grade)" }
        Write-Narr "  $sym - NO TRADE: $reason"
        continue
    }

    Write-Narr "  $sym - QUALIFIED | Grade:$($out.grade) Score:$($out.confidence) Dir:$($out.direction) RR:$($out.rr)"
    $out | Add-Member -NotePropertyName asset_type -NotePropertyValue $atyp -Force
    $out | Add-Member -NotePropertyName extended   -NotePropertyValue $item.extended -Force
    $candidates += $out
}

if ($candidates.Count -eq 0) { Write-Narr "No SMC setups qualified this scan."; Save-State $state; exit }

$ranked = @($candidates | Sort-Object { [int]$_.confidence } -Descending)
Write-Narr "=== QUALIFIED: $($ranked.Count) setup(s) ==="
foreach ($c in $ranked) {
    Write-Narr "  $($c.symbol) $($c.direction) Grade:$($c.grade) Score:$($c.confidence) RR:$($c.rr) | $($c.setup)"
}

$entered = 0
foreach ($c in $ranked) {
    if ($entered -ge $slots) { break }

    $sym      = $c.symbol
    $atyp     = $c.asset_type
    $dir      = $c.direction
    $isLong   = ($dir -eq "LONG")
    $extended = [bool]$c.extended
    $price    = [double]$c.entry
    $stop   = [double]$c.stop
    $rr     = [double]$c.rr
    $dp     = Get-DP $price $atyp

    $stopDist = [math]::Abs($price - $stop)
    if ($stopDist -le 0) { Write-Narr "$sym - invalid stop, skipping"; continue }

    $rawQty = ($equity * $RISK_PCT) / $stopDist
    $maxQty = ($equity * $MAX_POS_PCT) / $price
    $rawQty = [math]::Min($rawQty, $maxQty)
    $qty    = TruncQty $rawQty $atyp
    if ($qty -le 0) { Write-Narr "$sym - qty too small, skip"; continue }

    $notional = [math]::Round($qty * $price, 2)
    $riskAmt  = [math]::Round($qty * $stopDist, 2)
    Write-Narr "ENTERING $sym $dir | Grade:$($c.grade) Score:$($c.confidence) | qty=$qty (~`$$notional) risk=`$$riskAmt | stop=$stop RR=$rr"

    try {
        $entryOrder = if ($isLong) {
            Place-MarketBuy $sym $qty $atyp $extended
        } else {
            Place-MarketSell $sym $qty $atyp $extended
        }
        $fillPrice = if ([double]$entryOrder.filled_avg_price -gt 0) { [double]$entryOrder.filled_avg_price } else { $price }
        $fillQty   = if ([double]$entryOrder.filled_qty -gt 0) { [double]$entryOrder.filled_qty } else { $qty }
        Write-Narr "$sym - Filled $fillQty @ $([math]::Round($fillPrice,$dp))"

        $actualDist = [math]::Abs($fillPrice - $stop)

        # Targets go up for LONG, down for SHORT
        $fillT1 = if ($isLong) {
            [math]::Round($fillPrice + $actualDist * 2.0, $dp)
        } else {
            [math]::Round($fillPrice - $actualDist * 2.0, $dp)
        }
        $fillT2 = if ($isLong) {
            [math]::Round($fillPrice + $actualDist * 3.0, $dp)
        } else {
            [math]::Round($fillPrice - $actualDist * 3.0, $dp)
        }

        $fillStop    = [math]::Round($stop, $dp)
        # Limit for LONG sell-stop is below stop; for SHORT buy-stop is above stop
        $fillStopLim = if ($isLong) {
            [math]::Round($stop * 0.9975, $dp)
        } else {
            [math]::Round($stop * 1.0025, $dp)
        }

        $t1Qty    = TruncQty ($fillQty * $T1_PCT) $atyp
        $t2Qty    = TruncQty ($fillQty * $T2_PCT) $atyp
        $trailQty = TruncQty ($fillQty - $t1Qty - $t2Qty) $atyp

        $stopId = $null
        try {
            $sOrd = if ($isLong) {
                Place-SellStopLimit $sym $fillQty $fillStop $fillStopLim $atyp
            } else {
                Place-BuyStopLimit $sym $fillQty $fillStop $fillStopLim $atyp
            }
            $stopId = $sOrd.id
            Write-Narr "$sym - Stop at $fillStop (order $stopId)"
        } catch { Write-Narr "$sym - Stop placement failed: $($_.Exception.Message)" }

        $t1Id = $null
        try {
            $t1Ord = if ($isLong) {
                Place-LimitSell $sym $t1Qty $fillT1 $atyp
            } else {
                Place-LimitBuy $sym $t1Qty $fillT1 $atyp
            }
            $t1Id = $t1Ord.id
            Write-Narr "$sym - T1 at $fillT1 for $t1Qty (order $t1Id)"
        } catch { Write-Narr "$sym - T1 placement failed: $($_.Exception.Message)" }

        $pos = [ordered]@{
            symbol          = $sym
            asset_type      = $atyp
            managed_mode    = "smc"
            direction       = $dir
            phase           = if ($stopId) { "active" } else { "pending" }
            entry_price     = [math]::Round($fillPrice, $dp)
            total_qty       = $fillQty
            t1_qty          = $t1Qty
            t2_qty          = $t2Qty
            trail_qty       = $trailQty
            stop_price      = $fillStop
            stop_lim        = $fillStopLim
            t1_price        = $fillT1
            t2_price        = $fillT2
            breakeven_price = [math]::Round($fillPrice, $dp)
            t1_fired        = $false
            t2_fired        = $false
            stop_order_id   = $stopId
            t1_order_id     = $t1Id
            t2_order_id     = $null
            order_id        = $entryOrder.id
            opened_at       = (Get-Date -Format o)
            grade           = $c.grade
            score           = $c.confidence
            setup           = $c.setup
        }

        $state.positions = @($state.positions) + @($pos)
        Save-State $state
        Write-Narr "$sym LIVE $dir | entry=$([math]::Round($fillPrice,$dp)) stop=$fillStop T1=$fillT1 T2=$fillT2 risk=`$$riskAmt grade=$($c.grade)"
        $entered++

    } catch { Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)" }
}

Write-Narr "=== SMC SESSION DONE: $entered entries. ==="
Save-State $state
