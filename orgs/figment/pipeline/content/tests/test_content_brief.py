from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PureWindowsPath

import pytest

import orgs.figment.pipeline.content.content_brief as compiler
from orgs.figment.pipeline.content.content_brief import (
    ContentBriefError, build_content_brief, main, revalidate_content_brief,
    revise_content_brief,
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "brief-root"
    persona = root / "personas" / "creator-001"
    anchors = persona / "anchors"
    anchors.mkdir(parents=True)
    (anchors / "g01.jpg").write_bytes(b"canonical-anchor")
    (persona / "persona.yaml").write_text(json.dumps({
        "id": "creator-001", "identity": {"references": ["anchors/g01.jpg"]},
    }), encoding="utf-8")
    return root


def _request(**changes: object) -> dict:
    result = {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-08",
        "creator": {"id": "creator-001", "persona_path": "personas/creator-001/persona.yaml", "canonical_reference": "anchors/g01.jpg"},
        "surface": "carousel",
        "template_id": "CT-2",
        "asset_slots": [
            {"taxonomy_type": "A", "kind": "persona"},
            {"taxonomy_type": "A", "kind": "persona"},
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-07"}],
        "hypothesis": "A two-frame payoff gives a concise outfit comparison.",
        "intended_metric": "saves per reached account",
        "observed_metrics": None,
    }
    result.update(changes)
    return result


def _write_request(root: Path, request: dict) -> None:
    (root / "request.json").write_text(json.dumps(request), encoding="utf-8")


def _rooted_without_drive(path: Path) -> str:
    absolute = path.resolve()
    rooted = absolute.as_posix()[len(absolute.drive):]
    assert rooted.startswith("/") and PureWindowsPath(rooted).root
    return rooted


def test_compiles_carousel_with_exact_local_lineage_and_null_metrics(tmp_path: Path):
    root = _root(tmp_path)
    (root / "out").mkdir()
    _write_request(root, _request())
    result = build_content_brief(root, "request.json", "out/brief.json")
    saved = json.loads((root / "out" / "brief.json").read_text(encoding="utf-8"))
    anchor = root / "personas/creator-001/anchors/g01.jpg"
    assert saved == result
    assert result["observed_metrics"] is None
    assert result["creator"]["canonical_reference"]["sha256"] == _sha(anchor)
    assert result["creator"]["canonical_reference"]["path"] == "personas/creator-001/anchors/g01.jpg"
    assert result["content"]["template_id"] == "CT-2"
    assert [item["kind"] for item in result["content"]["required_asset_slots"]] == ["persona", "persona"]


def test_compiles_reel_with_motion_persona_slot(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request(surface="reel", template_id="RT-1", asset_slots=[{"taxonomy_type": "G", "kind": "persona"}]))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["content"]["required_asset_slots"] == [{"index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona"}]


@pytest.mark.parametrize("changes", [
    {"observed_metrics": {"saves": 100}},
    {"approval": "granted"},
    {"template_id": "CT-99"},
    {"asset_slots": [{"taxonomy_type": "B", "kind": "persona"}]},
    {"sources": [{"citation": "http://example.test", "observed_date": "bad"}]},
])
def test_rejects_invented_results_claims_and_invalid_template_inputs(tmp_path: Path, changes: dict):
    root = _root(tmp_path)
    _write_request(root, _request(**changes))
    with pytest.raises(ContentBriefError):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


def test_rejects_traversal_symlink_and_existing_output(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request())
    with pytest.raises(ContentBriefError, match="relative"):
        build_content_brief(root, "../request.json", "out.json")
    linked = root / "linked-request.json"
    try:
        os.symlink(root / "request.json", linked)
    except OSError as exc:
        pytest.skip(f"symlink unavailable: {exc}")
    with pytest.raises(ContentBriefError, match="link"):
        build_content_brief(root, "linked-request.json", "out.json")
    root_link = tmp_path / "linked-root"
    os.symlink(root, root_link, target_is_directory=True)
    with pytest.raises(ContentBriefError, match="reparse"):
        build_content_brief(root_link, "request.json", "root-out.json")
    (root / "out.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ContentBriefError, match="fresh"):
        build_content_brief(root, "request.json", "out.json")


def test_rejects_drive_relative_path_and_oversized_canonical_reference(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "C:persona.yaml", "canonical_reference": "anchors/g01.jpg",
    }))
    with pytest.raises(ContentBriefError, match="canonical creator persona"):
        build_content_brief(root, "request.json", "out.json")
    _write_request(root, _request())
    monkeypatch.setattr(compiler, "MAX_REFERENCE_BYTES", 4)
    with pytest.raises(ContentBriefError, match="canonical_reference"):
        build_content_brief(root, "request.json", "out.json")


@pytest.mark.parametrize("bad_request", [
    PureWindowsPath("C:relative.json").as_posix(),
    PureWindowsPath("C:/absolute.json").as_posix(),
    PureWindowsPath("//server/share/request.json").as_posix(),
    str(PureWindowsPath("nested/request.json")),
])
def test_public_api_rejects_windows_path_syntax_before_read(
    tmp_path: Path, bad_request: str,
) -> None:
    root = _root(tmp_path)
    with pytest.raises(ContentBriefError, match="root-relative"):
        build_content_brief(root, bad_request, "out.json")
    assert not (root / "out.json").exists()


def test_rooted_no_drive_paths_cannot_read_or_write_outside_root(tmp_path: Path) -> None:
    root = _root(tmp_path)
    outside_request = tmp_path / "owned-outside-request.json"
    outside_request.write_bytes(b"{")
    with pytest.raises(ContentBriefError, match="root-relative"):
        build_content_brief(root, _rooted_without_drive(outside_request), "out.json")
    assert outside_request.read_bytes() == b"{"
    assert not (root / "out.json").exists()

    _write_request(root, _request())
    outside_output = tmp_path / "owned-outside-output.json"
    with pytest.raises(ContentBriefError, match="root-relative"):
        build_content_brief(root, "request.json", _rooted_without_drive(outside_output))
    assert not outside_output.exists()


def test_public_api_accepts_ordinary_normalized_relative_paths(tmp_path: Path) -> None:
    root = _root(tmp_path)
    request_dir = root / "requests"
    output_dir = root / "out"
    request_dir.mkdir()
    output_dir.mkdir()
    (request_dir / "request.json").write_text(json.dumps(_request()), encoding="utf-8")
    result = build_content_brief(root, "requests/request.json", "out/brief.json")
    assert result["schema"] == "figment/content-brief@1"
    assert (output_dir / "brief.json").is_file()


def test_rejects_request_controlled_persona_path_or_self_referential_reference(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "personas/creator-001/copy.yaml", "canonical_reference": "anchors/g01.jpg",
    }))
    with pytest.raises(ContentBriefError, match="canonical creator persona"):
        build_content_brief(root, "request.json", "out.json")
    persona = root / "personas/creator-001/persona.yaml"
    persona.write_text(json.dumps({
        "id": "creator-001", "identity": {"references": ["persona.yaml"]},
    }), encoding="utf-8")
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "personas/creator-001/persona.yaml", "canonical_reference": "persona.yaml",
    }))
    with pytest.raises(ContentBriefError, match="anchors"):
        build_content_brief(root, "request.json", "out.json")


