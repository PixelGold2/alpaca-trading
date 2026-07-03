# news_analyzer.ps1 - Yahoo Finance RSS sentiment scorer for a given symbol.
# Usage: .\news_analyzer.ps1 -Symbol AAPL
# Returns JSON: { symbol, news_score (-3 to +3), headline_count, top_headlines[] }

param([Parameter(Mandatory)] [string] $Symbol)

$bullWords = @(
    "beat","beats","exceed","exceeds","surge","surged","record","upgrade","outperform",
    "strong","growth","profit","gain","rally","rise","boost","bullish","breakout",
    "momentum","accelerat","positive","above","top","soar","jump","deliver"
)
$bearWords = @(
    "miss","misses","fall","fell","decline","declin","downgrade","underperform","weak",
    "loss","losses","drop","crash","cut","cuts","layoff","lawsuit","fraud","probe",
    "investigation","warn","disappoint","bearish","recall","slowdown","concern","below","halt"
)

$url = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=$Symbol&region=US&lang=en-US"

try {
    $raw   = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 12
    [xml]$rss = $raw.Content
    $items = $rss.rss.channel.item | Select-Object -First 15

    $netScore  = 0.0
    $headlines = @()
    $cutoff    = (Get-Date).AddHours(-72)

    foreach ($item in $items) {
        try { $pub = [DateTime]::Parse($item.pubDate) } catch { continue }
        if ($pub -lt $cutoff) { continue }

        $text  = (($item.title -replace '"','') + " " + ($item.description -replace '"','')).ToLower()
        $bull  = ($bullWords | Where-Object { $text -match $_ }).Count
        $bear  = ($bearWords | Where-Object { $text -match $_ }).Count
        $iScore = [math]::Min($bull * 0.5, 1.5) - [math]::Min($bear * 0.5, 1.5)
        $netScore += $iScore

        $headlines += [ordered]@{
            title = $item.title
            date  = $pub.ToString("yyyy-MM-dd HH:mm")
            score = [math]::Round($iScore, 1)
        }
    }

    $netScore = [math]::Round([math]::Max(-3.0, [math]::Min(3.0, $netScore)), 1)

    @{
        symbol         = $Symbol
        news_score     = $netScore
        headline_count = $headlines.Count
        sentiment      = if ($netScore -ge 1) { "BULLISH" } elseif ($netScore -le -1) { "BEARISH" } else { "NEUTRAL" }
        top_headlines  = $headlines | Select-Object -First 5
    } | ConvertTo-Json -Depth 5

} catch {
    @{ symbol = $Symbol; news_score = 0; sentiment = "NEUTRAL"; error = $_.Exception.Message } | ConvertTo-Json
}
