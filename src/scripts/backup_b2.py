import os
import gzip
import shutil
import datetime
from pathlib import Path
from b2sdk.v2 import InMemoryAccountInfo, B2Api

DATA_DIR = Path(__file__).parent.parent.parent / "data"

B2_KEY_ID = os.environ.get("B2_KEY_ID")
B2_APPLICATION_KEY = os.environ.get("B2_APPLICATION_KEY")
B2_BUCKET_NAME = os.environ.get("B2_BUCKET_NAME", "tfiverse-boxoffice-backups")

def main():
    if not B2_KEY_ID or not B2_APPLICATION_KEY:
        print("⚠️ B2_KEY_ID or B2_APPLICATION_KEY not set. Skipping backup.")
        return

    print("🚀 Starting B2 Midnight Backup...")
    info = InMemoryAccountInfo()
    b2_api = B2Api(info)
    b2_api.authorize_account("production", B2_KEY_ID, B2_APPLICATION_KEY)
    bucket = b2_api.get_bucket_by_name(B2_BUCKET_NAME)

    today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    archive_name = f"{today}_FINAL.tar.gz"
    archive_path = DATA_DIR / archive_name
    
    # Create tar.gz of the data directory JSON files
    import tarfile
    with tarfile.open(archive_path, "w:gz") as tar:
        for json_file in DATA_DIR.glob("*.json"):
            tar.add(json_file, arcname=json_file.name)

    print(f"📦 Compressed to {archive_path.stat().st_size / 1024:.2f} KB.")

    # Upload to B2
    remote_path = f"backups/{today.split('-')[0]}/{today.split('-')[1]}/{archive_name}"
    print(f"☁️ Uploading to B2: {remote_path}...")
    
    bucket.upload_local_file(
        local_file=str(archive_path),
        file_name=remote_path
    )
    
    print("✅ Backup successful!")
    
    # Cleanup
    os.remove(archive_path)

if __name__ == "__main__":
    main()
