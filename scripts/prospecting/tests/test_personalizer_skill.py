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


_BANNED_TOP_LEVEL_MODULES = frozenset({
    "socket", "urllib", "http", "requests", "httpx", "aiohttp",
    "playwright", "selenium", "webbrowser", "subprocess",
})
_PRIVILEGED_RUNTIME_MODULES = frozenset({"private_runtime", "private_stage_adapter"})
# Keyed by exact repository-relative path (never a bare basename), so a
# nested/untrusted file that happens to reuse a trusted filename -- e.g.
# ``scripts/prospecting/personalizer/untrusted/private_runtime.py`` -- gets
# no allowance and no privileged-import exemption.
_TRUSTED_RUNTIME_PATH = "scripts/prospecting/personalizer/private_runtime.py"
_TRUSTED_ADAPTER_PATH = "scripts/prospecting/personalizer/private_stage_adapter.py"
_ALLOWED_IMPORTS_BY_PATH = {
    # The trusted desktop-local runtime owns the loopback HTTP fixture and the
    # owned Windows process launcher it starts via subprocess.
    _TRUSTED_RUNTIME_PATH: frozenset({"http.server", "subprocess"}),
    # The stage adapter only ever parses (never fetches) URLs, and it is the
    # single file permitted to hold a reference to the trusted runtime.
    _TRUSTED_ADAPTER_PATH: frozenset({"urllib.parse"}),
}


