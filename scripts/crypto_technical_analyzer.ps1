# crypto_technical_analyzer.ps1 - SMC + indicator analysis for crypto pairs.
# Usage: .\crypto_technical_analyzer.ps1 -Symbol "BTC/USD"
# Same logic as technical_analyzer.ps1 but uses Alpaca v1beta3 crypto endpoint.

param([Parameter(Mandatory)] [string] $Symbol)

. "$PSScriptRoot\..\config.ps1"

$dataHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

function Get-CryptoBars($sym, $days = 120) {
    $start = (Get-Date).AddDays(-$days).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $encSym = [uri]::EscapeDataString($sym)
    $url = "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=$encSym&timeframe=1Day&start=$start&limit=120"
    $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
    # Bars keyed by symbol name e.g. "BTC/USD"
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
    if ($closes.Count -lt $period + 2) { return $null }
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
    $sig = Calc-EMA $macdLine 9
    $sigOff = $macdLine.Count - $sig.Count
    $hCurr = $macdLine[$sigOff + $sig.Count - 1] - $sig[-1]
    $hPrev = $macdLine[$sigOff + $sig.Count - 2] - $sig[-2]
    return @{ macd=$macdLine[-1]; signal=$sig[-1]; histogram=$hCurr; hist_prev=$hPrev; bullish_cross=($hCurr -gt 0 -and $hPrev -le 0) }
}

