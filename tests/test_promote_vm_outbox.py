from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.promote_vm_outbox import (
    APPROVAL_KEYS,
    APPROVAL_NAMESPACE,
    APPROVAL_PRINCIPAL,
    approval_value,
    fetch_vm_outbox,
    parse_raw_diff,
    promote_pending,
    require_instruction_approval,
    validate_quarantine_chain,
    validate_snapshot,
)


BASE = "a" * 40
COMMIT = "b" * 40


def completed(args: list[str], stdout: str | bytes = "", returncode: int = 0, stderr: str | bytes = ""):
    return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr=stderr)


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")


def raw_row(path: str, old: str = "100644", new: str = "100644", status: str = "M") -> bytes:
    return f":{old} {new} {'1' * 40} {'2' * 40} {status}\0".encode() + path.encode() + b"\0"


def fixture_bundle(tmp_path: Path, paths: list[str] | None = None, *, parent: str = BASE, commit: str = COMMIT):
    spool = tmp_path / "spool"
    ready = spool / "ready"
    receipts = spool / "receipts"
    ready.mkdir(parents=True)
    receipts.mkdir()
    repo = tmp_path / "repo"
    repo.mkdir()
    bundle = b"bundle"
    manifest = {
        "schema": "kb.ops-outbox/v1",
        "id": commit,
        "parent": parent,
        "commit": commit,
        "paths": paths or ["ledgers/test.jsonl"],
        "createdAt": "2026-08-11T12:00:00.000Z",
        "bundleSha256": hashlib.sha256(bundle).hexdigest(),
    }
    (ready / f"{commit}.json").write_bytes(canonical(manifest))
    (ready / f"{commit}.bundle").write_bytes(bundle)
    return spool, repo, manifest


def rewrite_manifest(ready: Path, manifest: dict, changes: dict) -> None:
    changed = {**manifest, **changes}
    (ready / f"{manifest['id']}.json").write_bytes(canonical(changed))


def fake_git(defect: str = "ok"):
    def run(_repo: Path, args: list[str], check: bool = True):
        commit = COMMIT
        if args[:2] == ["bundle", "list-heads"]:
            advertised = "c" * 40 if defect == "wrong-ref" else commit
            return completed(args, f"{advertised} refs/kb-outbox/items/{commit}\n")
        if args[0] == "rev-parse":
            return completed(args, ("c" * 40 if defect == "wrong-quarantine" else commit) + "\n")
        if args[:3] == ["rev-list", "--parents", "-n"]:
            if defect == "merge":
                return completed(args, f"{commit} {BASE} {'d' * 40}\n")
            parent = "d" * 40 if defect == "broken-parent" else BASE
            return completed(args, f"{commit} {parent}\n")
        if args[0] == "diff-tree":
            if defect == "symlink":
                return completed(args, raw_row("ledgers/test.jsonl", new="120000"))
            if defect == "gitlink":
                return completed(args, raw_row("ledgers/test.jsonl", new="160000"))
            if defect == "path-mismatch":
                return completed(args, raw_row("ledgers/other.jsonl"))
            if defect == "non-coordination":
                return completed(args, raw_row("docs/design.md"))
            return completed(args, raw_row("ledgers/test.jsonl"))
        return completed(args)

    return run


def verifier(returncode: int = 0, *, stdout: bytes | None = None, stderr: bytes = b""):
    calls: list[tuple[list[str], dict]] = []
    good = (
        f'Good "{APPROVAL_NAMESPACE}" signature for {APPROVAL_PRINCIPAL} '
        "with ED25519 key SHA256:abcDEF012+/=\n"
    ).encode("ascii")

    def run(args: list[str], **kwargs):
        calls.append((args, kwargs))
        return completed(args, good if stdout is None else stdout, returncode, stderr)

    run.calls = calls
    return run


