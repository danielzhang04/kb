"""Read repository content tracked by Git and emit a human-review-only hygiene report.

The sweep never changes the tree it examines. Its one output is the explicitly requested
JSON report; each finding is a suggestion for a human, never an instruction to act.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from scripts.kb_paths import resolve_dashboard_state_path
from datetime import date, datetime, timedelta, timezone

OVERSIZED_BYTES = 1024 * 1024
STALE_HANDOFF_DAYS = 30
TODO_DENSITY_PER_100_LINES = 8.0
TODO_MINIMUM = 3
HUMAN_PROPOSAL = 'candidate for deletion/merge/shrink — HUMAN decides'
ZERO_BYTE_EXEMPT_NAMES = frozenset({'.gitkeep', '.keep', '__init__.py', 'py.typed'})
HANDOFF_DATE_PREFIX = re.compile(r'^(\d{4}-\d{2}-\d{2})-')

# These are dependency/build or binary-heavy trees, not useful candidates for this source sweep.
KNOWN_BINARY_DIRS = frozenset({
    '.brain-index', '.git', '.venv', 'node_modules', 'dist', 'build', 'coverage', 'vendor',
    'assets', 'images', 'media', 'fonts', 'refs', 'render', 'videos',
})
TEXT_SCRIPT_EXTENSIONS = frozenset({'.py', '.js', '.ts', '.tsx', '.sh', '.ps1'})


def _relative(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace(os.sep, '/')


def _inside(path: str, parent: str) -> bool:
    try:
        return os.path.commonpath((path, parent)) == parent
    except ValueError:
        return False


def _tracked_paths(root: str) -> set[str]:
    """Return repository-relative paths from Git's index, never from a filesystem walk."""
    result = subprocess.run(
        ['git', '-C', root, 'ls-files', '-z'],
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f'git ls-files failed for {root}: {result.stderr.decode(errors="replace").strip()}')
    return {
        path.decode(errors='surrogateescape').replace('\\', '/')
        for path in result.stdout.split(b'\0')
        if path
    }


def _unreadable(path: str) -> dict[str, object]:
    return {
        'path': path,
        'kind': 'unreadable',
        'size': 0,
        'detail': 'permission denied while inspecting path',
        'proposal': HUMAN_PROPOSAL,
    }


def _is_known_binary_path(relative: str) -> bool:
    return any(part in KNOWN_BINARY_DIRS for part in relative.split('/'))


def _tracked_inventory(root: str, findings: list[dict[str, object]]) -> tuple[list[tuple[str, str, int, float]], list[tuple[str, str]]]:
    files: list[tuple[str, str, int, float]] = []
    dirs: set[str] = set()
    for relative in sorted(_tracked_paths(root), key=str.casefold):
        if _is_known_binary_path(relative):
            continue
        absolute = os.path.join(root, *relative.split('/'))
        try:
            stat = os.stat(absolute, follow_symlinks=False)
        except PermissionError:
            findings.append(_unreadable(relative))
            continue
        except FileNotFoundError:
            continue
        try:
            is_file = os.path.isfile(absolute)
        except PermissionError:
            findings.append(_unreadable(relative))
            continue
        if not is_file:
            continue
        files.append((absolute, relative, stat.st_size, stat.st_mtime))
        parent = os.path.dirname(relative)
        while parent and parent != '.':
            dirs.add(parent)
            parent = os.path.dirname(parent)
    return files, [(os.path.join(root, *path.split('/')), path) for path in sorted(dirs, key=str.casefold)]


def _all_files_inventory(root: str, findings: list[dict[str, object]]) -> tuple[list[tuple[str, str, int, float]], list[tuple[str, str]]]:
    files: list[tuple[str, str, int, float]] = []
    dirs: list[tuple[str, str]] = []

    def visit(directory: str) -> None:
        try:
            with os.scandir(directory) as entries:
                children = sorted(entries, key=lambda entry: entry.name.casefold())
        except PermissionError:
            findings.append(_unreadable(_relative(root, directory)))
            return
        for entry in children:
            absolute = entry.path
            relative = _relative(root, absolute)
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in KNOWN_BINARY_DIRS:
                        continue
                    dirs.append((absolute, relative))
                    visit(absolute)
                elif entry.is_file(follow_symlinks=False):
                    stat = entry.stat(follow_symlinks=False)
                    files.append((absolute, relative, stat.st_size, stat.st_mtime))
            except PermissionError:
                findings.append(_unreadable(relative))

    visit(root)
    return files, dirs


