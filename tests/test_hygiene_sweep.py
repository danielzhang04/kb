"""Dry-run guarantees for ``scripts.hygiene_sweep``."""
from __future__ import annotations

import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts import hygiene_sweep as hs


def snapshot_tree(root: Path, excluded: Path) -> list[tuple[str, int, int]]:
    """A file-only snapshot: adding the report changes the root directory mtime."""
    return sorted(
        (str(path.relative_to(root)), path.stat().st_mtime_ns, path.stat().st_size)
        for path in root.rglob('*')
        if path.is_file() and path != excluded
    )


def track_tree(root: Path) -> None:
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', '-C', str(root), 'add', '-A'], check=True)


def planted_tree(tmp_path: Path) -> None:
    (tmp_path / 'handoffs').mkdir()
    stale = tmp_path / 'handoffs' / '2026-07-01-old-pickup.md'
    stale.write_text('# old', encoding='utf-8')
    os.utime(stale, (datetime.now(timezone.utc).timestamp(),) * 2)

    (tmp_path / 'empty').mkdir()
    (tmp_path / 'scratch.tmp').write_text('temporary', encoding='utf-8')
    (tmp_path / 'oversized.bin').write_bytes(b'x' * (hs.OVERSIZED_BYTES + 1))
    (tmp_path / 'zero.txt').touch()
    (tmp_path / '.gitkeep').touch()
    (tmp_path / '__init__.py').touch()

    (tmp_path / 'docs' / 'a').mkdir(parents=True)
    (tmp_path / 'docs' / 'b').mkdir()
    (tmp_path / 'docs' / 'a' / 'same.md').write_text('one', encoding='utf-8')
    (tmp_path / 'docs' / 'b' / 'same.md').write_text('two', encoding='utf-8')
    (tmp_path / 'docs' / 'plans').mkdir()
    (tmp_path / 'docs' / 'specs').mkdir()
    (tmp_path / 'docs' / 'plans' / 'paired.md').write_text('plan', encoding='utf-8')
    (tmp_path / 'docs' / 'specs' / 'paired.md').write_text('spec', encoding='utf-8')
    (tmp_path / 'docs' / 'broken.md').write_text('bad \ufffd text', encoding='utf-8')

    script = tmp_path / 'scripts' / 'noisy.py'
    script.parent.mkdir()
    script.write_text('\n'.join(['# TODO repair'] * 9), encoding='utf-8')
    cache = tmp_path / '__pycache__'
    cache.mkdir()
    (cache / 'cache.pyc').write_bytes(b'cache')
    track_tree(tmp_path)


def test_sweep_reports_each_documented_kind_and_is_deterministic(tmp_path: Path) -> None:
    planted_tree(tmp_path)
    now = datetime(2026, 8, 18, tzinfo=timezone.utc)

    first = hs.sweep(tmp_path, now=now, all_files=True)
    second = hs.sweep(tmp_path, now=now, all_files=True)

    assert first == second
    kinds = {finding['kind'] for finding in first}
    assert {
        'oversized-file', 'stale-handoff', 'empty-directory', 'orphan-temp',
        'duplicate-basename', 'zero-byte-file', 'mojibake', 'todo-fixme-density',
    } <= kinds
    assert all(finding['proposal'] == hs.HUMAN_PROPOSAL for finding in first)
    assert not any(finding['path'].endswith('.gitkeep') or finding['path'].endswith('__init__.py') for finding in first if finding['kind'] == 'zero-byte-file')
    duplicates = [finding['path'] for finding in first if finding['kind'] == 'duplicate-basename']
    assert 'docs/plans/paired.md' not in duplicates
    assert 'docs/specs/paired.md' not in duplicates


def test_default_scope_uses_only_tracked_content(tmp_path: Path) -> None:
    planted_tree(tmp_path)
    (tmp_path / '.pytest-debris').mkdir()
    (tmp_path / '.pytest-debris' / 'bad.tmp').write_text('untracked', encoding='utf-8')

    findings = hs.sweep(tmp_path, now=datetime(2026, 8, 18, tzinfo=timezone.utc))

    assert not any('.pytest' in str(finding['path']) for finding in findings)
    assert any(finding['path'] == 'scratch.tmp' for finding in findings)