def scan_personalizer_imports(source: str, relative_path: str) -> tuple[str, ...]:
    """Return sorted banned/privileged-import violation codes for one source file.

    Boundary intent: the desktop-local trusted runtime (``private_runtime.py``)
    and its stage adapter (``private_stage_adapter.py``) are the only files
    permitted to reach the local loopback HTTP fixture, the owned Windows
    process launcher, or a URL-parsing helper -- and only the adapter may hold
    a reference to the runtime module. Every other file under
    ``scripts/prospecting/personalizer`` -- including the untrusted
    agent-core/CLI surface and any file added later -- stays on the fully
    banned list, with no broad ``private_*`` exemption and no blanket
    ``urllib``/``http`` allowance.

    Allowances and the privileged-adapter exemption are matched against the
    exact repository-relative path (``relative_path`` as given, not
    ``Path(...).name``), so a nested file that shares a trusted basename
    inherits no authority. Privileged-runtime references are detected across
    every import shape actually used in this codebase: ``import a.b.private_runtime``,
    ``from a.b import private_runtime``, ``from a.b.private_runtime import x``,
    and relative forms with no ``module`` (``from . import private_runtime``)
    or with a relative module (``from .private_runtime import x``).

    This is a static AST boundary regression check over literal import
    statements only, not an exhaustive Python sandbox proof: dynamic imports
    (``importlib.import_module``, ``__import__``) and attribute access
    reached through an already-imported trusted module are out of scope.
    """
    tree = ast.parse(source, filename=relative_path)
    allowed = _ALLOWED_IMPORTS_BY_PATH.get(relative_path, frozenset())
    violations: set[str] = set()

    def check_privileged(imported_name: str, report_as: str) -> None:
        if not imported_name:
            return
        last = imported_name.rsplit(".", 1)[-1]
        if last in _PRIVILEGED_RUNTIME_MODULES and relative_path != _TRUSTED_ADAPTER_PATH:
            violations.add(f"privileged:{report_as}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                dotted = alias.name
                top = dotted.split(".", 1)[0]
                if top in _BANNED_TOP_LEVEL_MODULES and dotted not in allowed and top not in allowed:
                    violations.add(f"import:{dotted}")
                check_privileged(dotted, dotted)
        elif isinstance(node, ast.ImportFrom):
            module = node.module
            if module:
                top = module.split(".", 1)[0]
                if top in _BANNED_TOP_LEVEL_MODULES and module not in allowed and top not in allowed:
                    violations.add(f"importfrom:{module}")
                # Catches privileged submodule imports such as
                # ``from a.b.private_runtime import main``, where the alias
                # ("main") carries no signal but the module path itself does.
                check_privileged(module, module)
                for alias in node.names:
                    check_privileged(alias.name, f"{module}.{alias.name}")
            else:
                # Relative "from . import x" / "from .. import x" forms carry
                # no module name (node.module is None); the imported alias is
                # the only available signal for a privileged-runtime reference.
                prefix = "." * node.level
                for alias in node.names:
                    check_privileged(alias.name, f"{prefix}{alias.name}")
    return tuple(sorted(violations))


def test_personalizer_ast_bans_network_browser_and_subprocess_imports(record_property) -> None:
    """Boundary regression: static evidence, not an exhaustive sandbox proof.

    ``no_network_imports`` is preserved as the agent-core boundary metric:
    the personalizer's untrusted CLI/core surface must carry zero
    network-shaped or privileged-runtime imports, while the two trusted
    desktop runtime files keep only their narrow, per-file exact allowances.
    """
    violations: dict[str, tuple[str, ...]] = {}
    for path in Path("scripts/prospecting/personalizer").rglob("*.py"):
        relative = path.as_posix()
        found = scan_personalizer_imports(path.read_text(encoding="utf-8"), relative)
        if found:
            violations[relative] = found
    assert violations == {}
    record_property("no_network_imports", 1)


def test_scan_personalizer_imports_accepts_exact_allowed_imports_only_at_matching_filename() -> None:
    runtime_source = "import subprocess\nfrom http.server import BaseHTTPRequestHandler\n"
    assert scan_personalizer_imports(
        runtime_source, "scripts/prospecting/personalizer/private_runtime.py",
    ) == ()
    assert scan_personalizer_imports(
        runtime_source, "scripts/prospecting/personalizer/cli.py",
    ) != ()

    adapter_source = (
        "from urllib.parse import urlsplit\n"
        "from scripts.prospecting.personalizer import private_runtime as runtime\n"
    )
    assert scan_personalizer_imports(
        adapter_source, "scripts/prospecting/personalizer/private_stage_adapter.py",
    ) == ()
    assert scan_personalizer_imports(
        adapter_source, "scripts/prospecting/personalizer/cli.py",
    ) != ()


def test_scan_personalizer_imports_rejects_wrong_module_at_allowed_filename() -> None:
    assert scan_personalizer_imports(
        "import urllib.request\n", "scripts/prospecting/personalizer/private_runtime.py",
    ) == ("import:urllib.request",)
    assert scan_personalizer_imports(
        "import subprocess\n", "scripts/prospecting/personalizer/private_stage_adapter.py",
    ) == ("import:subprocess",)


def test_scan_personalizer_imports_rejects_arbitrary_new_module_anywhere() -> None:
    assert scan_personalizer_imports(
        "import requests\n", "scripts/prospecting/personalizer/some_future_file.py",
    ) == ("import:requests",)


def test_scan_personalizer_imports_rejects_privileged_runtime_imports_in_agent_core() -> None:
    assert scan_personalizer_imports(
        "import scripts.prospecting.personalizer.private_runtime\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:scripts.prospecting.personalizer.private_runtime",)
    assert scan_personalizer_imports(
        "from scripts.prospecting.personalizer import private_runtime\n",
        "scripts/prospecting/personalizer/agent_core.py",
    ) == ("privileged:scripts.prospecting.personalizer.private_runtime",)
    assert scan_personalizer_imports(
        "from scripts.prospecting.personalizer import private_stage_adapter as adapter\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:scripts.prospecting.personalizer.private_stage_adapter",)


def test_scan_personalizer_imports_rejects_privileged_submodule_from_import() -> None:
    """Regression for hole (1): ``from a.b.private_runtime import main``.

    The imported alias ("main") carries no signal on its own; only the
    ``ImportFrom.module`` dotted path reveals the privileged reference.
    """
    assert scan_personalizer_imports(
        "from scripts.prospecting.personalizer.private_runtime import main\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:scripts.prospecting.personalizer.private_runtime",)


def test_scan_personalizer_imports_rejects_privileged_adapter_submodule_from_import() -> None:
    """Direct from-import of the adapter module, from an untrusted file."""
    assert scan_personalizer_imports(
        "from scripts.prospecting.personalizer.private_stage_adapter import build_url\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:scripts.prospecting.personalizer.private_stage_adapter",)


def test_scan_personalizer_imports_rejects_relative_privileged_from_import() -> None:
    """Regression for hole (2): ``from . import private_runtime`` (module is None).

    A prior version of the scanner only inspected ``ImportFrom`` nodes when
    ``node.module`` was truthy, silently skipping this no-module relative form.
    """
    assert scan_personalizer_imports(
        "from . import private_runtime\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:.private_runtime",)
    assert scan_personalizer_imports(
        "from .private_runtime import main\n",
        "scripts/prospecting/personalizer/cli.py",
    ) == ("privileged:private_runtime",)


def test_scan_personalizer_imports_rejects_nested_untrusted_path_with_trusted_basename() -> None:
    """Regression for hole (3): a nested file reusing a trusted basename.

    A prior version keyed allowances by ``Path(...).name``, so
    ``scripts/prospecting/personalizer/untrusted/private_runtime.py`` wrongly
    inherited the exact-file allowance meant only for the real, top-level
    trusted runtime path.
    """
    assert scan_personalizer_imports(
        "import subprocess\n",
        "scripts/prospecting/personalizer/untrusted/private_runtime.py",
    ) == ("import:subprocess",)


def test_scan_personalizer_imports_accepts_relative_runtime_import_only_at_exact_adapter_path() -> None:
    """The adapter is exempt only at its exact trusted repository path."""
    assert scan_personalizer_imports(
        "from . import private_runtime\n",
        "scripts/prospecting/personalizer/private_stage_adapter.py",
    ) == ()
    assert scan_personalizer_imports(
        "from .private_runtime import main\n",
        "scripts/prospecting/personalizer/private_stage_adapter.py",
    ) == ()
    # Same relative import text, wrong (nested, non-adapter) path: still banned.
    assert scan_personalizer_imports(
        "from . import private_runtime\n",
        "scripts/prospecting/personalizer/untrusted/private_stage_adapter.py",
    ) == ("privileged:.private_runtime",)


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
