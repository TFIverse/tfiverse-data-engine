import asyncio
import aiohttp
import json
import os
import datetime
from pathlib import Path
import random

DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
VENUES_FILE = DATA_DIR / "paytm_venues_master.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "client": "ticketnew",
    "Origin": "https://ticketnew.com",
    "Referer": "https://ticketnew.com/"
}

def get_x_forwarded_for():
    return f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"

async def fetch_venue(session, venue_id, date_str, retries=3):
    # This is a generalized District / Ticketnew API structure based on their NEXT_DATA.
    # We use a mobile/proxy endpoint representation here.
    url = f"https://apiproxy.paytm.com/v3/movies/search/movie?cinema_id={venue_id}&date={date_str}"
    
    headers = HEADERS.copy()
    headers["X-Forwarded-For"] = get_x_forwarded_for()

    for attempt in range(retries):
        try:
            async with session.get(url, headers=headers, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"venueId": venue_id, "data": data}
                elif response.status == 429:
                    await asyncio.sleep(2 ** attempt)
        except Exception as e:
            if attempt == retries - 1:
                print(f"Error fetching {venue_id}: {e}")
    return {"venueId": venue_id, "data": None}

async def process_venues(venues, date_str, concurrency=50):
    semaphore = asyncio.Semaphore(concurrency)
    
    async def sem_fetch(venue):
        async with semaphore:
            return await fetch_venue(session, venue.get("id"), date_str)
            
    async with aiohttp.ClientSession() as session:
        tasks = [sem_fetch(venue) for venue in venues if venue.get("id")]
        results = await asyncio.gather(*tasks)
        return results

def parse_paytm_data(raw_results, date_str):
    final_sessions = []
    
    for result in raw_results:
        if not result["data"] or not result["data"].get("movies"):
            continue
            
        venue_id = result["venueId"]
        
        for movie in result["data"].get("movies", []):
            movie_name = movie.get("name", "")
            
            for session in movie.get("sessions", []):
                time_str = session.get("showTime", "")
                total_seats = int(session.get("totalSeats", 0))
                available_seats = int(session.get("availableSeats", 0))
                price = float(session.get("price", 0))
                
                sold_seats = total_seats - available_seats
                gross_revenue = sold_seats * price
                
                final_sessions.append({
                    "movie": movie_name,
                    "venue": str(venue_id),
                    "city": "Unknown", # Typically fetched from venue master
                    "date": date_str,
                    "time": time_str,
                    "totalSeats": total_seats,
                    "soldSeats": sold_seats,
                    "grossRevenue": gross_revenue,
                    "source": "PAYTM",
                    "venueId": venue_id,
                    "showId": session.get("sessionId", "")
                })
                    
    return final_sessions

async def main():
    print("🚀 Starting Async Paytm Scraper...")
    if not VENUES_FILE.exists():
        print(f"❌ Error: {VENUES_FILE} not found!")
        return

    with open(VENUES_FILE, "r") as f:
        venues = json.load(f)

    # Sharding Logic
    shard_index = int(os.environ.get("SHARD_INDEX", 0))
    total_shards = int(os.environ.get("TOTAL_SHARDS", 1))
    
    if total_shards > 1:
        chunk_size = len(venues) // total_shards
        start_idx = shard_index * chunk_size
        end_idx = start_idx + chunk_size if shard_index < total_shards - 1 else len(venues)
        venues = venues[start_idx:end_idx]
        print(f"🔹 Running Shard {shard_index+1}/{total_shards} - processing {len(venues)} venues.")

    today = datetime.date.today()
    live_date_str = today.strftime("%Y-%m-%d")
    
    shard_suffix = f"_{shard_index}" if total_shards > 1 else ""
    
    print(f"📡 Fetching Live Data for {live_date_str}...")
    live_raw = await process_venues(venues, live_date_str)
    live_parsed = parse_paytm_data(live_raw, live_date_str)
    
    with open(DATA_DIR / f"latest_paytm_data{shard_suffix}.json", "w") as f:
        json.dump(live_parsed, f, indent=2)
    print(f"✅ Saved {len(live_parsed)} live sessions.")

    tomorrow = today + datetime.timedelta(days=1)
    adv_date_str = tomorrow.strftime("%Y-%m-%d")
    
    print(f"📡 Fetching Advance Data for {adv_date_str}...")
    adv_raw = await process_venues(venues, adv_date_str)
    adv_parsed = parse_paytm_data(adv_raw, adv_date_str)
    
    with open(DATA_DIR / f"latest_paytm_advance_data{shard_suffix}.json", "w") as f:
        json.dump(adv_parsed, f, indent=2)
    print(f"✅ Saved {len(adv_parsed)} advance sessions.")

if __name__ == "__main__":
    asyncio.run(main())
