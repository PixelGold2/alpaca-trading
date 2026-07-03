# smc_analyzer.ps1 - Institutional SMC analyzer.
# Evaluates Weekly/Daily/4H structure, Order Blocks, FVGs, liquidity, confirmation.
# Outputs full trade plan + grade (only A- or above qualifies).

param(
    [Parameter(Mandatory)] [string] $Symbol,
    [ValidateSet("stock","crypto")] [string] $AssetType = "stock"
)

. "$PSScriptRoot\..\config.ps1"

$dataHeaders = @{ "APCA-API-KEY-ID"=$env:APCA_API_KEY_ID; "APCA-API-SECRET-KEY"=$env:APCA_API_SECRET_KEY }

# ---- DATA FETCH ----------------------------------------------------------------

function Get-Bars($sym, $tf, $limit) {
    $lookback = switch ($tf) {
        "1Week" { $limit * 8 }
        "1Day"  { $limit + 10 }
        "4Hour" { [math]::Ceiling($limit / 6) + 10 }
        "1Hour" { [math]::Ceiling($limit / 7) + 5 }
        default { 60 }
    }
    $start  = (Get-Date).AddDays(-$lookback).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $encSym = [uri]::EscapeDataString($sym)
    if ($AssetType -eq "crypto") {
        $url = "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=$encSym&timeframe=$tf&limit=$limit&start=$start"
        $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
        return $resp.bars.PSObject.Properties[$sym].Value
    } else {
        $url = "https://data.alpaca.markets/v2/stocks/bars?symbols=$encSym&timeframe=$tf&limit=$limit&start=$start&feed=iex"
        $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $dataHeaders
        return $resp.bars.PSObject.Properties[$sym].Value
    }
}

# ---- INDICATORS ----------------------------------------------------------------

function Calc-EMA($arr, $period) {
    if ($arr.Count -lt $period) { return @($arr[-1]) }
    $mult = 2.0 / ($period + 1)
    $ema  = @(($arr[0..($period-1)] | Measure-Object -Sum).Sum / $period)
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
    $ag = ($gains[0..($period-1)] | Measure-Object -Sum).Sum / $period
    $al = ($losses[0..($period-1)] | Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $gains.Count; $i++) {
        $ag = ($ag * ($period-1) + $gains[$i]) / $period
        $al = ($al * ($period-1) + $losses[$i]) / $period
    }
    if ($al -eq 0) { return 100.0 }
    return [math]::Round(100.0 - (100.0 / (1.0 + $ag / $al)), 1)
}

function Calc-MACD($closes) {
    if ($closes.Count -lt 35) { return $null }
    $e12 = Calc-EMA $closes 12; $e26 = Calc-EMA $closes 26
    $ml  = @(); for ($i = 0; $i -lt $e26.Count; $i++) { $ml += $e12[$i+14] - $e26[$i] }
    if ($ml.Count -lt 9) { return $null }
    $sig = Calc-EMA $ml 9
    $off = $ml.Count - $sig.Count
    $h   = $ml[$off + $sig.Count - 1] - $sig[-1]
    $hp  = $ml[$off + $sig.Count - 2] - $sig[-2]
    return @{ line=$ml[-1]; signal=$sig[-1]; hist=$h; hist_prev=$hp; bullish=($h -gt 0); cross=($h -gt 0 -and $hp -le 0) }
}

