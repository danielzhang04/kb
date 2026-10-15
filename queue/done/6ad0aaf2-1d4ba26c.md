---
schema-version: 1
id: 6ad0aaf2-1d4ba26c
project: kb-ops
action: cleanup-nested-git-fix
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 2b8a324410b9be19
state: done
approval: null
workflow: 01a13f14-8bd3-7560-a7b6-1c1c9776976b
depends-on: []
variant-group: null
role: work
session-id: 6ad0a900-37079e90
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Worker, not boss. Root preamble passed. Read only C:\Users\danie\kb\CLAUDE.md/governance\agent-rules.md and the following at C:\Users\danie\Projects\Filesystem-Cleanup: scripts/test-nyu-nested-git.py, reviews/claude-nested-git-review.md, reviews/root-nested-git-preexecution.md, briefs/codex-nested-git-fixture-build.txt. No broad KB/home search, originals, coursework, credentials, logs. Read-only tools; NO execution or edits. Candidate SHA40AC21384D6122AE939A0DE2926295C274E2AE30CD5BD7C4D72EC05B5FDD7787 not executed.
Return one apply_patch-format patch fenced as diff targeting ONLY absolute scripts/test-nyu-nested-git.py, then short explanation. Root materializes and independent reviewer validates. Fix all blockers and bounded hardening below; do not grow into production copier.
Required: remove precreated recovery/payload; normalize pointer leading slash/root matches; bound pointer reads BEFOREread; correct relative alternates object-dirbase + add relativeescape negative. Add -I -B all Pythonchildren, no-reparse checks cold root and leaf manifests/payload before reads; validate manifest relativepaths reject colons/absolute/..//duplicates casefold/device names and types, nofollow roots before isdir. Parent passes manifest hash independently to child (fifth argument after mode/run/scriptHash; adjust all callers), verify before anyoutputcreate and preserve exact expected tamper reason test. Explicit empty Git templates, ceiling, protocol.allow=never,gc.auto=0,maintenance.auto=false. Use os.lstat for nonzeroIDs; compare nested HEADref to oracle and outer untracked nested marker; shallow/local-only/source-read claims weakened to proven-byconstruction/markerbytes where appropriate. Record Git exe shim/transitive binary limits rather than pretend fullidentitychain. Prefer explicit known C:\Program Files\Git\cmd\git.exe (root confirmed2.51.0.windows.1), validate nonreparsechain and hash; no localcwd PATHprecedence.
Process output bound DURING execution using monotonic polling of retained stdout/stderr sizes before reading; bounded process tree termination via knownSystem32taskkill /PID ownproc.pid /T /F on timeout oroverflow; no genericprocesskill. Preserve stdout/stderr and failure evidence; no deletions. Bound parent outer run stillrootwatchdog. Add failure JSON path/runroot safelyifcreated, CreateNew. Rename report cold_child_watchdogs to child_watchdogs. Ensure all safetyclaims honest syntheticonly, no hostileconcurrentmutationguarantee. Report fixture refusal/proof not live readymove. Keep changes focused; no tests executed. Return patch only plus notes, not full900linefile.

## Result