def write_approval(tmp_path: Path, chain: list[dict]):
    approval = tmp_path / "instruction-approval.json"
    signature = tmp_path / "instruction-approval.json.sig"
    allowed = tmp_path / "allowed-signers"
    approval.write_bytes(canonical(approval_value(chain)))
    signature.write_bytes(b"signature")
    allowed.write_text("kb-ops-approver ssh-ed25519 AAAA\n", encoding="ascii")
    return approval, signature, allowed


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo, check=check, capture_output=True, text=True,
    )


def configure_repo(repo: Path) -> None:
    git(repo, "config", "user.name", "task-17-test")
    git(repo, "config", "user.email", "task-17-test@example.invalid")


def real_fixture(tmp_path: Path, changes: list[tuple[str, str]]):
    origin = tmp_path / "origin.git"
    origin.mkdir()
    git(origin, "init", "--bare")
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-b", "ops")
    configure_repo(seed)
    (seed / "ledgers").mkdir()
    (seed / "ledgers" / "base.jsonl").write_text("base\n", encoding="utf-8")
    git(seed, "add", "ledgers/base.jsonl")
    git(seed, "commit", "-m", "base")
    git(seed, "remote", "add", "origin", str(origin))
    git(seed, "push", "-u", "origin", "ops")
    git(origin, "symbolic-ref", "HEAD", "refs/heads/ops")
    trusted = git(seed, "rev-parse", "HEAD").stdout.strip()

    vm = tmp_path / "vm"
    git(tmp_path, "clone", str(origin), str(vm))
    configure_repo(vm)
    spool = tmp_path / "spool"
    (spool / "ready").mkdir(parents=True)
    (spool / "receipts").mkdir()
    manifests = []
    for index, (rel, body) in enumerate(changes):
        target = vm / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        git(vm, "add", rel)
        git(vm, "commit", "-m", f"source {index}")
        commit = git(vm, "rev-parse", "HEAD").stdout.strip()
        parent = git(vm, "rev-parse", "HEAD^").stdout.strip()
        item_ref = f"refs/kb-outbox/items/{commit}"
        git(vm, "update-ref", item_ref, commit)
        bundle = spool / "ready" / f"{commit}.bundle"
        git(vm, "bundle", "create", str(bundle), f"{parent}..{item_ref}")
        git(vm, "update-ref", "-d", item_ref)
        paths = sorted(git(vm, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).stdout.splitlines())
        manifest = {
            "schema": "kb.ops-outbox/v1",
            "id": commit,
            "parent": parent,
            "commit": commit,
            "paths": paths,
            "createdAt": f"2026-08-11T12:00:0{index}.000Z",
            "bundleSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
        }
        (spool / "ready" / f"{commit}.json").write_bytes(canonical(manifest))
        manifests.append(manifest)
    git(vm, "update-ref", "refs/kb-outbox/spooled", manifests[-1]["commit"])

    operator = tmp_path / "operator"
    git(tmp_path, "clone", str(origin), str(operator))
    return origin, operator, vm, spool, trusted, manifests


def operator_state(repo: Path) -> tuple[str, str, str, bytes]:
    index = repo / ".git" / "index"
    return (
        git(repo, "rev-parse", "HEAD").stdout,
        git(repo, "show-ref").stdout,
        git(repo, "reflog", "show", "--all").stdout,
        index.read_bytes(),
    )


def test_snapshot_accepts_task16_ascii_escaped_canonical_manifest(tmp_path):
    spool, _repo, manifest = fixture_bundle(tmp_path, ["ledgers/café.jsonl"])
    assert b"caf\\u00e9" in (spool / "ready" / f"{manifest['id']}.json").read_bytes()
    assert validate_snapshot(spool) == [manifest]


