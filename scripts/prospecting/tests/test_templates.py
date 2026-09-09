from pathlib import Path
import re

import pytest

from scripts.prospecting.personalizer.templates import (
    TemplateError,
    load_template,
    load_registry,
    render,
    slot_inventory,
    validate_slots,
)


DIRECTORY = Path("orgs/prospecting/templates")
EXPECTED = {"networking", "recruiting_live", "curiosity", "alumni"}


def registry():
    return load_registry(DIRECTORY)


def test_registry_has_exactly_four_active_intents() -> None:
    assert set(registry()) == EXPECTED


@pytest.mark.parametrize(
    ("intent", "required"),
    [
        ("networking", {"first_name", "company", "why_them", "ask", "sender_proof", "signature"}),
        ("recruiting_live", {"first_name", "company", "role", "why_them", "ask", "sender_proof", "signature"}),
        ("curiosity", {"first_name", "company", "topic", "why_them", "ask", "sender_proof", "signature"}),
        ("alumni", {"first_name", "company", "why_them", "ask", "sender_proof", "signature"}),
    ],
)
def test_each_template_has_expected_slots(intent: str, required: set[str]) -> None:
    assert slot_inventory(registry()[intent]) == required


def test_versions_and_ids_are_stable() -> None:
    assert {(item.template_id, item.template_version) for item in registry().values()} == {
        ("networking", 1), ("recruiting-live", 1), ("curiosity", 1), ("alumni", 1)
    }


def test_unknown_slot_is_rejected() -> None:
    template = registry()["networking"]
    values = {name: "safe" for name in slot_inventory(template)} | {"extra": "bad"}
    with pytest.raises(TemplateError, match="unknown_slots:extra"):
        validate_slots(template, values)


def test_missing_slot_is_rejected() -> None:
    template = registry()["networking"]
    values = {name: "safe" for name in slot_inventory(template) if name != "ask"}
    with pytest.raises(TemplateError, match="missing_slots:ask"):
        validate_slots(template, values)


def test_render_rejects_sales() -> None:
    with pytest.raises(KeyError):
        registry()["sales"]


def test_render_replaces_every_named_slot() -> None:
    template = registry()["networking"]
    values = {name: f"value-{name}" for name in slot_inventory(template)}
    subject, body = render(template, values)
    assert "{" not in subject + body and "value-first_name" in body


@pytest.mark.parametrize("intent", sorted(EXPECTED))
def test_each_family_renders_contract_length_and_one_ask(intent: str) -> None:
    template = registry()[intent]
    values = {
        "first_name": "Casey", "company": "Example Company", "role": "operations",
        "topic": "team operations", "school": "Example University",
        "why_them": "Your documented path into operations gives me a concrete experience to learn from.",
        "sender_proof": "I have worked on operating problems and evaluated how teams improve.",
        "ask": "Would you have 15 minutes for an informational conversation?", "signature": "Example Sender",
    }
    subject, body = render(template, {name: values[name] for name in slot_inventory(template)})
    core = " ".join(line for line in body.splitlines()[1:-1] if line.strip())
    assert 60 <= len(re.findall(r"\b[\w'-]+\b", core)) <= 120
    assert body.count("?") == 1 and "15 minutes" in body
    assert "referral" not in (subject + body).lower()


def test_no_sales_template_artifact_exists() -> None:
    assert not any("sales" in path.name.lower() for path in DIRECTORY.glob("*.txt"))


def test_registry_rejects_inactive_intent_in_non_v1_file(tmp_path: Path) -> None:
    for intent in EXPECTED:
        (tmp_path / f"{intent}-v1.txt").write_text(
            f"template_id: {intent}\ntemplate_version: 1\nintent: {intent}\nsubject: Hi\nbody:\nHello\n",
            encoding="utf-8",
        )
    (tmp_path / "sales-v2.txt").write_text(
        "template_id: sales\ntemplate_version: 2\nintent: sales\nsubject: Hi\nbody:\nHello\n",
        encoding="utf-8",
    )
    with pytest.raises(TemplateError, match="inactive_intent"):
        load_registry(tmp_path)


def test_duplicate_header_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "networking-v1.txt"
    path.write_text(
        "template_id: networking\ntemplate_id: duplicate\ntemplate_version: 1\n"
        "intent: networking\nsubject: Hi\nbody:\nHello\n",
        encoding="utf-8",
    )
    with pytest.raises(TemplateError, match="duplicate_header"):
        load_template(path)
