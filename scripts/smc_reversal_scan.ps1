# smc_reversal_scan.ps1 - Deep SMC bullish reversal scanner
# Signals: Order Blocks, FVG, Liquidity Sweep, CHoCH, Demand Zones,
#          Premium/Discount, RSI Divergence, Equal Lows, MACD, BOS, Volume

. "$PSScriptRoot\..\config.ps1"

$hdr = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

$symbols = @(
    "AAPL","MSFT","GOOGL","AMZN","META","NVDA","AMD","AVGO","QCOM","MU",
    "CRM","ORCL","NOW","ADBE","PANW","JPM","V","MA","BAC","GS",
    "UNH","LLY","ABBV","JNJ","MRK","COST","WMT","HD","NKE","AMGN",
    "XOM","CVX","CAT","HON","DE","TSLA","GM","PYPL","SHOP","PLTR",
    "COIN","SNOW","DDOG","CRWD","NET","ARM","AXON","APP","SMCI","MSTR"
)

function Get-DailyBars($sym) {
    $start = (Get-Date).AddDays(-120).ToUniversalTime().ToString("yyyy-MM-ddT00:00:00Z")
    $url = "https://data.alpaca.markets/v2/stocks/$sym/bars?timeframe=1Day&start=$start&limit=120&feed=iex&adjustment=raw"
    try {
        $r = Invoke-RestMethod -Uri $url -Method Get -Headers $hdr -TimeoutSec 12
        return $r.bars
    } catch { return $null }
}

function Calc-EMA($arr, $period) {
    if ($arr.Count -lt $period) { return @() }
    $mult = 2.0 / ($period + 1)
    $init = ($arr[0..($period-1)] | Measure-Object -Sum).Sum / $period
    $ema = @($init)
    for ($i = $period; $i -lt $arr.Count; $i++) {
        $ema += $arr[$i] * $mult + $ema[-1] * (1 - $mult)
    }
    return $ema
}

function Calc-RSI-Series($closes, $period) {
    if ($closes.Count -lt $period + 2) { return @() }
    $gains = @(); $losses = @()
    for ($i = 1; $i -lt $closes.Count; $i++) {
        $d = $closes[$i] - $closes[$i-1]
        if ($d -gt 0) { $gains += $d; $losses += 0.0 }
        else          { $gains += 0.0; $losses += [math]::Abs($d) }
    }
    $ag = ($gains[0..($period-1)]  | Measure-Object -Sum).Sum / $period
    $al = ($losses[0..($period-1)] | Measure-Object -Sum).Sum / $period
    $out = @()
    for ($i = $period; $i -lt $gains.Count; $i++) {
        $ag = ($ag * ($period-1) + $gains[$i])  / $period
        $al = ($al * ($period-1) + $losses[$i]) / $period
        if ($al -eq 0) { $out += 100.0 } else { $out += 100.0 - (100.0 / (1 + $ag/$al)) }
    }
    return $out
}

function Calc-ATR($bars, $period) {
    if ($bars.Count -lt $period + 2) { return 1.0 }
    $trs = @()
    for ($i = 1; $i -lt $bars.Count; $i++) {
        $a = [double]$bars[$i].h - [double]$bars[$i].l
        $b = [math]::Abs([double]$bars[$i].h - [double]$bars[$i-1].c)
        $c = [math]::Abs([double]$bars[$i].l - [double]$bars[$i-1].c)
        $trs += [math]::Max($a, [math]::Max($b, $c))
    }
    $atr = ($trs[0..($period-1)] | Measure-Object -Sum).Sum / $period
    for ($i = $period; $i -lt $trs.Count; $i++) { $atr = ($atr * ($period-1) + $trs[$i]) / $period }
    return $atr
}

function Calc-MACD($closes) {
    if ($closes.Count -lt 35) { return $null }
    $e12 = Calc-EMA $closes 12
    $e26 = Calc-EMA $closes 26
    $ml = @()
    for ($i = 0; $i -lt $e26.Count; $i++) { $ml += $e12[$i+14] - $e26[$i] }
    $sig = Calc-EMA $ml 9
    $off = $ml.Count - $sig.Count
    $hc = $ml[$off + $sig.Count - 1] - $sig[-1]
    $hp = $ml[$off + $sig.Count - 2] - $sig[-2]
    return @{ hist=$hc; prev=$hp; cross=($hc -gt 0 -and $hp -le 0); positive=($hc -gt 0) }
}