@pytest.mark.parametrize(
    "mutation,match",
    [
        (lambda ready, manifest: (ready / f"{'c' * 40}.json").write_bytes((ready / f"{manifest['id']}.json").read_bytes()), "filename"),
        (lambda ready, manifest: rewrite_manifest(ready, manifest, {"id": "c" * 40}), "identity"),
        (lambda ready, manifest: rewrite_manifest(ready, manifest, {"extra": True}), "closed"),
        (lambda ready, manifest: rewrite_manifest(ready, manifest, {"createdAt": "not-a-time"}), "timestamp"),
        (lambda ready, manifest: rewrite_manifest(ready, manifest, {"bundleSha256": "0" * 64}), "digest"),
    ],
)
def test_manifest_validation_fails_closed(tmp_path, mutation, match):
    spool, _repo, manifest = fixture_bundle(tmp_path)
    mutation(spool / "ready", manifest)
    with pytest.raises(RuntimeError, match=match):
        validate_snapshot(spool)


@pytest.mark.parametrize("defect", ["wrong-ref", "wrong-quarantine", "merge", "symlink", "gitlink", "broken-parent", "path-mismatch"])
def test_quarantine_rejects_claim_or_object_defects(tmp_path, defect):
    spool, repo, _manifest = fixture_bundle(tmp_path)
    with pytest.raises(RuntimeError):
        validate_quarantine_chain(spool, repo, BASE, "refs/kb-quarantine/run", run=fake_git(defect))


def test_quarantine_rederives_noncoordination_classification_from_bundle(tmp_path):
    spool, repo, manifest = fixture_bundle(tmp_path, ["docs/design.md"])
    with pytest.raises(RuntimeError, match="non-coordination"):
        validate_quarantine_chain(spool, repo, BASE, "refs/kb-quarantine/run", run=fake_git("non-coordination"))
    assert manifest["paths"] == ["docs/design.md"]


@pytest.mark.parametrize(
    "raw",
    [
        b":100644 100644 " + b"1" * 40 + b" " + b"2" * 40 + b" M\0../escape\0",
        b":100644 100644 " + b"1" * 40 + b" " + b"2" * 40 + b" M\0bad\\path\0",
        b":100644 100644 " + b"1" * 40 + b" " + b"2" * 40 + b" M\0bad\x01path\0",
        b":100644 100644 " + b"1" * 40 + b" " + b"2" * 40 + b" M\0bad\xffpath\0",
        b"not-a-raw-row\0path\0",
    ],
)
def test_parse_raw_diff_rejects_unsafe_or_malformed_paths(raw):
    with pytest.raises(RuntimeError):
        parse_raw_diff(raw)


def test_instruction_path_requires_exact_signed_chain_approval(tmp_path):
    spool, repo, _manifest = fixture_bundle(tmp_path, ["queue/inbox/card.md"])
    chain = validate_quarantine_chain(spool, repo, BASE, "refs/kb-quarantine/run", run=lambda r, a, check=True: (
        completed(a, raw_row("queue/inbox/card.md")) if a[0] == "diff-tree" else
        completed(a, f"{COMMIT} refs/kb-outbox/items/{COMMIT}\n") if a[:2] == ["bundle", "list-heads"] else
        completed(a, f"{COMMIT}\n") if a[0] == "rev-parse" else
        completed(a, f"{COMMIT} {BASE}\n") if a[:3] == ["rev-list", "--parents", "-n"] else completed(a)
    ))
    with pytest.raises(RuntimeError, match="trusted-desktop approval"):
        require_instruction_approval(chain, None, None, None)


