from __future__ import annotations
import json
from pathlib import Path
import re
import subprocess
import sys
import pytest

IDS = ["prospecting-manager","prospecting-list-builder","prospecting-personalizer","prospecting-campaigner"]
EXPECTED_TOOLS = {
 "prospecting-manager": {"prospecting-card-outbox","prospecting-desktop-bridge","prospecting-aggregate-status"},
 "prospecting-list-builder": {"prospecting-list-builder-cli"},
 "prospecting-personalizer": {"prospecting-personalizer-cli","model-turn"},
 "prospecting-campaigner": {"prospecting-campaigner-cli","prospecting-executor-request"},
}
EXPECTED_ROLE = {"prospecting-manager":"manage", "prospecting-list-builder":"work",
                 "prospecting-personalizer":"work", "prospecting-campaigner":"work"}
EXPECTED_SKILLS = {
 "prospecting-manager":["kb-kit","prospecting-manager"],
 "prospecting-list-builder":["kb-kit","prospecting-list-builder"],
 "prospecting-personalizer":["kb-kit","prospecting-personalizer"],
 "prospecting-campaigner":["kb-kit","prospecting-campaigner","email-manager"],
}
EXPECTED_TABLES = {
 "prospecting-manager": set(),
 "prospecting-list-builder": {"company","person","contact_point","source_observation","employment","merge_review","fit_score_version","eligibility_decision","finder_run","finder_cursor","source_snapshot","provider_attempt","credit_reservation","audit"},
 "prospecting-personalizer": {"evidence","revision","audit"},
 "prospecting-campaigner": {"enrollment","delivery","inbound","reply_revision","suppression","relationship","audit","exec_request"},
}
def frontmatter(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8").split("---",2)[1]
    lines = [line for line in raw.splitlines() if line.strip()]
    value = {}
    parent_key = None
    for line in lines:
        key, item = line.split(":",1); key, item = key.strip(), item.strip()
        parsed = json.loads(item) if item.startswith(("[", "{")) else (item == "true" if item in {"true","false"} else item)
        if line[0].isspace():
            value[parent_key][key] = parsed
        elif item:
            value[key] = parsed
            parent_key = key
        else:
            value[key] = {}
            parent_key = key
    return value

def test_declaration_shape_and_tools() -> None:
    for agent_id in IDS:
        value = frontmatter(Path("agents")/f"{agent_id}.md")
        required = {"id","role","runtime","model","default-profile","allowed-profiles","projects","group","runner-bound","description","tools","knowledge-source","autonomy-tier","skills","what-it-replaces","builds-on","eval-cards"}
        assert set(value) == required and value["id"] == agent_id and value["projects"] == ["prospecting"]
        assert value["role"] == EXPECTED_ROLE[agent_id] and value["runner-bound"] is True
        assert value["autonomy-tier"] == "queues-for-me" and set(value["tools"]) == EXPECTED_TOOLS[agent_id]
        assert value["runtime"] == "claude" and value["model"] in {"claude-opus-5","claude-sonnet-5"}
        profile="manager:claude:claude-opus-5" if agent_id == "prospecting-manager" else "worker:claude:claude-sonnet-5"
        codex="manager:codex:gpt-5.6-sol" if agent_id == "prospecting-manager" else "worker:codex:gpt-5.6-terra"
        assert value["default-profile"] == profile and value["allowed-profiles"] == [profile,codex]
        assert value["skills"] == EXPECTED_SKILLS[agent_id] and value["group"] == "prospecting"
        assert value["what-it-replaces"] == "null" and value["description"]
        assert value["knowledge-source"] and value["builds-on"]

def test_declarations_name_exact_inputs_outputs_tables_and_limits() -> None:
    for agent_id in IDS:
        text=(Path("agents")/f"{agent_id}.md").read_text(encoding="utf-8")
        assert "## Inputs" in text and "## Outputs" in text and "## May write" in text
        declared=set(re.findall(r"`([a-z_]+)`", text.split("## May write",1)[1].split("## Never",1)[0]))
        assert declared == EXPECTED_TABLES[agent_id]
        assert "## Autonomy" in text and "queues-for-me" in text

def test_declared_unblessed_draft_cards_match_each_agent_directory() -> None:
    draft_root = Path("orgs/prospecting/evals-draft")
    for agent_id in IDS:
        cards = set((draft_root / agent_id).glob("*.md"))
        declared_cards = set(frontmatter(Path("agents") / f"{agent_id}.md")["eval-cards"])
        assert declared_cards == {card.stem for card in cards}
        assert all("judge: pytest" in card.read_text(encoding="utf-8") for card in cards)
    forbidden={path.name for path in Path("evals").rglob("prospecting-*.md")}
    assert forbidden == set()

def test_eval_card_test_files_resolve_or_are_planned() -> None:
    collected: dict[Path, str] = {}
    for card in Path("orgs/prospecting/evals-draft").rglob("*.md"):
        test_target = frontmatter(card)["input"]["test_file"]
        module_name, _, node_id = test_target.partition("::")
        module = Path(module_name)
        assert module.is_file()
        if node_id:
            if module not in collected:
                result = subprocess.run(
                    [sys.executable, "-m", "pytest", str(module), "--collect-only", "-q"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                assert result.returncode == 0, result.stderr
                collected[module] = result.stdout
            assert test_target in collected[module]

def test_no_agent_can_spawn_or_touch_raw_surfaces() -> None:
    values=[frontmatter(Path("agents")/f"{x}.md") for x in IDS]
    exposed={tool for value in values for tool in value["tools"]}
    forbidden={"gmail-send","vendor-call","credential-read","raw-browser","general-shell","spawn-agent"}
    assert exposed.isdisjoint(forbidden)
    assert all("spawn" not in value for value in values)
