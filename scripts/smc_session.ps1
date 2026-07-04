# smc_session.ps1 - SMC institutional strategy entry scanner.
# Scans crypto (24/7) and stocks (market hours). Only takes A- or better (score >= 84).
# Max 3 simultaneous positions. Risk 0.7% per trade. RR >= 2.0 required.

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE = "$PSScriptRoot\..\logs\smc_session_state.json"
$NARR_LOG   = "$PSScriptRoot\..\logs\smc_session_log.csv"
$TRADE_LOG  = "$PSScriptRoot\..\logs\trades_log.csv"

$CRYPTO_PAIRS = @("BTC/USD","ETH/USD","SOL/USD","XRP/USD")
$STOCK_PAIRS  = @("SPY","QQQ","DIA","AAPL","NVDA","MSFT","TSLA","META","AMZN","GOOGL")

$MAX_POSITIONS = 3
$RISK_PCT      = 0.007   # 0.7% equity risk per trade
$MAX_POS_PCT   = 0.12    # 12% equity max per position
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
function RoundPx($p, $dp = 4) { return [math]::Round($p, $dp) }

function Place-MarketBuy-Stock($sym, $qty) {
    $q = TruncStock $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="day" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "smc_entry_stock"; return $o
}

function Place-MarketBuy-Crypto($sym, $qty) {
    $q = TruncCrypto $qty
    $body = @{ symbol=$sym; qty="$q"; side="buy"; type="market"; time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Start-Sleep -Seconds 4
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($o.id)" -Method Get -Headers $alpacaHeaders
    Log-Trade $o "smc_entry_crypto"; return $o
}

function Place-StopLimit-Stock($sym, $qty, $stop, $lim) {
    $q = TruncStock $qty
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,2); limit_price=[math]::Round($lim,2); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_stop_stock"; return $o
}

function Place-StopLimit-Crypto($sym, $qty, $stop, $lim) {
    $q = TruncCrypto $qty
    $dp = if ([double]$stop -ge 1000) { 2 } elseif ([double]$stop -ge 1) { 4 } else { 6 }
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="stop_limit"
               stop_price=[math]::Round($stop,$dp); limit_price=[math]::Round($lim,$dp); time_in_force="gtc" } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_stop_crypto"; return $o
}

function Place-LimitSell($sym, $qty, $lim, $assetType) {
    if ($assetType -eq "crypto") { $q = TruncCrypto $qty } else { $q = TruncStock $qty }
    $dp = if ($assetType -eq "crypto") { if ([double]$lim -ge 1000) { 2 } elseif ([double]$lim -ge 1) { 4 } else { 6 } } else { 2 }
    $tif = if ($assetType -eq "crypto") { "gtc" } else { "gtc" }
    $body = @{ symbol=$sym; qty="$q"; side="sell"; type="limit"; limit_price=[math]::Round($lim,$dp); time_in_force=$tif } | ConvertTo-Json
    $o = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $alpacaHeaders -Body $body
    Log-Trade $o "smc_t1"; return $o
}

