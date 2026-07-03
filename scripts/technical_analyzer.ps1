# technical_analyzer.ps1 - Returns SMC + indicator signal for a given symbol.
# Usage: .\technical_analyzer.ps1 -Symbol AAPL
# Returns JSON: { score, signal, price, stop_price, target_price, rr_ratio, atr, ema9/21/50, rsi, macd_hist, reasons[] }

param([Parameter(Mandatory)] [string] $Symbol)

. "$PSScriptRoot\..\config.ps1"

$dataHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

function Get-DailyBars($sym) {
    $start = (Get-Date).AddDays(-120).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $url   = "https://data.alpaca.markets/v2/stocks/$sym/bars?timeframe=1Day&start=$start&limit=120&feed=iex&adjustment=raw"
    $resp  = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
    return $resp.bars
}

function Calc-EMA($arr, $period) {
    if ($arr.Count -lt $period) { return @() }
    $mult = 2.0 / ($period + 1)
    $sum  = 0.0
    for ($i = 0; $i -lt $period; $i++) { $sum += $arr[$i] }
    $ema  = @($sum / $period)
    for ($i = $period; $i -lt $arr.Count; $i++) {
        $ema += $arr[$i] * $mult + $ema[-1] * (1 - $mult)
    }
    return $ema
}

function Calc-RSI($closes, $period = 14) {
    if ($closes.Count -lt $period + 2) { return $null }
    $gains  = @(); $losses = @()
    for ($i = 1; $i -lt $closes.Count; $i++) {
        $d = $closes[$i] - $closes[$i - 1]
        if ($d -gt 0) { $gains += $d; $losses += 0.0 }
        else          { $gains += 0.0; $losses += [math]::Abs($d) }
    }
    $ag = ($gains[0..($period-1)]  | Measure-Object -Sum).Sum / $period
    $al = ($losses[0..($period-1)] | Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $gains.Count; $i++) {
        $ag = ($ag * ($period - 1) + $gains[$i])  / $period
        $al = ($al * ($period - 1) + $losses[$i]) / $period
    }
    if ($al -eq 0) { return 100.0 }
    return 100.0 - (100.0 / (1.0 + $ag / $al))
}

function Calc-MACD($closes) {
    if ($closes.Count -lt 35) { return $null }
    $e12 = Calc-EMA $closes 12
    $e26 = Calc-EMA $closes 26
    # EMA12 starts at index 11, EMA26 starts at index 25 (both relative to original closes)
    $diff = $e26.Count - $e12.Count   # e26 is shorter by 14
    $macdLine = @()
    for ($i = 0; $i -lt $e26.Count; $i++) {
        $macdLine += $e12[$i + 14] - $e26[$i]
    }
    $sig  = Calc-EMA $macdLine 9
    $sigOff = $macdLine.Count - $sig.Count
    $hist_prev = $macdLine[$sigOff + $sig.Count - 2] - $sig[-2]
    $hist_curr = $macdLine[$sigOff + $sig.Count - 1] - $sig[-1]
    return @{
        macd          = $macdLine[-1]
        signal        = $sig[-1]
        histogram     = $hist_curr
        hist_prev     = $hist_prev
        bullish_cross = ($hist_curr -gt 0 -and $hist_prev -le 0)
        bearish_cross = ($hist_curr -lt 0 -and $hist_prev -ge 0)
    }
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
    for ($i = $period; $i -lt $trs.Count; $i++) {
        $atr = ($atr * ($period - 1) + $trs[$i]) / $period
    }
    return $atr
}

function Get-SwingPoints($bars, $lookback = 40) {
    $n      = [math]::Min($lookback, $bars.Count - 2)
    $start  = $bars.Count - $n - 1
    $highs  = @(); $lows = @()
    for ($i = $start + 1; $i -le $bars.Count - 2; $i++) {
        if ([double]$bars[$i].h -gt [double]$bars[$i-1].h -and [double]$bars[$i].h -gt [double]$bars[$i+1].h) {
            $highs += @{ idx = $i; price = [double]$bars[$i].h }
        }
        if ([double]$bars[$i].l -lt [double]$bars[$i-1].l -and [double]$bars[$i].l -lt [double]$bars[$i+1].l) {
            $lows += @{ idx = $i; price = [double]$bars[$i].l }
        }
    }
    return @{ highs = $highs; lows = $lows }
}

