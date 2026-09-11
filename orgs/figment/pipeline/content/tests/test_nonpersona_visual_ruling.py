"""nonpersona_visual_ruling validation over a real brief -> prep -> native -> retained chain.

Every chain below is real: real content_brief/nonpersona_prep/nonpersona_native producers,
real nonpersona_retained recording. Only ``run/`` bytes are synthetic (fake pod id, tmp
ledger, solid-colour PNGs) as in test_nonpersona_retained. These tests exercise a validator
that only reads and never writes, approves, or authenticates a ruling; they do not prove
image generation, image quality, or human approval.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import pytest

from orgs.figment.pipeline.content import nonpersona_native as native
from orgs.figment.pipeline.content import nonpersona_retained as retained
from orgs.figment.pipeline.content import nonpersona_visual_ruling as ruling_mod
from orgs.figment.pipeline.content.tests.test_nonpersona_native import (  # noqa: F401
    _compile, _snapshot, root,
)
from orgs.figment.pipeline.content.tests.test_nonpersona_retained import (
    DAY, POD_ID, USD, _pod, _png,
)

Error = ruling_mod.NonpersonaVisualRulingError
DECIDED_AT = "2026-09-11T00:00:00Z"
# Explicit literal, not derived from ruling_mod.ACCEPTING.
ACCEPT = {"no_person": "pass", "scene_subject_fit": "pass", "realism": "pass",
          "obvious_artifacts": "none", "native_quality": "pass"}
IMAGE_KEYS = ("cell_id", "path", "sha256", "width", "height")


def _build_chain(root: Path, tag: str, taxonomy: str = "D") -> Path:
    """A real live chain under a distinct tag, mirroring test_nonpersona_retained._live."""
    out, _ = _compile(root, tag, taxonomy)
    out_dir, pod = root / out, _pod()
    manifest_path = out_dir / native.MANIFEST_NAME
    manifest = json.loads(manifest_path.read_bytes())
    base, fields = pod.load_workflow(manifest, manifest_path), pod.manifest_seed_fields(manifest)
    graphs = [pod.apply_job(base, job, fields) for job in manifest["jobs"]]
    pod.append_cost_row(root / "ledger", pod.gpu_model_label(manifest["gpu"]["type"]),
                        f"pod-create {POD_ID}-{tag}", USD, ledger_day=DAY)
    run_dir = out_dir / "run"
    run_dir.mkdir()
    jobs = []
    for number, (job, graph) in enumerate(zip(manifest["jobs"], graphs), start=1):
        data = _png(json.dumps(graph), shade=40 * number)
        (run_dir / f"{job['output_name']}.png").write_bytes(data)
        jobs.append({"job": number, "output_name": job["output_name"], "seed": job["seed"],
                     "prompt_id": f"synthetic-{tag}-{number}", "seconds": 12.5,
                     "files": [{"path": f"{job['output_name']}.png", "bytes": len(data)}]})
    (run_dir / "run.json").write_text(json.dumps({
        "schema": retained.RUN_SCHEMA, "dry_run": False, "pod_id": f"{POD_ID}-{tag}",
        "estimated_actual_usd": USD, "ledger_day": DAY, "termination_verified": True,
        "placement_attempts": [{"pod_id": f"{POD_ID}-{tag}", "estimated_actual_usd": USD,
                                "termination_verified": True}],
        "jobs": jobs, "uploads": [], "artifacts": [],
    }, indent=2) + "\n", encoding="utf-8")
    return out


def _chain(root: Path, tag: str = "primary", taxonomy: str = "D") -> tuple[Path, dict]:
    out = _build_chain(root, tag, taxonomy)
    return out, retained.record_nonpersona_retained(root=root, out=out)


def _brief_ref(root: Path, tag: str) -> dict:
    return json.loads((root / "out" / f"{tag}-prep.json").read_bytes())["brief"]


def _ruling(root: Path, out: Path, record: dict, tag: str, **overrides) -> dict:
    record_data = (root / out / retained.RECORD_NAME).read_bytes()
    image = record["images"][0]
    base = {
        "schema": "figment/nonpersona-visual-ruling@1",
        "retained": {"out": out.as_posix(), "record_sha256": retained._digest(record_data)},
        "image": {key: image[key] for key in IMAGE_KEYS},
        "brief": dict(_brief_ref(root, tag)),
        "slot": dict(record["slot"]),
        "authority": "human-visual-ruling",
        "criteria": dict(ACCEPT),
        "delivery_quality": "not-assessed",
        "decision": "accept-native",
        "decided_by": "reviewer@example.test",
        "decided_at": DECIDED_AT,
        "note": "",
    }
    base.update(overrides)
    return base


def _write(root: Path, name: str, ruling: dict) -> tuple[str, str]:
    """Write a ruling at root-relative ``name``; return (root-relative POSIX path, sha256)."""
    data = json.dumps(ruling, indent=2, sort_keys=True).encode("utf-8")
    (root / name).write_bytes(data)
    return Path(name).as_posix(), retained._digest(data)


def _validate(root: Path, path: str | Path, sha: str) -> dict:
    return ruling_mod.validate_nonpersona_visual_ruling(root=root, path=path, expected_sha256=sha)


def _write_raw(root: Path, name: str, raw: str) -> tuple[str, str]:
    data = raw.encode("utf-8")
    (root / name).write_bytes(data)
    return name, retained._digest(data)


def _rejects(root: Path, ruling: dict, match: str | None = None) -> None:
    """Write, snapshot after the write, validate, and prove the rejection wrote nothing."""
    path, sha = _write(root, "r.json", ruling)
    before = _snapshot(root)
    with pytest.raises(Error, match=match):
        _validate(root, path, sha)
    assert _snapshot(root) == before


@pytest.mark.parametrize("authority", ["human-visual-ruling", "research-disposition"])
@pytest.mark.parametrize("taxonomy", ["C", "D", "E"])
def test_accepts_real_chain_for_each_nonpersona_type(
    root: Path, taxonomy: str, authority: str,
) -> None:
    out, record = _chain(root, "primary", taxonomy)
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary", authority=authority))
    record_data = (root / out / retained.RECORD_NAME).read_bytes()
    before = _snapshot(root)
    result = _validate(root, path, sha)
    assert _snapshot(root) == before  # validator writes nothing

    assert result["schema"] == "figment/nonpersona-visual-ruling-validation@1"
    assert result["not_promotable"] is True
    assert result["ruling"] == {"path": "r.json", "bytes": len((root / "r.json").read_bytes()),
                                "sha256": sha}
    assert result["retained"] == {"out": out.as_posix(), "path": retained.RECORD_NAME,
                                  "bytes": len(record_data),
                                  "sha256": retained._digest(record_data)}
    assert result["image"] == record["images"][0]  # full selected retained image entry
    assert result["image"]["review_eligible"] is True
    assert result["slot"] == record["slot"]
    assert result["slot"]["taxonomy_type"] == taxonomy
    assert result["slot"]["kind"] == "nonpersona"
    assert result["brief"] == _brief_ref(root, "primary")
    assert result["creator"] == record["creator"]
    assert result["native_dimensions"] == record["native_dimensions"]
    assert result["delivery_target"] == record["delivery_target"]
    assert result["native_dimensions"] != {key: result["delivery_target"][key]
                                           for key in ("width", "height")}
    if taxonomy == "D":
        assert result["native_dimensions"] == {"width": 1448, "height": 2176}
        assert result["delivery_target"] == {"aspect": "3:4", "width": 1080, "height": 1440}
    assert result["authority"] == authority
    assert result["decision"] == "accept-native"
    assert result["criteria"] == ACCEPT
    assert result["decided_by"] == "reviewer@example.test"
    assert result["decided_at"] == DECIDED_AT
    assert result["note"] == ""
    assert result["delivery_quality"] == "not-assessed"
    assert result["delivery_transform"] is None
    assert not {"approved", "bindable", "authenticated", "verified"} & set(result)

    # Returned nested fields are copies: mutating them touches no file and no later result.
    original = copy.deepcopy(result)
    result["image"]["sha256"] = "0" * 64
    result["slot"]["index"] = 99
    result["brief"]["sha256"] = "0" * 64
    result["criteria"]["realism"] = "fail"
    result["native_dimensions"]["width"] = 1
    result["delivery_target"]["width"] = 1
    assert _snapshot(root) == before
    assert _validate(root, path, sha) == original


@pytest.mark.parametrize("criteria", [
    {"no_person": "pass", "scene_subject_fit": "pass", "realism": "pass",
     "obvious_artifacts": "present", "native_quality": "fail"},
    {"no_person": "not-assessed", "scene_subject_fit": "not-assessed", "realism": "not-assessed",
     "obvious_artifacts": "not-assessed", "native_quality": "not-assessed"},
])
def test_reject_permits_mixed_or_not_assessed_criteria(root: Path, criteria: dict) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(
        root, out, record, "primary", decision="reject", criteria=criteria))
    result = _validate(root, path, sha)
    assert result["decision"] == "reject"
    assert result["criteria"] == criteria


@pytest.mark.parametrize("bad_criteria", [
    {**ACCEPT, "native_quality": "fail"},
    {**ACCEPT, "obvious_artifacts": "present"},
    {**ACCEPT, "realism": "not-assessed"},
    {**ACCEPT, "no_person": "fail"},
    {**ACCEPT, "scene_subject_fit": "not-assessed"},
])
def test_accept_native_requires_every_criterion_passing(root: Path, bad_criteria: dict) -> None:
    out, record = _chain(root, "primary")
    _rejects(root, _ruling(root, out, record, "primary", criteria=bad_criteria),
             "accept-native requires every criterion to pass")


def test_wrong_expected_sha_checked_before_parsing(root: Path) -> None:
    path, _ = _write_raw(root, "r.json", "not even json")
    with pytest.raises(Error, match="differ from expected_sha256"):
        _validate(root, path, "0" * 64)


def test_path_argument_accepts_relative_str_and_path(root: Path) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    assert path == "r.json"
    assert _validate(root, path, sha)["decision"] == "accept-native"
    assert _validate(root, Path("r.json"), sha)["decision"] == "accept-native"


def test_absolute_ruling_path_rejected(root: Path) -> None:
    out, record = _chain(root, "primary")
    _, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    for absolute in (str(root / "r.json"), root / "r.json"):
        with pytest.raises(Error):
            _validate(root, absolute, sha)


@pytest.mark.parametrize("bad_path", ["../r.json", "C:/r.json", "sub/../../r.json"])
def test_path_traversal_rejected(root: Path, bad_path: str) -> None:
    out, record = _chain(root, "primary")
    _, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    with pytest.raises(Error):
        _validate(root, bad_path, sha)


def test_hardlinked_ruling_refused(root: Path) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    os.link(root / "r.json", root / "alias.json")
    with pytest.raises(Error, match="must not be hard-linked"):
        _validate(root, path, sha)


def test_symlinked_ruling_refused(root: Path) -> None:
    out, record = _chain(root, "primary")
    _, sha = _write(root, "real.json", _ruling(root, out, record, "primary"))
    link = root / "r.json"
    try:
        os.symlink(root / "real.json", link)
    except OSError as exc:  # Windows without Developer Mode / SeCreateSymbolicLink.
        pytest.skip(f"symlink creation not permitted: {exc}")
    with pytest.raises(Error, match="missing or (traverses|linked)"):
        _validate(root, "r.json", sha)


def test_wrong_retained_record_sha_rejected(root: Path) -> None:
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary")
    ruling["retained"]["record_sha256"] = "0" * 64
    _rejects(root, ruling, "retained record is not the supplied, currently revalidated record")


def test_tampered_retained_record_rejected(root: Path) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    record_path = root / out / retained.RECORD_NAME
    stale = json.loads(record_path.read_bytes())
    stale["extra"] = 1
    record_path.write_bytes((json.dumps(stale, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    before = _snapshot(root)
    with pytest.raises(Error):
        _validate(root, path, sha)
    assert _snapshot(root) == before


IMAGE_MUTATIONS = {
    "wrong_sha": lambda image: image.update(sha256="0" * 64),
    "wrong_path": lambda image: image.update(path="run/other.png"),
    "wrong_cell": lambda image: image.update(cell_id="not-a-real-cell"),
    "wrong_width": lambda image: image.update(width=image["width"] + 1),
    "wrong_height": lambda image: image.update(height=image["height"] + 1),
}


@pytest.mark.parametrize("case", sorted(IMAGE_MUTATIONS))
def test_image_mismatch_rejected(root: Path, case: str) -> None:
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary")
    IMAGE_MUTATIONS[case](ruling["image"])
    _rejects(root, ruling, "does not match exactly one review-eligible")


@pytest.mark.parametrize("field", ["index", "width", "height"])
def test_bool_rejected_for_integer_fields(root: Path, field: str) -> None:
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary")
    (ruling["slot"] if field == "index" else ruling["image"])[field] = True
    _rejects(root, ruling, "positive integer")


def test_different_brief_with_same_shaped_slot_rejected(root: Path) -> None:
    out_a, record_a = _chain(root, "chain-a")
    _, record_b = _chain(root, "chain-b")  # same taxonomy D -> identical slot, distinct brief
    assert record_a["slot"] == record_b["slot"]
    assert _brief_ref(root, "chain-a") != _brief_ref(root, "chain-b")
    ruling = _ruling(root, out_a, record_a, "chain-a", brief=dict(_brief_ref(root, "chain-b")))
    _rejects(root, ruling, "ruling brief is not the retained image's original brief")


def test_wrong_slot_rejected(root: Path) -> None:
    out, record = _chain(root, "primary", "D")
    ruling = _ruling(root, out, record, "primary")
    ruling["slot"] = {"index": 3, "role": ruling["slot"]["role"],
                      "taxonomy_type": "C", "kind": "nonpersona"}
    _rejects(root, ruling, "ruling slot is not the retained image's slot")


def _stale_brief(root: Path, out: Path) -> None:
    path = root / "out" / "primary-brief.json"
    path.write_bytes(path.read_bytes() + b"\n")


def _stale_preparation(root: Path, out: Path) -> None:
    path = root / "out" / "primary-prep.json"
    path.write_bytes(path.read_bytes() + b"\n")


def _stale_compilation(root: Path, out: Path) -> None:
    path = root / out / native.RECORD_NAME
    path.write_bytes(path.read_bytes() + b"\n")


def _stale_run(root: Path, out: Path) -> None:
    path = root / out / "run" / "run.json"
    run = json.loads(path.read_bytes())
    run["estimated_actual_usd"] = USD + 0.01
    path.write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")


def _set_first_image_byte(root: Path, out: Path) -> str:
    """Flip one bit of the first run image deterministically; return its root-relative key."""
    run = json.loads((root / out / "run" / "run.json").read_bytes())
    image_path = root / out / "run" / run["jobs"][0]["files"][0]["path"]
    original = image_path.read_bytes()
    changed = original[:-1] + bytes([original[-1] ^ 0x01])
    assert changed != original
    image_path.write_bytes(changed)
    return image_path.relative_to(root).as_posix()


STALE_CASES = {
    "brief": _stale_brief,
    "preparation": _stale_preparation,
    "compilation": _stale_compilation,
    "run": _stale_run,
    "image": _set_first_image_byte,
}


@pytest.mark.parametrize("case", sorted(STALE_CASES))
def test_stale_chain_input_rejects_after_ruling_was_written(root: Path, case: str) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    STALE_CASES[case](root, out)
    before = _snapshot(root)  # after the intentional mutation, before validation
    with pytest.raises(Error):
        _validate(root, path, sha)
    assert _snapshot(root) == before


@pytest.mark.parametrize(("target", "mutate", "match"), [
    ("top_extra", lambda r: r.update(extra_field=1), "visual ruling must carry exactly"),
    ("top_missing", lambda r: r.pop("note"), "visual ruling must carry exactly"),
    ("retained_extra", lambda r: r["retained"].update(path="x"), "retained must carry exactly"),
    ("image_missing", lambda r: r["image"].pop("height"), "image must carry exactly"),
    ("brief_extra", lambda r: r["brief"].update(bytes=1), "brief must carry exactly"),
    ("slot_missing", lambda r: r["slot"].pop("kind"), "slot must carry exactly"),
    ("criteria_missing", lambda r: r["criteria"].pop("realism"), "criteria must carry exactly"),
    ("criteria_extra", lambda r: r["criteria"].update(lighting="pass"),
     "criteria must carry exactly"),
])
def test_extra_or_missing_keys_hit_their_gate(root: Path, target: str, mutate, match: str) -> None:
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary")
    mutate(ruling)
    _rejects(root, ruling, match)


def test_duplicate_json_key_rejected(root: Path) -> None:
    out, record = _chain(root, "primary")
    text = json.dumps(_ruling(root, out, record, "primary"))
    path, sha = _write_raw(root, "r.json", '{"schema": "bogus", ' + text[1:])
    with pytest.raises(Error, match="duplicate JSON key"):
        _validate(root, path, sha)


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "1e999"])
def test_nonfinite_number_rejected(root: Path, literal: str) -> None:
    out, record = _chain(root, "primary")
    text = json.dumps(_ruling(root, out, record, "primary"), sort_keys=True)
    path, sha = _write_raw(root, "r.json", '{"x": ' + literal + ', ' + text[1:])
    with pytest.raises(Error, match="non-finite"):
        _validate(root, path, sha)


ENUM_MUTATIONS = {
    "schema": (lambda r: r.update(schema=1), "visual ruling schema must be"),
    "authority": (lambda r: r.update(authority="self-declared"), "not a supported value"),
    "authority_int": (lambda r: r.update(authority=1), "not a supported value"),
    "authority_list": (lambda r: r.update(authority=["human-visual-ruling"]),
                       "not a supported value"),
    "decision": (lambda r: r.update(decision="approve"), "not a supported value"),
    "decision_null": (lambda r: r.update(decision=None), "not a supported value"),
    "criterion": (lambda r: r["criteria"].update(realism="unsure"), "not a supported value"),
    "criterion_bool": (lambda r: r["criteria"].update(realism=True), "not a supported value"),
    "criteria_list": (lambda r: r.update(criteria=["pass"]), "criteria must carry exactly"),
    "delivery_quality": (lambda r: r.update(delivery_quality="excellent"),
                         "not-assessed; no delivery surface"),
    "slot_kind": (lambda r: r["slot"].update(kind=1), "slot role, taxonomy_type, or kind"),
    "slot_taxonomy_persona": (lambda r: r["slot"].update(taxonomy_type="A"),
                              "slot role, taxonomy_type, or kind"),
    "image_cell_int": (lambda r: r["image"].update(cell_id=1), "cell_id or path is malformed"),
    "image_path_outside_run": (lambda r: r["image"].update(path="other/x.png"),
                               "cell_id or path is malformed"),
    "decided_by_int": (lambda r: r.update(decided_by=5), "decided_by must be trimmed"),
    "note_null": (lambda r: r.update(note=None), "note must be trimmed"),
}


@pytest.mark.parametrize("case", sorted(ENUM_MUTATIONS))
def test_invalid_enum_or_shape_rejected(root: Path, case: str) -> None:
    mutate, match = ENUM_MUTATIONS[case]
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary")
    mutate(ruling)
    _rejects(root, ruling, match)


@pytest.mark.parametrize(("decided_at", "ok"), [
    ("2026-09-11T00:00:00Z", True),
    ("2026-09-11T00:00:00.123456Z", True),
    ("2026-02-30T00:00:00Z", False),  # no such calendar date
    ("2026-09-11T00:00:00+00:00", False),  # not the required Z suffix
    ("2026-09-11T00:00:00", False),  # naive, no timezone
])
def test_timestamp_validation(root: Path, decided_at: str, ok: bool) -> None:
    out, record = _chain(root, "primary")
    ruling = _ruling(root, out, record, "primary", decided_at=decided_at)
    if ok:
        path, sha = _write(root, "r.json", ruling)
        assert _validate(root, path, sha)["decided_at"] == decided_at
    else:
        _rejects(root, ruling, "decided_at")


EMOJI = "\U0001F600"  # one code point, two UTF-16 units

TEXT_CASES = {
    "empty": ("", "nonempty"),
    "leading_space": (" reviewer", "trimmed"),
    "trailing_space": ("reviewer ", "trimmed"),
    "control_char": ("reviewer\x01", "control characters"),
    "lone_surrogate": ("reviewer\udcff", "control characters"),
    "ascii_257": ("a" * 257, "exceeds 256 UTF-16"),
    "emoji_129": (EMOJI * 129, "exceeds 256 UTF-16"),  # 129 code points, 258 units
}


@pytest.mark.parametrize("case", sorted(TEXT_CASES))
def test_decided_by_text_bounds(root: Path, case: str) -> None:
    value, message = TEXT_CASES[case]
    out, record = _chain(root, "primary")
    _rejects(root, _ruling(root, out, record, "primary", decided_by=value), message)


@pytest.mark.parametrize(("field", "value"), [
    ("decided_by", EMOJI * 128),  # exactly 256 UTF-16 units
    ("decided_by", "a" * 256),
    ("note", EMOJI * 256),  # exactly 512 UTF-16 units
    ("note", ""),
])
def test_text_at_utf16_boundary_accepted(root: Path, field: str, value: str) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary", **{field: value}))
    assert _validate(root, path, sha)[field] == value


@pytest.mark.parametrize("value", ["x" * 513, EMOJI * 257])
def test_note_over_utf16_bound_rejected(root: Path, value: str) -> None:
    out, record = _chain(root, "primary")
    _rejects(root, _ruling(root, out, record, "primary", note=value), "exceeds 512 UTF-16")


def test_human_authority_is_only_an_assertion_not_authentication(root: Path) -> None:
    """decided_by is a recorded claim; nothing here verifies the reviewer's identity."""
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json",
                       _ruling(root, out, record, "primary", decided_by="anyone at all"))
    result = _validate(root, path, sha)
    assert result["decided_by"] == "anyone at all"
    assert "authenticated" not in result and "verified" not in result


