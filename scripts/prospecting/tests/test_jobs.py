from pathlib import Path
import pytest
from scripts.prospecting.manager import jobs
from scripts.prospecting.manager.jobs import StageJob, parse_card, write_card
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_jobs")


def job(**changes):
    value = dict(card_id=f"01testcard{0:016x}", project="prospecting", workflow="run-1",
      stage="list", owner="prospecting-list-builder", depends_on=(), policy_id="policy-1",
      policy_hash="a"*64, input_ids=("campaign-1",), input_hashes=("b"*64,),
      counts={"requested":20}, acceptance=("summary_schema_valid", "no_pii"))
    value.update(changes); return StageJob(**value)


def test_card_uses_schema_and_local_outbox(tmp_path: Path) -> None:
    path = write_card(job(), tmp_path / "outbox")
    value = parse_card(path)
    assert value["frontmatter"]["owner"] == "prospecting-list-builder"
    assert value["work_order"]["input_ids"] == ["campaign-1"]
    assert set(value["work_order"]) == {"stage","policy_id","policy_hash","input_ids","input_hashes","counts","acceptance_criteria"}


UNSAFE_FIELDS = [
    ("input_ids", (SYNTHETIC["email"],)), ("policy_id", SYNTHETIC["policy_phone"]),
    ("counts", {"note": "call " + SYNTHETIC["note_phone"]}), ("acceptance", ("opaque-id",)),
]


def test_every_card_field_is_guarded(tmp_path: Path) -> None:
    for field, value in UNSAFE_FIELDS:
        with pytest.raises(Exception): write_card(job(**{field:value}), tmp_path / "outbox")


def test_schema_valid_card_is_guarded_before_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def classify_as_pii(value: object, sink: str) -> None:
        calls.append((value, sink))
        raise ValueError("pii_detected")

    monkeypatch.setattr(jobs, "_assert_vm_safe", classify_as_pii)
    with pytest.raises(ValueError, match="pii_detected"):
        write_card(job(policy_id="guard-test-id"), tmp_path / "outbox")
    assert len(calls) == 1
    envelope, sink = calls[0]
    assert sink == "cards"
    assert envelope["kind"] == "cards"
    assert isinstance(envelope["fields"]["value"], dict)
    assert not (tmp_path / "outbox").exists()


def test_stage_job_counts_are_immutable() -> None:
    stage_job = job()
    with pytest.raises(TypeError):
        stage_job.counts["requested"] = 0  # type: ignore[index]


def test_absolute_and_traversal_queue_targets_are_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"; (repo / "queue/inbox").mkdir(parents=True)
    outside = tmp_path / "outside"; outside.mkdir()
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), repo / "queue/inbox", repo_root=repo)
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), outside / ".." / "repo" / "queue" / "inbox", repo_root=repo)


def test_symlink_into_queue_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"; (repo / "queue/inbox").mkdir(parents=True)
    link = tmp_path / "outbox-link"
    try: link.symlink_to(repo / "queue/inbox", target_is_directory=True)
    except OSError: pytest.skip("symlink privilege unavailable")
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), link, repo_root=repo)


def test_symlinked_target_dir_is_refused(tmp_path: Path) -> None:
    target = tmp_path / "real-outbox"; target.mkdir()
    link = tmp_path / "outbox-link"
    try: link.symlink_to(target, target_is_directory=True)
    except OSError: pytest.skip("symlink privilege unavailable")
    with pytest.raises(ValueError, match="symlinked_outbox_forbidden"):
        write_card(job(), link)


def test_non_opaque_policy_id_cannot_flow_to_card(tmp_path: Path) -> None:
    with pytest.raises(Exception):
        write_card(job(policy_id=SYNTHETIC["alternate_policy_phone"]), tmp_path / "outbox")
    assert not list((tmp_path / "outbox").glob("*.md"))
