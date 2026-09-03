import importlib.util
import json
import sys
from pathlib import Path

import pytest

EXPAND = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bs = load_module("figment_expand_batch_state", EXPAND / "batch_state.py")


@pytest.fixture
def batch():
    return bs.new_batch(
        batch_id="expansion-02",
        persona_id="creator-001",
        allocation_sha256="a" * 64,
        cells=[
            {"cell_id": "exp02-s001", "stratum_id": "strat-01"},
            {"cell_id": "exp02-s002", "stratum_id": "strat-02"},
        ],
    )


# ---------------------------------------------------------------------------
# new_batch
# ---------------------------------------------------------------------------


def test_new_batch_starts_at_building_with_defaulted_cells(batch):
    assert batch["stage"] == "building"
    assert batch["pod_runs"] == []
    assert batch["cost_usd"] == 0.0
    for cell in batch["cells"]:
        assert cell["state"] == "generated"
        assert cell["review_status"] == "unreviewed"
        assert cell["parked_reasons"] == []
        assert cell["safety_failed"] is False


def test_new_batch_rejects_duplicate_cell_ids():
    with pytest.raises(ValueError, match="duplicate cell_id"):
        bs.new_batch(
            batch_id="b",
            persona_id="p",
            allocation_sha256="a" * 64,
            cells=[{"cell_id": "x"}, {"cell_id": "x"}],
        )


def test_new_batch_rejects_missing_required_fields():
    with pytest.raises(ValueError):
        bs.new_batch(batch_id="", persona_id="p", allocation_sha256="a" * 64, cells=[])


# ---------------------------------------------------------------------------
# next_state — the parametrized transition matrix from plan step 1.3
# ---------------------------------------------------------------------------

TRANSITION_CASES = [
    # generated -> scored: mere presence of a score row advances the cell
    ("generated", {"score": {"face_detected": True}}, "scored"),
    ("generated", {"score": {"face_detected": None}}, "scored"),
    # no-face -> quarantined: deterministic no-face is the sole automated quarantine
    ("scored", {"score": {"face_detected": False}}, "quarantined"),
    # parked -> scored: parked never changes state, it just records reasons
    ("scored", {"ruling": {"review_status": "parked", "safety_failed": False}}, "scored"),
    # safety-failed -> quarantined: any safety-axis failure quarantines regardless
    # of the quality-axis review_status
    ("scored", {"ruling": {"review_status": "verified", "safety_failed": True}}, "quarantined"),
    ("scored", {"ruling": {"review_status": "parked", "safety_failed": True}}, "quarantined"),
    # verified selected/unselected -> curated or culled
    (
        "scored",
        {"ruling": {"review_status": "verified", "safety_failed": False}, "selected": True},
        "curated",
    ),
    (
        "scored",
        {"ruling": {"review_status": "verified", "safety_failed": False}, "selected": False},
        "culled",
    ),
    # culled -> curated: a later curation pass needs its stratum
    ("culled", {"selected": True}, "curated"),
    ("culled", {"selected": False}, "culled"),
    # curated + current gate -> approved
    ("curated", {"gate_current": True}, "approved"),
    ("curated", {"gate_current": False}, "curated"),
]


@pytest.mark.parametrize(("state", "kwargs", "expected"), TRANSITION_CASES)
def test_allowed_transitions(state, kwargs, expected):
    assert bs.next_state(state, **kwargs) == expected


# ---------------------------------------------------------------------------
# Negative / fail-closed tests
# ---------------------------------------------------------------------------


def test_raw_score_never_promotes_or_culls():
    rich_score = {
        "face_detected": True,
        "anchor_cosine": 0.91,
        "laplacian_variance": 512.0,
    }
    # No ruling at all: a raw score, however rich, never promotes past "scored".
    assert bs.next_state("scored", score=rich_score) == "scored"
    # Even with `selected=True` — selection alone, without a verified ruling, is inert.
    assert bs.next_state("scored", score=rich_score, selected=True) == "scored"
    # And it never quarantines except the one deterministic no-face route.
    assert bs.next_state("scored", score={"face_detected": True}) == "scored"


