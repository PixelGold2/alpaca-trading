# congress_watcher.ps1 - Fetches recent stock PURCHASES by Congress members.
# Source: Capitol Trades (extracts Next.js hydration data; falls back to HTML regex).
# Output: JSON array [{ ticker, politician, party, tx_date, disclose_date, amount_low, amount_high, chamber }]

param([int]$DaysBack = 7)

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

function Fetch-Page($pageUrl) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $session.UserAgent = $ua
    $session.Headers.Add("Accept",          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    $session.Headers.Add("Accept-Language", "en-US,en;q=0.9")
    $session.Headers.Add("Cache-Control",   "no-cache")

    $delays = @(2, 8, 20)   # retry delays in seconds for 429 / transient errors
    foreach ($delay in $delays) {
        Start-Sleep -Seconds $delay
        try {
            return Invoke-WebRequest -Uri $pageUrl -WebSession $session -UseBasicParsing -TimeoutSec 30
        } catch {
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq 429) {
                Write-Warning "congress_watcher: 429 rate-limit on $pageUrl. Waiting $delay s then retrying..."
                continue
            }
            throw   # rethrow non-429 errors
        }
    }
    throw "congress_watcher: All retries exhausted for $pageUrl"
}

function Parse-NextData($html) {
    if ($html -notmatch '(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>') { return $null }
    try {
        $nd = $matches[1] | ConvertFrom-Json
        $paths = @(
            { $nd.props.pageProps.trades },
            { $nd.props.pageProps.data.trades },
            { $nd.props.pageProps.initialData.trades },
            { $nd.props.pageProps.tradeData.trades },
            { $nd.props.pageProps.results }
        )
        foreach ($p in $paths) {
            try { $r = & $p; if ($r) { return $r } } catch {}
        }
    } catch {}
    return $null
}

function Parse-TradesFromData($rawTrades, $cutoff) {
    $out = @()
    foreach ($t in $rawTrades) {
        # Get transaction type - skip if not a purchase
        $txType = ""
        try { $txType = "$($t.txType)" } catch {}
        if (-not $txType) { try { $txType = "$($t.transactionType)" } catch {} }
        if ($txType -notmatch "(?i)purchase|buy") { continue }

        # Get ticker symbol
        $ticker = ""
        try { $ticker = "$($t.asset.assetTicker)" } catch {}
        if (-not $ticker) { try { $ticker = "$($t.ticker)" } catch {} }
        if (-not $ticker) { try { $ticker = "$($t.symbol)" } catch {} }
        $ticker = $ticker.Trim().ToUpper()
        if (-not $ticker -or $ticker -eq "N/A" -or $ticker.Length -gt 6) { continue }

        # Get transaction date
        $txDate = $null
        foreach ($field in @("transactionDate", "txDate", "date", "tradeDate")) {
            try { $txDate = [DateTime]::Parse($t.$field); break } catch {}
        }
        if (-not $txDate -or $txDate -lt $cutoff) { continue }

        # Get politician name
        $fn = ""; $ln = ""
        try { $fn = "$($t.politician.firstName)" } catch {}
        try { $ln = "$($t.politician.lastName)"  } catch {}
        $polName = if ($fn -or $ln) { "$fn $ln".Trim() } else {
            $n = ""; try { $n = "$($t.politician)" } catch {}
            if ($n) { $n } else { "Unknown" }
        }

        # Get amount range
        $amtLow  = 0; $amtHigh = 0
        try { $amtLow  = [int]$t.amount.rangeLow  } catch {}
        try { $amtHigh = [int]$t.amount.rangeHigh } catch {}

        # Get party, chamber, disclose date
        $party    = ""; try { $party    = "$($t.politician.party)"   } catch {}
        $chamber  = ""; try { $chamber  = "$($t.politician.chamber)" } catch {}
        $disclose = ""; try { $disclose = "$($t.filingDate)"         } catch {}

        $rec = [ordered]@{
            ticker        = $ticker
            politician    = $polName
            party         = $party
            chamber       = $chamber
            tx_date       = $txDate.ToString("yyyy-MM-dd")
            disclose_date = $disclose
            amount_low    = $amtLow
            amount_high   = $amtHigh
        }
        $out += $rec
    }
    return $out
}

