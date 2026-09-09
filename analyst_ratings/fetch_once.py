"""One-shot version of the ratings bot — fetches, sends new ratings, exits."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from monitor import run_once, load_state, save_state
from datetime import datetime

if __name__ == '__main__':
    print(f"[{datetime.now()}] fetch_once started.")
    state = load_state()
    state = run_once(state)
    save_state(state)
    print(f"[{datetime.now()}] fetch_once done.")
