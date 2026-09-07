import asyncio
import aiohttp
import json
import os
import datetime
from pathlib import Path
import random

# Ensure output directory exists
DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
VENUES_FILE = DATA_DIR / "bms_venues_master.json"

HEADERS = {
    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 14; SM-S918B Build/UP1A.231005.007) BookMyShow/14.0.1",
    "x-bms-id": "bms-android-app",
    "x-platform": "ANDROID",
    "x-app-version": "14.0.1",
    "Accept-Encoding": "gzip, deflate, br"
}

def get_x_forwarded_for():
    return f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"

async def fetch_venue(session, venue_code, date_code, retries=3):
    url = f"https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode={venue_code}&dateCode={date_code}"
    
    headers = HEADERS.copy()
    headers["X-Forwarded-For"] = get_x_forwarded_for()

    for attempt in range(retries):
        try:
            async with session.get(url, headers=headers, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"venueCode": venue_code, "data": data}
                elif response.status == 429:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
        except Exception as e:
            if attempt == retries - 1:
                print(f"Error fetching {venue_code}: {e}")
    return {"venueCode": venue_code, "data": None}

async def process_venues(venues, date_code, concurrency=50):
    semaphore = asyncio.Semaphore(concurrency)
    
    async def sem_fetch(venue):
        async with semaphore:
            return await fetch_venue(session, venue["VenueCode"], date_code)
            
    async with aiohttp.ClientSession() as session:
        tasks = [sem_fetch(venue) for venue in venues if venue.get("VenueCode")]
        results = await asyncio.gather(*tasks)
        return results

def parse_bms_data(raw_results, date_code, target_date_str):
    final_sessions = []
    
    for result in raw_results:
        if not result["data"] or not result["data"].get("events"):
            continue
            
        venue_code = result["venueCode"]
        venue_info = result["data"].get("venue", {})
        venue_name = venue_info.get("name", "")
        city = venue_info.get("cityCode", "")

        for event in result["data"]["events"]:
            movie_name = event.get("title", "")
            
            for show_date in event.get("showDates", []):
                # Filter only for the requested date
                if show_date.get("dateCode") != str(date_code):
                    continue
                    
                for show in show_date.get("shows", []):
                    time_str = show.get("time", "")
                    
                    # Some basic parsing for total/sold seats
                    # BMS mobile API returns availability/categories
                    total_seats = 0
                    available_seats = 0
                    gross_revenue = 0
                    
                    for cat in show.get("categories", []):
                        seats_in_cat = int(cat.get("totalSeats", 0) if str(cat.get("totalSeats")).isdigit() else 0)
                        avail_in_cat = int(cat.get("availableSeats", 0) if str(cat.get("availableSeats")).isdigit() else 0)
                        price = float(cat.get("price", 0))
                        
                        total_seats += seats_in_cat
                        available_seats += avail_in_cat
                        sold_in_cat = seats_in_cat - avail_in_cat
                        if sold_in_cat > 0:
                            gross_revenue += (sold_in_cat * price)

                    sold_seats = total_seats - available_seats
                    
                    final_sessions.append({
                        "movie": movie_name,
                        "venue": venue_name,
                        "city": city,
                        "date": target_date_str,
                        "time": time_str,
                        "totalSeats": total_seats,
                        "soldSeats": sold_seats,
                        "grossRevenue": gross_revenue,
                        "source": "BMS",
                        "venueId": venue_code,
                        "showId": show.get("id", "")
                    })
                    
    return final_sessions

async def main():
    print("🚀 Starting Async BMS Scraper...")
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

    # Scrape LIVE (Today)
    today = datetime.date.today()
    live_date_code = today.strftime("%Y%m%d")
    live_date_str = today.strftime("%Y-%m-%d")
    
    shard_suffix = f"_{shard_index}" if total_shards > 1 else ""
    
    print(f"📡 Fetching Live Data for {live_date_code}...")
    live_raw = await process_venues(venues, live_date_code)
    live_parsed = parse_bms_data(live_raw, live_date_code, live_date_str)
    
    with open(DATA_DIR / f"latest_bms_data{shard_suffix}.json", "w") as f:
        json.dump(live_parsed, f, indent=2)
    print(f"✅ Saved {len(live_parsed)} live sessions.")

    # Scrape ADVANCE (Tomorrow)
    tomorrow = today + datetime.timedelta(days=1)
    adv_date_code = tomorrow.strftime("%Y%m%d")
    adv_date_str = tomorrow.strftime("%Y-%m-%d")
    
    print(f"📡 Fetching Advance Data for {adv_date_code}...")
    adv_raw = await process_venues(venues, adv_date_code)
    adv_parsed = parse_bms_data(adv_raw, adv_date_code, adv_date_str)
    
    with open(DATA_DIR / f"latest_bms_advance_data{shard_suffix}.json", "w") as f:
        json.dump(adv_parsed, f, indent=2)
    print(f"✅ Saved {len(adv_parsed)} advance sessions.")

if __name__ == "__main__":
    asyncio.run(main())
