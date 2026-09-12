"""Focused tests for the read-only nonpersona delivery-ruling validator.

The C/D/E fixtures use the real brief, preparation, native, retained, NVR, and
delivery producers.  The PNGs and external delivery-ruling files are synthetic
test evidence only: these tests establish bindings and parser behaviour, not a
human visual judgment about any image.
"""

from __future__ import annotations

import copy
import errno
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath

import pytest

from orgs.figment.pipeline.content import nonpersona_still_delivery as delivery
from orgs.figment.pipeline.content import nonpersona_still_delivery_ruling as ruling_mod
from orgs.figment.pipeline.content.tests.test_nonpersona_native import _snapshot, root
from orgs.figment.pipeline.content.tests.test_nonpersona_still_delivery import (
    _final,
    _live,
    _request,
    _ruling as _native_ruling,
)


Error = ruling_mod.NonpersonaStillDeliveryRulingError
ACCEPT = {
    "no_person": "pass",
    "scene_subject_fit": "pass",
    "realism": "pass",
    "crop_framing_integrity": "pass",
    "resize_color_quality": "pass",
    "obvious_artifacts": "none",
}
DECIDED_AT = "2026-09-11T00:00:00Z"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(root: Path, name: str, value: dict) -> tuple[str, str, bytes]:
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    (root / name).write_bytes(data)
    return name, _sha(data), data


def _write_raw(root: Path, name: str, data: bytes) -> tuple[str, str]:
    (root / name).write_bytes(data)
    return name, _sha(data)


def _rooted_without_drive(path: Path) -> str:
    absolute = path.resolve()
    rooted = absolute.as_posix()[len(absolute.drive):]
    assert rooted.startswith("/") and PureWindowsPath(rooted).root
    return rooted


def _validate(root: Path, path: str | Path, sha: str) -> dict:
    return ruling_mod.validate_nonpersona_still_delivery_ruling(
        root=root, path=path, expected_sha256=sha,
    )


def _delivery_ruling(root: Path, out: Path, receipt: dict, **overrides: object) -> dict:
    """External assertion copied from a real current producer receipt."""
    source = receipt["source_authority"]
    receipt_data = _final(root / out).read_bytes()
    value = {
        "schema": "figment/nonpersona-still-delivery-ruling@1",
        "delivery": {"out": out.as_posix(), "record_sha256": _sha(receipt_data)},
        "output": copy.deepcopy(receipt["output"]),
        "brief": copy.deepcopy(source["brief"]),
        "creator": source["creator"],
        "slot": copy.deepcopy(source["slot"]),
        "delivery_transform": copy.deepcopy(receipt["operation"]),
        "authority": "human-visual-ruling",
        "criteria": copy.deepcopy(ACCEPT),
        "decision": "accept-delivery",
        "decided_by": "synthetic-reviewer@example.test",
        "decided_at": DECIDED_AT,
        "note": "synthetic external assertion",
    }
    value.update(overrides)
    return value


def _materialized(root: Path, tag: str, taxonomy: str = "D") -> tuple[Path, dict]:
    """Build the complete real authority chain and one actual delivery receipt."""
    native_out, record = _live(root, tag, taxonomy)
    native_ruling = _native_ruling(root, native_out, record, tag)
    request = _request(root, native_ruling, [0, 0, 3, 4], name=f"q-{tag}.json")
    delivery_out = Path("out") / f"d-{tag}"
    receipt = delivery.materialize_nonpersona_still_delivery(
        root=root, request_path=request, out=delivery_out,
    )
    return delivery_out, receipt


