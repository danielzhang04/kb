"""Adapter unit tests; video authority is explicitly stubbed, not approved media."""
from __future__ import annotations

import copy
import json
from types import SimpleNamespace

import pytest

from orgs.figment.pipeline.content import content_asset_binding as binding
from orgs.figment.pipeline.content import content_brief as briefs
from orgs.figment.pipeline.content.tests.test_content_asset_binding import content_root, fake_gen, sha, write


def motion_case(tmp_path, monkeypatch):
    root = content_root(tmp_path)
    request = json.loads((root / "request.json").read_text())
    request.update(surface="reel", template_id="RT-1", asset_slots=[{"taxonomy_type": "G", "kind": "persona"}])
    write(root / "request.json", request)
    (root / "brief.json").unlink()
    briefs.build_content_brief(root, "request.json", "brief.json")
    train, plan, images = fake_gen(root)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    accepted = write(root / "video/accepted-video.json", {"unit-test": "authority is stubbed"})
    movie = write(root / "video/movie.mp4", {"unit-test": "not real media"})
    manifest = write(root / "video/candidate.json", {"provenance": {"first_frame": {"approved_gen": {
        "image_id": "image-01", "source_plan": {"path": "gen/plan.json", "sha256": sha(plan)},
    }}}})
    def entry(path):
        return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": sha(path)}
    authority = {"creator_id": "creator-002", "candidate_id": "candidate-01", "movie": entry(movie),
                 "approved_still": entry(root / "gen/images/image-01.png"),
                 "candidate_manifest": entry(manifest), "accepted_lineage": entry(accepted)}
    calls = []
    def validate(supplied_root, path):
        assert supplied_root == root and path == accepted.relative_to(root)
        calls.append(path)
        return copy.deepcopy(authority)
    monkeypatch.setattr(binding, "_video_module", lambda: SimpleNamespace(validate_accepted_video=validate))
    ruled = write(root / "slot-rulings.json", {
        "schema": binding.MOTION_RULINGS_SCHEMA,
        "brief": {"path": "brief.json", "sha256": sha(root / "brief.json")}, "creator": "creator-002",
        "rulings": [{"slot_index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona",
                     "decision": "fit", "decided_by": "fixture-reviewer", "decided_at": "2026-09-10T22:00:00Z",
                     "source": {"kind": binding.VIDEO_SOURCE_KIND, "accepted_video": "video/accepted-video.json"}}],
    })
    return root, authority, calls, ruled, entry


def build(root):
    return binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json",
                                              rulings_path="slot-rulings.json", output_path="assignment.json")


def test_motion_assignment_is_v2_source_only_and_rechecks_authority(tmp_path, monkeypatch):
    root, _, calls, _, _ = motion_case(tmp_path, monkeypatch)
    result = build(root)
    assert result["schema"] == binding.MOTION_SCHEMA and result["not_promotable"] is True
    asset = result["assignments"][0]["asset"]
    assert asset["kind"] == "accepted-video-source" and asset["scope"] == "source-material-only"
    assert asset["approved_still"]["image_id"] == "image-01"
    assert len(calls) == 2
    assert "delivery" not in asset and "approved" not in result


@pytest.mark.parametrize("mutation", ["creator", "movie", "still", "record", "legacy", "wrong-kind"])
def test_motion_assignment_refuses_mismatched_evidence(tmp_path, monkeypatch, mutation):
    root, authority, _, ruled, entry = motion_case(tmp_path, monkeypatch)
    if mutation == "creator": authority["creator_id"] = "other"
    elif mutation == "movie": (root / "video/movie.mp4").write_bytes(b"changed")
    elif mutation == "still": authority["approved_still"] = entry(root / "gen/images/image-02.png")
    elif mutation == "record": authority["accepted_lineage"] = entry(write(root / "video/other.json", {}))
    else:
        value = json.loads(ruled.read_text())
        if mutation == "legacy": value["schema"] = binding.RULINGS_SCHEMA
        else: value["rulings"][0]["source"]["kind"] = binding.SOURCE_KIND
        write(ruled, value)
    with pytest.raises(binding.ContentAssetBindingError): build(root)
    assert not (root / "assignment.json").exists()