function Calc-ATR($bars, $period = 14) {
    if ($bars.Count -lt $period + 2) { return $null }
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

function Get-SwingPoints($bars, $lookback = 40) {
    $start = [math]::Max(1, $bars.Count - $lookback - 1)
    $highs = @(); $lows = @()
    for ($i = $start + 1; $i -le $bars.Count - 2; $i++) {
        if ([double]$bars[$i].h -gt [double]$bars[$i-1].h -and [double]$bars[$i].h -gt [double]$bars[$i+1].h) { $highs += @{idx=$i; price=[double]$bars[$i].h} }
        if ([double]$bars[$i].l -lt [double]$bars[$i-1].l -and [double]$bars[$i].l -lt [double]$bars[$i+1].l) { $lows  += @{idx=$i; price=[double]$bars[$i].l} }
    }
    return @{ highs=$highs; lows=$lows }
}

function Get-BullishOB($bars, $swings) {
    if ($swings.highs.Count -eq 0) { return $null }
    $sh = $swings.highs[-1]
    for ($i = $sh.idx - 1; $i -ge [math]::Max(0, $sh.idx - 15); $i--) {
        if ([double]$bars[$i].c -lt [double]$bars[$i].o) { return @{ low=[double]$bars[$i].l; high=[double]$bars[$i].h } }
    }
    return $null
}

function Get-BullishFVGs($bars, $lookback = 25) {
    $fvgs = @(); $start = [math]::Max(2, $bars.Count - $lookback)
    for ($i = $start; $i -lt $bars.Count; $i++) {
        if ([double]$bars[$i-2].h -lt [double]$bars[$i].l) { $fvgs += @{ low=[double]$bars[$i-2].h; high=[double]$bars[$i].l } }
    }
    return $fvgs
}

# ---- MAIN -------------------------------------------------------------------
try {
    $bars = Get-CryptoBars $Symbol
    if (-not $bars -or $bars.Count -lt 30) {
        @{ score=0; signal="INSUFFICIENT_DATA"; symbol=$Symbol; error="Only $($bars.Count) bars" } | ConvertTo-Json; exit
    }

    $closes   = $bars | ForEach-Object { [double]$_.c }
    $curPrice = $closes[-1]

    $ema9  = (Calc-EMA $closes 9)[-1]
    $ema21 = (Calc-EMA $closes 21)[-1]
    $ema50 = if ($closes.Count -ge 52) { (Calc-EMA $closes 50)[-1] } else { $null }
    $rsi   = Calc-RSI  $closes 14
    $macd  = Calc-MACD $closes
    $atr   = Calc-ATR  $bars   14

    $swings = Get-SwingPoints  $bars 40
    $ob     = Get-BullishOB    $bars $swings
    $fvgs   = Get-BullishFVGs  $bars 25

    $bos    = $swings.highs.Count -ge 2 -and ($curPrice -gt $swings.highs[-2].price)
    $inOB   = $ob   -and ($curPrice -ge $ob.low)   -and ($curPrice -le $ob.high * 1.005)
    $nearOB = $ob   -and ($curPrice -le $ob.high + $atr * 0.4) -and ($curPrice -ge $ob.low - $atr * 0.2)
    $inFVG  = ($fvgs | Where-Object { $curPrice -ge $_.low -and $curPrice -le $_.high }).Count -gt 0

    $vols   = $bars[-11..-2] | ForEach-Object { [double]$_.v }
    $avgVol = ($vols | Measure-Object -Sum).Sum / $vols.Count
    $volR   = if ($avgVol -gt 0) { [double]$bars[-1].v / $avgVol } else { 1.0 }

    # Score
    $score = 0.0; $reasons = @()
    if ($curPrice -gt $ema21)                              { $score += 1.0; $reasons += "Price > EMA21" }
    if ($ema50 -and $curPrice -gt $ema50)                  { $score += 1.0; $reasons += "Price > EMA50" }
    if ($ema9 -gt $ema21)                                  { $score += 0.5; $reasons += "EMA9 > EMA21" }
    if     ($rsi -ge 45 -and $rsi -le 65)                 { $score += 2.0; $reasons += "RSI $([math]::Round($rsi,1)) (ideal)" }
    elseif ($rsi -ge 35 -and $rsi -lt 45)                 { $score += 1.0; $reasons += "RSI $([math]::Round($rsi,1)) (bounce)" }
    elseif ($rsi -gt 65 -and $rsi -le 72)                 { $score += 0.5; $reasons += "RSI $([math]::Round($rsi,1)) (extended)" }
    if ($macd) {
        if   ($macd.bullish_cross)                         { $score += 1.5; $reasons += "MACD bullish crossover" }
        elseif ($macd.macd -gt 0 -and $macd.histogram -gt 0) { $score += 1.0; $reasons += "MACD bullish" }
        elseif ($macd.macd -gt $macd.signal)              { $score += 0.5; $reasons += "MACD > signal" }
    }
    if     ($inOB)   { $score += 2.0; $reasons += "In bullish order block" }
    elseif ($nearOB) { $score += 1.0; $reasons += "Near order block" }
    if ($inFVG)      { $score += 1.5; $reasons += "In fair value gap" }
    if ($bos)        { $score += 1.0; $reasons += "Break of structure" }
    if ($volR -gt 1.3) { $score += 0.5; $reasons += "Volume $([math]::Round($volR,1))x avg" }

    # Stop / target — use wider ATR multiples for crypto volatility
    $stopBase = $curPrice - $atr * 2.0
    if ($ob -and ($ob.low - $atr * 0.1) -gt $stopBase) { $stopBase = $ob.low - $atr * 0.1 }
    if ($swings.lows.Count -gt 0) {
        $sl = $swings.lows[-1].price * 0.995
        if ($sl -gt $stopBase -and $sl -lt $curPrice) { $stopBase = $sl }
    }
    $stopPrice   = [math]::Round([math]::Min($stopBase, $curPrice - $atr * 1.5), 4)
    $stopDist    = $curPrice - $stopPrice
    $targetPrice = [math]::Round($curPrice + $stopDist * 3.0, 4)
    $rrRatio     = if ($stopDist -gt 0) { [math]::Round(($targetPrice - $curPrice) / $stopDist, 2) } else { 0 }

    $signal = if ($score -ge 6.5) { "STRONG_BUY" } elseif ($score -ge 4.5) { "BUY" } elseif ($score -ge 2.5) { "NEUTRAL" } else { "SKIP" }

    @{
        symbol       = $Symbol
        score        = [math]::Round($score, 1)
        signal       = $signal
        price        = $curPrice
        ema9         = [math]::Round($ema9,  4)
        ema21        = [math]::Round($ema21, 4)
        ema50        = if ($ema50) { [math]::Round($ema50, 4) } else { $null }
        rsi          = if ($rsi)  { [math]::Round($rsi, 1) }   else { $null }
        macd_hist    = if ($macd) { [math]::Round($macd.histogram, 6) } else { $null }
        atr          = [math]::Round($atr, 4)
        stop_price   = $stopPrice
        target_price = $targetPrice
        rr_ratio     = $rrRatio
        bos_bullish  = $bos
        in_ob        = $inOB
        in_fvg       = $inFVG
        vol_ratio    = [math]::Round($volR, 2)
        reasons      = $reasons
    } | ConvertTo-Json -Depth 5

} catch {
    @{ score=0; signal="ERROR"; symbol=$Symbol; error=$_.Exception.Message } | ConvertTo-Json
}
