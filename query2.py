import json

with open("/home/pepper-salt/.gemini/antigravity-ide/scratch/tfiverse-data-engine/data/latest_paytm_advance_data.json") as f:
    data = json.load(f)

for s in data:
    if "Ratnamahal" in s.get("venue", "") and "Nagabandham" in s.get("movie", ""):
        print(s)
        break