def test_mutation_between_chain_checks_rejects_and_preserves_first_chain(
    root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    out, record = _chain(root, "primary")
    path, sha = _write(root, "r.json", _ruling(root, out, record, "primary"))
    record_bytes = (root / out / retained.RECORD_NAME).read_bytes()
    real_revalidate = retained.revalidate_nonpersona_retained
    calls: list[int] = []
    first: list[dict] = []
    mutated: list[str] = []

    def revalidate(*, root, out):
        calls.append(1)  # counted at entry, before the real call can raise
        result = real_revalidate(root=root, out=out)
        if len(calls) == 1:
            first.append(copy.deepcopy(result))
            mutated.append(_set_first_image_byte(root, out))
        return result

    monkeypatch.setattr(ruling_mod.retained, "revalidate_nonpersona_retained", revalidate)
    before = _snapshot(root)
    with pytest.raises(Error):
        _validate(root, path, sha)
    monkeypatch.undo()

    assert len(calls) == 2  # first real pass succeeded; second real pass rejected
    assert first == [record]  # first actual revalidation saw the recorded chain
    assert (root / out / retained.RECORD_NAME).read_bytes() == record_bytes
    after = _snapshot(root)
    assert set(after) == set(before)  # no new or removed files
    assert {key for key in after if after[key] != before[key]} == set(mutated)
