import json
import os
import datetime
import time
from pathlib import Path
import requests

DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
OUTPUT_FILE = DATA_DIR / "sacnilk_data.json"

API_URL = "https://sacapi.text2024mail.workers.dev/?date="

def fetch_sacnilk(date_str, retries=3):
    url = f"{API_URL}{date_str}"
    
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    for attempt in range(retries):
        try:
            response = requests.get(url, headers=headers, timeout=15)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"[{date_str}] HTTP {response.status_code}, retry...")
        except Exception as e:
            print(f"[{date_str}] Error: {e}")
        
        time.sleep(2 ** attempt)
    return []

def main():
    print("🚀 Starting Sacnilk Industry Estimates Scraper...")
    
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).date()
    live_date_str = today.strftime("%Y-%m-%d")
    
    print(f"📡 Fetching Live Industry Estimates for {live_date_str}...")
    data = fetch_sacnilk(live_date_str)
    
    if data:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved Sacnilk estimates for {len(data)} items.")
    else:
        print("⚠️ No Sacnilk data returned.")
        if not OUTPUT_FILE.exists():
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)

if __name__ == "__main__":
    main()