function Calc-ATR($bars, $period = 14) {
    if ($bars.Count -lt $period + 2) { return [double]$bars[-1].h - [double]$bars[-1].l }
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

function Calc-ADX($bars, $period = 14) {
    if ($bars.Count -lt $period * 2) { return 0.0 }
    $plusDM = @(); $minusDM = @(); $trs = @()
    for ($i = 1; $i -lt $bars.Count; $i++) {
        $upMove   = [double]$bars[$i].h - [double]$bars[$i-1].h
        $downMove = [double]$bars[$i-1].l - [double]$bars[$i].l
        $plusDM  += if ($upMove -gt $downMove -and $upMove -gt 0) { $upMove } else { 0 }
        $minusDM += if ($downMove -gt $upMove -and $downMove -gt 0) { $downMove } else { 0 }
        $trs     += [math]::Max([double]$bars[$i].h - [double]$bars[$i].l,
                    [math]::Max([math]::Abs([double]$bars[$i].h - [double]$bars[$i-1].c),
                                [math]::Abs([double]$bars[$i].l - [double]$bars[$i-1].c)))
    }
    $atr14  = ($trs[0..($period-1)]    | Measure-Object -Sum).Sum / $period
    $pdm14  = ($plusDM[0..($period-1)] | Measure-Object -Sum).Sum / $period
    $mdm14  = ($minusDM[0..($period-1)]| Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $trs.Count; $i++) {
        $atr14 = ($atr14 * ($period-1) + $trs[$i])    / $period
        $pdm14 = ($pdm14 * ($period-1) + $plusDM[$i]) / $period
        $mdm14 = ($mdm14 * ($period-1) + $minusDM[$i])/ $period
    }
    if ($atr14 -eq 0) { return 0.0 }
    $pdi = 100 * $pdm14 / $atr14; $mdi = 100 * $mdm14 / $atr14
    $dx  = if (($pdi + $mdi) -gt 0) { 100 * [math]::Abs($pdi - $mdi) / ($pdi + $mdi) } else { 0 }
    return [math]::Round($dx, 1)
}

function Calc-BollingerBands($closes, $period = 20) {
    if ($closes.Count -lt $period) { return $null }
    $slice = $closes[($closes.Count - $period)..($closes.Count - 1)]
    $mean  = ($slice | Measure-Object -Sum).Sum / $period
    $variance = ($slice | ForEach-Object { ($_ - $mean) * ($_ - $mean) } | Measure-Object -Sum).Sum / $period
    $sd   = [math]::Sqrt($variance)
    return @{ upper=$mean + 2*$sd; middle=$mean; lower=$mean - 2*$sd; width=4*$sd/$mean }
}

# ---- MARKET STRUCTURE ---------------------------------------------------------

function Find-Swings($bars, $n = 3) {
    $highs = @(); $lows = @()
    for ($i = $n; $i -lt $bars.Count - $n; $i++) {
        $isH = $true; $isL = $true
        for ($j = 1; $j -le $n; $j++) {
            if ([double]$bars[$i].h -le [double]$bars[$i-$j].h -or
                [double]$bars[$i].h -le [double]$bars[$i+$j].h) { $isH = $false }
            if ([double]$bars[$i].l -ge [double]$bars[$i-$j].l -or
                [double]$bars[$i].l -ge [double]$bars[$i+$j].l) { $isL = $false }
        }
        if ($isH) { $highs += @{ price=[double]$bars[$i].h; idx=$i } }
        if ($isL) { $lows  += @{ price=[double]$bars[$i].l; idx=$i } }
    }
    return @{ highs=$highs; lows=$lows }
}

function Get-Structure($swings) {
    if ($swings.highs.Count -lt 2 -or $swings.lows.Count -lt 2) { return "RANGING" }
    $hh = $swings.highs[-1].price -gt $swings.highs[-2].price
    $hl = $swings.lows[-1].price  -gt $swings.lows[-2].price
    $lh = $swings.highs[-1].price -lt $swings.highs[-2].price
    $ll = $swings.lows[-1].price  -lt $swings.lows[-2].price
    if ($hh -and $hl) { return "BULLISH" }
    if ($lh -and $ll) { return "BEARISH" }
    return "RANGING"
}

function Detect-BOS($bars, $swings) {
    $cur = [double]$bars[-1].c
    if ($swings.highs.Count -lt 1 -or $swings.lows.Count -lt 1) { return "NONE" }
    $recentHigh = ($swings.highs | Sort-Object { $_.idx })[-1].price
    $recentLow  = ($swings.lows  | Sort-Object { $_.idx })[-1].price
    if ($cur -gt $recentHigh) { return "BULLISH" }
    if ($cur -lt $recentLow)  { return "BEARISH" }
    return "NONE"
}

# ---- SMC CONCEPTS -------------------------------------------------------------

function Find-OrderBlocks($bars, $direction, $atr) {
    $obs = @()
    $lookback = [math]::Min(30, $bars.Count - 5)
    $start = $bars.Count - $lookback
    for ($i = $start; $i -lt $bars.Count - 3; $i++) {
        $o = [double]$bars[$i].o; $c = [double]$bars[$i].c
        $h = [double]$bars[$i].h; $l = [double]$bars[$i].l
        if ($direction -eq "bullish" -and $c -lt $o) {
            # Bearish candle followed by bullish impulse
            $impulse = [double]$bars[$i+2].c - $h
            if ($impulse -gt $atr * 1.2) { $obs += @{ high=$h; low=$l; idx=$i; fresh=($i -gt $bars.Count - 10) } }
        }
        if ($direction -eq "bearish" -and $c -gt $o) {
            # Bullish candle followed by bearish impulse
            $impulse = $l - [double]$bars[$i+2].c
            if ($impulse -gt $atr * 1.2) { $obs += @{ high=$h; low=$l; idx=$i; fresh=($i -gt $bars.Count - 10) } }
        }
    }
    return $obs
}

function Find-FVG($bars, $direction) {
    $fvgs = @()
    for ($i = 1; $i -lt $bars.Count - 1; $i++) {
        $prev = $bars[$i-1]; $cur = $bars[$i]; $next = $bars[$i+1]
        if ($direction -eq "bullish") {
            $gap = [double]$next.l - [double]$prev.h
            if ($gap -gt 0) { $fvgs += @{ high=[double]$next.l; low=[double]$prev.h; idx=$i; gap=$gap } }
        } else {
            $gap = [double]$prev.l - [double]$next.h
            if ($gap -gt 0) { $fvgs += @{ high=[double]$prev.l; low=[double]$next.h; idx=$i; gap=$gap } }
        }
    }
    return $fvgs
}

function Is-PriceAtZone($price, $zones, $tolerance) {
    foreach ($z in $zones) {
        $low  = if ($z.low)  { $z.low }  else { $z.price * (1 - $tolerance) }
        $high = if ($z.high) { $z.high } else { $z.price * (1 + $tolerance) }
        if ($price -ge ($low - $tolerance * $price) -and $price -le ($high + $tolerance * $price)) { return $true }
    }
    return $false
}

function Detect-LiquidityGrab($bars, $swings, $direction) {
    if ($bars.Count -lt 5) { return $false }
    $recent = $bars[($bars.Count - 5)..($bars.Count - 1)]
    if ($direction -eq "bullish" -and $swings.lows.Count -gt 0) {
        $eqLow = ($swings.lows | Sort-Object { $_.idx })[-1].price
        $wicked = $recent | Where-Object { [double]$_.l -lt $eqLow -and [double]$_.c -gt $eqLow }
        return $null -ne $wicked -and @($wicked).Count -gt 0
    }
    if ($direction -eq "bearish" -and $swings.highs.Count -gt 0) {
        $eqHigh = ($swings.highs | Sort-Object { $_.idx })[-1].price
        $wicked = $recent | Where-Object { [double]$_.h -gt $eqHigh -and [double]$_.c -lt $eqHigh }
        return $null -ne $wicked -and @($wicked).Count -gt 0
    }
    return $false
}

function Detect-CandlePattern($bars) {
    if ($bars.Count -lt 2) { return "NONE" }
    $c = $bars[-1]; $p = $bars[-2]
    $co=[double]$c.o; $cc=[double]$c.c; $ch=[double]$c.h; $cl=[double]$c.l
    $po=[double]$p.o; $pc=[double]$p.c
    $body = [math]::Abs($cc - $co); $range = $ch - $cl
    if ($range -eq 0) { return "NONE" }
    $upWick = $ch - [math]::Max($co,$cc); $downWick = [math]::Min($co,$cc) - $cl
    if ($cc -gt $co -and $pc -lt $po -and $co -le $pc -and $cc -ge $po) { return "BULLISH_ENGULF" }
    if ($cc -lt $co -and $pc -gt $po -and $co -ge $pc -and $cc -le $po) { return "BEARISH_ENGULF" }
    if ($body/$range -lt 0.3 -and $downWick/$range -gt 0.55) { return "HAMMER" }
    if ($body/$range -lt 0.3 -and $upWick/$range -gt 0.55)   { return "SHOOTING_STAR" }
    if ($body/$range -lt 0.15) { return "DOJI" }
    return "NONE"
}

# ---- MAIN ANALYSIS ------------------------------------------------------------

try {
    $weekly = Get-Bars $Symbol "1Week" 26
    $daily  = Get-Bars $Symbol "1Day"  60
    $h4     = Get-Bars $Symbol "4Hour" 100

    if ($weekly.Count -lt 10 -or $daily.Count -lt 30 -or $h4.Count -lt 30) {
        @{ signal="NO_TRADE"; reason="INSUFFICIENT_DATA"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    $price = [double]$h4[-1].c

    # ---- WEEKLY STRUCTURE ----
    $wClose   = $weekly | ForEach-Object { [double]$_.c }
    $wSwings  = Find-Swings $weekly 2
    $wStruct  = Get-Structure $wSwings
    $wEma20   = (Calc-EMA $wClose 20)[-1]
    $wEma50   = if ($wClose.Count -ge 52) { (Calc-EMA $wClose 50)[-1] } else { $wEma20 }
    $wBull    = $price -gt $wEma20 -and $price -gt $wEma50

    # ---- DAILY STRUCTURE ----
    $dClose   = $daily | ForEach-Object { [double]$_.c }
    $dSwings  = Find-Swings $daily 3
    $dStruct  = Get-Structure $dSwings
    $dBOS     = Detect-BOS $daily $dSwings
    $dEma20   = (Calc-EMA $dClose 20)[-1]
    $dEma50   = if ($dClose.Count -ge 52) { (Calc-EMA $dClose 50)[-1] } else { $dEma20 }
    $dEma200  = if ($dClose.Count -ge 202) { (Calc-EMA $dClose 200)[-1] } else { $dEma50 }
    $dRsi     = Calc-RSI $dClose 14
    $dAtr     = Calc-ATR $daily 14

    # ---- 4H STRUCTURE + SMC ----
    $h4Close  = $h4 | ForEach-Object { [double]$_.c }
    $h4Swings = Find-Swings $h4 3
    $h4Struct = Get-Structure $h4Swings
    $h4BOS    = Detect-BOS $h4 $h4Swings
    $h4Ema20  = (Calc-EMA $h4Close 20)[-1]
    $h4Ema50  = if ($h4Close.Count -ge 52) { (Calc-EMA $h4Close 50)[-1] } else { $h4Ema20 }
    $h4Ema200 = if ($h4Close.Count -ge 202) { (Calc-EMA $h4Close 200)[-1] } else { $h4Ema50 }
    $h4Macd   = Calc-MACD $h4Close
    $h4Atr    = Calc-ATR $h4 14
    $h4Rsi    = Calc-RSI $h4Close 14
    $h4Adx    = Calc-ADX $h4 14
    $h4BB     = Calc-BollingerBands $h4Close 20
    $h4Vols   = $h4[-21..-2] | ForEach-Object { [double]$_.v }
    $h4AvgVol = ($h4Vols | Measure-Object -Sum).Sum / $h4Vols.Count
    $h4VolR   = if ($h4AvgVol -gt 0) { [double]$h4[-1].v / $h4AvgVol } else { 1.0 }

    # Order blocks and FVGs on 4H
    $h4BullOBs = Find-OrderBlocks $h4 "bullish" $h4Atr
    $h4BearOBs = Find-OrderBlocks $h4 "bearish" $h4Atr
    $h4BullFVG = Find-FVG $h4 "bullish"
    $h4BearFVG = Find-FVG $h4 "bearish"
    $candlePat  = Detect-CandlePattern $h4

    # ---- DETERMINE DIRECTION ----
    $bullSignals = 0; $bearSignals = 0
    if ($wStruct -eq "BULLISH") { $bullSignals++ } elseif ($wStruct -eq "BEARISH") { $bearSignals++ }
    if ($dStruct -eq "BULLISH") { $bullSignals++ } elseif ($dStruct -eq "BEARISH") { $bearSignals++ }
    if ($h4Struct -eq "BULLISH") { $bullSignals++ } elseif ($h4Struct -eq "BEARISH") { $bearSignals++ }
    if ($price -gt $dEma200) { $bullSignals++ } else { $bearSignals++ }
    if ($h4Macd -and $h4Macd.bullish) { $bullSignals++ } elseif ($h4Macd) { $bearSignals++ }

    $direction = if ($bullSignals -gt $bearSignals) { "LONG" } else { "SHORT" }
    if ($bullSignals -eq $bearSignals) {
        @{ signal="NO_TRADE"; reason="No clear directional bias"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    # ---- RSI FILTERS ----
    if ($direction -eq "LONG"  -and $h4Rsi -gt 72) {
        @{ signal="NO_TRADE"; reason="4H RSI overbought ($h4Rsi) for long"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }
    if ($direction -eq "SHORT" -and $h4Rsi -lt 28) {
        @{ signal="NO_TRADE"; reason="4H RSI oversold ($h4Rsi) for short"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    # ---- STOP LOSS ----
    $dp = if ($price -ge 1000) { 2 } elseif ($price -ge 1) { 4 } else { 6 }
    $stopPrice = if ($direction -eq "LONG") {
        $swingLow = if ($h4Swings.lows.Count -gt 0) { ($h4Swings.lows | Sort-Object { $_.idx })[-1].price } else { $price - $h4Atr * 2 }
        [math]::Round([math]::Max($swingLow * 0.997, $price - $h4Atr * 2.0), $dp)
    } else {
        $swingHigh = if ($h4Swings.highs.Count -gt 0) { ($h4Swings.highs | Sort-Object { $_.idx })[-1].price } else { $price + $h4Atr * 2 }
        [math]::Round([math]::Min($swingHigh * 1.003, $price + $h4Atr * 2.0), $dp)
    }

    $stopDist = [math]::Abs($price - $stopPrice)
    $stopPct  = [math]::Round($stopDist / $price * 100, 2)

    if ($stopPct -gt 6.0) {
        @{ signal="NO_TRADE"; reason="Stop $stopPct pct too wide (max 6 pct)"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    # ---- TARGETS (minimum 2R) ----
    $tp1 = if ($direction -eq "LONG") { [math]::Round($price + $stopDist * 2.0, $dp) } else { [math]::Round($price - $stopDist * 2.0, $dp) }
    $tp2 = if ($direction -eq "LONG") { [math]::Round($price + $stopDist * 3.0, $dp) } else { [math]::Round($price - $stopDist * 3.0, $dp) }
    $rr  = 2.0

    # Check if next liquidity level provides better TP
    $liquidityTarget = if ($direction -eq "LONG" -and $h4Swings.highs.Count -gt 0) {
        ($h4Swings.highs | Where-Object { $_.price -gt $price } | Sort-Object { $_.price } | Select-Object -First 1).price
    } elseif ($direction -eq "SHORT" -and $h4Swings.lows.Count -gt 0) {
        ($h4Swings.lows | Where-Object { $_.price -lt $price } | Sort-Object { $_.price } -Descending | Select-Object -First 1).price
    } else { $null }

    if ($liquidityTarget) {
        $liqRR = [math]::Round([math]::Abs($liquidityTarget - $price) / $stopDist, 1)
        if ($liqRR -gt $rr) { $tp1 = [math]::Round($liquidityTarget, $dp); $rr = $liqRR }
    }

    # ---- SCORING (0-100) ----
    $score = 0; $for = @(); $against = @()

    # HTF Trend (25pts)
    if ($wStruct -eq $direction.Replace("LONG","BULLISH").Replace("SHORT","BEARISH")) {
        $score += 10; $for += "Weekly structure $wStruct"
    } else { $against += "Weekly structure opposing ($wStruct)" }

    if ($dStruct -eq $direction.Replace("LONG","BULLISH").Replace("SHORT","BEARISH")) {
        $score += 10; $for += "Daily structure $dStruct"
    } else { $against += "Daily structure opposing ($dStruct)" }

    if ($h4Struct -eq $direction.Replace("LONG","BULLISH").Replace("SHORT","BEARISH")) {
        $score += 5; $for += "4H structure aligned"
    } else { $against += "4H structure not aligned" }

    # Market Structure confirmation (15pts)
    if ($dBOS -eq "BULLISH" -and $direction -eq "LONG") { $score += 8; $for += "Daily BOS bullish" }
    elseif ($dBOS -eq "BEARISH" -and $direction -eq "SHORT") { $score += 8; $for += "Daily BOS bearish" }
    else { $against += "No daily BOS confirmation" }

    if ($h4BOS -eq "BULLISH" -and $direction -eq "LONG") { $score += 7; $for += "4H BOS bullish" }
    elseif ($h4BOS -eq "BEARISH" -and $direction -eq "SHORT") { $score += 7; $for += "4H BOS bearish" }

    # Order Block (15pts)
    $atOB = $false
    if ($direction -eq "LONG" -and $h4BullOBs.Count -gt 0) {
        $nearOB = $h4BullOBs | Where-Object { $price -ge $_.low * 0.998 -and $price -le $_.high * 1.002 }
        if ($nearOB) {
            $freshOB = @($nearOB | Where-Object { $_.fresh }).Count -gt 0
            if ($freshOB) { $score += 15 } else { $score += 10 }
            $obFreshTag = if ($freshOB) { " (fresh)" } else { "" }
            $atOB = $true; $for += "At 4H bullish order block$obFreshTag"
        }
    } elseif ($direction -eq "SHORT" -and $h4BearOBs.Count -gt 0) {
        $nearOB = $h4BearOBs | Where-Object { $price -ge $_.low * 0.998 -and $price -le $_.high * 1.002 }
        if ($nearOB) {
            $freshOB = @($nearOB | Where-Object { $_.fresh }).Count -gt 0
            if ($freshOB) { $score += 15 } else { $score += 10 }
            $obFreshTag = if ($freshOB) { " (fresh)" } else { "" }
            $atOB = $true; $for += "At 4H bearish order block$obFreshTag"
        }
    }
    if (-not $atOB) { $against += "Not at identified order block" }

    # FVG (8pts)
    if ($direction -eq "LONG" -and $h4BullFVG.Count -gt 0) {
        $nearFVG = $h4BullFVG | Where-Object { $price -ge $_.low * 0.999 -and $price -le $_.high * 1.001 }
        if ($nearFVG) { $score += 8; $for += "Price filling bullish FVG" }
    } elseif ($direction -eq "SHORT" -and $h4BearFVG.Count -gt 0) {
        $nearFVG = $h4BearFVG | Where-Object { $price -ge $_.low * 0.999 -and $price -le $_.high * 1.001 }
        if ($nearFVG) { $score += 8; $for += "Price filling bearish FVG" }
    }

    # Liquidity grab (7pts)
    $liqGrab = Detect-LiquidityGrab $h4 $h4Swings $direction.Replace("LONG","bullish").Replace("SHORT","bearish")
    if ($liqGrab) { $score += 7; $for += "Liquidity grab / stop hunt detected" }
    else { $against += "No liquidity grab" }

    # EMA alignment (15pts)
    if ($direction -eq "LONG") {
        if ($price -gt $dEma200) { $score += 8; $for += "Above 200 EMA (daily)" } else { $against += "Below 200 EMA (bearish)" }
        if ($price -gt $h4Ema50)  { $score += 4; $for += "Above 4H 50 EMA" }
        if ($price -gt $h4Ema20)  { $score += 3; $for += "Above 4H 20 EMA" }
    } else {
        if ($price -lt $dEma200) { $score += 8; $for += "Below 200 EMA (daily)" } else { $against += "Above 200 EMA (bullish bias)" }
        if ($price -lt $h4Ema50)  { $score += 4; $for += "Below 4H 50 EMA" }
        if ($price -lt $h4Ema20)  { $score += 3; $for += "Below 4H 20 EMA" }
    }

    # Candle pattern (5pts)
    $bullPat = @("BULLISH_ENGULF","HAMMER")
    $bearPat = @("BEARISH_ENGULF","SHOOTING_STAR")
    if ($direction -eq "LONG"  -and $candlePat -in $bullPat) { $score += 5; $for += "Bullish candle pattern: $candlePat" }
    if ($direction -eq "SHORT" -and $candlePat -in $bearPat)  { $score += 5; $for += "Bearish candle pattern: $candlePat" }
    if ($candlePat -eq "NONE") { $against += "No clear candle confirmation" }

    # Volume (5pts)
    if ($h4VolR -ge 1.3) { $score += 5; $for += "Volume $([math]::Round($h4VolR,1))x above average" }
    elseif ($h4VolR -lt 0.7) { $against += "Low volume ($([math]::Round($h4VolR,1))x avg)" }

    # Momentum (10pts)
    if ($h4Macd) {
        if (($direction -eq "LONG" -and $h4Macd.bullish) -or ($direction -eq "SHORT" -and -not $h4Macd.bullish)) {
            if ($h4Macd.cross) { $score += 6 } else { $score += 4 }
            $crossTag = if ($h4Macd.cross) { "crossover " } else { "" }
            $for += "MACD $($crossTag)aligned"
        } else { $against += "MACD opposing direction" }
    }
    if ($h4Adx -ge 25) { $score += 4; $for += "ADX $h4Adx (strong trend)" }
    elseif ($h4Adx -lt 15) { $against += "ADX $h4Adx (weak trend)" }

    # RR bonus
    if ($rr -ge 2.5) { $score += 5; $for += "RR $rr (strong)" }
    elseif ($rr -lt 2.0) { $score = 0 }

    # ---- GRADE ----
    $score   = [math]::Min(100, [math]::Max(0, $score))
    if      ($score -ge 95) { $grade = "A+" }
    elseif  ($score -ge 90) { $grade = "A"  }
    elseif  ($score -ge 84) { $grade = "A-" }
    elseif  ($score -ge 78) { $grade = "B+" }
    elseif  ($score -ge 70) { $grade = "B"  }
    elseif  ($score -ge 60) { $grade = "C"  }
    else                    { $grade = "F"  }
    $tradeable = $score -ge 84

    $limFactor = if ($direction -eq "LONG") { 0.9975 } else { 1.0025 }
    $stopLim   = [math]::Round($stopPrice * $limFactor, $dp)
    $riskPct   = $stopPct
    $rewardPct = [math]::Round($stopPct * $rr, 2)

    if      ($atOB -and $liqGrab) { $setup = "Liquidity grab into Order Block" }
    elseif  ($atOB)               { $setup = "Pullback into Order Block" }
    elseif  ($liqGrab)            { $setup = "Liquidity grab / stop hunt" }
    else                          { $setup = "Structure pullback" }

    $mgmtPlan = "Move stop to breakeven after 1R profit ($([math]::Round($stopPct,2))%). " +
                "Take 50% at TP1 ($tp1). Trail remaining with ATR on swing lows. " +
                "Full exit at TP2 ($tp2) or 4H close against structure."

    $invalidation = if ($direction -eq "LONG") {
        "4H close below $stopPrice (swing low broken)"
    } else {
        "4H close above $stopPrice (swing high broken)"
    }

    $result = [ordered]@{
        symbol         = $Symbol
        ticker         = $Symbol
        direction      = $direction
        confidence     = $score
        grade          = $grade
        signal         = $(if ($tradeable) { "TRADE" } else { "NO_TRADE" })
        setup          = $setup
        trend          = "$wStruct (W) / $dStruct (D) / $h4Struct (4H)"
        price          = $price
        entry          = $price
        stop           = $stopPrice
        stop_lim       = $stopLim
        stop_pct       = $stopPct
        tp1            = $tp1
        tp2            = $tp2
        rr             = $rr
        risk_pct       = $riskPct
        reward_pct     = $rewardPct
        probability    = [math]::Min(80, [math]::Round(40 + $score * 0.4, 0))
        reasons_for    = $for
        reasons_against = $against
        invalidation   = $invalidation
        management     = $mgmtPlan
        daily_rsi      = $dRsi
        h4_rsi         = $h4Rsi
        h4_adx         = $h4Adx
        h4_vol_ratio   = [math]::Round($h4VolR, 2)
        candle_pattern = $candlePat
        at_ob          = $atOB
        liq_grab       = $liqGrab
    }

    if (-not $tradeable) {
        $result["reason"] = "Score $score - Grade $grade below A- threshold (84)"
    }

    $result | ConvertTo-Json -Depth 5

} catch {
    @{ signal="NO_TRADE"; reason="ERROR"; symbol=$Symbol; grade="F"; error=$_.Exception.Message } | ConvertTo-Json
}
