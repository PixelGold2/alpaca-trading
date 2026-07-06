# tv_1min_scanner.ps1 — Background 1-min SMC scanner (crypto 24/7 + stocks during market hours)
# Calls claude -p every 90s to read TradingView LuxAlgo data and fire trades
# Launch via: launch_scanner_bg.ps1 (runs hidden, no window)

. "$PSScriptRoot\..\config.ps1"

$STATE_FILE    = "$PSScriptRoot\..\logs\tv_scanner_state.json"
$SCAN_LOG      = "$PSScriptRoot\..\logs\tv_scanner.log"
$TRADE_STATE   = "$PSScriptRoot\..\logs\tv_1min_state.json"
$PID_FILE      = "$PSScriptRoot\..\logs\tv_scanner.pid"
$WATCHLIST_FILE = "$PSScriptRoot\..\logs\tv_stock_watchlist.json"
$SCAN_INTERVAL = 90   # seconds between scans
$MAX_OPEN_POSITIONS = 5

# Write PID so launcher can kill us
$PID | Out-File $PID_FILE -Encoding ascii

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}
$BASE      = $env:APCA_API_BASE_URL
$DATA_BASE = "https://data.alpaca.markets"

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $msg" | Add-Content $SCAN_LOG
}

function Get-ScanState {
    if (Test-Path $STATE_FILE) {
        try { return Get-Content $STATE_FILE -Raw | ConvertFrom-Json } catch {}
    }
    return [PSCustomObject]@{
        btc_ob_demand  = "unknown"; btc_ob_supply  = "unknown"; btc_last_label = "unknown"
        sol_ob_demand  = "unknown"; sol_ob_supply  = "unknown"; sol_last_label = "unknown"
        stock_symbols  = @()
    }
}

function Get-OpenPositionCount {
    if (-not (Test-Path $TRADE_STATE)) { return 0 }
    try {
        $s = Get-Content $TRADE_STATE -Raw | ConvertFrom-Json
        return (@($s.positions | Where-Object { $_.managed_mode -eq "tv_1min" })).Count
    } catch { return 0 }
}

function Is-MarketOpen {
    # NYSE/Nasdaq: Mon-Fri 9:30-16:00 ET (UTC-4 in summer, UTC-5 in winter)
    $utcNow = [System.DateTime]::UtcNow
    $et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($utcNow, "Eastern Standard Time")
    $dow = $et.DayOfWeek
    if ($dow -eq "Saturday" -or $dow -eq "Sunday") { return $false }
    $open  = [System.TimeSpan]::new(9, 30, 0)
    $close = [System.TimeSpan]::new(16, 0, 0)
    return ($et.TimeOfDay -ge $open -and $et.TimeOfDay -lt $close)
}

function Is-PreMarket {
    $utcNow = [System.DateTime]::UtcNow
    $et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($utcNow, "Eastern Standard Time")
    $dow = $et.DayOfWeek
    if ($dow -eq "Saturday" -or $dow -eq "Sunday") { return $false }
    $open  = [System.TimeSpan]::new(4, 0, 0)
    $close = [System.TimeSpan]::new(9, 30, 0)
    return ($et.TimeOfDay -ge $open -and $et.TimeOfDay -lt $close)
}

