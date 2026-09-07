import asyncio
import aiohttp
import json
import os
import datetime
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
OUTPUT_FILE = DATA_DIR / "sacnilk_data.json"

# Endpoint used by BFilmy proxy for Sacnilk
API_URL = "https://sacapi.text2024mail.workers.dev/?date="

async def fetch_sacnilk(date_str, retries=3):
    url = f"{API_URL}{date_str}"
    
    async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}) as session:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=15) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        print(f"[{date_str}] HTTP {response.status}, retry...")
            except Exception as e:
                print(f"[{date_str}] Error: {e}")
            
            await asyncio.sleep(2 ** attempt)
    return []

async def main():
    print("🚀 Starting Sacnilk Industry Estimates Scraper...")
    
    today = datetime.date.today()
    live_date_str = today.strftime("%Y-%m-%d")
    
    print(f"📡 Fetching Live Industry Estimates for {live_date_str}...")
    data = await fetch_sacnilk(live_date_str)
    
    if data:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved Sacnilk estimates for {len(data)} items.")
    else:
        print("⚠️ No Sacnilk data returned.")
        # Ensure the file exists so sync-box-office.ts doesn't crash
        if not OUTPUT_FILE.exists():
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)

if __name__ == "__main__":
    asyncio.run(main())
