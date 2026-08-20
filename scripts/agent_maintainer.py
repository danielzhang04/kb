"""Bounded, draft-only maintainer fire.

This module reads only its supplied evidence directories and returns proposal drafts. A
caller must put a rendered card body through normal human review; this module never
writes targets, mutates the queue or ledgers, changes git refs, contacts a remote, or
registers a cadence. Optional forecasts use a disposable local git worktree only.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import html
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Iterator, Mapping

from scripts import agent_evals
from scripts.agent_definitions import has_unsafe_link_component
from scripts.kb_paths import resolve_state_root


MAX_PROPOSALS_PER_FIRE = 5
MAX_FILES_PER_SOURCE = 100
MAX_ENTRIES_PER_DIRECTORY = 10_000
MAX_BYTES_PER_FILE = 128 * 1024
MAX_LEDGER_ROWS_PER_FILE = 1_000

# Forecasts intentionally have tighter limits than ordinary eval execution.  They
# are diagnostic only and must never turn a maintainer fire into an unbounded job.
FORECAST_MAX_CARDS_PER_SUITE = 20
FORECAST_SUITE_DEADLINE_SECONDS = 30
FORECAST_FIRE_DEADLINE_SECONDS = 90
FORECAST_PYTEST_TIMEOUT_SECONDS = 20
FORECAST_STALE_LEASE_SECONDS = 60 * 60
FORECAST_WORKTREE_PREFIX = "forecast-"

_EXECUTABLE_SUFFIXES = frozenset({".py", ".ts", ".js"})
_AGENT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_EVAL_SECTION = re.compile(r"^##\s+([a-z0-9][a-z0-9-]{0,63})\s*$", re.MULTILINE)
_FAILURE_WORDS = re.compile(r"\b(fail(?:ed|ure)?|blocked|parked|remains|follow[- ]up|todo)\b", re.I)
_EMBEDDED_PATH = re.compile(
    r"(?<![A-Za-z0-9_.-])(?:[A-Za-z]:[\\/]|//|/)?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+(?![A-Za-z0-9_.-])"
)
_DIFF_PATH = re.compile(
    r"^(?:diff --git a/(\S+) b/(\S+)|---\s+(\S+)|\+\+\+\s+(\S+)|"
    r"(?:rename|copy)\s+(?:from|to)\s+(.+?))\s*$",
    re.MULTILINE,
)
_FORBIDDEN_RENDERED_TARGET = re.compile(
    r"(?<![A-Za-z0-9_.-])(?:CLAUDE\.md|BOSS\.md|AGENTS\.md|GEMINI\.md|HEARTBEAT\.md|"
    r"[A-Za-z0-9_.-]+\.(?:py|ts|js))(?![A-Za-z0-9_.-])",
    re.IGNORECASE,
)


class TargetWallError(ValueError):
    """A draft attempted to target a protected or executable path."""


class InputParseError(ValueError):
    """A bounded input could not be safely decoded or parsed."""


class ForecastError(ValueError):
    """A draft cannot safely be applied for a report-only eval forecast."""


@dataclass(frozen=True)
class Sources:
    eval_reports: Path
    grades_ledger_dir: Path
    memory_dir: Path
    queue_dir: Path

    @classmethod
    def from_value(cls, value: "Sources | Mapping[str, str | Path]") -> "Sources":
        if isinstance(value, cls):
            return value
        required = ("eval_reports", "grades_ledger_dir", "memory_dir", "queue_dir")
        missing = [field for field in required if field not in value]
        if missing:
            raise ValueError(f"sources missing required paths: {missing}")
        return cls(**{field: Path(value[field]) for field in required})


def _normalise_target_path(target_path: str) -> PurePosixPath:
    raw = str(target_path).replace("\\", "/")
    path = PurePosixPath(raw)
    if (
        path.is_absolute()
        or PureWindowsPath(str(target_path)).is_absolute()
        or raw.startswith("//")
        or not path.parts
        or ".." in path.parts
    ):
        raise TargetWallError(f"unsafe proposal target: {target_path!r}")
    if path.suffix.lower() in _EXECUTABLE_SUFFIXES:
        raise TargetWallError(f"executable proposal target: {target_path!r}")
    return path


def _allowed_shape(path: PurePosixPath) -> bool:
    parts = path.parts
    return (
        len(parts) == 2 and parts[0].lower() in {"agents", "memory"} and path.suffix.lower() == ".md"
    ) or (
        len(parts) == 3 and tuple(part.lower() for part in parts[:2]) == ("routines", "roles")
        and path.suffix.lower() == ".md"
    )


def _contains_path(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def validate_target_path(target_path: str, repo_root: Path | str) -> str:
    """Return a canonical allowed target, resolving lexical and symlink escape attempts."""
    path = _normalise_target_path(target_path)
    if not _allowed_shape(path):
        raise TargetWallError(f"proposal target is outside the permitted markdown surface: {target_path!r}")

    root = Path(repo_root).resolve()
    candidate = (root / Path(*path.parts)).resolve()
    allowed_roots = (
        (root / "agents").resolve(),
        (root / "memory").resolve(),
        (root / "routines" / "roles").resolve(),
    )
    if has_unsafe_link_component(root, path.parts, missing_ok=True) or not any(
        _contains_path(allowed, candidate) for allowed in allowed_roots
    ):
        raise TargetWallError(f"proposal target escapes its permitted root: {target_path!r}")
    return path.as_posix()


def _canonicalise_rendered_text(rendered: str) -> str:
    """Decode one extra layer of HTML escaping before extracting candidate paths."""
    for _ in range(2):
        decoded = html.unescape(rendered)
        if decoded == rendered:
            break
        rendered = decoded
    return rendered.replace("\\/", "/").replace("\\", "/")


def _extract_rendered_paths(rendered: str) -> set[str]:
    paths: set[str] = set()
    rendered = _canonicalise_rendered_text(rendered)
    rendered = re.sub(r"^(?:Evidence:\s|>\s?)", "", rendered, flags=re.MULTILINE)
    for match in _DIFF_PATH.finditer(rendered):
        for path in match.groups():
            if path and path != "/dev/null":
                paths.add(path.removeprefix("a/").removeprefix("b/"))
    rendered_without_diff_headers = _DIFF_PATH.sub("", rendered)
    paths.update(match.group(0) for match in _EMBEDDED_PATH.finditer(rendered_without_diff_headers))
    paths.update(match.group(0) for match in _FORBIDDEN_RENDERED_TARGET.finditer(rendered_without_diff_headers))
    return paths


def _validate_rendered_paths(rendered: str, repo_root: Path) -> None:
    for candidate in _extract_rendered_paths(rendered):
        validate_target_path(candidate, repo_root)


@dataclass(frozen=True)
class ProposalPayload:
    """Structured data from which every human-reviewable draft is rendered."""

    target_path: str
    evidence: str
    suggested_action: str
    unified_diff: str | None = None


@dataclass(frozen=True)
class ProposalDraft:
    """A proposal whose only rendered path is revalidated on every serialization."""

    payload: ProposalPayload
    repo_root: Path
    eval_forecast: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "repo_root", Path(self.repo_root).resolve())
        validate_target_path(self.payload.target_path, self.repo_root)
        self._render()

    @property
    def target_path(self) -> str:
        return validate_target_path(self.payload.target_path, self.repo_root)

    @property
    def unified_diff(self) -> str | None:
        """An optional one-target unified diff suitable for sandbox forecasting.

        Existing card-only drafts deliberately leave this unset.  A forecast
        records that fact as skipped rather than inventing a change.
        """
        return self.payload.unified_diff

    def _forecast_table(self) -> str:
        forecast = self.eval_forecast
        if forecast is None:
            return ""
        status = str(forecast.get("status", "error"))
        reason = forecast.get("reason")
        result = status
        if reason:
            # A diagnostic may itself name a protected path.  Keep it in the
            # structured forecast for the human, but never let it bypass the
            # rendered-card wall by echoing it into the body.
            try:
                _validate_rendered_paths(str(reason), self.repo_root)
                result = f"{status} ({reason})"
            except TargetWallError:
                result = f"{status} (unsafe diagnostic withheld)"
        return (
            "## Eval forecast\n\n"
            "| agent | cards run | passed | failed | result |\n"
            "|---|---:|---:|---:|---|\n"
            f"| {forecast['agent_id']} | {forecast['cards_run']} | {forecast['passed']} | "
            f"{forecast['failed']} | {result} |\n\n"
        )

    def _render(self) -> tuple[str, str]:
        target = self.target_path
        rationale = f"Evidence: {self.payload.evidence}"
        body = (
            "## Work order\n\n"
            f"Draft a focused improvement to `{target}`. {self.payload.suggested_action}\n\n"
            "## Evidence\n\n"
            f"> {self.payload.evidence}\n\n"
            "## Result\n\n"
            "Draft only: a human must review and file any resulting change.\n\n"
            f"{self._forecast_table()}"
        )
        _validate_rendered_paths(rationale, self.repo_root)
        _validate_rendered_paths(body, self.repo_root)
        return rationale, body

    @property
    def rationale(self) -> str:
        return self._render()[0]

    @property
    def diff_or_card_body(self) -> str:
        return self._render()[1]

    def to_dict(self) -> dict[str, object]:
        rationale, body = self._render()
        payload: dict[str, object] = {
            "target_path": self.target_path,
            "rationale": rationale,
            "diff_or_card_body": body,
        }
        if self.eval_forecast is not None:
            payload["eval_forecast"] = dict(self.eval_forecast)
        return payload


@dataclass(frozen=True)
class FireResult:
    proposals: list[ProposalDraft]
    parked: bool
    reason: str

    def to_dict(self) -> dict[str, object]:
        return {"proposals": [proposal.to_dict() for proposal in self.proposals], "parked": self.parked, "reason": self.reason}


@dataclass
class _ScanState:
    file_bounds: set[str]
    ledger_row_bounds: set[str]

    @classmethod
    def create(cls) -> "_ScanState":
        return cls(file_bounds=set(), ledger_row_bounds=set())


def _iter_files(source: Path, suffixes: frozenset[str], source_name: str, state: _ScanState) -> Iterator[Path]:
    """Stream source candidates in deterministic name order, one directory listing at a time (each level capped by MAX_ENTRIES_PER_DIRECTORY, parks beyond it), with no directory links. Sorting changes which files a capped fire reads on every platform, not only Linux."""
    if source.is_file():
        candidates: Iterator[Path] = iter((source,))
    elif source.is_dir():
        def sorted_entries(path: Path) -> Iterator[os.DirEntry[str]]:
            scan = os.scandir(path)
            try:
                entries = list(scan)
            finally:
                scan.close()
            if len(entries) > MAX_ENTRIES_PER_DIRECTORY:
                raise InputParseError(
                    f"parse failure: {source_name} directory exceeds {MAX_ENTRIES_PER_DIRECTORY} entries: {path.name}"
                )
            return iter(sorted(entries, key=lambda entry: entry.name))

        def walk() -> Iterator[Path]:
            scans = [sorted_entries(source)]
            while scans:
                try:
                    entry = next(scans[-1])
                except StopIteration:
                    scans.pop()
                    continue
                if entry.is_dir(follow_symlinks=False):
                    scans.append(sorted_entries(Path(entry.path)))
                elif entry.is_file(follow_symlinks=False):
                    yield Path(entry.path)

        candidates = walk()
    else:
        return

    count = 0
    for candidate in candidates:
        count += 1
        if count == MAX_FILES_PER_SOURCE:
            state.file_bounds.add(source_name)
        if candidate.suffix.lower() not in suffixes:
            if count == MAX_FILES_PER_SOURCE:
                return
            continue
        yield candidate
        if count == MAX_FILES_PER_SOURCE:
            return


def _read_text(path: Path, source_name: str) -> str:
    try:
        if path.stat().st_size > MAX_BYTES_PER_FILE:
            raise InputParseError(f"parse failure: {source_name} file exceeds {MAX_BYTES_PER_FILE} bytes: {path.name}")
        return path.read_text(encoding="utf-8")
    except InputParseError:
        raise
    except UnicodeDecodeError as error:
        raise InputParseError(f"parse failure: invalid UTF-8 in {source_name} {path.name}") from error
    except OSError as error:
        raise InputParseError(f"parse failure: unreadable {source_name} {path.name}") from error


def _valid_agent_id(value: str) -> bool:
    return bool(_AGENT_ID.fullmatch(value))


def _proposed_file_content(current: str, evidence: str, suggested_action: str) -> str:
    """Make the smallest reviewable file change from a producer's evidence."""
    separator = "" if not current or current.endswith("\n") else "\n"
    return (
        f"{current}{separator}\n## Proposed maintainer note\n\n"
        f"{suggested_action}\n\nEvidence: {evidence}\n"
    )


