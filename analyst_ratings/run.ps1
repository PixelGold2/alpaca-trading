# Analyst Ratings Discord Bot — launcher
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

if (-not (Test-Path ".env")) {
    Write-Error "Missing .env file. Copy .env.example to .env and fill in your keys."
    exit 1
}

# Install deps if needed
pip install -r requirements.txt --quiet

Write-Host "Starting Analyst Ratings Bot..." -ForegroundColor Cyan
python monitor.py
