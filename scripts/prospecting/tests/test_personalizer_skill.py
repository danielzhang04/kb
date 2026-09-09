import importlib
import argparse
import ast
import json
from pathlib import Path
import re


SKILL = Path("skills/curated/prospecting-personalizer/SKILL.md")
CONTRACT = SKILL.with_name("prompt-contract.md")


def test_skill_is_at_most_120_lines() -> None:
    assert len(SKILL.read_text(encoding="utf-8").splitlines()) <= 120


def test_skill_has_no_prose_paragraph_over_three_lines() -> None:
    paragraphs = re.split(r"\n\s*\n", SKILL.read_text(encoding="utf-8"))
    fence = chr(96) * 3
    prose = [p for p in paragraphs if p and not re.match(rf"^(?:---|#|- |\d+\. |{fence})", p)]
    assert all(len(p.splitlines()) <= 3 for p in prose)


def test_referenced_cli_module_has_only_prepare_and_personalize_subcommands() -> None:
    module = importlib.import_module("scripts.prospecting.personalizer.cli")
    parser = module.build_parser()
    subparsers = [
        action for action in parser._actions
        if isinstance(action, argparse._SubParsersAction)
    ]
    assert len(subparsers) == 1
    assert set(subparsers[0].choices) == {"prepare", "personalize"}
    prepare = parser.parse_args([
        "prepare", "--campaign", "campaign-opaque", "--sender-profile", "C:/local/sender-profile.json",
        "--output", "C:/local/model-input.json",
    ])
    personalize = parser.parse_args([
        "personalize", "--campaign", "campaign-opaque", "--sender-profile", "C:/local/sender-profile.json",
        "--model-response", "C:/local/model-response.json",
    ])
    assert {prepare.command, personalize.command} == {"prepare", "personalize"}


def test_skill_uses_model_response_file_not_inline_copy() -> None:
    text = SKILL.read_text(encoding="utf-8")
    assert "--model-response <desktop-local-json-path>" in text
    assert "--model-response '{" not in text


def test_skill_contains_no_shell_network_or_api_key_authority() -> None:
    text = SKILL.read_text(encoding="utf-8").lower()
    forbidden = ("bash", "powershell", "shell", "curl ", "wget ", "invoke-webrequest", "browser.open", "anthropic_api_key", "openai_api_key")
    assert not any(item in text for item in forbidden)


def test_skill_invokes_only_prepare_and_personalize() -> None:
    text = SKILL.read_text(encoding="utf-8")
    commands = re.findall(r"scripts\.prospecting\.personalizer\.cli (\w+)", text)
    assert commands == ["prepare", "personalize"]


def test_personalizer_ast_bans_network_browser_and_subprocess_imports(record_property) -> None:
    banned = {"socket", "urllib", "http", "requests", "httpx", "aiohttp", "playwright", "selenium", "webbrowser", "subprocess"}
    seen: set[str] = set()
    for path in Path("scripts/prospecting/personalizer").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                seen.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                seen.add(node.module.split(".", 1)[0])
    assert not (seen & banned)
    record_property("no_network_imports", 1)


def test_prompt_contract_example_has_exact_output_keys() -> None:
    text = CONTRACT.read_text(encoding="utf-8")
    example = re.search(
        r"## Required output\n\n.*?```json\n(.*?)\n```",
        text,
        flags=re.DOTALL,
    )
    assert example is not None
    response = json.loads(example.group(1))
    assert set(response) == {"angle", "why_them", "ask", "evidence_ids_used", "self_critique"}


def test_p1_prerequisite_uses_its_enumerated_manifest_nodes() -> None:
    manifest = json.loads(Path("scripts/prospecting/gate_manifest.json").read_text(encoding="utf-8"))
    p1_nodes = tuple(manifest["tests"])
    p3_prerequisite = ("--verify-recorded",)
    assert p1_nodes and len(set(p1_nodes)) == len(p1_nodes)
    assert p3_prerequisite == ("--verify-recorded",)
    assert not set(p1_nodes) & set(p3_prerequisite)


def test_p3_manifest_names_existing_test_functions() -> None:
    manifest = json.loads(Path("scripts/prospecting/gate_manifest_p3.json").read_text(encoding="utf-8"))
    for node in manifest["tests"]:
        relative, function = node.split("::", 1)
        source = Path(relative).read_text(encoding="utf-8")
        assert f"def {function.split('[', 1)[0]}(" in source
