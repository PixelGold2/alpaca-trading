# Places a market order on the Alpaca paper trading account and logs it.
#
# Usage:
#   .\place_order.ps1 -Symbol TSLA -Side buy -Qty 1
#   .\place_order.ps1 -Symbol AAPL -Side sell -Qty 1

param(
    [Parameter(Mandatory=$true)][string]$Symbol,
    [Parameter(Mandatory=$true)][ValidateSet("buy","sell")][string]$Side,
    [Parameter(Mandatory=$true)][int]$Qty,
    [string]$TimeInForce = "day"
)

. "$PSScriptRoot\..\config.ps1"

$headers = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
    "Content-Type"        = "application/json"
}

$body = @{
    symbol        = $Symbol
    qty           = $Qty
    side          = $Side
    type          = "market"
    time_in_force = $TimeInForce
} | ConvertTo-Json

try {
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders" -Method Post -Headers $headers -Body $body
    Start-Sleep -Seconds 2
    $order = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/orders/$($order.id)" -Method Get -Headers $headers

    $order | Select-Object id, symbol, side, qty, status, filled_qty, filled_avg_price | Format-List

    $logFile = "$PSScriptRoot\..\logs\trades_log.csv"
    if (-not (Test-Path $logFile)) {
        "timestamp,order_id,symbol,side,qty,status,filled_avg_price" | Out-File -FilePath $logFile -Encoding utf8
    }
    $line = "$(Get-Date -Format o),$($order.id),$($order.symbol),$($order.side),$($order.qty),$($order.status),$($order.filled_avg_price)"
    Add-Content -Path $logFile -Value $line
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Output "Details: $($_.ErrorDetails.Message)" }
}
