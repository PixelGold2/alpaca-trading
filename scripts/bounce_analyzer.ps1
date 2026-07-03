# bounce_analyzer.ps1 - Oversold bounce analyzer for crypto.
# Looks for daily-oversold pairs where short-term momentum is already turning up.
# Usage: .\bounce_analyzer.ps1 -Symbol "ETH/USD"

param([Parameter(Mandatory)] [string] $Symbol)

. "$PSScriptRoot\..\config.ps1"

$dataHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

function Get-Bars($sym, $tf, $limit) {
    $lookbackDays = switch ($tf) {
        "1Day"  { $limit + 5 }
        "4Hour" { [math]::Ceiling($limit / 6) + 5 }
        "1Hour" { [math]::Ceiling($limit / 24) + 3 }
        default { 30 }
    }
    $start  = (Get-Date).AddDays(-$lookbackDays).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $encSym = [uri]::EscapeDataString($sym)
    $url    = "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=$encSym&timeframe=$tf&limit=$limit&start=$start"
    $resp   = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
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
    $h2Prev = if ($sig.Count -ge 3) { $macdLine[$sigOff + $sig.Count - 3] - $sig[-3] } else { $hPrev }
    return @{
        macd         = $macdLine[-1]
        signal       = $sig[-1]
        histogram    = $hCurr
        hist_prev    = $hPrev
        hist_2prev   = $h2Prev
        bullish_cross = ($hCurr -gt 0 -and $hPrev -le 0)
        improving    = ($hCurr -gt $hPrev)   # histogram moving toward positive
        bottoming    = ($hCurr -gt $hPrev -and $hPrev -gt $h2Prev)  # two bars improving
    }
}

