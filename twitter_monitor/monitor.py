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

# Nitter instances — tries each until one works
NITTER_INSTANCES = [
    'https://nitter.poast.org',
    'https://nitter.privacydev.net',
    'https://nitter.1d4.us',
    'https://nitter.kavin.rocks',
    'https://nitter.unixfox.eu',
    'https://twiiit.com',
]


def send_telegram(message):
    url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
    resp = requests.post(url, json={
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'HTML',
        'disable_web_page_preview': False,
    }, timeout=10)
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
    for instance in NITTER_INSTANCES:
        url = f'{instance}/{username}/rss'
        try:
            print(f'Trying {url}')
            feed = feedparser.parse(url)
            if feed.entries:
                print(f'Got {len(feed.entries)} entries from {instance}')
                return feed
            else:
                print(f'No entries from {instance}')
        except Exception as e:
            print(f'Error from {instance}: {e}')
    return None


def check_account(username, display_name, state):
    feed = fetch_feed(username)
    if not feed or not feed.entries:
        print(f'All instances failed for {username}')
        return

    last_seen = state.get(username)
    new_posts = []

    for entry in feed.entries:
        entry_id = entry.get('id') or entry.get('link', '')
        if entry_id == last_seen:
            break
        new_posts.append((entry_id, entry))

    first_id = feed.entries[0].get('id') or feed.entries[0].get('link', '')
    state[username] = first_id

    # First run: send only the latest post so user can verify it works
    if last_seen is None:
        print(f'{username}: first run, sending latest post')
        new_posts = [(first_id, feed.entries[0])]

    print(f'{username}: {len(new_posts)} new posts')

    for entry_id, post in new_posts:
        title = post.get('title', '(no content)')
        link = post.get('link', '')
        # Clean up nitter link to point to real X
        link = link.replace(next((i for i in NITTER_INSTANCES if i in link), ''), 'https://x.com')
        message = f'<b>🐦 {display_name}</b>\n\n{title}\n\n<a href="{link}">View on X</a>'
        send_telegram(message)
        print(f'Sent: {title[:60]}')


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