function Get-AlpacaPositions {
    try { return Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions" -Method Get -Headers $alpacaHeaders }
    catch { return @() }
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

# Reset daily counters if new day
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

# Check daily risk limits
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

# Count open SMC positions
$openPositions = @($state.positions | Where-Object { $_.managed_mode -eq "smc" })
$slots = $MAX_POSITIONS - $openPositions.Count
Write-Narr "SMC positions: $($openPositions.Count)/$MAX_POSITIONS | Consec.losses: $($state.consecutive_losses) | Daily DD: $([math]::Round($dailyDDPct,2))%"

if ($slots -le 0) { Write-Narr "All SMC slots full."; Save-State $state; exit }

# Symbols already held in any strategy
$takenSymbols = @($openPositions | ForEach-Object { $_.symbol })
$takenSymbols += Get-OtherStateSymbols
$takenSymbols = $takenSymbols | Select-Object -Unique

# Determine market status
$mkt = try { & "$PSScriptRoot\market_hours.ps1" } catch { [PSCustomObject]@{ IsOpen=$false } }

# Build scan list
$scanList = @()
$CRYPTO_PAIRS | ForEach-Object { $scanList += @{ sym=$_; type="crypto" } }
if ($mkt.IsOpen) { $STOCK_PAIRS | ForEach-Object { $scanList += @{ sym=$_; type="stock" } } }

Write-Narr "Scanning $($scanList.Count) symbols (A- threshold, min score $MIN_GRADE)..."

$candidates = @()
foreach ($item in $scanList) {
    $sym  = $item.sym
    $atyp = $item.type
    if ($takenSymbols -contains $sym) { Write-Narr "  $sym - already held, skip"; continue }

    Write-Narr "  Analyzing $sym ($atyp)..."
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

    Write-Narr "  $sym - QUALIFIED | Grade:$($out.grade) Score:$($out.confidence) Dir:$($out.direction) RR:$($out.rr) Setup:$($out.setup)"
    $out | Add-Member -NotePropertyName asset_type -NotePropertyValue $atyp -Force
    $candidates += $out
}

if ($candidates.Count -eq 0) { Write-Narr "No SMC setups qualified this scan."; Save-State $state; exit }

$ranked = @($candidates | Sort-Object { [int]$_.confidence } -Descending)
Write-Narr "=== QUALIFIED SMC SETUPS ($($ranked.Count)) ==="
foreach ($c in $ranked) {
    Write-Narr "  $($c.symbol) Grade:$($c.grade) Score:$($c.confidence) $($c.direction) RR:$($c.rr) | $($c.setup)"
    Write-Narr "    For: $(($c.reasons_for | Select-Object -First 3) -join ' + ')"
    Write-Narr "    Against: $(($c.reasons_against | Select-Object -First 2) -join ' + ')"
}

$entered = 0
foreach ($c in $ranked) {
    if ($entered -ge $slots) { break }

    $sym   = $c.symbol
    $atyp  = $c.asset_type
    $price = [double]$c.entry
    $stop  = [double]$c.stop
    $tp1   = [double]$c.tp1
    $tp2   = [double]$c.tp2
    $rr    = [double]$c.rr
    $stopDist = $price - $stop
    if ($stopDist -le 0) { Write-Narr "$sym - invalid stop, skipping"; continue }

    $dp = if ($atyp -eq "crypto") { if ($price -ge 1000) { 2 } elseif ($price -ge 1) { 4 } else { 6 } } else { 2 }

    $rawQty = ($equity * $RISK_PCT) / $stopDist
    $maxQty = ($equity * $MAX_POS_PCT) / $price
    $rawQty = [math]::Min($rawQty, $maxQty)
    $qty    = if ($atyp -eq "crypto") { TruncCrypto $rawQty } else { TruncStock $rawQty }
    if ($qty -le 0) { Write-Narr "$sym - qty too small, skip"; continue }

    $notional = [math]::Round($qty * $price, 2)
    $riskAmt  = [math]::Round($qty * $stopDist, 2)
    Write-Narr "ENTERING $sym | Grade:$($c.grade) Score:$($c.confidence) | qty=$qty (~$`$$notional) risk=$`$$riskAmt | stop=$stop T1=$tp1 T2=$tp2 RR=$rr"

    try {
        # Place market buy
        $buyOrder = if ($atyp -eq "crypto") {
            Place-MarketBuy-Crypto $sym $qty
        } else {
            Place-MarketBuy-Stock $sym $qty
        }
        $fillPrice = if ([double]$buyOrder.filled_avg_price -gt 0) { [double]$buyOrder.filled_avg_price } else { $price }
        $fillQty   = if ([double]$buyOrder.filled_qty -gt 0) { [double]$buyOrder.filled_qty } else { $qty }
        Write-Narr "$sym - Filled $fillQty @ $([math]::Round($fillPrice,$dp))"

        # Recalculate stop/targets at fill price
        $actualDist = [math]::Abs($fillPrice - $stop)
        $fillStop   = [math]::Round($stop, $dp)
        $fillStopLim = [math]::Round($stop * 0.9975, $dp)
        $fillT1     = [math]::Round($fillPrice + $actualDist * 2.0, $dp)
        $fillT2     = [math]::Round($fillPrice + $actualDist * 3.0, $dp)
        $fillBE     = [math]::Round($fillPrice, $dp)

        $t1Qty    = if ($atyp -eq "crypto") { TruncCrypto ($fillQty * $T1_PCT) } else { TruncStock ($fillQty * $T1_PCT) }
        $t2Qty    = if ($atyp -eq "crypto") { TruncCrypto ($fillQty * $T2_PCT) } else { TruncStock ($fillQty * $T2_PCT) }
        $trailQty = if ($atyp -eq "crypto") { TruncCrypto ($fillQty - $t1Qty - $t2Qty) } else { TruncStock ($fillQty - $t1Qty - $t2Qty) }

        # Place initial stop
        $stopId = $null
        try {
            $sOrd   = if ($atyp -eq "crypto") {
                Place-StopLimit-Crypto $sym $fillQty $fillStop $fillStopLim
            } else {
                Place-StopLimit-Stock $sym $fillQty $fillStop $fillStopLim
            }
            $stopId = $sOrd.id
            Write-Narr "$sym - Stop at $fillStop (order $stopId)"
        } catch { Write-Narr "$sym - Stop placement failed: $($_.Exception.Message)" }

        # Place T1 limit (2R target)
        $t1Id = $null
        try {
            $t1Ord = Place-LimitSell $sym $t1Qty $fillT1 $atyp
            $t1Id  = $t1Ord.id
            Write-Narr "$sym - T1 limit at $fillT1 for $t1Qty (order $t1Id)"
        } catch { Write-Narr "$sym - T1 placement failed: $($_.Exception.Message)" }

        $pos = [ordered]@{
            symbol         = $sym
            asset_type     = $atyp
            managed_mode   = "smc"
            direction      = "LONG"
            phase          = if ($stopId) { "active" } else { "pending" }
            entry_price    = [math]::Round($fillPrice, $dp)
            total_qty      = $fillQty
            t1_qty         = $t1Qty
            t2_qty         = $t2Qty
            trail_qty      = $trailQty
            stop_price     = $fillStop
            stop_lim       = $fillStopLim
            t1_price       = $fillT1
            t2_price       = $fillT2
            breakeven_price = $fillBE
            at_breakeven   = $false
            t1_fired       = $false
            t2_fired       = $false
            stop_order_id  = $stopId
            t1_order_id    = $t1Id
            t2_order_id    = $null
            order_id       = $buyOrder.id
            opened_at      = (Get-Date -Format o)
            grade          = $c.grade
            score          = $c.confidence
            setup          = $c.setup
            invalidation   = $c.invalidation
            management     = $c.management
        }

        $state.positions = @($state.positions) + @($pos)
        Save-State $state
        Write-Narr "$sym LIVE | entry=$([math]::Round($fillPrice,$dp)) stop=$fillStop T1=$fillT1 T2=$fillT2 risk=$`$$riskAmt grade=$($c.grade)"
        $entered++

    } catch { Write-Narr "$sym - ENTRY FAILED: $($_.Exception.Message)" }
}

Write-Narr "=== SMC SESSION DONE: $entered entries. ==="
Save-State $state