function Get-SwingLows($bars, $lb) {
    $out = @()
    for ($i = $lb; $i -lt $bars.Count - $lb; $i++) {
        $ok = $true
        $lp = [double]$bars[$i].l
        for ($j = $i - $lb; $j -le $i + $lb; $j++) {
            if ($j -ne $i -and [double]$bars[$j].l -le $lp) { $ok = $false; break }
        }
        if ($ok) { $out += @{ idx=$i; price=$lp } }
    }
    return $out
}

function Get-SwingHighs($bars, $lb) {
    $out = @()
    for ($i = $lb; $i -lt $bars.Count - $lb; $i++) {
        $ok = $true
        $hp = [double]$bars[$i].h
        for ($j = $i - $lb; $j -le $i + $lb; $j++) {
            if ($j -ne $i -and [double]$bars[$j].h -ge $hp) { $ok = $false; break }
        }
        if ($ok) { $out += @{ idx=$i; price=$hp } }
    }
    return $out
}

function Find-BullishOB($bars, $swingHighs) {
    if ($swingHighs.Count -eq 0) { return $null }
    foreach ($sh in ($swingHighs | Sort-Object idx -Descending)) {
        for ($i = $sh.idx - 1; $i -ge [math]::Max(0, $sh.idx - 12); $i--) {
            if ([double]$bars[$i].c -lt [double]$bars[$i].o) {
                return @{ low=[double]$bars[$i].l; high=[double]$bars[$i].h; idx=$i }
            }
        }
    }
    return $null
}

function Find-BullishFVGs($bars, $lookback) {
    $fvgs = @()
    $s = [math]::Max(2, $bars.Count - $lookback)
    for ($i = $s; $i -lt $bars.Count; $i++) {
        if ([double]$bars[$i-2].h -lt [double]$bars[$i].l) {
            $fvgs += @{ low=[double]$bars[$i-2].h; high=[double]$bars[$i].l }
        }
    }
    return $fvgs
}

function Find-LiquiditySweep($bars, $swingLows, $lookback) {
    $n = $bars.Count
    $candidates = $swingLows | Where-Object { $_.idx -ge ($n - $lookback - 6) -and $_.idx -le ($n - 2) }
    foreach ($sl in ($candidates | Sort-Object idx -Descending)) {
        for ($i = $sl.idx + 1; $i -lt $n; $i++) {
            if ([double]$bars[$i].l -lt $sl.price -and [double]$bars[$i].c -gt $sl.price) {
                return @{ found=$true; level=$sl.price }
            }
        }
    }
    return @{ found=$false }
}

function Find-CHoCH($bars, $swingHighs, $closes, $ema21s) {
    $n = $bars.Count
    if ($swingHighs.Count -lt 2 -or $ema21s.Count -lt 20) { return @{ found=$false } }
    $curPrice = $closes[-1]
    $belowCt = 0
    $startC = $closes.Count - 20
    $startE = $ema21s.Count - 20
    for ($k = 0; $k -lt 20; $k++) {
        $ci = $k + $startC; $ei = $k + $startE
        if ($ci -ge 0 -and $ci -lt $closes.Count -and $ei -ge 0 -and $ei -lt $ema21s.Count) {
            if ($closes[$ci] -lt $ema21s[$ei]) { $belowCt++ }
        }
    }
    if ($belowCt -lt 10) { return @{ found=$false } }
    $recentSHs = $swingHighs | Where-Object { $_.idx -ge ($n-30) -and $_.idx -le ($n-2) }
    foreach ($sh in ($recentSHs | Sort-Object idx -Descending)) {
        if ($curPrice -gt $sh.price) {
            return @{ found=$true; level=[math]::Round($sh.price,2) }
        }
    }
    return @{ found=$false }
}

function Find-DemandZone($bars, $atr) {
    $n = $bars.Count
    $curP = [double]$bars[-1].c
    for ($i = [math]::Max(2, $n-30); $i -lt $n-2; $i++) {
        $body = [math]::Abs([double]$bars[$i].c - [double]$bars[$i].o)
        if ([double]$bars[$i].c -gt [double]$bars[$i].o -and $body -gt $atr * 1.1) {
            $dzHigh = [double]$bars[$i].o + $atr * 0.15
            $dzLow  = [double]$bars[$i].l
            if ($curP -ge $dzLow * 0.997 -and $curP -le $dzHigh * 1.003) {
                return @{ found=$true; low=$dzLow; high=[math]::Round($dzHigh,2) }
            }
        }
    }
    return @{ found=$false }
}

function Get-PD($bars, $lookback) {
    $recent = $bars | Select-Object -Last $lookback
    $hi = ($recent | ForEach-Object { [double]$_.h } | Measure-Object -Maximum).Maximum
    $lo = ($recent | ForEach-Object { [double]$_.l } | Measure-Object -Minimum).Minimum
    $cp = [double]$bars[-1].c
    $rng = $hi - $lo
    if ($rng -le 0) { return 50.0 }
    return [math]::Round(($cp - $lo) / $rng * 100, 1)
}

