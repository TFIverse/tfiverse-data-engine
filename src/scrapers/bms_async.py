import os
import json
import datetime
import random
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import cloudscraper

# Ensure output directory exists
DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
VENUES_FILE = DATA_DIR / "bms_venues_master.json"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36",
]

def get_scraper():
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    
    proxy_env = os.environ.get("PROXY_LIST", "")
    if proxy_env:
        proxies_list = proxy_env.split(",")
        chosen_proxy = random.choice(proxies_list)
        scraper.proxies = {
            "http": chosen_proxy,
            "https": chosen_proxy
        }
        
    scraper.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://in.bookmyshow.com",
        "Referer": "https://in.bookmyshow.com/",
        "X-Forwarded-For": f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"
    })
    return scraper

def fetch_single_venue(venue, date_code, retries=3):
    venue_code = venue.get("VenueCode")
    if not venue_code:
        return None
    region_code = str(venue.get("RegionCode") or venue.get("City") or "").strip()
        
    scraper = get_scraper()
    url = f"https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode={venue_code}&dateCode={date_code}"
    
    for attempt in range(retries):
        try:
            response = scraper.get(url, timeout=10)
            if response.status_code == 200:
                if not response.text.strip().startswith("{"):
                    raise RuntimeError(f"Blocked by Cloudflare on {venue_code}")
                return {
                    "venueCode": venue_code,
                    "regionCode": region_code,
                    "data": response.json()
                }
            elif response.status_code in [403, 429]:
                scraper = get_scraper()
                time.sleep((2 ** attempt) + random.uniform(0.5, 1.5))
        except Exception as e:
            if attempt == retries - 1:
                pass
        time.sleep(random.uniform(0.2, 0.5))
    return None

def process_venues(venues, date_code, retries=3, max_workers=6):
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_single_venue, v, date_code, retries): v for v in venues}
        for future in as_completed(futures):
            res = future.result()
            if res:
                results.append(res)
    return results

