import os
import json
import datetime
import tempfile
import boto3
from botocore.config import Config

B2_KEY_ID = os.environ.get("B2_KEY_ID")
B2_APP_KEY = os.environ.get("B2_APPLICATION_KEY")
B2_BUCKET_NAME = os.environ.get("B2_BUCKET_NAME", "tfiverse-backups")
B2_ENDPOINT = os.environ.get("B2_ENDPOINT", "s3.us-west-004.backblazeb2.com")

def main():
    print("🌙 Starting Midnight Squash...")
    
    if not all([B2_KEY_ID, B2_APP_KEY]):
        print("⚠️ Missing B2 credentials. Exiting.")
        return

    # Initialize B2 S3 Client
    b2 = boto3.client(
        service_name='s3',
        endpoint_url=f"https://{B2_ENDPOINT}",
        aws_access_key_id=B2_KEY_ID,
        aws_secret_access_key=B2_APP_KEY,
        config=Config(signature_version='s3v4')
    )
    
    # Get today's date
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    date_folder = now.strftime("%Y-%m-%d")
    prefix = f"chunks/{date_folder}/"
    
    print(f"📂 Searching for chunks in prefix: {prefix}")
    
    try:
        response = b2.list_objects_v2(Bucket=B2_BUCKET_NAME, Prefix=prefix)
    except Exception as e:
        print(f"❌ Failed to list objects: {e}")
        return
        
    if 'Contents' not in response:
        print("⚠️ No chunks found for today. Exiting.")
        return
        
    chunk_keys = [obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.json')]
    print(f"📦 Found {len(chunk_keys)} chunks to squash.")
    
    # Dictionary to hold the absolute latest state of each showtime
    master_data = {
        "bms_live": {},
        "paytm_live": {},
        "bms_advance": {},
        "paytm_advance": {}
    }
    
    # We sort keys to process them in chronological order
    chunk_keys.sort()
    
    with tempfile.TemporaryDirectory() as tmpdir:
        for key in chunk_keys:
            filename = key.split("/")[-1]
            local_path = os.path.join(tmpdir, filename)
            print(f"⬇️ Downloading {filename}...")
            b2.download_file(B2_BUCKET_NAME, key, local_path)
            
            # Determine which category this chunk belongs to
            category = None
            for cat in master_data.keys():
                if filename.startswith(cat):
                    category = cat
                    break
                    
            if not category:
                continue
                
            with open(local_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            # Iterate through all sessions and overwrite the master dictionary
            # By the end of this loop, master_data[category] will have ONLY the final state
            # of every session at midnight, eliminating all duplicate history.
            for session in data:
                session_id = session.get("showId") or session.get("sessionId")
                if not session_id:
                    session_id = f"{session.get('venue')}_{session.get('movie')}_{session.get('time')}"
                master_data[category][session_id] = session
                
        # Now, upload the 4 squashed master files
        for category, sessions_dict in master_data.items():
            if not sessions_dict:
                continue
                
            squashed_array = list(sessions_dict.values())
            master_filename = f"archives/{date_folder}/FULL_DAY_{category}.json"
            master_local = os.path.join(tmpdir, f"FULL_{category}.json")
            
            with open(master_local, "w", encoding="utf-8") as f:
                json.dump(squashed_array, f)
                
            print(f"📤 Uploading Squashed Master: {master_filename} ({len(squashed_array)} sessions)")
            b2.upload_file(master_local, B2_BUCKET_NAME, master_filename)
            
        # Finally, delete the messy chunks to save space
        print("🧹 Cleaning up hourly chunks...")
        delete_objects = [{'Key': key} for key in chunk_keys]
        b2.delete_objects(Bucket=B2_BUCKET_NAME, Delete={'Objects': delete_objects})
        print(f"✅ Deleted {len(chunk_keys)} hourly chunks.")
        
    print("🎉 Midnight Squash Complete!")

if __name__ == "__main__":
    main()