@pytest.mark.parametrize("bad", ["bad\nline", "bad\ttab", "bad\x00null", "bad\x7fdel"])
def test_rejects_control_characters_matching_dashboard_consumer(tmp_path: Path, bad: str):
    root = _root(tmp_path)
    _write_request(root, _request(hypothesis=bad))
    with pytest.raises(ContentBriefError, match="control characters"):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


def test_rejects_oversized_citation_before_output(tmp_path: Path):
    root = _root(tmp_path)
    overlong_citation = "https://example.test/" + ("a" * 2048)
    _write_request(root, _request(sources=[{"citation": overlong_citation, "observed_date": "2026-09-07"}]))
    with pytest.raises(ContentBriefError, match="bounded nonempty text"):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


def test_accepts_citation_at_the_exact_2048_bound(tmp_path: Path):
    root = _root(tmp_path)
    citation = "https://example.test/" + ("a" * (2048 - len("https://example.test/")))
    assert len(citation) == 2048
    _write_request(root, _request(sources=[{"citation": citation, "observed_date": "2026-09-07"}]))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["sources"][0]["citation"] == citation


def test_accepts_legitimate_non_ascii_hypothesis_and_metric(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request(
        hypothesis="A café aesthetic with an emoji \U0001f4ce resonates.",
        intended_metric="taux de sauvegarde par compte atteint",
    ))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["hypothesis"] == "A café aesthetic with an emoji \U0001f4ce resonates."
    assert result["intended_metric"] == "taux de sauvegarde par compte atteint"