function Find-EqualLows($swingLows, $atr) {
    if ($swingLows.Count -lt 2) { return $false }
    $recent = $swingLows | Sort-Object idx -Descending | Select-Object -First 4
    for ($i = 0; $i -lt $recent.Count - 1; $i++) {
        for ($j = $i + 1; $j -lt $recent.Count; $j++) {
            if ([math]::Abs($recent[$i].price - $recent[$j].price) -lt $atr * 0.3) { return $true }
        }
    }
    return $false
}

function Find-RSIDiv($bars, $rsiSeries, $swingLows) {
    if ($swingLows.Count -lt 2 -or $rsiSeries.Count -lt 20) { return $false }
    $offset  = $bars.Count - $rsiSeries.Count - 1
    $recents = $swingLows | Sort-Object idx -Descending | Select-Object -First 3
    for ($a = 0; $a -lt $recents.Count - 1; $a++) {
        for ($b = $a + 1; $b -lt $recents.Count; $b++) {
            $newer = $recents[$a]; $older = $recents[$b]
            $ri2 = $newer.idx - $offset - 1
            $ri1 = $older.idx - $offset - 1
            if ($ri2 -lt 0 -or $ri1 -lt 0) { continue }
            if ($ri2 -ge $rsiSeries.Count -or $ri1 -ge $rsiSeries.Count) { continue }
            if ($newer.price -lt $older.price -and $rsiSeries[$ri2] -gt $rsiSeries[$ri1] + 1.5) {
                return $true
            }
        }
    }
    return $false
}

# MAIN SCAN
$results = @()
Write-Host ""
Write-Host "  SMC Reversal Scan | $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Daily bars" -ForegroundColor Cyan
Write-Host "  Scanning $($symbols.Count) symbols..." -ForegroundColor DarkGray
Write-Host ""
Write-Host -NoNewline "  "

