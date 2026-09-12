"""Build one real, local Figment video-ruling reader integration fixture.

This is test-only synthetic mechanics evidence. It reuses the accepted native
video and delivery helpers without mocking their compilers or validators, and
writes one explicitly self-reported claim outside the immutable review store.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
VIDEO_TEST_DIR = REPO_ROOT / "orgs" / "figment" / "pipeline" / "video" / "tests"
if not VIDEO_TEST_DIR.is_dir():
    raise RuntimeError("Figment video test helpers are unavailable")
sys.path.insert(0, str(VIDEO_TEST_DIR))

import test_video_delivery_review as delivery_tests  # noqa: E402


DESCRIPTOR_SCHEMA = "figment/video-ruling-real-join-fixture@1"
RULING_RELATIVE = Path("delivery-rulings") / "studio-integration-claim.json"
PRIVATE_NOTE = "fixture-private-self-reported-note"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _fresh_local_root(raw: str) -> Path:
    root = Path(raw)
    if not root.is_absolute() or root.drive.startswith("\\\\"):
        raise ValueError("fixture root must be an absolute local path")
    if not root.is_dir() or root.is_symlink():
        raise ValueError("fixture root must be an existing local directory")
    if any(root.iterdir()):
        raise ValueError("fixture root must be fresh and empty")
    return root


def _write_claim(root: Path, subject_sha256: str, review_directory: str) -> Path:
    claim = {
        "schema": "figment/video-delivery-ruling-assertion@1",
        "bound_subject_sha256": subject_sha256,
        "bound_review_directory": review_directory,
        "playback_observation": "watched_full",
        "correspondence_review": "pass",
        "temporal_review": "pass",
        "detail_crop_review": "pass",
        "template_fit_review": "pass",
        "audio_presence_claim": "absent",
        "audio_licensing_review": "not_applicable",
        "audio_mix_sync_review": "not_applicable",
        "notes": PRIVATE_NOTE,
        "unauthenticated_attribution": "fixture-self-report",
        "recorded_at": "2026-09-12T00:00:00Z",
    }
    path = root / RULING_RELATIVE
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(claim, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def build(root: Path) -> dict[str, object]:
    _accepted, authority = delivery_tests._accepted_native_video(root)
    movie = authority["movie"]
    if not isinstance(movie, dict) or not isinstance(movie.get("path"), str):
        raise RuntimeError("accepted-video fixture did not produce a movie path")
    derivative = delivery_tests._derivative(root, root / movie["path"])
    declaration = delivery_tests._declaration(root, authority, derivative)
    evaluation = delivery_tests._prepare(root, authority, declaration, derivative)

    review_directory = evaluation["review_directory"]
    subject_sha256 = evaluation["subject_sha256"]
    if not isinstance(review_directory, str) or not isinstance(subject_sha256, str):
        raise RuntimeError("delivery fixture did not produce its bound subject")
    evaluation_relative = Path(review_directory) / delivery_tests.delivery.EVALUATION_NAME
    ruling_path = _write_claim(root, subject_sha256, review_directory)
    return {
        "schema": DESCRIPTOR_SCHEMA,
        "root": str(root),
        "evaluationPath": evaluation_relative.as_posix(),
        "rulingPath": RULING_RELATIVE.as_posix(),
        "subjectSha256": subject_sha256,
        "rulingSha256": _sha256(ruling_path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    args = parser.parse_args(argv)
    root = _fresh_local_root(args.root)
    print(json.dumps(build(root), ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
