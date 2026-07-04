# smc_analyzer.ps1 - SMC scalping analyzer.
# Evaluates 4H macro / 1H intermediate / 30min entry. Tight stop from recent swing.
# Outputs full trade plan + grade (score >= 80 qualifies).

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
        "15Min" { [math]::Max(14, [math]::Ceiling($limit / 26) + 5) }
        "30Min" { [math]::Max(15, [math]::Ceiling($limit / 13) + 5) }
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

# ---- MAIN ANALYSIS (30min entry / 1H intermediate / 4H macro) ----------------

try {
    $h4macro = Get-Bars $Symbol "4Hour" 50
    $h1      = Get-Bars $Symbol "1Hour" 72
    $m30     = Get-Bars $Symbol "30Min" 100

    if ($h4macro.Count -lt 20 -or $h1.Count -lt 24 -or $m30.Count -lt 30) {
        @{ signal="NO_TRADE"; reason="INSUFFICIENT_DATA"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    $price = [double]$m30[-1].c
    $dp    = if ($price -ge 1000) { 2 } elseif ($price -ge 1) { 4 } else { 6 }

    # ---- 4H MACRO TREND ----
    $h4Close  = $h4macro | ForEach-Object { [double]$_.c }
    $h4Swings = Find-Swings $h4macro 3
    $h4Struct = Get-Structure $h4Swings
    $h4Ema20  = (Calc-EMA $h4Close 20)[-1]
    $h4Ema50  = if ($h4Close.Count -ge 52) { (Calc-EMA $h4Close 50)[-1] } else { $h4Ema20 }
    $h4Macd   = Calc-MACD $h4Close

    # ---- 1H INTERMEDIATE ----
    $h1Close  = $h1 | ForEach-Object { [double]$_.c }
    $h1Swings = Find-Swings $h1 3
    $h1Struct = Get-Structure $h1Swings
    $h1BOS    = Detect-BOS $h1 $h1Swings
    $h1Ema20  = (Calc-EMA $h1Close 20)[-1]
    $h1Ema50  = if ($h1Close.Count -ge 52) { (Calc-EMA $h1Close 50)[-1] } else { $h1Ema20 }
    $h1Rsi    = Calc-RSI $h1Close 14

    # ---- 15MIN ENTRY ----
    $m30Close  = $m30 | ForEach-Object { [double]$_.c }
    $m30Swings = Find-Swings $m30 3
    $m30Struct = Get-Structure $m30Swings
    $m30BOS    = Detect-BOS $m30 $m30Swings
    $m30Ema20  = (Calc-EMA $m30Close 20)[-1]
    $m30Macd   = Calc-MACD $m30Close
    $m30Atr    = Calc-ATR $m30 14
    $m30Rsi    = Calc-RSI $m30Close 14
    $m30Adx    = Calc-ADX $m30 14
    $m30Vols   = $m30[-21..-2] | ForEach-Object { [double]$_.v }
    $m30AvgVol = ($m30Vols | Measure-Object -Sum).Sum / $m30Vols.Count
    $m30VolR   = if ($m30AvgVol -gt 0) { [double]$m30[-1].v / $m30AvgVol } else { 1.0 }

    # Order blocks + FVGs on 30min (tight entry zones)
    $m30BullOBs = Find-OrderBlocks $m30 "bullish" $m30Atr
    $m30BearOBs = Find-OrderBlocks $m30 "bearish" $m30Atr
    $m30BullFVG = Find-FVG $m30 "bullish"
    $m30BearFVG = Find-FVG $m30 "bearish"
    $candlePat  = Detect-CandlePattern $m30

    # ---- DIRECTION BIAS ----
    $bullSignals = 0; $bearSignals = 0
    if ($h4Struct -eq "BULLISH") { $bullSignals += 2 } elseif ($h4Struct -eq "BEARISH") { $bearSignals += 2 }
    if ($h1Struct -eq "BULLISH") { $bullSignals++ }    elseif ($h1Struct -eq "BEARISH") { $bearSignals++ }
    if ($m30Struct -eq "BULLISH") { $bullSignals++ }   elseif ($m30Struct -eq "BEARISH") { $bearSignals++ }
    if ($price -gt $h4Ema50)  { $bullSignals++ } else { $bearSignals++ }
    if ($h4Macd -and $h4Macd.bullish) { $bullSignals++ } elseif ($h4Macd) { $bearSignals++ }

    if ($bullSignals -eq $bearSignals) {
        @{ signal="NO_TRADE"; reason="No clear directional bias"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }
    $direction = if ($bullSignals -gt $bearSignals) { "LONG" } else { "SHORT" }

    # ---- RSI FILTERS (30min overbought/oversold) ----
    if ($direction -eq "LONG"  -and $m30Rsi -gt 75) {
        @{ signal="NO_TRADE"; reason="30min RSI overbought ($m30Rsi)"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }
    if ($direction -eq "SHORT" -and $m30Rsi -lt 25) {
        @{ signal="NO_TRADE"; reason="30min RSI oversold ($m30Rsi)"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    # ---- TIGHT STOP from last 2 completed 30min candles ----
    # Only 2 candles (1 hour of range) for tight scalp entry
    $recent2 = $m30[($m30.Count - 3)..($m30.Count - 2)]
    $recentLow  = ($recent2 | ForEach-Object { [double]$_.l } | Measure-Object -Minimum).Minimum
    $recentHigh = ($recent2 | ForEach-Object { [double]$_.h } | Measure-Object -Maximum).Maximum

    if ($direction -eq "LONG") {
        $stopPrice = [math]::Round($recentLow * 0.9992, $dp)   # 0.08% below recent low
    } else {
        $stopPrice = [math]::Round($recentHigh * 1.0008, $dp)  # 0.08% above recent high
    }

    $stopDist = [math]::Abs($price - $stopPrice)
    $stopPct  = [math]::Round($stopDist / $price * 100, 3)

    # Enforce minimum distance (0.1%) to avoid slippage kills
    if ($stopPct -lt 0.1) {
        $stopPrice = if ($direction -eq "LONG") { [math]::Round($price * 0.999, $dp) } else { [math]::Round($price * 1.001, $dp) }
        $stopDist  = [math]::Abs($price - $stopPrice)
        $stopPct   = [math]::Round($stopDist / $price * 100, 3)
    }

    # Hard max: 0.5% for scalping. Wider = skip.
    if ($stopPct -gt 0.5) {
        @{ signal="NO_TRADE"; reason="Stop $stopPct% too wide for scalp (max 0.5%)"; symbol=$Symbol; grade="F" } | ConvertTo-Json; exit
    }

    # ---- TARGETS ----
    $tp1 = if ($direction -eq "LONG") { [math]::Round($price + $stopDist * 2.0, $dp) } else { [math]::Round($price - $stopDist * 2.0, $dp) }
    $tp2 = if ($direction -eq "LONG") { [math]::Round($price + $stopDist * 3.0, $dp) } else { [math]::Round($price - $stopDist * 3.0, $dp) }
    $rr  = 2.0

    # Liquidity target as TP if better RR
    $liqTarget = $null
    if ($direction -eq "LONG" -and $m30Swings.highs.Count -gt 0) {
        $liqTarget = ($m30Swings.highs | Where-Object { $_.price -gt $price } | Sort-Object { $_.price } | Select-Object -First 1).price
    } elseif ($direction -eq "SHORT" -and $m30Swings.lows.Count -gt 0) {
        $liqTarget = ($m30Swings.lows | Where-Object { $_.price -lt $price } | Sort-Object { $_.price } -Descending | Select-Object -First 1).price
    }
    if ($liqTarget) {
        $liqRR = [math]::Round([math]::Abs($liqTarget - $price) / $stopDist, 1)
        if ($liqRR -ge 2.0 -and $liqRR -gt $rr) { $tp1 = [math]::Round($liqTarget, $dp); $rr = $liqRR }
    }

    # ---- SCORING (scalp-calibrated, 0-100) ----
    $score = 0; $for = @(); $against = @()
    $dirBull = "BULLISH"; $dirBear = "BEARISH"
    $isBull  = $direction -eq "LONG"

    # 4H macro trend (20pts — most weight, must trade with macro)
    $h4Target = if ($isBull) { $dirBull } else { $dirBear }
    if ($h4Struct -eq $h4Target) { $score += 12; $for += "4H macro trend aligned ($h4Struct)" }
    else { $against += "4H macro opposing ($h4Struct)" }
    if (($isBull -and $price -gt $h4Ema50) -or (-not $isBull -and $price -lt $h4Ema50)) { $score += 8; $for += "Price on right side of 4H 50 EMA" }
    else { $against += "Price wrong side of 4H 50 EMA" }

    # 1H intermediate (20pts)
    $h1Target = if ($isBull) { $dirBull } else { $dirBear }
    if ($h1Struct -eq $h1Target) { $score += 10; $for += "1H structure aligned ($h1Struct)" }
    else { $against += "1H structure opposing ($h1Struct)" }
    $bosBull = if ($isBull) { "BULLISH" } else { "BEARISH" }
    if ($h1BOS -eq $bosBull) { $score += 6; $for += "1H BOS confirmed" }
    else { $against += "No 1H BOS" }
    if (($isBull -and $price -gt $h1Ema20) -or (-not $isBull -and $price -lt $h1Ema20)) { $score += 4; $for += "Above/below 1H 20 EMA" }

    # 30min entry quality — OB (20pts)
    $atOB = $false
    if ($isBull) { $entryOBs = $m30BullOBs } else { $entryOBs = $m30BearOBs }
    if ($entryOBs.Count -gt 0) {
        $nearOB = $entryOBs | Where-Object { $price -ge $_.low * 0.999 -and $price -le $_.high * 1.001 }
        if ($nearOB) {
            $freshOB = @($nearOB | Where-Object { $_.fresh }).Count -gt 0
            if ($freshOB) { $score += 20 } else { $score += 13 }
            $obFreshTag = if ($freshOB) { " (fresh)" } else { "" }
            $atOB = $true; $for += "At 30min order block$obFreshTag"
        }
    }
    if (-not $atOB) { $against += "Not at 30min order block" }

    # 30min FVG fill (10pts)
    $atFVG = $false
    if ($isBull) { $entryFVGs = $m30BullFVG } else { $entryFVGs = $m30BearFVG }
    if ($entryFVGs.Count -gt 0) {
        $nearFVG = $entryFVGs | Where-Object { $price -ge $_.low * 0.9995 -and $price -le $_.high * 1.0005 }
        if ($nearFVG) { $score += 10; $atFVG = $true; $for += "Filling 30min FVG" }
    }
    if (-not $atFVG) { $against += "No 30min FVG at entry" }

    # Liquidity grab on 30min (8pts)
    $liqDir  = if ($isBull) { "bullish" } else { "bearish" }
    $liqGrab = Detect-LiquidityGrab $m30 $m30Swings $liqDir
    if ($liqGrab) { $score += 8; $for += "30min liquidity grab / stop hunt" }
    else { $against += "No recent liquidity grab" }

    # Candle pattern on 30min (7pts)
    $bullPat = @("BULLISH_ENGULF","HAMMER")
    $bearPat = @("BEARISH_ENGULF","SHOOTING_STAR")
    if ($isBull  -and $candlePat -in $bullPat) { $score += 7; $for += "30min candle: $candlePat" }
    elseif (-not $isBull -and $candlePat -in $bearPat) { $score += 7; $for += "30min candle: $candlePat" }
    else { $against += "No confirming candle pattern" }

    # Momentum (10pts)
    if ($m30Macd) {
        if (($isBull -and $m30Macd.bullish) -or (-not $isBull -and -not $m30Macd.bullish)) {
            if ($m30Macd.cross) { $score += 6 } else { $score += 4 }
            $crossTag = if ($m30Macd.cross) { "crossover " } else { "" }
            $for += "30min MACD $($crossTag)aligned"
        } else { $against += "30min MACD opposing" }
    }
    if ($m30Adx -ge 20) { $score += 4; $for += "ADX $m30Adx trending" }
    elseif ($m30Adx -lt 15) { $against += "ADX $m30Adx weak" }

    # Volume (5pts)
    if ($m30VolR -ge 1.2) { $score += 5; $for += "Volume $([math]::Round($m30VolR,1))x avg" }
    elseif ($m30VolR -lt 0.6) { $against += "Low volume ($([math]::Round($m30VolR,1))x avg)" }

    # RR bonus
    if ($rr -ge 2.5) { $score += 5; $for += "RR $rr" }
    elseif ($rr -lt 2.0) { $score = 0 }

    # ---- GRADE (scalp thresholds) ----
    $score = [math]::Min(100, [math]::Max(0, $score))
    if      ($score -ge 92) { $grade = "A+" }
    elseif  ($score -ge 87) { $grade = "A"  }
    elseif  ($score -ge 80) { $grade = "A-" }
    elseif  ($score -ge 73) { $grade = "B+" }
    elseif  ($score -ge 65) { $grade = "B"  }
    elseif  ($score -ge 55) { $grade = "C"  }
    else                    { $grade = "F"  }
    $tradeable = $score -ge 80

    $limFactor = if ($direction -eq "LONG") { 0.9975 } else { 1.0025 }
    $stopLim   = [math]::Round($stopPrice * $limFactor, $dp)
    $riskPct   = $stopPct
    $rewardPct = [math]::Round($stopPct * $rr, 2)

    if      ($atOB -and $liqGrab) { $setup = "30min liquidity grab into OB" }
    elseif  ($atOB -and $atFVG)   { $setup = "30min OB + FVG confluence" }
    elseif  ($atOB)               { $setup = "30min order block pullback" }
    elseif  ($liqGrab)            { $setup = "30min liquidity grab" }
    else                          { $setup = "30min structure pullback" }

    $mgmtPlan = "Stop $stopPct% away. Move to BE at 1R. Take 50% at TP1 ($tp1, +$([math]::Round($stopPct*2,2))%). " +
                "Take 30% at TP2 ($tp2). Trail last 20% at 1.5% crypto / 0.8% stock."

    $invalidation = if ($isBull) {
        "30min close below $stopPrice (recent low broken)"
    } else {
        "30min close above $stopPrice (recent high broken)"
    }

    $result = [ordered]@{
        symbol          = $Symbol
        ticker          = $Symbol
        direction       = $direction
        confidence      = $score
        grade           = $grade
        signal          = $(if ($tradeable) { "TRADE" } else { "NO_TRADE" })
        setup           = $setup
        trend           = "$h4Struct (4H) / $h1Struct (1H) / $m30Struct (30m)"
        price           = $price
        entry           = $price
        stop            = $stopPrice
        stop_lim        = $stopLim
        stop_pct        = $stopPct
        tp1             = $tp1
        tp2             = $tp2
        rr              = $rr
        risk_pct        = $riskPct
        reward_pct      = $rewardPct
        probability     = [math]::Min(80, [math]::Round(38 + $score * 0.42, 0))
        reasons_for     = $for
        reasons_against = $against
        invalidation    = $invalidation
        management      = $mgmtPlan
        m15_rsi         = $m30Rsi
        h1_rsi          = $h1Rsi
        m15_adx         = $m30Adx
        m15_vol_ratio   = [math]::Round($m30VolR, 2)
        candle_pattern  = $candlePat
        at_ob           = $atOB
        at_fvg          = $atFVG
        liq_grab        = $liqGrab
    }

    if (-not $tradeable) {
        $result["reason"] = "Score $score ($grade) - below scalp threshold (80)"
    }

    $result | ConvertTo-Json -Depth 5

} catch {
    @{ signal="NO_TRADE"; reason="ERROR"; symbol=$Symbol; grade="F"; error=$_.Exception.Message } | ConvertTo-Json
}