function Calc-ATR($bars, $period = 14) {
    if ($bars.Count -lt $period + 2) { return 0.01 }
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

function Get-RecentSwingLow($bars, $lookback = 20) {
    $start = [math]::Max(1, $bars.Count - $lookback - 1)
    $swingLow = [double]$bars[-1].l
    for ($i = $start; $i -le $bars.Count - 2; $i++) {
        if ([double]$bars[$i].l -lt [double]$bars[$i-1].l -and [double]$bars[$i].l -lt [double]$bars[$i+1].l) {
            if ([double]$bars[$i].l -lt $swingLow) { $swingLow = [double]$bars[$i].l }
        }
    }
    return $swingLow
}

# ---- MAIN -------------------------------------------------------------------
try {
    $daily = Get-Bars $Symbol "1Day"  60
    $h4    = Get-Bars $Symbol "4Hour" 80
    $h1    = Get-Bars $Symbol "1Hour" 96

    if ($daily.Count -lt 20 -or $h4.Count -lt 15 -or $h1.Count -lt 20) {
        @{ score=0; signal="INSUFFICIENT_DATA"; symbol=$Symbol } | ConvertTo-Json; exit
    }

    $curPrice = [double]$h1[-1].c

    $dClose  = $daily | ForEach-Object { [double]$_.c }
    $dRsi    = Calc-RSI $dClose 14
    $dEma20  = (Calc-EMA $dClose 20)[-1]

    $h4Close = $h4 | ForEach-Object { [double]$_.c }
    $h4Macd  = Calc-MACD $h4Close
    $h4Atr   = Calc-ATR $h4 14

    $h1Close = $h1 | ForEach-Object { [double]$_.c }
    $h1Rsi   = Calc-RSI $h1Close 14
    $h1Ema20 = (Calc-EMA $h1Close 20)[-1]
    $h1Atr   = Calc-ATR $h1 14
    $h1Vols  = $h1[-11..-2] | ForEach-Object { [double]$_.v }
    $h1AvgVol = ($h1Vols | Measure-Object -Sum).Sum / $h1Vols.Count
    $h1VolR  = if ($h1AvgVol -gt 0) { [double]$h1[-1].v / $h1AvgVol } else { 1.0 }

    # Hard requirements for a bounce setup
    $isDailyOversold  = $dRsi -le 40
    $is4HImproving    = $h4Macd -and ($h4Macd.improving -or $h4Macd.bullish_cross)
    $is1HBuilding     = $h1Rsi -ge 42

    # Hard disqualifiers
    if (-not $isDailyOversold)  { @{ score=0; signal="SKIP"; symbol=$Symbol; reason="Daily RSI $([math]::Round($dRsi,1)) not oversold" } | ConvertTo-Json; exit }
    if (-not $is4HImproving)    { @{ score=0; signal="SKIP"; symbol=$Symbol; reason="4H MACD not improving" } | ConvertTo-Json; exit }
    if (-not $is1HBuilding)     { @{ score=0; signal="SKIP"; symbol=$Symbol; reason="1H RSI $([math]::Round($h1Rsi,1)) not building momentum" } | ConvertTo-Json; exit }
    if ($h1Rsi -gt 72)          { @{ score=0; signal="SKIP"; symbol=$Symbol; reason="1H RSI $([math]::Round($h1Rsi,1)) already extended" } | ConvertTo-Json; exit }

    # Score (max 10)
    $score = 0.0; $reasons = @()

    # Daily oversold depth (max 3.5)
    if ($dRsi -le 30)       { $score += 3.5; $reasons += "Daily RSI $([math]::Round($dRsi,1)) deeply oversold" }
    elseif ($dRsi -le 35)   { $score += 2.5; $reasons += "Daily RSI $([math]::Round($dRsi,1)) oversold" }
    else                    { $score += 1.5; $reasons += "Daily RSI $([math]::Round($dRsi,1)) extended" }

    # 4H MACD momentum (max 3)
    if ($h4Macd.bullish_cross) { $score += 3.0; $reasons += "4H MACD bullish crossover" }
    elseif ($h4Macd.bottoming) { $score += 2.0; $reasons += "4H MACD bottoming (2-bar improvement)" }
    elseif ($h4Macd.improving) { $score += 1.0; $reasons += "4H MACD histogram improving" }

    # 1H momentum (max 3)
    if ($h1Rsi -ge 55)                                   { $score += 1.5; $reasons += "1H RSI $([math]::Round($h1Rsi,1)) above midline" }
    elseif ($h1Rsi -ge 48)                               { $score += 1.0; $reasons += "1H RSI $([math]::Round($h1Rsi,1)) approaching midline" }
    if ($curPrice -ge $h1Ema20)                          { $score += 1.0; $reasons += "1H price above EMA20" }
    if ($h1VolR -ge 1.3)                                 { $score += 0.5; $reasons += "1H volume $([math]::Round($h1VolR,1))x (buying interest)" }

    # Distance from EMA20 daily (how stretched the bounce could be)
    $distFromDEma = [math]::Round(($dEma20 - $curPrice) / $curPrice * 100, 1)
    if ($distFromDEma -ge 3 -and $distFromDEma -le 10) { $score += 0.5; $reasons += "Daily EMA20 is $distFromDEma pct above (bounce room)" }

    # Stop and targets using 1H structure
    $swingLow  = Get-RecentSwingLow $h1 15
    $stopPrice = [math]::Max($swingLow * 0.997, $curPrice - $h1Atr * 2.0)
    $stopPct   = [math]::Round(($curPrice - $stopPrice) / $curPrice * 100, 2)

    # Hard disqualifier: stop too wide for a bounce trade
    if ($stopPct -gt 4.0) {
        @{ score=0; signal="SKIP"; symbol=$Symbol; reason="Stop $stopPct pct too wide for bounce" } | ConvertTo-Json; exit
    }

    $dp = if ($curPrice -ge 1000) { 2 } elseif ($curPrice -ge 1) { 4 } else { 6 }
    $stopDist  = $curPrice - $stopPrice
    $t1Price   = [math]::Round($curPrice + $stopDist * 1.5, $dp)
    $t2Price   = [math]::Round($curPrice + $stopDist * 2.5, $dp)
    $stopPrice = [math]::Round($stopPrice, $dp)
    $stopLim   = [math]::Round($stopPrice * 0.9975, $dp)

    $signal = if ($score -ge 7.0) { "STRONG_BOUNCE" } elseif ($score -ge 5.0) { "BOUNCE" } else { "WATCH" }

    @{
        symbol        = $Symbol
        score         = [math]::Round($score, 1)
        signal        = $signal
        price         = $curPrice
        daily_rsi     = [math]::Round($dRsi, 1)
        daily_ema20   = [math]::Round($dEma20, $dp)
        dist_dema_pct = $distFromDEma
        h4_macd_hist  = if ($h4Macd) { [math]::Round($h4Macd.histogram, 6) } else { 0 }
        h4_improving  = if ($h4Macd) { $h4Macd.improving } else { $false }
        h4_cross      = if ($h4Macd) { $h4Macd.bullish_cross } else { $false }
        h1_rsi        = [math]::Round($h1Rsi, 1)
        h1_ema20      = [math]::Round($h1Ema20, $dp)
        h1_atr        = [math]::Round($h1Atr, $dp)
        h1_vol_ratio  = [math]::Round($h1VolR, 2)
        stop_price    = $stopPrice
        stop_lim      = $stopLim
        stop_pct      = $stopPct
        t1_price      = $t1Price
        t2_price      = $t2Price
        reasons       = $reasons
    } | ConvertTo-Json -Depth 5

} catch {
    @{ score=0; signal="ERROR"; symbol=$Symbol; error=$_.Exception.Message } | ConvertTo-Json
}