```diff
*** Begin Patch
*** Update File: C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-nested-git.py
@@
 import shutil
 import stat
 import subprocess
 import sys
+import time
 import uuid
 from pathlib import Path, PurePosixPath
 from typing import Any
 
 PROJECT = Path(r"C:\Users\danie\Projects\Filesystem-Cleanup")
 FIXTURES = PROJECT / "fixtures"
+GIT_EXE = Path(r"C:\Program Files\Git\cmd\git.exe")
+TASKKILL_EXE = Path(r"C:\Windows\System32\taskkill.exe")
 RUN_RE = re.compile(r"nyu-git-[0-9a-f]{32}\Z")
+DEVICE_RE = re.compile(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?\Z", re.I)
 REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
 MAX_POINTER = 4096
+MAX_MANIFEST = 32 * 1024 * 1024
 MAX_OUTPUT = 1_000_000
 TIMEOUT = 30
 checks: list[dict[str, Any]] = []
 watchdogs: list[dict[str, Any]] = []
 command_counter = 0
+active_run_root: Path | None = None
@@
 class Refusal(RuntimeError):
     pass
 
 
+def lstat_regular(path: Path, label: str) -> os.stat_result:
+    try:
+        st = os.lstat(path)
+    except OSError as exc:
+        raise Refusal(f"{label} is unavailable: {path}: {exc}") from exc
+    if (not stat.S_ISREG(st.st_mode)
+            or getattr(st, "st_file_attributes", 0) & REPARSE):
+        raise Refusal(f"{label} is not a non-reparse regular file: {path}")
+    return st
+
+
 def sha256_file(path: Path) -> str:
+    lstat_regular(path, "hash input")
     h = hashlib.sha256()
     with path.open("rb") as f:
         while block := f.read(1024 * 1024):
             h.update(block)
@@
 def no_reparse_existing_chain(path: Path) -> None:
@@
         if getattr(st, "st_file_attributes", 0) & REPARSE:
             raise Refusal(f"reparse ancestor refused: {current}")
 
 
+def require_nonreparse_dir(path: Path, label: str) -> None:
+    no_reparse_existing_chain(path)
+    try:
+        st = os.lstat(path)
+    except OSError as exc:
+        raise Refusal(f"{label} is unavailable: {path}: {exc}") from exc
+    if not stat.S_ISDIR(st.st_mode) or is_reparse(st):
+        raise Refusal(f"{label} is not a non-reparse directory: {path}")
+
+
+def read_regular_bounded(
+    path: Path, limit: int, label: str
+) -> tuple[bytes, os.stat_result]:
+    no_reparse_existing_chain(path)
+    st = lstat_regular(path, label)
+    if st.st_size > limit:
+        raise Refusal(f"oversized {label}: {path}")
+    with path.open("rb") as f:
+        data = f.read(limit + 1)
+    if len(data) > limit:
+        raise Refusal(f"oversized {label}: {path}")
+    return data, st
+
+
 def safe_run_root(name: str) -> Path:
@@
 def snapshot(root: Path) -> dict[str, dict[str, Any]]:
-    if not root.is_dir():
-        raise Refusal(f"snapshot root missing: {root}")
+    require_nonreparse_dir(root, "snapshot root")
     out: dict[str, dict[str, Any]] = {}
@@
         with os.scandir(directory) as iterator:
             entries = sorted(iterator, key=lambda e: e.name)
         for entry in entries:
-            st = entry.stat(follow_symlinks=False)
+            st = os.lstat(entry.path)
             if is_reparse(st) or entry.is_symlink():
                 raise Refusal(f"reparse entry refused: {entry.path}")
@@
 def validate_manifest_schema(manifest: dict[str, Any]) -> None:
+    if not isinstance(manifest, dict):
+        raise Refusal("manifest is not an object")
     if set(manifest) != {"version", "coverage", "entries"}:
         raise Refusal("unexpected manifest fields")
-    if manifest["version"] != 1 or not isinstance(manifest["entries"], list):
+    if (type(manifest["version"]) is not int or manifest["version"] != 1
+            or manifest["coverage"]
+            != "regular-files-and-directories-bytes-only"
+            or not isinstance(manifest["entries"], list)):
         raise Refusal("unsupported manifest")
     seen: set[str] = set()
     for item in manifest["entries"]:
-        allowed = {"path", "kind"} if item.get("kind") == "dir" else {
-            "path", "kind", "size", "sha256"
-        }
+        if not isinstance(item, dict):
+            raise Refusal("manifest entry is not an object")
+        kind = item.get("kind")
+        if kind not in {"dir", "file"}:
+            raise Refusal("unsupported manifest entry kind")
+        allowed = ({"path", "kind"} if kind == "dir" else
+                   {"path", "kind", "size", "sha256"})
         if set(item) != allowed:
             raise Refusal("malformed manifest entry")
         rel = item["path"]
+        if not isinstance(rel, str):
+            raise Refusal("manifest path is not a string")
         pure = PurePosixPath(rel)
-        if (not isinstance(rel, str) or not rel or pure.is_absolute()
-                or ".." in pure.parts or "\\" in rel or rel in seen):
+        components = rel.split("/")
+        folded = rel.casefold()
+        if (not rel or rel.startswith("/") or pure.is_absolute()
+                or ":" in rel or "\\" in rel or "//" in rel
+                or any(part in {"", ".", ".."} for part in components)
+                or pure.as_posix() != rel or folded in seen
+                or any(part.endswith((" ", ".")) for part in components)
+                or any(DEVICE_RE.fullmatch(part) for part in components)):
             raise Refusal("unsafe or duplicate manifest path")
-        if item["kind"] not in {"dir", "file"}:
-            raise Refusal("unsupported manifest entry kind")
-        seen.add(rel)
+        if kind == "file":
+            if (type(item["size"]) is not int or item["size"] < 0
+                    or not isinstance(item["sha256"], str)
+                    or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
+                raise Refusal("invalid manifest file metadata")
+        seen.add(folded)
@@
 def write_recovery(source: Path, recovery: Path, root: Path) -> dict[str, Any]:
@@
     manifest = portable_manifest(snap)
     mkdir_new(recovery, root)
     payload = recovery / "payload"
-    mkdir_new(payload, root)
     restore_from_manifest(source, payload, manifest, root)
@@
-def load_valid_recovery(recovery: Path) -> tuple[dict[str, Any], Path]:
+def load_valid_recovery(
+    recovery: Path, expected_manifest_hash: str
+) -> tuple[dict[str, Any], Path]:
+    require_nonreparse_dir(recovery, "recovery root")
     manifest_path = recovery / "manifest.json"
     digest_path = recovery / "manifest.sha256"
-    if not manifest_path.is_file() or not digest_path.is_file():
-        raise Refusal("recovery manifest is incomplete")
-    manifest_bytes = manifest_path.read_bytes()
-    expected = digest_path.read_text("ascii").strip()
+    manifest_bytes, _ = read_regular_bounded(
+        manifest_path, MAX_MANIFEST, "manifest"
+    )
+    digest_bytes, _ = read_regular_bounded(
+        digest_path, 65, "manifest digest"
+    )
+    actual_hash = hashlib.sha256(manifest_bytes).hexdigest()
+    if actual_hash != expected_manifest_hash:
+        raise Refusal("manifest does not match parent-pinned digest")
+    try:
+        expected = digest_bytes.decode("ascii").strip()
+    except UnicodeDecodeError as exc:
+        raise Refusal("invalid manifest digest") from exc
     if not re.fullmatch(r"[0-9a-f]{64}", expected):
         raise Refusal("invalid manifest digest")
-    if hashlib.sha256(manifest_bytes).hexdigest() != expected:
+    if actual_hash != expected:
         raise Refusal("manifest digest mismatch")
-    manifest = json.loads(manifest_bytes)
-    compare_to_manifest(recovery / "payload", manifest)
-    return manifest, recovery / "payload"
+    try:
+        manifest = json.loads(manifest_bytes)
+    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
+        raise Refusal("invalid manifest JSON") from exc
+    payload = recovery / "payload"
+    require_nonreparse_dir(payload, "recovery payload")
+    compare_to_manifest(payload, manifest)
+    return manifest, payload
@@
 def restore_from_manifest(
@@
 ) -> None:
     validate_manifest_schema(manifest)
+    require_nonreparse_dir(source, "restore source")
     if os.path.lexists(destination):
         raise Refusal(f"occupied destination: {destination}")
@@
         src = source.joinpath(*parts)
         dst = destination.joinpath(*parts)
         guarded(src, run_root)
         guarded(dst, run_root)
-        if not src.is_file():
-            raise Refusal(f"manifest source missing: {item['path']}")
+        src_st = lstat_regular(src, "manifest source")
+        if src_st.st_size != item["size"]:
+            raise Refusal(f"manifest source size mismatch: {item['path']}")
         with src.open("rb") as inf, dst.open("xb") as outf:
             shutil.copyfileobj(inf, outf, 1024 * 1024)
-        if dst.stat().st_size != item["size"] or sha256_file(dst) != item["sha256"]:
+        dst_st = lstat_regular(dst, "restored file")
+        if dst_st.st_size != item["size"] or sha256_file(dst) != item["sha256"]:
             raise Refusal(f"restored file verification failed: {item['path']}")
@@
     xdg = run_root / "isolated-xdg"
     hooks = run_root / "empty-hooks"
-    for directory in (temp, home, xdg, hooks):
+    template = run_root / "empty-template"
+    for directory in (temp, home, xdg, hooks, template):
         directory.mkdir(exist_ok=True)
@@
         "GIT_CONFIG_SYSTEM": str(system_cfg),
+        "GIT_CEILING_DIRECTORIES": str(run_root),
         "GIT_TERMINAL_PROMPT": "0",
@@
     return env
 
 
+def terminate_owned_tree(proc: subprocess.Popen[bytes]) -> dict[str, Any]:
+    no_reparse_existing_chain(TASKKILL_EXE)
+    lstat_regular(TASKKILL_EXE, "taskkill executable")
+    try:
+        result = subprocess.run(
+            [
+                str(TASKKILL_EXE), "/PID", str(proc.pid), "/T", "/F",
+            ],
+            stdin=subprocess.DEVNULL,
+            stdout=subprocess.DEVNULL,
+            stderr=subprocess.DEVNULL,
+            shell=False,
+            timeout=5,
+            check=False,
+        )
+        taskkill_code: int | None = result.returncode
+        taskkill_error: str | None = None
+    except (OSError, subprocess.TimeoutExpired) as exc:
+        taskkill_code = None
+        taskkill_error = f"{type(exc).__name__}: {exc}"
+    try:
+        proc.wait(timeout=5)
+    except subprocess.TimeoutExpired:
+        pass
+    return {
+        "taskkill_returncode": taskkill_code,
+        "taskkill_error": taskkill_error,
+        "tree_exit_observed": proc.poll() is not None,
+    }
+
+
+def read_retained_output(path: Path) -> bytes:
+    data, _ = read_regular_bounded(path, MAX_OUTPUT, "retained child output")
+    return data
+
+
 def run_bounded(
     argv: list[str], cwd: Path, env: dict[str, str], logs: Path,
-    expected: set[int] = {0},
+    expected: set[int] | frozenset[int] = frozenset({0}),
 ) -> tuple[int, bytes, bytes]:
@@
     stdout_path = logs / f"{stem}.stdout"
     stderr_path = logs / f"{stem}.stderr"
-    with stdout_path.open("xb") as out, stderr_path.open("xb") as err:
+    out = stdout_path.open("xb")
+    err = stderr_path.open("xb")
+    proc: subprocess.Popen[bytes] | None = None
+    timed_out = False
+    overflow = False
+    termination: dict[str, Any] | None = None
+    try:
         proc = subprocess.Popen(
             argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
             stdout=out, stderr=err, shell=False,
         )
-        timed_out = False
-        try:
-            code = proc.wait(timeout=TIMEOUT)
-        except subprocess.TimeoutExpired:
-            timed_out = True
-            proc.kill()
-            code = proc.wait(timeout=5)
-    stdout = stdout_path.read_bytes()
-    stderr = stderr_path.read_bytes()
+        deadline = time.monotonic() + TIMEOUT
+        while True:
+            stdout_size = os.fstat(out.fileno()).st_size
+            stderr_size = os.fstat(err.fileno()).st_size
+            if stdout_size > MAX_OUTPUT or stderr_size > MAX_OUTPUT:
+                overflow = True
+                termination = terminate_owned_tree(proc)
+                break
+            code = proc.poll()
+            if code is not None:
+                break
+            if time.monotonic() >= deadline:
+                timed_out = True
+                termination = terminate_owned_tree(proc)
+                break
+            time.sleep(0.05)
+        if proc.poll() is None:
+            code = None
+        else:
+            code = proc.returncode
+    finally:
+        out.close()
+        err.close()
+
+    stdout_size = lstat_regular(stdout_path, "stdout log").st_size
+    stderr_size = lstat_regular(stderr_path, "stderr log").st_size
     watchdogs.append({
         "argv0": argv[0],
         "timeout": timed_out,
+        "output_overflow": overflow,
         "returncode": code,
-        "stdout_bytes": len(stdout),
-        "stderr_bytes": len(stderr),
+        "stdout_bytes": stdout_size,
+        "stderr_bytes": stderr_size,
+        "termination": termination,
     })
     if timed_out:
         raise Refusal(f"child timeout: {argv[0]}")
-    if len(stdout) > MAX_OUTPUT or len(stderr) > MAX_OUTPUT:
+    if overflow:
         raise Refusal(f"child output limit exceeded: {argv[0]}")
+    if code is None:
+        raise Refusal(f"child tree termination was not observed: {argv[0]}")
+    stdout = read_retained_output(stdout_path)
+    stderr = read_retained_output(stderr_path)
     if code not in expected:
@@
 def git_args(git: Path, run_root: Path, repo: Path, *args: str) -> list[str]:
     hooks = (run_root / "empty-hooks").as_posix()
+    template = (run_root / "empty-template").as_posix()
     return [
         str(git), "-C", str(repo),
         "-c", f"core.hooksPath={hooks}",
+        "-c", f"init.templateDir={template}",
         "-c", "core.fsmonitor=false",
         "-c", "core.untrackedCache=false",
         "-c", "core.autocrlf=false",
         "-c", "commit.gpgSign=false",
+        "-c", "protocol.allow=never",
+        "-c", "gc.auto=0",
+        "-c", "maintenance.auto=false",
         *args,
     ]
@@
     outer = source / "outer"
     outer.mkdir()
     git_run(git, run_root, outer, env, logs,
-            "init", "--object-format=sha1", "-b", "local-ahead")
+            "init", f"--template={(run_root / 'empty-template').as_posix()}",
+            "--object-format=sha1", "-b", "local-ahead")
@@
     nested = outer / "nested"
     nested.mkdir()
     git_run(git, run_root, nested, env, logs,
-            "init", "--object-format=sha1", "-b", "nested-main")
+            "init", f"--template={(run_root / 'empty-template').as_posix()}",
+            "--object-format=sha1", "-b", "nested-main")
@@
 def scan_external_git_pointers(root: Path) -> list[dict[str, str]]:
@@
         if item["kind"] != "file":
             continue
         path = root.joinpath(*PurePosixPath(rel).parts)
-        lower = rel.lower()
+        lower = "/" + rel.lower()
         spec: tuple[str, Path] | None = None
+        if item["size"] > MAX_POINTER:
+            raise Refusal(f"oversized pointer: {rel}")
         if PurePosixPath(lower).name == ".git":
-            data = path.read_bytes()
-            if len(data) > MAX_POINTER:
-                raise Refusal(f"oversized .git pointer: {rel}")
+            data, _ = read_regular_bounded(path, MAX_POINTER, ".git pointer")
             line = data.decode("utf-8", "strict").strip()
             if not line.lower().startswith("gitdir:"):
                 raise Refusal(f"malformed .git pointer: {rel}")
             spec = ("gitdir", path.parent)
             value = line.split(":", 1)[1]
         elif lower.endswith("/.git/commondir"):
-            spec, value = ("commondir", path.parent), path.read_text("utf-8")
+            data, _ = read_regular_bounded(path, MAX_POINTER, "commondir pointer")
+            spec, value = ("commondir", path.parent), data.decode("utf-8")
         elif lower.endswith("/.git/objects/info/alternates"):
-            spec, value = ("alternates", path.parent), path.read_text("utf-8")
+            data, _ = read_regular_bounded(path, MAX_POINTER, "alternates pointer")
+            spec, value = ("alternates", path.parent.parent), data.decode("utf-8")
         elif "/.git/worktrees/" in lower and lower.endswith("/gitdir"):
-            spec, value = ("worktree-gitdir", path.parent), path.read_text("utf-8")
+            data, _ = read_regular_bounded(
+                path, MAX_POINTER, "worktree gitdir pointer"
+            )
+            spec, value = ("worktree-gitdir", path.parent), data.decode("utf-8")
         else:
             continue
-        if path.stat().st_size > MAX_POINTER:
-            raise Refusal(f"oversized pointer: {rel}")
         for line in value.splitlines() or [value]:
@@
         "alternates/.git/objects/info/alternates":
             b"C:/probe-external/objects\n",
+        "relative-alternates/.git/objects/info/alternates":
+            b"../../../relative-escape\n",
         "worktree/.git/worktrees/w1/gitdir":
@@
     for config in (
         analysis / "outer/.git/config",
         analysis / "outer/nested/.git/config",
     ):
-        if not config.is_file():
-            raise Refusal(f"analysis config missing: {config}")
+        no_reparse_existing_chain(config)
+        lstat_regular(config, "analysis config")
         with config.open("wb") as f:
@@
     head = (outer / ".git/HEAD").read_text("ascii").strip()
     head_oid = (outer / ".git/refs/heads/local-ahead").read_text().strip()
     base_oid = (outer / ".git/refs/heads/base").read_text().strip()
     stash_oid = (outer / ".git/refs/stash").read_text().strip()
+    nested_head = (nested / ".git/HEAD").read_text("ascii").strip()
+    nested_oid = (
+        nested / ".git/refs/heads/nested-main"
+    ).read_text("ascii").strip()
@@
     if (head_oid != expected["head_oid"] or base_oid != expected["base_oid"]
             or stash_oid != expected["stash_oid"] or head_oid == base_oid):
         raise Refusal("HEAD/base/local-only/stash ref mismatch")
+    if (nested_head != "ref: refs/heads/nested-main"
+            or nested_oid != expected["nested_oid"]):
+        raise Refusal("nested HEAD/ref mismatch")
@@
-    if "untracked.txt" not in others or "ignored.txt" not in ignored:
+    if ("untracked.txt" not in others or "ignored.txt" not in ignored
+            or "nested/" not in others):
         raise Refusal("untracked/ignored classification mismatch")
@@
         "head": head_oid,
         "base_ref": base_oid,
-        "local_only_commit_preserved": head_oid != base_oid,
+        "local_only_commit_bytes_preserved_by_fixture_construction":
+            head_oid == expected["head_oid"] and head_oid != base_oid,
+        "nested_head": nested_head,
+        "nested_ref": nested_oid,
+        "outer_untracked_nested_marker": "nested/",
         "stash_ref": stash_oid,
@@
             "outer": {
                 "oid": outer_shallow,
-                "classification": "preserved local shallow-history boundary; "
-                                  "not proof of complete remote history",
+                "classification": "synthetic shallow marker bytes preserved; "
+                                  "Git shallow semantics were not exercised",
             },
             "nested": {
                 "oid": nested_shallow,
-                "classification": "preserved local shallow-history boundary; "
-                                  "not proof of complete remote history",
+                "classification": "synthetic shallow marker bytes preserved; "
+                                  "Git shallow semantics were not exercised",
@@
-def cold_main(mode: str, run_name: str, expected_script_hash: str) -> int:
+def cold_main(
+    mode: str, run_name: str, expected_script_hash: str,
+    expected_manifest_hash: str,
+) -> int:
     root = safe_run_root(run_name)
-    if not root.is_dir():
+    try:
+        require_nonreparse_dir(root, "cold run root")
+    except Refusal:
         return 2
+    if not re.fullmatch(r"[0-9a-f]{64}", expected_manifest_hash):
+        return 2
     if sha256_file(Path(__file__).absolute()) != expected_script_hash:
@@
     destination = root / destination_name
 
     try:
-        manifest, payload = load_valid_recovery(recovery)
+        manifest, payload = load_valid_recovery(
+            recovery, expected_manifest_hash
+        )
         if os.path.lexists(destination):
             return 4
@@
             "status": "PASS",
             "mode": mode,
-            "source_fixture_reads": 0,
+            "source_fixture_reads": {
+                "value": 0,
+                "basis": "cold-child code path by construction; "
+                         "not an OS access audit",
+            },
@@
 def parent_main() -> int:
+    global active_run_root
     script = Path(__file__).absolute()
@@
     no_reparse_existing_chain(FIXTURES)
-    if not FIXTURES.is_dir():
-        raise Refusal("fixed fixtures ancestor is missing")
+    require_nonreparse_dir(FIXTURES, "fixed fixtures ancestor")
 
-    git_found = shutil.which("git.exe")
-    if not git_found:
-        raise Refusal("git.exe not found on PATH")
-    git = Path(os.path.abspath(git_found))
-    gst = os.lstat(git)
-    if not stat.S_ISREG(gst.st_mode) or is_reparse(gst):
-        raise Refusal("git.exe is not a non-reparse regular file")
+    git = GIT_EXE
+    no_reparse_existing_chain(git)
+    gst = lstat_regular(git, "git executable")
+    git_hash_before = sha256_file(git)
 
     run_name = "nyu-git-" + uuid.uuid4().hex
     run_root = safe_run_root(run_name)
     os.mkdir(run_root)  # atomic CreateNew fixture root
+    active_run_root = run_root
@@
     _, version_out, _ = run_bounded(
         [str(git), "--version"], run_root, env, logs
     )
+    git_version = version_out.decode("ascii", "replace").strip()
+    if git_version != "git version 2.51.0.windows.1":
+        raise Refusal(f"unexpected Git version: {git_version}")
+    git_hash_after = sha256_file(git)
+    if git_hash_after != git_hash_before:
+        raise Refusal("git.exe changed during identity validation")
     git_identity = {
         "path": str(git),
-        "version": version_out.decode("ascii", "replace").strip(),
-        "sha256": sha256_file(git),
+        "version": git_version,
+        "sha256": git_hash_before,
         "size": gst.st_size,
         "mtime_ns": gst.st_mtime_ns,
+        "identity_scope": "Git for Windows cmd/git.exe launcher shim only",
+        "transitive_binary_limit": "DLLs, helper programs and the transitive "
+                                   "Git binary chain are not identity-pinned",
+        "path_lookup": "launcher selected by fixed absolute path, not cwd/PATH",
@@
     manifest = write_recovery(
         source, run_root / "recovery", run_root
     )
+    manifest_hash = sha256_file(run_root / "recovery/manifest.json")
@@
     python_argv = [
-        sys.executable, str(script), "--cold", run_name, script_hash_before
+        sys.executable, "-I", "-B", str(script), "--cold", run_name,
+        script_hash_before, manifest_hash,
@@
     _, occupied_out, _ = run_bounded(
-        [sys.executable, str(script), "--cold-occupied",
-         run_name, script_hash_before],
+        [sys.executable, "-I", "-B", str(script), "--cold-occupied",
+         run_name, script_hash_before, manifest_hash],
@@
     _, tamper_out, _ = run_bounded(
-        [sys.executable, str(script), "--cold-tamper",
-         run_name, script_hash_before],
+        [sys.executable, "-I", "-B", str(script), "--cold-tamper",
+         run_name, script_hash_before, manifest_hash],
         run_root, env, logs, expected={3},
     )
+    tamper_report = json.loads(tamper_out)
     add_check(
         "negative.tamper-refused-before-output-creation",
-        "PASS" if not os.path.lexists(run_root / "tamper-restore-env")
-        else "FAIL",
-        json.loads(tamper_out),
+        "PASS" if (
+            not os.path.lexists(run_root / "tamper-restore-env")
+            and tamper_report.get("reason")
+            == "payload entry set or file bytes do not match manifest"
+        ) else "FAIL",
+        tamper_report,
@@
     add_check(
         "coverage.remote-history",
         "UNKNOWN",
-        "Shallow markers preserve local shallow state; this probe does not "
-        "claim complete remote history.",
+        "Only synthetic shallow-marker bytes are preserved. Git shallow "
+        "semantics and complete remote history are not proven.",
@@
         "Git commands are allow-listed, sanitized, noninteractive and bounded; "
         "this small probe does not install an OS-level child/network sandbox.",
     )
+    add_check(
+        "coverage.concurrent-mutation",
+        "UNKNOWN",
+        "The synthetic fixture is single-writer by construction; no guarantee "
+        "is made against hostile concurrent mutation or path replacement.",
+    )
@@
-        "cold_child_watchdogs": watchdogs,
+        "child_watchdogs": watchdogs,
         "checks": checks,
@@
         "original_synthetic_source_unchanged": source_before == source_final,
         "no_live_root_capture_or_move_authorized": True,
+        "outer_root_watchdog_required": True,
+        "proof_disposition": "synthetic fixture refusal/proof only; this does "
+                             "not establish that a live move is ready",
+        "live_move_ready": False,
@@
 def main() -> int:
-    if len(sys.argv) == 4 and sys.argv[1].startswith("--cold"):
-        return cold_main(sys.argv[1], sys.argv[2], sys.argv[3])
+    if len(sys.argv) == 5 and sys.argv[1].startswith("--cold"):
+        return cold_main(
+            sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
+        )
@@
         failure = {
             "status": "FAIL",
             "scope": "synthetic nested-Git byte/state recovery proof only",
@@
             "fixtures_retained": True,
             "no_live_root_capture_or_move_authorized": True,
+            "outer_root_watchdog_required": True,
+            "proof_disposition": "synthetic fixture refusal/proof only; this "
+                                 "does not establish live-move readiness",
+            "run_root": str(active_run_root) if active_run_root else None,
         }
+        if active_run_root is not None and os.path.lexists(active_run_root):
+            try:
+                require_nonreparse_dir(active_run_root, "failure run root")
+                failure_path = (
+                    active_run_root /
+                    f"failure-{uuid.uuid4().hex}.json"
+                )
+                failure["failure_report_path"] = str(failure_path)
+                failure_bytes = (
+                    json.dumps(failure, indent=2, sort_keys=True) + "\n"
+                ).encode()
+                put_new(failure_path, failure_bytes, active_run_root)
+            except Exception as report_exc:
+                failure["failure_report_write_error"] = (
+                    f"{type(report_exc).__name__}: {report_exc}"
+                )
         print(json.dumps(failure, indent=2, sort_keys=True))
*** End Patch
```

This addresses the execution blockers and bounded hardening without extending the script into a production copier. No tests or project code were executed, and the candidate hash was not validated or run.
