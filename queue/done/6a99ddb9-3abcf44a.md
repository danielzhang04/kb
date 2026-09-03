---
schema-version: 1
id: 6a99ddb9-3abcf44a
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p5
risk-tier: T1
owner: codex-worker
claim-token: 5d859e27f2f2230c
state: done
approval: null
workflow: 01a06906-d09a-7040-830d-2f472d9c074f
depends-on: []
variant-group: null
role: work
session-id: 6a99dcd4-ba105c70
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a READ-ONLY codex reviewer in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p5`. Run
`python scripts/preamble.py` once. No writes. Deliver as final message. Stop at 25 minutes.
Never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/; no repo-wide grep.

\# Review brief — Task 7

\## READ BUDGET
- The task text below (authoritative). - The files it says it creates/modifies (read fully).
- `git diff --stat HEAD` and `git diff HEAD` limited to those files. - `pytest.ini`.

\## Task text
\## Task 7: Add the VM terminal runner and synthetic local end-to-end

**Files:** Create `scripts/prospecting/run_workflow.py`, `scripts/prospecting/tests/test_run_workflow.py`, `orgs/prospecting/fixtures/scale-200x400.json`; modify none.

**Interfaces:** VM dry-run is `py -3 -m scripts.prospecting.run_workflow --workflow
outreach-run --ask ask-opaque-001 --dry-run --pending-ok --outbox <path>`. Desktop-local is
`py -3 -m scripts.prospecting.run_workflow --workflow outreach-run --ask <desktop-local-ask>
--local --outbox <path>`. Production VM execution is the same command with `--ssh --host
desktop.tailnet --outbox <path>`. `--outbox` is required in every form; `--pending-ok` is accepted
only with `--dry-run`. Literal ask bytes are resolved on the desktop before invocation and never
appear in VM argv; only desktop-local mode accepts those bytes. Local and SSH stage turns both call `DesktopBridge.invoke`, which uses the real
P2/P3/P4 `ENTRYPOINTS`; inspectors return exactly `{"decision":"pass","grade":95}`. Telemetry is
derived from bridge call records, not hard-coded output fields. The 200/400 fixture run and rerun
prove 400 revisions/drafts and zero duplicate deliveries.

- [ ] **Step 1 — Write the failing dry-run and 20-draft synthetic tests.**

```python
\# scripts/prospecting/tests/test_run_workflow.py
from __future__ import annotations
import json
from pathlib import Path
from scripts.prospecting.manager.bridge import BridgeResult
from scripts.prospecting.run_workflow import main

class RecordingBridge:
    def __init__(self, summaries): self.summaries=iter(summaries); self.calls=[]
    def invoke(self, agent_cli, job, mode, host=None):
        self.calls.append((agent_cli,job["operation"],mode,host,job))
        return BridgeResult(0,"ok",next(self.summaries))

def result(stage_id, **counts):
    return {"stage_id":stage_id,"state":"complete","ids":[stage_id+"-opaque"],
            "counts":counts,"hashes":["a"*64],"failure_codes":{},"attempt":1}

def test_dry_run_writes_guarded_card_plan_and_uses_pending_ok(tmp_path: Path, capsys) -> None:
    compiled={"campaign_id":"campaign-1","policy_id":"policy-1","policy_hash":"b"*64,"sender_profile_id":"sender-1","model_response":"C:/kb/fixtures/model.json","output":"C:/kb/output/prepared.json","target_policy":{"predicates":[],"requested_people":20}}
    code=main(["--workflow","outreach-run","--ask","ask-opaque-001","--dry-run","--pending-ok","--outbox",str(tmp_path/"outbox")], compile_ref=lambda ref:compiled, prerequisites=lambda pending_ok:{"P1":"pass","P2":"pending","P3":"pending","P4":"pending"})
    value=json.loads(capsys.readouterr().out)
    assert code == 0 and value["mode"] == "dry-run" and value["card_count"] == 5
    assert len(list((tmp_path/"outbox").glob("*.md"))) == 5

