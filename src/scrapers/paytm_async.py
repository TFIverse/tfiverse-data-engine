import os
import json
import datetime
import urllib.request
import urllib.error
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
VENUES_FILE = DATA_DIR / "paytm_venues_master.json"

def reverse_dictionary(dictionary):
    if not isinstance(dictionary, dict):
        return {}
    result = {}
    for key, value in dictionary.items():
        try:
            numeric_value = int(value)
        except (TypeError, ValueError):
            continue
        result[numeric_value] = key
    return result

def decompress_and_parse(data, date_str):
    if not data or not isinstance(data, dict): return []
    
    dicts = data.get("dicts", {})
    rev = {
        "cities": reverse_dictionary(dicts.get("cities", {})),
        "states": reverse_dictionary(dicts.get("states", {})),
        "venues": reverse_dictionary(dicts.get("venues", {})),
        "chains": reverse_dictionary(dicts.get("chains", {})),
        "showtimes": reverse_dictionary(dicts.get("showtimes", {})),
        "audis": reverse_dictionary(dicts.get("audis", {}))
    }
    
    final_sessions = []
    
    movies = data.get("movies", {})
    for raw_movie_key, rows in movies.items():
        if not isinstance(rows, list): continue
        
        # Parse movie name
        if "|" in raw_movie_key:
            parts = [p.strip() for p in raw_movie_key.split("|")]
            movie_name = parts[0] if parts else raw_movie_key
            language = parts[-1] if len(parts) > 1 else "Unknown"
        else:
            movie_name = raw_movie_key.strip()
            language = "Unknown"
            
        movie_key = f"{movie_name} [2D | {language}]" if language != "Unknown" else movie_name
        
        for row in rows:
            if len(row) < 12: continue
            city_id, state_id, venue_id_num, chain_id, time_id, audi_id = row[0], row[1], row[2], row[3], row[4], row[5]
            
            total = int(row[6] or 0)
            available = int(row[7] or 0)
            sold = int(row[8] or 0)
            gross_cents = int(row[9] or 0)
            gross = gross_cents / 100.0
            
            venue_id = str(venue_id_num)
            city = rev["cities"].get(city_id, "Unknown")
            state = rev["states"].get(state_id, "Unknown")
            venue = rev["venues"].get(venue_id_num, "Unknown")
            time_str = rev["showtimes"].get(time_id, "")
            
            final_sessions.append({
                "movie": movie_key,
                "venue": venue,
                "city": city,
                "state": state,
                "date": date_str,
                "time": time_str,
                "totalSeats": total,
                "soldSeats": sold,
                "grossRevenue": gross,
                "source": "PAYTM",
                "venueId": venue_id,
                "showId": f"PAYTM_{venue_id}_{time_str.replace(' ', '')}"
            })
            
    return final_sessions

def fetch_data(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return None

def main():
    print("🚀 Starting Sync Paytm Scraper (via districtdata2026 proxy)...")
    
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).date()
    
    # Try fetching daily for today, if not try yesterday
    live_parsed = []
    live_date_str = ""
    for d in [today, today - datetime.timedelta(days=1)]:
        d_str = d.strftime("%Y-%m-%d")
        live_url = f"https://districtdata2026.pages.dev/boxoffice/{d_str}_Detailed.json"
        print(f"📡 Trying Live Data from {live_url}...")
        live_data = fetch_data(live_url)
        if live_data:
            live_parsed = decompress_and_parse(live_data, d_str)
            live_date_str = d_str
            break

    if live_parsed:
        with open(DATA_DIR / "latest_paytm_data.json", "w") as f:
            json.dump(live_parsed, f, indent=2)
        print(f"✅ Saved {len(live_parsed)} live sessions for {live_date_str}.")
    
    # Fetch Deep Advance (Days 1 to 5)
    adv_parsed = []
    print(f"📡 Fetching Deep Advance Data (Days 1 to 5)...")
    
    for day_offset in range(1, 6):
        d = today + datetime.timedelta(days=day_offset)
        d_str = d.strftime("%Y-%m-%d")
        adv_url = f"https://districtdata2026.pages.dev/advance/{d_str}_Detailed.json"
        print(f"   -> Trying Advance Data from {adv_url} (+{day_offset} Days)...")
        adv_data = fetch_data(adv_url)
        if adv_data:
            parsed_day = decompress_and_parse(adv_data, d_str)
            adv_parsed.extend(parsed_day)

    if adv_parsed:
        with open(DATA_DIR / "latest_paytm_advance_data.json", "w") as f:
            json.dump(adv_parsed, f, indent=2)
        print(f"✅ Saved {len(adv_parsed)} total advance sessions across 5 days.")

if __name__ == "__main__":
    main()
