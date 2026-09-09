# market_scanner.ps1 — Broad US market bullish scanner
# Uses Alpaca snapshots to pre-filter, then runs MTF stock_analyzer on top candidates.
# Usage: .\market_scanner.ps1 [-TopN 40] [-MinScore 6.0]

param(
    [int]    $TopN     = 40,
    [double] $MinScore = 6.0,
    [int]    $MaxJobs  = 8
)

. "$PSScriptRoot\..\config.ps1"

$ANALYZER = "$PSScriptRoot\stock_analyzer.ps1"

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

# ~150 liquid US stocks across all major sectors
$UNIVERSE = @(
    # Mega-cap tech
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","AVGO","QCOM",
    "INTC","CRM","ORCL","ADBE","NOW","SNOW","PLTR","DDOG","NET","CRWD",
    "PANW","ZS","FTNT","OKTA","MDB","MSTR","ARM","SMCI","DELL","HPE",
    # Semiconductors
    "AMAT","LRCX","KLAC","ASML","MU","MRVL","TXN","NXPI","ON","STM",
    # Financials
    "JPM","GS","MS","BAC","WFC","C","BLK","SCHW","AXP","V","MA","PYPL","SOFI","NU","AFRM",
    # Health / Biotech
    "LLY","UNH","JNJ","ABBV","MRK","AMGN","GILD","REGN","VRTX","MRNA","BIIB","DXCM",
    # Consumer / Retail
    "WMT","COST","TGT","HD","LOW","NKE","MCD","SBUX","CMG","BKNG","ABNB","UBER","LYFT",
    # Energy
    "XOM","CVX","COP","SLB","OXY","MPC","PSX","VLO","HAL",
    # Industrial / Defense
    "BA","RTX","LMT","NOC","GE","CAT","DE","UPS","FDX","MMM",
    # Communication / Media
    "NFLX","DIS","WBD","PARA","T","VZ","TMUS","SPOT","RBLX","U",
    # ETFs (sector proxies)
    "SPY","QQQ","IWM","XLK","XLF","XLE","XLV","XLI","XLY","ARKK",
    # High-momentum / meme
    "COIN","MARA","RIOT","HOOD","GME","AMC","BBAI","IONQ","RGTI","QBTS"
)

Write-Host "`n=== US Market Bullish Scanner ===" -ForegroundColor Cyan
Write-Host "Universe: $($UNIVERSE.Count) symbols | Pre-filtering to top $TopN movers..." -ForegroundColor Gray

# Step 1: Batch snapshot to pre-filter by dollar-volume * |change%|
$chunks = @()
for ($i = 0; $i -lt $UNIVERSE.Count; $i += 50) {
    $chunks += ,@($UNIVERSE[$i..([math]::Min($i+49, $UNIVERSE.Count-1))])
}

