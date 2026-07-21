#!/usr/bin/env python3
"""write_publish_record.py — write the durable publish-record.json AFTER a successful upload.

Stage-0 law: a human approves EVERY publish and every upload goes out `private`. This script does not
upload and makes NO network calls; it is the record-keeping half of the publish-queue skill. The agent
performs the upload via the youtube-uploader MCP (credentials live in the MCP, never here), then calls
this immediately so the video_id is captured on disk.

Usage:
    py -3 write_publish_record.py <video_dir> --video-id <id> --timestamp <iso8601>

The record it writes (exact schema, key order preserved):
    {
      "video_id":          "<id>",
      "url":               "https://www.youtube.com/watch?v=<id>",
      "uploaded_at":       "<iso8601, caller-supplied via --timestamp>",
      "privacy_status":    "private",
      "file_sha256":       "<streamed sha256 of assets/final.mp4>",
      "metadata_snapshot": { ...full parsed metadata.json... }
    }

Notes:
  * `--timestamp` is REQUIRED and caller-supplied — no ambient clock. The runner passes the moment the
    upload completed so the record is reproducible and the writer stays side-effect-free of wall time.
  * The sha256 is STREAMED in chunks — final.mp4 can be ~1 GB, so we never slurp it into memory.
  * Idempotent by refusal: if publish-record.json already exists this EXITS 2 and touches nothing. A
    record is the proof of a completed publish; overwriting it would erase the video_id of the live
    upload. Re-running is therefore safe (it never clobbers).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

CHUNK = 1024 * 1024  # 1 MiB — final.mp4 can be ~1 GB; stream it, never slurp.


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def build_record(video_id: str, timestamp: str, file_sha256: str, metadata: dict) -> dict:
    # Insertion order IS the on-disk key order (json.dump preserves it).
    return {
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "uploaded_at": timestamp,
        "privacy_status": "private",
        "file_sha256": file_sha256,
        "metadata_snapshot": metadata,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Write publish-record.json after a private upload.")
    parser.add_argument("video_dir", type=Path)
    parser.add_argument("--video-id", required=True, help="YouTube video id returned by upload_video")
    parser.add_argument(
        "--timestamp",
        required=True,
        help="ISO-8601 upload time, caller-supplied (no ambient clock)",
    )
    args = parser.parse_args(argv)

    video_dir: Path = args.video_dir
    if not video_dir.is_dir():
        sys.stderr.write(f"not a directory: {video_dir}\n")
        return 1

    record_path = video_dir / "publish-record.json"
    if record_path.exists():
        # Refuse to overwrite — the existing record is the proof of a live upload.
        try:
            existing = json.loads(record_path.read_text(encoding="utf-8")).get("video_id", "<unknown>")
        except Exception:
            existing = "<unreadable-record>"
        sys.stderr.write(f"already published: {existing} — refusing to overwrite {record_path}\n")
        return 2

    final_mp4 = video_dir / "assets" / "final.mp4"
    if not final_mp4.exists():
        sys.stderr.write(f"assets/final.mp4 not found: {final_mp4}\n")
        return 1

    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        sys.stderr.write(f"metadata.json not found: {metadata_path}\n")
        return 1
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    record = build_record(
        video_id=args.video_id,
        timestamp=args.timestamp,
        file_sha256=sha256_file(final_mp4),
        metadata=metadata,
    )
    record_path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sys.stdout.write(f"wrote {record_path} (video_id={args.video_id}, private)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
