import feedparser
import json
import os
import requests

TELEGRAM_BOT_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
TELEGRAM_CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
STATE_FILE = 'twitter_monitor/state.json'

ACCOUNTS = {
    'unusual_whales': 'Unusual Whales',
    'WalterBloomberg': 'Walter Bloomberg',
    'FinancialJuice': 'FinancialJuice',
}

RSSHUB_INSTANCES = [
    'https://rsshub.app',
    'https://rss.shab.fun',
    'https://rsshub.rssforever.com',
]


def send_telegram(message):
    url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
    resp = requests.post(url, json={
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'HTML',
        'disable_web_page_preview': False,
    })
    resp.raise_for_status()


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def fetch_feed(username):
    for base in RSSHUB_INSTANCES:
        url = f'{base}/twitter/user/{username}'
        try:
            feed = feedparser.parse(url)
            if feed.entries:
                return feed
        except Exception:
            continue
    return None


def check_account(username, display_name, state):
    feed = fetch_feed(username)
    if not feed or not feed.entries:
        print(f'No entries for {username}')
        return

    last_seen = state.get(username)
    new_posts = []

    for entry in feed.entries:
        entry_id = entry.get('id') or entry.get('link', '')
        if entry_id == last_seen:
            break
        new_posts.append((entry_id, entry))

    # Always update state to latest
    first_id = feed.entries[0].get('id') or feed.entries[0].get('link', '')
    state[username] = first_id

    # First run: save state only, don't spam
    if last_seen is None:
        print(f'{username}: first run, saved state')
        return

    for entry_id, post in reversed(new_posts):
        title = post.get('title', '(no content)')
        link = post.get('link', '')
        message = f'<b>🐦 {display_name}</b>\n\n{title}\n\n<a href="{link}">View on X</a>'
        send_telegram(message)
        print(f'Sent: {username} — {title[:60]}')


def main():
    state = load_state()
    for username, display_name in ACCOUNTS.items():
        try:
            check_account(username, display_name, state)
        except Exception as e:
            print(f'Error checking {username}: {e}')
    save_state(state)


if __name__ == '__main__':
    main()
