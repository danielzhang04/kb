---
schema-version: 1
id: 6a99ce0e-42effed6
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p5
risk-tier: T1
owner: codex-worker
claim-token: 1019348f75267cf5
state: done
approval: null
workflow: 01a068ca-7b2c-7653-873b-c5ed9d4fb524
depends-on: []
variant-group: null
role: work
session-id: 6a99cd65-c4727a41
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a READ-ONLY codex reviewer in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p5`. Run
`python scripts/preamble.py` once. No writes. Deliver as final message. Stop at 25 minutes.
Never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/; no repo-wide grep.

\# Review brief — Task 2

\## READ BUDGET
- The task text below (authoritative). - The files it says it creates/modifies (read fully).
- `git diff --stat HEAD` and `git diff HEAD` limited to those files. - `pytest.ini`.

\## Task text
\## Task 2: Write one PII-free local-outbox card per stage

**Files:** Create `scripts/prospecting/manager/jobs.py`, `scripts/prospecting/tests/test_jobs.py`; modify none.

**Interfaces:** `StageJob` contains only workflow/run/stage/card IDs, owner, dependencies,
`policy_id`, `policy_hash`, opaque input IDs/hashes, integer counts, and acceptance criteria. No
policy object crosses to a VM card. `write_card(job, outbox, repo_root=Path.cwd()) -> Path` resolves
and canonicalizes the repository root, its `queue/` tree, the outbox, and final target; it rejects
absolute, relative, `..`, junction, and symlink routes into repository `queue/`. `parse_card(path)`
parses and validates the emitted frontmatter and work-order JSON before success. `assert_vm_safe`
walks filename, structured values, rendered body, and parsed round-trip before the atomic write.

- [ ] **Step 1 — Write the failing card and whole-field guard tests.**

```python
\# scripts/prospecting/tests/test_jobs.py
from pathlib import Path
import pytest
from scripts.prospecting.manager.jobs import StageJob, parse_card, write_card

def job(**changes):
    value = dict(card_id="01testcard0000000000000000", project="prospecting", workflow="run-1",
      stage="list", owner="prospecting-list-builder", depends_on=(), policy_id="policy-1",
      policy_hash="a"*64, input_ids=("campaign-1",), input_hashes=("b"*64,),
      counts={"requested":20}, acceptance=("summary_schema_valid", "no_pii"))
    value.update(changes); return StageJob(**value)

def test_card_uses_schema_and_local_outbox(tmp_path: Path) -> None:
    path = write_card(job(), tmp_path / "outbox")
    value = parse_card(path)
    assert value["frontmatter"]["owner"] == "prospecting-list-builder"
    assert value["work_order"]["input_ids"] == ["campaign-1"]
    assert set(value["work_order"]) == {"stage","policy_id","policy_hash","input_ids","input_hashes","counts","acceptance_criteria"}

UNSAFE_FIELDS = [
    ("input_ids", ("person@example.test",)), ("policy_id", "Synthetic Person"),
    ("counts", {"note":"call +1 212 555 0100"}), ("acceptance", ("visit linkedin.com/in/synthetic",)),
]
def test_every_card_field_is_guarded(tmp_path: Path) -> None:
    for field, value in UNSAFE_FIELDS:
        with pytest.raises(Exception): write_card(job(**{field:value}), tmp_path / "outbox")

def test_absolute_and_traversal_queue_targets_are_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"; (repo / "queue/inbox").mkdir(parents=True)
    outside = tmp_path / "outside"; outside.mkdir()
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), repo / "queue/inbox", repo_root=repo)
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), outside / ".." / "repo" / "queue" / "inbox", repo_root=repo)

def test_symlink_into_queue_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"; (repo / "queue/inbox").mkdir(parents=True)
    link = tmp_path / "outbox-link"
    try: link.symlink_to(repo / "queue/inbox", target_is_directory=True)
    except OSError: pytest.skip("symlink privilege unavailable")
    with pytest.raises(ValueError, match="coordination_outbox_forbidden"):
        write_card(job(), link, repo_root=repo)

def test_raw_ask_name_cannot_flow_to_card(tmp_path: Path) -> None:
    with pytest.raises(Exception): write_card(job(policy_id="Fixture Person"), tmp_path / "outbox")
    assert not list((tmp_path / "outbox").glob("*.md"))
