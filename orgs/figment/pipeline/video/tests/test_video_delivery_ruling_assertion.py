from __future__ import annotations

"""Contract tests for the bounded video-delivery ruling assertion reader.

Reuses the real local producer chain and ``accepted_base`` fixture from
test_video_delivery_review.py rather than rebuilding an authority chain twice.
The target module (video_delivery_ruling_assertion.py) is authored
independently; these tests exercise only its documented contract.
"""

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

import test_video_delivery_review as delivery_tests

VIDEO_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = VIDEO_DIR / "video_delivery_ruling_assertion.py"


def _load_target():
    spec = importlib.util.spec_from_file_location(
        "figment_video_delivery_ruling_assertion_test", MODULE_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


target = _load_target()

# The target module is expected to hold its imported preparation/validation
# module under the attribute name ``delivery`` (per authoring brief). Tests
# that need to instrument or stub real-chain calls patch this exact object,
# never the copy imported directly by this test file.
product_delivery = target.delivery

# Re-export for pytest fixture discovery in this module's namespace.
accepted_base = delivery_tests.accepted_base

RULING_DIR = Path("delivery-rulings")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _base_ruling(subject_sha256: str, review_directory: str, **overrides: object) -> dict[str, object]:
    ruling: dict[str, object] = {
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
        "notes": "",
        "unauthenticated_attribution": "reviewer-1",
        "recorded_at": "2026-09-11T00:00:00Z",
    }
    ruling.update(overrides)
    return ruling


RULING_KEYS = {
    "schema", "bound_subject_sha256", "bound_review_directory", "playback_observation",
    "correspondence_review", "temporal_review", "detail_crop_review", "template_fit_review",
    "audio_presence_claim", "audio_licensing_review", "audio_mix_sync_review", "notes",
    "unauthenticated_attribution", "recorded_at",
}

RESULT_KEYS = {
    "schema", "projection", "ruling", "ruling_file", "derived_outcome",
    "not_promotable", "attribution_authenticated", "limitations",
}


def _write_ruling_text(root: Path, relative: Path, text: str) -> Path:
    full = root / relative
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(text.encode("utf-8"))
    return full


def _write_ruling(root: Path, relative: Path, ruling: dict[str, object]) -> Path:
    return _write_ruling_text(root, relative, json.dumps(ruling, ensure_ascii=False, sort_keys=True) + "\n")


def _unique_name(suffix: str = ".json") -> Path:
    return RULING_DIR / f"{uuid.uuid4().hex}{suffix}"


# ---------------------------------------------------------------------------
# Real-chain fixture: exactly one canonical prepared subject for this module.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def chain(accepted_base: tuple[Path, Path, dict[str, object], Path]) -> dict[str, object]:
    root, accepted, authority, declaration = accepted_base
    derivative = root / "delivery.mp4"
    evaluation = delivery_tests._prepare(root, authority, declaration, derivative)
    evaluation_relative = Path(evaluation["review_directory"]) / delivery_tests.delivery.EVALUATION_NAME
    return {
        "root": root,
        "accepted": accepted,
        "declaration": declaration,
        "derivative": derivative,
        "evaluation": evaluation,
        "evaluation_path": evaluation_relative,
        "review_directory": evaluation["review_directory"],
        "subject_sha256": evaluation["subject_sha256"],
    }


def _snapshot_chain_bytes(chain: dict[str, object]) -> dict[Path, bytes]:
    root: Path = chain["root"]  # type: ignore[assignment]
    paths = [chain["accepted"], chain["declaration"], chain["derivative"], root / chain["evaluation_path"]]
    return {p: p.read_bytes() for p in paths}


@pytest.fixture
def preserve_chain(chain: dict[str, object]):
    snapshot = _snapshot_chain_bytes(chain)
    try:
        yield chain
    finally:
        for path, original in snapshot.items():
            path.write_bytes(original)


# ---------------------------------------------------------------------------
# Synthetic fixture: fast, isolated tmp_path with validate_prepared_delivery
# mocked on the product's own ``delivery`` attribute. Never used to fabricate
# a positive real-authority acceptance -- only for input-shape / outcome-logic
# unit coverage that does not depend on real media evidence.
# ---------------------------------------------------------------------------


@pytest.fixture
def synthetic(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    subject_sha256 = "b" * 64
    review_directory = f"clips/video-delivery-review/{subject_sha256}"
    fake_projection = {
        "schema": "figment/video-delivery-evaluation-inputs@1",
        "status": "prepared",
        "not_promotable": True,
        "review_directory": review_directory,
        "subject_sha256": subject_sha256,
        "subject": {"identity": {"sha256": subject_sha256}},
    }

    def fake_validate(root_arg: Path, evaluation_arg: Path) -> dict[str, object]:
        return copy.deepcopy(fake_projection)

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", fake_validate)
    evaluation_relative = Path(review_directory) / "evaluation-inputs.json"
    return {
        "root": tmp_path,
        "evaluation_path": evaluation_relative,
        "review_directory": review_directory,
        "subject_sha256": subject_sha256,
        "projection": fake_projection,
    }


def _read(root: Path, evaluation_path: Path, ruling_path: Path) -> dict[str, object]:
    return target.read_ruling_assertion(root=root, evaluation_path=evaluation_path, ruling_path=ruling_path)


# ---------------------------------------------------------------------------
# Real chain: positive flow, call counts, no writes, byte stability.
# ---------------------------------------------------------------------------


def test_real_chain_reports_pass_with_bounded_validator_calls(
    chain: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    ruling = _base_ruling(chain["subject_sha256"], chain["review_directory"])
    _write_ruling(root, ruling_relative, ruling)

    prepared_calls: list[Path] = []
    actual_prepared = product_delivery.validate_prepared_delivery

    def counted_prepared(root_arg: Path, evaluation_arg: Path) -> dict[str, object]:
        prepared_calls.append(evaluation_arg)
        return actual_prepared(root_arg, evaluation_arg)

    native_calls: list[Path] = []
    actual_native = product_delivery.video_review.validate_accepted_video

    def counted_native(root_arg: Path, accepted_arg: Path) -> dict[str, object]:
        native_calls.append(accepted_arg)
        return actual_native(root_arg, accepted_arg)

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", counted_prepared)
    monkeypatch.setattr(product_delivery.video_review, "validate_accepted_video", counted_native)

    before = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
    result = _read(root, chain["evaluation_path"], ruling_relative)
    after = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))

    assert len(prepared_calls) == 2
    assert len(native_calls) == 4
    assert set(result) == RESULT_KEYS
    assert result["schema"] == "figment/video-delivery-ruling-result@1"
    assert result["derived_outcome"] == "reported_pass"
    assert result["not_promotable"] is True
    assert result["attribution_authenticated"] is False
    assert result["ruling"] == ruling
    ruling_file = result["ruling_file"]
    assert set(ruling_file) == {"path", "bytes", "sha256"}
    assert Path(ruling_file["path"]).as_posix() == ruling_relative.as_posix()
    assert ruling_file["sha256"] == _sha(root / ruling_relative)
    assert ruling_file["bytes"] == (root / ruling_relative).stat().st_size
    assert after == before, "read_ruling_assertion must not create or remove any files"


def test_real_chain_second_call_matches_first_byte_for_byte(chain: dict[str, object]) -> None:
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    _write_ruling(root, ruling_relative, _base_ruling(chain["subject_sha256"], chain["review_directory"]))
    first = _read(root, chain["evaluation_path"], ruling_relative)
    second = _read(root, chain["evaluation_path"], ruling_relative)
    assert first["ruling_file"]["sha256"] == second["ruling_file"]["sha256"]
    assert first == second
    assert first["limitations"] == second["limitations"]
    assert first["limitations"] is not second["limitations"], "limitations must be a fresh copy, not aliased"


def test_real_chain_stale_bound_subject_is_refused(preserve_chain: dict[str, object]) -> None:
    chain = preserve_chain
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    _write_ruling(root, ruling_relative, _base_ruling(chain["subject_sha256"], chain["review_directory"]))
    # Cooperative mutation of the derivative after the ruling was bound: the
    # stored subject digest can no longer be reconstructed from evidence.
    derivative: Path = chain["derivative"]  # type: ignore[assignment]
    original = derivative.read_bytes()
    derivative.write_bytes(original[:-1] + bytes([original[-1] ^ 0xFF]))
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(root, chain["evaluation_path"], ruling_relative)


def test_real_chain_ruling_mutated_after_second_authority_is_detected(
    preserve_chain: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    chain = preserve_chain
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    ruling_full = _write_ruling(root, ruling_relative, _base_ruling(chain["subject_sha256"], chain["review_directory"]))
    original_bytes = ruling_full.read_bytes()

    call_count = 0
    actual_prepared = product_delivery.validate_prepared_delivery

    def wrapped(root_arg: Path, evaluation_arg: Path) -> dict[str, object]:
        nonlocal call_count
        call_count += 1
        result = actual_prepared(root_arg, evaluation_arg)
        if call_count == 2:
            # Mutate the ruling file after the second authority check has
            # completed, before the module's own post-authority reread.
            mutated = json.loads(original_bytes.decode("utf-8"))
            mutated["notes"] = "mutated-between-second-authority-and-final-reread"
            ruling_full.write_text(json.dumps(mutated, sort_keys=True) + "\n", encoding="utf-8")
        return result

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", wrapped)
    try:
        with pytest.raises(target.VideoDeliveryRulingAssertionError):
            _read(root, chain["evaluation_path"], ruling_relative)
        assert call_count == 2
    finally:
        ruling_full.write_bytes(original_bytes)


def test_real_chain_authority_projection_drift_between_calls_rejected(
    preserve_chain: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    chain = preserve_chain
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    _write_ruling(root, ruling_relative, _base_ruling(chain["subject_sha256"], chain["review_directory"]))

    actual_prepared = product_delivery.validate_prepared_delivery
    call_count = 0

    def drifting(root_arg: Path, evaluation_arg: Path) -> dict[str, object]:
        nonlocal call_count
        call_count += 1
        projection = actual_prepared(root_arg, evaluation_arg)
        if call_count == 2:
            # Second authority read returns a different subject than the
            # first: a cheap stand-in for evidence being swapped mid-check.
            projection = copy.deepcopy(projection)
            projection["subject_sha256"] = "d" * 64
        return projection

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", drifting)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(root, chain["evaluation_path"], ruling_relative)
    assert call_count == 2


def test_synthetic_correct_subject_all_pass_cannot_launder_promotion_status(synthetic: dict[str, object]) -> None:
    # Even a ruling that binds the correct subject and self-reports all
    # reviews as passing must not be able to launder promotion/attribution
    # status: those are derived from the authority projection alone.
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)

    result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    assert result["derived_outcome"] == "reported_pass"
    assert result["not_promotable"] is True
    assert result["attribution_authenticated"] is False
    original_limitations = list(result["limitations"])

    result["limitations"].append("laundered-away")
    second = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    assert second["limitations"] == original_limitations


# ---------------------------------------------------------------------------
# CLI: one real end-to-end positive, one cheap malformed-lexical negative.
# ---------------------------------------------------------------------------


def test_cli_positive_matches_library_result(chain: dict[str, object]) -> None:
    # Product contract: `read --root --evaluation --ruling`.
    root: Path = chain["root"]  # type: ignore[assignment]
    ruling_relative = _unique_name()
    _write_ruling(root, ruling_relative, _base_ruling(chain["subject_sha256"], chain["review_directory"]))
    expected = _read(root, chain["evaluation_path"], ruling_relative)
    proc = subprocess.run(
        [
            sys.executable, str(MODULE_PATH), "read",
            "--root", str(root),
            "--evaluation", chain["evaluation_path"].as_posix(),
            "--ruling", ruling_relative.as_posix(),
        ],
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload == expected


def test_cli_malformed_missing_argument_is_cheap_lexical_error(tmp_path: Path) -> None:
    # `read` positional present but a required flag (--ruling) is absent.
    proc = subprocess.run(
        [sys.executable, str(MODULE_PATH), "read", "--root", str(tmp_path), "--evaluation", "e.json"],
        capture_output=True, text=True, timeout=15,
    )
    assert proc.returncode != 0
    assert proc.stdout.strip() == ""


def test_cli_unsafe_lexical_argument_rejected_cleanly(chain: dict[str, object]) -> None:
    # All required `read --root --evaluation --ruling` arguments are present,
    # but --ruling is an actual unsafe (path-escaping) value, not merely a
    # missing argument. Must be a clean domain rejection, not a traceback.
    root: Path = chain["root"]  # type: ignore[assignment]
    proc = subprocess.run(
        [
            sys.executable, str(MODULE_PATH), "read",
            "--root", str(root),
            "--evaluation", chain["evaluation_path"].as_posix(),
            "--ruling", "../escape.json",
        ],
        capture_output=True, text=True, timeout=15,
    )
    assert proc.returncode != 0
    assert proc.stdout.strip() == ""
    assert "Traceback" not in proc.stderr


# ---------------------------------------------------------------------------
# Synthetic: schema / scalar-type / extra / missing / duplicate / encoding.
# ---------------------------------------------------------------------------


def test_synthetic_valid_ruling_reports_pass(synthetic: dict[str, object]) -> None:
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"]))
    result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    assert result["derived_outcome"] == "reported_pass"
    assert set(result["ruling"]) == RULING_KEYS


@pytest.mark.parametrize("mutation", [
    lambda r: r.pop("schema"),
    lambda r: r.update(schema="figment/video-delivery-ruling-assertion@2"),
    lambda r: r.update(extra_field="unexpected"),
    lambda r: r.pop("notes"),
    lambda r: r.update(correspondence_review=1),
    lambda r: r.update(playback_observation=True),
    lambda r: r.update(bound_subject_sha256=None),
    lambda r: r.update(recorded_at=12345),
    lambda r: r.update(not_promotable=True),
    lambda r: r.update(derived_outcome="reported_pass"),
    lambda r: r.update(ruling_file={"path": "x", "bytes": 1, "sha256": "a" * 64}),
], ids=[
    "missing-schema", "wrong-schema-version", "unknown-extra-key", "missing-notes",
    "scalar-type-int-for-enum", "scalar-type-bool-for-enum", "null-for-required-string",
    "int-for-timestamp", "output-key-not_promotable-leaked-into-input",
    "output-key-derived_outcome-leaked-into-input", "output-key-ruling_file-leaked-into-input",
])
def test_synthetic_structural_violations_rejected(synthetic: dict[str, object], mutation) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    mutation(ruling)
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_duplicate_top_level_key_rejected(synthetic: dict[str, object]) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    canonical = json.dumps(ruling, sort_keys=True)
    injected = canonical[:-1] + ', "notes": "duplicate"}'
    ruling_relative = Path("ruling.json")
    _write_ruling_text(synthetic["root"], ruling_relative, injected)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_invalid_utf8_rejected(synthetic: dict[str, object]) -> None:
    ruling_relative = Path("ruling.json")
    full = synthetic["root"] / ruling_relative
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(b'{"schema": "figment/video-delivery-ruling-assertion@1", "notes": "\xff\xfe"}')
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_lone_surrogate_value_rejected(synthetic: dict[str, object]) -> None:
    ruling_relative = Path("ruling.json")
    full = synthetic["root"] / ruling_relative
    full.parent.mkdir(parents=True, exist_ok=True)
    # A raw lone surrogate encoded with surrogatepass; not valid UTF-8 text.
    full.write_bytes(b'{"schema": "figment/video-delivery-ruling-assertion@1", "notes": "\xed\xa0\x80"}')
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


@pytest.mark.parametrize("target_part", ["key", "value"])
def test_synthetic_escaped_unpaired_surrogate_rejected(synthetic: dict[str, object], target_part: str) -> None:
    # Valid ASCII/UTF-8 JSON *text* containing a `\ud800` escape sequence
    # (as opposed to the raw invalid-UTF-8-bytes case covered separately).
    # json.loads happily decodes this into a Python str holding a lone
    # surrogate code point; the reader must still reject it. Every other
    # top-level key stays a valid, closed ruling.
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    text = json.dumps(ruling, sort_keys=True)
    if target_part == "key":
        injected = text.replace('"notes"', '"no\\ud800tes"', 1)
    else:
        injected = text.replace('"notes": ""', '"notes": "bad\\ud800value"', 1)
    assert injected != text
    ruling_relative = Path("ruling.json")
    _write_ruling_text(synthetic["root"], ruling_relative, injected)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_non_finite_literal_rejected(synthetic: dict[str, object]) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    text = json.dumps(ruling, sort_keys=True)
    injected = text[:-1] + ', "extra_score": NaN}'
    ruling_relative = Path("ruling.json")
    _write_ruling_text(synthetic["root"], ruling_relative, injected)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_nested_bomb_rejected(synthetic: dict[str, object]) -> None:
    # Built as raw ASCII JSON text via string multiplication (never as a
    # Python object graph) so constructing the fixture itself cannot raise
    # RecursionError; the outer ruling stays a valid, closed object except
    # for this one deeply nested "notes" value.
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    ruling["notes"] = "__BOMB__"
    text = json.dumps(ruling, sort_keys=True)
    depth = 4000
    nested = ("[" * depth) + "0" + ("]" * depth)
    injected = text.replace('"__BOMB__"', nested, 1)
    assert len(injected.encode("utf-8")) <= 64 * 1024
    ruling_relative = Path("ruling.json")
    _write_ruling_text(synthetic["root"], ruling_relative, injected)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_oversized_file_rejected(synthetic: dict[str, object]) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    text = json.dumps(ruling, sort_keys=True)
    padded = text[:-1] + (" " * (70 * 1024)) + "}"
    assert len(padded.encode("utf-8")) > 64 * 1024
    ruling_relative = Path("ruling.json")
    _write_ruling_text(synthetic["root"], ruling_relative, padded)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


# ---------------------------------------------------------------------------
# Synthetic: enum domains, notes length, attribution, timestamp.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("field,bad_value", [
    ("playback_observation", "watched"),
    ("playback_observation", "not_watched "),
    ("correspondence_review", "unknown"),
    ("temporal_review", "PASS"),
    ("detail_crop_review", ""),
    ("template_fit_review", "not_applicable"),
    ("audio_presence_claim", "yes"),
    ("audio_licensing_review", "no"),
    ("audio_mix_sync_review", "n/a"),
])
def test_synthetic_enum_domain_violations_rejected(synthetic: dict[str, object], field: str, bad_value: str) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    ruling[field] = bad_value
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


@pytest.mark.parametrize("field,bad_value", [
    ("playback_observation", ["watched_full"]),
    ("playback_observation", {"value": "watched_full"}),
    ("playback_observation", False),
    ("correspondence_review", ["pass"]),
    ("correspondence_review", {"value": "pass"}),
    ("audio_presence_claim", ["absent"]),
    ("audio_presence_claim", {"value": "absent"}),
    ("audio_licensing_review", True),
])
def test_synthetic_enum_domain_violation_rejects_container_and_bool_types(
    synthetic: dict[str, object], field: str, bad_value: object,
) -> None:
    # Enum fields fed a list/dict/bool instead of a string must surface the
    # module's own domain error, not an uncaught TypeError from a bare
    # equality/membership check deeper in validation.
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    ruling[field] = bad_value  # type: ignore[assignment]
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


def test_synthetic_invalid_root_rejected_without_authority_call(
    synthetic: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_called(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("authority must not be called for a nonexistent root")

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", fail_if_called)
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"]))
    missing_root = synthetic["root"] / "does-not-exist"
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(missing_root, synthetic["evaluation_path"], ruling_relative)


def test_synthetic_ruling_embedded_nul_rejected_without_authority_call(
    synthetic: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_called(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("authority must not be called for a lexically invalid ruling")

    monkeypatch.setattr(product_delivery, "validate_prepared_delivery", fail_if_called)
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"])
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], Path("bad\x00ruling.json"))


def test_synthetic_notes_boundary_accepted_and_rejected(synthetic: dict[str, object]) -> None:
    ok = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"], notes="x" * 4096)
    ok_path = Path("ok.json")
    _write_ruling(synthetic["root"], ok_path, ok)
    result = _read(synthetic["root"], synthetic["evaluation_path"], ok_path)
    assert result["ruling"]["notes"] == "x" * 4096

    too_long = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"], notes="x" * 4097)
    bad_path = Path("bad.json")
    _write_ruling(synthetic["root"], bad_path, too_long)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], bad_path)


@pytest.mark.parametrize("value,valid", [
    ("reviewer-1", True),
    ("reviewer_1.a@b", True),
    ("a", True),
    ("a" * 128, True),
    ("a" * 129, False),
    ("", False),
    (" reviewer", False),
    ("reviewer ", False),
    ("-reviewer", False),
])
def test_synthetic_attribution_pattern_boundary(synthetic: dict[str, object], value: str, valid: bool) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"], unauthenticated_attribution=value)
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    if valid:
        result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
        assert result["ruling"]["unauthenticated_attribution"] == value
    else:
        with pytest.raises(target.VideoDeliveryRulingAssertionError):
            _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


@pytest.mark.parametrize("value,valid", [
    ("2026-09-11T00:00:00Z", True),
    ("2026-09-11T00:00:00+00:00", True),
    ("2026-09-11T00:00:00", False),
    ("2026-09-11", False),
    ("not-a-timestamp", False),
    ("", False),
])
def test_synthetic_recorded_at_boundary(synthetic: dict[str, object], value: str, valid: bool) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"], recorded_at=value)
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    if valid:
        result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
        assert result["ruling"]["recorded_at"] == value
    else:
        with pytest.raises(target.VideoDeliveryRulingAssertionError):
            _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


# ---------------------------------------------------------------------------
# Synthetic: subject/review-directory binding.
# ---------------------------------------------------------------------------


def test_synthetic_bound_subject_mismatch_rejected(synthetic: dict[str, object]) -> None:
    ruling = _base_ruling("c" * 64, synthetic["review_directory"])
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


@pytest.mark.parametrize("variant", [
    lambda directory: directory + "/",
    lambda directory: directory.replace("/", "\\"),
    lambda directory: directory.upper(),
    lambda directory: "clips/video-delivery-review/" + "b" * 63 + "c",
])
def test_synthetic_bound_review_directory_projection_mismatch_rejected(synthetic: dict[str, object], variant) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], variant(synthetic["review_directory"]))
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