def test_local_uses_real_entrypoint_operations(tmp_path: Path, capsys, record_property) -> None:
    bridge=RecordingBridge([result("list",companies=10,people=20),result("personalize",revisions_created=20),result("enroll",drafted=20)])
    compiled={"campaign_id":"campaign-1","policy_id":"policy-1","policy_hash":"b"*64,"sender_profile_id":"sender-1","model_response":"C:/kb/fixtures/model.json","output":"C:/kb/output/prepared.json","target_policy":{"requested_people":20}}
    code=main(["--workflow","outreach-run","--ask","intent:networking industry:synthetic","--local","--outbox",str(tmp_path/"outbox")], compile_ref=lambda ref:compiled, bridge=bridge, prerequisites=lambda pending_ok:{p:"pass" for p in ("P1","P2","P3","P4")})
    value=json.loads(capsys.readouterr().out)
    assert code == 0 and value["state"] == "complete"
    assert [(x[0],x[1],x[2]) for x in bridge.calls] == [("list-builder","build","local"),("personalizer","personalize","local"),("campaigner","sweep","local")]
    operations=[item[1] for item in bridge.calls]
    record_property("model_calls",sum(item == "model-turn" for item in operations))
    record_property("live_vendor_calls",sum(item == "vendor-call" for item in operations))
    record_property("live_gmail_sends",sum(item == "gmail-send" for item in operations))

def test_ssh_mode_routes_all_domain_clis_through_bridge(tmp_path: Path, capsys) -> None:
    bridge=RecordingBridge([result("list",people=20),result("personalize",revisions_created=20),result("enroll",drafted=20)])
    compiled={"campaign_id":"campaign-1","policy_id":"policy-1","policy_hash":"b"*64,"sender_profile_id":"sender-1","model_response":"C:/kb/fixtures/model.json","output":"C:/kb/output/prepared.json","target_policy":{"requested_people":20}}
    assert main(["--workflow","outreach-run","--ask","ask-opaque-001","--ssh","--host","desktop.tailnet","--outbox",str(tmp_path/"outbox")],compile_ref=lambda ref:compiled,bridge=bridge,prerequisites=lambda pending_ok:{p:"pass" for p in ("P1","P2","P3","P4")}) == 0
    capsys.readouterr(); assert all(call[2:4] == ("ssh","desktop.tailnet") for call in bridge.calls)

def test_scale_200x400_and_rerun_have_no_duplicate_delivery(tmp_path: Path, capsys) -> None:
    bridge=RecordingBridge([result("list",companies=200,people=400,provenance=400,attempts=400),result("personalize",evidence_sets=400,revisions_created=400),result("enroll",t0_draft_requests=400,deliveries=400)])
    compiled={"campaign_id":"campaign-scale","policy_id":"policy-scale","policy_hash":"c"*64,"sender_profile_id":"sender-scale","model_response":"C:/kb/fixtures/model.json","output":"C:/kb/output/prepared.json","target_policy":{"requested_people":400}}
    argv=["--workflow","outreach-run","--ask","ask-scale-001","--local","--outbox",str(tmp_path/"outbox")]
    kwargs=dict(compile_ref=lambda ref:compiled,bridge=bridge,prerequisites=lambda pending_ok:{p:"pass" for p in ("P1","P2","P3","P4")})
    assert main(argv,**kwargs) == 0; first=json.loads(capsys.readouterr().out)
    assert main(argv,**kwargs) == 0; second=json.loads(capsys.readouterr().out)
    assert first == second and first["counts"] == {"attempts":400,"companies":200,"deliveries":400,"evidence_sets":400,"people":400,"provenance":400,"revisions_created":400,"t0_draft_requests":400}
    assert len(bridge.calls) == 3
```

- [ ] **Step 2 — Run and confirm the failure.** Run `py -3 -m pytest scripts/prospecting/tests/test_run_workflow.py -q -p no:cacheprovider`; expect missing terminal runner.

```text
py -3 -m pytest scripts/prospecting/tests/test_run_workflow.py -q -p no:cacheprovider
EXPECTED: ModuleNotFoundError: scripts.prospecting.run_workflow
```

- [ ] **Step 3 — Implement the terminal CLI and scale fixture.**

```python
\# scripts/prospecting/run_workflow.py
from __future__ import annotations
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import re
from scripts.prospecting.manager.bridge import DesktopBridge
from scripts.prospecting.manager.jobs import StageJob, write_card
from scripts.prospecting.manager.p5_contracts import verify_prerequisites
from scripts.prospecting.manager.runner import ManagerRunner
from scripts.prospecting.manager.workflows import load_workflow
from scripts.prospecting.pii_guard import assert_vm_safe

ASK_REF=re.compile(r"^ask-[a-z0-9-]{3,80}$")
CLI={"prospecting-list-builder":"list-builder","prospecting-personalizer":"personalizer","prospecting-campaigner":"campaigner"}
def _parser() -> argparse.ArgumentParser:
    p=argparse.ArgumentParser(); p.add_argument("--workflow",choices=("outreach-run","list-only","personalize-only","enroll-only","reply-triage"),required=True); p.add_argument("--ask",required=True)
    mode=p.add_mutually_exclusive_group(required=True); mode.add_argument("--dry-run",action="store_true"); mode.add_argument("--local",action="store_true"); mode.add_argument("--ssh",action="store_true")
    p.add_argument("--host"); p.add_argument("--pending-ok",action="store_true")
    p.add_argument("--outbox",type=Path,required=True); return p

