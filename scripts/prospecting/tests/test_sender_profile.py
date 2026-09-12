import json
from pathlib import Path

import pytest

from scripts.prospecting.personalizer.sender_profile import (
    SenderProfileError,
    load_sender_profile,
    sender_fields,
)
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_sender_profile")


def write(tmp_path: Path, value: object) -> Path:
    path = tmp_path / "sender-profile.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def valid() -> dict[str, object]:
    return {
        "sender_name": "Example Sender", "sender_school": "Example University",
        "sender_focus": "learning how operating teams improve",
        "sender_background": "I build and evaluate synthetic operating systems.",
        "sender_operating_proof": "I have worked on synthetic operating problems.",
        "approved_metrics": [
            {"text": "Improved a synthetic workflow by 20 percent.", "evidence_id": "sender.synthetic_metric_1"}
        ],
    }


def test_synthetic_repo_profile_loads() -> None:
    profile = load_sender_profile(Path("orgs/prospecting/fixtures/sender-profile.synthetic.json"))
    assert profile.sender_name == "Example Sender" and profile.approved_metrics[0].evidence_id


def test_extra_key_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SenderProfileError, match="keys"):
        load_sender_profile(write(tmp_path, valid() | {"nickname": "Synthetic"}))


def test_blank_sender_name_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SenderProfileError, match="sender_name"):
        load_sender_profile(write(tmp_path, valid() | {"sender_name": ""}))


def test_empty_background_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SenderProfileError, match="sender_background"):
        load_sender_profile(write(tmp_path, valid() | {"sender_background": ""}))


def test_empty_sender_focus_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SenderProfileError, match="sender_focus"):
        load_sender_profile(write(tmp_path, valid() | {"sender_focus": ""}))


def test_empty_operating_proof_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SenderProfileError, match="sender_operating_proof"):
        load_sender_profile(write(tmp_path, valid() | {"sender_operating_proof": ""}))


@pytest.mark.parametrize(
    "unsafe",
    ["https://example.test", SYNTHETIC["email"], SYNTHETIC["phone"]],
    ids=["url", "email", "phone"],
)
def test_contact_or_link_text_is_rejected(tmp_path: Path, unsafe: str) -> None:
    with pytest.raises(SenderProfileError, match="unsafe_text"):
        load_sender_profile(write(tmp_path, valid() | {"sender_background": unsafe}))


def test_sender_fields_omits_blank_school(tmp_path: Path) -> None:
    fields = sender_fields(load_sender_profile(write(tmp_path, valid() | {"sender_school": ""})))
    assert "sender_school" not in fields and fields["signature"] == "Example Sender"


def test_approved_metric_requires_exact_citation_shape(tmp_path: Path) -> None:
    bad = valid() | {"approved_metrics": [{"text": "20 percent"}]}
    with pytest.raises(SenderProfileError, match="approved_metrics"):
        load_sender_profile(write(tmp_path, bad))


@pytest.mark.parametrize(
    "evidence_id",
    ["sender.", "sender.https://x.test/y"],
    ids=["plain", "url"],
)
def test_approved_metric_rejects_unsafe_evidence_id(tmp_path: Path, evidence_id: str) -> None:
    bad = valid() | {"approved_metrics": [{"text": "20 percent", "evidence_id": evidence_id}]}
    with pytest.raises(SenderProfileError, match="approved_metrics"):
        load_sender_profile(write(tmp_path, bad))


def test_approved_metric_citation_is_exposed(tmp_path: Path) -> None:
    fields = sender_fields(load_sender_profile(write(tmp_path, valid())))
    assert fields["approved_metric_0"] == "Improved a synthetic workflow by 20 percent."
    assert fields["approved_metric_0_evidence_id"] == "sender.synthetic_metric_1"