# ---------------------------------------------------------------------------
# Synthetic: path safety for both evaluation_path and ruling_path.
# ---------------------------------------------------------------------------


def _valid_ruling_at(synthetic: dict[str, object], relative: Path) -> None:
    _write_ruling(synthetic["root"], relative, _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"]))


@pytest.mark.parametrize("make_bad_path", [
    lambda root: root / "ruling.json",
    lambda root: Path("/ruling.json"),
    lambda root: Path("C:ruling.json"),
    lambda root: Path("../ruling.json"),
    lambda root: Path("clips/../../ruling.json"),
])
def test_synthetic_ruling_path_rejects_unsafe_forms(synthetic: dict[str, object], make_bad_path) -> None:
    good_relative = Path("safe-ruling.json")
    _valid_ruling_at(synthetic, good_relative)
    bad = make_bad_path(synthetic["root"])
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], bad)


@pytest.mark.parametrize("make_bad_path", [
    lambda root: root / "evaluation-inputs.json",
    lambda root: Path("/evaluation-inputs.json"),
    lambda root: Path("C:evaluation-inputs.json"),
    lambda root: Path("../evaluation-inputs.json"),
])
def test_synthetic_evaluation_path_rejects_unsafe_forms(synthetic: dict[str, object], make_bad_path) -> None:
    good_relative = Path("safe-ruling.json")
    _valid_ruling_at(synthetic, good_relative)
    bad = make_bad_path(synthetic["root"])
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], bad, good_relative)