def _proposal(repo_root: Path, target: str, evidence: str, suggested_action: str) -> ProposalDraft:
    """Build a real, single-file git-style patch for a permitted file target."""
    canonical_target = validate_target_path(target, repo_root)
    target_file = Path(repo_root) / Path(*PurePosixPath(canonical_target).parts)
    try:
        current = target_file.read_text(encoding="utf-8") if target_file.exists() else ""
    except (OSError, UnicodeDecodeError) as error:
        raise InputParseError(f"parse failure: unreadable proposal target {canonical_target}") from error
    proposed = _proposed_file_content(current, evidence, suggested_action)
    diff = "".join(difflib.unified_diff(
        current.splitlines(keepends=True), proposed.splitlines(keepends=True),
        fromfile=f"a/{canonical_target}", tofile=f"b/{canonical_target}",
    ))
    # difflib supplies ---/+++ but not git's leading identity header.
    diff = f"diff --git a/{canonical_target} b/{canonical_target}\n{diff}"
    return ProposalDraft(ProposalPayload(canonical_target, evidence, suggested_action, diff), repo_root)


def _iter_eval_sections(text: str) -> Iterator[tuple[str, str]]:
    """Yield each eval section while retaining only its next boundary as lookahead."""
    sections = iter(_EVAL_SECTION.finditer(text))
    section = next(sections, None)
    while section is not None:
        next_section = next(sections, None)
        end = next_section.start() if next_section is not None else len(text)
        yield section.group(1), text[section.end():end]
        section = next_section


