from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

from deploy.apply_ops_reconciliation import apply_reconciliation, make_git_runner
from scripts.promote_vm_outbox import promote_pending


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=repo, check=check, capture_output=True, text=True)


def configure(repo: Path) -> None:
    git(repo, "config", "user.name", "task-17-test")
    git(repo, "config", "user.email", "task-17-test@example.invalid")


def integration_fixture(tmp_path: Path):
    origin = tmp_path / "origin.git"
    origin.mkdir()
    git(origin, "init", "--bare")
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-b", "ops")
    configure(seed)
    (seed / "ledgers").mkdir()
    (seed / "ledgers" / "base.jsonl").write_text("base\n", encoding="utf-8")
    git(seed, "add", ".")
    git(seed, "commit", "-m", "base")
    git(seed, "remote", "add", "origin", str(origin))
    git(seed, "push", "-u", "origin", "ops")
    git(origin, "symbolic-ref", "HEAD", "refs/heads/ops")
    trusted = git(seed, "rev-parse", "HEAD").stdout.strip()

    vm = tmp_path / "vm"
    git(tmp_path, "clone", str(origin), str(vm))
    configure(vm)
    (vm / "ledgers" / "change.jsonl").write_text("change\n", encoding="utf-8")
    git(vm, "add", ".")
    git(vm, "commit", "-m", "vm change")
    source = git(vm, "rev-parse", "HEAD").stdout.strip()
    spool = tmp_path / "vm-spool"
    (spool / "ready").mkdir(parents=True)
    (spool / "receipts").mkdir()
    item_ref = f"refs/kb-outbox/items/{source}"
    git(vm, "update-ref", item_ref, source)
    bundle = spool / "ready" / f"{source}.bundle"
    git(vm, "bundle", "create", str(bundle), f"{trusted}..{item_ref}")
    git(vm, "update-ref", "-d", item_ref)
    manifest = {
        "schema": "kb.ops-outbox/v1",
        "id": source,
        "parent": trusted,
        "commit": source,
        "paths": ["ledgers/change.jsonl"],
        "createdAt": "2026-08-11T12:00:00.000Z",
        "bundleSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
    }
    (spool / "ready" / f"{source}.json").write_bytes(canonical(manifest))
    git(vm, "update-ref", "refs/kb-outbox/spooled", source)

    operator = tmp_path / "operator"
    git(tmp_path, "clone", str(origin), str(operator))
    return origin, operator, vm, spool, trusted, source, manifest