function Get-TopStocks {
    # Screen Nasdaq/NYSE for top volume movers to scan with LuxAlgo
    try {
        # Get most active stocks from Alpaca's most-active snapshot
        $snap = Invoke-RestMethod "$DATA_BASE/v2/stocks/snapshots?symbols=AAPL,MSFT,NVDA,TSLA,META,AMZN,GOOGL,AMD,NFLX,SMCI,PLTR,ARM,AVGO,TSM,ORCL,CRM,SNOW,UBER,LYFT,COIN,MARA,RIOT,HOOD,SOFI,RBLX,DKNG,PENN,MGM,WYNN,LVS&feed=iex" -Headers $hdr -ErrorAction Stop

        $candidates = @()
        foreach ($prop in $snap.PSObject.Properties) {
            $sym   = $prop.Name
            $data  = $prop.Value
            $price = [double]$data.latestTrade.p
            $prevC = [double]$data.prevDailyBar.c
            $vol   = [double]($data.dailyBar.v)
            if ($prevC -le 0 -or $price -le 0) { continue }
            $chgPct = (($price - $prevC) / $prevC) * 100
            $dolVol = $price * $vol
            $candidates += [PSCustomObject]@{
                sym    = $sym
                price  = [math]::Round($price, 2)
                chgPct = [math]::Round($chgPct, 2)
                dolVol = [math]::Round($dolVol / 1e6, 1)  # in $M
            }
        }

        # Sort by absolute % change * dollar volume (high momentum + liquidity)
        $top = $candidates | Sort-Object { [math]::Abs($_.chgPct) * $_.dolVol } -Descending | Select-Object -First 15
        Log "Top movers: $(($top | ForEach-Object { "$($_.sym)($($_.chgPct)%)" }) -join ', ')"
        return @($top | ForEach-Object { $_.sym })
    } catch {
        Log "Stock screener error: $($_.Exception.Message)"
        # Fallback to curated high-liquidity list
        return @("AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","PLTR","COIN","SMCI","ARM","AVGO","SOFI")
    }
}

function Save-State($dec, $existing) {
    $s = [PSCustomObject]@{
        btc_ob_demand  = if ($dec.btc_ob_demand)  { $dec.btc_ob_demand }  else { $existing.btc_ob_demand }
        btc_ob_supply  = if ($dec.btc_ob_supply)  { $dec.btc_ob_supply }  else { $existing.btc_ob_supply }
        btc_last_label = if ($dec.btc_last_label) { $dec.btc_last_label } else { $existing.btc_last_label }
        sol_ob_demand  = if ($dec.sol_ob_demand)  { $dec.sol_ob_demand }  else { $existing.sol_ob_demand }
        sol_ob_supply  = if ($dec.sol_ob_supply)  { $dec.sol_ob_supply }  else { $existing.sol_ob_supply }
        sol_last_label = if ($dec.sol_last_label) { $dec.sol_last_label } else { $existing.sol_last_label }
        stock_symbols  = if ($dec.stock_symbols)  { $dec.stock_symbols }  else { $existing.stock_symbols }
        last_scan      = (Get-Date -Format "o")
    }
    $s | ConvertTo-Json | Out-File $STATE_FILE -Encoding ascii
}

Log "=== TV_1MIN_SCANNER STARTED (PID=$PID) ==="
Log "Crypto: always on | Stocks: market hours only (9:30-16:00 ET)"

