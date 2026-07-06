@echo off
REM start_tv_trading.bat — Launch TradingView with CDP + 1-min position loop
REM Double-click this to start 1-min trading session

echo === STARTING 1-MIN TV TRADING SESSION ===

REM Kill existing TradingView
taskkill /F /IM TradingView.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Launch TradingView (Windows Store MSIX location)
set "TV_EXE=C:\Program Files\WindowsApps\TradingView.Desktop_3.3.0.7992_x64__n534cwy3pjxzj\TradingView.exe"
if not exist "%TV_EXE%" (
    echo ERROR: TradingView not found at expected path.
    echo Update TV_EXE in this script with the correct path.
    pause
    exit /b 1
)

echo Starting TradingView with CDP on port 9222...
start "" "%TV_EXE%" --remote-debugging-port=9222

echo Waiting for TradingView to load...
timeout /t 8 /nobreak >nul

REM Check CDP is up
:check
curl -s http://localhost:9222/json/version >nul 2>&1
if %errorlevel% neq 0 (
    echo Still waiting...
    timeout /t 3 /nobreak >nul
    goto check
)
echo TradingView CDP ready!
echo.

REM Start position loop in a separate window
echo Starting 1-min position manager loop...
start "1min Position Loop" powershell.exe -NonInteractive -File "C:\Users\PC\AlpacaTrading\scripts\tv_1min_loop.ps1"

echo.
echo === READY ===
echo TradingView: running with CDP on port 9222
echo Position loop: running in background window
echo Now open Claude Code and start scanning!
echo.
pause
