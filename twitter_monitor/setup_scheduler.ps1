# Run this once to set up automatic monitoring every 5 minutes
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorScript = Join-Path $scriptDir "monitor.py"
$pythonPath = (Get-Command python).Source -replace 'python\.exe$', 'pythonw.exe'

$action = New-ScheduledTaskAction `
    -Execute $pythonPath `
    -Argument $monitorScript `
    -WorkingDirectory $scriptDir

$triggerRepeat = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
$triggerStartup = New-ScheduledTaskTrigger -AtLogOn
$trigger = @($triggerStartup, $triggerRepeat)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName "XAccountMonitor" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Force

Write-Host "Done! XAccountMonitor task created. It will run every 5 minutes." -ForegroundColor Green
Write-Host "To stop it: Unregister-ScheduledTask -TaskName XAccountMonitor -Confirm:`$false" -ForegroundColor Yellow
