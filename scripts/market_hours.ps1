# market_hours.ps1 - Returns US equities market session status.
# IsOpen      = regular session (9:30-16:00 ET)
# IsPreMarket = pre-market (04:00-09:30 ET, weekdays)
# IsExtended  = pre-market OR after-hours (04:00-20:00 ET, weekdays)

. "$PSScriptRoot\..\config.ps1"

$alpacaHeaders = @{
    "APCA-API-KEY-ID"     = $env:APCA_API_KEY_ID
    "APCA-API-SECRET-KEY" = $env:APCA_API_SECRET_KEY
}

try {
    $clock = Invoke-RestMethod -Uri "$($env:APCA_API_BASE_URL)/v2/clock" -Method Get -Headers $alpacaHeaders

    $utcNow   = (Get-Date).ToUniversalTime()
    $etOffset = if ($utcNow.Month -ge 3 -and $utcNow.Month -le 11) { -4 } else { -5 }
    $etNow    = $utcNow.AddHours($etOffset)
    $dow      = $etNow.DayOfWeek
    $isWeekday = $dow -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)
    $etMin    = $etNow.Hour * 60 + $etNow.Minute

    $isOpen      = [bool]$clock.is_open
    $isPreMarket = $isWeekday -and ($etMin -ge 240 -and $etMin -lt 570)   # 04:00-09:30
    $isExtended  = $isWeekday -and ($etMin -ge 240 -and $etMin -lt 1200)  # 04:00-20:00

    [PSCustomObject]@{
        IsOpen       = $isOpen
        IsPreMarket  = $isPreMarket
        IsExtended   = $isExtended
        NextOpen     = $clock.next_open
        NextClose    = $clock.next_close
        CurrentTime  = $clock.timestamp
    }
} catch {
    $utcNow   = (Get-Date).ToUniversalTime()
    $etOffset = if ($utcNow.Month -ge 3 -and $utcNow.Month -le 11) { -4 } else { -5 }
    $etNow    = $utcNow.AddHours($etOffset)
    $dow      = $etNow.DayOfWeek
    $isWeekday = $dow -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)
    $etMin    = $etNow.Hour * 60 + $etNow.Minute

    $isOpen      = $isWeekday -and ($etMin -ge 570  -and $etMin -lt 960)
    $isPreMarket = $isWeekday -and ($etMin -ge 240  -and $etMin -lt 570)
    $isExtended  = $isWeekday -and ($etMin -ge 240  -and $etMin -lt 1200)

    [PSCustomObject]@{ IsOpen=$isOpen; IsPreMarket=$isPreMarket; IsExtended=$isExtended; NextOpen="unknown"; NextClose="unknown"; CurrentTime=$utcNow }
}
