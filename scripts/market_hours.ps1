# market_hours.ps1 - Returns whether US equities market is currently open.
# Accounts for pre/after hours and weekends. No holidays (paper trading, Alpaca handles rejects).
# Usage: $open = (& "$PSScriptRoot\market_hours.ps1").IsOpen

. "$PSScriptRoot\..\config.ps1"

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

try {
    $clock = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/clock" -Method Get -Headers $alpacaHeaders
    [PSCustomObject]@{
        IsOpen       = [bool]$clock.is_open
        NextOpen     = $clock.next_open
        NextClose    = $clock.next_close
        CurrentTime  = $clock.timestamp
    }
} catch {
    # Fallback: derive from UTC time (ET = UTC-5 standard, UTC-4 daylight)
    $utcNow  = (Get-Date).ToUniversalTime()
    $dow     = $utcNow.DayOfWeek
    $etOffset = if ($utcNow.Month -ge 3 -and $utcNow.Month -le 11) { -4 } else { -5 }
    $etNow   = $utcNow.AddHours($etOffset)
    $isWeekday = $dow -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)
    $etMinutes = $etNow.Hour * 60 + $etNow.Minute
    $isOpen  = $isWeekday -and $etMinutes -ge 570 -and $etMinutes -lt 960  # 9:30-16:00
    [PSCustomObject]@{ IsOpen=$isOpen; NextOpen="unknown"; NextClose="unknown"; CurrentTime=$utcNow }
}

