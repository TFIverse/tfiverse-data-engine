import json

with open("/home/pepper-salt/.gemini/antigravity-ide/scratch/tfiverse-data-engine/data/latest_paytm_advance_data.json") as f:
    data = json.load(f)

for s in data:
    if "Nagabandham" in s.get("movie", ""):
        city = s.get("city", "").lower()
        if "ongole" in city or "singarayakonda" in city:
            print(f"City: {s.get('city')}, Venue: {s.get('venue')}, Time: {s.get('time')}, Sold: {s.get('soldSeats')}, Total: {s.get('totalSeats')}, Gross: {s.get('grossRevenue')}")
