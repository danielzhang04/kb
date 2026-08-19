"""Per-agent eval suites — the canary discipline, new scope (spec §4).

`evals/agents/<agent-id>/*.md` are golden task cards for ONE agent's job. Three
judges are deterministic (`file-exists`, `output-contains`, `pytest` — no
network, no model calls); a fourth, `judge: model` (Task 6), shells the local
`claude -p` subscription CLI — never a live call in this repo's tests (every
test mocks `subprocess.run`) and EXCLUDED from `run_suite` by default
(`include_model_judged=True` opts in). `judge: model` cards are marked
`CardResult.hermetic = False`.

`evals/agents/_fleet/` (Task 6 fold-in) is a shared baseline suite runnable
against ANY agent id via `run_suite(..., fleet=True)`; results record under
`eval:<agent-id>:fleet-<card-id>`, a namespace distinct from that agent's own
suite.

Reused verbatim from `scripts/canary.py` (one discipline, one implementation):
the card-file glob and `split_frontmatter` (this module's OWN manifest scope is
broader than canary's `*.md`-only one — see the manifest section below). A
suite REFUSES to run when its `MANIFEST.sha256` does not match the files on
disk — someone edited a golden oracle. Re-blessing is a human-witnessed act
(`--update-manifest`, and only on a green suite, routed through the private
`_run_for_bless` helper — `run_suite`'s manifest-skip escape hatch
(`_skip_verify`) is module-private and unreachable from a public kwarg).

Grade rows land through the UNCHANGED `grade.py` schema in a RESERVED namespace:
`worker="eval-suite"`, `task_type="eval:<agent-id>:<card-id>"`. Because
`promotion.status()` is keyed on `(worker, project, task_type, tier)`, no volume
of eval passes can ever move the agent's own autonomy — tested, not assumed.

Public API:
    suite_dir(repo_root, agent_id)                -> Path
    load_cards(suite_dir)                         -> list[EvalCard]
    run_card(card, repo_root)                     -> CardResult
    run_suite(repo_root, agent_id, ...)           -> SuiteReport
    update_manifest(repo_root, agent_id)          -> Path
CLI:
    py -3 -m scripts.agent_evals run <agent-id> [--record] [--update-manifest]
                                    [--fleet] [--include-model-judged]
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `py -3 -m scripts.agent_evals`

import canary  # noqa: E402  (manifest + card-parsing machinery, reused not copied)
import grade  # noqa: E402
import preamble  # noqa: E402

EVAL_WORKER = "eval-suite"
EVAL_PROJECT = "kb"
INSPECTOR_ID = canary.INSPECTOR_ID
SUITES_ROOT = ("evals", "agents")
FLEET_SUITE_ID = "_fleet"    # evals/agents/_fleet/ — golden cards runnable against ANY agent id

DEFAULT_TIMEOUT = 120        # seconds, `output-contains`
PYTEST_TIMEOUT = 600         # seconds, `pytest` judge
MODEL_TIMEOUT = 180          # seconds, `model` judge (subscription `claude -p`, never live in tests)
_CLEAN_ENV_VARS = (
    "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "HOME", "LOCALAPPDATA", "PATH",
    "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
)

EXIT_OK = canary.EXIT_OK
EXIT_FAIL = canary.EXIT_FAIL
EXIT_TAMPER = canary.EXIT_TAMPER


class EvalCardError(Exception):
    """Malformed eval card."""


# --------------------------------------------------------------------------- #
# card model                                                                   #
# --------------------------------------------------------------------------- #
_REQUIRED_META = ("id", "capability", "judge", "rubric_version", "k", "source",
                  "immutable", "tier")


@dataclass
class EvalCard:
    meta: dict
    body: str
    path: Path

    @property
    def id(self) -> str:
        return str(self.meta["id"])

    @property
    def capability(self) -> str:
        return str(self.meta["capability"])

    @property
    def judge(self) -> str:
        return str(self.meta["judge"])

    @property
    def input(self) -> dict:
        return self.meta.get("input") or {}

    @property
    def k(self) -> int:
        return max(1, int(self.meta.get("k", 1) or 1))

    @property
    def tier(self) -> str:
        return str(self.meta.get("tier") or "T1")

    @property
    def rubric_version(self) -> str:
        return str(self.meta.get("rubric_version", "1"))


def suite_dir(repo_root: Path, agent_id: str) -> Path:
    """`<repo>/evals/agents/<agent-id>/`. The id is a single path segment."""
    aid = str(agent_id)
    if not aid or "/" in aid or "\\" in aid or aid.startswith("."):
        raise ValueError(f"invalid agent id {agent_id!r}")
    return Path(repo_root).joinpath(*SUITES_ROOT, aid)


def parse_card(path: Path) -> EvalCard:
    meta, body = canary.split_frontmatter(path)
    for key in _REQUIRED_META:
        if key not in meta:
            raise EvalCardError(f"{path}: missing required frontmatter field {key!r}")
    return EvalCard(meta=meta, body=body, path=Path(path))


def load_cards(directory: Path) -> list[EvalCard]:
    """Every card in a suite directory, sorted. Uses canary's own card-file glob
    (README excluded) so the loader and the manifest can never disagree about
    which files are golden."""
    return [parse_card(p) for p in canary._canary_files(Path(directory))]


# --------------------------------------------------------------------------- #
# path/env hardening shared by every judge that shells out or reads a file     #
# --------------------------------------------------------------------------- #
def _resolve_contained(repo_root: Path, rel) -> Path | None:
    """Resolve ``rel`` under ``repo_root``; ``None`` when it is missing, an
    absolute path, or escapes ``repo_root`` via ``..``. Every judge that reads a
    path out of card ``input`` (file-exists, pytest) must route through this —
    a card is data, not code, and must never be able to steer a judge outside
    the repo tree."""
    if not rel:
        return None
    rel_path = Path(str(rel))
    if rel_path.is_absolute():
        return None
    root = Path(repo_root).resolve()
    candidate = (root / rel_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def _clean_env() -> dict:
    """The environment for every judge subprocess, with no ambient values.

    A card may add a named parent value through ``input.env_vars`` in the one
    judge that supports it. Keeping the baseline empty prevents credentials or
    unrelated process configuration from becoming an accidental inheritance
    path. ``PYTHONDONTWRITEBYTECODE`` keeps judges from polluting the suite.
    """
    env = {name: os.environ[name] for name in _CLEAN_ENV_VARS if name in os.environ}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def _substitute_agent_id(value, agent_id: str):
    """Recursively replace the ``{agent_id}`` token in string values — used only
    for `_fleet` cards, which are ONE golden oracle shared by every agent, not
    one card per agent."""
    if isinstance(value, str):
        return value.replace("{agent_id}", agent_id)
    if isinstance(value, list):
        return [_substitute_agent_id(v, agent_id) for v in value]
    if isinstance(value, dict):
        return {k: _substitute_agent_id(v, agent_id) for k, v in value.items()}
    return value


def _with_target(card: EvalCard, agent_id: str | None) -> EvalCard:
    """A shallow copy of ``card`` with `{agent_id}` substituted through its
    ``input`` block. ``id``/``capability``/``judge`` are untouched — only what a
    judge reads out of ``input`` changes."""
    if agent_id is None:
        return card
    # agent_factory imports this module for EVAL_WORKER, so defer the reverse
    # import until substitution. This makes the factory's grammar authoritative
    # without creating an import-time cycle.
    from agent_factory import SAFE_AGENT_ID
    if not SAFE_AGENT_ID.fullmatch(agent_id):
        raise ValueError(f"unsafe agent id: {agent_id!r}")
    new_meta = dict(card.meta)
    new_meta["input"] = _substitute_agent_id(card.input, agent_id)
    return EvalCard(meta=new_meta, body=card.body, path=card.path)


# --------------------------------------------------------------------------- #
# deterministic judges — each: (card, repo_root) -> (passed, detail)           #
# --------------------------------------------------------------------------- #
def _judge_file_exists(card: EvalCard, repo_root: Path):
    rel = card.input.get("path")
    if not rel:
        return False, "file-exists card needs input.path"
    target = _resolve_contained(repo_root, rel)
    if target is None:
        return False, f"path escapes repo root or is invalid: {rel}"
    if target.exists():
        return True, f"exists: {rel}"
    return False, f"missing file: {rel}"


def _output_contains_env(card: EvalCard) -> dict:
    """Return a clean subprocess environment plus named parent values only."""
    mode = str(card.input.get("env", "cleaned")).strip().lower()
    if mode == "parent":
        raise ValueError("env: parent removed — declare input.env_vars")
    env_vars = card.input.get("env_vars", [])
    if not isinstance(env_vars, list) or not all(isinstance(name, str) and name for name in env_vars):
        raise ValueError("input.env_vars must be a list of non-empty variable names")
    env = _clean_env()
    for name in env_vars:
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def _judge_output_contains(card: EvalCard, repo_root: Path):
    command = card.input.get("command")
    needle = card.input.get("contains")
    expect_empty = bool(card.input.get("expect_empty", False))
    if not isinstance(command, list) or not command or (needle is None and not expect_empty):
        return False, ("output-contains card needs a list input.command and "
                       "(input.contains or input.expect_empty)")
    # `{python}` resolves to the running interpreter so a card can shell a
    # portable python probe without hardcoding a platform-specific launcher.
    resolved = [sys.executable if part == "{python}" else str(part) for part in command]
    timeout = int(card.input.get("timeout") or DEFAULT_TIMEOUT)
    env = _output_contains_env(card)
    # A clean subprocess does not inherit the host's Git config. Trust this
    # checked repository only, so a probe can run a repo-local Git command.
    env.update({
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "safe.directory",
        "GIT_CONFIG_VALUE_0": str(repo_root),
    })
    try:
        res = subprocess.run(resolved, cwd=str(repo_root), capture_output=True, text=True,
                             timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, f"command failed to run: {err}"
    out = (res.stdout or "") + (res.stderr or "")
    if expect_empty:
        if out.strip() == "":
            return True, "output empty as expected"
        return False, f"expected empty output, got: {out.strip()[:200]!r}"
    if str(needle) in out:
        return True, f"output contains {needle!r}"
    return False, f"output missing {str(needle)!r} (exit {res.returncode})"


def _judge_pytest(card: EvalCard, repo_root: Path):
    test_file = card.input.get("test_file")
    if not test_file:
        return False, "pytest card needs input.test_file"
    if _resolve_contained(repo_root, test_file) is None:
        return False, f"path escapes repo root or is invalid: {test_file}"
    cmd = [sys.executable, "-m", "pytest", str(test_file), "-q", "-p", "no:cacheprovider"]
    env = _clean_env()
    # The clean environment does not inherit the host's Git configuration.
    # Trust only this checked repository when its own tests invoke Git.
    env.update({
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "safe.directory",
        "GIT_CONFIG_VALUE_0": str(repo_root),
    })
    try:
        res = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True,
                             timeout=PYTEST_TIMEOUT, env=env)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, f"pytest failed to run: {err}"
    tail = [ln for ln in (res.stdout or "").splitlines() if ln.strip()]
    detail = tail[-1].strip() if tail else f"exit {res.returncode}"
    return (res.returncode == 0), f"{test_file}: {detail}"


MODEL_JUDGE_MODEL = "claude-sonnet-5"


def _judge_model(card: EvalCard, repo_root: Path):
    """`judge: model` — `claude -p <PROMPT TEXT> --model claude-sonnet-5
    --output-format text --tools ""`, verdict = first line PASS/FAIL.

    Hardening: the prompt file's TEXT is passed on argv (never just its path —
    the model must not need filesystem access to read its own prompt); the
    model is PINNED (`--model claude-sonnet-5`, never "whatever's default");
    `--tools ""` disables every built-in tool (`claude --help`: '"" to disable
    all tools') — a judge only ever needs to read a prompt and emit a verdict
    line, never to touch a file; the subprocess `cwd` is a FRESH temp
    directory, never `repo_root`, so even if a tool were somehow available it
    could not write into this repo; and the env has ANTHROPIC_API_KEY popped
    defensively (subscription-only). NEVER exercised in tests with a real
    process — every test mocks `subprocess.run`. Not hermetic (a live model,
    on the machine's own subscription session, actually runs); the runner
    marks the resulting `CardResult.hermetic = False` and `run_suite` excludes
    `judge: model` cards by default (`include_model_judged=True` opts in)."""
    rel = card.input.get("prompt_file")
    if not rel:
        return False, "model card needs input.prompt_file"
    prompt_path = _resolve_contained(repo_root, rel)
    if prompt_path is None or not prompt_path.exists():
        return False, f"missing or invalid prompt file: {rel}"
    try:
        prompt_text = prompt_path.read_text(encoding="utf-8")
    except OSError as err:
        return False, f"could not read prompt file: {err}"
    timeout = int(card.input.get("timeout") or MODEL_TIMEOUT)
    cmd = ["claude", "-p", prompt_text, "--model", MODEL_JUDGE_MODEL,
           "--output-format", "text", "--tools", ""]
    try:
        with tempfile.TemporaryDirectory(prefix="kb-eval-model-") as scratch:
            res = subprocess.run(cmd, cwd=scratch, capture_output=True, text=True,
                                 timeout=timeout, env=_clean_env())
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, f"model judge failed to run: {err}"
    out = (res.stdout or "").strip()
    first_line = out.splitlines()[0].strip() if out else ""
    verdict = first_line.upper()
    if verdict == "PASS":
        return True, first_line or "model verdict: PASS"
    if verdict == "FAIL":
        return False, first_line or "model verdict: FAIL"
    return False, f"model verdict unparseable: {first_line!r} (exit {res.returncode})"


JUDGES = {
    "file-exists": _judge_file_exists,
    "output-contains": _judge_output_contains,
    "pytest": _judge_pytest,
    "model": _judge_model,
}


# --------------------------------------------------------------------------- #
# running                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class CardResult:
    id: str
    passed: bool
    reason: str
    k: int = 1
    capability: str = ""
    hermetic: bool = True


@dataclass
class SuiteReport:
    agent_id: str
    cards: list = field(default_factory=list)
    reason: str = ""
    tampered: bool = False

    @property
    def passed(self) -> bool:
        return not self.reason and bool(self.cards) and all(c.passed for c in self.cards)

    @property
    def failures(self) -> list:
        return [c for c in self.cards if not c.passed]


def run_card(card: EvalCard, repo_root: Path) -> CardResult:
    """Run one card `k` times; it passes only if every repeat passes (pass^k).
    `judge: model` cards are marked `hermetic=False` — every other judge is a
    pure/deterministic local check."""
    hermetic = card.judge != "model"
    judge = JUDGES.get(card.judge)
    if judge is None:
        return CardResult(card.id, False,
                          f"unknown judge {card.judge!r} (deterministic judges: "
                          f"{', '.join(sorted(JUDGES))})", card.k, card.capability, hermetic)
    detail = ""
    for _ in range(card.k):
        try:
            ok, detail = judge(card, Path(repo_root))
        except Exception as err:  # a judge crash is a CARD failure, never a suite crash
            return CardResult(card.id, False, f"judge error: {err!r}", card.k,
                              card.capability, hermetic)
        if not ok:
            return CardResult(card.id, False, detail, card.k, card.capability, hermetic)
    return CardResult(card.id, True, detail, card.k, card.capability, hermetic)


def _record_result(record_root: Path, agent_id: str, card: EvalCard,
                   result: CardResult, *, task_suffix: str | None = None) -> None:
    """One grade row per card, through the pinned schema, in the RESERVED eval
    namespace (never the agent's own worker identity). `task_suffix` lets fleet
    runs record under `eval:<agent-id>:fleet-<card-id>` instead of the card's
    own id, so a shared `_fleet` card never collides with a per-agent one."""
    suffix = card.id if task_suffix is None else task_suffix
    grade.record_grade(
        Path(record_root),
        worker=EVAL_WORKER,
        project=EVAL_PROJECT,
        task_type=f"eval:{agent_id}:{suffix}",
        tier=card.tier,
        card_id=card.id,
        score=100.0 if result.passed else 0.0,
        rubric_version=card.rubric_version,
        inspector_id=INSPECTOR_ID,
        **{"pass": result.passed},
    )


def run_suite(repo_root: Path, agent_id: str, *, record: bool = False,
              record_root: Path | None = None,
              include_model_judged: bool = False, fleet: bool = False,
              _skip_verify: bool = False) -> SuiteReport:
    """Run every (deterministic-by-default) card in `evals/agents/<agent-id>/`.

    Refuses (no cards run, no rows recorded) when the suite's MANIFEST.sha256
    does not verify. With `record`, appends one grade row per card to
    `record_root` (defaults to `repo_root`); tests always pass a tmp root.

    `judge: model` cards are excluded unless `include_model_judged=True` (they
    are never hermetic and never run in this repo's tests).

    `fleet=True` runs the SHARED `evals/agents/_fleet/` baseline suite instead
    of `evals/agents/<agent-id>/`, substituting `{agent_id}` through each
    card's `input` so the same golden cards are runnable against any agent id;
    results record under `eval:<agent-id>:fleet-<card-id>` — a distinct
    sub-namespace from that agent's own suite, and still fully isolated from
    the agent's own promotion streak.

    `_skip_verify` is a MODULE-PRIVATE escape hatch (leading underscore, not
    part of the public contract) reachable ONLY through `_run_for_bless` — a
    casual `import agent_evals; agent_evals.run_suite(..., verify=False)` is
    no longer possible; the tamper anchor is not something a public kwarg name
    should ever have invited a caller to skip."""
    repo_root = Path(repo_root)
    suite_name = FLEET_SUITE_ID if fleet else agent_id
    directory = suite_dir(repo_root, suite_name)
    if not directory.is_dir():
        return SuiteReport(agent_id, [], f"no eval suite at evals/agents/{suite_name}/")

    if not _skip_verify:
        ok, problems = verify_suite_manifest(directory)
        if not ok:
            return SuiteReport(agent_id, [],
                               "manifest verification failed: " + "; ".join(problems),
                               tampered=True)
    try:
        cards = load_cards(directory)
    except (EvalCardError, canary.CanaryError) as err:
        return SuiteReport(agent_id, [], f"card parse error: {err}")

    if not include_model_judged:
        cards = [c for c in cards if c.judge != "model"]
    if not cards:
        return SuiteReport(agent_id, [], f"no eval cards in evals/agents/{suite_name}/")

    results: list[CardResult] = []
    for card in cards:
        effective = _with_target(card, agent_id) if fleet else card
        result = run_card(effective, repo_root)
        results.append(result)
        if record:
            task_suffix = f"fleet-{card.id}" if fleet else None
            _record_result(Path(record_root or repo_root), agent_id, card, result,
                           task_suffix=task_suffix)
    return SuiteReport(agent_id, results)


def _run_for_bless(repo_root: Path, agent_id: str, *, fleet: bool = False) -> SuiteReport:
    """Run a suite bypassing manifest verification — ONLY for the human-witnessed
    `--update-manifest` re-bless flow. This is the ONE legitimate call site for
    `run_suite`'s `_skip_verify` escape hatch; routing it through this private
    helper (rather than a public `verify=` kwarg on `run_suite` itself) keeps
    the tamper anchor from being casually skipped by an importer."""
    return run_suite(repo_root, agent_id, fleet=fleet, _skip_verify=True)


# --------------------------------------------------------------------------- #
# manifest (human-gated re-bless) — suite scope covers EVERY file, not *.md    #
# --------------------------------------------------------------------------- #
# Deliberately NOT `canary.verify_manifest`/`update_manifest`: those stay
# pinned to canary's own `*.md`-only glob (the root `evals/MANIFEST.sha256`
# scope must never change — canaries stay `*.md`, existing entries never
# re-blessed by this module). An agent suite's oracle is broader: a card
# references a supporting file (a pytest test, a model-judge prompt) that is
# just as golden as the card itself — tampering with `test_x.py` while leaving
# the card untouched must trip the SAME tamper anchor.
def _suite_files(directory: Path) -> list[Path]:
    """Every file anchored by a suite's manifest: cards (`*.md`) AND any
    supporting file a card's `input` points at. Excludes `README.md`
    (documentation, never golden), `MANIFEST.sha256` (the anchor itself), and
    any directory (`__pycache__` bytecode cache above all — suites are flat;
    they carry no golden subdirectories)."""
    directory = Path(directory)
    if not directory.is_dir():
        return []
    out: list[Path] = []
    for p in sorted(directory.iterdir()):
        if p.is_dir():
            continue
        if p.name == canary.MANIFEST_NAME:
            continue
        if p.name.lower() == "readme.md":
            continue
        out.append(p)
    return out


def _suite_manifest_entries(directory: Path) -> list[tuple[str, str]]:
    return [(hashlib.sha256(p.read_bytes()).hexdigest(), p.name) for p in _suite_files(directory)]


def _read_suite_manifest(directory: Path) -> dict[str, str]:
    path = Path(directory) / canary.MANIFEST_NAME
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            out[parts[1]] = parts[0]
    return out


def verify_suite_manifest(directory: Path) -> tuple[bool, list[str]]:
    """Like `canary.verify_manifest`, but over `_suite_files` (every file, not
    only `*.md`) — the suite's own broader oracle scope."""
    directory = Path(directory)
    if not (directory / canary.MANIFEST_NAME).exists():
        return False, [f"missing {canary.MANIFEST_NAME}"]
    recorded = _read_suite_manifest(directory)
    actual = {name: h for h, name in _suite_manifest_entries(directory)}
    problems: list[str] = []
    for name, h in actual.items():
        if name not in recorded:
            problems.append(f"unmanifested file: {name}")
        elif recorded[name] != h:
            problems.append(f"hash mismatch (tampered): {name}")
    for name in recorded:
        if name not in actual:
            problems.append(f"manifested file missing from disk: {name}")
    return (not problems), problems


def update_suite_manifest(directory: Path, header) -> Path:
    """(Re)write a suite's `MANIFEST.sha256` from `_suite_files`."""
    directory = Path(directory)
    lines = list(header)
    lines += [f"{h}  {name}" for h, name in _suite_manifest_entries(directory)]
    path = directory / canary.MANIFEST_NAME
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _manifest_header(agent_id: str) -> tuple[str, ...]:
    return (
        f"# evals/agents/{agent_id}/MANIFEST.sha256 — golden eval-suite file hashes",
        "# (every file in this dir except README.md and this manifest — cards AND any",
        "# supporting .py/prompt file a card references).",
        "# Re-bless ONLY via `py -3 -m scripts.agent_evals run <agent-id> --update-manifest`",
        "# on a green suite, as a HUMAN-witnessed act: an agent must never silently",
        "# re-bless its own oracle. A mismatch makes the suite refuse to run.",
        "",
    )


def update_manifest(repo_root: Path, agent_id: str) -> Path:
    """(Re)write the suite's MANIFEST.sha256 — suite scope (every file)."""
    return update_suite_manifest(suite_dir(repo_root, agent_id), _manifest_header(agent_id))


def verify_manifest(repo_root: Path, agent_id: str) -> tuple[bool, list[str]]:
    """Suite scope verifier (every file, not only `*.md`)."""
    return verify_suite_manifest(suite_dir(repo_root, agent_id))


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def _render_table(report: SuiteReport) -> str:
    if report.reason:
        return f"suite {report.agent_id}: REFUSED — {report.reason}"
    rows = ["card                      k   herm  result  detail", "-" * 80]
    for c in report.cards:
        rows.append(f"{c.id:<24}  {c.k:<2}  {'Y' if c.hermetic else 'N':<4}  "
                    f"{'PASS' if c.passed else 'FAIL':<6}  {c.reason}")
    passed = len(report.cards) - len(report.failures)
    rows.append("-" * 80)
    rows.append(f"{passed}/{len(report.cards)} eval cards passed ({report.agent_id})")
    return "\n".join(rows)


def _safe_cost_fn():
    try:
        import ledger
        return ledger.cost_today
    except ImportError:
        return None


def _force_utf8_stdio() -> None:
    """A Windows cp1252 console raises `UnicodeEncodeError` out of `print()`
    on a non-cp1252 character (e.g. `→`/`中` embedded in a card's `reason`,
    reachable via `output-contains`/`pytest` echoing raw subprocess output).
    An uncaught exception here would exit non-zero and break the exit-0
    contract this CLI's exit code otherwise holds. Reconfiguring both streams
    to UTF-8 with `errors="replace"` at entry makes a `print()` call incapable
    of raising on encoding, ever. `hasattr` guards environments (older Python,
    some redirected-stream shims) where `.reconfigure` does not exist."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None) -> int:
    _force_utf8_stdio()
    ap = argparse.ArgumentParser(
        prog="agent_evals", description="Per-agent eval suite runner (deterministic judges)")
    sub = ap.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run one agent's eval suite")
    run.add_argument("agent_id")
    run.add_argument("--record", action="store_true",
                     help="append a grade row per card (worker=eval-suite)")
    run.add_argument("--record-root", default=None,
                     help="ledger root for --record (default: the repo)")
    run.add_argument("--update-manifest", action="store_true",
                     help="re-bless MANIFEST.sha256 — only on a green suite, human-witnessed")
    run.add_argument("--fleet", action="store_true",
                     help="run the shared evals/agents/_fleet/ baseline suite against "
                          "this agent id instead of its own suite (with --update-manifest, "
                          "blesses the _fleet suite itself)")
    run.add_argument("--include-model-judged", action="store_true",
                     help="also run judge: model cards (subscription `claude -p`, never live in tests)")
    run.add_argument("--repo", default=".", help="repo root")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()

    # Preamble supremacy: STOP-file / API-key / budget gate before anything runs.
    problems = preamble.check(repo_root, cost_today_fn=_safe_cost_fn())
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_TAMPER

    if args.update_manifest:
        suite_id = FLEET_SUITE_ID if args.fleet else args.agent_id
        report = _run_for_bless(repo_root, args.agent_id, fleet=args.fleet)
        if not report.passed:
            print("refusing to re-bless: suite is not green", file=sys.stderr)
            print(_render_table(report), file=sys.stderr)
            return EXIT_FAIL
        path = update_manifest(repo_root, suite_id)
        print("WARNING: re-blessing a golden suite is a HUMAN act — a human must witness "
              "this change and commit it deliberately.")
        print(f"updated {path} ({len(report.cards)} cards)")
        return EXIT_OK

    report = run_suite(repo_root, args.agent_id, record=args.record,
                       record_root=Path(args.record_root) if args.record_root else None,
                       fleet=args.fleet, include_model_judged=args.include_model_judged)
    print(_render_table(report))
    if report.tampered:
        return EXIT_TAMPER
    return EXIT_OK if report.passed else EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
