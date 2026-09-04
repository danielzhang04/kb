from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from deploy.apply_ops_reconciliation import (
    COORDINATION,
    RECONCILED,
    apply_reconciliation,
    make_git_runner,
    parse_raw_diff,
)
from scripts.promote_vm_outbox import promote_pending
from scripts.sync_daemon_dirs import DAEMON_READ_DIRS

# A card body long enough that moving it with one changed line reads as a rename to git's similarity
# scorer -- i.e. exactly what queue/inbox -> queue/working traffic looks like in production.
CARD_BODY = "".join(f"line{index}\n" for index in range(1, 21))


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-c", "core.longpaths=true", *args],
        cwd=repo,
        check=check,
        capture_output=True,
        text=True,
    )


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
    # Base content for the rename cases: a card that later moves between queue stages, and a durable
    # doc that must never be renamable out of the tree by a reconciliation.
    (seed / "queue" / "inbox").mkdir(parents=True)
    (seed / "queue" / "inbox" / "card-abc.md").write_text(CARD_BODY, encoding="utf-8")
    (seed / "docs").mkdir()
    (seed / "docs" / "design.md").write_text("durable design note\n", encoding="utf-8")
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


def commit_identity(monkeypatch) -> None:
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")


def desktop_ops_commit(tmp_path: Path, origin: Path, name: str, mutate) -> tuple[str, Path]:
    """Add one desktop-authored commit on top of `ops`, the way the ops worktree does.

    Returns (head, clone). These commits carry no outbox manifest on purpose: the reconciled range
    legitimately contains desktop writes the VM never originated, and they are exactly what the
    RECONCILED allowlist -- not the narrower VM-source COORDINATION -- governs.
    """
    work = tmp_path / name
    git(tmp_path, "clone", str(origin), str(work))
    configure(work)
    mutate(work)
    git(work, "add", "-A")
    git(work, "commit", "-m", f"desktop: {name}")
    git(work, "push", "origin", "ops")
    return git(work, "rev-parse", "HEAD").stdout.strip(), work


def return_bundle(tmp_path: Path, origin: Path, target: str, name: str = "ops-return.bundle") -> Path:
    bundle_repo = tmp_path / f"bundle-repo-{name}"
    git(tmp_path, "clone", str(origin), str(bundle_repo))
    git(bundle_repo, "update-ref", "refs/kb-reconciled/ops", target)
    bundle = tmp_path / name
    git(bundle_repo, "bundle", "create", str(bundle), "refs/kb-reconciled/ops")
    return bundle


def returned_receipt_dir(tmp_path: Path, spool: Path, manifest: dict) -> Path:
    returned = tmp_path / "returned-receipts"
    returned.mkdir(exist_ok=True)
    source = spool / "receipts" / f"{manifest['id']}.json"
    (returned / source.name).write_bytes(source.read_bytes())
    return returned


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


def test_reconciliation_refuses_receipt_without_exact_rebased_delta(tmp_path, monkeypatch):
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    for name in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{name}_NAME", "task-17-test")
        monkeypatch.setenv(f"GIT_{name}_EMAIL", "task-17-test@example.invalid")
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
    receipt = json.loads(
        (spool / "receipts" / f"{manifest['id']}.json").read_text(encoding="utf-8")
    )
    receipt["promotedCommit"] = trusted
    (returned_receipts / f"{manifest['id']}.json").write_bytes(canonical(receipt))

    with pytest.raises(RuntimeError, match="exact rebased bundle delta"):
        apply_reconciliation(
            vm,
            spool,
            returned_bundle,
            returned_receipts,
            source,
            target,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=make_git_runner(git_user=None),
        )

    assert git(vm, "rev-parse", "HEAD").stdout.strip() == source


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


# --- Defect 1: rename/copy records in the reconciled raw diff --------------------------------


