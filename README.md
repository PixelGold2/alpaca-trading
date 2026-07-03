# Alpaca Paper Trading

Folder for testing/executing trades against the Alpaca paper trading API.

- `config.ps1` — API credentials (paper account). Not to be committed or shared.
- `scripts/place_order.ps1` — Place a one-off market order and auto-log it.
- `scripts/check_portfolio.ps1` — Show account equity/cash/buying power and open positions.
- `logs/trades_log.csv` — Running log of every order placed.

---

## Strategy 1 — TSLA Ladder + Trailing Stop

**Script:** `scripts/manage_tsla_strategy.ps1`  
**State:** `logs/tsla_strategy_state.json`  
**Log:** `logs/tsla_strategy_log.csv`

Manages a DCA ladder into TSLA on pullbacks, switching to a trailing stop on +10% profit.

| Rung | Trigger | Qty |
|------|---------|-----|
| 1 | −15% from entry | 10 shares |
| 2 | −25% from entry | 20 shares |
| 3 | −35% from entry | 25 shares |

After all 3 rungs fire → protective stop at −10% from rung-3 price.  
On +10% profit at any time → 5% trailing stop activates.

**Task Scheduler:** Run every 5 minutes during market hours.

---

## Strategy 2 — Congress + News + SMC Pre-Market Scanner

**Script:** `scripts/congress_strategy.ps1`  
**State:** `logs/congress_strategy_state.json`  
**Log:** `logs/congress_strategy_log.csv`

Pre-market scanner that combines three signals to find high-conviction trades:

### Signal Sources

1. **Congressional purchases** (`scripts/congress_watcher.ps1`)  
   Scrapes Capitol Trades for recent stock *purchases* by US Congress members (House + Senate) disclosed in the last 7 days. More members buying the same stock = higher score.

2. **News sentiment** (`scripts/news_analyzer.ps1`)  
   Pulls Yahoo Finance RSS headlines for each flagged ticker. Keyword scoring (bullish/bearish words) produces a sentiment score from −3 to +3.

3. **Technical / SMC** (`scripts/technical_analyzer.ps1`)  
   Uses Alpaca daily bar data to calculate:
   - EMA 9 / 21 / 50 (trend)
   - RSI 14 (momentum, avoids overbought entries >75)
   - MACD 12/26/9 (crossover detection)
   - ATR 14 (volatility-based stop sizing)
   - **SMC:** Swing highs/lows, Break of Structure (BOS), Bullish Order Blocks, Fair Value Gaps (FVG)

### Scoring System

| Component | Range | Notes |
|-----------|-------|-------|
| Congress signal | 0 – 5 | +1.5 per member buying, +1 if >$100K, +1 if >$500K |
| Technical | 0 – 7 | Trend + RSI zone + MACD + SMC levels + volume |
| News sentiment | −3 – +3 | Keyword analysis of last 72h headlines |
| **Total threshold** | **≥ 7.0** | Must also pass R:R and RSI checks |

**Hard disqualifiers** (skip regardless of score):
- RSI > 75 (overbought)
- R:R < 2.0 (risk:reward too low)
- News score ≤ −2.0 (strongly bearish news)

### Order Execution

Uses Alpaca **bracket orders** — stop-loss and take-profit are set atomically at entry:
- **Stop loss:** Below bullish order block or swing low (minimum 1.0× ATR below entry)
- **Take profit:** 3× ATR above entry (ensuring ≥ 3:1 R:R)
- **Position size:** 1% account equity risked per trade
- **Max positions:** 3 concurrent congress-strategy positions

### Position Lifecycle (Dynamic Management)

Each position opened by the congress strategy is managed automatically via `manage_congress_positions.ps1`:

| Trigger | Action |
|---------|--------|
| Price rises +1.5× ATR above entry | Stop moved to **breakeven** (locks in risk-free) |
| Price rises +3× ATR above entry | Fixed stop cancelled, **5% trailing stop** placed — ride the trend |
| Price drops −2× ATR below entry | **DCA Rung 1**: buy 75% more shares at the dip |
| Price drops −3.5× ATR below entry | **DCA Rung 2**: buy 125% more shares; final stop set 10% below |
| Trailing stop triggered | Alpaca exits automatically; state cleaned on next run |

### Task Scheduler Setup

**Entry script** — 3× pre-market:

| Run Time (ET) | Local Time (UTC+3) | Purpose |
|---------------|--------------------|---------|
| 7:00am ET | 2:00pm | Initial scan — fresh disclosures |
| 8:00am ET | 3:00pm | Second scan — updated prices |
| 9:00am ET | 4:00pm | Final check before open |

**Manager script** — every 10 min during market hours (9:30am–4:00pm ET = 4:30pm–11:00pm local):

```powershell
# Run once in PowerShell (Admin) to register all tasks

# Entry scans (3x pre-market)
$entry = "C:\Users\PC\AlpacaTrading\scripts\congress_strategy.ps1"
$entryAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -File `"$entry`""
foreach ($t in @("14:00","15:00","16:00")) {
    $trigger  = New-ScheduledTaskTrigger -Daily -At $t
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
    Register-ScheduledTask -TaskName "AlpacaCongressEntry_$($t -replace ':','')" `
        -Action $entryAction -Trigger $trigger -Settings $settings -RunLevel Highest -Force
}

# Position manager (every 10 min, 4:30pm-11:00pm local = market hours)
$mgr = "C:\Users\PC\AlpacaTrading\scripts\manage_congress_positions.ps1"
$mgrAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -File `"$mgr`""
$mgrTrigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -Once -At "16:30" -RepetitionDuration (New-TimeSpan -Hours 6.5)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable
Register-ScheduledTask -TaskName "AlpacaCongressManager" `
    -Action $mgrAction -Trigger $mgrTrigger -Settings $settings -RunLevel Highest -Force
```

**To test immediately:**
```powershell
cd C:\Users\PC\AlpacaTrading\scripts
.\congress_strategy.ps1 -Force                # entry scan
.\manage_congress_positions.ps1               # run lifecycle check once
```

---

## Manual Usage

```powershell
cd C:\Users\PC\AlpacaTrading\scripts

# One-off orders
.\place_order.ps1 -Symbol TSLA -Side buy -Qty 1
.\place_order.ps1 -Symbol AAPL -Side sell -Qty 1

# Check portfolio
.\check_portfolio.ps1

# Run TSLA strategy manually
.\manage_tsla_strategy.ps1

# Run congress strategy manually (with time-check bypass)
.\congress_strategy.ps1 -Force

# Test individual components
.\congress_watcher.ps1 -DaysBack 7 | ConvertFrom-Json | Format-Table
.\technical_analyzer.ps1 -Symbol AAPL | ConvertFrom-Json
.\news_analyzer.ps1 -Symbol NVDA | ConvertFrom-Json
```
