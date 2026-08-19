"""Bounded, draft-only maintainer fire.

This module reads only its supplied evidence directories and returns proposal drafts. A
caller must put a rendered card body through normal human review; this module never
writes targets, mutates the queue or ledgers, invokes git, or registers a cadence.
"""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Iterator, Mapping


MAX_PROPOSALS_PER_FIRE = 5
MAX_FILES_PER_SOURCE = 100
MAX_BYTES_PER_FILE = 128 * 1024
MAX_LEDGER_ROWS_PER_FILE = 1_000

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


def _has_unsafe_link_component(repo_root: Path, path: PurePosixPath) -> bool:
    """Reject symlinks and Windows reparse points in every existing path component."""
    current = repo_root
    for part in path.parts:
        current = current / part
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            # The remaining components cannot exist yet, so there is no link to follow.
            return False
        except OSError:
            # Do not treat an unreadable component as a safe proposal target.
            return True
        if stat.S_ISLNK(metadata.st_mode) or (
            getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            return True
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
    if _has_unsafe_link_component(root, path) or not any(_contains_path(allowed, candidate) for allowed in allowed_roots):
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


@dataclass(frozen=True)
class ProposalDraft:
    """A proposal whose only rendered path is revalidated on every serialization."""

    payload: ProposalPayload
    repo_root: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "repo_root", Path(self.repo_root).resolve())
        validate_target_path(self.payload.target_path, self.repo_root)
        self._render()

    @property
    def target_path(self) -> str:
        return validate_target_path(self.payload.target_path, self.repo_root)

    def _render(self) -> tuple[str, str]:
        target = self.target_path
        rationale = f"Evidence: {self.payload.evidence}"
        body = (
            "## Work order\n\n"
            f"Draft a focused improvement to `{target}`. {self.payload.suggested_action}\n\n"
            "## Evidence\n\n"
            f"> {self.payload.evidence}\n\n"
            "## Result\n\n"
            "Draft only: a human must review and file any resulting change.\n"
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

    def to_dict(self) -> dict[str, str]:
        rationale, body = self._render()
        return {"target_path": self.target_path, "rationale": rationale, "diff_or_card_body": body}


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
    """Stream source candidates with bounded ``scandir`` traversal and no directory links."""
    if source.is_file():
        candidates: Iterator[Path] = iter((source,))
    elif source.is_dir():
        def walk() -> Iterator[Path]:
            scans = [os.scandir(source)]
            try:
                while scans:
                    try:
                        entry = next(scans[-1])
                    except StopIteration:
                        scans.pop().close()
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        scans.append(os.scandir(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        yield Path(entry.path)
            finally:
                for scan in scans:
                    scan.close()

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


def _proposal(repo_root: Path, target: str, evidence: str, suggested_action: str) -> ProposalDraft:
    return ProposalDraft(ProposalPayload(target, evidence, suggested_action), repo_root)


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


def run_fire(repo_root: Path | str, sources: Sources | Mapping[str, str | Path]) -> FireResult:
    """Read bounded evidence and return at most :data:`MAX_PROPOSALS_PER_FIRE` drafts."""
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
    try:
        for producer in producers:
            for draft in producer:
                if draft.target_path in seen_targets:
                    continue
                seen_targets.add(draft.target_path)
                proposals.append(draft)
                if len(proposals) == MAX_PROPOSALS_PER_FIRE:
                    return FireResult(proposals, parked=False,
                                      reason=f"proposal bound reached ({MAX_PROPOSALS_PER_FIRE})")
    except InputParseError as error:
        return FireResult([], parked=True, reason=str(error))
    except TargetWallError as error:
        return FireResult([], parked=True, reason=f"proposal wall: {error}")

    bound_reason = _bound_reason(state)
    if not proposals:
        reason = f"{bound_reason}; no actionable improvement evidence; parked for Daniel" if bound_reason else "no actionable improvement evidence; parked for Daniel"
        return FireResult([], parked=True, reason=reason)
    return FireResult(proposals, parked=False, reason=bound_reason or "sources exhausted")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="repository root (never written by this command)")
    parser.add_argument("--fixtures", required=True,
                        help="directory containing eval_reports/, grades/, memory/, and queue/")
    args = parser.parse_args(argv)
    fixture_root = Path(args.fixtures)
    result = run_fire(Path(args.repo), Sources(
        eval_reports=fixture_root / "eval_reports",
        grades_ledger_dir=fixture_root / "grades",
        memory_dir=fixture_root / "memory",
        queue_dir=fixture_root / "queue",
    ))
    print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