def parse_bms_data(raw_results, date_code, target_date_str):
    final_sessions = []
    
    for result in raw_results:
        data = result.get("data")
        if not data:
            continue
            
        sd = data.get("ShowDetails", [])
        if not sd:
            continue
            
        venue_code = result["venueCode"]
        region_code = str(result.get("regionCode") or "").strip()
        venue = sd[0].get("Venues", {})
        venue_name = venue.get("VenueName", "")
        chain = venue.get("VenueCompName", "Unknown")
        lat = venue.get("VenueLatitude", "")
        lng = venue.get("VenueLongitude", "")

        # Fallback to API venue object if region_code was missing in parent venue
        api_region = str(venue.get("RegionCode") or venue.get("VenueCity") or venue.get("City") or "").strip()
        effective_region = region_code if region_code else api_region

        raw_region_code = effective_region if effective_region else "Unknown"
        raw_city = effective_region if effective_region else "Unknown"
        city = raw_city
        
        for ev in sd[0].get("Event", []):
            title = ev.get("EventTitle", "Unknown")
            movie_id = ev.get("EventCode", "")
            for ch in ev.get("ChildEvents", []):
                dim  = ch.get("EventDimension", "").strip()
                lang = ch.get("EventLanguage", "").strip()
                suffix = " | ".join(x for x in (dim, lang) if x)
                movie = f"{title} [{suffix}]" if suffix else title
                
                for sh in ch.get("ShowTimes", []):
                    if str(sh.get("ShowDateCode")) != str(date_code):
                        continue
                        
                    time_str = sh.get("ShowTime", "")
                    audi = sh.get("Attributes", "") or ""
                    
                    # Skip cancelled shows
                    show_status = str(sh.get("ShowStatus", "")).lower()
                    if "cancel" in show_status or "suspend" in show_status:
                        continue
                        
                    total_seats = 0
                    available_seats = 0
                    gross_revenue = 0
                    categories_list = []
                    
                    for cat in sh.get("Categories", []):
                        # Safely parse numeric fields
                        def parse_int(val):
                            return int(val) if str(val).lstrip('-').isdigit() else 0
                            
                        seats_in_cat = parse_int(cat.get("MaxSeats", 0))
                        avail_in_cat = parse_int(cat.get("SeatsAvail", 0))
                        
                        # Sometimes Blocked Seats are omitted, but sometimes present
                        # Usually SeatsAvail + Sold + Blocked = MaxSeats
                        # A safer calculation for Sold is (MaxSeats - SeatsAvail)
                        # BMS sometimes reports SeatsAvail as negative if overbooked
                        if avail_in_cat < 0:
                            avail_in_cat = 0
                            
                        price = float(cat.get("CurPrice", 0))
                        sold_in_cat = max(0, seats_in_cat - avail_in_cat)
                        
                        total_seats += seats_in_cat
                        available_seats += avail_in_cat
                        
                        if sold_in_cat > 0:
                            gross_revenue += (sold_in_cat * price)
                            
                        categories_list.append({
                            "name": cat.get("PriceDesc", "Unknown"),
                            "price": price,
                            "total": seats_in_cat,
                            "sold": sold_in_cat,
                            "available": avail_in_cat
                        })
                            
                    sold_seats = total_seats - available_seats
                    
                    # Calculate fast filling and housefull statuses
                    is_housefull = (available_seats == 0 and total_seats > 0)
                    is_fast_filling = (sold_seats >= (total_seats * 0.8)) and not is_housefull
                    
                    poster_url = ""
                    image_code = ev.get("EventImageCode")
                    if image_code:
                        poster_url = f"https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/{image_code}.jpg"
                    
                    if total_seats > 0:
                        final_sessions.append({
                            "movieId": movie_id,
                            "movie": movie,
                            "posterUrl": poster_url,
                            "venue": venue_name,
                            "chain": chain,
                            "city": city,
                            "raw_city": raw_city,
                            "raw_region_code": raw_region_code,
                            "lat": lat,
                            "lng": lng,
                            "date": target_date_str,
                            "time": time_str,
                            "audi": audi,
                            "totalSeats": total_seats,
                            "soldSeats": sold_seats,
                            "grossRevenue": gross_revenue,
                            "categories": json.dumps(categories_list),
                            "isHousefull": is_housefull,
                            "isFastFilling": is_fast_filling,
                            "source": "BMS",
                            "venueId": venue_code,
                            "showId": str(sh.get("SessionId", ""))
                        })
                        
    return final_sessions

def run_dynamic_venue_discovery(scraper, date_code, known_venues):
    # Dynamic Discovery: Queries v4 primary-dynamic to discover any brand new venues
    event_codes_env = os.environ.get("HOT_EVENT_CODES", "")
    regions = ["hyderabad", "vijayawada", "vizag", "bengaluru", "chennai"]
    
    if not event_codes_env:
        return known_venues
        
    hot_events = event_codes_env.split(",")
    known_codes = {v.get("VenueCode") for v in known_venues if v.get("VenueCode")}
    discovered = []
    
    for region in regions:
        for event in hot_events:
            url = f"https://in.bookmyshow.com/api/v4/movies-data/showtimes-by-event/primary-dynamic?eventCode={event}&regionSlug={region}&dateCode={date_code}"
            try:
                res = scraper.get(url, timeout=10)
                if res.status_code == 200:
                    data = res.json()
                    venues = data.get("ShowDetails", [{}])[0].get("Venues", [])
                    for v in venues:
                        vcode = v.get("VenueCode")
                        if vcode and vcode not in known_codes:
                            print(f"🌟 DISCOVERED NEW VENUE: {v.get('VenueName')} ({vcode}) in {region}")
                            new_venue = {
                                "VenueCode": vcode,
                                "VenueName": v.get("VenueName"),
                                "RegionCode": region.capitalize(),
                                "City": region.capitalize(),
                            }
                            discovered.append(new_venue)
                            known_codes.add(vcode)
            except Exception as e:
                pass
            time.sleep(0.5)
            
    if discovered:
        print(f"🎉 Dynamic Discovery found {len(discovered)} brand new venues! Appending to scrape list.")
        known_venues.extend(discovered)
    return known_venues