function Get-BullishOB($bars, $swings) {
    # Last bearish candle before the most recent significant swing high
    if ($swings.highs.Count -eq 0) { return $null }
    $sh = $swings.highs[-1]
    for ($i = $sh.idx - 1; $i -ge [math]::Max(0, $sh.idx - 15); $i--) {
        if ([double]$bars[$i].c -lt [double]$bars[$i].o) {
            return @{ low = [double]$bars[$i].l; high = [double]$bars[$i].h; idx = $i }
        }
    }
    return $null
}

function Get-BullishFVGs($bars, $lookback = 25) {
    $fvgs  = @()
    $start = [math]::Max(2, $bars.Count - $lookback)
    for ($i = $start; $i -lt $bars.Count; $i++) {
        # Bullish FVG: c1.high < c3.low (unfilled gap between candle i-2 and candle i)
        if ([double]$bars[$i-2].h -lt [double]$bars[$i].l) {
            $fvgs += @{ low = [double]$bars[$i-2].h; high = [double]$bars[$i].l; idx = $i }
        }
    }
    return $fvgs
}

# ─── MAIN ───────────────────────────────────────────────────────────────────

try {
    $bars = Get-DailyBars $Symbol
    if (-not $bars -or $bars.Count -lt 30) {
        @{ score = 0; signal = "INSUFFICIENT_DATA"; symbol = $Symbol; error = "Only $($bars.Count) bars returned" } | ConvertTo-Json
        exit
    }

    $closes = $bars | ForEach-Object { [double]$_.c }
    $curPrice = $closes[-1]
    $curBar   = $bars[-1]

    # Indicators
    $ema9  = (Calc-EMA $closes 9)[-1]
    $ema21 = (Calc-EMA $closes 21)[-1]
    $ema50 = if ($closes.Count -ge 52) { (Calc-EMA $closes 50)[-1] } else { $null }
    $rsi   = Calc-RSI $closes 14
    $macd  = Calc-MACD $closes
    $atr   = Calc-ATR $bars 14

    # SMC
    $swings = Get-SwingPoints $bars 40
    $ob     = Get-BullishOB   $bars $swings
    $fvgs   = Get-BullishFVGs $bars 25

    # Break of structure: current close above last-but-one swing high
    $bos = $false
    if ($swings.highs.Count -ge 2) {
        $bos = ($curPrice -gt $swings.highs[-2].price)
    }

    # Price relative to SMC levels
    $inOB    = $ob -and ($curPrice -ge $ob.low) -and ($curPrice -le $ob.high * 1.005)
    $nearOB  = $ob -and ($curPrice -le $ob.high + $atr * 0.4) -and ($curPrice -ge $ob.low - $atr * 0.2)
    $inFVG   = ($fvgs | Where-Object { $curPrice -ge $_.low -and $curPrice -le $_.high }).Count -gt 0

    # Volume vs 10-day average
    $vols    = $bars[-11..-2] | ForEach-Object { [double]$_.v }
    $avgVol  = ($vols | Measure-Object -Sum).Sum / $vols.Count
    $volRatio = if ($avgVol -gt 0) { [double]$curBar.v / $avgVol } else { 1.0 }

    # ─── SCORE ────────────────────────────────────────────────────────────────
    $score   = 0.0
    $reasons = @()

    # Trend (0–2.5)
    if ($curPrice -gt $ema21) { $score += 1.0; $reasons += "Price > EMA21" }
    if ($ema50 -and $curPrice -gt $ema50) { $score += 1.0; $reasons += "Price > EMA50" }
    if ($ema9 -gt $ema21)     { $score += 0.5; $reasons += "EMA9 > EMA21" }

    # RSI (0–2)
    if ($rsi -ne $null) {
        if     ($rsi -ge 45 -and $rsi -le 65) { $score += 2.0; $reasons += "RSI $([math]::Round($rsi,1)) (ideal)" }
        elseif ($rsi -ge 35 -and $rsi -lt 45) { $score += 1.0; $reasons += "RSI $([math]::Round($rsi,1)) (bounce zone)" }
        elseif ($rsi -gt 65 -and $rsi -le 72) { $score += 0.5; $reasons += "RSI $([math]::Round($rsi,1)) (extended)" }
        # RSI > 72 or < 35 adds nothing — too hot or too weak
    }

    # MACD (0–1.5)
    if ($macd) {
        if   ($macd.bullish_cross)                     { $score += 1.5; $reasons += "MACD bullish crossover" }
        elseif ($macd.macd -gt 0 -and $macd.histogram -gt 0) { $score += 1.0; $reasons += "MACD bullish momentum" }
        elseif ($macd.macd -gt $macd.signal)           { $score += 0.5; $reasons += "MACD above signal" }
    }

    # SMC (0–3.5)
    if     ($inOB)   { $score += 2.0; $reasons += "Price inside bullish order block" }
    elseif ($nearOB) { $score += 1.0; $reasons += "Price near order block" }
    if ($inFVG)      { $score += 1.5; $reasons += "Price in fair value gap" }
    if ($bos)        { $score += 1.0; $reasons += "Break of structure (bullish)" }

    # Volume confirmation (0–0.5)
    if ($volRatio -gt 1.3) { $score += 0.5; $reasons += "Volume $([math]::Round($volRatio,1))x above avg" }

    # ─── STOP / TARGET ─────────────────────────────────────────────────────
    # Stop: below order block (preferred) or 1.5x ATR below price
    $stopBase = $curPrice - $atr * 1.5
    if ($ob -and $ob.low - $atr * 0.1 -gt $stopBase) {
        $stopBase = $ob.low - $atr * 0.1
    }
    # Also check swing low — stop just below it
    if ($swings.lows.Count -gt 0) {
        $sl = $swings.lows[-1].price * 0.997
        if ($sl -gt $stopBase -and $sl -lt $curPrice) { $stopBase = $sl }
    }
    $stopPrice   = [math]::Round([math]::Min($stopBase, $curPrice - $atr * 1.0), 2)
    $stopDist    = $curPrice - $stopPrice
    $targetPrice = [math]::Round($curPrice + $stopDist * 3.0, 2)   # 3:1 R:R minimum
    $rrRatio     = if ($stopDist -gt 0) { [math]::Round(($targetPrice - $curPrice) / $stopDist, 2) } else { 0 }

    $signal = if    ($score -ge 6.5) { "STRONG_BUY" }
              elseif ($score -ge 4.5) { "BUY" }
              elseif ($score -ge 2.5) { "NEUTRAL" }
              else                   { "SKIP" }

    @{
        symbol       = $Symbol
        score        = [math]::Round($score, 1)
        signal       = $signal
        price        = $curPrice
        ema9         = [math]::Round($ema9,  2)
        ema21        = [math]::Round($ema21, 2)
        ema50        = if ($ema50) { [math]::Round($ema50, 2) } else { $null }
        rsi          = if ($rsi)  { [math]::Round($rsi,   1) } else { $null }
        macd_hist    = if ($macd) { [math]::Round($macd.histogram, 4) } else { $null }
        atr          = [math]::Round($atr, 2)
        stop_price   = $stopPrice
        target_price = $targetPrice
        rr_ratio     = $rrRatio
        bos_bullish  = $bos
        in_ob        = $inOB
        in_fvg       = $inFVG
        vol_ratio    = [math]::Round($volRatio, 2)
        reasons      = $reasons
    } | ConvertTo-Json -Depth 5

} catch {
    @{ score = 0; signal = "ERROR"; symbol = $Symbol; error = $_.Exception.Message } | ConvertTo-Json
}
