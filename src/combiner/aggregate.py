import json
import os
import glob
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data"

FILE_PATTERNS = {
    "latest_bms_data.json": "latest_bms_data_*.json",
    "latest_bms_advance_data.json": "latest_bms_advance_data_*.json",
    "latest_bms_deep_advance_data.json": "latest_bms_deep_advance_data_*.json",
    "latest_paytm_data.json": "latest_paytm_data_*.json",
    "latest_paytm_advance_data.json": "latest_paytm_advance_data_*.json"
}

def aggregate_shards():
    print("🚀 Starting Combiner & Aggregator...")
    
    for final_file, pattern in FILE_PATTERNS.items():
        search_path = DATA_DIR / pattern
        shard_files = glob.glob(str(search_path))
        
        if not shard_files:
            print(f"⚠️ No shards found for {final_file}. Skipping.")
            continue
            
        all_sessions = []
        seen_show_keys = set()
        
        for file_path in shard_files:
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                    
                for session in data:
                    # Create a unique key for deduplication
                    key = f"{session.get('movie')}_{session.get('venueId')}_{session.get('date')}_{session.get('time')}"
                    if key not in seen_show_keys:
                        seen_show_keys.add(key)
                        all_sessions.append(session)
            except Exception as e:
                print(f"❌ Error processing {file_path}: {e}")
                
        # Write final aggregated file
        final_path = DATA_DIR / final_file
        with open(final_path, "w", encoding="utf-8") as f:
            json.dump(all_sessions, f, ensure_ascii=False, indent=2)
            
        print(f"✅ Created {final_file} with {len(all_sessions)} sessions from {len(shard_files)} shards.")
        
        # Cleanup shards
        for file_path in shard_files:
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"⚠️ Failed to remove {file_path}: {e}")

if __name__ == "__main__":
    aggregate_shards()
