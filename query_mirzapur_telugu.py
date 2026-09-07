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
versions = {}

if isinstance(data, dict):
    if "data" in data: data = data["data"]
    elif "shows" in data: data = data["shows"]

for s in data:
    if not isinstance(s, dict): continue
    m_name = s.get("movie", "")
    if "Mirzapur" in m_name and s.get("state", "").lower() == "telangana":
        if "Telugu" in m_name:
            total_sold += s.get("sold", 0)
            total_gross += s.get("gross", 0)
            shows += 1
        
        # Track all versions found
        if m_name not in versions:
            versions[m_name] = {"sold": 0, "gross": 0, "shows": 0}
        versions[m_name]["sold"] += s.get("sold", 0)
        versions[m_name]["gross"] += s.get("gross", 0)
        versions[m_name]["shows"] += 1

print(f"--- Mirzapur Telangana Advance (Telugu) ---")
print(f"Shows: {shows}")
print(f"Tickets Sold: {total_sold}")
print(f"Gross: ₹{total_gross:,.2f}")
print("\n--- All Versions Found in Telangana ---")
for k, v in versions.items():
    print(f"{k}: {v['shows']} shows, {v['sold']} tickets, ₹{v['gross']:,.2f}")
