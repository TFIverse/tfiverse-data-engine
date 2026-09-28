import os
import json
import time
import random
import cloudscraper
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Ensure output directory exists
DATA_DIR = Path(__file__).parent.parent.parent / "data"
os.makedirs(DATA_DIR, exist_ok=True)
BMS_VENUES_FILE = DATA_DIR / "bms_venues_master.json"
BMS_REGIONS_FILE = DATA_DIR / "bms_regions_master.json"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36",
]

def get_scraper():
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    scraper.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://in.bookmyshow.com",
        "Referer": "https://in.bookmyshow.com/",
        "X-Forwarded-For": f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"
    })
    return scraper

def fetch_city_venues(city_slug):
    scraper = get_scraper()
    
    # Bypass step 1: hit the region homepage to get cookies
    homepage_url = f"https://in.bookmyshow.com/explore/home/{city_slug}"
    homepage_res = scraper.get(homepage_url, timeout=10)
    
    # Diamond 5: Validate genuine BMS page (not Cloudflare challenge/Turnstile)
    if homepage_res.status_code != 200 or "window.__INITIAL_STATE__" not in homepage_res.text:
        print(f"[Diamond 5] Cloudflare challenge or block on homepage for {city_slug}")
        return []
    
    # Fetch venues for region
    json_url = "https://in.bookmyshow.com/serv/getData?cmd=QUICKBOOK&type=MT"
    response = scraper.get(json_url, timeout=10)
    
    if response.status_code != 200 or not response.text.strip().startswith("{"):
        return []
        
    try:
        data = response.json()
        raw_venues = data.get("cinemas", {}).get("BookMyShow", {}).get("aiVN", {}).get("venues", [])
        
        extracted_venues = []
        for v in raw_venues:
            extracted_venues.append({
                "VenueCode": v.get("VenueCode"),
                "VenueName": v.get("VenueName"),
                "RegionCode": v.get("RegionCode"),
            })
        return extracted_venues
    except Exception as e:
        print(f"Error parsing {city_slug}: {e}")
        return []

def main():
    print("🚀 Starting Venue Discovery Engine...")
    
    # 1. Load existing venues
    existing_venues = []
    if BMS_VENUES_FILE.exists():
        with open(BMS_VENUES_FILE, "r") as f:
            existing_venues = json.load(f)
            
    existing_codes = {v.get("VenueCode") for v in existing_venues if v.get("VenueCode")}
    print(f"📦 Currently tracking {len(existing_codes)} venues.")
    
    # 2. Get list of all cities (Diamond 6: Local authoritative master with live fallback)
    cities = []
    if BMS_REGIONS_FILE.exists():
        try:
            print("🗺️ Loading authoritative BMS Regions Master (Diamond 6)...")
            with open(BMS_REGIONS_FILE, "r") as f:
                regions_data = json.load(f)
            
            # Prioritize AP/TG circuit cities, then others
            ap_tg_cities = []
            other_cities = []
            for r in regions_data:
                slug = r.get("RegionSlug")
                if not slug:
                    continue
                if r.get("StateCode") in ("AP", "TG") or r.get("StateName") in ("Andhra Pradesh", "Telangana"):
                    ap_tg_cities.append(slug.lower())
                else:
                    other_cities.append(slug.lower())
            
            cities = list(dict.fromkeys(ap_tg_cities + other_cities))
            print(f"📍 Loaded {len(cities)} regions ({len(ap_tg_cities)} AP/TG circuits) from authoritative master.")
        except Exception as e:
            print(f"⚠️ Warning loading master file: {e}. Falling back to live API.")
    
    if not cities:
        print("🗺️ Fetching master list of all regions from live BMS API...")
        scraper = get_scraper()
        res = scraper.get("https://in.bookmyshow.com/serv/getData?cmd=GETREGIONS")
        
        if res.status_code != 200:
            print("❌ Failed to fetch regions API")
            return
            
        try:
            text = res.text
            # The endpoint returns raw JS: var regionlst={...};var subRegionData=...
            json_str = text.split("var regionlst=")[1].split(";var ")[0]
            data = json.loads(json_str)
            
            for k, v in data.items():
                if isinstance(v, list):
                    for item in v:
                        city_name = item.get("name")
                        if city_name:
                            cities.append(city_name.lower().replace(" ", "-"))
            cities = list(set([c for c in cities if c]))
        except Exception as e:
            print("❌ Failed to parse regions:", e)
            return

    print(f"📍 Target queue: {len(cities)} unique cities. Scanning for new theatres...")
    
    # 3. Scan all cities in parallel
    new_venues_found = 0
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(fetch_city_venues, city): city for city in cities}
        
        for future in as_completed(futures):
            city = futures[future]
            try:
               venues = future.result()
               for v in venues:
                   if v.get("VenueCode") and v.get("VenueCode") not in existing_codes:
                       existing_venues.append(v)
                       existing_codes.add(v.get("VenueCode"))
                       new_venues_found += 1
                       print(f"🌟 NEW THEATRE FOUND: [{v.get('VenueCode')}] {v.get('VenueName')} in {city}")
            except Exception as e:
                pass
                
    # 4. Save updated master file
    if new_venues_found > 0:
        print(f"✅ Discovered {new_venues_found} new theatres! Saving to master file...")
        with open(BMS_VENUES_FILE, "w") as f:
            json.dump(existing_venues, f, indent=2)
    else:
        print("✅ No new theatres found today.")

if __name__ == "__main__":
    main()