def _static_ruling() -> dict:
    """Schema-valid until its missing delivery is consulted by the public API."""
    return {
        "schema": "figment/nonpersona-still-delivery-ruling@1",
        "delivery": {"out": "out/missing", "record_sha256": "0" * 64},
        "output": {
            "path": "delivery.png", "bytes": 1, "sha256": "0" * 64,
            "width": 1080, "height": 1440, "mode": "RGB", "rgb_sha256": "0" * 64,
        },
        "brief": {"path": "out/b.json", "sha256": "0" * 64},
        "creator": "figment",
        "slot": {"index": 1, "role": "scene role", "taxonomy_type": "D", "kind": "nonpersona"},
        "delivery_transform": {
            "op": "crop-resize", "coordinate_space": "stored-pixel-grid-half-open",
            "crop_box": [0, 0, 3, 4], "crop_dimensions": {"width": 3, "height": 4},
            "resample": "Pillow.Image.Resampling.LANCZOS",
            "color": "stored-untagged-RGB-no-conversion",
            "source_metadata_policy": (
                "reject-icc-gamma-srgb-chromaticity-transparency-strip-other-ancillary"
            ),
            "output_format": "PNG", "encoder": {"optimize": False, "compress_level": 9},
            "output_metadata": "none",
        },
        "authority": "human-visual-ruling", "criteria": copy.deepcopy(ACCEPT),
        "decision": "accept-delivery", "decided_by": "reviewer@example.test",
        "decided_at": DECIDED_AT, "note": "",
    }


@pytest.mark.parametrize(("taxonomy", "decided_at"), [
    ("C", "2026-09-11T00:00:00Z"),
    ("D", "2026-09-11T00:00:00.1Z"),
    ("E", "2026-09-11T00:00:00.123456Z"),
])
def test_real_cde_chain_binds_a_closed_nonpromotable_delivery_ruling(
    root: Path, taxonomy: str, decided_at: str,
) -> None:
    out, receipt = _materialized(root, f"c{taxonomy}", taxonomy)
    path, sha, data = _write(
        root, f"r{taxonomy}.json", _delivery_ruling(root, out, receipt, decided_at=decided_at),
    )
    before = _snapshot(root)

    result = _validate(root, path, sha)

    source = receipt["source_authority"]
    expected = {
        "schema": "figment/nonpersona-still-delivery-ruling-validation@1",
        "not_promotable": True,
        "ruling": {"path": path, "bytes": len(data), "sha256": sha},
        "delivery": {
            "out": out.as_posix(), "path": delivery.RECEIPT_NAME,
            "bytes": len(_final(root / out).read_bytes()),
            "sha256": _sha(_final(root / out).read_bytes()),
        },
        "output": receipt["output"], "brief": source["brief"], "creator": source["creator"],
        "slot": source["slot"], "delivery_transform": receipt["operation"],
        "authority": "human-visual-ruling", "criteria": ACCEPT,
        "decision": "accept-delivery", "decided_by": "synthetic-reviewer@example.test",
        "decided_at": decided_at, "note": "synthetic external assertion",
    }
    assert result == expected
    assert _snapshot(root) == before
    assert os.stat(_final(root / out)).st_nlink >= 2  # the canonical receipt is intentionally linkable
    assert not {
        "approved", "bindable", "slot_fit", "quality_pass", "ready", "delivered",
        "published", "authenticated", "verified",
    } & set(result)

    if taxonomy == "D":
        result["output"]["path"] = "mutated.png"
        repeat = _validate(root, Path(path), sha)
        assert repeat == expected
        assert repeat["output"] is not result["output"]

        research = _delivery_ruling(root, out, receipt, authority="research-disposition")
        research_path, research_sha, _ = _write(root, "research.json", research)
        research_result = _validate(root, research_path, research_sha)
        assert research_result["authority"] == "research-disposition"
        assert research_result["decision"] == "accept-delivery"
        assert research_result["not_promotable"] is True

        mixed = {
            "no_person": "not-assessed", "scene_subject_fit": "fail", "realism": "pass",
            "crop_framing_integrity": "not-assessed", "resize_color_quality": "fail",
            "obvious_artifacts": "present",
        }
        rejected = _delivery_ruling(
            root, out, receipt, authority="research-disposition", decision="reject", criteria=mixed,
        )
        reject_path, reject_sha, _ = _write(root, "reject.json", rejected)
        reject_result = _validate(root, reject_path, reject_sha)
        assert reject_result["authority"] == "research-disposition"
        assert reject_result["decision"] == "reject" and reject_result["criteria"] == mixed
        assert reject_result["not_promotable"] is True