def main():
    print("🚀 Starting Sync BMS Scraper with Cloudscraper bypass...")
    if not VENUES_FILE.exists():
        print(f"❌ Error: {VENUES_FILE} not found!")
        return

    with open(VENUES_FILE, "r") as f:
        venues = json.load(f)
        
    scraper_instance = get_scraper()
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).date()
    live_date_code = today.strftime("%Y%m%d")
    
    # Inject Dynamic Venue Discovery
    venues = run_dynamic_venue_discovery(scraper_instance, live_date_code, venues)

    # Sharding Logic
    shard_index = int(os.environ.get("SHARD_INDEX", 0))
    total_shards = int(os.environ.get("TOTAL_SHARDS", 1))
    
    if total_shards > 1:
        chunk_size = len(venues) // total_shards
        start_idx = shard_index * chunk_size
        end_idx = start_idx + chunk_size if shard_index < total_shards - 1 else len(venues)
        venues = venues[start_idx:end_idx]
        print(f"🔹 Running Shard {shard_index+1}/{total_shards} - processing {len(venues)} venues.")

    deep_advance = os.environ.get("DEEP_ADVANCE", "false").lower() == "true"
    shard_suffix = f"_{shard_index}" if total_shards > 1 else ""
    
    if deep_advance:
        # ---------------------------------------------------------
        # DEEP ADVANCE PIPELINE (Days 2 to 5)
        # ---------------------------------------------------------
        adv_parsed = []
        print(f"📡 Fetching Deep Advance Data (Days 2 to 5)...")
        
        for day_offset in range(2, 6):
            target_date = today + datetime.timedelta(days=day_offset)
            adv_date_code = target_date.strftime("%Y%m%d")
            adv_date_str = target_date.strftime("%Y-%m-%d")
            
            print(f"   -> Fetching Advance Data for {adv_date_code} (+{day_offset} Days)")
            adv_raw = process_venues(venues, adv_date_code)
            parsed_day = parse_bms_data(adv_raw, adv_date_code, adv_date_str)
            adv_parsed.extend(parsed_day)
        
        with open(DATA_DIR / f"latest_bms_deep_advance_data{shard_suffix}.json", "w") as f:
            json.dump(adv_parsed, f, indent=2)
        print(f"✅ Saved {len(adv_parsed)} total deep advance sessions.")

    else:
        # ---------------------------------------------------------
        # HOURLY PIPELINE (Live + Tomorrow)
        # ---------------------------------------------------------
        live_date_code = today.strftime("%Y%m%d")
        live_date_str = today.strftime("%Y-%m-%d")
        
        print(f"📡 Fetching Live Data for {live_date_code}...")
        live_raw = process_venues(venues, live_date_code)
        live_parsed = parse_bms_data(live_raw, live_date_code, live_date_str)
        
        with open(DATA_DIR / f"latest_bms_data{shard_suffix}.json", "w") as f:
            json.dump(live_parsed, f, indent=2)
        print(f"✅ Saved {len(live_parsed)} live sessions.")

        adv_parsed = []
        print(f"📡 Fetching Advance (Tomorrow) Data...")
        
        target_date = today + datetime.timedelta(days=1)
        adv_date_code = target_date.strftime("%Y%m%d")
        adv_date_str = target_date.strftime("%Y-%m-%d")
        
        print(f"   -> Fetching Advance Data for {adv_date_code} (+1 Days)")
        adv_raw = process_venues(venues, adv_date_code)
        parsed_day = parse_bms_data(adv_raw, adv_date_code, adv_date_str)
        adv_parsed.extend(parsed_day)
        
        with open(DATA_DIR / f"latest_bms_advance_data{shard_suffix}.json", "w") as f:
            json.dump(adv_parsed, f, indent=2)
        print(f"✅ Saved {len(adv_parsed)} advance sessions.")

if __name__ == "__main__":
    main()