foreach ($sym in $symbols) {
    Write-Host -NoNewline "$sym "
    $bars = Get-DailyBars $sym
    if (-not $bars -or $bars.Count -lt 35) { continue }

    $closes  = $bars | ForEach-Object { [double]$_.c }
    $vols    = $bars | ForEach-Object { [double]$_.v }
    $curP    = $closes[-1]
    $curBar  = $bars[-1]

    $ema9s  = Calc-EMA $closes 9
    $ema21s = Calc-EMA $closes 21
    $ema50s = if ($closes.Count -ge 52) { Calc-EMA $closes 50 } else { @(0) * $closes.Count }
    $ema9   = $ema9s[-1]
    $ema21  = $ema21s[-1]
    $ema50  = $ema50s[-1]
    $atr    = Calc-ATR $bars 14
    $rsiSer = Calc-RSI-Series $closes 14
    $curRSI = if ($rsiSer.Count -gt 0) { $rsiSer[-1] } else { 50.0 }
    $macd   = Calc-MACD $closes

    $avgVol   = if ($vols.Count -ge 11) { ($vols[-11..-2] | Measure-Object -Sum).Sum / 10 } else { $vols[-1] }
    $volRatio = if ($avgVol -gt 0) { [double]$curBar.v / $avgVol } else { 1.0 }

    $swingLos = Get-SwingLows  $bars 3
    $swingHis = Get-SwingHighs $bars 3

    $ob    = Find-BullishOB       $bars $swingHis
    $fvgs  = Find-BullishFVGs     $bars 35
    $sweep = Find-LiquiditySweep  $bars $swingLos 12
    $choch = Find-CHoCH           $bars $swingHis $closes $ema21s
    $dz    = Find-DemandZone      $bars $atr
    $pdPct = Get-PD               $bars 20
    $eqLow = Find-EqualLows       $swingLos $atr
    $rDiv  = Find-RSIDiv          $bars $rsiSer $swingLos

    $inOB   = $ob -and ($curP -ge $ob.low) -and ($curP -le $ob.high * 1.004)
    $nearOB = $ob -and ($curP -ge $ob.low - $atr*0.4) -and ($curP -le $ob.high + $atr*0.5) -and (-not $inOB)
    $inFVG  = ($fvgs | Where-Object { $curP -ge $_.low -and $curP -le $_.high }).Count -gt 0
    $bos    = ($swingHis.Count -ge 2) -and ($curP -gt $swingHis[-2].price)

    $score = 0.0; $sigs = @()

    if ($sweep.found)         { $score += 3.5; $sigs += "Liq-Sweep" }
    if ($choch.found)         { $score += 3.0; $sigs += "CHoCH" }
    if ($inOB)                { $score += 3.0; $sigs += "In-OB" }
    if ($dz.found)            { $score += 2.5; $sigs += "Demand-Zone" }
    if ($inFVG)               { $score += 2.0; $sigs += "In-FVG" }
    if ($rDiv)                { $score += 2.0; $sigs += "RSI-Div" }
    if ($eqLow)               { $score += 1.5; $sigs += "Equal-Lows" }
    if ($nearOB)              { $score += 1.0; $sigs += "Near-OB" }
    if ($bos)                 { $score += 1.0; $sigs += "BOS" }

    if ($macd -and $macd.cross)    { $score += 2.0; $sigs += "MACD-Cross" }
    elseif ($macd -and $macd.positive) { $score += 0.5; $sigs += "MACD+" }

    if    ($curRSI -ge 25 -and $curRSI -lt 38) { $score += 2.5; $sigs += "RSI-$([math]::Round($curRSI,0))(OS)" }
    elseif ($curRSI -ge 38 -and $curRSI -lt 48) { $score += 1.5; $sigs += "RSI-$([math]::Round($curRSI,0))(low)" }
    elseif ($curRSI -ge 48 -and $curRSI -lt 56) { $score += 0.5; $sigs += "RSI-$([math]::Round($curRSI,0))" }

    if    ($pdPct -lt 35) { $score += 1.0; $sigs += "DeepDiscount($($pdPct)%)" }
    elseif ($pdPct -lt 50) { $score += 0.5; $sigs += "Discount($($pdPct)%)" }

    if ($volRatio -gt 1.5 -and ($inOB -or $inFVG -or $sweep.found)) {
        $score += 1.0; $sigs += "Vol-$([math]::Round($volRatio,1))x"
    }

    if    ($curP -gt $ema21)                      { $emaCtx = "P>EMA21" }
    elseif ($curP -gt $ema50 -and $ema50 -gt 0)   { $emaCtx = "P>EMA50" }
    else                                           { $emaCtx = "BelowEMAs" }

    if    ($score -ge 10.0) { $rating = "PRIME"  }
    elseif ($score -ge  7.5) { $rating = "STRONG" }
    elseif ($score -ge  5.0) { $rating = "GOOD"   }
    elseif ($score -ge  3.0) { $rating = "WATCH"  }
    else                     { $rating = "skip"   }

    if ($rating -ne "skip") {
        $results += [PSCustomObject]@{
            Sym    = $sym
            Score  = [math]::Round($score, 1)
            Rating = $rating
            Price  = [math]::Round($curP, 2)
            RSI    = [math]::Round($curRSI, 1)
            PD_pct = $pdPct
            EMA    = $emaCtx
            Signals = ($sigs -join " | ")
        }
    }
}

Write-Host ""
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  SMC BULLISH REVERSAL SCAN  |  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Cyan

$byRating = $results | Sort-Object Score -Descending

$prime  = $byRating | Where-Object { $_.Rating -eq "PRIME"  }
$strong = $byRating | Where-Object { $_.Rating -eq "STRONG" }
$good   = $byRating | Where-Object { $_.Rating -eq "GOOD"   }
$watch  = $byRating | Where-Object { $_.Rating -eq "WATCH"  }

if ($prime.Count -gt 0) {
    Write-Host ""
    Write-Host "  [PRIME] Score >= 10 -- maximum SMC confluence" -ForegroundColor Magenta
    $prime | Format-Table Sym,Score,Price,RSI,PD_pct,EMA,Signals -AutoSize -Wrap
}
if ($strong.Count -gt 0) {
    Write-Host "  [STRONG] Score 7.5-9.9" -ForegroundColor Green
    $strong | Format-Table Sym,Score,Price,RSI,PD_pct,EMA,Signals -AutoSize -Wrap
}
if ($good.Count -gt 0) {
    Write-Host "  [GOOD] Score 5.0-7.4" -ForegroundColor Yellow
    $good | Format-Table Sym,Score,Price,RSI,PD_pct,EMA,Signals -AutoSize -Wrap
}
if ($watch.Count -gt 0) {
    Write-Host "  [WATCH] Score 3.0-4.9" -ForegroundColor DarkYellow
    $watch | Format-Table Sym,Score,Price,RSI,PD_pct,EMA,Signals -AutoSize -Wrap
}

Write-Host ""
Write-Host "  Scanned: $($symbols.Count)  |  Qualified: $($results.Count)" -ForegroundColor DarkGray
Write-Host ""