def _plan(workflow, outbox: Path, compiled: dict) -> int:
    cards={}
    for stage in workflow.stages:
        card_id=f"plan-{stage.id}-a1"; dependencies=tuple(cards[item] for item in stage.needs)
        write_card(StageJob(card_id,"prospecting","plan",stage.id,stage.agent,dependencies,
          compiled["policy_id"],compiled["policy_hash"],(compiled["campaign_id"],),(),
          {"requested":compiled["target_policy"]["requested_people"]},("dry_run_only","no_pii")),outbox)
        cards[stage.id]=card_id
    return len(cards)

def main(argv=None, compile_ref=None, bridge=None, prerequisites=None) -> int:
    args=_parser().parse_args(argv); workflow=load_workflow(Path("workflows")/f"{args.workflow}.md")
    if args.pending_ok and not args.dry_run: raise ValueError("pending_ok_is_dry_run_only")
    if args.ssh and not args.host: raise ValueError("ssh_host_required")
    if not args.local and not ASK_REF.fullmatch(args.ask): raise ValueError("vm_requires_opaque_ask_ref")
    if compile_ref is None: raise ValueError("desktop_compiler_required")
    phase_states=(prerequisites or (lambda pending_ok:verify_prerequisites(Path.cwd(),pending_ok).phases))(args.pending_ok)
    compiled=compile_ref(args.ask); assert_vm_safe(compiled,"compiled_reference")
    if args.dry_run:
        result={"mode":"dry-run","workflow":workflow.id,"campaign_id":compiled["campaign_id"],
                "policy_id":compiled["policy_id"],"policy_hash":compiled["policy_hash"],
                "card_count":_plan(workflow,args.outbox,compiled),"prerequisites":phase_states}
    else:
        active_bridge=bridge or DesktopBridge(Path(".p5-jobs")); mode="ssh" if args.ssh else "local"
        def turn(stage,attempt,job):
            payload={"operation":stage.operation,"stage_id":stage.id,"attempt":attempt,
                     "policy_id":job.policy_id,"policy_hash":job.policy_hash,
                     "campaign_id":compiled["campaign_id"],
                     "sender_profile":compiled["sender_profile_id"],
                     "model_response":compiled["model_response"],"output":compiled["output"],
                     "ids":list(job.input_ids),"hashes":list(job.input_hashes),"counts":job.counts}
            outcome=active_bridge.invoke(CLI[stage.agent],payload,mode,host=args.host)
            if outcome.code != "ok": raise RuntimeError(outcome.code)
            return outcome.summary
        def inspect(stage, prior): return {"decision":"pass","grade":95}
        report=ManagerRunner(workflow,args.outbox,turn,inspect).run(
          "run-"+compiled["campaign_id"],compiled["policy_id"],compiled["policy_hash"],
          (compiled["campaign_id"],),(),{"requested":compiled["target_policy"]["requested_people"]})
        result={**asdict(report),"mode":mode,"prerequisites":phase_states}
    assert_vm_safe(result,"terminal_output"); print(json.dumps(result,sort_keys=True,separators=(",",":"))); return 0

