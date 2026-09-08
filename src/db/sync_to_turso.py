import os
import json
import urllib.request
import urllib.parse
from pathlib import Path
import hashlib

DATA_DIR = Path(__file__).parent.parent.parent / "data"

def get_movie_id(s):
    m_id = s.get("movieId")
    if m_id and str(m_id).strip() not in ["", "UNKNOWN"]:
        return str(m_id).strip()
    title = s.get("movie", "Unknown").strip()
    return "MOV_" + hashlib.md5(title.encode()).hexdigest()[:12]

# Turso HTTP API configuration
TURSO_URL = os.environ.get("TURSO_URL", "https://tfiverse-tfiverse.aws-ap-south-1.turso.io")
TURSO_TOKEN = os.environ.get("TURSO_TOKEN", "")

def execute_turso_sql(statements):
    """Executes a list of SQL statements in a single transaction via Turso HTTP API."""
    if not TURSO_TOKEN:
        print("⚠️ TURSO_TOKEN not found. Skipping DB Sync.")
        return False
        
    endpoint = f"{TURSO_URL}/v2/pipeline"
    headers = {
        "Authorization": f"Bearer {TURSO_TOKEN}",
        "Content-Type": "application/json"
    }
    
    # Format for Turso Pipeline API
    requests = [{"type": "execute", "stmt": {"sql": sql, "args": args}} for sql, args in statements]
    requests.append({"type": "close"})
    
    payload = json.dumps({"requests": requests}).encode('utf-8')
    
    req = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            return True
    except Exception as e:
        print(f"❌ Turso DB Error: {e}")
        return False

def init_db():
    print("📦 Initializing Database Tables...")
    statements = [
        ("""
        CREATE TABLE IF NOT EXISTS movies (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            poster_url TEXT
        )
        """, []),
        ("""
        CREATE TABLE IF NOT EXISTS venues (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            chain TEXT,
            city TEXT,
            lat TEXT,
            lng TEXT
        )
        """, []),
        ("""
        CREATE TABLE IF NOT EXISTS box_office_sessions (
            show_id TEXT PRIMARY KEY,
            movie_id TEXT REFERENCES movies(id),
            venue_id TEXT REFERENCES venues(id),
            show_date TEXT NOT NULL,
            show_time TEXT NOT NULL,
            audi TEXT,
            total_seats INTEGER,
            sold_seats INTEGER,
            gross_revenue REAL,
            categories_json TEXT,
            is_housefull BOOLEAN DEFAULT 0,
            is_fast_filling BOOLEAN DEFAULT 0,
            source TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """, [])
    ]
    execute_turso_sql(statements)

def sync_data(filename):
    file_path = DATA_DIR / filename
    if not file_path.exists():
        print(f"⚠️ File {filename} not found.")
        return
        
    print(f"🔄 Syncing {filename} to Turso...")
    with open(file_path, "r") as f:
        sessions = json.load(f)
        
    statements = []
    
    for s in sessions:
        movie_id = get_movie_id(s)
        
        # 1. Upsert Movie
        statements.append((
            """
            INSERT INTO movies (id, title, poster_url) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET 
                title=excluded.title,
                poster_url=COALESCE(excluded.poster_url, poster_url)
            """, 
            [movie_id, s.get("movie", "Unknown"), s.get("posterUrl", "")]
        ))
        
        # 2. Upsert Venue
        statements.append((
            """
            INSERT INTO venues (id, name, chain, city, lat, lng) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET 
                name=excluded.name, chain=excluded.chain, city=excluded.city, 
                lat=excluded.lat, lng=excluded.lng
            """,
            [
                s.get("venueId", "UNKNOWN"), 
                s.get("venue", "Unknown"), 
                s.get("chain", "Unknown"), 
                s.get("city", "Unknown"), 
                s.get("lat", ""), 
                s.get("lng", "")
            ]
        ))
        
        # 3. Upsert Session
        statements.append((
            """
            INSERT INTO box_office_sessions (
                show_id, movie_id, venue_id, show_date, show_time, audi, 
                total_seats, sold_seats, gross_revenue, categories_json, 
                is_housefull, is_fast_filling, source, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(show_id) DO UPDATE SET 
                total_seats=excluded.total_seats,
                sold_seats=excluded.sold_seats,
                gross_revenue=excluded.gross_revenue,
                categories_json=excluded.categories_json,
                is_housefull=excluded.is_housefull,
                is_fast_filling=excluded.is_fast_filling,
                last_updated=CURRENT_TIMESTAMP
            """,
            [
                s.get("showId", "UNKNOWN"),
                movie_id,
                s.get("venueId", "UNKNOWN"),
                s.get("date", ""),
                s.get("time", ""),
                s.get("audi", ""),
                int(s.get("totalSeats", 0)),
                int(s.get("soldSeats", 0)),
                float(s.get("grossRevenue", 0.0)),
                s.get("categories", "[]"),
                1 if s.get("isHousefull") else 0,
                1 if s.get("isFastFilling") else 0,
                s.get("source", "BMS")
            ]
        ))
        
        # Send in batches of 100 to avoid payload limits
        if len(statements) >= 300:
            execute_turso_sql(statements)
            statements = []
            
    # Execute any remaining
    if statements:
        execute_turso_sql(statements)
        
    print(f"✅ Successfully synced {len(sessions)} sessions from {filename}.")

if __name__ == "__main__":
    init_db()
    sync_data("latest_bms_data.json")
    sync_data("latest_bms_advance_data.json")
    sync_data("latest_paytm_data.json")
    sync_data("latest_paytm_advance_data.json")