def _eval_proposals(repo_root: Path, source: Path, state: _ScanState) -> Iterator[ProposalDraft]:
    for report in _iter_files(source, frozenset({".md", ".json"}), "eval reports", state):
        text = _read_text(report, "eval report")
        if report.suffix.lower() == ".json":
            try:
                json.loads(text)
            except Exception as error:
                raise InputParseError(f"parse failure: invalid JSON in eval report {report.name}") from error
            continue
        for agent_id, section_text in _iter_eval_sections(text):
            for line in section_text.splitlines():
                cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
                if len(cells) < 4 or cells[1].upper() not in {"FAIL", "REFUSED"}:
                    continue
                card_id, verdict, reason = cells[0], cells[1].upper(), cells[3]
                evidence = f"eval report `{report.name}`, agent={agent_id}, card={card_id}: {verdict} — {reason}"
                yield _proposal(repo_root, f"agents/{agent_id}.md", evidence,
                                "Clarify the relevant operating instruction or failure handling before the next review.")


def _is_pass(value: object) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "pass", "passed"}


def _grade_proposals(repo_root: Path, source: Path, state: _ScanState) -> Iterator[ProposalDraft]:
    for shard in _iter_files(source, frozenset({".tsv"}), "grades ledger", state):
        text = _read_text(shard, "grades ledger")
        try:
            rows = csv.reader(io.StringIO(text), delimiter="\t")
            header = next(rows, None)
            if not header or any(not cell for cell in header):
                raise InputParseError(f"parse failure: invalid TSV header in grades ledger {shard.name}")
            for row_number, row in enumerate(rows, start=2):
                if len(row) != len(header):
                    raise InputParseError(f"parse failure: ragged TSV in grades ledger {shard.name} row {row_number}")
                if row_number - 1 > MAX_LEDGER_ROWS_PER_FILE:
                    state.ledger_row_bounds.add(shard.name)
                    break
                record = dict(zip(header, row, strict=True))
                worker = str(record.get("worker") or "")
                if not _valid_agent_id(worker) or worker == "eval-suite" or _is_pass(record.get("pass")):
                    continue
                evidence = (f"grades shard `{shard.name}` row {row_number}: worker={worker}, "
                            f"score={record.get('score')}, pass={record.get('pass')}, "
                            f"task_type={record.get('task_type')}")
                yield _proposal(repo_root, f"agents/{worker}.md", evidence,
                                "Address the graded failure with a narrow, evidence-backed instruction.")
        except csv.Error as error:
            raise InputParseError(f"parse failure: invalid TSV in grades ledger {shard.name}") from error