def test_accepts_hypothesis_at_the_existing_4096_bound(tmp_path: Path):
    root = _root(tmp_path)
    hypothesis = "a" * 4096
    _write_request(root, _request(hypothesis=hypothesis))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["hypothesis"] == hypothesis


def test_hypothesis_boundary_uses_utf16_code_units_like_the_hub(tmp_path: Path):
    root = _root(tmp_path)
    emoji = "\U0001f600"
    hypothesis_at_bound = emoji * 2048  # 2048 codepoints, 4096 UTF-16 units
    _write_request(root, _request(hypothesis=hypothesis_at_bound))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["hypothesis"] == hypothesis_at_bound

    hypothesis_over_bound = emoji * 2049  # 2049 codepoints, 4098 UTF-16 units
    _write_request(root, _request(hypothesis=hypothesis_over_bound))
    with pytest.raises(ContentBriefError, match="overlong text"):
        build_content_brief(root, "request.json", "out2.json")
    assert not (root / "out2.json").exists()


def test_citation_boundary_uses_utf16_code_units_like_the_hub(tmp_path: Path):
    root = _root(tmp_path)
    prefix = "https://example.test/"
    emoji = "\U0001f600"
    remaining_units = compiler.MAX_CITATION - len(prefix)
    emoji_count = remaining_units // 2
    pad = remaining_units - emoji_count * 2
    citation_at_bound = prefix + emoji * emoji_count + "a" * pad
    _write_request(root, _request(sources=[{"citation": citation_at_bound, "observed_date": "2026-09-07"}]))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["sources"][0]["citation"] == citation_at_bound

    citation_over_bound = citation_at_bound + emoji
    _write_request(root, _request(sources=[{"citation": citation_over_bound, "observed_date": "2026-09-07"}]))
    with pytest.raises(ContentBriefError, match="bounded nonempty text"):
        build_content_brief(root, "request.json", "out2.json")
    assert not (root / "out2.json").exists()


@pytest.mark.parametrize("bad", ["bad\nline", "bad\ttab", "bad\x00null", "bad\x7fdel"])
def test_rejects_control_characters_in_intended_metric(tmp_path: Path, bad: str):
    root = _root(tmp_path)
    _write_request(root, _request(intended_metric=bad))
    with pytest.raises(ContentBriefError, match="control characters"):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


@pytest.mark.parametrize("bad", ["bad\nline", "bad\ttab", "bad\x00null", "bad\x7fdel"])
def test_rejects_control_characters_in_citation(tmp_path: Path, bad: str):
    root = _root(tmp_path)
    citation = f"https://example.test/{bad}"
    _write_request(root, _request(sources=[{"citation": citation, "observed_date": "2026-09-07"}]))
    with pytest.raises(ContentBriefError, match="control characters"):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


def test_cli_writes_only_a_fresh_bounded_record(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request())
    assert main(["--root", str(root), "--request", "request.json", "--out", "brief.json"]) == 0
    assert json.loads((root / "brief.json").read_text(encoding="utf-8"))["schema"] == "figment/content-brief@1"


