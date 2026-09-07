import json

try:
    with open("/home/pepper-salt/.gemini/antigravity-ide/scratch/bfilmy-research/assetz/advance/data/20260906/finaldetailed.json") as f:
        bfilmy_data = json.load(f)
        
        if isinstance(bfilmy_data, dict):
            if "data" in bfilmy_data: bfilmy_data = bfilmy_data["data"]
            elif "shows" in bfilmy_data: bfilmy_data = bfilmy_data["shows"]
        
        bfilmy_venues = set()
        for s in bfilmy_data:
            if not isinstance(s, dict): continue
            v = s.get("venue_id") or s.get("venue")
            if v: bfilmy_venues.add(v)
        bfilmy_venues_count = len(bfilmy_venues)
except:
    bfilmy_venues_count = 0

print(f"BFilmy Active Venues Tracked Today: {bfilmy_venues_count}")