def _memory_proposals(repo_root: Path, source: Path, state: _ScanState) -> Iterator[ProposalDraft]:
    for lesson in _iter_files(source, frozenset({".md"}), "memory", state):
        text = _read_text(lesson, "memory")
        if not _valid_agent_id(lesson.stem):
            continue
        line = next((line.strip() for line in text.splitlines() if _FAILURE_WORDS.search(line)), None)
        if line:
            evidence = f"memory lesson `{lesson.name}`: {line[:240]}"
            yield _proposal(repo_root, f"memory/{lesson.name}", evidence,
                            "Turn the recurring lesson into a concise, reviewed operating note.")


def _queue_proposals(repo_root: Path, source: Path, state: _ScanState) -> Iterator[ProposalDraft]:
    for card in _iter_files(source, frozenset({".md"}), "queue", state):
        text = _read_text(card, "queue card")
        if not _FAILURE_WORDS.search(text):
            continue
        owner_match = re.search(r"^owner:\s*([a-z0-9][a-z0-9-]{0,63})\s*$", text, re.MULTILINE)
        if owner_match is None:
            continue
        signal = next((line.strip() for line in text.splitlines() if _FAILURE_WORDS.search(line)), "parked")
        evidence = f"parked or failed card `{card.name}` owned by {owner_match.group(1)}: {signal[:240]}"
        yield _proposal(repo_root, f"agents/{owner_match.group(1)}.md", evidence,
                        "Clarify the recovery or escalation path indicated by the parked work.")


