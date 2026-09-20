#!/usr/bin/env python3
"""
run_manifest_builder.py — Authoritative Pipeline Manifest & Atomic Pointer Protocol
TFIverse Box Office Platform (Phase 0 Baseline)

Responsibilities:
1. Validates scraper outputs (BMS & Paytm live and advance payloads) from runner's data/ directory.
2. Protects against publishing empty or corrupted payloads.
3. Computes cryptographic SHA-256 digests.
4. Generates immutable signed run manifests (manifests/YYYY-MM-DD/run_{run_id}.json).
5. Atomically publishes LATEST_PUBLISHED_RUN.json.
6. Uploads immutable run artifacts, manifest, and pointer to Backblaze B2.
"""

import os
import sys
import json
import shutil
import hashlib
import datetime
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
MANIFESTS_DIR = DATA_DIR / "manifests"

# B2 Configuration from Environment
B2_KEY_ID = os.environ.get("B2_KEY_ID")
B2_APP_KEY = os.environ.get("B2_APPLICATION_KEY")
B2_BUCKET_NAME = os.environ.get("B2_BUCKET_NAME")
B2_ENDPOINT = os.environ.get("B2_ENDPOINT")

def get_ist_now():
    """Return current datetime in Asia/Kolkata timezone."""
    ist_tz = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    return datetime.datetime.now(ist_tz)