def test_illegal_terminal_duplicate_cost_and_coverage_cases_fail_closed(batch):
    # (a) quarantined is terminal for this reducer — any further signal raises.
    with pytest.raises(ValueError, match="terminal"):
        bs.next_state("quarantined", score={"face_detected": True})
    with pytest.raises(ValueError, match="terminal"):
        bs.next_state("approved", gate_current=True)

    # (b) "scored -> approved" without passing through "curated" is illegal.
    with pytest.raises(ValueError, match="curated"):
        bs.next_state("scored", gate_current=True)

    # (c) record_pod_run never overwrites an existing shard_id row.
    bs.record_pod_run(batch, {"shard_id": "shard-01", "cost_usd": 0.5})
    with pytest.raises(ValueError, match="already recorded"):
        bs.record_pod_run(batch, {"shard_id": "shard-01", "cost_usd": 0.6})
    assert len(batch["pod_runs"]) == 1
    assert batch["cost_usd"] == 0.5

    # (d) require_strata_coverage fails closed while any stratum is empty.
    cells = batch["cells"]
    with pytest.raises(ValueError, match="missing"):
        bs.require_strata_coverage(cells, selected_ids={"exp02-s001"}, required_strata={"strat-01", "strat-02"})
    bs.require_strata_coverage(cells, selected_ids={"exp02-s001", "exp02-s002"}, required_strata={"strat-01", "strat-02"})


def test_next_state_rejects_unknown_current_state():
    with pytest.raises(ValueError, match="unknown cell lifecycle state"):
        bs.next_state("not-a-real-state")


def test_next_state_rejects_unknown_review_status():
    with pytest.raises(ValueError, match="unknown review_status"):
        bs.next_state("scored", ruling={"review_status": "bogus", "safety_failed": False})


# ---------------------------------------------------------------------------
# apply_batch — atomicity
# ---------------------------------------------------------------------------


def test_apply_batch_is_atomic_when_transform_raises(tmp_path, batch):
    path = tmp_path / "batch.json"
    original_text = json.dumps(batch, indent=1) + "\n"
    path.write_text(original_text, encoding="utf-8")

    def bad_transform(loaded):
        loaded["stage"] = "generated"  # in-memory mutation, must not reach disk
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        bs.apply_batch(path, bad_transform)

    assert path.read_text(encoding="utf-8") == original_text


def test_apply_batch_writes_transform_result_atomically(tmp_path, batch):
    path = tmp_path / "batch.json"
    path.write_text(json.dumps(batch), encoding="utf-8")

    updated = bs.apply_batch(path, lambda loaded: bs.mark_batch_stage(loaded, "generated"))
    assert updated["stage"] == "generated"
    assert json.loads(path.read_text(encoding="utf-8"))["stage"] == "generated"
    assert not path.with_name("batch.json.tmp").exists()


# ---------------------------------------------------------------------------
# mark_batch_stage — the parametrized batch-stage transition matrix
# ---------------------------------------------------------------------------

BATCH_STAGE_CASES = [
    ("building", "generated", True),
    ("generated", "scored", True),
    ("scored", "awaiting-eye-gate-a", True),
    ("awaiting-eye-gate-a", "gate-a-ruled", True),
    ("building", "scored", False),          # skip
    ("scored", "building", False),          # backward
    ("gate-a-ruled", "scored", False),      # backward past terminal
    ("building", "building", False),        # no-op repeat
]


@pytest.mark.parametrize(("stage_from", "stage_to", "ok"), BATCH_STAGE_CASES)
def test_mark_batch_stage_is_forward_only(stage_from, stage_to, ok, batch):
    batch["stage"] = stage_from
    if ok:
        assert bs.mark_batch_stage(batch, stage_to)["stage"] == stage_to
    else:
        with pytest.raises(ValueError):
            bs.mark_batch_stage(batch, stage_to)


def test_mark_batch_stage_rejects_unknown_stage(batch):
    with pytest.raises(ValueError, match="unknown batch stage"):
        bs.mark_batch_stage(batch, "not-a-real-stage")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_mark_stage(tmp_path, batch, capsys):
    path = tmp_path / "batch.json"
    path.write_text(json.dumps(batch), encoding="utf-8")
    assert bs.main(["mark-stage", "--batch", str(path), "--stage", "generated"]) == 0
    assert json.loads(path.read_text(encoding="utf-8"))["stage"] == "generated"
    assert "batch stage: generated" in capsys.readouterr().out