def _bound_reason(state: _ScanState) -> str | None:
    details = []
    if state.file_bounds:
        details.append("file bound reached for " + ", ".join(sorted(state.file_bounds)))
    if state.ledger_row_bounds:
        details.append("ledger row bound reached for " + ", ".join(sorted(state.ledger_row_bounds)))
    return "; ".join(details) or None


def _forecast_agent_id(draft: ProposalDraft) -> str | None:
    try:
        path = PurePosixPath(draft.target_path)
    except TargetWallError as error:
        raise ForecastError(f"proposal wall: {error}") from error
    if path.parts[0] not in {"agents", "memory"}:
        return None
    agent_id = path.stem
    return agent_id if _valid_agent_id(agent_id) else None


def _validate_forecast_diff(draft: ProposalDraft) -> str:
    """Return a safe, single-target patch or reject it before creating a worktree."""
    patch = draft.unified_diff
    if not patch or not patch.strip():
        raise ForecastError("no diff")

    git_headers: list[tuple[str, str]] = []
    old_headers: list[str] = []
    new_headers: list[str] = []
    for line in patch.splitlines():
        if line.startswith(("rename from ", "rename to ", "copy from ", "copy to ")):
            raise ForecastError("rename/copy headers are not forecastable")
        if line.startswith("diff --git "):
            fields = line.split()
            if len(fields) != 4:
                raise ForecastError("invalid diff --git header")
            git_headers.append((fields[2], fields[3]))
        elif line.startswith("--- "):
            old_headers.append(line[4:].split("\t", 1)[0])
        elif line.startswith("+++ "):
            new_headers.append(line[4:].split("\t", 1)[0])

    if len(git_headers) != 1 or len(old_headers) != 1 or len(new_headers) != 1:
        raise ForecastError("draft diff must contain exactly one file")

    target = draft.target_path  # Re-assert the declared target before any git action.

    def stripped(path: str, expected_prefix: str) -> str:
        # Git's -p paths are stripped by exactly one component.  Do not
        # repeatedly remove a/b prefixes: a/b/target becomes b/target, not target.
        component, separator, remainder = path.partition("/")
        if component != expected_prefix or not separator or not remainder:
            raise ForecastError(f"patch header must start with exactly {expected_prefix}/")
        try:
            validated = validate_target_path(remainder, draft.repo_root)
        except TargetWallError as error:
            raise ForecastError(f"proposal wall: {error}") from error
        if validated != target or remainder != target:
            raise ForecastError("draft diff must modify only its declared target")
        return remainder

    old_git, new_git = git_headers[0]
    stripped(old_git, "a")
    stripped(new_git, "b")
    stripped(old_headers[0], "a")
    stripped(new_headers[0], "b")
    return patch


def _forecast_scratch_path(repo_root: Path) -> tuple[Path, PurePosixPath]:
    """Return the trusted anchor and relative forecast path for this runtime."""
    state_root = resolve_state_root(
        override_key="DASHBOARD_STATE_ROOT", default_name=None
    )
    if state_root:
        return state_root, PurePosixPath("agent-maintainer/forecast")
    return repo_root, PurePosixPath("state/scratch")