# ---- MAIN -------------------------------------------------------------------

$cutoff    = (Get-Date).AddDays(-$DaysBack)
$allTrades = @()

for ($page = 1; $page -le 3; $page++) {
    $url  = "https://www.capitoltrades.com/trades?assetType=stock&txType=purchase&page=$page"
    $resp = $null
    try {
        $resp = Fetch-Page $url
    } catch {
        Write-Warning "congress_watcher: Failed to fetch page $page - $($_.Exception.Message)"
        break
    }

    $html = $resp.Content

    # Method 1: Try the JSON API endpoint (reuses cookies from page load)
    if ($page -eq 1) {
        try {
            $apiUrl  = "https://www.capitoltrades.com/api/trades?page=1&pageSize=50&assetType=stock&txType=purchase"
            $apiResp = Invoke-RestMethod -Uri $apiUrl -Headers @{
                "User-Agent"  = $ua
                "Accept"      = "application/json"
                "Referer"     = "https://www.capitoltrades.com/trades"
            } -TimeoutSec 20
            $items = $null
            if ($apiResp.data)   { $items = $apiResp.data }
            elseif ($apiResp.trades) { $items = $apiResp.trades }
            else                 { $items = $apiResp }
            if ($items) {
                $parsed = Parse-TradesFromData $items $cutoff
                if ($parsed.Count -gt 0) {
                    $allTrades += $parsed
                    break   # API worked - no need to scrape HTML
                }
            }
        } catch {}
    }

    # Method 2: Extract Next.js hydration data embedded in the HTML
    $nextTrades = Parse-NextData $html
    if ($nextTrades) {
        $parsed = Parse-TradesFromData $nextTrades $cutoff
        $allTrades += $parsed
        if ($parsed.Count -eq 0) { break }   # No recent items on this page - stop paginating
        continue
    }

    # Method 3: HTML regex fallback - look for ticker symbols in data attributes
    $rowPattern = '(?is)<tr[^>]*>(.*?)</tr>'
    $rowMatches = [regex]::Matches($html, $rowPattern)
    foreach ($m in $rowMatches) {
        $row    = $m.Groups[1].Value
        $ticker = $null
        if ($row -match '(?i)data-ticker="([A-Z]{1,6})"') { $ticker = $matches[1] }
        elseif ($row -match '(?i)class="[^"]*ticker[^"]*"[^>]*>\s*([A-Z]{1,6})\s*<') { $ticker = $matches[1] }
        if (-not $ticker) { continue }

        $rec = [ordered]@{
            ticker        = $ticker.ToUpper()
            politician    = "Unknown (HTML fallback)"
            party         = ""
            chamber       = ""
            tx_date       = (Get-Date).ToString("yyyy-MM-dd")
            disclose_date = ""
            amount_low    = 0
            amount_high   = 0
        }
        $allTrades += $rec
    }

    if ($allTrades.Count -eq 0 -and $page -eq 1) {
        Write-Warning "congress_watcher: Could not extract trade data from Capitol Trades."
        break
    }
}

# Deduplicate by ticker + politician + tx_date
$seen   = @{}
$unique = @()
foreach ($t in $allTrades) {
    $key = "$($t.ticker)|$($t.politician)|$($t.tx_date)"
    if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $unique    += $t
    }
}

# Filter to clean ticker symbols only
$unique = @($unique | Where-Object { $_.ticker -match '^[A-Z]{1,5}$' })

if ($unique.Count -gt 0) {
    $unique | ConvertTo-Json -Depth 5
} else {
    "[]"
}