def test_cli_apply_scores_generated_cells_and_quarantines_no_face(tmp_path, batch, capsys):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps(batch), encoding="utf-8")
    scores_path = tmp_path / "scores.json"
    scores_path.write_text(json.dumps({
        "images": [
            {"cell_id": "exp02-s001", "face_detected": True},
            {"cell_id": "exp02-s002", "face_detected": False},
        ]
    }), encoding="utf-8")

    assert bs.main(["apply", "--batch", str(batch_path), "--scores", str(scores_path)]) == 0
    out = capsys.readouterr().out
    assert "scored 1; quarantined no-face=1; threshold-routed=0" in out

    updated = json.loads(batch_path.read_text(encoding="utf-8"))
    cells_by_id = {c["cell_id"]: c for c in updated["cells"]}
    assert cells_by_id["exp02-s001"]["state"] == "scored"
    assert cells_by_id["exp02-s002"]["state"] == "quarantined"
    assert cells_by_id["exp02-s002"]["rejected_reason"] == "no-face"


def test_cli_apply_joins_60_of_60_under_the_real_harness_naming_scheme(tmp_path, capsys):
    # P2R review finding 2: the harness's on-disk image name is
    # "c001-<cell_id>" (build_expansion_set.py's output_name =
    # f"c001-{cell['cell_id']}"), while batch.json's own cells key on cell_id alone
    # ("exp02-s001"). identity_check.py's raw-only writer now resolves and carries
    # that cell_id explicitly in each score row (see _resolve_cell_id), and
    # batch_state.py's _load_score_rows already prefers a row's cell_id over its
    # image_id — so this fixture reproduces exactly what that writer now emits for
    # a real expansion-02-shaped batch: 40 "s" cells + 20 "r" cells, image_id in the
    # harness's c001-prefixed form, cell_id resolved to the bare allocation id.
    cell_ids = [f"exp02-s{i:03d}" for i in range(1, 41)] + [f"exp02-r{i:03d}" for i in range(1, 21)]
    cells = [{"cell_id": cid, "stratum_id": f"strat-{cid}"} for cid in cell_ids]
    real_batch = bs.new_batch(
        batch_id="expansion-02", persona_id="creator-001",
        allocation_sha256="a" * 64, cells=cells,
    )
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps(real_batch), encoding="utf-8")

    scores_path = tmp_path / "scores.json"
    rows = [
        {
            "image_id": f"c001-{cid}",
            "cell_id": cid,
            "face_detected": cid != "exp02-s001",  # exactly one deterministic no-face
        }
        for cid in cell_ids
    ]
    scores_path.write_text(json.dumps({"images": rows}), encoding="utf-8")

    assert bs.main(["apply", "--batch", str(batch_path), "--scores", str(scores_path)]) == 0
    out = capsys.readouterr().out
    assert "scored 59; quarantined no-face=1; threshold-routed=0" in out

    updated = json.loads(batch_path.read_text(encoding="utf-8"))
    states = {c["cell_id"]: c["state"] for c in updated["cells"]}
    assert len(states) == 60
    # 60 of 60 matched: every cell advanced off "generated".
    assert set(states.values()) <= {"scored", "quarantined"}
    assert states["exp02-s001"] == "quarantined"
    assert all(states[cid] == "scored" for cid in cell_ids if cid != "exp02-s001")


def test_cli_apply_is_idempotent_on_a_second_run(tmp_path, batch, capsys):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps(batch), encoding="utf-8")
    scores_path = tmp_path / "scores.json"
    scores_path.write_text(json.dumps({
        "images": [
            {"cell_id": "exp02-s001", "face_detected": True},
            {"cell_id": "exp02-s002", "face_detected": False},
        ]
    }), encoding="utf-8")

    assert bs.main(["apply", "--batch", str(batch_path), "--scores", str(scores_path)]) == 0
    capsys.readouterr()
    # A second run with the same scores must not raise on the now-quarantined cell.
    assert bs.main(["apply", "--batch", str(batch_path), "--scores", str(scores_path)]) == 0
    out = capsys.readouterr().out
    assert "scored 0; quarantined no-face=0; threshold-routed=0" in out