def compute_sha256(file_path: Path) -> str:
    """Compute SHA-256 checksum of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

def validate_payload(file_path: Path, source_name: str, min_records: int = 1):
    """Validate that payload exists, is valid JSON, and contains records."""
    if not file_path.exists():
        raise FileNotFoundError(f"[{source_name}] Missing payload file: {file_path}")
    
    size_bytes = file_path.stat().st_size
    if size_bytes == 0:
        raise ValueError(f"[{source_name}] Empty file (0 bytes): {file_path}")
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise ValueError(f"[{source_name}] Malformed JSON in {file_path}: {e}")
    
    if not isinstance(data, list):
        raise ValueError(f"[{source_name}] Payload root must be a list, got {type(data).__name__}")
    
    records = len(data)
    if records < min_records:
        raise ValueError(f"[{source_name}] Payload has {records} records (minimum required: {min_records})")
    
    return records, size_bytes

def upload_to_b2(sources_manifest: dict, manifest_file: Path, manifest_key: str, pointer_file: Path):
    """Upload immutable run artifacts, signed manifest, and atomic pointer to Backblaze B2."""
    if not HAS_BOTO3:
        raise RuntimeError("🚨 boto3 is required for B2 upload but is not installed.")
    
    if not all([B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, B2_ENDPOINT]):
        print("⚠️ Missing B2 credentials. Skipping remote B2 upload.")
        return

    print(f"☁️ Initializing Backblaze B2 Client ({B2_ENDPOINT}, Bucket: {B2_BUCKET_NAME})...")
    b2 = boto3.client(
        service_name='s3',
        endpoint_url=f"https://{B2_ENDPOINT}",
        aws_access_key_id=B2_KEY_ID,
        aws_secret_access_key=B2_APP_KEY,
        config=Config(signature_version='s3v4')
    )

    # 1. Upload each validated source artifact
    for source_name, source_info in sources_manifest.items():
        rel_key = source_info["key"]
        local_src = DATA_DIR / rel_key
        print(f"   ⬆️ Uploading {source_name} -> {rel_key} ({source_info['records']} records, {source_info['size_bytes']} bytes)...")
        b2.upload_file(str(local_src), B2_BUCKET_NAME, rel_key)

    # 2. Upload signed manifest
    print(f"   ⬆️ Uploading manifest -> {manifest_key}...")
    b2.upload_file(str(manifest_file), B2_BUCKET_NAME, manifest_key)

    # 3. Atomically upload authoritative pointer
    print(f"   🎯 Atomically publishing LATEST_PUBLISHED_RUN.json to B2 root...")
    b2.upload_file(str(pointer_file), B2_BUCKET_NAME, "LATEST_PUBLISHED_RUN.json")
    print("✅ All artifacts, manifest, and atomic pointer published successfully to Backblaze B2!")

def build_manifest(run_id: str = None, dry_run: bool = False, skip_b2: bool = False):
    now_ist = get_ist_now()
    today_ist = now_ist.strftime("%Y-%m-%d")
    timestamp_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    if not run_id:
        run_id = f"run_{now_ist.strftime('%Y%m%d_%H%M%S')}"

    print(f"🔒 Building Immutable Run Manifest: {run_id} (Target Date IST: {today_ist})")

    bms_file = DATA_DIR / "latest_bms_data.json"
    paytm_file = DATA_DIR / "latest_paytm_data.json"
    bms_advance_file = DATA_DIR / "latest_bms_advance_data.json"
    paytm_advance_file = DATA_DIR / "latest_paytm_advance_data.json"

    # Destination directory for immutable run artifacts
    runs_dir = DATA_DIR / "runs" / today_ist / run_id
    if not dry_run:
        runs_dir.mkdir(parents=True, exist_ok=True)

    sources_manifest = {}
    total_records = 0
    shards_successful = 0
    shards_expected = 2

    # 1. BMS Live Validation & Immutable Archive
    try:
        bms_records, bms_size = validate_payload(bms_file, "BMS", min_records=1)
        bms_hash = compute_sha256(bms_file)
        bms_key = f"runs/{today_ist}/{run_id}/bms_live.json"
        
        if not dry_run:
            shutil.copy2(bms_file, runs_dir / "bms_live.json")

        sources_manifest["bms_live"] = {
            "key": bms_key,
            "records": bms_records,
            "sha256": bms_hash,
            "size_bytes": bms_size,
            "status": "VALIDATED"
        }
        total_records += bms_records
        shards_successful += 1
        print(f"   ✓ BMS Live: {bms_records} records, {bms_size} bytes (SHA-256: {bms_hash[:12]}...) -> {bms_key}")
    except Exception as e:
        print(f"   ❌ BMS Validation Failed: {e}")
        raise

    # 2. Paytm Live Validation & Immutable Archive
    try:
        paytm_records, paytm_size = validate_payload(paytm_file, "PAYTM", min_records=1)
        paytm_hash = compute_sha256(paytm_file)
        paytm_key = f"runs/{today_ist}/{run_id}/paytm_live.json"
        
        if not dry_run:
            shutil.copy2(paytm_file, runs_dir / "paytm_live.json")

        sources_manifest["paytm_live"] = {
            "key": paytm_key,
            "records": paytm_records,
            "sha256": paytm_hash,
            "size_bytes": paytm_size,
            "status": "VALIDATED"
        }
        total_records += paytm_records
        shards_successful += 1
        print(f"   ✓ Paytm Live: {paytm_records} records, {paytm_size} bytes (SHA-256: {paytm_hash[:12]}...) -> {paytm_key}")
    except Exception as e:
        print(f"   ❌ Paytm Validation Failed: {e}")
        raise

    # 3. Optional BMS Advance Files (if present and valid)
    if bms_advance_file.exists() and bms_advance_file.stat().st_size > 0:
        try:
            adv_records, adv_size = validate_payload(bms_advance_file, "BMS_ADVANCE", min_records=0)
            if adv_records > 0:
                adv_hash = compute_sha256(bms_advance_file)
                adv_key = f"runs/{today_ist}/{run_id}/bms_advance.json"
                if not dry_run:
                    shutil.copy2(bms_advance_file, runs_dir / "bms_advance.json")
                sources_manifest["bms_advance"] = {
                    "key": adv_key,
                    "records": adv_records,
                    "sha256": adv_hash,
                    "size_bytes": adv_size,
                    "status": "VALIDATED"
                }
                total_records += adv_records
                shards_expected += 1
                shards_successful += 1
                print(f"   ✓ BMS Advance: {adv_records} records (SHA-256: {adv_hash[:12]}...) -> {adv_key}")
        except Exception as e:
            print(f"   ⚠️ BMS Advance skipped: {e}")

    # 4. Optional Paytm Advance Files (if present and valid)
    if paytm_advance_file.exists() and paytm_advance_file.stat().st_size > 0:
        try:
            p_adv_records, p_adv_size = validate_payload(paytm_advance_file, "PAYTM_ADVANCE", min_records=0)
            if p_adv_records > 0:
                p_adv_hash = compute_sha256(paytm_advance_file)
                p_adv_key = f"runs/{today_ist}/{run_id}/paytm_advance.json"
                if not dry_run:
                    shutil.copy2(paytm_advance_file, runs_dir / "paytm_advance.json")
                sources_manifest["paytm_advance"] = {
                    "key": p_adv_key,
                    "records": p_adv_records,
                    "sha256": p_adv_hash,
                    "size_bytes": p_adv_size,
                    "status": "VALIDATED"
                }
                total_records += p_adv_records
                shards_expected += 1
                shards_successful += 1
                print(f"   ✓ Paytm Advance: {p_adv_records} records (SHA-256: {p_adv_hash[:12]}...) -> {p_adv_key}")
        except Exception as e:
            print(f"   ⚠️ Paytm Advance skipped: {e}")

    # Construct Manifest Object
    manifest = {
        "run_id": run_id,
        "target_date_ist": today_ist,
        "timestamp_utc": timestamp_utc,
        "status": "COMPLETE",
        "shards_expected": shards_expected,
        "shards_successful": shards_successful,
        "total_records": total_records,
        "sources": sources_manifest
    }

    manifest_json = json.dumps(manifest, indent=2)
    manifest_hash = hashlib.sha256(manifest_json.encode("utf-8")).hexdigest()
    manifest["manifest_sha256"] = manifest_hash

    # Atomic Pointer Object
    manifest_key = f"manifests/{today_ist}/run_{run_id}.json"
    pointer = {
        "current_run_id": run_id,
        "target_date_ist": today_ist,
        "manifest_key": manifest_key,
        "manifest_sha256": manifest_hash,
        "total_records": total_records,
        "published_at": timestamp_utc,
        "schema_version": "2.0.0"
    }

    if dry_run:
        print("🔍 Dry Run Mode — Generated structures:")
        print(json.dumps(pointer, indent=2))
        return manifest, pointer

    # Save Manifest locally
    date_manifest_dir = MANIFESTS_DIR / today_ist
    date_manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_file = date_manifest_dir / f"run_{run_id}.json"
    
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"📁 Manifest written to {manifest_file}")

    # Save Atomic Pointer locally
    pointer_file = DATA_DIR / "LATEST_PUBLISHED_RUN.json"
    temp_pointer_file = DATA_DIR / "LATEST_PUBLISHED_RUN.json.tmp"
    with open(temp_pointer_file, "w", encoding="utf-8") as f:
        json.dump(pointer, f, indent=2)
    temp_pointer_file.replace(pointer_file)
    print(f"🎯 Atomic Pointer written locally to {pointer_file}")

    # Remote Upload to Backblaze B2 (if not explicitly skipped)
    if not skip_b2:
        upload_to_b2(sources_manifest, manifest_file, manifest_key, pointer_file)

    return manifest, pointer

if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    skip_b2 = "--skip-b2" in sys.argv or "--local-only" in sys.argv
    try:
        build_manifest(dry_run=dry_run, skip_b2=skip_b2)
        print("✅ Run manifest and published pointer created successfully.")
    except Exception as e:
        print(f"🚨 Pipeline Aborted: {e}", file=sys.stderr)
        sys.exit(1)