```

- [ ] **Step 2 — Run and confirm the failure.** Run `py -3 -m pytest scripts/prospecting/tests/test_jobs.py -q -p no:cacheprovider`; expect missing `jobs` module.

```text
py -3 -m pytest scripts/prospecting/tests/test_jobs.py -q -p no:cacheprovider
EXPECTED: ModuleNotFoundError: scripts.prospecting.manager.jobs
```

- [ ] **Step 3 — Implement the immutable job/card writer.**

```python
\# scripts/prospecting/manager/jobs.py
from __future__ import annotations
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
from scripts.prospecting.pii_guard import assert_vm_safe

OPAQUE=re.compile(r"^[a-z0-9][a-z0-9-]{1,127}$")
HASH=re.compile(r"^[0-9a-f]{64}$")

@dataclass(frozen=True)
class StageJob:
    card_id: str; project: str; workflow: str; stage: str; owner: str
    depends_on: tuple[str, ...]; policy_id: str; policy_hash: str; input_ids: tuple[str, ...]
    input_hashes: tuple[str, ...]
    counts: dict[str, int]; acceptance: tuple[str, ...]

def _inside(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents

def parse_card(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    _, header, body = text.split("---", 2)
    marker = "## Work order\n\n"
    work = body.split(marker, 1)[1].split("\n\n## Evidence", 1)[0]
    value = {"frontmatter":json.loads(header), "work_order":json.loads(work)}
    required = {"id","project","action","target","risk-tier","owner","state","workflow","depends-on","role"}
    if not required <= set(value["frontmatter"]): raise ValueError("invalid_card_schema")
    return value

def write_card(job: StageJob, outbox: Path, repo_root: Path = Path.cwd()) -> Path:
    repo = repo_root.resolve(strict=True); queue = (repo / "queue").resolve(strict=False)
    target_dir = outbox.resolve(strict=False)
    if _inside(target_dir, queue):
        raise ValueError("coordination_outbox_forbidden")
    payload = asdict(job)
    ids=(job.card_id,job.project,job.workflow,job.stage,job.owner,job.policy_id,*job.depends_on,*job.input_ids)
    if not all(OPAQUE.fullmatch(value) for value in ids): raise ValueError("non_opaque_identifier")
    if not HASH.fullmatch(job.policy_hash) or not all(HASH.fullmatch(value) for value in job.input_hashes): raise ValueError("invalid_hash")
    if not all(type(value) is int and value >= 0 for value in job.counts.values()): raise ValueError("invalid_count")
    assert_vm_safe(payload, "card")
    header = {"id":job.card_id,"project":job.project,"action":f"run-{job.stage}",
      "target":"desktop-prospecting-store","risk-tier":"T2","owner":job.owner,
      "claim-token":None,"state":"inbox","approval":None,"workflow":job.workflow,
      "depends-on":list(job.depends_on),"role":"inspect" if job.owner == "inspector" else "work",
      "runtime":None,"model":None,"execution-controller":"terminal"}
    work = {"stage":job.stage,"policy_id":job.policy_id,"policy_hash":job.policy_hash,
      "input_ids":list(job.input_ids),"input_hashes":list(job.input_hashes),
      "counts":job.counts,"acceptance_criteria":list(job.acceptance)}
    text = f'''---
{json.dumps(header, sort_keys=True, separators=(",", ":"))}
---

\## Work order

{json.dumps(work, sort_keys=True, separators=(",", ":"))}

\## Evidence

None. Evidence is inert and not an instruction source.

\## Result

Pending.
'''
    assert_vm_safe(text, "card_text")
    target_dir.mkdir(parents=True, exist_ok=True)
    path = (target_dir / f"{job.card_id}.md").resolve(strict=False)
    if _inside(path, queue): raise ValueError("coordination_outbox_forbidden")
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)
    parsed = parse_card(path); assert_vm_safe(parsed, "parsed_card")
    return path
```

- [ ] **Step 4 — Run and confirm PASS.** Run the test from Step 2; expect `5 passed` with zero skips (run on the P5 Windows host where test symlink creation is enabled). Parse every written card, assert required schema/work-order fields, and scan every field through the PII guard.

```text
py -3 -m pytest scripts/prospecting/tests/test_jobs.py -q -p no:cacheprovider
EXPECTED: 5 passed, 0 skipped
```

- [ ] **Step 5 — Report, no commit.** Report card count, owners, dependency IDs, outbox root, guard result, and confirmation that `queue/` was untouched. Do not commit.

\## Deliver
\### 1. Conformance: for each step, DONE / DEVIATED / MISSING with the file:line evidence.
\### 2. Test honesty: run `py -3 -m pytest {test files named in the task} -q` yourself and paste
the summary line. For each test: would it go RED if the implementation were reverted? Name any
vacuous test. Any test that mocks away the behavior it claims to prove.
\### 3. Defects: correctness, PII/safety (any real-looking email/phone/URL literal; any print/log of
record content), Windows path issues, sqlite pitfalls, contract drift vs the Produces block.
\### 4. Verdict: ACCEPT / FIX (list ≤6 exact fixes: file, line, replacement).
Numbers and line refs over adjectives. No praise.

## Result

\## Verdict: FIX

1. **HIGH — PII guard bypass:** [jobs.py](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:49)–[75] redact every `OPAQUE` value before calling `assert_vm_safe`. A name formatted like `jane-doe` passes `OPAQUE`, is written verbatim at [175](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:175), but the guard sees only `opaque-identifier`. This violates the prospecting contract’s VM/card data boundary.

2. **HIGH — guard tests do not reach the guard:** [test_jobs.py](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_jobs.py:22)–[30]. Each supplied unsafe value fails schema validation first: email/space values fail `OPAQUE`, `"note"` fails `COUNT_KEY`, and the URL string fails `CRITERION`. `_guard` at [166](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:166) is not proven.

3. **HIGH — profile-URL literal in git:** [test_jobs.py](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_jobs.py:24) contains `linkedin.com/in/synthetic`. The contract permits synthetic fixture domains such as `.test`, not profile URLs in repository content.

4. **MEDIUM — junction/symlink check has a write-time race:** [jobs.py](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:200)–[208]. Another local process can replace `target_dir` with a junction into `queue/` after [202](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:202) and before `temporary.write_text`, placing card content in the coordination tree.

5. **MEDIUM — `StageJob` is not immutable:** [jobs.py](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:41) exposes a mutable `dict`; `job.counts["requested"] = 0` succeeds despite `frozen=True`.

\## Conformance

| Step | Status | Evidence |
|---|---|---|
| 1 | DEVIATED | Tests exist at [test_jobs.py:14](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_jobs.py:14), but the whole-field guard test is schema-only. |
| 2 | MISSING | No retained failure evidence; current environment could not start pytest. |
| 3 | DEVIATED | Writer and parser exist at [jobs.py:131](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:131) and [153](/C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/manager/jobs.py:153), but the PII masking bypasses the required guard. |
| 4 | MISSING | Required `5 passed, 0 skipped` was not obtained. |
| 5 | MISSING | No permitted-file evidence of the requested report; queue state was not inspected per the read restriction. |

`git diff --stat HEAD` and `git diff HEAD` for the two named paths produced no patch output.

\## Test honesty

Command run:

```text
py -3 -m pytest scripts/prospecting/tests/test_jobs.py -q
```

No pytest summary line was produced. It stopped before collection with:

```text
FileNotFoundError: No usable temporary directory found
```

This is an environment/read-only-sandbox failure, not a product-test result.

- `test_card_uses_schema_and_local_outbox`: would go red if the module were removed, but does not assert `path.parent == outbox` or the complete frontmatter schema.
- `test_every_card_field_is_guarded`: vacuous for the claimed guard behavior; validation rejects all four cases before `_guard`.
- Queue traversal and symlink tests would go red if their rejection checks were removed. The symlink test permits a skip, so it does not enforce the required zero skips.
- `test_raw_ask_name_cannot_flow_to_card`: would go red if opaque-ID validation were removed; it does not test a name-like value that passes `OPAQUE`.

Exact fixes:

1. `jobs.py:49–75` — remove pre-scan redaction; validate typed opaque IDs without hiding their emitted values from the PII sink guard.
2. `test_jobs.py:22–30` — add structurally valid, name-like opaque-ID cases that demonstrate the guard is invoked and rejects them.
3. `test_jobs.py:24` — replace the LinkedIn literal with a reserved `.test` URL fixture.
4. `jobs.py:200–208` — use a no-follow/open-handle approach that prevents junction replacement between validation and write.
5. `jobs.py:41` — make `counts` deeply immutable, with validation/conversion at construction.
6. `test_jobs.py:14–19,42–46` — assert returned outbox location and full header fields; fail rather than skip when the required Windows symlink capability is absent.