def test_write_report_changes_nothing_except_the_requested_report(tmp_path: Path) -> None:
    planted_tree(tmp_path)
    output = tmp_path / '.hygiene-report.json'
    before = snapshot_tree(tmp_path, output)

    report = hs.write_report(tmp_path, output, now=datetime(2026, 8, 18, tzinfo=timezone.utc))

    assert output.exists()
    assert snapshot_tree(tmp_path, output) == before
    assert report['dryRun'] is True
    assert report['summary']['total'] == len(report['findings'])
    expected_python = 'py -3' if os.name == 'nt' else 'python3'
    assert report['header']['generation_command'] == f'{expected_python} -m scripts.hygiene_sweep'


def test_default_report_uses_dashboard_state_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    planted_tree(tmp_path)
    state_root = tmp_path / 'daemon-state'
    monkeypatch.setenv('DASHBOARD_STATE_ROOT', str(state_root))

    hs.write_report(tmp_path, now=datetime(2026, 8, 18, tzinfo=timezone.utc))

    assert (state_root / 'hygiene' / 'report.json').is_file()
    assert not (tmp_path / '.hygiene-report.json').exists()


def test_default_report_retains_repo_local_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    planted_tree(tmp_path)
    monkeypatch.delenv('DASHBOARD_STATE_ROOT', raising=False)

    hs.write_report(tmp_path, now=datetime(2026, 8, 18, tzinfo=timezone.utc))

    assert (tmp_path / '.hygiene-report.json').is_file()


@pytest.mark.parametrize('blocked', ['governance/report.json', 'memory/report.json'])
def test_output_guard_refuses_governance_and_memory(tmp_path: Path, blocked: str) -> None:
    track_tree(tmp_path)
    with pytest.raises(ValueError, match='governance/ or memory/'):
        hs.write_report(tmp_path, tmp_path / blocked)


@pytest.mark.parametrize('blocked', ['source.md', 'package.json'])
def test_output_guard_refuses_any_tracked_path(tmp_path: Path, blocked: str) -> None:
    """The report is untracked by design; any tracked destination is refused, JSON or not
    (e.g. `--out dashboard/package.json` must be refused, not just non-JSON tracked files)."""
    source = tmp_path / blocked
    source.write_text('source', encoding='utf-8')
    track_tree(tmp_path)
    with pytest.raises(ValueError, match='refusing to overwrite a tracked file'):
        hs.write_report(tmp_path, source)


def test_real_repo_precision_for_tracked_content() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    now = datetime(2026, 8, 18, tzinfo=timezone.utc)
    findings = hs.sweep(repo_root, now=now)
    zero_byte_paths = {finding['path'] for finding in findings if finding['kind'] == 'zero-byte-file'}
    stale_paths = {finding['path'] for finding in findings if finding['kind'] == 'stale-handoff'}
    old_pickups = []
    for handoff in (repo_root / 'handoffs').glob('*-pickup.md'):
        try:
            handoff_date = datetime.strptime(handoff.name[:10], '%Y-%m-%d').date()
        except ValueError:
            continue
        if now.date() - handoff_date > timedelta(days=hs.STALE_HANDOFF_DAYS):
            old_pickups.append(handoff.relative_to(repo_root).as_posix())

    assert not any('.pytest' in str(finding['path']) for finding in findings)
    assert not any(path.endswith('.gitkeep') or path.endswith('__init__.py') for path in zero_byte_paths)
    assert set(old_pickups) <= stale_paths
    # Upper bound so a new false-positive class fails loudly instead of silently padding
    # the report; bump this only after confirming each new finding is a real hit.
    assert len(findings) <= 6, f'unexpected finding volume, investigate: {findings}'


def test_module_has_no_mutating_filesystem_calls_beyond_json_output() -> None:
    source = Path(hs.__file__).read_text(encoding='utf-8')
    forbidden = ('write_text', 'writelines', '.write(', '.remove(', '.rename(', '.unlink(', '.mkdir(', '.touch(')
    assert not any(token in source for token in forbidden)
    assert source.count('json.dump(') == 1