@pytest.mark.parametrize(("field", "bad"), [
    ("no_person", "fail"), ("no_person", "not-assessed"),
    ("scene_subject_fit", "fail"), ("scene_subject_fit", "not-assessed"),
    ("realism", "fail"), ("realism", "not-assessed"),
    ("crop_framing_integrity", "fail"), ("crop_framing_integrity", "not-assessed"),
    ("resize_color_quality", "fail"), ("resize_color_quality", "not-assessed"),
    ("obvious_artifacts", "present"), ("obvious_artifacts", "not-assessed"),
])
def test_accept_requires_each_fresh_delivery_criterion(root: Path, field: str, bad: str) -> None:
    value = _static_ruling()
    value["criteria"][field] = bad
    path, sha, _ = _write(root, f"criterion-{field}-{bad}.json", value)
    with pytest.raises(Error, match="every delivery criterion"):
        _validate(root, path, sha)


def test_real_current_receipt_output_and_context_associations_are_exact(root: Path) -> None:
    """Reuse one immutable materialized chain for all exact association checks."""
    out, receipt = _materialized(root, "associations")
    cases = [
        ("receipt", lambda r: r["delivery"].update(record_sha256="0" * 64), "receipt differs"),
        ("output", lambda r: r["output"].update(bytes=r["output"]["bytes"] + 1), "output differs"),
        ("encoded-sha", lambda r: r["output"].update(sha256="0" * 64), "output differs"),
        ("rgb-sha", lambda r: r["output"].update(rgb_sha256="0" * 64), "output differs"),
        ("brief", lambda r: r["brief"].update(sha256="0" * 64), "brief differs"),
        ("creator", lambda r: r.update(creator="another creator"), "creator differs"),
        ("slot", lambda r: r["slot"].update(role="another scene role"), "slot differs"),
        ("slot-index", lambda r: r["slot"].update(index=r["slot"]["index"] + 1), "slot differs"),
        ("slot-taxonomy", lambda r: r["slot"].update(taxonomy_type="C"), "slot differs"),
        ("transform", lambda r: r["delivery_transform"].update(crop_box=[10, 20, 13, 24]), "transform differs"),
    ]
    for name, mutate, message in cases:
        external = _delivery_ruling(root, out, receipt)
        mutate(external)
        path, sha, _ = _write(root, f"a-{name}.json", external)
        before = _snapshot(root)
        with pytest.raises(Error, match=message):
            _validate(root, path, sha)
        assert _snapshot(root) == before

    # The final receipt is linkable by contract; the delivery PNG is not.
    good_path, good_sha, _ = _write(root, "good.json", _delivery_ruling(root, out, receipt))
    assert os.stat(_final(root / out)).st_nlink >= 2
    output = root / out / delivery.DELIVERY_NAME
    os.link(output, root / out / "output-alias.png")
    with pytest.raises(Error, match="current delivery rejected"):
        _validate(root, good_path, good_sha)


@pytest.mark.parametrize("case", ["ruling", "receipt", "output", "source"])
def test_late_mutation_is_detected_and_never_restored(
    root: Path, monkeypatch: pytest.MonkeyPatch, case: str,
) -> None:
    out, receipt = _materialized(root, f"late-{case}")
    path, sha, original_ruling = _write(root, f"late-{case}.json", _delivery_ruling(root, out, receipt))
    final = _final(root / out)
    output = root / out / delivery.DELIVERY_NAME
    source = root / Path(receipt["source_authority"]["retained"]["out"])
    source = source / receipt["source_authority"]["image"]["path"]
    target = {"ruling": root / path, "receipt": final, "output": output, "source": source}[case]
    original = target.read_bytes()
    changed = original + b"\n"
    assert original_ruling == (root / path).read_bytes()
    real_revalidate = ruling_mod.delivery.revalidate_nonpersona_still_delivery
    calls = 0

    def revalidate(*, root: Path, out: str | Path) -> dict:
        nonlocal calls
        result = real_revalidate(root=root, out=out)  # instrument the real authority; never substitute it
        calls += 1
        if calls == 1:
            target.write_bytes(changed)
        return result

    monkeypatch.setattr(ruling_mod.delivery, "revalidate_nonpersona_still_delivery", revalidate)
    with pytest.raises(Error):
        _validate(root, path, sha)
    assert calls >= 1
    assert target.exists() and target.read_bytes() == changed


