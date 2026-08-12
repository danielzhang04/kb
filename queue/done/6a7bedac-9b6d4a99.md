---
id: 6a7bedac-9b6d4a99
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: d216dd049d5a6ddc
state: done
approval: null
workflow: 019ff416-0daf-7a70-b66e-6e18039bfb37
depends-on: []
variant-group: null
role: work
session-id: 6a7bed10-34f38ec4
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task C5 implementer brief — seed preparation: absoluteness, caps, digests

Arc worktree is your cwd, branch `claude/codex-image-engine`. Exactly ONE task: C5. Pure
local TDD: NO codex calls, NO network, NO commit/push (boss commits). `py -3`.

Rules:
- TDD: failing test first (paste red), implement, paste green. 35 existing tests stay green.
- Files: `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py`
  (extend), `.../test_forge_codex.py` (extend), report
  `.superpowers/sdd/2026-08-11-codex-image-engine/task-C5-report.md`.
- forge.py read-only. AST import-pin: update only with plan authorization, note it in report.
- MEASURED CONTRACT (binds): seed cap is exactly 5 (P1); paths must be ABSOLUTE (real error:
  "AbsolutePathBuf deserialized without a base path" — the fake emits it, tests already pin
  it at fixture level); short ordinal seed labels suffice (P2b — verbosity not protective).

Final message: line 1 `C5 DONE` or `C5 BLOCKED: <why>`; red + green tails; files changed;
deviations/conflicts.

=== PLAN TASK C5 (verbatim) ===
\## Task C5 — seed preparation: absoluteness, caps, digests

Spec §4.5 + §4.7, test case 9. The absoluteness assert costs nothing and the rejection costs a full
cold-process round trip (p1 hard limit 1). Silent truncation is the exact 2026-07-28 failure the
seeding law was written against.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `SeedIntegrityError`, `CODEX_SEED_CAP`, `TRANSPORT_SEED_CEILING`, `CodexContractError`.
- Produces: `prepare_seeds(item: dict, seeds: list[str]) -> list[str]`,
  `seed_digests(seeds: list[str]) -> dict[str, str]`,
  `reverify_seed_digests(name: str, expected: dict[str, str]) -> None`.

**Steps**

- [ ] Add the failing tests:

```python
def _png(path, n=4096):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(n))
    return str(path)


def test_prepare_seeds_requires_absolute_paths_and_realpaths_them():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    out = fc.prepare_seeds({"name": "L29"}, [a])
    assert out == [os.path.realpath(a)] and all(os.path.isabs(p) for p in out)
    raised = None
    try:
        fc.prepare_seeds({"name": "L29"}, ["refs/base/base.png"])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised and "absolute" in raised


def test_prepare_seeds_enforces_transport_ceiling_then_doctrine_cap():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    many = [_png(tmp / f"s{i}.png") for i in range(6)]
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, many)
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "at most 5" in raised
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, many[:5])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "CODEX_SEED_CAP" in raised
    assert "truncat" in raised
    assert len(fc.prepare_seeds({"name": "L33"}, many[:4])) == 4


def test_seed_digests_reverify_raises_seed_integrity_error_on_mutation():
    import forge_codex as fc
    from forge import SeedIntegrityError
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    expected = fc.seed_digests([a])
    fc.reverify_seed_digests("L29", expected)          # unchanged -> silent
    Path(a).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(4096))
    raised = None
    try:
        fc.reverify_seed_digests("L29", expected)
    except SeedIntegrityError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'prepare_seeds'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import hashlib  # noqa: E402


def prepare_seeds(item, seeds):
    """§4.5 + §4.7. Transport ceiling first (server-enforced, p1 probe F), then the doctrine cap."""
    name = item.get("name", "<unnamed>")
    out = []
    for s in seeds or []:
        p = os.path.realpath(str(s))
        if not os.path.isabs(p):
            raise CodexContractError(f"{name}: seed path is not absolute after realpath: {s!r} — "
                                     f"codex rejects relative paths outright "
                                     f"(AbsolutePathBuf deserialized without a base path)")
        out.append(p)
    if len(out) > TRANSPORT_SEED_CEILING:
        raise CodexContractError(f"{name}: {len(out)} seeds — referenced_image_paths must contain "
                                 f"at most {TRANSPORT_SEED_CEILING} paths")
    if len(out) > CODEX_SEED_CAP:
        raise CodexContractError(f"{name}: slate carries {len(out)} seeds, over CODEX_SEED_CAP="
                                 f"{CODEX_SEED_CAP} — refusing to truncate; re-derive the slate "
                                 f"with forge.py batch instead")
    return out


def seed_digests(seeds):
    """sha256 per seed, recorded in the log row so a post-hoc audit can detect a mid-run change."""
    return {p: hashlib.sha256(open(p, "rb").read()).hexdigest() for p in seeds}


def reverify_seed_digests(name, expected):
    """Re-hash immediately before invoking. The TOCTOU window cannot be CLOSED against a path-based
    tool contract (the codex process opens the file at an unknown later moment) — this narrows it
    and the recorded digests make the residual auditable (§4.5, known gap)."""
    for path, digest in (expected or {}).items():
        actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if actual != digest:
            raise SeedIntegrityError(f"{name}: seed SHA-256 changed after preflight: {path}")
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 32 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): seed preparation -- absoluteness, transport ceiling, seed cap, digests"
```

---

## Result

C5 DONE

Red tail:
```text
assert fc.CODEX_SEED_CAP == 5
AssertionError
```

Green tail:
```text
ok  test_seed_digests_reverify_raises_seed_integrity_error_on_mutation
== 38 passed ==
```

Changed:
- [forge_codex.py](C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py)
- [test_forge_codex.py](C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py)
- [task-C5-report.md](C:/Users/danie/kb-worktrees/boss-codex-image-engine/.superpowers/sdd/2026-08-11-codex-image-engine/task-C5-report.md)

Verified `py_compile`, `git diff --check`, and no `forge.py` changes. No commit/push.

Conflict resolved: plan’s cap=4 contradicted the binding measured cap=5; implementation pins 5 and tests the otherwise-shadowed doctrine guard safely. `hashlib` was added under plan authorization; the pinned `from forge import ...` surface was unchanged.