def test_reconciliation_accepts_a_card_rename_in_the_reconciled_range(tmp_path, monkeypatch):
    """A card moving queue/inbox -> queue/working with a one-line edit must reconcile.

    Regression for the live failure: `git diff --raw -z` detects the move as a rename and emits a
    three-field record, which parse_raw_diff refuses. Ordinary queue traffic looks exactly like
    this, so before the `--no-renames` fix this leg could never complete.
    """
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def move_card(work: Path) -> None:
        (work / "queue" / "working").mkdir(parents=True, exist_ok=True)
        git(work, "mv", "queue/inbox/card-abc.md", "queue/working/card-abc.md")
        (work / "queue" / "working" / "card-abc.md").write_text(
            CARD_BODY.replace("line20\n", "status: working\n"), encoding="utf-8"
        )

    target, work = desktop_ops_commit(tmp_path, origin, "card-move", move_card)
    # Prove the fixture really is rename-shaped, so this test cannot quietly stop covering the bug.
    assert re.search(r" R\d{3}\t", git(work, "diff", "--raw", "--no-abbrev", f"{target}~1", target).stdout)

    assert apply_reconciliation(
        vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
        source, target,
        readiness=lambda: {"quiescent": True, "blockers": []},
        run=make_git_runner(git_user=None),
    ) == target
    assert git(vm, "rev-parse", "HEAD").stdout.strip() == target
    assert (vm / "queue" / "working" / "card-abc.md").is_file()
    assert not (vm / "queue" / "inbox" / "card-abc.md").exists()


def test_reconciliation_refuses_a_rename_out_of_a_non_allowlisted_path(tmp_path, monkeypatch):
    """A pure rename must not smuggle a non-allowlisted deletion past the allowlist.

    With git's default rename detection `--name-only` reports only the DESTINATION, so
    `git mv docs/design.md queue/inbox/smuggled.md` would present one allowlisted path while
    deleting a file the allowlist exists to protect. `--no-renames` turns it into an explicit
    D + A pair, so the source is checked and the whole reconciliation is refused.
    """
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def smuggle(work: Path) -> None:
        git(work, "mv", "docs/design.md", "queue/inbox/smuggled.md")

    target, work = desktop_ops_commit(tmp_path, origin, "smuggle", smuggle)
    raw = git(work, "diff", "--raw", "--no-abbrev", f"{target}~1", target).stdout
    assert re.search(r" R100\t", raw)  # a content-identical move: rename detection is certain here
    assert git(work, "diff", "--name-only", f"{target}~1", target).stdout.split() == [
        "queue/inbox/smuggled.md"
    ]  # ...and the destination is all `--name-only` would have reported

    with pytest.raises(RuntimeError, match="non-coordination path"):
        apply_reconciliation(
            vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
            source, target,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=make_git_runner(git_user=None),
        )
    assert git(vm, "rev-parse", "HEAD").stdout.strip() == source


def test_parse_raw_diff_refuses_a_rename_or_copy_record():
    """The parser stays strictly (header, path) pairs and names the cause when it is not."""
    sha = b"1" * 40
    for status in (b"R098", b"R100", b"C085"):
        record = b":100644 100644 " + sha + b" " + b"2" * 40 + b" " + status + b"\0src\0dst\0"
        with pytest.raises(RuntimeError, match="rename or copy record"):
            parse_raw_diff(record)
        # Two such records keep the field count odd, so the parity rule alone would not catch them.
        with pytest.raises(RuntimeError, match="rename or copy record"):
            parse_raw_diff(record + record)


# --- Defect 2: the reconciled-range allowlist ------------------------------------------------


