# Runs the crypto strategy runner once, logging output.
# Invoked periodically by the "CryptoStrategyRunner" Task Scheduler task.
Set-Location "C:\Users\PC\AlpacaTrading\quant"

$logPath = "C:\Users\PC\AlpacaTrading\logs\crypto_strategy.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$output = & ".\.venv\Scripts\python.exe" "crypto_strategy_runner.py"
$exitCode = $LASTEXITCODE

$header = if ($exitCode -eq 0) { "===== $timestamp =====" } else { "===== $timestamp (EXIT CODE $exitCode) =====" }
Add-Content -Path $logPath -Value $header
Add-Content -Path $logPath -Value $output
