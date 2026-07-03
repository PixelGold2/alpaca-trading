# stock_analyzer.ps1 - MTF confluence analyzer for stocks and ETF indices.
# Daily trend + 4H momentum + 1H pullback entry. Scores 0-10.
# Usage: .\stock_analyzer.ps1 -Symbol "NVDA"

param([Parameter(Mandatory)] [string] $Symbol)

. "$PSScriptRoot\..\config.ps1"

$dataHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

function Get-StockBars($sym, $tf, $limit) {
    $lookbackDays = switch ($tf) {
        "1Day"  { $limit + 10 }
        "4Hour" { [math]::Ceiling($limit / 6) + 10 }
        "1Hour" { [math]::Ceiling($limit / 7) + 5 }
        default { 30 }
    }
    $start   = (Get-Date).AddDays(-$lookbackDays).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $encSym  = [uri]::EscapeDataString($sym)
    $url     = "https://data.alpaca.markets/v2/stocks/bars?symbols=$encSym&timeframe=$tf&limit=$limit&start=$start&feed=iex"
    $resp    = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
    return $resp.bars.PSObject.Properties[$sym].Value
}

function Calc-EMA($arr, $period) {
    if ($arr.Count -lt $period) { return @() }
    $mult = 2.0 / ($period + 1)
    $sum  = 0.0; for ($i = 0; $i -lt $period; $i++) { $sum += $arr[$i] }
    $ema  = @($sum / $period)
    for ($i = $period; $i -lt $arr.Count; $i++) { $ema += $arr[$i] * $mult + $ema[-1] * (1 - $mult) }
    return $ema
}

function Calc-RSI($closes, $period = 14) {
    if ($closes.Count -lt $period + 2) { return 50.0 }
    $gains = @(); $losses = @()
    for ($i = 1; $i -lt $closes.Count; $i++) {
        $d = $closes[$i] - $closes[$i-1]
        if ($d -gt 0) { $gains += $d; $losses += 0.0 } else { $gains += 0.0; $losses += [math]::Abs($d) }
    }
    $ag = ($gains[0..($period-1)]  | Measure-Object -Sum).Sum / $period
    $al = ($losses[0..($period-1)] | Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $gains.Count; $i++) {
        $ag = ($ag * ($period-1) + $gains[$i])  / $period
        $al = ($al * ($period-1) + $losses[$i]) / $period
    }
    if ($al -eq 0) { return 100.0 }
    return 100.0 - (100.0 / (1.0 + $ag / $al))
}

function Calc-MACD($closes) {
    if ($closes.Count -lt 35) { return $null }
    $e12 = Calc-EMA $closes 12; $e26 = Calc-EMA $closes 26
    $macdLine = @(); for ($i = 0; $i -lt $e26.Count; $i++) { $macdLine += $e12[$i+14] - $e26[$i] }
    if ($macdLine.Count -lt 9) { return $null }
    $sig    = Calc-EMA $macdLine 9
    $sigOff = $macdLine.Count - $sig.Count
    $hCurr  = $macdLine[$sigOff + $sig.Count - 1] - $sig[-1]
    $hPrev  = $macdLine[$sigOff + $sig.Count - 2] - $sig[-2]
    return @{ macd=$macdLine[-1]; signal=$sig[-1]; histogram=$hCurr; hist_prev=$hPrev
              bullish_cross=($hCurr -gt 0 -and $hPrev -le 0) }
}

function Calc-ATR($bars, $period = 14) {
    if ($bars.Count -lt $period + 2) { return 0.0 }
    $trs = @()
    for ($i = 1; $i -lt $bars.Count; $i++) {
        $trs += [math]::Max([double]$bars[$i].h - [double]$bars[$i].l,
                [math]::Max([math]::Abs([double]$bars[$i].h - [double]$bars[$i-1].c),
                            [math]::Abs([double]$bars[$i].l - [double]$bars[$i-1].c)))
    }
    $atr = ($trs[0..($period-1)] | Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $trs.Count; $i++) { $atr = ($atr * ($period-1) + $trs[$i]) / $period }
    return $atr
}