def test_reconciliation_accepts_daemon_read_mirror_and_atlas_transcripts(tmp_path, monkeypatch):
    """The desktop's non-COORDINATION ops writers must reach the VM.

    agents/** and orgs/*/workflows/** are the main -> ops mirror the daemon reads (runnable-owner
    resolution lives on the agent catalog); orgs/atlas/output/transcripts/*.jsonl is the Atlas voice
    worker. Before the fix each of these refused the whole reconciliation, which is why the VM sat
    on a 4-file agent catalog against ops' 10.
    """
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def mirror(work: Path) -> None:
        for relpath, body in (
            ("agents/grader.md", "# grader\n"),
            ("orgs/faceless-youtube/workflows/video-run.md", "# video run\n"),
            ("orgs/faceless-youtube/workflows/segments/segment-a.workflow.js", "// segment a\n"),
            ("orgs/atlas/output/transcripts/2026-08-21-abc.jsonl", '{"t":"0","role":"user","text":"hi"}\n'),
            ("orgs/atlas/STATE.md", "# atlas\n"),
        ):
            path = work / relpath
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")

    target, _work = desktop_ops_commit(tmp_path, origin, "daemon-mirror", mirror)
    assert apply_reconciliation(
        vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
        source, target,
        readiness=lambda: {"quiescent": True, "blockers": []},
        run=make_git_runner(git_user=None),
    ) == target
    assert (vm / "agents" / "grader.md").is_file()
    assert (vm / "orgs" / "atlas" / "output" / "transcripts" / "2026-08-21-abc.jsonl").is_file()


def test_reconciliation_accepts_a_model_routing_only_range(tmp_path, monkeypatch):
    """W61: a range whose ONLY non-coordination change is governance/model-routing.yaml lands.

    dashboard/server/control/environment.ts#loadExecutionProfiles compiles the execution-profile
    catalogue from that file in the daemon's ops checkout, so when ops drifts behind main every
    launch naming a newer model answers 400 assigned-profile-not-found. On 2026-09-04 the mirror
    commit that would have fixed it was itself refused here with 'non-coordination path'. Revert
    the RECONCILED entry and this goes red on exactly that message.
    """
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def mirror(work: Path) -> None:
        path = work / "governance" / "model-routing.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "runtimes:\n  claude:\n    known_models: [claude-fable-5, claude-opus-5]\n",
            encoding="utf-8",
        )

    target, _work = desktop_ops_commit(tmp_path, origin, "model-routing-mirror", mirror)
    assert apply_reconciliation(
        vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
        source, target,
        readiness=lambda: {"quiescent": True, "blockers": []},
        run=make_git_runner(git_user=None),
    ) == target
    assert "claude-fable-5" in (vm / "governance" / "model-routing.yaml").read_text(encoding="utf-8")


def test_reconciliation_refuses_the_rest_of_governance(tmp_path, monkeypatch):
    """Admitting one daemon-read registry file must not admit the governance/ tree.

    governance/ is human-edited policy (CLAUDE.md); risk-tiers.md in particular decides what a VM
    approval may authorize, so a promotion that could rewrite it on the VM would let the loop
    relax its own ceiling. A commit carrying BOTH the admitted file and a second governance path
    is refused whole -- there is no partial apply.
    """
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def mirror(work: Path) -> None:
        for relpath, body in (
            ("governance/model-routing.yaml", "runtimes: {}\n"),
            ("governance/risk-tiers.md", "# tiers, rewritten by a compromised promotion\n"),
        ):
            path = work / relpath
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")

    target, _work = desktop_ops_commit(tmp_path, origin, "governance-widening", mirror)
    with pytest.raises(RuntimeError, match="non-coordination path"):
        apply_reconciliation(
            vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
            source, target,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=make_git_runner(git_user=None),
        )
    assert git(vm, "rev-parse", "HEAD").stdout.strip() == source
    assert not (vm / "governance" / "risk-tiers.md").exists()


