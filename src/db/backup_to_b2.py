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
    
    # Generate timestamped filename
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    timestamp = now.strftime("%Y-%m-%d_%H%M")
    b2_filename = f"{prefix}_{timestamp}.json"
    
    print(f"🔄 Uploading {filename} to B2 as {b2_filename}...")
    try:
        b2.upload_file(str(file_path), B2_BUCKET_NAME, b2_filename)
        print(f"✅ Successfully backed up to B2: {b2_filename}")
    except Exception as e:
        print(f"❌ B2 Upload Error: {e}")

if __name__ == "__main__":
    print("📦 Starting Backblaze B2 Backup...")
    backup_file("latest_bms_data.json", "bms_live")
    backup_file("latest_bms_advance_data.json", "bms_advance")
