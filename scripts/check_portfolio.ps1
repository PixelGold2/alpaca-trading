# Shows account summary and open positions on the Alpaca paper trading account.
#
# Usage:
#   .\check_portfolio.ps1

. "$PSScriptRoot\..\config.ps1"

$headers = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

try {
    $account = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/account" -Method Get -Headers $headers
    Write-Output "=== ACCOUNT ==="
    $account | Select-Object equity, cash, buying_power, portfolio_value, status | Format-List

    $positions = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/positions" -Method Get -Headers $headers
    Write-Output "=== OPEN POSITIONS ==="
    if ($positions.Count -eq 0) {
        Write-Output "(none)"
    } else {
        $positions | Select-Object symbol, qty, avg_entry_price, current_price, unrealized_pl, unrealized_plpc | Format-Table -AutoSize
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Output "Details: $($_.ErrorDetails.Message)" }
}
