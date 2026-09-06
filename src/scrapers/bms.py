import json
import os
import random
import time
import sys
import cloudscraper
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
]

def clean_movie_title(title):
    import re
    title = re.sub(r'\[.*?\]', '', title)
    title = re.sub(r'\(.*?\)', '', title)
    return " ".join(title.split()).strip()

def format_state(state_str):
    if not state_str: return 'Unknown'
    return state_str.replace('-', ' ').title()

def get_ist_date_code(days_offset=0):
    dt = datetime.now(IST) + timedelta(days=days_offset)
    return dt.strftime("%Y%m%d")

def get_scraper():
    ip = ".".join(str(random.randint(20, 230)) for _ in range(4))
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    scraper.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json, text/plain, */*",
        "X-Forwarded-For": ip,
        "X-Real-IP": ip,
        "Origin": "https://in.bookmyshow.com",
        "Referer": "https://in.bookmyshow.com/"
    })
    return scraper

def scrape_venue(scraper, venue, date_code, tracking_keywords, is_advance):
    url = f"https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode={venue['code']}&dateCode={date_code}"
    try:
        r = scraper.get(url, timeout=10)
        if r.status_code != 200:
            print(f"Failed to fetch {venue['code']}: HTTP {r.status_code}")
            return []
        data = r.json()
        
        sd = data.get("ShowDetails", [])
        if not sd: 
            # No shows for this venue
            return []
        
        v = sd[0].get("Venues", {})
        venue_name = v.get("VenueName", "Unknown")
        city = venue.get("city") or v.get("VenueCity", "Unknown")
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
                    if sh.get("ShowDateCode") != date_code: continue
                    
                    show_time_str = sh.get("ShowTime")
                    if not show_time_str: continue
                    
                    import re
                    # Normalize spaces and uppercase (e.g. "10:30  am" -> "10:30 AM")
                    clean_time = re.sub(r'\s+', ' ', show_time_str).strip().upper()
                    iso_date = f"{date_code[:4]}-{date_code[4:6]}-{date_code[6:]} {clean_time}"
                    try:
                        show_time_local = datetime.strptime(iso_date, "%Y-%m-%d %I:%M %p").replace(tzinfo=IST)
                    except ValueError:
                        # Fallback just in case some are 24-hour
                        show_time_local = datetime.strptime(iso_date, "%Y-%m-%d %H:%M").replace(tzinfo=IST)
                    
                    diff_mins = (show_time_local - now_local).total_seconds() / 60
                    
                    if is_advance:
                        if diff_mins < 200: continue
                    else:
                        if diff_mins >= 200: continue
                        
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
                        "movie": movie,
                        "rawTitle": title,
                        "lang": lang,
                        "format": dim,
                        "venue": venue_name,
                        "chain": chain,
                        "city": city,
                        "state": state,
                        "time": iso_date,
                        "audi": sh.get("Attributes", ""),
                        "sessionId": str(sh.get("SessionId", "")),
                        "totalSeats": total,
                        "availableSeats": avail,
                        "soldSeats": sold,
                        "grossRevenue": round(gross, 2),
                        "source": 'BMS',
                        "availStatus": int(sh.get("AvailStatus", "1"))
                    })
        return out
    except Exception as e:
        print(f"Exception on {venue['code']}: {str(e)}")
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
    tracking_keywords = [clean_movie_title(m['title']) for m in movies_data]
    
    # Load Venues
    venues_path = os.path.join(DATA_DIR, 'bms_venues.json')
    if not os.path.exists(venues_path):
        print("❌ bms_venues.json not found!")
        sys.exit(1)
        
    with open(venues_path, 'r') as f:
        venues = json.load(f)
        
    scrape_mode = os.environ.get("SCRAPE_MODE", "LIVE").upper()
    is_advance = (scrape_mode == "ADVANCE")
    days_to_scrape = [0, 1, 2, 3, 4] if is_advance else [0, 1]
    
    sessions = []
    
    # Process sequentially with random delays to avoid bans
    scraper = get_scraper()
    
    # Limit venues for testing if needed
    for offset in days_to_scrape:
        date_code = get_ist_date_code(offset)
        print(f"\n🌐 Scraping {len(venues)} BMS venues for Date: {date_code}...")
        
        for i, v in enumerate(venues):
            if i % 50 == 0:
                print(f"[{i}/{len(venues)}] - Scraped {len(sessions)} sessions so far...")
                scraper = get_scraper() # Rotate identity
                
            res = scrape_venue(scraper, v, date_code, tracking_keywords, is_advance)
            if res:
                sessions.extend(res)
                
            time.sleep(random.uniform(0.1, 0.3))
            
    out_file = os.path.join(DATA_DIR, f"latest_bms_{scrape_mode.lower()}_data.json")
    with open(out_file, 'w') as f:
        json.dump(sessions, f, indent=2)
        
    print(f"\n✅ Successfully saved {len(sessions)} sessions to {out_file}")

if __name__ == "__main__":
    run()