def _handoff_age(relative: str, now: datetime) -> timedelta | None:
    """Age from the filename's date prefix only — every real handoff is date-prefixed
    (kb convention), so a file without one is never a handoff and must not be flagged.
    No git-log fallback: it would key off last-commit time, not handoff age, and would
    false-positive on stable files like handoffs/README.md."""
    match = HANDOFF_DATE_PREFIX.match(os.path.basename(relative))
    if not match:
        return None
    try:
        handoff_date = date.fromisoformat(match.group(1))
    except ValueError:
        return None
    return now - datetime.combine(handoff_date, datetime.min.time(), tzinfo=timezone.utc)


def _plan_specs_pair(first: str, second: str) -> bool:
    return {os.path.dirname(first), os.path.dirname(second)} == {'docs/plans', 'docs/specs'}


def _findings(root: str, now: datetime, all_files: bool = False) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    files, dirs = _all_files_inventory(root, findings) if all_files else _tracked_inventory(root, findings)
    docs_by_name: dict[str, list[tuple[str, int]]] = {}

    for absolute, relative, size, _modified in files:
        name = os.path.basename(absolute)
        extension = os.path.splitext(name)[1].lower()
        common = {'path': relative, 'size': size, 'proposal': HUMAN_PROPOSAL}
        if relative.startswith('docs/'):
            docs_by_name.setdefault(name, []).append((relative, size))
        if size > OVERSIZED_BYTES:
            findings.append({**common, 'kind': 'oversized-file', 'detail': f'{size} bytes exceeds 1 MiB'})
        if relative.startswith('handoffs/') and relative.count('/') == 1 and extension == '.md':
            age = _handoff_age(relative, now)
            if age is not None and age > timedelta(days=STALE_HANDOFF_DAYS):
                findings.append({**common, 'kind': 'stale-handoff', 'detail': f'{age.days} days old; handoffs are removed on pickup'})
        if name.endswith('.tmp') or name.endswith('~'):
            findings.append({**common, 'kind': 'orphan-temp', 'detail': f'temporary-name pattern: {name}'})
        if size == 0 and name not in ZERO_BYTE_EXEMPT_NAMES:
            findings.append({**common, 'kind': 'zero-byte-file', 'detail': 'file has zero bytes'})
        if extension == '.md':
            try:
                with open(absolute, encoding='utf-8', errors='replace') as handle:
                    replacements = handle.read().count('\ufffd')
            except PermissionError:
                findings.append(_unreadable(relative))
                continue
            if replacements:
                findings.append({**common, 'kind': 'mojibake', 'detail': f'{replacements} replacement-character marker(s)'})
        if relative.startswith('scripts/') and extension in TEXT_SCRIPT_EXTENSIONS:
            try:
                with open(absolute, encoding='utf-8', errors='replace') as handle:
                    lines = handle.readlines()
            except PermissionError:
                findings.append(_unreadable(relative))
                continue
            todo_count = sum(line.upper().count('TODO') + line.upper().count('FIXME') for line in lines)
            density = (todo_count / max(len(lines), 1)) * 100
            if todo_count >= TODO_MINIMUM and density >= TODO_DENSITY_PER_100_LINES:
                findings.append({**common, 'kind': 'todo-fixme-density', 'detail': f'{todo_count} TODO/FIXME markers in {len(lines)} lines ({density:.1f} per 100 lines)'})

    # Empty directories are structurally unreachable here in default (tracked) mode — Git
    # never tracks an empty directory, so `dirs` from _tracked_inventory only contains
    # parents of tracked files. This rule only fires under --all-files.
    for absolute, relative in dirs:
        try:
            with os.scandir(absolute) as entries:
                is_empty = not any(True for _ in entries)
        except PermissionError:
            findings.append(_unreadable(relative))
            continue
        if is_empty:
            findings.append({'path': relative, 'kind': 'empty-directory', 'size': 0, 'detail': 'directory has no entries', 'proposal': HUMAN_PROPOSAL})
        if all_files and (os.path.basename(absolute) == '.pytest-tmp' or os.path.basename(absolute) == '__pycache__'):
            findings.append({'path': relative, 'kind': 'orphan-temp', 'size': 0, 'detail': f'temporary directory: {os.path.basename(absolute)}', 'proposal': HUMAN_PROPOSAL})

    for name, entries in docs_by_name.items():
        paths = sorted(path for path, _size in entries)
        for path, size in sorted(entries):
            counterparts = [other for other in paths if other != path and not _plan_specs_pair(path, other)]
            if counterparts:
                findings.append({'path': path, 'kind': 'duplicate-basename', 'size': size, 'detail': f'{name} also appears at {", ".join(counterparts)}', 'proposal': HUMAN_PROPOSAL})

    return sorted(findings, key=lambda item: (str(item['kind']), str(item['path']), str(item['detail'])))


