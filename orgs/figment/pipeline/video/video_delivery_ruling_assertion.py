"""Bind an externally-authored, self-reported review claim to current prepared
vertical-video delivery evidence.

This module is a read-only *assertion reader*: it does not author rulings,
does not select "latest" anything, does not render or publish, and writes no
persistent artifacts of its own. It reuses the reviewed, frozen
``video_delivery_review.py`` native-authority path (``validate_prepared_delivery``)
and its private path/snapshot helpers rather than re-implementing any
decoding, probing, or hashing logic.

A ruling assertion is a claim, not a fact. Binding it to a content hash only
proves the claim was made about *this* exact evidence at read time -- it says
nothing about whether the claim is true, who actually made it, or whether the
claimed review ever happened.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
delivery = None  # populated below via the module's own load pattern


def _load_delivery_module() -> Any:
    path = HERE / "video_delivery_review.py"
    spec = importlib.util.spec_from_file_location(
        "figment_video_delivery_ruling_assertion_delivery_review", path,
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


delivery = _load_delivery_module()

RULING_SCHEMA = "figment/video-delivery-ruling-assertion@1"
RESULT_SCHEMA = "figment/video-delivery-ruling-result@1"
MAX_RULING_BYTES = 64 * 1024
MAX_NOTES_CHARS = 4096

RULING_KEYS = frozenset({
    "schema", "bound_subject_sha256", "bound_review_directory",
    "playback_observation", "correspondence_review", "temporal_review",
    "detail_crop_review", "template_fit_review", "audio_presence_claim",
    "audio_licensing_review", "audio_mix_sync_review", "notes",
    "unauthenticated_attribution", "recorded_at",
})
PASS_FAIL_INCOMPLETE = frozenset({"pass", "fail", "incomplete"})
AUDIO_REVIEW_VALUES = frozenset({"pass", "fail", "incomplete", "not_applicable"})

LIMITATIONS = (
    "playback_observation, correspondence_review, temporal_review, "
    "detail_crop_review, template_fit_review, and all audio_* fields are "
    "self-reported claims by the declared attribution, not observations "
    "made by this reader.",
    "The bound_subject_sha256/bound_review_directory match and the "
    "ruling_file hash only prove this claim is bound to the current "
    "prepared evidence at read time; they do not prove the claim is true.",
    "unauthenticated_attribution is an unverified, self-declared string; "
    "no authentication of the claimed author was performed.",
    "No human review of the video was observed or performed by this "
    "reader; it never watches, decodes, or renders the media itself.",
    "This reader grants no delivery, media-quality, promotion, or "
    "publication authority; not_promotable is always true.",
    "The reused prepared-delivery store (video_delivery_review.py) has "
    "its own separately documented technical limitations.",
    "Equality checks across the two validate_prepared_delivery calls and "
    "the two byte snapshots establish cooperative freshness only; they "
    "are not atomicity guarantees against a hostile concurrent writer.",
)


class VideoDeliveryRulingAssertionError(ValueError):
    """Raised when a ruling assertion is unsafe, stale, or malformed."""


def _fail(message: str) -> VideoDeliveryRulingAssertionError:
    return VideoDeliveryRulingAssertionError(message)


def _reject_embedded_nul(value: Path, label: str) -> None:
    if "\x00" in os.fspath(value):
        raise _fail(f"{label} must not contain an embedded NUL byte")


def _validate_projection(root: Path, evaluation_path: Path) -> dict[str, Any]:
    try:
        return delivery.validate_prepared_delivery(root, evaluation_path)
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc


def _contained_ruling_path(root: Path, relative: Path, label: str) -> Path:
    try:
        _, absolute = delivery._within(root, relative, label)
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc
    return absolute


def _snapshot_ruling(absolute: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    try:
        return delivery._absolute_snapshot(absolute, label, MAX_RULING_BYTES)
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"ruling assertion JSON has a duplicate key: {key!r}")
        seen[key] = value
    return seen


def _reject_nonfinite(text: str) -> Any:
    raise ValueError(f"ruling assertion JSON contains a non-finite number: {text}")


def _decode_ruling(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8", errors="strict")
        parsed = json.loads(
            text, object_pairs_hook=_reject_duplicate_keys, parse_constant=_reject_nonfinite,
        )
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise _fail("ruling assertion file is not well-formed JSON") from exc
    try:
        delivery._bounded(parsed, "ruling assertion")
        parsed = delivery._exact(parsed, set(RULING_KEYS), "ruling assertion")
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc
    if parsed["schema"] != RULING_SCHEMA:
        raise _fail("ruling assertion schema is unsupported")
    return parsed


def _enum(value: Any, choices: frozenset[str], label: str) -> str:
    if not isinstance(value, str) or value not in choices:
        raise _fail(f"{label} must be one of {sorted(choices)}")
    return value


def _validate_ruling_shape(parsed: dict[str, Any]) -> None:
    try:
        delivery._digest(parsed["bound_subject_sha256"], "bound_subject_sha256")
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc
    if not isinstance(parsed["bound_review_directory"], str) or not parsed["bound_review_directory"]:
        raise _fail("bound_review_directory must be a non-empty string")

    _enum(parsed["playback_observation"], frozenset({"watched_full", "not_watched"}), "playback_observation")
    for field in ("correspondence_review", "temporal_review", "detail_crop_review", "template_fit_review"):
        _enum(parsed[field], PASS_FAIL_INCOMPLETE, field)
    _enum(parsed["audio_presence_claim"], frozenset({"present", "absent", "unassessed"}), "audio_presence_claim")
    for field in ("audio_licensing_review", "audio_mix_sync_review"):
        _enum(parsed[field], AUDIO_REVIEW_VALUES, field)

    claim = parsed["audio_presence_claim"]
    licensing = parsed["audio_licensing_review"]
    mix_sync = parsed["audio_mix_sync_review"]
    if claim == "absent" and not (licensing == "not_applicable" and mix_sync == "not_applicable"):
        raise _fail("audio_presence_claim=absent requires both audio reviews to be not_applicable")
    if claim == "present" and (licensing == "not_applicable" or mix_sync == "not_applicable"):
        raise _fail("audio_presence_claim=present forbids a not_applicable audio review")
    if claim == "unassessed" and not (licensing == "incomplete" and mix_sync == "incomplete"):
        raise _fail("audio_presence_claim=unassessed requires both audio reviews to be incomplete")

    notes = parsed["notes"]
    if not isinstance(notes, str) or len(notes) > MAX_NOTES_CHARS:
        raise _fail(f"notes must be a string of at most {MAX_NOTES_CHARS} characters")
    if any(0xD800 <= ord(character) <= 0xDFFF for character in notes):
        raise _fail("notes must not contain an unpaired surrogate")

    attribution = parsed["unauthenticated_attribution"]
    if not isinstance(attribution, str) or not delivery.ATTRIBUTION_RE.fullmatch(attribution):
        raise _fail(
            "unauthenticated_attribution must be a bounded plain identifier with no "
            "leading or trailing whitespace",
        )

    try:
        delivery._timestamp(parsed["recorded_at"])
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc


def _derived_outcome(parsed: dict[str, Any]) -> str:
    reviews = (
        parsed["correspondence_review"], parsed["temporal_review"],
        parsed["detail_crop_review"], parsed["template_fit_review"],
        parsed["audio_licensing_review"], parsed["audio_mix_sync_review"],
    )
    if "fail" in reviews:
        return "reported_fail"
    if (
        parsed["playback_observation"] != "watched_full"
        or "incomplete" in reviews
        or parsed["audio_presence_claim"] == "unassessed"
    ):
        return "reported_incomplete"
    return "reported_pass"


def _read_ruling_assertion(*, root: Path, evaluation_path: Path, ruling_path: Path) -> dict[str, Any]:
    _reject_embedded_nul(root, "root")
    _reject_embedded_nul(evaluation_path, "evaluation path")
    _reject_embedded_nul(ruling_path, "ruling assertion path")

    root = delivery._root(root)
    ruling_relative = delivery._lexical_relative(ruling_path, "ruling assertion path")
    delivery._lexical_relative(evaluation_path, "evaluation path")
    review_parent = delivery.REVIEW_PARENT.casefold()
    if any(part.casefold() == review_parent for part in ruling_relative.parts):
        raise _fail(
            f"ruling assertion path may not traverse the canonical review parent {delivery.REVIEW_PARENT!r}",
        )

    projection_first = _validate_projection(root, evaluation_path)
    review_directory = Path(projection_first["review_directory"])
    if ruling_relative == review_directory or review_directory in ruling_relative.parents:
        raise _fail("ruling assertion path may not be inside the canonical delivery review directory")

    absolute_first = _contained_ruling_path(root, ruling_relative, "ruling assertion file")
    raw_first, entry_first = _snapshot_ruling(absolute_first, "ruling assertion file")

    parsed = _decode_ruling(raw_first)
    _validate_ruling_shape(parsed)

    if parsed["bound_subject_sha256"] != projection_first["subject_sha256"]:
        raise _fail("bound_subject_sha256 does not match the current prepared delivery subject")
    if parsed["bound_review_directory"] != projection_first["review_directory"]:
        raise _fail("bound_review_directory does not match the current prepared delivery review directory")

    derived_outcome = _derived_outcome(parsed)

    projection_second = _validate_projection(root, evaluation_path)
    try:
        delivery._same(projection_second, projection_first, "revalidated delivery projection")
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc

    absolute_second = _contained_ruling_path(root, ruling_relative, "ruling assertion file")
    raw_second, entry_second = _snapshot_ruling(absolute_second, "ruling assertion file")
    if raw_second != raw_first or entry_second != entry_first:
        raise _fail("ruling assertion file changed while its delivery evidence was being revalidated")

    return {
        "schema": RESULT_SCHEMA,
        "projection": copy.deepcopy(projection_second),
        "ruling": copy.deepcopy(parsed),
        "ruling_file": {
            "path": ruling_relative.as_posix(),
            "bytes": entry_first["bytes"],
            "sha256": entry_first["sha256"],
        },
        "derived_outcome": derived_outcome,
        "not_promotable": True,
        "attribution_authenticated": False,
        "limitations": list(LIMITATIONS),
    }


def read_ruling_assertion(*, root: Path, evaluation_path: Path, ruling_path: Path) -> dict[str, Any]:
    """Read one self-reported ruling assertion, bound to current prepared-delivery evidence."""
    try:
        return _read_ruling_assertion(root=root, evaluation_path=evaluation_path, ruling_path=ruling_path)
    except VideoDeliveryRulingAssertionError:
        raise
    except delivery.VideoDeliveryReviewError as exc:
        raise _fail(str(exc)) from exc
    except (ValueError, TypeError, OSError, RecursionError) as exc:
        raise _fail("ruling assertion could not be read") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    read_parser = subparsers.add_parser("read")
    read_parser.add_argument("--root", required=True, type=Path)
    read_parser.add_argument("--evaluation", required=True, type=Path)
    read_parser.add_argument("--ruling", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        record = read_ruling_assertion(
            root=args.root, evaluation_path=args.evaluation, ruling_path=args.ruling,
        )
    except VideoDeliveryRulingAssertionError as exc:
        parser.error(str(exc))
    except delivery.VideoDeliveryReviewError as exc:
        parser.error(str(exc))
    print(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
