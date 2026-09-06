import json
import os
import random
import time
import sys
import argparse
import threading
import cloudscraper
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')

API_TIMEOUT = 12
MAX_RECOVERY_ROUNDS = 5
IDENTITY_ROTATE_EVERY = 10
FAILURE_THRESHOLD = 5
COOLDOWN_SECONDS = 30

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
]

thread_local = threading.local()
request_counter = 0

class Identity:
    def __init__(self):
        self.ua = random.choice(USER_AGENTS)
        self.ip = ".".join(str(random.randint(20, 230)) for _ in range(4))
        self.scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True}
        )

    def headers(self):
        return {
            "User-Agent": self.ua,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-IN,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Origin": "https://in.bookmyshow.com",
            "Referer": "https://in.bookmyshow.com/",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "X-Forwarded-For": self.ip,
        }

def get_identity():
    global request_counter
    if not hasattr(thread_local, "identity"):
        thread_local.identity = Identity()
    request_counter += 1
    if request_counter % IDENTITY_ROTATE_EVERY == 0:
        reset_identity()
        thread_local.identity = Identity()
    return thread_local.identity

def reset_identity():
    if hasattr(thread_local, "identity"):
        del thread_local.identity

def fetch_api_raw(venue_code, date_code):
    ident = get_identity()
    url = f"https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode={venue_code}&dateCode={date_code}"
    response = ident.scraper.get(url, headers=ident.headers(), timeout=API_TIMEOUT)
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code}")
    text = response.text.strip()
    if not text.startswith("{"):
        raise RuntimeError("Blocked / HTML returned")
    return response.json()

def fetch_with_retry(venue_code, date_code, attempt=1):
    try:
        return fetch_api_raw(venue_code, date_code)
    except Exception as e:
        if attempt >= MAX_RECOVERY_ROUNDS:
            raise
        delay = (2 ** attempt) + random.uniform(0, 1)
        reset_identity()
        time.sleep(delay)
        return fetch_with_retry(venue_code, date_code, attempt + 1)

def clean_movie_title(title):
    import re
    title = re.sub(r'\[.*?\]', '', title)
    title = re.sub(r'\(.*?\)', '', title)
    return " ".join(title.split()).strip()

def format_state(state_str):
    if not state_str: return 'Unknown'
    return state_str.replace('-', ' ').title()

def scrape_venue(venue_code, date_code):
    try:
        data = fetch_with_retry(venue_code, date_code)
        sd = data.get("ShowDetails", [])
        if not sd: return []
        
        v = sd[0].get("Venues", {})
        venue_name = v.get("VenueName", "Unknown")
        city = v.get("VenueCity", "Unknown")
        chain = v.get("VenueCompName", "Independent")
        state = format_state(v.get("VenueState", "Unknown"))
        
        out = []
        now_local = datetime.now(IST)
        for ev in sd[0].get("Event", []):
            title = ev.get("EventTitle", "Unknown")
            for ch in ev.get("ChildEvents", []):
                dim = ch.get("EventDimension", "").strip()
                lang = ch.get("EventLanguage", "").strip()
                suffix = " | ".join(x for x in (dim, lang) if x)
                movie = f"{title} [{suffix}]" if suffix else title
                for sh in ch.get("ShowTimes", []):
                    show_time_str = sh.get("ShowTime")
                    if not show_time_str: continue
                    import re
                    clean_time = re.sub(r'\s+', ' ', show_time_str).strip().upper()
                    iso_date = f"{date_code[:4]}-{date_code[4:6]}-{date_code[6:]} {clean_time}"
                    try:
                        show_time_local = datetime.strptime(iso_date, "%Y-%m-%d %I:%M %p").replace(tzinfo=IST)
                    except ValueError:
                        show_time_local = datetime.strptime(iso_date, "%Y-%m-%d %H:%M").replace(tzinfo=IST)
                    
                    total = avail = sold = gross = 0
                    for cat in sh.get("Categories", []):
                        seats = int(cat.get("MaxSeats", 0))
                        free = int(cat.get("SeatsAvail", 0))
                        price = float(cat.get("CurPrice", 0))
                        total += seats
                        avail += free
                        sold += (seats - free)
                        gross += (seats - free) * price
                        
                    out.append({
                        "movie": movie, "rawTitle": title, "lang": lang, "format": dim,
                        "venue": venue_name, "chain": chain, "city": city, "state": state,
                        "time": iso_date, "audi": sh.get("Attributes", ""),
                        "sessionId": str(sh.get("SessionId", "")), "totalSeats": total,
                        "availableSeats": avail, "soldSeats": sold, "grossRevenue": round(gross, 2),
                        "source": 'BMS', "availStatus": int(sh.get("AvailStatus", "1"))
                    })
        return out
    except Exception as e:
        print(f"❌ Exception on {venue_code}: {str(e)[:50]}")
        return []

def run():
    print("🚀 Starting Python Cloudscraper for BMS...")
    
    # Load Movies
    movies_path = os.path.join(DATA_DIR, 'movies.json')
    if not os.path.exists(movies_path):
        print("❌ movies.json not found!")
        sys.exit(1)
        
    with open(movies_path, 'r') as f:
        movies_data = json.load(f)
    
    # Load Venues
    venues_path = os.path.join(DATA_DIR, 'bms_venues.json')
    if not os.path.exists(venues_path):
        print("❌ bms_venues.json not found!")
        sys.exit(1)
        
    with open(venues_path, 'r') as f:
        venues_map = json.load(f)
        
    scrape_mode = os.environ.get("SCRAPE_MODE", "LIVE").upper()
    is_advance = (scrape_mode == "ADVANCE")
    
    # Just run for today's date for LIVE
    dt = datetime.now(IST)
    date_code = dt.strftime("%Y%m%d")
    
    venue_codes = list(venues_map.keys())
    print(f"\n🌐 Scraping {len(venue_codes)} BMS venues for Date: {date_code}...")
    
    all_sessions = []
    failure_count = 0
    
    for i, code in enumerate(venue_codes):
        if i % 50 == 0:
            print(f"[{i}/{len(venue_codes)}] - Scraped {len(all_sessions)} sessions so far...")
        try:
            sessions = scrape_venue(code, date_code)
            for s in sessions:
                venue_meta = venues_map.get(code, {})
                s["city"] = venue_meta.get("City", "Unknown")
                s["state"] = venue_meta.get("State", "Unknown")
                # Filter for LIVE (soon) vs ADVANCE (future) if needed, but for now just pull everything
            all_sessions.extend(sessions)
            failure_count = 0
        except Exception as e:
            failure_count += 1
            if failure_count >= FAILURE_THRESHOLD:
                print(f"⛔ {failure_count} consecutive failures – cooling down {COOLDOWN_SECONDS}s")
                time.sleep(COOLDOWN_SECONDS)
                failure_count = 0
            reset_identity()
            
        time.sleep(random.uniform(0.45, 0.8))
            
    out_file = os.path.join(DATA_DIR, f"latest_bms_{scrape_mode.lower()}_data.json")
    with open(out_file, 'w') as f:
        json.dump(all_sessions, f, indent=2)
        
    print(f"\n✅ Successfully saved {len(all_sessions)} sessions to {out_file}")

if __name__ == "__main__":
    run()
