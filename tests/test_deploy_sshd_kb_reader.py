"""Tests for deploy/sshd-kb-reader.conf (ruling 4e5f6071-92a3b4c5) - the kb-reader sftp deny.

`Subsystem` is not a valid keyword inside a `Match` block (sshd_config(5) MATCH), so the deny is
ForceCommand-routed through reader_shell.sh instead of a Subsystem override. This module has two
halves:

  1. Parses the checked-in drop-in and pins its shape (always runs, everywhere).
  2. Exercises reader_shell.sh's sftp-server/internal-sftp refusal directly. reader_shell.sh is
     NOT part of this git repo - it lives under kb-rehearsal/tooling/kb-reader on the machine that
     manages prod (that tree is filled + shipped by build-setup.ps1 / vm-setup-kb-reader.filled.sh,
     not a release artifact, and is not checked into version control). There is no portable,
     repo-relative path to it, so half 2 is best-effort: it runs only when that path (or an
     override via KB_READER_SHELL_PATH) exists on the machine running pytest, and is skipped with
     an explicit reason everywhere else, including CI, which will never have that path.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CONF_PATH = REPO_ROOT / "deploy" / "sshd-kb-reader.conf"
CONF_TEXT = CONF_PATH.read_text(encoding="utf-8")

# Non-comment, non-blank lines only - keeps assertions independent of comment wording.
BODY_LINES = [
    line.strip()
    for line in CONF_TEXT.splitlines()
    if line.strip() and not line.strip().startswith("#")
]


def test_conf_file_exists():
    assert CONF_PATH.is_file()


def test_match_user_kb_reader_is_the_only_match_block():
    match_lines = [line for line in BODY_LINES if line.lower().startswith("match ")]
    assert match_lines == ["Match User kb-reader"]


def test_block_contains_exactly_the_reviewed_directives_in_order():
    # Pins the whole shape so a future edit to this file is deliberate, not accidental drift.
    idx = BODY_LINES.index("Match User kb-reader")
    directives = BODY_LINES[idx + 1:]
    assert directives == [
        "ForceCommand /usr/local/lib/kb/reader_shell.sh",
        "AllowTcpForwarding no",
        "X11Forwarding no",
        "PermitTunnel no",
        "AllowAgentForwarding no",
    ]


def test_no_subsystem_directive():
    # Subsystem is refused inside Match by sshd itself (sshd -t would fail the whole file), so its
    # absence here is load-bearing, not stylistic - this is the fact the whole design rests on.
    assert not any(line.lower().startswith("subsystem") for line in BODY_LINES)


def test_forcecommand_targets_the_reader_shell_and_nothing_else():
    fc = [line for line in BODY_LINES if line.lower().startswith("forcecommand")]
    assert fc == ["ForceCommand /usr/local/lib/kb/reader_shell.sh"]


@pytest.mark.parametrize(
    "directive",
    ["AllowTcpForwarding no", "X11Forwarding no", "PermitTunnel no", "AllowAgentForwarding no"],
)
def test_forwarding_denial_present(directive):
    assert directive in BODY_LINES


# --------------------------------------------------------------------- reader_shell.sh refusal

READER_SHELL_PATH = Path(
    os.environ.get(
        "KB_READER_SHELL_PATH",
        r"C:\Users\danie\kb-rehearsal\tooling\kb-reader\reader_shell.sh",
    )
)
_SKIP_REASON = (
    f"reader_shell.sh not found at {READER_SHELL_PATH} (it lives outside this git repo - set "
    "KB_READER_SHELL_PATH to point at a copy to exercise this half of the test)"
)


def _run_reader_shell(original_command: str) -> subprocess.CompletedProcess:
    bash = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
    if not Path(bash).exists():
        pytest.skip(f"no bash interpreter found to exec reader_shell.sh (looked for {bash})")
    env = dict(os.environ)
    env["SSH_ORIGINAL_COMMAND"] = original_command
    return subprocess.run(
        [bash, str(READER_SHELL_PATH)],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )


@pytest.mark.skipif(not READER_SHELL_PATH.is_file(), reason=_SKIP_REASON)
@pytest.mark.parametrize(
    "original_command",
    ["internal-sftp", "/usr/lib/openssh/sftp-server", "sftp-server"],
)
def test_reader_shell_refuses_sftp_subsystem_requests(original_command):
    result = _run_reader_shell(original_command)
    assert result.returncode == 1
    assert "sftp denied" in result.stderr


@pytest.mark.skipif(not READER_SHELL_PATH.is_file(), reason=_SKIP_REASON)
def test_reader_shell_still_allows_an_ordinary_read_verb():
    result = _run_reader_shell("hostname")
    assert result.returncode == 0