def test_vm_reconciliation_requires_quiescence_and_all_receipts(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    spool = tmp_path / "spool"
    (spool / "ready").mkdir(parents=True)
    (spool / "receipts").mkdir()
    returned_receipts = tmp_path / "returned-receipts"
    returned_receipts.mkdir()
    bundle = tmp_path / "ops-return.bundle"
    bundle.write_bytes(b"bundle")
    with pytest.raises(RuntimeError, match="quiescent"):
        apply_reconciliation(
            repo, spool, bundle, returned_receipts, "b" * 40, "c" * 40,
            readiness=lambda: {"quiescent": False}, run=make_git_runner(git_user=None),
        )
    (spool / "ready" / "pending.json").write_text("{}", encoding="utf-8")
    with pytest.raises(RuntimeError, match="unreceipted"):
        apply_reconciliation(
            repo, spool, bundle, returned_receipts, "b" * 40, "c" * 40,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=make_git_runner(git_user=None),
        )


def test_reconciliation_applies_exact_promoted_tree_and_is_idempotent(tmp_path, monkeypatch):
    origin, operator, vm, desktop_spool, trusted, source, manifest = integration_fixture(tmp_path)
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")
    assert promote_pending(desktop_spool, operator, tmp_path / "promotion-work", trusted) == {"promoted": 1, "pending": 0, "failed": 0}
    target = git(origin, "rev-parse", "refs/heads/ops").stdout.strip()

    bundle_repo = tmp_path / "bundle-repo"
    git(tmp_path, "clone", str(origin), str(bundle_repo))
    git(bundle_repo, "update-ref", "refs/kb-reconciled/ops", target)
    returned_bundle = tmp_path / "ops-return.bundle"
    git(bundle_repo, "bundle", "create", str(returned_bundle), "refs/kb-reconciled/ops")

    returned_receipts = tmp_path / "returned-receipts"
    returned_receipts.mkdir()
    receipt_source = desktop_spool / "receipts" / f"{manifest['id']}.json"
    (returned_receipts / receipt_source.name).write_bytes(receipt_source.read_bytes())
    vm_spool = tmp_path / "vm-spool"
    assert vm_spool == desktop_spool
    assert apply_reconciliation(
        vm, vm_spool, returned_bundle, returned_receipts, source, target,
        readiness=lambda: {"quiescent": True, "blockers": []},
        run=make_git_runner(git_user=None),  # hermetic: never runuser into the service account
    ) == target
    assert git(vm, "rev-parse", "HEAD").stdout.strip() == target
    assert git(vm, "diff", "--quiet", "HEAD", "refs/heads/ops", check=False).returncode == 0
    assert git(vm, "rev-parse", "refs/kb-outbox/spooled").stdout.strip() == target
    assert git(vm, "rev-parse", f"refs/heads/kb-before-reconcile-{source[:12]}").stdout.strip() == source

    def must_not_promote(*_args, **_kwargs):
        raise AssertionError("reconciled item replayed")

    assert promote_pending(desktop_spool, operator, tmp_path / "promotion-again", trusted, run_git=must_not_promote, clone_fresh=must_not_promote) == {"promoted": 0, "pending": 0, "failed": 0}


def test_reconciliation_retains_only_the_newest_100_promoted_entries(tmp_path, monkeypatch):
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")

    promoted = spool / "promoted"
    promoted.mkdir()
    old_ids = [f"{index:040x}" for index in range(100)]
    for index, identity in enumerate(old_ids, start=1):
        for suffix in (".json", ".bundle", ".receipt.json"):
            path = promoted / f"{identity}{suffix}"
            path.write_bytes(b"retired\n")
            os.utime(path, ns=(index, index))

    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }
    target = git(origin, "rev-parse", "refs/heads/ops").stdout.strip()
    bundle_repo = tmp_path / "bundle-repo"
    git(tmp_path, "clone", str(origin), str(bundle_repo))
    git(bundle_repo, "update-ref", "refs/kb-reconciled/ops", target)
    returned_bundle = tmp_path / "ops-return.bundle"
    git(bundle_repo, "bundle", "create", str(returned_bundle), "refs/kb-reconciled/ops")
    returned_receipts = tmp_path / "returned-receipts"
    returned_receipts.mkdir()
    receipt_source = spool / "receipts" / f"{manifest['id']}.json"
    (returned_receipts / receipt_source.name).write_bytes(receipt_source.read_bytes())

    apply_reconciliation(
        vm, spool, returned_bundle, returned_receipts, source, target,
        readiness=lambda: {"quiescent": True, "blockers": []},
        run=make_git_runner(git_user=None),
    )

    assert len(list(promoted.glob("*.receipt.json"))) == 100
    assert not any(promoted.glob(f"{old_ids[0]}*"))
    assert (promoted / f"{source}.receipt.json").is_file()


def test_reconciliation_refuses_returned_receipt_mismatch_before_git(tmp_path):
    spool = tmp_path / "spool"
    (spool / "ready").mkdir(parents=True)
    (spool / "receipts").mkdir()
    returned = tmp_path / "returned"
    returned.mkdir()
    identity = "b" * 40
    bundle = b"source"
    manifest = {"schema": "kb.ops-outbox/v1", "id": identity, "parent": "a" * 40, "commit": identity, "paths": ["ledgers/a"], "createdAt": "2026-08-11T00:00:00.000Z", "bundleSha256": hashlib.sha256(bundle).hexdigest()}
    (spool / "ready" / f"{identity}.json").write_bytes(canonical(manifest))
    (spool / "ready" / f"{identity}.bundle").write_bytes(bundle)
    receipt = {"schema": "kb.ops-promotion/v1", "id": identity, "sourceCommit": "c" * 40, "promotedCommit": "d" * 40, "promotedAt": "2026-08-11T00:00:01.000Z"}
    (returned / f"{identity}.json").write_bytes(canonical(receipt))
    with pytest.raises(RuntimeError, match="does not match"):
        apply_reconciliation(
            tmp_path / "repo", spool, tmp_path / "return.bundle", returned, identity, "d" * 40,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("git called")),
        )
