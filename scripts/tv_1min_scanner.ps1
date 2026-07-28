# tv_1min_scanner.ps1 — Background 1-min SMC scanner
# Calls claude -p every 90s, reads TradingView LuxAlgo, fires trades.
# Launch via: launch_scanner_bg.ps1 (hidden window)

# Resolve base dir — works even in hidden processes where PSScriptRoot may be empty
$BASE_DIR = if ($PSScriptRoot -and (Test-Path $PSScriptRoot)) {
    Split-Path $PSScriptRoot -Parent
} else {
    "C:\Users\PC\AlpacaTrading"
}

. "$BASE_DIR\config.ps1"

$STATE_FILE   = "$BASE_DIR\logs\tv_scanner_state.json"
$SCAN_LOG     = "$BASE_DIR\logs\tv_scanner.log"
$TRADE_STATE  = "$BASE_DIR\logs\tv_1min_state.json"
$PID_FILE     = "$BASE_DIR\logs\tv_scanner.pid"
$TRADER       = "$BASE_DIR\scripts\tv_1min_trader.ps1"
$SCAN_INTERVAL = 45
$MAX_POSITIONS = 5

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}
$DATA_BASE = "https://data.alpaca.markets"

# Write PID for launch_scanner_bg.ps1 to track
"$PID" | Out-File $PID_FILE -Encoding ascii

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $msg" | Add-Content $SCAN_LOG
}

function Get-ScanState {
    if (Test-Path $STATE_FILE) {
        try { return Get-Content $STATE_FILE -Raw | ConvertFrom-Json } catch {}
    }
    return [PSCustomObject]@{
        btc_ob_demand="unknown"; btc_ob_supply="unknown"; btc_last_label="unknown"
        sol_ob_demand="unknown"; sol_ob_supply="unknown"; sol_last_label="unknown"
        stock_symbols=@()
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
    $et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [System.DateTime]::UtcNow, "Eastern Standard Time")
    if ($et.DayOfWeek -in @("Saturday","Sunday")) { return $false }
    return ($et.TimeOfDay -ge [TimeSpan]"09:30" -and $et.TimeOfDay -lt [TimeSpan]"16:00")
}

function Is-PreMarket {
    $et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [System.DateTime]::UtcNow, "Eastern Standard Time")
    if ($et.DayOfWeek -in @("Saturday","Sunday")) { return $false }
    return ($et.TimeOfDay -ge [TimeSpan]"04:00" -and $et.TimeOfDay -lt [TimeSpan]"09:30")
}

function Get-TopStocks {
    $defaultList = @("AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","PLTR","COIN","SMCI","ARM","AVGO","SOFI")
    try {
        $syms = $defaultList -join ","
        $snap = Invoke-RestMethod "$DATA_BASE/v2/stocks/snapshots?symbols=$syms&feed=iex" -Headers $hdr -ErrorAction Stop
        $candidates = foreach ($prop in $snap.PSObject.Properties) {
            $d = $prop.Value
            $price = [double]$d.latestTrade.p
            $prev  = [double]$d.prevDailyBar.c
            if ($price -le 0 -or $prev -le 0) { continue }
            [PSCustomObject]@{
                sym    = $prop.Name
                chgPct = [math]::Round((($price - $prev) / $prev) * 100, 2)
                dolVol = [math]::Round($price * [double]$d.dailyBar.v / 1e6, 1)
            }
        }
        $top = @($candidates | Sort-Object { [math]::Abs($_.chgPct) * $_.dolVol } -Descending | Select-Object -First 15)
        Log "Top movers: $(($top | ForEach-Object { "$($_.sym)($($_.chgPct)%)" }) -join ', ')"
        return @($top | ForEach-Object { $_.sym })
    } catch {
        Log "Screener error: $($_.Exception.Message) - using default list"
        return $defaultList
    }
}

function Save-State($dec, $existing) {
    [PSCustomObject]@{
        btc_ob_demand  = if ($dec.btc_ob_demand)  { $dec.btc_ob_demand }  else { $existing.btc_ob_demand }
        btc_ob_supply  = if ($dec.btc_ob_supply)  { $dec.btc_ob_supply }  else { $existing.btc_ob_supply }
        btc_last_label = if ($dec.btc_last_label) { $dec.btc_last_label } else { $existing.btc_last_label }
        sol_ob_demand  = if ($dec.sol_ob_demand)  { $dec.sol_ob_demand }  else { $existing.sol_ob_demand }
        sol_ob_supply  = if ($dec.sol_ob_supply)  { $dec.sol_ob_supply }  else { $existing.sol_ob_supply }
        sol_last_label = if ($dec.sol_last_label) { $dec.sol_last_label } else { $existing.sol_last_label }
        stock_symbols  = if ($dec.stock_symbols)  { $dec.stock_symbols }  else { $existing.stock_symbols }
        last_scan      = (Get-Date -Format "o")
    } | ConvertTo-Json | Out-File $STATE_FILE -Encoding ascii
}