def sweep(root: str | os.PathLike[str] = '.', now: datetime | None = None, all_files: bool = False) -> list[dict[str, object]]:
    """Return deterministic findings for tracked files by default, without changing them."""
    resolved = os.path.realpath(os.path.abspath(os.fspath(root)))
    return _findings(resolved, now or datetime.now(timezone.utc), all_files=all_files)


def write_report(root: str | os.PathLike[str] = '.', out: str | os.PathLike[str] | None = None, now: datetime | None = None, all_files: bool = False) -> dict[str, object]:
    """Generate the only output file; refuse coordination-sensitive or source destinations."""
    resolved_root = os.path.realpath(os.path.abspath(os.fspath(root)))
    default_out = resolve_dashboard_state_path(
        'hygiene', 'report.json', fallback=Path(resolved_root) / '.hygiene-report.json'
    )
    resolved_out = os.path.realpath(os.path.abspath(os.fspath(out or default_out)))
    if _inside(resolved_out, os.path.join(resolved_root, 'governance')) or _inside(resolved_out, os.path.join(resolved_root, 'memory')):
        raise ValueError('refusing an output path inside governance/ or memory/')
    tracked_outputs = {os.path.realpath(os.path.join(resolved_root, *path.split('/'))) for path in _tracked_paths(resolved_root)}
    if resolved_out in tracked_outputs:
        raise ValueError('refusing to overwrite a tracked file — the report is untracked by design')
    generated = now or datetime.now(timezone.utc)
    findings = _findings(resolved_root, generated, all_files=all_files)
    by_kind: dict[str, int] = {}
    for finding in findings:
        kind = str(finding['kind'])
        by_kind[kind] = by_kind.get(kind, 0) + 1
    report: dict[str, object] = {
        'generated_at': generated.isoformat(),
        'root': resolved_root,
        'dryRun': True,
        'header': {
            'dry_run_notice': 'DRY-RUN only: this report did not delete, rename, or modify inspected files.',
            'tracking_notice': 'By default this report inspects Git-tracked content only; use --all-files to include untracked files.',
            'generation_command': f"{'py -3' if os.name == 'nt' else 'python3'} -m scripts.hygiene_sweep",
        },
        'findings': findings,
        'summary': {'total': len(findings), 'by_kind': dict(sorted(by_kind.items()))},
    }
    os.makedirs(os.path.dirname(resolved_out), exist_ok=True)
    with open(resolved_out, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Generate a dry-run repository hygiene report.')
    parser.add_argument('--root', default='.', help='repository root to inspect')
    parser.add_argument('--out', default=None, help='report path (defaults to runtime state in the daemon, else <root>/.hygiene-report.json)')
    parser.add_argument('--all-files', action='store_true', help='also inspect untracked files and directories')
    args = parser.parse_args(argv)
    report = write_report(args.root, args.out, all_files=args.all_files)
    print(json.dumps(report['summary'], sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
