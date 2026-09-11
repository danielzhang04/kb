"""Adapter unit tests; video authority is explicitly stubbed, not approved media."""
from __future__ import annotations

import copy
import json
from types import SimpleNamespace

import pytest

from orgs.figment.pipeline.content import content_asset_binding as binding
from orgs.figment.pipeline.content import content_brief as briefs
from orgs.figment.pipeline.content.tests.test_content_asset_binding import content_root, fake_gen, sha, write


REAL_VIDEO_MODULE = binding._video_module


def video_stub(validate):
    # Only acceptance is stubbed; manifest parsing uses the sole video reader.
    return SimpleNamespace(validate_accepted_video=validate, _read_json=REAL_VIDEO_MODULE()._read_json)


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
    stub = video_stub(validate)
    monkeypatch.setattr(binding, "_video_module", lambda: stub)
    ruled = write(root / "slot-rulings.json", {
        "schema": binding.MOTION_RULINGS_SCHEMA,
        "brief": {"path": "brief.json", "sha256": sha(root / "brief.json")}, "creator": "creator-002",
        "rulings": [{"slot_index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona",
                     "decision": "fit", "decided_by": "fixture-reviewer", "decided_at": "2026-09-10T22:00:00Z",
                     "source": {"kind": binding.VIDEO_SOURCE_KIND, "accepted_video": "video/accepted-video.json",
                                "accepted_video_sha256": sha(accepted)}}],
    })
    return root, authority, calls, ruled, entry


def build(root, output="assignment.json"):
    return binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json",
                                              rulings_path="slot-rulings.json", output_path=output)


def test_motion_assignment_is_v2_source_only_and_rechecks_authority(tmp_path, monkeypatch):
    root, _, calls, _, _ = motion_case(tmp_path, monkeypatch)
    result = build(root)
    assert result["schema"] == binding.MOTION_SCHEMA and result["not_promotable"] is True
    asset = result["assignments"][0]["asset"]
    assert asset["kind"] == "accepted-video-source" and asset["scope"] == "source-material-only"
    assert asset["approved_still"]["image_id"] == "image-01"
    assert len(calls) == 2
    assert "delivery" not in asset and "approved" not in result


@pytest.mark.parametrize(("mutation", "message"), [
    ("creator", "different creator"),
    ("movie", "video movie bytes changed"),
    ("still", "still differs from brief-bound gen authority"),
    ("record", "authority returned a different record"),
    ("replaced-record", "differs from the slot-fit ruling digest"),
    ("unbound-record", "must bind accepted_video_sha256"),
    ("legacy", "motion/video requires v2"),
    ("wrong-kind", "requires accepted-video-source"),
])
def test_motion_assignment_refuses_mismatched_evidence(tmp_path, monkeypatch, mutation, message):
    root, authority, _, ruled, entry = motion_case(tmp_path, monkeypatch)
    if mutation == "creator": authority["creator_id"] = "other"
    elif mutation == "movie": (root / "video/movie.mp4").write_bytes(b"changed")
    elif mutation == "still": authority["approved_still"] = entry(root / "gen/images/image-02.png")
    elif mutation == "record": authority["accepted_lineage"] = entry(write(root / "video/other.json", {}))
    elif mutation == "replaced-record":
        # Same path, new bytes, and an authority that vouches for them: the old ruling must not carry over.
        authority["accepted_lineage"] = entry(write(root / "video/accepted-video.json", {"unit-test": "replaced"}))
    else:
        value = json.loads(ruled.read_text())
        if mutation == "legacy": value["schema"] = binding.RULINGS_SCHEMA
        elif mutation == "unbound-record": del value["rulings"][0]["source"]["accepted_video_sha256"]
        else: value["rulings"][0]["source"]["kind"] = binding.SOURCE_KIND
        write(ruled, value)
    with pytest.raises(binding.ContentAssetBindingError, match=message): build(root)
    assert not (root / "assignment.json").exists()


def test_motion_manifest_parse_must_equal_captured_snapshot(tmp_path, monkeypatch):
    root, _, _, _, _ = motion_case(tmp_path, monkeypatch)
    stub = binding._video_module()
    real_read = stub._read_json
    def swapped(supplied_root, relative, label):
        manifest = root / "video/candidate.json"
        manifest.write_bytes(manifest.read_bytes() + b" ")
        return real_read(supplied_root, relative, label)
    monkeypatch.setattr(stub, "_read_json", swapped)
    with pytest.raises(binding.ContentAssetBindingError, match="candidate manifest differs from its captured snapshot"):
        build(root)
    assert not (root / "assignment.json").exists()


@pytest.mark.parametrize(("target", "message"), [
    ("brief.json", "brief producer inputs changed during asset binding"),
    ("request.json", "brief producer inputs changed during asset binding"),
    ("slot-rulings.json", "slot-fit rulings changed during asset binding"),
])
def test_motion_inputs_changed_during_second_authority_call_refuse(tmp_path, monkeypatch, target, message):
    root, authority, _, _, _ = motion_case(tmp_path, monkeypatch)
    build(root)
    original = (root / "assignment.json").read_bytes()
    calls = []
    def validate(*_):
        calls.append(True)
        if len(calls) == 2:
            # Semantically identical bytes: only the final digest checks can notice.
            (root / target).write_bytes((root / target).read_bytes() + b"\n")
        return copy.deepcopy(authority)
    monkeypatch.setattr(binding, "_video_module", lambda: video_stub(validate))
    with pytest.raises(binding.ContentAssetBindingError, match=message): build(root, "late-assignment.json")
    assert len(calls) == 2 and not (root / "late-assignment.json").exists()
    assert (root / "assignment.json").read_bytes() == original


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
    monkeypatch.setattr(binding, "_video_module", lambda: video_stub(validate))
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
                     "source": {"kind": binding.VIDEO_SOURCE_KIND, "accepted_video": accepted.relative_to(root).as_posix(),
                                "accepted_video_sha256": authority["accepted_lineage"]["sha256"]}}],
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
    assert "accepted video authority rejected a slot source" in stale.stderr
    assert (root / "assignment.json").read_bytes() == original