@pytest.mark.parametrize(("name", "mutate", "message"), [
    ("top-extra", lambda r: r.update(extra=True), "delivery ruling must carry exactly"),
    ("top-missing", lambda r: r.pop("note"), "delivery ruling must carry exactly"),
    ("delivery-list", lambda r: r.update(delivery=[]), "delivery must carry exactly"),
    ("output-extra", lambda r: r["output"].update(extra=True), "output must carry exactly"),
    ("bytes-bool", lambda r: r["output"].update(bytes=True), "positive integer"),
    ("bytes-zero", lambda r: r["output"].update(bytes=0), "positive integer"),
    ("upper-sha", lambda r: r["output"].update(sha256="A" * 64), "lowercase hex"),
    ("mode", lambda r: r["output"].update(mode="RGBA"), "must be RGB"),
    ("brief-path", lambda r: r["brief"].update(path="/absolute.json"), "root-relative"),
    ("slot-bool", lambda r: r["slot"].update(index=True), "positive integer"),
    ("crop-bool", lambda r: r["delivery_transform"].update(crop_box=[True, 0, 3, 4]), "four integers"),
    ("crop-size", lambda r: r["delivery_transform"].update(crop_dimensions={"width": 2, "height": 4}), "differ"),
    ("authority", lambda r: r.update(authority="machine"), "supported value"),
    ("criterion", lambda r: r["criteria"].update(realism="maybe"), "supported value"),
    ("criterion-extra", lambda r: r["criteria"].update(lighting="pass"), "criteria must carry exactly"),
])
def test_closed_schema_type_path_and_shape_errors_precede_delivery_authority(
    root: Path, name: str, mutate, message: str,
) -> None:
    value = _static_ruling()
    mutate(value)
    path, sha, _ = _write(root, f"s-{name}.json", value)
    with pytest.raises(Error, match=message):
        _validate(root, path, sha)


@pytest.mark.parametrize("field", ["delivery.out", "brief.path"])
def test_rooted_binding_paths_are_rejected_before_delivery_authority(
    root: Path, monkeypatch: pytest.MonkeyPatch, field: str,
) -> None:
    value = _static_ruling()
    if field == "delivery.out":
        value["delivery"]["out"] = "/outside-delivery"
    else:
        value["brief"]["path"] = "/outside-brief.json"
    path, sha, _ = _write(root, f"rooted-{field.replace('.', '-')}.json", value)

    def unexpected_revalidation(*args, **kwargs):
        pytest.fail("delivery authority must not be consulted for a rooted binding path")

    monkeypatch.setattr(
        ruling_mod.delivery, "revalidate_nonpersona_still_delivery", unexpected_revalidation,
    )
    with pytest.raises(Error, match="root-relative"):
        _validate(root, path, sha)


