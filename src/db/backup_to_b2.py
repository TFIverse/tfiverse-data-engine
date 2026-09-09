import os
import datetime
from pathlib import Path
import boto3
from botocore.config import Config

DATA_DIR = Path(__file__).parent.parent.parent / "data"

B2_KEY_ID = os.environ.get("B2_KEY_ID")
B2_APP_KEY = os.environ.get("B2_APPLICATION_KEY")
B2_BUCKET_NAME = os.environ.get("B2_BUCKET_NAME")
B2_ENDPOINT = os.environ.get("B2_ENDPOINT")

def backup_file(filename, prefix):
    file_path = DATA_DIR / filename
    if not file_path.exists():
        print(f"⚠️ Cannot backup {filename} - file not found.")
        return
        
    if not all([B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, B2_ENDPOINT]):
        print("⚠️ Missing B2 credentials. Skipping backup.")
        return

    # Initialize B2 S3 Client
    b2 = boto3.client(
        service_name='s3',
        endpoint_url=f"https://{B2_ENDPOINT}",
        aws_access_key_id=B2_KEY_ID,
        aws_secret_access_key=B2_APP_KEY,
        config=Config(signature_version='s3v4')
    )
    
    # Generate timestamped filename for the historical chunk
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    timestamp = now.strftime("%Y-%m-%d_%H%M")
    date_folder = now.strftime("%Y-%m-%d")
    
    chunk_filename = f"chunks/{date_folder}/{prefix}_{timestamp}.json"
    latest_filename = f"LATEST_{prefix}.json"
    
    print(f"🔄 Uploading {filename} to B2 as {chunk_filename} and {latest_filename}...")
    try:
        # Upload the historical chunk
        b2.upload_file(str(file_path), B2_BUCKET_NAME, chunk_filename)
        # Upload the overwriting LATEST file so the VPS can easily fetch it
        b2.upload_file(str(file_path), B2_BUCKET_NAME, latest_filename)
        print(f"✅ Successfully backed up to B2")
    except Exception as e:
        print(f"❌ B2 Upload Error: {e}")

if __name__ == "__main__":
    print("📦 Starting Backblaze B2 Backup...")
    backup_file("latest_bms_data.json", "bms_live")
    backup_file("latest_bms_advance_data.json", "bms_advance")
    backup_file("latest_bms_deep_advance_data.json", "bms_deep_advance")
    backup_file("latest_paytm_data.json", "paytm_live")
    backup_file("latest_paytm_advance_data.json", "paytm_advance")
    backup_file("latest_paytm_deep_advance_data.json", "paytm_deep_advance")