def test_instruction_approval_verifies_raw_bytes_before_parse(tmp_path):
    chain = [{"schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": BASE, "commit": COMMIT, "paths": ["queue/a.md"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": "d" * 64}]
    approval = tmp_path / "approval.json"
    signature = tmp_path / "approval.sig"
    allowed = tmp_path / "allowed"
    raw = b"not-json\n"
    approval.write_bytes(raw)
    signature.write_bytes(b"sig")
    allowed.write_bytes(b"allowed")
    run = verifier(returncode=1, stdout=b"")
    with pytest.raises(RuntimeError, match="signature failed"):
        require_instruction_approval(chain, approval, signature, allowed, run=run)
    assert run.calls[0][1]["input"] == raw
    assert run.calls[0][1]["timeout"] > 0
    assert run.calls[0][0][5:9] == ["-I", "kb-ops-approver", "-n", "kb-ops-instructions"]


def test_instruction_approval_accepts_valid_signature_then_rejects_chain_mismatch(tmp_path):
    chain = [{"schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": BASE, "commit": COMMIT, "paths": ["queue/a.md"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": "d" * 64}]
    approval, signature, allowed = write_approval(tmp_path, chain)
    require_instruction_approval(chain, approval, signature, allowed, run=verifier())
    value = json.loads(approval.read_text(encoding="utf-8"))
    value["lastCommit"] = "c" * 40
    approval.write_bytes(canonical(value))
    with pytest.raises(RuntimeError, match="does not bind"):
        require_instruction_approval(chain, approval, signature, allowed, run=verifier())


@pytest.mark.parametrize(
    "stdout,stderr",
    [
        (b"", b""),
        (b'Good "wrong" signature for kb-ops-approver with ED25519 key SHA256:abc\n', b""),
        (b'prefix Good "kb-ops-instructions" signature for kb-ops-approver with ED25519 key SHA256:abc\n', b""),
        (b'Good "kb-ops-instructions" signature for kb-ops-approver with ED25519 key SHA256:abc\n', b"warning\n"),
    ],
)
def test_instruction_approval_rejects_verifier_anomalies(tmp_path, stdout, stderr):
    chain = [{"schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": BASE, "commit": COMMIT, "paths": ["queue/a.md"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": "d" * 64}]
    approval, signature, allowed = write_approval(tmp_path, chain)
    with pytest.raises(RuntimeError, match="signature failed"):
        require_instruction_approval(chain, approval, signature, allowed, run=verifier(stdout=stdout, stderr=stderr))


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="ssh-keygen is not installed")
def test_instruction_approval_gate_with_real_ssh_keygen(tmp_path):
    chain = [{"schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": BASE, "commit": COMMIT, "paths": ["queue/a.md"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": "d" * 64}]
    approval = tmp_path / "instruction-approval.json"
    key = tmp_path / "approval-key"
    signature = approval.with_name(f"{approval.name}.sig")
    allowed = tmp_path / "allowed-signers"
    approval.write_bytes(canonical(approval_value(chain)))
    subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)],
        check=True, capture_output=True, stdin=subprocess.DEVNULL,
    )
    signature.unlink(missing_ok=True)
    subprocess.run(
        ["ssh-keygen", "-Y", "sign", "-f", str(key), "-n", APPROVAL_NAMESPACE, str(approval)],
        check=True, capture_output=True, stdin=subprocess.DEVNULL,
    )
    allowed.write_text(
        f"{APPROVAL_PRINCIPAL} {key.with_suffix('.pub').read_text(encoding='ascii')}",
        encoding="ascii",
    )
    require_instruction_approval(chain, approval, signature, allowed)
    tampered = bytearray(approval.read_bytes())
    tampered[0] ^= 1
    approval.write_bytes(tampered)
    with pytest.raises(RuntimeError, match="signature failed"):
        require_instruction_approval(chain, approval, signature, allowed)


def test_fetch_vm_outbox_uses_argv_and_rejects_unsafe_host(tmp_path):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        if args[0] == "scp":
            (tmp_path / "snapshot" / "ready").mkdir()
            (tmp_path / "snapshot" / "receipts").mkdir()
            return completed(args)
        return completed(args, BASE + "\n")

    assert fetch_vm_outbox("ops@example.test", tmp_path / "snapshot", run=run) == tmp_path / "snapshot"
    assert calls[0][0][:2] == ["scp", "-r"]
    assert calls[1][0] == ["ssh", "ops@example.test", "git", "-C", "/var/lib/kb/ops", "rev-parse", "HEAD"]
    with pytest.raises(ValueError):
        fetch_vm_outbox("-oProxyCommand=bad", tmp_path / "other", run=run)


def test_outage_then_retry_promotes_once_without_touching_operator_checkout(tmp_path, monkeypatch):
    origin, operator, _vm, spool, trusted, manifests = real_fixture(tmp_path, [("ledgers/one.jsonl", "one\n")])
    monkeypatch.setenv("GIT_AUTHOR_NAME", "task-17-test")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "task-17-test@example.invalid")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "task-17-test")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "task-17-test@example.invalid")
    before = operator_state(operator)
    disconnected = tmp_path / "origin.disconnected"
    origin.rename(disconnected)
    first = promote_pending(spool, operator, tmp_path / "work-first", trusted, max_attempts=1)
    assert first == {"promoted": 0, "pending": 1, "failed": 1}
    assert not (spool / "receipts" / f"{manifests[0]['id']}.json").exists()
    disconnected.rename(origin)
    second = promote_pending(spool, operator, tmp_path / "work-second", trusted)
    assert second == {"promoted": 1, "pending": 0, "failed": 0}
    assert operator_state(operator) == before

    def must_not_run(*_args, **_kwargs):
        raise AssertionError("promoted item replayed")

    assert promote_pending(spool, operator, tmp_path / "work-third", trusted, run_git=must_not_run, clone_fresh=must_not_run) == {"promoted": 0, "pending": 0, "failed": 0}


def test_forged_out_of_order_chain_is_reported_as_validation_refusal(tmp_path):
    _origin, operator, _vm, spool, trusted, manifests = real_fixture(
        tmp_path, [("ledgers/one.jsonl", "one\n"), ("traces/two.jsonl", "two\n")],
    )
    ready = spool / "ready"
    first, second = manifests
    (ready / f"{first['id']}.bundle").write_bytes((ready / f"{second['id']}.bundle").read_bytes())
    rewrite_manifest(
        ready,
        first,
        {"bundleSha256": hashlib.sha256((ready / f"{first['id']}.bundle").read_bytes()).hexdigest()},
    )
    with pytest.raises(RuntimeError, match="quarantine validation failed.*not a transport fault"):
        promote_pending(spool, operator, tmp_path / "work", trusted, max_attempts=1)


def test_push_response_loss_recovers_receipt_without_duplicate_commit(tmp_path, monkeypatch):
    origin, operator, _vm, spool, trusted, manifests = real_fixture(tmp_path, [("ledgers/one.jsonl", "one\n")])
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")
    pushes = 0

    def response_lost(repo: Path, args: list[str], check: bool = True):
        nonlocal pushes
        result = subprocess.run(["git", *args], cwd=repo, check=check, capture_output=True)
        if args[0] == "push":
            pushes += 1
            if pushes == 1:
                raise subprocess.CalledProcessError(128, ["git", *args])
        return result

    result = promote_pending(spool, operator, tmp_path / "work", trusted, max_attempts=2, run_git=response_lost)
    receipt = json.loads((spool / "receipts" / f"{manifests[0]['id']}.json").read_text(encoding="utf-8"))
    assert result == {"promoted": 1, "pending": 0, "failed": 0}
    assert pushes == 1
    assert receipt["promotedCommit"] == git(origin, "rev-parse", "refs/heads/ops").stdout.strip()
    assert len(git(origin, "rev-list", "--all").stdout.splitlines()) == 2


def test_two_item_chain_promotes_in_parent_order_and_writes_two_receipts(tmp_path, monkeypatch):
    _origin, operator, _vm, spool, trusted, manifests = real_fixture(
        tmp_path, [("ledgers/one.jsonl", "one\n"), ("traces/two.jsonl", "two\n")],
    )
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")
    assert promote_pending(spool, operator, tmp_path / "work", trusted) == {"promoted": 2, "pending": 0, "failed": 0}
    assert [path.stem for path in sorted((spool / "receipts").glob("*.json"))] == sorted(item["id"] for item in manifests)