def _forecast_scratch_parent(repo_root: Path) -> Path:
    """Create the prescribed scratch parent only when it is safe and contained."""
    anchor, relative = _forecast_scratch_path(repo_root)
    if has_unsafe_link_component(anchor, relative.parts, missing_ok=True):
        raise ForecastError("forecast scratch path contains a link or reparse point")
    parent = anchor / Path(*relative.parts)
    parent.mkdir(parents=True, exist_ok=True)
    return parent


def _git(repo_root: Path, args: list[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=str(repo_root), input=input_text, text=True,
        capture_output=True, timeout=60, check=False,
    )


def _remove_forecast_worktree(repo_root: Path, worktree: Path) -> None:
    """Best-effort lease cleanup. It never touches a path outside the runtime scratch root."""
    removed = False
    try:
        removed = _git(repo_root, ["worktree", "remove", "--force", str(worktree)]).returncode == 0
    except (OSError, subprocess.SubprocessError):
        pass
    anchor, relative = _forecast_scratch_path(repo_root)
    scratch = (anchor / Path(*relative.parts)).resolve()
    candidate = Path(worktree).resolve()
    try:
        if not removed and candidate != scratch and _contains_path(scratch, candidate) and candidate.exists():
            # If git cannot release its registration, remove the directory before
            # pruning the stale record.  The order is deliberate and tested.
            shutil.rmtree(candidate)
    finally:
        try:
            _git(repo_root, ["worktree", "prune"])
        except (OSError, subprocess.SubprocessError):
            pass


def _sweep_stale_forecast_leases(repo_root: Path) -> None:
    """Release only expired forecast leases owned by this module."""
    anchor, relative = _forecast_scratch_path(repo_root)
    scratch = anchor / Path(*relative.parts)
    if not scratch.is_dir():
        return
    now = time.time()
    for candidate in sorted(scratch.iterdir(), key=lambda path: path.name):
        try:
            stale = now - candidate.stat().st_mtime >= FORECAST_STALE_LEASE_SECONDS
        except OSError:
            continue
        if (not candidate.is_dir() or not candidate.name.startswith(FORECAST_WORKTREE_PREFIX)
                or not stale):
            continue
        _remove_forecast_worktree(repo_root, candidate)


def _forecast_card(card: agent_evals.EvalCard, worktree: Path,
                   suite_deadline: float) -> agent_evals.CardResult | None:
    """Run only forecast-safe judges; `None` means deliberately skipped."""
    if card.judge == "file-exists":
        rel = card.input.get("path")
        target = agent_evals._resolve_contained(worktree, rel)
        if not rel or target is None:
            return agent_evals.CardResult(card.id, False, "path escapes temp worktree", 1,
                                          card.capability)
        return agent_evals.CardResult(card.id, target.exists(),
                                      f"exists: {rel}" if target.exists() else f"missing file: {rel}",
                                      1, card.capability)
    if card.judge != "pytest":
        return None

    test_file = card.input.get("test_file")
    target = agent_evals._resolve_contained(worktree, test_file)
    if not test_file or target is None:
        return agent_evals.CardResult(card.id, False, "path escapes temp worktree", 1,
                                      card.capability)
    remaining = suite_deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("deadline")
    env = agent_evals._clean_env()
    env.update({
        "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "safe.directory",
        "GIT_CONFIG_VALUE_0": str(worktree),
    })
    command = [sys.executable, "-m", "pytest", str(target), "-q", "-p", "no:cacheprovider",
               "--rootdir", str(worktree), "--basetemp", str(worktree / ".forecast-pytest-tmp")]
    try:
        result = subprocess.run(command, cwd=str(worktree), capture_output=True, text=True, env=env,
                                timeout=min(FORECAST_PYTEST_TIMEOUT_SECONDS, remaining), check=False)
    except subprocess.TimeoutExpired as error:
        raise TimeoutError("deadline") from error
    tail = [line for line in (result.stdout or "").splitlines() if line.strip()]
    detail = tail[-1].strip() if tail else f"exit {result.returncode}"
    return agent_evals.CardResult(card.id, result.returncode == 0, f"{test_file}: {detail}", 1,
                                  card.capability)


def _safe_forecast_suite(worktree: Path, agent_id: str, *, fleet: bool,
                         fire_deadline: float | None = None) -> tuple[agent_evals.SuiteReport, str, str | None]:
    """Load a blessed suite but execute only contained file/pytest judges."""
    label = "fleet" if fleet else "own"
    try:
        directory = agent_evals.suite_dir(worktree, agent_evals.FLEET_SUITE_ID if fleet else agent_id)
        if not directory.is_dir():
            return agent_evals.SuiteReport(agent_id, [], f"no {label} eval suite"), "refused", f"no {label} eval suite"
        blessed, _ = agent_evals.verify_suite_manifest(directory)
        if not blessed:
            return agent_evals.SuiteReport(agent_id, [], "unblessed manifest", tampered=True), "refused", "unblessed manifest"
        cards = agent_evals.load_cards(directory)[:FORECAST_MAX_CARDS_PER_SUITE]
        results: list[agent_evals.CardResult] = []
        skipped = False
        deadline = time.monotonic() + FORECAST_SUITE_DEADLINE_SECONDS
        if fire_deadline is not None:
            deadline = min(deadline, fire_deadline)
        for card in cards:
            if time.monotonic() >= deadline:
                return agent_evals.SuiteReport(agent_id, results), "error", "deadline"
            effective = agent_evals._with_target(card, agent_id) if fleet else card
            result = _forecast_card(effective, worktree, deadline)
            if result is None:
                skipped = True
                continue
            results.append(result)
        if skipped:
            return agent_evals.SuiteReport(agent_id, results), "skipped", "not forecast-safe"
        return agent_evals.SuiteReport(agent_id, results), "completed", None
    except TimeoutError:
        return agent_evals.SuiteReport(agent_id, []), "error", "deadline"
    except Exception as error:  # noqa: BLE001 - a suite crash is report-only
        return agent_evals.SuiteReport(agent_id, []), "error", f"{label} suite crashed: {error!r}"


def _run_forecast(draft: ProposalDraft, repo_root: Path, *, deadline: float | None = None) -> Mapping[str, object]:
    """Sandbox one draft, run own + fleet suites, and return a report-only outcome.

    Validation is intentionally complete before the temporary worktree is made.
    The existing runner is imported directly and is always called with
    ``record=False``: forecasting must not produce real grade-ledger rows.
    """
    agent_id = _forecast_agent_id(draft)
    if agent_id is None:
        return _forecast_report("skipped", "no affected agent", "unknown")
    try:
        patch = _validate_forecast_diff(draft)
    except ForecastError as error:
        status = "skipped" if str(error) == "no diff" else "refused"
        return _forecast_report(status, str(error), agent_id)
    worktree: Path | None = None
    try:
        if deadline is not None and time.monotonic() >= deadline:
            return _forecast_report("error", "deadline", agent_id)
        scratch = _forecast_scratch_parent(repo_root)
        worktree = scratch / f"{FORECAST_WORKTREE_PREFIX}{uuid.uuid4().hex}"
        added = _git(repo_root, ["worktree", "add", "--detach", str(worktree), "HEAD"])
        if added.returncode != 0:
            detail = (added.stderr or added.stdout).strip() or "git worktree add failed"
            raise ForecastError(f"temporary worktree unavailable: {detail}")

        checked = _git(worktree, ["apply", "--check", "--whitespace=nowarn", "-"], input_text=patch)
        if checked.returncode != 0:
            detail = (checked.stderr or checked.stdout).strip() or "git apply --check failed"
            raise ForecastError(f"draft diff does not apply: {detail}")
        applied = _git(worktree, ["apply", "--whitespace=nowarn", "-"], input_text=patch)
        if applied.returncode != 0:
            detail = (applied.stderr or applied.stdout).strip() or "git apply failed"
            raise ForecastError(f"draft diff could not be applied: {detail}")

        own, own_status, own_reason = _safe_forecast_suite(worktree, agent_id, fleet=False,
                                                           fire_deadline=deadline)
        fleet, fleet_status, fleet_reason = _safe_forecast_suite(worktree, agent_id, fleet=True,
                                                                 fire_deadline=deadline)
        cards = [*own.cards, *fleet.cards]
        statuses = (own_status, fleet_status)
        status = next((candidate for candidate in ("error", "refused", "skipped")
                       if candidate in statuses), "completed")
        reason = "; ".join(dict.fromkeys(reason for reason in (own_reason, fleet_reason) if reason)) or None
        return _forecast_report(status, reason, agent_id, cards)
    finally:
        if worktree is not None:
            _remove_forecast_worktree(repo_root, worktree)


def _forecast_report(status: str, reason: str | None, agent_id: str,
                     cards: list[agent_evals.CardResult] | None = None) -> Mapping[str, object]:
    cards = cards or []
    return {
        "agent_id": agent_id,
        "cards_run": len(cards),
        "passed": sum(card.passed for card in cards),
        "failed": sum(not card.passed for card in cards),
        "status": status,
        "reason": reason,
    }


def _forecast_draft(draft: ProposalDraft, repo_root: Path, *, deadline: float | None = None) -> ProposalDraft:
    """Attach a forecast without allowing an evaluation problem to drop a draft."""
    try:
        if deadline is not None and time.monotonic() >= deadline:
            return ProposalDraft(draft.payload, draft.repo_root,
                                 _forecast_report("error", "deadline", _forecast_agent_id(draft) or "unknown"))
        forecast = _run_forecast(draft, repo_root, deadline=deadline)
    except ForecastError as error:
        try:
            agent_id = _forecast_agent_id(draft) or "unknown"
        except:
            agent_id = "unknown"
        forecast = _forecast_report("error", str(error), agent_id)
    except:
        try:
            agent_id = _forecast_agent_id(draft) or "unknown"
        except:
            agent_id = "unknown"
        forecast = _forecast_report("error", "forecast crashed", agent_id)
    return ProposalDraft(draft.payload, draft.repo_root, forecast)


def run_fire(repo_root: Path | str, sources: Sources | Mapping[str, str | Path], *,
             forecast: bool = False) -> FireResult:
    """Read bounded evidence and return at most :data:`MAX_PROPOSALS_PER_FIRE` drafts.

    With ``forecast=True``, agent-definition and memory drafts get an optional,
    report-only eval forecast.  Forecast failures/refusals always remain attached
    to the draft for human review; they never block or remove it.
    """
    root = Path(repo_root).resolve()
    paths = Sources.from_value(sources)
    state = _ScanState.create()
    proposals: list[ProposalDraft] = []
    seen_targets: set[str] = set()
    producers = (
        _eval_proposals(root, paths.eval_reports, state),
        _grade_proposals(root, paths.grades_ledger_dir, state),
        _memory_proposals(root, paths.memory_dir, state),
        _queue_proposals(root, paths.queue_dir, state),
    )
    forecast_deadline = time.monotonic() + FORECAST_FIRE_DEADLINE_SECONDS
    if forecast:
        _sweep_stale_forecast_leases(root)
    try:
        for producer in producers:
            for draft in producer:
                if draft.target_path in seen_targets:
                    continue
                seen_targets.add(draft.target_path)
                proposals.append(draft)
                if len(proposals) == MAX_PROPOSALS_PER_FIRE:
                    result = FireResult(proposals, parked=False,
                                      reason=f"proposal bound reached ({MAX_PROPOSALS_PER_FIRE})")
                    if forecast:
                        return FireResult([_forecast_draft(p, root, deadline=forecast_deadline) for p in result.proposals],
                                          parked=result.parked, reason=result.reason)
                    return result
    except InputParseError as error:
        return FireResult([], parked=True, reason=str(error))
    except TargetWallError as error:
        return FireResult([], parked=True, reason=f"proposal wall: {error}")

    bound_reason = _bound_reason(state)
    if not proposals:
        reason = f"{bound_reason}; no actionable improvement evidence; parked for Daniel" if bound_reason else "no actionable improvement evidence; parked for Daniel"
        return FireResult([], parked=True, reason=reason)
    result = FireResult(proposals, parked=False, reason=bound_reason or "sources exhausted")
    if forecast:
        return FireResult([_forecast_draft(p, root, deadline=forecast_deadline) for p in result.proposals],
                          parked=result.parked, reason=result.reason)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="repository root (never written by this command)")
    parser.add_argument("--fixtures", required=True,
                        help="directory containing eval_reports/, grades/, memory/, and queue/")
    parser.add_argument("--forecast", action="store_true",
                        help="sandbox-apply supplied draft diffs and attach report-only eval forecasts")
    args = parser.parse_args(argv)
    fixture_root = Path(args.fixtures)
    result = run_fire(Path(args.repo), Sources(
        eval_reports=fixture_root / "eval_reports",
        grades_ledger_dir=fixture_root / "grades",
        memory_dir=fixture_root / "memory",
        queue_dir=fixture_root / "queue",
    ), forecast=args.forecast)
    print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