function Get-SwingLow($bars, $lookback = 20) {
    $start  = [math]::Max(1, $bars.Count - $lookback - 1)
    $lowest = [double]$bars[$start].l
    for ($i = $start + 1; $i -le $bars.Count - 2; $i++) {
        if ([double]$bars[$i].l -lt [double]$bars[$i-1].l -and [double]$bars[$i].l -lt [double]$bars[$i+1].l) {
            if ([double]$bars[$i].l -lt $lowest) { $lowest = [double]$bars[$i].l }
        }
    }
    return $lowest
}

# SPY macro filter: if SPY is in a daily downtrend, penalise all trades
function Get-SpyFilter {
    try {
        $spyBars  = Get-StockBars "SPY" "1Day" 60
        $spyClose = $spyBars | ForEach-Object { [double]$_.c }
        $spyEma50 = (Calc-EMA $spyClose 50)[-1]
        $spyPrice = $spyClose[-1]
        return @{ bullish=($spyPrice -gt $spyEma50); spy_price=$spyPrice; spy_ema50=[math]::Round($spyEma50,2) }
    } catch { return @{ bullish=$true; spy_price=0; spy_ema50=0 } }
}

# ---- MAIN -------------------------------------------------------------------
try {
    $daily = Get-StockBars $Symbol "1Day"  60
    $h4    = Get-StockBars $Symbol "4Hour" 100
    $h1    = Get-StockBars $Symbol "1Hour" 120

    if ($daily.Count -lt 25 -or $h4.Count -lt 20 -or $h1.Count -lt 20) {
        @{ score=0; signal="INSUFFICIENT_DATA"; symbol=$Symbol } | ConvertTo-Json; exit
    }

    $curPrice = [double]$h1[-1].c

    # SPY macro filter (skip for SPY itself)
    $spy = if ($Symbol -ne "SPY") { Get-SpyFilter } else { @{ bullish=$true; spy_price=$curPrice; spy_ema50=0 } }

    # Daily
    $dClose = $daily | ForEach-Object { [double]$_.c }
    $dEma20 = (Calc-EMA $dClose 20)[-1]
    $dEma50 = if ($dClose.Count -ge 52) { (Calc-EMA $dClose 50)[-1] } else { $dEma20 }
    $dRsi   = Calc-RSI $dClose 14

    $dAbove50 = $curPrice -gt $dEma50
    $dAbove20 = $curPrice -gt $dEma20
    $dRsiOk   = $dRsi -ge 40 -and $dRsi -le 72

    # 4H
    $h4Close  = $h4 | ForEach-Object { [double]$_.c }
    $h4Ema20  = (Calc-EMA $h4Close 20)[-1]
    $h4Macd   = Calc-MACD $h4Close
    $h4Atr    = Calc-ATR $h4 14

    $h4Above    = $curPrice -gt $h4Ema20
    $h4MacdBull = $h4Macd -and ($h4Macd.histogram -gt 0 -or $h4Macd.bullish_cross)
    $h4Cross    = $h4Macd -and $h4Macd.bullish_cross

    # 4H higher-low structure
    $h4Lows = @()
    for ($i = $h4.Count - 20; $i -le $h4.Count - 2; $i++) {
        if ($i -ge 1 -and [double]$h4[$i].l -lt [double]$h4[$i-1].l -and [double]$h4[$i].l -lt [double]$h4[$i+1].l) {
            $h4Lows += [double]$h4[$i].l
        }
    }
    $h4HigherLow = $h4Lows.Count -ge 2 -and $h4Lows[-1] -gt $h4Lows[-2]

    # 1H
    $h1Close = $h1 | ForEach-Object { [double]$_.c }
    $h1Ema20 = (Calc-EMA $h1Close 20)[-1]
    $h1Rsi   = Calc-RSI $h1Close 14
    $h1Atr   = Calc-ATR $h1 14

    $h1NearEma  = [math]::Abs($curPrice - $h1Ema20) -le $h1Atr * 0.8
    $h1Pullback = $h1Rsi -ge 35 -and $h1Rsi -le 60
    $h1NotTop   = $h1Rsi -le 68

    $h1Vols   = $h1[-11..-2] | ForEach-Object { [double]$_.v }
    $h1AvgVol = ($h1Vols | Measure-Object -Sum).Sum / $h1Vols.Count
    $h1VolR   = if ($h1AvgVol -gt 0) { [double]$h1[-1].v / $h1AvgVol } else { 1.0 }

    # Scoring
    $score = 0.0; $reasons = @()

    if (-not $spy.bullish)  { $score -= 3.0; $reasons += "SPY below EMA50 (bearish macro)" }

    if ($dAbove50)          { $score += 2.0; $reasons += "Daily above EMA50" }
    elseif ($dAbove20)      { $score += 1.0; $reasons += "Daily above EMA20 only" }
    if ($dRsiOk)            { $score += 1.0; $reasons += "Daily RSI $([math]::Round($dRsi,1)) healthy" }

    if ($h4Above)           { $score += 1.5; $reasons += "4H above EMA20" }
    if ($h4MacdBull)        { $score += 1.5; $reasons += "4H MACD bullish" }
    if ($h4Cross)           { $score += 0.5; $reasons += "4H MACD crossover" }
    if ($h4HigherLow)       { $score += 0.5; $reasons += "4H higher-low" }

    if ($h1NearEma)         { $score += 1.5; $reasons += "1H at EMA20 ($([math]::Round($h1Ema20,2)))" }
    if ($h1Pullback)        { $score += 1.0; $reasons += "1H RSI $([math]::Round($h1Rsi,1)) pullback zone" }
    if ($h1VolR -ge 1.2)    { $score += 0.5; $reasons += "1H volume $([math]::Round($h1VolR,1))x" }

    # Stop: 1H swing low or 1.5x ATR
    $swingLow     = Get-SwingLow $h1 25
    $stopFromSwing = if ($swingLow -gt 0 -and $swingLow -lt $curPrice) { $swingLow * 0.997 } else { 0 }
    $stopFromAtr   = $curPrice - $h1Atr * 1.5
    $stopPrice     = if ($stopFromSwing -gt $stopFromAtr -and ($curPrice - $stopFromSwing) / $curPrice -le 0.04) {
        $stopFromSwing
    } else { $stopFromAtr }

    $stopDist  = $curPrice - $stopPrice
    $stopPct   = if ($curPrice -gt 0) { [math]::Round($stopDist / $curPrice * 100, 2) } else { 0 }
    $t1Price   = [math]::Round($curPrice + $stopDist * 1.0, 2)
    $t2Price   = [math]::Round($curPrice + $stopDist * 2.0, 2)
    $stopPrice = [math]::Round($stopPrice, 2)
    $stopLim   = [math]::Round($stopPrice * 0.9975, 2)

    $signal = if ($score -ge 8.0) { "STRONG_BUY" } elseif ($score -ge 7.0) { "BUY" } elseif ($score -ge 5.0) { "WATCH" } else { "SKIP" }

    @{
        symbol       = $Symbol
        score        = [math]::Round($score, 1)
        signal       = $signal
        price        = $curPrice
        spy_bullish  = $spy.bullish
        daily_rsi    = [math]::Round($dRsi, 1)
        daily_ema20  = [math]::Round($dEma20, 2)
        daily_ema50  = [math]::Round($dEma50, 2)
        h4_ema20     = [math]::Round($h4Ema20, 2)
        h4_macd_hist = if ($h4Macd) { [math]::Round($h4Macd.histogram, 4) } else { 0 }
        h4_macd_cross= if ($h4Macd) { $h4Macd.bullish_cross } else { $false }
        h1_ema20     = [math]::Round($h1Ema20, 2)
        h1_rsi       = [math]::Round($h1Rsi, 1)
        h1_atr       = [math]::Round($h1Atr, 2)
        h1_vol_ratio = [math]::Round($h1VolR, 2)
        stop_price   = $stopPrice
        stop_lim     = $stopLim
        stop_pct     = $stopPct
        t1_price     = $t1Price
        t2_price     = $t2Price
        rr_ratio     = 2.0
        reasons      = $reasons
    } | ConvertTo-Json -Depth 5

} catch {
    @{ score=0; signal="ERROR"; symbol=$Symbol; error=$_.Exception.Message } | ConvertTo-Json
}