def _revision_base(root: Path, *, name: str = "base-brief") -> tuple[Path, bytes, bytes]:
    base = root / "content" / "briefs" / name
    base.mkdir(parents=True)
    request = _request()
    (base / "request.json").write_text(json.dumps(request), encoding="utf-8")
    build_content_brief(
        root,
        f"content/briefs/{name}/request.json",
        f"content/briefs/{name}/brief.json",
    )
    return base, (base / "request.json").read_bytes(), (base / "brief.json").read_bytes()


def _revision_edits(root: Path, **changes: object) -> Path:
    edits = {
        "brief_date": "2026-09-09",
        "hypothesis": "A revised two-frame payoff sharpens the outfit comparison.",
        "intended_metric": "profile visits per reached account",
    }
    edits.update(changes)
    path = root / "revision-edits.json"
    path.write_text(json.dumps(edits), encoding="utf-8")
    return path


def _revision_paths(name: str = "base-brief", output: str = "revised-brief") -> tuple[str, str]:
    return f"content/briefs/{name}", f"content/briefs/{output}"


def _assert_base_unchanged(base: Path, request_bytes: bytes, brief_bytes: bytes) -> None:
    assert (base / "request.json").read_bytes() == request_bytes
    assert (base / "brief.json").read_bytes() == brief_bytes


def _traceback_contains(head, expected) -> bool:
    while head is not None:
        if head is expected:
            return True
        head = head.tb_next
    return False


_WINDOWS_REVISION = pytest.mark.skipif(os.name != "nt", reason="revision publication is Windows-only")


@_WINDOWS_REVISION
def test_revision_publishes_exact_pair_and_returns_nonproof_descriptor(tmp_path: Path):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()

    publication = revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    final = root / out_path
    assert sorted(item.name for item in final.iterdir()) == ["brief.json", "request.json"]
    _assert_base_unchanged(base, request_bytes, brief_bytes)
    base_request = json.loads(request_bytes)
    revised_request = json.loads((final / "request.json").read_text(encoding="utf-8"))
    assert {
        key for key in set(base_request) | set(revised_request)
        if base_request.get(key) != revised_request.get(key)
    } == {"brief_date", "hypothesis", "intended_metric"}
    assert publication["schema"] == "figment/content-brief-revision-publication@1"
    assert set(publication) == {"schema", "base", "record", "prepublication_validation", "publication"}
    assert publication["publication"] == {
        "directory": out_path,
        "request": {"path": f"{out_path}/request.json", "sha256": _sha(final / "request.json")},
        "brief": {"path": f"{out_path}/brief.json", "sha256": _sha(final / "brief.json")},
        "final_paths_revalidated": False,
    }
    assert set(publication["prepublication_validation"]) == {
        "request_sha256", "brief_sha256", "dependencies",
    }
    assert publication["prepublication_validation"]["request_sha256"] == _sha(final / "request.json")
    assert publication["prepublication_validation"]["brief_sha256"] == _sha(final / "brief.json")
    assert publication["record"]["creator"]["persona"]["path"] == "personas/creator-001/persona.yaml"
    assert publication["record"]["creator"]["canonical_reference"]["path"] == "personas/creator-001/anchors/g01.jpg"

    proof = revalidate_content_brief(root, f"{out_path}/request.json", f"{out_path}/brief.json")
    assert proof["request"]["path"] == f"{out_path}/request.json"
    assert proof["brief"]["path"] == f"{out_path}/brief.json"
    assert proof["record"] == publication["record"]
    assert proof["dependencies"] == publication["prepublication_validation"]["dependencies"]
    assert publication["base"]["request"]["path"] == f"{base_path}/request.json"
    assert publication["base"]["brief"]["path"] == f"{base_path}/brief.json"


