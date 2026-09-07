import os
import json
import datetime
import random
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import cloudscraper

DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
VENUES_FILE = DATA_DIR / "paytm_venues_master.json"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36",
]

def get_scraper():
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    scraper.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json",
        "client": "ticketnew",
        "Origin": "https://ticketnew.com",
        "Referer": "https://ticketnew.com/",
        "X-Forwarded-For": f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"
    })
    return scraper

def process_venues(venues, date_str, retries=3):
    results = []
    scraper = get_scraper()
    
    for venue in venues:
        venue_id = venue.get("id")
        if not venue_id:
            continue
            
        url = f"https://apiproxy.paytm.com/v3/movies/search/movie?cinema_id={venue_id}&date={date_str}"
        
        for attempt in range(retries):
            try:
                response = scraper.get(url, timeout=10)
                if response.status_code == 200:
                    if not response.text.strip().startswith("{"):
                        raise RuntimeError(f"Blocked by anti-bot on {venue_id}")
                    results.append({"venueId": venue_id, "data": response.json()})
                    break
                elif response.status_code in [403, 429]:
                    scraper = get_scraper()
                    time.sleep((2 ** attempt) + random.uniform(0.5, 1.5))
            except Exception as e:
                if attempt == retries - 1:
                    print(f"Error fetching {venue_id}: {e}")
                    
        import time
        time.sleep(random.uniform(0.35, 0.7))
        
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

def main():
    print("🚀 Starting Sync Paytm Scraper with Cloudscraper bypass...")
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

    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).date()
    live_date_str = today.strftime("%Y-%m-%d")
    
    shard_suffix = f"_{shard_index}" if total_shards > 1 else ""
    
    print(f"📡 Fetching Live Data for {live_date_str}...")
    live_raw = process_venues(venues, live_date_str)
    live_parsed = parse_paytm_data(live_raw, live_date_str)
    
    with open(DATA_DIR / f"latest_paytm_data{shard_suffix}.json", "w") as f:
        json.dump(live_parsed, f, indent=2)
    print(f"✅ Saved {len(live_parsed)} live sessions.")

    tomorrow = today + datetime.timedelta(days=1)
    adv_date_str = tomorrow.strftime("%Y-%m-%d")
    
    print(f"📡 Fetching Advance Data for {adv_date_str}...")
    adv_raw = process_venues(venues, adv_date_str)
    adv_parsed = parse_paytm_data(adv_raw, adv_date_str)
    
    with open(DATA_DIR / f"latest_paytm_advance_data{shard_suffix}.json", "w") as f:
        json.dump(adv_parsed, f, indent=2)
    print(f"✅ Saved {len(adv_parsed)} advance sessions.")

if __name__ == "__main__":
    main()