def test_synthetic_ruling_inside_canonical_review_tree_rejected(synthetic: dict[str, object]) -> None:
    inside = Path(synthetic["review_directory"]) / "extra-ruling.json"
    _valid_ruling_at(synthetic, inside)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], inside)


def test_synthetic_ruling_inside_case_varied_review_tree_rejected(synthetic: dict[str, object]) -> None:
    varied = synthetic["review_directory"].replace("video-delivery-review", "Video-Delivery-Review")
    inside = Path(varied) / "extra-ruling.json"
    _valid_ruling_at(synthetic, inside)
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(synthetic["root"], synthetic["evaluation_path"], inside)


def test_synthetic_ruling_path_symlink_rejected_or_skipped(synthetic: dict[str, object]) -> None:
    root: Path = synthetic["root"]  # type: ignore[assignment]
    real = root / "real-ruling.json"
    _write_ruling(root, Path("real-ruling.json"), _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"]))
    link = root / "linked-ruling.json"
    try:
        link.symlink_to(real)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 1314:
            pytest.skip("symlink creation requires elevated privilege on this host")
        raise
    with pytest.raises(target.VideoDeliveryRulingAssertionError):
        _read(root, synthetic["evaluation_path"], link.relative_to(root))


# ---------------------------------------------------------------------------
# Synthetic: audio-presence consistency.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("presence,licensing,mix_sync,valid", [
    ("absent", "not_applicable", "not_applicable", True),
    ("absent", "pass", "not_applicable", False),
    ("absent", "not_applicable", "incomplete", False),
    ("present", "pass", "pass", True),
    ("present", "fail", "incomplete", True),
    ("present", "not_applicable", "pass", False),
    ("present", "pass", "not_applicable", False),
    ("unassessed", "incomplete", "incomplete", True),
    ("unassessed", "pass", "incomplete", False),
    ("unassessed", "incomplete", "not_applicable", False),
])
def test_synthetic_audio_presence_consistency(
    synthetic: dict[str, object], presence: str, licensing: str, mix_sync: str, valid: bool,
) -> None:
    ruling = _base_ruling(
        synthetic["subject_sha256"], synthetic["review_directory"],
        audio_presence_claim=presence, audio_licensing_review=licensing, audio_mix_sync_review=mix_sync,
    )
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    if valid:
        _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    else:
        with pytest.raises(target.VideoDeliveryRulingAssertionError):
            _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)