@_WINDOWS_REVISION
@pytest.mark.parametrize("edits", [
    {},
    {"brief_date": "2026-09-09", "hypothesis": "only two"},
    {"brief_date": "2026-09-09", "hypothesis": "valid", "intended_metric": "valid", "surface": "reel"},
    {"brief_date": "bad", "hypothesis": "valid", "intended_metric": "valid"},
])
def test_revision_rejects_any_edit_shape_outside_the_three_bounded_fields(tmp_path: Path, edits: dict):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    path = root / "revision-edits.json"
    path.write_text(json.dumps(edits), encoding="utf-8")
    base_path, out_path = _revision_paths()

    with pytest.raises(ContentBriefError):
        revise_content_brief(root, base_path, path.relative_to(root).as_posix(), out_path)

    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
@pytest.mark.parametrize("existing", ["file", "directory"])
def test_revision_never_replaces_existing_final_target(tmp_path: Path, existing: str):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    final = root / out_path
    final.parent.mkdir(parents=True, exist_ok=True)
    if existing == "file":
        final.write_bytes(b"existing final file")
    else:
        final.mkdir()

    with pytest.raises(ContentBriefError):
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    if existing == "file":
        assert final.read_bytes() == b"existing final file"
    else:
        assert final.is_dir() and list(final.iterdir()) == []
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_race_existing_target_is_refused_without_replacement(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    final = root / out_path
    original_rename = compiler.os.rename

    def racing_rename(source, target):
        assert Path(target) == final
        final.mkdir()
        original_rename(source, target)

    monkeypatch.setattr(compiler.os, "rename", racing_rename)
    with pytest.raises(ContentBriefError):
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    assert final.is_dir() and list(final.iterdir()) == []
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_windows_rename_of_populated_stage_over_empty_target_refuses_and_preserves_both(tmp_path: Path):
    parent = tmp_path / "rename-parent"
    stage = parent / "stage"
    final = parent / "final"
    stage.mkdir(parents=True)
    (stage / "request.json").write_bytes(b"stage request")
    final.mkdir()

    with pytest.raises(FileExistsError):
        os.rename(stage, final)

    assert (stage / "request.json").read_bytes() == b"stage request"
    assert final.is_dir() and list(final.iterdir()) == []


@_WINDOWS_REVISION
@pytest.mark.parametrize("failure", ["compile", "staged-revalidation", "base-revalidation"])
def test_revision_precommit_compile_and_validation_failures_leave_no_final_pair(
    tmp_path: Path, monkeypatch, failure: str,
):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    primary = RuntimeError(f"{failure}-primary")

    if failure == "compile":
        def broken_compile(*_args, **_kwargs):
            raise primary
        monkeypatch.setattr(compiler, "build_content_brief", broken_compile)
    else:
        real_revalidate = compiler.revalidate_content_brief
        calls = []
        fail_on = 2 if failure == "staged-revalidation" else 3

        def counted_revalidate(*args, **kwargs):
            calls.append((args, kwargs))
            if len(calls) == fail_on:
                raise primary
            return real_revalidate(*args, **kwargs)

        monkeypatch.setattr(compiler, "revalidate_content_brief", counted_revalidate)

    with pytest.raises(RuntimeError) as raised:
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    assert raised.value is primary
    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
@pytest.mark.parametrize("primary_type", [OSError, RuntimeError])
def test_revision_inventory_failure_before_commit_leaves_no_final_pair(
    tmp_path: Path, monkeypatch, primary_type,
):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    parent = root / "content" / "briefs"
    staging = parent / ".revision-stage-inventory"
    primary = primary_type("inventory-primary")
    original_iterdir = Path.iterdir
    failed = False

    def fixed_mkdtemp(*args, **kwargs):
        assert Path(kwargs["dir"]) == parent
        staging.mkdir()
        return str(staging)

    def failing_iterdir(path):
        nonlocal failed
        if path == staging:
            if failed:
                return original_iterdir(path)
            failed = True
            raise primary
        return original_iterdir(path)

    monkeypatch.setattr(compiler.tempfile, "mkdtemp", fixed_mkdtemp)
    monkeypatch.setattr(Path, "iterdir", failing_iterdir)
    if primary_type is OSError:
        with pytest.raises(ContentBriefError) as raised:
            revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)
        assert str(raised.value) == "revision staging directory could not be verified"
        assert raised.value.__cause__ is primary
    else:
        with pytest.raises(RuntimeError) as raised:
            revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)
        assert raised.value is primary
    assert not (root / out_path).exists()
    assert not staging.exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