$snapCandidates = @()
foreach ($chunk in $chunks) {
    try {
        $syms = $chunk -join ","
        $snap = Invoke-RestMethod "https://data.alpaca.markets/v2/stocks/snapshots?symbols=$syms&feed=iex" -Headers $hdr -ErrorAction Stop
        foreach ($prop in $snap.PSObject.Properties) {
            $d     = $prop.Value
            $price = [double]$d.latestTrade.p
            $prev  = [double]$d.prevDailyBar.c
            $vol   = [double]$d.dailyBar.v
            if ($price -le 1 -or $prev -le 0 -or $vol -eq 0) { continue }
            $chgPct  = (($price - $prev) / $prev) * 100
            $dolVol  = $price * $vol / 1e6
            $snapCandidates += [PSCustomObject]@{
                sym    = $prop.Name
                price  = [math]::Round($price, 2)
                chgPct = [math]::Round($chgPct, 2)
                dolVol = [math]::Round($dolVol, 1)
                score0 = [math]::Round([math]::Abs($chgPct) * [math]::Log($dolVol + 1), 3)
            }
        }
        Start-Sleep -Milliseconds 200
    } catch {
        Write-Host "Snapshot chunk error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if ($snapCandidates.Count -eq 0) {
    Write-Host "ERROR: No snapshot data returned. Check API credentials / market hours." -ForegroundColor Red
    exit 1
}

# Take top N movers by composite score (momentum × log-dollar-volume)
$topSyms = @($snapCandidates | Sort-Object score0 -Descending | Select-Object -First $TopN)

Write-Host "`nTop $TopN pre-filtered candidates:" -ForegroundColor Yellow
$topSyms | Format-Table sym, price, chgPct, dolVol -AutoSize

Write-Host "`nRunning MTF analysis on $($topSyms.Count) stocks (up to $MaxJobs parallel jobs)..." -ForegroundColor Cyan

# Step 2: Run stock_analyzer.ps1 in parallel batches
$jobs    = @()
$results = @()
$queue   = [System.Collections.Queue]::new()
$topSyms | ForEach-Object { $queue.Enqueue($_.sym) }

while ($queue.Count -gt 0 -or $jobs.Count -gt 0) {
    # Fill up to MaxJobs
    while ($jobs.Count -lt $MaxJobs -and $queue.Count -gt 0) {
        $sym  = $queue.Dequeue()
        $jobs += Start-Job -ScriptBlock {
            param($s, $a)
            $raw = & powershell.exe -NoProfile -NonInteractive -File $a -Symbol $s 2>&1
            $json = ($raw | Out-String).Trim()
            # Find last valid JSON object
            $match = [regex]::Match($json, '\{[\s\S]+\}')
            if ($match.Success) { $match.Value } else { "{`"symbol`":`"$s`",`"score`":0,`"signal`":`"ERROR`"}" }
        } -ArgumentList $sym, $ANALYZER
    }

    # Collect finished jobs
    $done = @($jobs | Where-Object { $_.State -in @("Completed","Failed") })
    foreach ($j in $done) {
        try {
            $out = Receive-Job $j -ErrorAction SilentlyContinue
            if ($out) {
                $o = $out | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($o -and $o.score -ge $MinScore) {
                    $results += $o
                    $col = if ($o.signal -eq "STRONG_BUY") { "Green" } elseif ($o.signal -eq "BUY") { "Cyan" } else { "Yellow" }
                    Write-Host "  [$($o.signal)] $($o.symbol)  score=$($o.score)  price=$($o.price)  RSI(D)=$($o.daily_rsi)  RSI(1H)=$($o.h1_rsi)" -ForegroundColor $col
                } elseif ($o) {
                    Write-Host "  [SKIP] $($o.symbol)  score=$($o.score)  sig=$($o.signal)" -ForegroundColor DarkGray
                }
            }
        } catch {}
        Remove-Job $j -Force
        $jobs = @($jobs | Where-Object { $_.Id -ne $j.Id })
    }

    if ($queue.Count -gt 0 -or $jobs.Count -gt 0) { Start-Sleep -Milliseconds 500 }
}

# Final report
$buys = @($results | Where-Object { $_.signal -in @("BUY","STRONG_BUY") } | Sort-Object score -Descending)

Write-Host "`n" + ("=" * 70) -ForegroundColor Cyan
Write-Host "  BULLISH SIGNALS (score >= $MinScore)" -ForegroundColor Cyan
Write-Host ("=" * 70) -ForegroundColor Cyan

if ($buys.Count -eq 0) {
    Write-Host "  No BUY/STRONG_BUY signals found today." -ForegroundColor Yellow
} else {
    $buys | Format-Table @(
        @{L="Signal";   E={$_.signal};       W=12}
        @{L="Symbol";   E={$_.symbol};       W=7}
        @{L="Score";    E={$_.score};        W=6}
        @{L="Price";    E={$_.price};        W=9}
        @{L="D-RSI";    E={$_.daily_rsi};    W=7}
        @{L="1H-RSI";   E={$_.h1_rsi};      W=8}
        @{L="Stop";     E={$_.stop_price};   W=9}
        @{L="T1";       E={$_.t1_price};     W=9}
        @{L="T2";       E={$_.t2_price};     W=9}
        @{L="StopPct";  E={$_.stop_pct};     W=8}
        @{L="Reasons";  E={($_.reasons -join " | ")};  W=60}
    ) -AutoSize -Wrap

    Write-Host "`nTop pick: $($buys[0].symbol) -- Score $($buys[0].score)/10" -ForegroundColor Green
    $bp = $buys[0]
    $entryLine = ("Entry: ~" + $bp.price + " | Stop: " + $bp.stop_price + " (-" + $bp.stop_pct + " pct) | T1: " + $bp.t1_price + " | T2: " + $bp.t2_price)
    Write-Host $entryLine -ForegroundColor Green
}

Write-Host ("Scan complete: " + $results.Count + " stocks scored, " + $buys.Count + " bullish signals.") -ForegroundColor Gray