def test_rooted_external_ruling_path_is_rejected_before_file_read(
    root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    outside = root.parent / "owned-outside-ruling.json"
    data = (json.dumps(_static_ruling(), sort_keys=True) + "\n").encode("utf-8")
    outside.write_bytes(data)

    def unexpected_read(*args, **kwargs):
        pytest.fail("a rooted external ruling path must not be read")

    monkeypatch.setattr(ruling_mod.retained, "_read_unlinked", unexpected_read)
    with pytest.raises(Error, match="root-relative"):
        _validate(root, _rooted_without_drive(outside), _sha(data))
    assert outside.read_bytes() == data


def test_expected_digest_is_checked_before_json_parsing(root: Path) -> None:
    path, _ = _write_raw(root, "digest.json", b"not json")
    with pytest.raises(Error, match="differ from expected_sha256"):
        _validate(root, path, "0" * 64)


@pytest.mark.parametrize("raw", [
    b"", b"\xff", b"{" + b"\"x\":NaN}", b"{\"x\":Infinity}", b"{\"x\":1e999}",
    b"[" * 80 + b"0" + b"]" * 80,
])
def test_strict_json_rejections_precede_delivery_authority(root: Path, raw: bytes) -> None:
    path, sha = _write_raw(root, "strict.json", raw)
    with pytest.raises(Error):
        _validate(root, path, sha)


def test_duplicate_json_key_rejects_before_delivery_authority(root: Path) -> None:
    encoded = json.dumps(_static_ruling(), sort_keys=True).encode("utf-8")
    path, sha = _write_raw(root, "duplicate.json", b'{"schema":"other",' + encoded[1:])
    with pytest.raises(Error, match="duplicate JSON key"):
        _validate(root, path, sha)


def test_over_limit_json_is_rejected_before_delivery_authority(root: Path) -> None:
    raw = b" " * (ruling_mod.briefs.MAX_JSON_BYTES + 1)
    path, sha = _write_raw(root, "large.json", raw)
    with pytest.raises(Error, match="exceeds"):
        _validate(root, path, sha)


@pytest.mark.parametrize("decided_at", [
    "2026-09-11T00:00:00.12Z", "2026-09-11T00:00:00.123Z",
    "2026-09-11T00:00:00.1234Z", "2026-09-11T00:00:00.12345Z",
])
def test_pre_authority_timestamp_forms_accept_supported_fraction_lengths(decided_at: str) -> None:
    value = _static_ruling()
    value["decided_at"] = decided_at
    ruling_mod._check_ruling(value)


@pytest.mark.parametrize("decided_at", [
    "2026-02-30T00:00:00Z", "2026-09-11T00:00:00+00:00",
    "2026-09-11T00:00:00", "2026-09-11T00:00:00.1234567Z",
])
def test_invalid_timestamps_reject_before_delivery_authority(root: Path, decided_at: str) -> None:
    value = _static_ruling()
    value["decided_at"] = decided_at
    path, sha, _ = _write(root, "time.json", value)
    with pytest.raises(Error, match="decided_at"):
        _validate(root, path, sha)


EMOJI = "\U0001f600"


@pytest.mark.parametrize(("field", "value"), [
    ("decided_by", "a" * 256), ("decided_by", EMOJI * 128),
    ("note", "a" * 512), ("note", EMOJI * 256),
])
def test_text_utf16_boundaries_are_accepted_before_delivery_authority(field: str, value: str) -> None:
    ruling = _static_ruling()
    ruling[field] = value
    ruling_mod._check_ruling(ruling)


@pytest.mark.parametrize(("field", "value"), [
    ("decided_by", " reviewer"), ("decided_by", "reviewer "),
    ("decided_by", "reviewer\x01"), ("decided_by", "reviewer\udcff"),
    ("decided_by", "a" * 257), ("decided_by", EMOJI * 129),
    ("note", " note"), ("note", "note\x01"), ("note", "note\udcff"),
    ("note", "a" * 513), ("note", EMOJI * 257),
])
def test_invalid_text_rejects_before_delivery_authority(root: Path, field: str, value: str) -> None:
    ruling = _static_ruling()
    ruling[field] = value
    path, sha, _ = _write(root, "text.json", ruling)
    with pytest.raises(Error):
        _validate(root, path, sha)


def test_ruling_paths_and_links_are_fail_closed(root: Path) -> None:
    path, sha, _ = _write(root, "plain.json", _static_ruling())
    with pytest.raises(Error):
        _validate(root, str((root / path).resolve()), sha)
    with pytest.raises(Error):
        _validate(root, "../plain.json", sha)
    os.link(root / path, root / "alias.json")
    with pytest.raises(Error):
        _validate(root, "alias.json", sha)


def test_symlinked_ruling_is_refused_when_symlinks_are_available(root: Path) -> None:
    path, sha, _ = _write(root, "plain.json", _static_ruling())
    linked = root / "link.json"
    try:
        os.symlink(root / path, linked)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 1314 or exc.errno in {
            errno.EACCES, errno.EPERM, errno.ENOTSUP,
        }:
            pytest.skip(f"symlink creation is unavailable on this host: {exc}")
        raise
    with pytest.raises(Error):
        _validate(root, linked.name, sha)
