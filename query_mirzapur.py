import json

filepath = "/home/pepper-salt/.gemini/antigravity-ide/scratch/bfilmy-research/assetz/advance/data/20260906/finaldetailed.json"
try:
    with open(filepath) as f:
        data = json.load(f)
except:
    print("Could not open finaldetailed.json")
    exit(1)

total_sold = 0
total_gross = 0
shows = 0

# Check structure
if isinstance(data, dict):
    if "data" in data: data = data["data"]
    elif "shows" in data: data = data["shows"]

for s in data:
    if not isinstance(s, dict): continue
    if "Mirzapur" in s.get("movie", "") and s.get("state", "").lower() == "telangana":
        total_sold += s.get("sold", 0)
        total_gross += s.get("gross", 0)
        shows += 1

print(f"--- Mirzapur Telangana Advance ---")
print(f"Shows: {shows}")
print(f"Tickets Sold: {total_sold}")
print(f"Gross: ₹{total_gross:,.2f}")