while ($true) {
    try {
        $openCount = Get-OpenPositionCount
        if ($openCount -ge $MAX_OPEN_POSITIONS) {
            Log "Max positions ($MAX_OPEN_POSITIONS) open — skipping scan"
            Start-Sleep $SCAN_INTERVAL
            continue
        }

        $st           = Get-ScanState
        $marketOpen   = Is-MarketOpen
        $preMarket    = Is-PreMarket
        $stockSymbols = @()

        # Refresh stock watchlist at market open or pre-market
        if ($marketOpen -or $preMarket) {
            $stockSymbols = Get-TopStocks
            # Build stock scan lines for prompt
            $stockScanLines = ($stockSymbols | ForEach-Object {
                "chart_set_symbol $_; data_get_ohlcv(3); data_get_pine_boxes(Smart Money); data_get_pine_labels(Smart Money,14)"
            }) -join "`n"
        }

        $stockSection = if ($stockSymbols.Count -gt 0) {
            @"

STOCK SYMBOLS TO SCAN (market is OPEN): $($stockSymbols -join ', ')
For each stock symbol above, run the same 4-step scan. Stock entries use AType=stock.
Stocks: no Alpaca feed offset needed (IEX feed is real-time).
Max stop for stocks: 1% from entry.
"@
        } else {
            "STOCKS: Market closed — skip stock scanning."
        }

        $prompt = @"
You are a 1-min SMC scanner. Use TradingView MCP tools to scan for entries.

STRATEGY: LuxAlgo "Smart Money Concepts [LuxAlgo]" indicator on 1-min chart.
Entry rule: price touches OB zone + most recent CHoCH/BOS label confirms direction.
- LONG: price inside demand OB + most recent label is bullish CHoCH or BOS
- SHORT: price inside supply OB + most recent label is bearish CHoCH
- Stop <= 1% from entry. RR >= 1.5.
- BTC/ETH: Alpaca price ~3 dollars below TradingView. Subtract 3 from TV levels for Alpaca.
- SOL: Alpaca ~0.05 below TradingView.
- Stocks: No offset needed.

LAST KNOWN STATE:
BTC: demand_ob=$($st.btc_ob_demand) | supply_ob=$($st.btc_ob_supply) | last_label=$($st.btc_last_label)
SOL: demand_ob=$($st.sol_ob_demand) | supply_ob=$($st.sol_ob_supply) | last_label=$($st.sol_last_label)
$stockSection

SCAN STEPS:
1. chart_set_symbol COINBASE:BTCUSD → data_get_ohlcv(3) + data_get_pine_boxes("Smart Money") + data_get_pine_labels("Smart Money",14)
2. chart_set_symbol COINBASE:SOLUSD → same three tools
3. $($if ($stockSymbols.Count -gt 0) { "For each stock symbol, chart_set_symbol [SYM] + same three tools." } else { "Skip stocks (market closed)." })
4. Evaluate all symbols. Find the BEST single entry (highest RR + cleanest structure).
5. Output EXACTLY ONE JSON line as the absolute last line of your response.

JSON for trade signal:
{"action":"LONG","sym":"NVDA","entry":890.50,"stop":888.50,"t1":894.50,"t2":896.50,"atype":"stock","btc_ob_demand":"...","btc_ob_supply":"...","btc_last_label":"...","sol_ob_demand":"...","sol_ob_supply":"...","sol_last_label":"...","stock_symbols":["NVDA","AAPL","TSLA"]}

JSON for no signal:
{"action":"WAIT","btc_ob_demand":"...","btc_ob_supply":"...","btc_last_label":"...","sol_ob_demand":"...","sol_ob_supply":"...","sol_last_label":"...","stock_symbols":["NVDA","AAPL","TSLA"]}

The JSON must be the last line. No text after it.
"@

        Log "Scanning (open_positions=$openCount, market_open=$marketOpen, stocks=$($stockSymbols.Count))..."
        $raw    = & claude -p $prompt 2>&1
        $output = ($raw | Out-String)
        $lines  = $output -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
        $json   = $lines | Where-Object { $_ -match '^\{"action"' } | Select-Object -Last 1

        if (-not $json) {
            Log "No JSON found. Tail: $(($lines | Select-Object -Last 3) -join ' || ')"
            Start-Sleep $SCAN_INTERVAL
            continue
        }

        $dec = $json | ConvertFrom-Json
        Save-State $dec $st

        if ($dec.action -in @("LONG", "SHORT")) {
            Log "*** SIGNAL: $($dec.action) $($dec.sym) entry=$($dec.entry) stop=$($dec.stop) t1=$($dec.t1) t2=$($dec.t2) atype=$($dec.atype) ***"
            & "$PSScriptRoot\tv_1min_trader.ps1" `
                -Sym   $dec.sym `
                -Dir   $dec.action `
                -Entry $dec.entry `
                -Stop  $dec.stop `
                -T1    $dec.t1 `
                -T2    $dec.t2 `
                -AType $dec.atype
            Log "Trade placed. Sleeping 30s."
            Start-Sleep 30
        } else {
            Log "WAIT | BTC:$($dec.btc_last_label) | SOL:$($dec.sol_last_label)"
        }

    } catch {
        Log "ERROR: $($_.Exception.Message)"
    }

    Start-Sleep $SCAN_INTERVAL
}
