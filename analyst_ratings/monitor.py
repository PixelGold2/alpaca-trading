import hashlib
import json
import os
import re
import time
from datetime import datetime, date, timezone

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

DISCORD_WEBHOOK_URL = os.environ['DISCORD_WEBHOOK_URL']
MARKETBEAT_URL = "https://www.marketbeat.com/ratings/"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.google.com/',
    'Connection': 'keep-alive',
}

STATE_FILE = os.path.join(os.path.dirname(__file__), 'state.json')
POLL_INTERVAL_SECONDS = 7200
MARKET_OPEN_HOUR_UTC = 11
MARKET_CLOSE_HOUR_UTC = 22

GRADE_COLORS = {
    'buy': 0x00C853, 'strong buy': 0x00C853, 'outperform': 0x43A047,
    'overweight': 0x43A047, 'positive': 0x43A047, 'accumulate': 0x66BB6A,
    'market outperform': 0x43A047, 'sector outperform': 0x43A047,
    'sell': 0xE53935, 'strong sell': 0xE53935, 'underperform': 0xE53935,
    'underweight': 0xE53935, 'negative': 0xE53935, 'reduce': 0xEF5350,
    'market underperform': 0xE53935,
    'hold': 0xFB8C00, 'neutral': 0xFB8C00, 'equal weight': 0xFB8C00,
    'market perform': 0xFB8C00, 'peer perform': 0xFB8C00,
    'sector perform': 0xFB8C00, 'sector weight': 0xFB8C00,
}


def rating_color(action: str, new_grade: str) -> int:
    a = action.lower()
    if 'upgraded' in a or 'upgrade' in a:
        return 0x00C853
    if 'downgraded' in a or 'downgrade' in a:
        return 0xE53935
    return GRADE_COLORS.get(new_grade.lower(), 0x7289DA)


def action_emoji(action: str) -> str:
    a = action.lower()
    if 'upgraded' in a:   return '⬆️'
    if 'downgraded' in a: return '⬇️'
    if 'initiated' in a:  return '🆕'
    if 'resumed' in a:    return '▶️'
    if 'reiterated' in a: return '🔁'
    if 'raised' in a:     return '🎯⬆'
    if 'lowered' in a:    return '🎯⬇'
    return '📊'


def parse_row(row) -> dict | None:
    cells = row.find_all('td', recursive=False)
    if len(cells) < 7:
        return None

    # Cell 0: data-clean="TICKER|CompanyName"
    c0 = cells[0].get('data-clean', '')
    p0 = c0.split('|', 1)
    symbol = p0[0].strip()
    company = p0[1].strip() if len(p0) > 1 else ''
    if not symbol:
        return None

    # Cell 1: action text
    action = cells[1].get('data-sort-value', cells[1].get_text(strip=True))

    # Cell 2: data-clean="FirmName|rank"
    c2 = cells[2].get('data-clean', '')
    firm = c2.split('|')[0].strip()

    # Cell 5: data-clean="$prevPT|$newPT"
    c5 = cells[5].get('data-clean', '')
    pt_parts = c5.split('|')
    pt_prev_raw = pt_parts[0].replace('$', '').strip() if pt_parts else ''
    pt_new_raw  = pt_parts[1].replace('$', '').strip() if len(pt_parts) > 1 else ''
    pt_prev = '' if pt_prev_raw in ('0.00', '0', '') else pt_prev_raw
    pt_new  = '' if pt_new_raw  in ('0.00', '0', '') else pt_new_raw

    # Cell 6: data-clean="PrevGrade|NewGrade"
    c6 = cells[6].get('data-clean', '')
    grade_parts = c6.split('|')
    prev_grade = grade_parts[0].strip() if grade_parts else ''
    new_grade  = grade_parts[1].strip() if len(grade_parts) > 1 else ''
    if prev_grade in ('N/A', 'n/a', ''):
        prev_grade = ''

    return {
        'symbol': symbol,
        'company': company,
        'firm': firm,
        'action': action,
        'prev_grade': prev_grade,
        'new_grade': new_grade,
        'pt_prev': pt_prev,
        'pt_new': pt_new,
    }


def rating_id(r: dict) -> str:
    key = f"{r['symbol']}|{r['firm']}|{r['action']}|{r['new_grade']}|{r['pt_new']}"
    return hashlib.md5(key.encode()).hexdigest()


def build_embed(r: dict) -> dict:
    emoji = action_emoji(r['action'])
    color = rating_color(r['action'], r['new_grade'])

    lines = []
    # Action line
    if r['prev_grade']:
        lines.append(f"{emoji} **{r['action']}**: {r['prev_grade']} → **{r['new_grade']}**")
    elif r['new_grade']:
        lines.append(f"{emoji} **{r['action']}**: **{r['new_grade']}**")
    else:
        lines.append(f"{emoji} **{r['action']}**")

    # Price target line
    if r['pt_new']:
        if r['pt_prev']:
            lines.append(f"🎯 **Price Target**: ${r['pt_prev']} → **${r['pt_new']}**")
        else:
            lines.append(f"🎯 **Price Target**: **${r['pt_new']}**")

    return {
        "title": f"{r['symbol']}  •  {r['firm']}",
        "description": "\n".join(lines),
        "color": color,
        "footer": {"text": "Analyst Ratings  •  MarketBeat"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def send_discord(r: dict):
    embed = build_embed(r)
    resp = requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    resp.raise_for_status()


def fetch_ratings() -> list[dict]:
    resp = requests.get(MARKETBEAT_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')
    table = soup.find('table')
    if not table:
        return []
    rows = table.find_all('tr')[1:]
    results = []
    for row in rows:
        r = parse_row(row)
        if r:
            results.append(r)
    return results


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"date": "", "seen": []}


def save_state(state: dict):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def is_market_window() -> bool:
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    return MARKET_OPEN_HOUR_UTC <= now.hour < MARKET_CLOSE_HOUR_UTC


def run_once(state: dict) -> dict:
    today = date.today().isoformat()
    if state.get("date") != today:
        state = {"date": today, "seen": []}

    seen = set(state["seen"])

    try:
        ratings = fetch_ratings()
    except Exception as e:
        print(f"[{datetime.now()}] Fetch error: {e}")
        return state

    new_count = 0
    for r in ratings:
        rid = rating_id(r)
        if rid in seen:
            continue
        seen.add(rid)
        try:
            send_discord(r)
            new_count += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"[{datetime.now()}] Discord error for {r['symbol']}: {e}")

    if new_count:
        print(f"[{datetime.now()}] Sent {new_count} new rating(s) to Discord.")
    else:
        print(f"[{datetime.now()}] No new ratings.")

    state["seen"] = list(seen)
    return state


def main():
    print(f"[{datetime.now()}] Analyst Ratings Bot started (MarketBeat).")
    state = load_state()
    while True:
        if is_market_window():
            state = run_once(state)
            save_state(state)
        else:
            print(f"[{datetime.now()}] Outside market window, sleeping...")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == '__main__':
    main()