function Build-Prompt($st, $stockSymbols, $marketOpen) {
    $btcState = "demand=$($st.btc_ob_demand)|supply=$($st.btc_ob_supply)|last=$($st.btc_last_label)"
    $solState = "demand=$($st.sol_ob_demand)|supply=$($st.sol_ob_supply)|last=$($st.sol_last_label)"

    $stockBlock = if ($marketOpen -and $stockSymbols.Count -gt 0) {
        "STOCKS open - also scan: " + ($stockSymbols -join ",") + " (atype=stock, no price offset)"
    } else {
        "STOCKS: closed - skip."
    }

    $jsonTrade = '{"action":"LONG","sym":"BTC/USD","entry":109500,"stop":109400,"t1":109700,"t2":109800,"atype":"crypto","btc_ob_demand":"109400-109420","btc_ob_supply":"none","btc_last_label":"BOS","sol_ob_demand":"none","sol_ob_supply":"none","sol_last_label":"none","stock_symbols":[]}'
    $jsonWait  = '{"action":"WAIT","btc_ob_demand":"none","btc_ob_supply":"none","btc_last_label":"none","sol_ob_demand":"none","sol_ob_supply":"none","sol_last_label":"none","stock_symbols":[]}'

    return (
        "1-min SMC scalper. TradingView MCP. DO tool calls first, JSON last line, nothing after.`n" +
        "`n" +
        "RULES: LuxAlgo SMC 1-min. LONG=price in demand OB+latest label bullish CHoCH/BOS. SHORT=price in supply OB+latest label bearish CHoCH. Stop<=1% RR>=1.5. BTC/ETH entry-=3(Alpaca lag). SOL entry-=0.05.`n" +
        "PRIOR STATE: BTC[$btcState] SOL[$solState]`n" +
        "$stockBlock`n" +
        "`n" +
        "DO NOW (no commentary, just tool calls then JSON):`n" +
        "1. chart_set_symbol COINBASE:BTCUSD -> data_get_ohlcv(count=2) -> data_get_pine_boxes(study_filter=Smart Money Concepts) -> data_get_pine_labels(study_filter=Smart Money Concepts,max_labels=5)`n" +
        "2. chart_set_symbol COINBASE:SOLUSD -> same 3 tools`n" +
        "3. If stocks open: chart_set_symbol for each, same tools`n" +
        "4. Pick best setup or WAIT`n" +
        "LAST LINE MUST BE JSON:`n" +
        $jsonTrade + "`n" +
        "OR: " + $jsonWait
    )
}

Log "=== TV_1MIN_SCANNER STARTED (PID=$PID) ==="
Log "Base: $BASE_DIR | Crypto 24/7 | Stocks: market hours (ET)"

function Is-TradingViewRunning {
    $tv = Get-Process -Name "TradingView","tv" -ErrorAction SilentlyContinue
    return ($tv -ne $null -and $tv.Count -gt 0)
}

while ($true) {
    try {
        # Skip Claude API call if TradingView Desktop isn't running
        if (-not (Is-TradingViewRunning)) {
            Log "TradingView not running - skipping scan (sleeping 60s)"
            Start-Sleep 60
            continue
        }

        $openCount = Get-OpenPositionCount
        if ($openCount -ge $MAX_POSITIONS) {
            Log "Max positions ($MAX_POSITIONS) open - skip scan"
            Start-Sleep $SCAN_INTERVAL
            continue
        }

        $st          = Get-ScanState
        $marketOpen  = Is-MarketOpen
        $preMarket   = Is-PreMarket
        $stockSyms   = if ($marketOpen -or $preMarket) { Get-TopStocks } else { @() }
        $prompt      = Build-Prompt $st $stockSyms $marketOpen

        Log "Scanning... (positions=$openCount market=$marketOpen stocks=$($stockSyms.Count))"
        $raw   = & claude -p $prompt --dangerously-skip-permissions 2>&1
        $lines = ($raw | Out-String) -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
        $json  = $lines | Where-Object { $_ -match '^\{.{0,5}"action"' } | Select-Object -Last 1

        if (-not $json) {
            Log "No JSON. Tail: $(($lines | Select-Object -Last 3) -join ' | ')"
            Start-Sleep $SCAN_INTERVAL
            continue
        }

        $dec = $json | ConvertFrom-Json
        Save-State $dec $st

        if ($dec.action -in @("LONG","SHORT")) {
            Log "*** $($dec.action) $($dec.sym) entry=$($dec.entry) stop=$($dec.stop) t1=$($dec.t1) t2=$($dec.t2) ***"
            & $TRADER -Sym $dec.sym -Dir $dec.action -Entry $dec.entry -Stop $dec.stop -T1 $dec.t1 -T2 $dec.t2 -AType $dec.atype
            Log "Trade placed - sleeping 10s"
            Start-Sleep 10
        } else {
            Log "WAIT | BTC:$($dec.btc_last_label) | SOL:$($dec.sol_last_label)"
        }

    } catch {
        Log "ERROR: $($_.Exception.Message)"
    }

    Start-Sleep $SCAN_INTERVAL
}
