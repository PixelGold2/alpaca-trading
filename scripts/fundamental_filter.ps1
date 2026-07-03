# fundamental_filter.ps1 - Fetches P/E ratio and fundamentals by scraping Yahoo Finance quote page.
# Usage: .\fundamental_filter.ps1 -Symbol AAPL
# Returns JSON: { symbol, pe, forward_pe, pe_score (0-2), pe_label, market_cap, skip, skip_reason }

param([Parameter(Mandatory)] [string] $Symbol)

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

function Get-FieldValue($html, $field) {
    # <fin-streamer data-value="37.32" ... data-field="trailingPE" ...>
    if ($html -match "data-value=""([^""]+)""[^>]*data-field=""$field""") { return $matches[1] }
    # alternate attribute order: data-field first
    if ($html -match "data-field=""$field""[^>]*data-value=""([^""]+)""") { return $matches[1] }
    return $null
}

try {
    $html = (Invoke-WebRequest "https://finance.yahoo.com/quote/$Symbol/" `
        -Headers @{ "User-Agent" = $ua; "Accept-Language" = "en-US,en;q=0.9" } `
        -UseBasicParsing -TimeoutSec 18).Content

    $peRaw     = Get-FieldValue $html "trailingPE"
    $fwdPeRaw  = Get-FieldValue $html "forwardPE"
    $mktCapRaw = Get-FieldValue $html "marketCap"
    $epsRaw    = Get-FieldValue $html "epsTrailingTwelveMonths"

    $pe     = if ($peRaw)     { try { [double]$peRaw }     catch { $null } } else { $null }
    $fwdPE  = if ($fwdPeRaw)  { try { [double]$fwdPeRaw }  catch { $null } } else { $null }
    $mktCap = if ($mktCapRaw) { try { [double]$mktCapRaw } catch { $null } } else { $null }
    $eps    = if ($epsRaw)    { try { [double]$epsRaw }    catch { $null } } else { $null }

    # Which P/E to use for scoring
    $usePE   = $pe
    $peLabel = if ($pe -ne $null)   { "TTM:$([math]::Round($pe,1))" } `
               elseif ($fwdPE -ne $null) { "fwd:$([math]::Round($fwdPE,1))" } `
               else { "N/A" }
    if ($pe -eq $null -and $fwdPE -ne $null -and $fwdPE -gt 0) { $usePE = $fwdPE }

    # P/E score (0-2 points)
    $peScore = 0.0
    if ($usePE -ne $null -and $usePE -gt 0) {
        if     ($usePE -ge 10 -and $usePE -le 25) { $peScore = 2.0 }   # ideal value zone
        elseif ($usePE -gt  25 -and $usePE -le 35) { $peScore = 1.5 }  # growth at fair price
        elseif ($usePE -gt  35 -and $usePE -le 50) { $peScore = 0.5 }  # elevated, proceed with care
        elseif ($usePE -gt  50)                    { $peScore = 0.0 }  # expensive - no bonus
        elseif ($usePE -lt  10 -and $usePE -gt 0) { $peScore = 0.5 }  # cheap - might be value trap
    }

    # Negative TTM P/E but good forward P/E -> company turning profitable
    if ($pe -ne $null -and $pe -lt 0 -and $fwdPE -ne $null -and $fwdPE -gt 0 -and $fwdPE -le 35) {
        $peScore = 0.5
        $peLabel = "neg-ttm/fwd:$([math]::Round($fwdPE,1))"
    }

    # Hard skip: losing money with no recovery signal
    $skip       = $false
    $skipReason = ""
    if ($pe -ne $null -and $pe -lt 0) {
        if ($fwdPE -eq $null -or $fwdPE -lt 0 -or $fwdPE -gt 60) {
            $skip       = $true
            $skipReason = "Negative TTM P/E ($([math]::Round($pe,1))) with no near-term profitability signal"
        }
    }
    if (-not $skip -and $pe -ne $null -and $pe -gt 150 -and ($fwdPE -eq $null -or $fwdPE -gt 70)) {
        $skip       = $true
        $skipReason = "P/E $([math]::Round($pe,1)) extremely overvalued with no reasonable fwd P/E"
    }

    $capLabel = if ($mktCap -ne $null) { "$([math]::Round($mktCap/1e9,1))B" } else { "N/A" }

    @{
        symbol      = $Symbol
        pe          = if ($pe    -ne $null) { [math]::Round($pe,    1) } else { $null }
        forward_pe  = if ($fwdPE -ne $null) { [math]::Round($fwdPE, 1) } else { $null }
        pe_score    = [math]::Round($peScore, 1)
        pe_label    = $peLabel
        market_cap  = $mktCap
        cap_label   = $capLabel
        eps         = if ($eps -ne $null) { [math]::Round($eps, 2) } else { $null }
        skip        = $skip
        skip_reason = $skipReason
    } | ConvertTo-Json

} catch {
    @{ symbol = $Symbol; pe = $null; pe_score = 0.0; skip = $false; pe_label = "ERR"; error = $_.Exception.Message } | ConvertTo-Json
}