def _fixed_stage(monkeypatch, parent: Path, name: str) -> Path:
    staging = parent / name

    def fixed_mkdtemp(*_args, **kwargs):
        assert Path(kwargs["dir"]) == parent
        staging.mkdir()
        return str(staging)

    monkeypatch.setattr(compiler.tempfile, "mkdtemp", fixed_mkdtemp)
    return staging


@_WINDOWS_REVISION
@pytest.mark.parametrize("secondary_type", [OSError, KeyboardInterrupt, RuntimeError])
def test_revision_cleanup_failure_preserves_owned_staging_and_primary_baseexception(
    tmp_path: Path, monkeypatch, secondary_type,
):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    parent = root / "content" / "briefs"
    staging = _fixed_stage(monkeypatch, parent, ".revision-stage-cleanup")
    unowned = parent / ".unowned-sibling"
    unowned.mkdir()
    primary = KeyboardInterrupt("write-primary")
    cleanup_error = secondary_type("cleanup-secondary")
    failed = False
    primary_traceback = None
    original_open = Path.open
    original_os_unlink = compiler.os.unlink
    secondary_calls = 0

    def failing_open(path, *args, **kwargs):
        nonlocal failed, primary_traceback
        if path == staging / "brief.json":
            failed = True
            try:
                raise primary
            except KeyboardInterrupt:
                primary_traceback = primary.__traceback__
                raise
        return original_open(path, *args, **kwargs)

    def failing_os_unlink(path, *args, **kwargs):
        nonlocal secondary_calls
        if failed and Path(path) == staging / "request.json":
            secondary_calls += 1
            raise cleanup_error
        return original_os_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failing_open)
    monkeypatch.setattr(compiler.os, "unlink", failing_os_unlink)
    with pytest.raises(KeyboardInterrupt) as raised:
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    assert raised.value is primary
    assert _traceback_contains(raised.value.__traceback__, primary_traceback)
    assert secondary_calls == 1
    assert staging.exists() and (staging / "request.json").exists()
    assert unowned.is_dir() and list(unowned.iterdir()) == []
    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_identity_uncertainty_preserves_staging_and_primary(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    parent = root / "content" / "briefs"
    staging = _fixed_stage(monkeypatch, parent, ".revision-stage-identity")
    primary = KeyboardInterrupt("write-primary")
    failed = False
    original_open = Path.open
    original_stat = Path.stat

    def failing_open(path, *args, **kwargs):
        nonlocal failed
        if path == staging / "brief.json":
            failed = True
            raise primary
        return original_open(path, *args, **kwargs)

    def uncertain_stat(path, *args, **kwargs):
        if failed and path in {staging, staging / "request.json"}:
            raise OSError("identity-secondary")
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failing_open)
    monkeypatch.setattr(Path, "stat", uncertain_stat)
    with pytest.raises(KeyboardInterrupt) as raised:
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    monkeypatch.setattr(Path, "stat", original_stat)
    assert raised.value is primary
    assert staging.exists() and (staging / "request.json").exists()
    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_commit_is_last_validation_or_filesystem_operation(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    _base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    final = root / out_path
    committed = False
    original_rename = compiler.os.rename
    original_revalidate = compiler.revalidate_content_brief
    original_iterdir = Path.iterdir
    original_stat = Path.stat
    original_unlink = Path.unlink
    original_rmdir = Path.rmdir

    def commit_rename(source, target):
        nonlocal committed
        original_rename(source, target)
        committed = True

    def guard_revalidate(*args, **kwargs):
        if committed:
            raise AssertionError("revalidated after publication commit")
        return original_revalidate(*args, **kwargs)

    def guarded(method, label):
        def call(path, *args, **kwargs):
            if committed:
                raise AssertionError(f"{label} after publication commit")
            return method(path, *args, **kwargs)
        return call

    monkeypatch.setattr(compiler.os, "rename", commit_rename)
    monkeypatch.setattr(compiler, "revalidate_content_brief", guard_revalidate)
    monkeypatch.setattr(Path, "iterdir", guarded(original_iterdir, "inventory"))
    monkeypatch.setattr(Path, "stat", guarded(original_stat, "stat"))
    monkeypatch.setattr(Path, "unlink", guarded(original_unlink, "cleanup"))
    monkeypatch.setattr(Path, "rmdir", guarded(original_rmdir, "cleanup"))
    publication = revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    monkeypatch.setattr(Path, "iterdir", original_iterdir)
    monkeypatch.setattr(Path, "stat", original_stat)
    monkeypatch.setattr(Path, "unlink", original_unlink)
    monkeypatch.setattr(Path, "rmdir", original_rmdir)
    assert committed is True and publication["publication"]["directory"] == out_path
    assert sorted(item.name for item in final.iterdir()) == ["brief.json", "request.json"]
    _assert_base_unchanged(root / base_path, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_dependency_mutation_before_commit_refuses_and_keeps_base_pair(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    persona = root / "personas" / "creator-001" / "persona.yaml"
    original_revalidate = compiler.revalidate_content_brief
    calls = 0

    def mutate_after_initial_base_proof(*args, **kwargs):
        nonlocal calls
        proof = original_revalidate(*args, **kwargs)
        calls += 1
        if calls == 1:
            persona.write_text(json.dumps({
                "id": "creator-001", "identity": {"references": ["anchors/g01.jpg"]},
                "fixture_mutation": True,
            }), encoding="utf-8")
        return proof

    monkeypatch.setattr(compiler, "revalidate_content_brief", mutate_after_initial_base_proof)
    with pytest.raises(ContentBriefError):
        revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    assert calls >= 2
    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_cli_and_legacy_flags_are_mutually_exclusive(tmp_path: Path):
    root = _root(tmp_path)
    _base, _request_bytes, _brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()

    assert main([
        "--root", str(root), "--revise-base", base_path,
        "--edits", edits.relative_to(root).as_posix(), "--out-dir", out_path,
    ]) == 0
    with pytest.raises(SystemExit) as raised:
        main([
            "--root", str(root), "--request", "request.json", "--out", "legacy.json",
            "--revise-base", base_path, "--edits", edits.relative_to(root).as_posix(),
            "--out-dir", "content/briefs/second-revision",
        ])
    assert raised.value.code == 2


@_WINDOWS_REVISION
def test_revision_refuses_non_windows_host_without_creating_final_pair(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    base, request_bytes, brief_bytes = _revision_base(root)
    edits = _revision_edits(root)
    base_path, out_path = _revision_paths()
    with monkeypatch.context() as isolated:
        isolated.setattr(compiler.os, "name", "posix")
        with pytest.raises(ContentBriefError):
            revise_content_brief(root, base_path, edits.relative_to(root).as_posix(), out_path)

    assert not (root / out_path).exists()
    _assert_base_unchanged(base, request_bytes, brief_bytes)


@_WINDOWS_REVISION
def test_revision_refuses_unc_root_syntax_before_any_network_access(monkeypatch):
    unc_root = PureWindowsPath("//server/share/brief-root")
    assert unc_root.drive.startswith("\\\\")

    def unexpected_safe_root(*_args, **_kwargs):
        raise AssertionError("UNC syntax reached filesystem root validation")

    monkeypatch.setattr(compiler, "_safe_root", unexpected_safe_root)

    with pytest.raises(ContentBriefError):
        revise_content_brief(
            unc_root, "content/briefs/base-brief", "revision-edits.json", "content/briefs/revised-brief",
        )
