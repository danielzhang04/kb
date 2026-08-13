from __future__ import annotations

import argparse
import inspect
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


COORDINATION = re.compile(r"^(?:queue|ledgers|traces|memory|dashboards|handoffs)/.+$|^orgs/[^/]+/STATE\.md$")
COMMIT_RE = re.compile(r"[0-9a-f]{40}")
DIGEST_RE = re.compile(r"[0-9a-f]{64}")
MANIFEST_KEYS = {"schema", "id", "parent", "commit", "paths", "createdAt", "bundleSha256"}
RECEIPT_KEYS = {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"}
SAFE_CHANGED_MODES = {"000000", "100644"}
COMMAND_TIMEOUT = 30
VM_GIT_USER = "kb-dashboard"
_RAW_HEADER = re.compile(
    rb"\A:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) "
    rb"([0-9a-f]{40}|[0-9a-f]{64}) ([AMD])\Z"
)


def run_git(repo: Path, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    git_argv = ["git", "-c", f"safe.directory={repo}", *args]
    environment = None
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
        git_argv = ["runuser", "--user", VM_GIT_USER, "--", *git_argv]
        environment = {
            "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/var/lib/kb",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
        }
    return subprocess.run(
        git_argv,
        cwd=repo,
        check=check,
        capture_output=True,
        timeout=COMMAND_TIMEOUT,
        env=environment,
    )


def _run_without_check(run, repo: Path, args: list[str]) -> subprocess.CompletedProcess:
    try:
        parameters = inspect.signature(run).parameters.values()
        accepts_check = any(
            parameter.name == "check" or parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters
        )
    except (TypeError, ValueError):
        accepts_check = False
    return run(repo, args, check=False) if accepts_check else run(repo, args)


def _bytes(value: str | bytes | None) -> bytes:
    if value is None:
        return b""
    return value if isinstance(value, bytes) else value.encode("utf-8")


def _text(value: str | bytes | None, label: str = "git output") -> str:
    if isinstance(value, str):
        return value
    try:
        return (value or b"").decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{label} is not UTF-8") from error


def _canonical_json(value: dict) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode("utf-8")


def _read_regular_bytes(path: Path) -> bytes:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if os.name != "nt" and not nofollow:
        raise RuntimeError("O_NOFOLLOW is required")
    descriptor = os.open(path, os.O_RDONLY | nofollow | getattr(os, "O_BINARY", 0))
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError("input must be a regular file")
        chunks = []
        while chunk := os.read(descriptor, 1024 * 1024):
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def parse_closed_json(path: Path, keys: set[str]) -> dict:
    def closed_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError(f"duplicate JSON key: {key}")
            value[key] = item
        return value

    raw = _read_regular_bytes(path)
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=closed_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("closed canonical JSON is required") from error
    if type(value) is not dict or set(value) != keys or raw != _canonical_json(value):
        raise RuntimeError("closed canonical JSON is required")
    return value


def _canonical_utc(value: object, label: str) -> None:
    if type(value) is not str:
        raise RuntimeError(f"{label} time is malformed")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise RuntimeError(f"{label} time is malformed") from error
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        raise RuntimeError(f"{label} time is not canonical UTC")


def _path(raw: bytes) -> str:
    try:
        value = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("changed path is not UTF-8") from error
    if (
        not value
        or PurePosixPath(value).is_absolute()
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or "\\" in value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise RuntimeError("changed path is unsafe")
    return value


def parse_raw_diff(raw: str | bytes) -> tuple[list[tuple[str, str]], list[str]]:
    data = _bytes(raw)
    if not data:
        return [], []
    fields = data.split(b"\0")
    if fields[-1] != b"" or len(fields) % 2 != 1:
        raise RuntimeError("raw Git diff is malformed")
    modes = []
    paths = []
    for index in range(0, len(fields) - 1, 2):
        match = _RAW_HEADER.fullmatch(fields[index])
        if match is None:
            raise RuntimeError("raw Git diff row is malformed")
        path = _path(fields[index + 1])
        if path in paths:
            raise RuntimeError("raw Git diff contains a duplicate path")
        modes.append((match.group(1).decode(), match.group(2).decode()))
        paths.append(path)
    return modes, sorted(paths)


def nul_paths(raw: str | bytes) -> list[str]:
    data = _bytes(raw)
    if not data:
        return []
    fields = data.split(b"\0")
    if fields[-1] != b"":
        raise RuntimeError("NUL-delimited Git paths are malformed")
    paths = [_path(item) for item in fields[:-1]]
    if len(paths) != len(set(paths)):
        raise RuntimeError("Git path list contains a duplicate")
    return sorted(paths)


def validate_snapshot(spool: Path) -> list[dict]:
    import hashlib
    import hmac

    ready = spool / "ready"
    receipts = spool / "receipts"
    if not ready.is_dir() or ready.is_symlink() or not receipts.is_dir() or receipts.is_symlink():
        raise RuntimeError("snapshot directories are absent")
    entries = list(ready.iterdir())
    if any(
        not item.is_file() or item.is_symlink() or item.suffix not in {".json", ".bundle"}
        for item in entries
    ):
        raise RuntimeError("unknown ready artifact")
    manifest_ids = {item.stem for item in entries if item.suffix == ".json"}
    bundle_ids = {item.stem for item in entries if item.suffix == ".bundle"}
    if manifest_ids != bundle_ids:
        raise RuntimeError("manifest and bundle filenames differ")
    manifests = []
    for identity in sorted(manifest_ids):
        manifest = parse_closed_json(ready / f"{identity}.json", MANIFEST_KEYS)
        strings = {"schema", "id", "parent", "commit", "createdAt", "bundleSha256"}
        if any(type(manifest[name]) is not str for name in strings):
            raise RuntimeError("manifest fields are invalid")
        if (
            manifest["schema"] != "kb.ops-outbox/v1"
            or manifest["id"] != identity
            or manifest["commit"] != identity
            or COMMIT_RE.fullmatch(identity) is None
            or COMMIT_RE.fullmatch(manifest["parent"]) is None
        ):
            raise RuntimeError("manifest identity is invalid")
        paths = manifest["paths"]
        if (
            type(paths) is not list
            or not paths
            or any(type(path) is not str for path in paths)
            or paths != sorted(set(paths))
        ):
            raise RuntimeError("manifest paths are invalid")
        for path in paths:
            _path(path.encode("utf-8"))
        _canonical_utc(manifest["createdAt"], "manifest")
        if DIGEST_RE.fullmatch(manifest["bundleSha256"]) is None:
            raise RuntimeError("bundle digest is invalid")
        actual = hashlib.sha256(_read_regular_bytes(ready / f"{identity}.bundle")).hexdigest()
        if not hmac.compare_digest(actual, manifest["bundleSha256"]):
            raise RuntimeError("bundle digest mismatch")
        manifests.append(manifest)
    receipt_entries = list(receipts.iterdir())
    if any(
        not item.is_file()
        or item.is_symlink()
        or item.suffix != ".json"
        or item.stem not in manifest_ids
        for item in receipt_entries
    ):
        raise RuntimeError("orphan or extra receipt")
    return manifests


def order_from_parent(manifests: list[dict], trusted_head: str) -> list[dict]:
    by_parent: dict[str, list[dict]] = {}
    for manifest in manifests:
        by_parent.setdefault(manifest["parent"], []).append(manifest)
    ordered = []
    previous = trusted_head
    seen = set()
    while previous in by_parent:
        children = by_parent[previous]
        if len(children) != 1:
            raise RuntimeError("source manifests fork from a parent")
        manifest = children[0]
        if manifest["commit"] in seen:
            raise RuntimeError("source manifests contain a cycle")
        ordered.append(manifest)
        seen.add(manifest["commit"])
        previous = manifest["commit"]
    if len(ordered) != len(manifests):
        raise RuntimeError("source manifests are not one topological chain")
    return ordered


def write_receipt_durably(target: Path, value: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        if os.name != "nt":
            descriptor = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def read_readiness() -> dict:
    with urllib.request.urlopen("http://127.0.0.1:4317/readyz", timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("dashboard readiness request failed")
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise RuntimeError("dashboard readiness response is too large")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("dashboard readiness response is invalid") from error
    if type(value) is not dict:
        raise RuntimeError("dashboard readiness response is invalid")
    return value


def _validate_source_claims(repo: Path, source_chain: list[dict], run=run_git) -> None:
    for manifest in source_chain:
        row = _text(
            run(repo, ["rev-list", "--parents", "-n", "1", manifest["commit"]]).stdout
        ).strip().split()
        if row != [manifest["commit"], manifest["parent"]]:
            raise RuntimeError("source manifest lineage does not match the VM commit")
        modes, paths = parse_raw_diff(
            run(
                repo,
                ["diff-tree", "--no-commit-id", "--raw", "--no-abbrev", "-r", "-z", manifest["parent"], manifest["commit"]],
            ).stdout
        )
        if paths != manifest["paths"]:
            raise RuntimeError("source manifest paths do not match the VM commit")
        if any(old not in SAFE_CHANGED_MODES or new not in SAFE_CHANGED_MODES for old, new in modes):
            raise RuntimeError("source manifest commit contains an unsafe object mode")
        if any(COORDINATION.fullmatch(path) is None for path in paths):
            raise RuntimeError("source manifest commit contains a non-coordination path")


def apply_reconciliation(
    repo: Path,
    spool: Path,
    bundle: Path,
    returned_receipts: Path,
    expected_source_head: str,
    expected_target_head: str,
    readiness=read_readiness,
    run=run_git,
) -> str:
    if COMMIT_RE.fullmatch(expected_source_head) is None or COMMIT_RE.fullmatch(expected_target_head) is None:
        raise RuntimeError("expected reconciliation head is invalid")
    ready = readiness()
    if not ready.get("quiescent") or ready.get("blockers"):
        raise RuntimeError("ops reconciliation requires quiescent runtime")

    returned_entries = list(returned_receipts.iterdir())
    if any(not source.is_file() or source.is_symlink() or source.suffix != ".json" for source in returned_entries):
        raise RuntimeError("returned receipts contain an unknown artifact")
    for source in sorted(returned_entries):
        receipt = parse_closed_json(source, RECEIPT_KEYS)
        manifest_path = spool / "ready" / source.name
        if not manifest_path.exists():
            raise RuntimeError("returned promotion receipt does not match its manifest")
        manifest = parse_closed_json(manifest_path, MANIFEST_KEYS)
        if (
            any(type(receipt[name]) is not str for name in RECEIPT_KEYS)
            or receipt["schema"] != "kb.ops-promotion/v1"
            or receipt["id"] != manifest.get("id")
            or receipt["sourceCommit"] != manifest.get("commit")
            or COMMIT_RE.fullmatch(receipt["promotedCommit"]) is None
        ):
            raise RuntimeError("returned promotion receipt does not match its manifest")
        _canonical_utc(receipt["promotedAt"], "promotion")
        write_receipt_durably(spool / "receipts" / source.name, receipt)

    pending = [
        path for path in (spool / "ready").glob("*.json")
        if not (spool / "receipts" / path.name).exists()
    ]
    if pending:
        raise RuntimeError("ops reconciliation refused with unreceipted outbox items")
    if _text(run(repo, ["status", "--porcelain"]).stdout).strip():
        raise RuntimeError("ops reconciliation requires a clean checkout")
    head = _text(run(repo, ["rev-parse", "HEAD"]).stdout).strip()
    if head != expected_source_head:
        raise RuntimeError("ops checkout advanced after promotion snapshot")

    manifests = validate_snapshot(spool)
    if not manifests:
        raise RuntimeError("source manifest chain is empty")
    commits = {item["commit"] for item in manifests}
    roots = [item for item in manifests if item["parent"] not in commits]
    if len(roots) != 1:
        raise RuntimeError("source manifests do not have one topological root")
    source_chain = order_from_parent(manifests, roots[0]["parent"])
    if source_chain[-1]["commit"] != head:
        raise RuntimeError("source head is not the validated manifest-chain tip")
    _validate_source_claims(repo, source_chain, run)
    trusted_base = source_chain[0]["parent"]

    run(repo, ["bundle", "verify", str(bundle)])
    advertised = _text(run(repo, ["bundle", "list-heads", str(bundle)]).stdout).splitlines()
    if advertised != [f"{expected_target_head} refs/kb-reconciled/ops"]:
        raise RuntimeError("returned bundle advertised ref mismatch")
    run(repo, ["fetch", "--no-tags", str(bundle), "refs/kb-reconciled/ops:refs/kb-reconciled/incoming"])
    target = _text(run(repo, ["rev-parse", "refs/kb-reconciled/incoming^{commit}"]).stdout).strip()
    if target != expected_target_head:
        raise RuntimeError("returned ref does not equal the trusted desktop target")
    anchor = _text(run(repo, ["rev-parse", "refs/kb-outbox/spooled^{commit}"]).stdout).strip()
    if anchor != head:
        raise RuntimeError("outbox anchor does not equal the source head")
    chain = _text(
        run(repo, ["rev-list", "--reverse", "--parents", f"{trusted_base}..{target}"]).stdout
    ).splitlines()
    previous = trusted_base
    for row in chain:
        fields = row.split()
        if len(fields) != 2 or fields[1] != previous:
            raise RuntimeError("reconciled ops history is not a single-parent chain")
        previous = fields[0]
    if previous != target:
        raise RuntimeError("reconciled target is not descended from the trusted base")
    changed = nul_paths(run(repo, ["diff", "--name-only", "-z", trusted_base, target]).stdout)
    modes, raw_changed = parse_raw_diff(
        run(repo, ["diff", "--raw", "--no-abbrev", "-z", trusted_base, target]).stdout
    )
    if raw_changed != changed or any(
        old not in SAFE_CHANGED_MODES or new not in SAFE_CHANGED_MODES for old, new in modes
    ):
        raise RuntimeError("reconciled ref contains an unsafe object mode")
    if any(COORDINATION.fullmatch(path) is None for path in changed):
        raise RuntimeError("reconciled ref contains a non-coordination path")
    if _run_without_check(run, repo, ["diff", "--quiet", head, target]).returncode != 0:
        raise RuntimeError("promoted target tree differs from VM source chain")
    run(repo, ["branch", f"kb-before-reconcile-{head[:12]}", head])
    run(repo, ["reset", "--hard", target])
    run(repo, ["update-ref", "refs/kb-outbox/spooled", target, anchor])
    return target


def secure_copy(source: Path, destination: Path) -> None:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if os.name != "nt" and not nofollow:
        raise RuntimeError("O_NOFOLLOW is required")
    binary = getattr(os, "O_BINARY", 0)
    source_fd = os.open(source, os.O_RDONLY | nofollow | binary)
    try:
        source_stat = os.fstat(source_fd)
        if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_nlink != 1:
            raise RuntimeError("upload must be one regular file")
        destination_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow | binary,
            0o400,
        )
        try:
            while chunk := os.read(source_fd, 1024 * 1024):
                view = memoryview(chunk)
                while view:
                    written = os.write(destination_fd, view)
                    view = view[written:]
            os.fsync(destination_fd)
        finally:
            os.close(destination_fd)
    finally:
        os.close(source_fd)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply a trusted desktop ops reconciliation bundle")
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--spool", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--receipts", type=Path, required=True)
    parser.add_argument("--expected-source-head", required=True)
    parser.add_argument("--expected-target-head", required=True)
    args = parser.parse_args()
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        raise RuntimeError("ops reconciliation must run as root")

    staging_root = Path(tempfile.mkdtemp(prefix="kb-ops-reconcile-", dir="/var/lib/kb/state"))
    staging_root.chmod(0o700)
    try:
        staged_bundle = staging_root / "ops-return.bundle"
        secure_copy(args.bundle, staged_bundle)
        if os.name != "nt":
            import pwd

            dashboard = pwd.getpwnam(VM_GIT_USER)
            os.chown(staging_root, 0, dashboard.pw_gid)
            staging_root.chmod(0o750)
            os.chown(staged_bundle, 0, dashboard.pw_gid)
            staged_bundle.chmod(0o440)
        staged_receipts = staging_root / "receipts"
        staged_receipts.mkdir(mode=0o700)
        entries = list(args.receipts.iterdir())
        if any(not item.is_file() or item.is_symlink() or item.suffix != ".json" for item in entries):
            raise RuntimeError("receipt upload contains an unknown artifact")
        for source in entries:
            secure_copy(source, staged_receipts / source.name)
        result = apply_reconciliation(
            args.repo,
            args.spool,
            staged_bundle,
            staged_receipts,
            args.expected_source_head,
            args.expected_target_head,
        )
        print(result)
        return 0
    finally:
        for path in staging_root.rglob("*"):
            if path.exists():
                path.chmod(0o700 if path.is_dir() else 0o600)
        shutil.rmtree(staging_root)


if __name__ == "__main__":
    raise SystemExit(main())