# ---------------------------------------------------------------------------
# Synthetic: derived-outcome precedence.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("overrides,expected", [
    ({}, "reported_pass"),
    ({"audio_presence_claim": "present", "audio_licensing_review": "pass", "audio_mix_sync_review": "pass"}, "reported_pass"),
    ({"temporal_review": "fail"}, "reported_fail"),
    ({
        "audio_presence_claim": "present", "audio_licensing_review": "fail", "audio_mix_sync_review": "pass",
    }, "reported_fail"),
    ({"playback_observation": "not_watched"}, "reported_incomplete"),
    ({"correspondence_review": "incomplete"}, "reported_incomplete"),
    ({
        "audio_presence_claim": "unassessed", "audio_licensing_review": "incomplete", "audio_mix_sync_review": "incomplete",
    }, "reported_incomplete"),
    ({"temporal_review": "fail", "correspondence_review": "incomplete"}, "reported_fail"),
    ({"playback_observation": "not_watched", "detail_crop_review": "fail"}, "reported_fail"),
], ids=[
    "all-pass-watched-audio-absent", "all-pass-audio-present-pass",
    "single-core-fail", "audio-fail-with-other-pass",
    "not-watched-alone", "single-core-incomplete", "audio-unassessed-consistent-incomplete",
    "fail-beats-incomplete", "fail-beats-not-watched",
])
def test_synthetic_outcome_precedence(synthetic: dict[str, object], overrides: dict[str, object], expected: str) -> None:
    ruling = _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"], **overrides)
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, ruling)
    result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    assert result["derived_outcome"] == expected


# ---------------------------------------------------------------------------
# Synthetic: returned result shape invariants.
# ---------------------------------------------------------------------------


def test_synthetic_result_projection_matches_stubbed_authority(synthetic: dict[str, object]) -> None:
    ruling_relative = Path("ruling.json")
    _write_ruling(synthetic["root"], ruling_relative, _base_ruling(synthetic["subject_sha256"], synthetic["review_directory"]))
    result = _read(synthetic["root"], synthetic["evaluation_path"], ruling_relative)
    assert result["projection"] == synthetic["projection"]
    assert result["not_promotable"] is True
    assert result["attribution_authenticated"] is False
    assert isinstance(result["limitations"], list) and len(result["limitations"]) > 0
    for item in result["limitations"]:
        assert isinstance(item, str)
