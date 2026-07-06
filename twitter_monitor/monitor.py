import asyncio
import json
import os
import requests
import twscrape

TELEGRAM_BOT_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
TELEGRAM_CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
X_USERNAME = os.environ['X_USERNAME']
X_PASSWORD = os.environ['X_PASSWORD']
X_EMAIL = os.environ['X_EMAIL']

STATE_FILE = 'twitter_monitor/state.json'

ACCOUNTS = {
    'unusual_whales': 'Unusual Whales',
    'WalterBloomberg': 'Walter Bloomberg',
    'FinancialJuice': 'FinancialJuice',
}


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


async def main():
    api = twscrape.API()
    await api.pool.add_account(X_USERNAME, X_PASSWORD, X_EMAIL, '')
    await api.pool.login_all()

    state = load_state()

    for username, display_name in ACCOUNTS.items():
        try:
            user = await api.user_by_login(username)
            if not user:
                print(f'User not found: {username}')
                continue

            last_seen = state.get(username)
            new_tweets = []

            async for tweet in api.user_tweets(user.id, limit=10):
                tweet_id = str(tweet.id)
                if tweet_id == last_seen:
                    break
                new_tweets.append(tweet)

            if not new_tweets:
                print(f'{username}: no new tweets')
                continue

            # Always update state to latest
            state[username] = str(new_tweets[0].id)

            # First run: send only the latest post
            if last_seen is None:
                tweet = new_tweets[0]
                link = f'https://x.com/{username}/status/{tweet.id}'
                message = f'<b>\U0001f426 {display_name}</b>\n\n{tweet.rawContent}\n\n<a href="{link}">View on X</a>'
                send_telegram(message)
                print(f'{username}: first run, sent latest post')
                continue

            # Send new tweets oldest first
            for tweet in reversed(new_tweets):
                link = f'https://x.com/{username}/status/{tweet.id}'
                message = f'<b>\U0001f426 {display_name}</b>\n\n{tweet.rawContent}\n\n<a href="{link}">View on X</a>'
                send_telegram(message)
                print(f'Sent: {tweet.rawContent[:60]}')

        except Exception as e:
            print(f'Error checking {username}: {e}')

    save_state(state)


if __name__ == '__main__':
    asyncio.run(main())
