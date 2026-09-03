import importlib.util
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gates = load_module("figment_pipeline_gates_under_test", PIPELINE / "gates.py")


@pytest.fixture
def subject(tmp_path):
    path = tmp_path / "board.html"
    path.write_text("<html>board v1</html>", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# sha256_file
# ---------------------------------------------------------------------------


def test_sha256_file_matches_hashlib(tmp_path):
    import hashlib

    path = tmp_path / "x.txt"
    path.write_bytes(b"hello world")
    assert gates.sha256_file(path) == hashlib.sha256(b"hello world").hexdigest()


# ---------------------------------------------------------------------------
# write_gate — atomic write + hash
# ---------------------------------------------------------------------------


def test_write_gate_writes_atomically_and_hashes_the_subject(tmp_path, subject):
    out = tmp_path / "gate.json"
    record = gates.write_gate(
        out,
        gate_id="GATE-A",
        subject_path=subject,
        decision="verified",
        decided_by="daniel",
        decided_at="2026-09-03T07:20:00Z",
    )
    assert record["subject_sha256"] == gates.sha256_file(subject)
    on_disk = json.loads(out.read_text(encoding="utf-8"))
    assert on_disk == record
    assert not out.with_name(out.name + ".tmp").exists()


# ---------------------------------------------------------------------------
# exactly verified|parked
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("decision", ["verified", "parked"])
def test_write_gate_accepts_only_the_two_legal_decisions(tmp_path, subject, decision):
    out = tmp_path / "gate.json"
    record = gates.write_gate(
        out, gate_id="GATE-A", subject_path=subject, decision=decision,
        decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
    )
    assert record["decision"] == decision


@pytest.mark.parametrize("bad_decision", ["approved", "pass", "verified ", "Verified", ""])
def test_write_gate_rejects_every_other_decision(tmp_path, subject, bad_decision):
    out = tmp_path / "gate.json"
    with pytest.raises(ValueError, match="decision"):
        gates.write_gate(
            out, gate_id="GATE-A", subject_path=subject, decision=bad_decision,
            decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
        )
    assert not out.exists()


# ---------------------------------------------------------------------------
# mandatory human identity/time
# ---------------------------------------------------------------------------


def test_write_gate_requires_decided_by(tmp_path, subject):
    out = tmp_path / "gate.json"
    with pytest.raises(ValueError, match="decided_by"):
        gates.write_gate(
            out, gate_id="GATE-A", subject_path=subject, decision="verified",
            decided_by="", decided_at="2026-09-03T07:20:00Z",
        )
    assert not out.exists()


def test_write_gate_requires_decided_at(tmp_path, subject):
    out = tmp_path / "gate.json"
    with pytest.raises(ValueError, match="decided_at"):
        gates.write_gate(
            out, gate_id="GATE-A", subject_path=subject, decision="verified",
            decided_by="daniel", decided_at="",
        )
    assert not out.exists()


def test_write_gate_requires_gate_id(tmp_path, subject):
    out = tmp_path / "gate.json"
    with pytest.raises(ValueError, match="gate_id"):
        gates.write_gate(
            out, gate_id="", subject_path=subject, decision="verified",
            decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
        )
    assert not out.exists()


# ---------------------------------------------------------------------------
# stale-subject rejection (gate_is_current)
# ---------------------------------------------------------------------------


def test_gate_is_current_true_then_false_after_subject_mutates(tmp_path, subject):
    record = gates.write_gate(
        tmp_path / "gate.json", gate_id="GATE-A", subject_path=subject,
        decision="verified", decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
    )
    assert gates.gate_is_current(record, subject) is True

    subject.write_text("<html>board v2 — content changed</html>", encoding="utf-8")
    assert gates.gate_is_current(record, subject) is False


def test_gate_is_current_false_when_subject_is_gone(tmp_path, subject):
    record = gates.write_gate(
        tmp_path / "gate.json", gate_id="GATE-A", subject_path=subject,
        decision="verified", decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
    )
    subject.unlink()
    assert gates.gate_is_current(record, subject) is False


# ---------------------------------------------------------------------------
# optional opaque approval reference
# ---------------------------------------------------------------------------


def test_approval_token_ref_defaults_to_none_and_is_stored_opaquely(tmp_path, subject):
    record = gates.write_gate(
        tmp_path / "gate.json", gate_id="GATE-A", subject_path=subject,
        decision="verified", decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
    )
    assert record["approval_token_ref"] is None

    record2 = gates.write_gate(
        tmp_path / "gate2.json", gate_id="GATE-A", subject_path=subject,
        decision="verified", decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
        approval_token_ref="card:queue/done/abc123",
    )
    assert record2["approval_token_ref"] == "card:queue/done/abc123"


def test_reasons_default_empty_and_are_preserved_in_order(tmp_path, subject):
    record = gates.write_gate(
        tmp_path / "gate.json", gate_id="GATE-A", subject_path=subject,
        decision="parked", decided_by="daniel", decided_at="2026-09-03T07:20:00Z",
        reasons=("stratum 12 empty", "hands defect on 3 cells"),
    )
    assert record["reasons"] == ["stratum 12 empty", "hands defect on 3 cells"]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_writes_a_gate_record(tmp_path, subject, capsys):
    out = tmp_path / "gate.json"
    rc = gates.main([
        "--out", str(out),
        "--gate-id", "GATE-A",
        "--subject", str(subject),
        "--decision", "verified",
        "--decided-by", "daniel",
        "--decided-at", "2026-09-03T07:20:00Z",
    ])
    assert rc == 0
    assert json.loads(out.read_text(encoding="utf-8"))["decision"] == "verified"
    assert "GATE-A" in capsys.readouterr().out


def test_cli_rejects_bad_decision_at_the_argparse_layer_without_writing(tmp_path, subject):
    out = tmp_path / "gate.json"
    with pytest.raises(SystemExit):
        gates.main([
            "--out", str(out),
            "--gate-id", "GATE-A",
            "--subject", str(subject),
            "--decision", "approved",  # not in argparse choices=(parked, verified)
            "--decided-by", "daniel",
            "--decided-at", "2026-09-03T07:20:00Z",
        ])
    assert not out.exists()