if __name__ == "__main__": raise SystemExit(main())
```

Generate `scale-200x400.json` deterministically with top-level `companies`, `people`,
`observations`, `contacts`, `snapshots`, `provider_attempts`, `evidence_sets`,
`t0_draft_requests`, `deliveries`, `lane_cursor_pages`, and `inbound_states`. IDs are
`company-0001..0200` and `person-0001..0400`; every person references
`company-{((n-1) % 200)+1:04d}` and has at least one observation, provider attempt, evidence set,
and T0 draft request. Five cursor pages partition all people/deliveries; each stores the next cursor
as its resume cursor so replay is idempotent. Synthetic fixtures use reserved example domains only
where a content-level PII test requires them. The fixture contains no real-looking identity.

- [ ] **Step 4 — Run and confirm PASS.** Run the test from Step 2; expect `4 passed`. Then run all three command forms with required `--outbox`. Dry-run must write one guarded five-card plan. Local and SSH must invoke the exact P2/P3/P4 CLI operations through the bridge. The scale run must report 200 companies, 400 people/evidence sets/revisions/T0 draft requests with complete provenance/attempt accounting, and an identical rerun must add no bridge call or delivery.

```text
py -3 -m pytest scripts/prospecting/tests/test_run_workflow.py -q -p no:cacheprovider
EXPECTED: 4 passed
```

- [ ] **Step 5 — Report, no commit.** Report command forms, host interpretation of `--ask`, safe output keys, 20-person counts, idempotent rerun, and zero model/vendor/send activity. Do not print literal ask text and do not commit.

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

`python scripts/preamble.py`: `PREAMBLE OK`.

\### Conformance

| Step | Status | Evidence |
|---|---|---|
| 1 | DONE | [test_run_workflow.py](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_run_workflow.py:32) contains the four specified tests. |
| 2 | MISSING | No evidence of the required pre-implementation `ModuleNotFoundError` run. |
| 3 | DEVIATED | [run_workflow.py](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/run_workflow.py:80) makes every documented command fail without injected `compile_ref`; the CLI has no desktop-side compiler/resolver. |
| 4 | MISSING | The specified test could not start in this read-only environment; no direct command-form verification is evidenced. |
| 5 | MISSING | No scoped report artifact/evidence. |

`git diff --stat HEAD` and `git diff HEAD` for the three named paths returned no diff content (plus a local Git-ignore permission warning).

\### Test honesty

Attempted exactly:

```text
py -3 -m pytest scripts/prospecting/tests/test_run_workflow.py -q
```

No summary line: pytest stopped before collection with:

```text
FileNotFoundError: [Errno 2] No usable temporary directory found
```

The sandbox permits reads only; `tmp_path` and pytest capture require a writable temp directory.

- Dry-run test goes red if `main` is removed, but does not inspect card guards.
- Local test goes red for runner CLI/operation mapping changes, but mocks away `DesktopBridge` and all real P2/P3/P4 entrypoints.
- SSH test is partly vacuous: [line 119](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_run_workflow.py:119) uses `all(...)`, which passes for zero bridge calls.
- Scale test goes red if rerun causes calls, but never loads or validates `scale-200x400.json`; all 200/400 results are hard-coded mocked summaries.
- “Zero model/vendor/send” is vacuous: [lines 90–93](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/tests/test_run_workflow.py:90) compare stage-operation names to unrelated strings, so all values are zero regardless of underlying activity.

\### Defects

1. Documented CLI is unusable: [lines 80–86](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/run_workflow.py:80) require a test-only dependency injection. It also means compiler execution is in the caller process, not demonstrably on the desktop.
2. Relative Windows paths: [lines 73 and 99](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/run_workflow.py:73) depend on the caller’s current directory for `workflows/` and `.p5-jobs`.
3. Fixture is structurally sound at [scale-200x400.json:1](C:/Users/danie/kb-worktrees/prospecting-p5/orgs/prospecting/fixtures/scale-200x400.json:1): required keys, 200 companies, 400 people, complete linked records, five non-overlapping 80-item pages, page-end resume cursors. But production/test code never reads it.
4. No real-looking email, URL, or phone literal found in the fixture; runner output is guarded at [line 135](C:/Users/danie/kb-worktrees/prospecting-p5/scripts/prospecting/run_workflow.py:135). Dynamic guard behavior remains unverified.
5. No SQLite changes/pitfalls observed. No authorized `Produces` block was available to compare.

\### Exact fixes

1. `scripts/prospecting/run_workflow.py:80-86` — replace the injected-only compiler failure with a real desktop-side opaque-ask resolver invoked through the bridge; resolve literal asks only in `--local`.
2. `scripts/prospecting/run_workflow.py:73,99` — derive repo root from `Path(__file__).resolve().parents[2]` and use it for workflow and job paths.
3. `scripts/prospecting/run_workflow.py:102-133` — retain bridge call records and emit telemetry derived from those records; do not rely on hard-coded/implicit zero values.
4. `scripts/prospecting/tests/test_run_workflow.py:59-119` — exercise `DesktopBridge` with only its transport stubbed; assert the actual P2/P3/P4 entrypoint mapping and exactly three SSH calls.
5. `scripts/prospecting/tests/test_run_workflow.py:122-155` — load `scale-200x400.json`, derive expected counts from it, and assert its page/replay invariants before the rerun assertion.
6. `scripts/prospecting/tests/test_run_workflow.py:32-56` — inspect each dry-run card for `dry_run_only` and `no_pii`; add rejection tests for literal VM asks, missing SSH host, and `--pending-ok` outside dry-run.