def test_motion_same_creator_different_reference_refuses(tmp_path, monkeypatch):
    root, _, _, _, _ = motion_case(tmp_path, monkeypatch)
    (root / "gen/anchors/g01.jpg").write_bytes(b"different-reference")
    with pytest.raises(binding.ContentAssetBindingError): build(root)
    assert not (root / "assignment.json").exists()


def test_motion_second_authority_refusal_leaves_no_assignment(tmp_path, monkeypatch):
    root, authority, calls, _, _ = motion_case(tmp_path, monkeypatch)
    def validate(*_):
        calls.append(True)
        if len(calls) == 2: raise ValueError("upstream acceptance revoked")
        return copy.deepcopy(authority)
    monkeypatch.setattr(binding, "_video_module", lambda: SimpleNamespace(validate_accepted_video=validate))
    with pytest.raises(binding.ContentAssetBindingError, match="authority rejected"): build(root)
    assert len(calls) == 2 and not (root / "assignment.json").exists()


def test_real_video_producer_to_content_cli_then_stale_movie_refuses(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    with pytest.MonkeyPatch.context() as imports:
        imports.syspath_prepend(str(Path(binding.__file__).parents[1] / "video/tests"))
        from orgs.figment.pipeline.video.tests import test_video_rulings as video_fixture

    root = tmp_path / "real"
    root.mkdir()
    # Reuse the complete real still/candidate/assembly/extraction/review fixture.
    # Its media and attributed rulings are synthetic, never creator acceptance.
    video_fixture.test_real_approved_gen_candidate_cli_applies_fixture_rulings_and_validates(root)
    accepted_records = list(root.rglob("accepted-video.json"))
    assert len(accepted_records) == 1
    accepted = accepted_records[0]
    authority = binding._video_module().validate_accepted_video(root, accepted.relative_to(root))
    persona = root / "personas/creator-002/persona.yaml"
    reference = json.loads(persona.read_text())["identity"]["references"][0]
    write(root / "request.json", {
        "schema": "figment/content-brief-request@1", "brief_date": "2026-09-10",
        "creator": {"id": "creator-002", "persona_path": persona.relative_to(root).as_posix(), "canonical_reference": reference},
        "surface": "reel", "template_id": "RT-1", "asset_slots": [{"taxonomy_type": "G", "kind": "persona"}],
        "sources": [{"citation": "https://example.test/source", "observed_date": "2026-09-10"}],
        "hypothesis": "Synthetic source assignment integration.", "intended_metric": "saves", "observed_metrics": None,
    })
    briefs.build_content_brief(root, "request.json", "brief.json")
    write(root / "slot-rulings.json", {
        "schema": binding.MOTION_RULINGS_SCHEMA,
        "brief": {"path": "brief.json", "sha256": sha(root / "brief.json")}, "creator": "creator-002",
        "rulings": [{"slot_index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona",
                     "decision": "fit", "decided_by": "fixture-reviewer", "decided_at": "2026-09-10T22:00:00Z",
                     "source": {"kind": binding.VIDEO_SOURCE_KIND, "accepted_video": accepted.relative_to(root).as_posix()}}],
    })
    argv = [sys.executable, "-I", "-B", str(Path(binding.__file__).resolve()), "--root", str(root),
            "--brief", "brief.json", "--request", "request.json", "--rulings", "slot-rulings.json", "--out"]
    result = subprocess.run([*argv, "assignment.json"], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads((root / "assignment.json").read_text())["assignments"][0]["asset"]["scope"] == "source-material-only"
    original = (root / "assignment.json").read_bytes()
    with (root / authority["movie"]["path"]).open("ab") as handle: handle.write(b"changed")
    stale = subprocess.run([*argv, "stale-assignment.json"], capture_output=True, text=True, timeout=120)
    assert stale.returncode != 0 and not (root / "stale-assignment.json").exists()
    assert (root / "assignment.json").read_bytes() == original