@pytest.mark.parametrize(
    "relpath",
    [
        "deploy/apply_ops_reconciliation.py",
        "dashboard/server/index.ts",
        "scripts/promote_vm_outbox.py",
        "governance/budget.yaml",
        "CLAUDE.md",
        "HEARTBEAT.md",
        ".claude/settings.json",
        "orgs/atlas/output/persona-samples/voice.wav",
        "orgs/faceless-youtube/channels/the-second-take/videos/run/brief.md",
    ],
)
def test_reconciliation_still_refuses_runtime_and_work_product_paths(tmp_path, monkeypatch, relpath):
    """The widened allowlist must not have opened the VM's own runtime, or org work product."""
    origin, operator, vm, spool, trusted, source, manifest = integration_fixture(tmp_path)
    commit_identity(monkeypatch)
    assert promote_pending(spool, operator, tmp_path / "promotion-work", trusted) == {
        "promoted": 1, "pending": 0, "failed": 0,
    }

    def rewrite(work: Path) -> None:
        path = work / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("rewritten by a compromised promotion\n", encoding="utf-8")

    target, _work = desktop_ops_commit(tmp_path, origin, "rewrite", rewrite)
    with pytest.raises(RuntimeError, match="non-coordination path"):
        apply_reconciliation(
            vm, spool, return_bundle(tmp_path, origin, target), returned_receipt_dir(tmp_path, spool, manifest),
            source, target,
            readiness=lambda: {"quiescent": True, "blockers": []},
            run=make_git_runner(git_user=None),
        )
    assert git(vm, "rev-parse", "HEAD").stdout.strip() == source


def test_reconciled_allowlist_covers_every_daemon_read_dir():
    """Pin RECONCILED to scripts/sync_daemon_dirs.DAEMON_READ_DIRS.

    That script is what puts agents/, orgs/*/workflows/ and governance/model-routing.yaml onto
    ops. Adding an entry there while leaving this allowlist behind would wedge the reconciliation
    leg again, silently, the way it was wedged for two weeks (agents/**) and again on 2026-09-04
    (the model-routing mirror) -- so the two move together or this fails. The entry rule is that
    script's own: trailing "/" is a directory prefix, no trailing "/" is one exact file.
    """
    for pattern in DAEMON_READ_DIRS:
        body = pattern.rstrip("/").replace("*", "sample-org")
        sample = body if not pattern.endswith("/") else body + "/sample.md"
        assert RECONCILED.fullmatch(sample) is not None, f"{pattern} is not reconcilable"


def test_vm_source_allowlist_stays_narrower_than_the_reconciled_one():
    """The VM may receive the desktop's mirror; it must never be able to originate it."""
    for relpath in (
        "agents/grader.md",
        "orgs/faceless-youtube/workflows/segments/segment-a.workflow.js",
        "orgs/atlas/output/transcripts/2026-08-21-abc.jsonl",
        "governance/model-routing.yaml",
    ):
        assert RECONCILED.fullmatch(relpath) is not None
        assert COORDINATION.fullmatch(relpath) is None
    for relpath in ("queue/inbox/card.md", "ledgers/cost/x.tsv", "orgs/atlas/STATE.md"):
        assert COORDINATION.fullmatch(relpath) is not None
        assert RECONCILED.fullmatch(relpath) is not None


@pytest.mark.parametrize(
    "relpath",
    [
        "deploy/apply_ops_reconciliation.py",
        "scripts/sync_daemon_dirs.py",
        "governance/risk-tiers.md",
        # The model-routing entry is ONE file, not a doorway into governance/: its siblings, a
        # look-alike name, a directory of the same name, and a copy under another root all stay out.
        "governance/budget.yaml",
        "governance/card-schema.md",
        "governance/model-routing.yml",
        "governance/model-routing.yaml.bak",
        "governance/model-routing.yaml/nested.yaml",
        "governance/sub/model-routing.yaml",
        "orgs/atlas/governance/model-routing.yaml",
        "HEARTBEAT.md",
        "CLAUDE.md",
        ".claude/settings.json",
        "broker/broker.js",
        "skills/code-review/SKILL.md",
        "docs/plans/plan.md",
        "routines/nightly.md",
        "templates/card.md",
        "orgs/atlas/output/persona-samples/voice.wav",
        "orgs/atlas/output/transcripts/nested/deep.jsonl",
        "orgs/atlas/output/transcripts/script.sh",
        "orgs/other-org/output/transcripts/a.jsonl",
        "orgs/faceless-youtube/channels/x/videos/y/brief.md",
        "agents",
        "orgs/faceless-youtube/workflows",
    ],
)
def test_reconciled_allowlist_excludes(relpath):
    """Everything ops carries but this leg must never rewrite, plus the near-misses at each edge."""
    assert RECONCILED.fullmatch(relpath) is None
