"""Tests for the W2.1 hard-ceiling guard (GateGuard classifier retarget).

The hook is driven via subprocess. Every payload is WRITTEN TO A TEMP FILE and
then read back as bytes before being piped to the hook's stdin — credential-path
and destructive command strings are NEVER placed on a Bash command line (the
live ECC GateGuard would otherwise block the runner).

Contract:
  Category A (hard ceiling — credential-store access): exit 2 + stderr "[hard-ceiling BLOCK]".
  Category B (generally destructive): exit 0 + stderr "[hard-ceiling WARN]".
  Benign commands: exit 0, silent.
  Unparseable input: exit 0, silent (fail open).
"""

import json
import subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "scripts" / "hooks" / "hard_ceiling_guard.js"


def run_hook(tmp_path, command):
    """Write a hook payload to a temp file, read it back, pipe it to the hook."""
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    pf = tmp_path / "payload.json"
    pf.write_text(payload, encoding="utf-8")
    data = pf.read_bytes()
    return subprocess.run(["node", str(HOOK)], input=data, capture_output=True)


def run_hook_raw(tmp_path, raw_bytes):
    """Pipe arbitrary (possibly non-JSON) bytes to the hook."""
    pf = tmp_path / "payload.raw"
    pf.write_bytes(raw_bytes)
    return subprocess.run(["node", str(HOOK)], input=pf.read_bytes(), capture_output=True)


# --- Category A: hard ceiling (credential-store access) -> BLOCK (exit 2) ---

CATEGORY_A = [
    "cat .env",                                # read a .env secrets file
    "echo SECRET=1 >> .env",                   # write a .env secrets file
    "cat .env.production",                     # dotted .env variant
    "cat ~/.ssh/id_rsa",                       # ssh private key
    "ssh -i ~/.ssh/id_ed25519 host",           # ssh key referenced as an arg
    "cat ~/.aws/credentials",                  # aws credential store
    "keyring get my-service my-user",          # OS keyring read
    "secret-tool lookup service foo",          # libsecret read
    "cmdkey /list",                            # Windows credential manager
    "security find-generic-password -s foo",   # macOS keychain read
    "claude setup-token",                      # credential minting
    "gh auth token",                           # token minting
    "aws sts get-session-token",               # session-credential minting
    "echo $(cat ~/.ssh/id_rsa)",               # hidden inside a subshell
    "rm -rf ~/.ssh",                           # A wins over B when both apply
]


def test_category_a_blocks(tmp_path):
    for cmd in CATEGORY_A:
        r = run_hook(tmp_path, cmd)
        assert r.returncode == 2, f"expected BLOCK for {cmd!r}, got {r.returncode} / {r.stderr!r}"
        assert b"[hard-ceiling BLOCK]" in r.stderr, f"missing BLOCK reason for {cmd!r}: {r.stderr!r}"


# --- Category B: generally destructive -> WARN only (exit 0 + stderr) ---

CATEGORY_B = [
    "rm -rf build/",                                  # recursive force delete
    "rm -fr node_modules",                            # combined flag order
    "git push --force origin main",                   # force push
    "git push origin +main",                          # force via + refspec
    "git reset --hard HEAD~1",                         # discard working tree
    "git commit --amend -m x",                        # history rewrite
    "git clean -fd",                                  # force clean
    "dd if=disk.img of=/dev/sda",                     # disk-level op (image -> raw disk)
    "find . -name '*.tmp' -exec rm {} \\;",           # find -exec rm
    "echo y | $(rm -rf /tmp/x)",                      # destructive in subshell
]


def test_category_b_warns(tmp_path):
    for cmd in CATEGORY_B:
        r = run_hook(tmp_path, cmd)
        assert r.returncode == 0, f"expected WARN(exit 0) for {cmd!r}, got {r.returncode} / {r.stderr!r}"
        assert b"[hard-ceiling WARN]" in r.stderr, f"missing WARN for {cmd!r}: {r.stderr!r}"


# --- Benign controls -> exit 0, silent ---

BENIGN = [
    "git commit -m x",              # plain commit
    "git status",                   # introspection
    "rm oldfile.txt",               # single-file delete
    "py -m pytest tests/",          # running tests
    "npm install",                  # dependency install
    "echo hello world",             # plain echo
    "cat .env.example",             # committed template, not a secret
    "cat README.md",                # ordinary read
    "git push origin main",         # non-force push
]


def test_benign_silent(tmp_path):
    for cmd in BENIGN:
        r = run_hook(tmp_path, cmd)
        assert r.returncode == 0, f"expected exit 0 for {cmd!r}, got {r.returncode} / {r.stderr!r}"
        assert r.stderr.strip() == b"", f"expected silence for {cmd!r}, got {r.stderr!r}"


# --- Fail open on unparseable input ---

def test_fail_open_on_garbage(tmp_path):
    r = run_hook_raw(tmp_path, b"this is not json at all")
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_empty(tmp_path):
    r = run_hook_raw(tmp_path, b"")
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_missing_command(tmp_path):
    pf = tmp_path / "p.json"
    pf.write_text(json.dumps({"tool_name": "Bash", "tool_input": {}}), encoding="utf-8")
    r = subprocess.run(["node", str(HOOK)], input=pf.read_bytes(), capture_output=True)
    assert r.returncode == 0 and r.stderr.strip() == b""
