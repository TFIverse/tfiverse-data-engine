import json

def analyze(filepath, source):
    try:
        with open(filepath) as f:
            data = json.load(f)
    except:
        return
    
    print(f"\n============================")
    print(f" {source}")
    print(f"============================")
    
    if isinstance(data, dict) and "movies" in data:
        movies_list = []
        for m, stats in data["movies"].items():
            movies_list.append((m, stats))
                
        movies_list.sort(key=lambda x: x[1].get('gross', 0), reverse=True)
        
        for m, stats in movies_list[:5]:
            print(f"Movie: {m}")
            print(f"  Gross: ₹{stats.get('gross', 0):,.2f}")
            print(f"  Sold: {stats.get('sold', 0):,}")
            print(f"  Shows: {stats.get('shows', 0):,}")
    else:
        # Our flat structure
        movies = {}
        for session in data:
            m = session.get("movie") or session.get("title") or "Unknown"
            if m not in movies:
                movies[m] = {"gross": 0, "sold": 0, "shows": 0}
            movies[m]["gross"] += session.get("grossRevenue", 0)
            movies[m]["sold"] += session.get("soldSeats", 0)
            movies[m]["shows"] += 1
        
        movies_list = []
        for m, stats in movies.items():
            movies_list.append((m, stats))
                
        movies_list.sort(key=lambda x: x[1]['gross'], reverse=True)
        
        for m, stats in movies_list[:5]:
            print(f"Movie: {m}")
            print(f"  Gross: ₹{stats['gross']:,.2f}")
            print(f"  Sold: {stats['sold']:,}")
            print(f"  Shows: {stats['shows']:,}")

analyze("/home/pepper-salt/.gemini/antigravity-ide/scratch/bfilmy-research/assetz/advance/data/20260906/finalsummary.json", "BFILMY (BookMyShow Advance)")
analyze("/home/pepper-salt/.gemini/antigravity-ide/scratch/tfiverse-data-engine/data/latest_paytm_advance_data.json", "TFIVERSE (Paytm Advance)")

