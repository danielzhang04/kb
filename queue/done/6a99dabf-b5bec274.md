---
schema-version: 1
id: 6a99dabf-b5bec274
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p5
risk-tier: T1
owner: codex-worker
claim-token: 62bd926c91b49a87
state: done
approval: null
workflow: 01a068f9-1b77-7111-a007-5a50ff7959e3
depends-on: []
variant-group: null
role: work
session-id: 6a99d951-23f95477
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p5` (branch `claude/prospecting-p5`).
Run `python scripts/preamble.py` once (expect PREAMBLE OK). Host facts: `py -3` =
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe (3.13.7), SQLite 3.50.4,
Datasette 0.65.1 preinstalled. NEVER commit, never touch git refs, never pip install, never
run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Stop at 50 minutes and report what is done and what is not. First edit by command 8.

\# Build brief — Task 6

\## READ BUDGET (closed list)
- This brief (the task is reproduced in full below; the plan file is NOT to be re-read).
- Spec §Data and "### P1" of `docs/superpowers/specs/2026-09-02-prospecting-design.md` ONLY if
  the task text references a spec field you need to check; ≤150 lines.
- Files produced by earlier tasks that this task's **Consumes** block names (read those files only).
- `pytest.ini`.

\## Interfaces produced by earlier tasks (authoritative names/signatures)
\#### From Task 0
`verify_prerequisites(root, pending_ok=False) -> PrerequisiteReport`. Default mode
fails closed unless P1, P2, P3, and P4 each have a recorded JSON record whose `phase`, `status`,
64-hex `manifest_hash`, and exact `marker="P# RECORDED PASS"` agree. P1 is additionally checked
through `py -3 -m scripts.prospecting.gate --phase P1 --verify-recorded`, whose complete stripped
stdout must equal `P1 RECORDED PASS`. `--pending-ok` is a dry-run-only P5 option: it may report an
absent P2/P3/P4 record as `pending`, but never accepts a malformed/failing record and never changes
the fail-closed default. Every pinned module is imported unconditionally. `ENTRYPOINTS` is the
single operation/argv allowlist consumed by workflows and the bridge: list-builder `build`,
personalizer `prepare|personalize`, and campaigner `sweep|scan|status`.

\#### From Task 1
Desktop-only `compile_ask(text, resolve_company, campaign_id, sender_profile_id,
mailbox_id, capabilities, overrides) -> CompiledAsk`. Predicate keys map one-for-one to the ten
spec types: `industry`, `company-type`, `company-stage`, `company-location`, `person-location`,
`title`, `seniority`, `school`, `platform`, and `company-list`. Each emitted item is exactly
`{predicate_id,type,value}`; no aliases or expression fields exist. `company-list` desktop names
resolve to ordered opaque IDs before VM output; missing/ambiguous names, URLs, unsupported
capabilities, and approximate capabilities without a human override bound to
`(campaign_id,policy_hash,predicate_id,lane,capability_version)` fail closed. Campaign IDs and sender
profile IDs are UUID text, timezone is IANA, send-window start precedes end, and the exact twenty
campaign-policy fields are validated. The compiler is deterministic and model-free.

\#### From Task 2
`StageJob` contains only workflow/run/stage/card IDs, owner, dependencies,
`policy_id`, `policy_hash`, opaque input IDs/hashes, integer counts, and acceptance criteria. No
policy object crosses to a VM card. `write_card(job, outbox, repo_root=Path.cwd()) -> Path` resolves
and canonicalizes the repository root, its `queue/` tree, the outbox, and final target; it rejects
absolute, relative, `..`, junction, and symlink routes into repository `queue/`. `parse_card(path)`
parses and validates the emitted frontmatter and work-order JSON before success. `assert_vm_safe`
walks filename, structured values, rendered body, and parsed round-trip before the atomic write.

\#### From Task 3
Each declaration has exactly `id`, `default-manager`, `version`, and ordered
`stages`; each stage has exactly `id`, `agent`, `operation`, `needs`, and boolean `inspect`.
Producer operations must be exact keys in `ENTRYPOINTS[agent_cli]["commands"]`; inspector and human
operations are the fixed local controls `grade` and `review`. Inspector stages are explicit nodes.
`load_workflow(path)` rejects unknown top-level/stage fields, unknown operations, invalid IDs or
versions, non-boolean inspection flags, manager mismatches, duplicate stages, forward/missing
dependencies, and every delegation field.

\#### From Task 4
Use these factory-shape oracle commands on a disposable desktop checkout: `py -3 -m scripts.agent_factory new prospecting-manager --role manage --runtime claude --model claude-opus-5 --project prospecting`; then the same command for `prospecting-list-builder`, `prospecting-personalizer`, and `prospecting-campaigner` with `--role work --model claude-sonnet-5`. Do not run them in this worktree because current rule 8 makes their `evals/` writes impermissible. Copy only the canonical frontmatter shape into this branch, then add the job-specific body. The manager defaults to `manager:claude:claude-opus-5`; workers default to `worker:claude:claude-sonnet-5`. Allowed Codex alternatives are `gpt-5.6-sol` for manager and `gpt-5.6-terra` for workers. Draft cards are independent proposals under `orgs/prospecting/evals-draft/`; a human later decides whether to apply/bless them. Each card points to a recorded-fixture pytest node.

\#### From Task 5
`ManagerRunner(workflow, outbox, turn, inspector_turn).run(run_id, policy_id,
policy_hash, input_ids, input_hashes, counts) -> RunReport`. A result contains exactly all seven keys:
`stage_id`, `state`, opaque string `ids`, nonnegative integer `counts`, 64-hex `hashes`, integer
`failure_codes`, and positive integer `attempt`. Every next-stage job receives predecessor result IDs
and hashes; `depends_on` names the actual successful card, including `-a2` after retry. Inspector
returns exactly `{"decision":"pass|retry|park","grade":int}` and grade 89 blocks. A PII-free,
atomically replaced checkpoint is persisted after every completed stage and parked transition; rerun
resumes without rewriting completed cards or repeating turns. Retry/reinspection is capped once.

\## Plan header and global constraints (binding)
\# Prospecting P5 v2 — Manager, declarations, workflows, and VM terminal run

\## Goal

Ship the bounded P5 control plane that turns one desktop-local plain-English ask into a typed, PII-free campaign policy; creates one local-outbox card per workflow stage; runs the five flat workflows through four least-privilege agents and the existing independent inspector; invokes the deterministic Windows desktop executor from a VM terminal through one opaque SSH envelope; and proves a resumable synthetic run without a model, live vendor, live Gmail send, live cadence registration, or coordination-branch write.

The implementation ends at a VM-terminal runner and T0 Gmail drafts. Dashboard launch is Gate 4 and is out of scope. A real Gmail run remains Daniel's human gate.

\## Architecture

The Windows desktop is the executor host. It owns SQLite, the isolated Chrome profile, Gmail and vendor credentials, ask text, all PII, policy compilation, and every deterministic domain CLI. The kb VM is the orchestrator. It owns agent/workflow declarations, PII-free cards, aggregate state, and the manager runner. The VM reaches the desktop only through the fixed Tailscale SSH bridge described in Task 6.

The orchestration graph is flat. `prospecting-manager` writes stage cards and consumes typed results; it never asks an agent to spawn another agent. Each producing stage is followed by the existing `inspector` where the workflow requires it. A failed inspection blocks downstream cards. The deliverable split preserves one table/write boundary, one permission surface, one memory shard, and one independent draft-eval suite per agent.

Raw asks are compiled on the desktop. The VM receives only an opaque `ask_ref`, canonical `target_policy`, canonical `campaign_policy`, opaque entity/run IDs, hashes, counts, states, grades, and failure codes. The terminal interface retains the required `--ask` spelling, but on the VM its value is an opaque desktop `ask_ref`; literal ask text is accepted only by `--local` on the desktop. This is the only interpretation consistent with the binding PII law, which forbids raw ask bytes in VM arguments and shell history.

P5 creates no live schedule. It verifies the two P4 cadence blocks, if present, remain inert (`standing_authority: false`). Promotion of declarations to the VM, blessing evals, cadence authorship on protected `main`, T3 sending, and dashboard launch remain human ceremonies.

\## Tech Stack

- Python 3.13.7, invoked as `py -3` on Windows.
- Standard-library `argparse`, `dataclasses`, `hashlib`, `json`, `pathlib`, `re`, `subprocess`, `tempfile`, and `time`.
- Existing `scripts.prospecting` SQLite/domain modules and PII guard.
- Pytest with recorded JSON fixtures and stub agent turns; no model is used in P5 tests.
- Markdown workflow and agent declarations with YAML frontmatter.
- Tailscale SSH as transport; one fixed argv, no shell, no inherited credential environment.

\## Spec

Implement `docs/superpowers/specs/2026-09-02-prospecting-design.md` §Architecture, §Agent contracts, §Workflows and cadences, §Data Contract 1, §P5, and §Threat model. Where the older §P5 inventory names a single manager agent or writes under `evals/agents/`, this plan follows the later binding brief: four declarations and unblessed draft cards under the four explicit `orgs/prospecting/evals-draft/prospecting-*` directories. A human may later bless/promote them through the governed eval ceremony.

\## Global Constraints

- PII law — cards/ledgers carry ids+counts only, asks compiled on the desktop.
- Agents never spawn agents.
- Agents never touch `evals/`.
- No live cadence registration.
- Least privilege per agent.
- Sending is kb T3.
- Skills slim.

Additional execution constraints: run `python scripts/preamble.py` before implementation; work only on the assigned branch; never write test cards to `queue/`; never handle credentials as objects; never pass raw asks, names, emails, phones, profile URLs, notes, excerpts, subjects, or bodies through VM argv/stdout/stderr/logs/cards/reports; and do not commit in any task below.

\## File Structure

This list is the P5 artifact allowlist. Every created or modified path must appear here and in
`gate_manifest_p5.json`; P5 never modifies `scripts/prospecting/gate.py`. The four declarations and
all four eval-draft directory inventories are explicit so a hidden declaration or an `evals/` copy
cannot pass by omission.

- `scripts/prospecting/manager/__init__.py` — P5 manager package exports.
- `scripts/prospecting/manager/p5_contracts.py` — recorded-gate prerequisites plus exact P2/P3/P4 module/argv contracts.
- `scripts/prospecting/manager/compile_ask.py` — deterministic desktop-only ask grammar, company-ID resolver, policy compiler, and VM-output guard.
- `scripts/prospecting/manager/jobs.py` — stage job schema and local-outbox card writer.
- `scripts/prospecting/manager/workflows.py` — five-workflow frontmatter parser and declaration validator.
- `scripts/prospecting/manager/runner.py` — bounded chain runner, inspector decision, retry/park state machine, wake-me card, and aggregate run report.
- `scripts/prospecting/manager/bridge.py` — fixed local/SSH desktop invocation, sanitized child environment, timeout/kill, and aggregate-result parser.
- `scripts/prospecting/run_workflow.py` — VM terminal entrypoint for `outreach-run`, `list-only`, `personalize-only`, `enroll-only`, and `reply-triage`.
- `workflows/outreach-run.md`, `list-only.md`, `personalize-only.md`, `enroll-only.md`, `reply-triage.md` — declared manager and ordered stage chains.
- `agents/prospecting-manager.md`, `agents/prospecting-list-builder.md`, `agents/prospecting-personalizer.md`, `agents/prospecting-campaigner.md` — factory-shaped declarations.
- `skills/imported/prospecting-manager/SKILL.md` — slim manager behavior contract; P2/P3/P4 skills are reused, not copied.
- `orgs/prospecting/evals-draft/prospecting-manager/{policy-routes,missing-input-parks,pii-result-parks,outreach-order,inspection-blocks}.md` — five deterministic, unblessed manager proposals.
- `orgs/prospecting/evals-draft/prospecting-list-builder/{summary-counts-only,policy-cap,inspector-after-list,tool-surface,pii-boundary}.md` — five deterministic, unblessed list-builder proposals.
- `orgs/prospecting/evals-draft/prospecting-personalizer/{twenty-drafts,inspection-after-personalize,model-stub-only,tool-surface,pii-boundary}.md` — five deterministic, unblessed personalizer proposals.
- `orgs/prospecting/evals-draft/prospecting-campaigner/{t0-draft-only,no-send-capability,reply-human-gate,retry-idempotent,pii-boundary}.md` — five deterministic, unblessed campaigner proposals. No proposal is copied under `evals/`.
- `orgs/prospecting/fixtures/p5-asks.json`, `p5-agent-results.json`, `scale-200x400.json` — synthetic or counts-only fixtures.
- `scripts/prospecting/tests/test_p5_contracts.py`, `test_compile_ask.py`, `test_jobs.py`, `test_workflows_p5.py`, `test_agent_declarations_p5.py`, `test_manager_runner.py`, `test_bridge.py`, `test_run_workflow.py`, `test_gate_p5.py` — hermetic P5 tests.
- `scripts/prospecting/gate_manifest_p5.json` — shared-schema P5 artifact/fixture/node/criterion/hash allowlist consumed by the P1-owned multi-phase gate.

\## YOUR TASK (execute every step in order; TDD; run the exact commands)
\## Task 6: Invoke one fixed desktop CLI locally or over Tailscale SSH

**Files:** Create `scripts/prospecting/manager/bridge.py`, `scripts/prospecting/tests/test_bridge.py`; modify none.

**Interfaces:** `DesktopBridge.invoke(agent_cli, job, mode, host=None, timeout=120) -> BridgeResult`.
`job["operation"]` must be an exact command key in `ENTRYPOINTS[agent_cli]["commands"]`; argv is
the module plus that command template with named opaque job fields substituted, never merely
`-m module job.json`. `SshStager` copies to fixed `C:/kb-prospecting/jobs`, atomically renames the
upload, and cleans the remote file on success, child failure, timeout, or parse failure. The child
working directory is fixed. The child environment equals the explicit six-key allowlist and never
inherits Gmail/vendor/API/token/key variables. Stdout is capped at 64 KiB and must contain exactly
one VM-safe JSON object. Timeout invokes a Windows process-tree terminator (`taskkill /T /F`), not
single-process `kill()`.

- [ ] **Step 1 — Write the failing argv, environment, timeout, and result-guard tests.**

```python
\# scripts/prospecting/tests/test_bridge.py
from pathlib import Path
import pytest
import scripts.prospecting.manager.bridge as bridge_module
from scripts.prospecting.manager.bridge import DesktopBridge, terminate_windows_tree

class FakeProcess:
    def __init__(self, stdout='{"state":"complete","counts":{"drafted":20}}', code=0, timeout=False):
        self.stdout,self.stderr,self.returncode,self.timeout,self.pid=stdout,"redacted",code,timeout,77
    def communicate(self, timeout):
        if self.timeout: raise TimeoutError()
        return self.stdout,self.stderr

def test_local_argv_and_sanitized_environment(tmp_path: Path, monkeypatch) -> None:
    for name in ("OPENAI_API_KEY","GMAIL_TOKEN","HUNTER_API_KEY","APOLLO_SECRET"): monkeypatch.setenv(name,"forbidden")
    seen={}
    def launch(argv, **kwargs): seen.update(argv=argv,kwargs=kwargs); return FakeProcess()
    result=DesktopBridge(tmp_path,launch=launch).invoke("list-builder",{"operation":"build","ids":["campaign-1"]},"local")
    assert seen["argv"] == ["py","-3","-m","scripts.prospecting.list_builder",str(tmp_path/"job.json")]
    assert set(seen["kwargs"]["env"]) == {"PATH","SYSTEMROOT","WINDIR","TEMP","TMP","KB_PROSPECTING_NO_NETWORK"}
    assert seen["kwargs"]["cwd"] == "C:/kb"
    assert result.summary["counts"]["drafted"] == 20

@pytest.mark.parametrize(("agent","operation","tail"), [
 ("list-builder","build",None),
 ("personalizer","prepare",["prepare","--campaign","campaign-1","--sender-profile","sender-1","--output","C:/kb/output.json"]),
 ("personalizer","personalize",["personalize","--campaign","campaign-1","--sender-profile","sender-1","--model-response","C:/kb/model.json"]),
 ("campaigner","sweep",["sweep"]), ("campaigner","scan",["scan"]),
 ("campaigner","status",["status"]),
])
def test_every_entrypoint_template_is_consumed(tmp_path: Path, agent: str, operation: str, tail) -> None:
    seen={}; launch=lambda argv,**kwargs:(seen.update(argv=argv) or FakeProcess())
    job={"operation":operation,"campaign_id":"campaign-1","sender_profile":"sender-1",
         "output":"C:/kb/output.json","model_response":"C:/kb/model.json"}
    DesktopBridge(tmp_path,launch=launch).invoke(agent,job,"local")
    expected=[str(tmp_path/"job.json")] if tail is None else tail
    assert seen["argv"][4:] == expected

def test_ssh_uses_argv_not_shell(tmp_path: Path) -> None:
    seen={}; launch=lambda argv,**kwargs:(seen.update(argv=argv,kwargs=kwargs) or FakeProcess())
    cleaned=[]
    DesktopBridge(tmp_path,launch=launch,stage=lambda path,host:"C:/kb-prospecting/jobs/job.json",cleanup=lambda host,path:cleaned.append(path)).invoke("campaigner",{"operation":"sweep","ids":["run-1"]},"ssh",host="desktop.tailnet")
    assert seen["argv"] == ["ssh","--","desktop.tailnet","py","-3","-m","scripts.prospecting.campaigner.cli","sweep"]
    assert seen["kwargs"]["shell"] is False
    assert cleaned == ["C:/kb-prospecting/jobs/job.json"]

def test_timeout_kills_and_returns_code(tmp_path: Path) -> None:
    proc=FakeProcess(timeout=True); killed=[]
    result=DesktopBridge(tmp_path,launch=lambda *a,**k:proc,terminate_tree=lambda pid:killed.append(pid)).invoke("list-builder",{"operation":"build","ids":["run-1"]},"local",timeout=1)
    assert killed == [77] and result.code == "timeout"

def test_windows_terminator_targets_entire_process_tree(monkeypatch) -> None:
    seen=[]; monkeypatch.setattr(bridge_module.subprocess,"run",lambda argv,**kwargs:seen.append((argv,kwargs)))
    terminate_windows_tree(77)
    assert seen[0][0] == ["taskkill","/PID","77","/T","/F"]
    assert seen[0][1]["shell"] is False

def test_result_with_pii_is_rejected(tmp_path: Path) -> None:
    proc=FakeProcess('{"state":"complete","email":"person@example.test"}')
    with pytest.raises(Exception): DesktopBridge(tmp_path,launch=lambda *a,**k:proc).invoke("list-builder",{"operation":"build","ids":["run-1"]},"local")

@pytest.mark.parametrize("operation", ["gmail_send","vendor.call","shell","status"])
def test_unknown_operation_rejected_before_write_or_launch(tmp_path: Path, operation: str) -> None:
    launched=[]
    with pytest.raises(ValueError, match="operation_not_allowed"):
        DesktopBridge(tmp_path,launch=lambda *a,**k:launched.append(a)).invoke("list-builder",{"operation":operation,"ids":["run-1"]},"local")
    assert launched == [] and not (tmp_path/"job.json").exists()

def test_stdout_limit_and_trailing_object_are_rejected(tmp_path: Path) -> None:
    for stdout in ("{}{}", '"'+("x"*65537)+'"'):
        with pytest.raises(ValueError): DesktopBridge(tmp_path,launch=lambda *a,stdout=stdout,**k:FakeProcess(stdout)).invoke("list-builder",{"operation":"build","ids":["run-1"]},"local")

def test_transfer_failure_and_parse_failure_cleanup(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError,match="stage_failed"):
        DesktopBridge(tmp_path,stage=lambda path,host: (_ for _ in ()).throw(RuntimeError("stage_failed"))).invoke("campaigner",{"operation":"scan"},"ssh",host="desktop.tailnet")
    cleaned=[]
    with pytest.raises(ValueError): DesktopBridge(tmp_path,launch=lambda *a,**k:FakeProcess("not-json"),stage=lambda p,h:"C:/kb-prospecting/jobs/job.json",cleanup=lambda h,p:cleaned.append(p)).invoke("campaigner",{"operation":"scan"},"ssh",host="desktop.tailnet")
    assert cleaned == ["C:/kb-prospecting/jobs/job.json"]
```

- [ ] **Step 2 — Run and confirm the failure.** Run `py -3 -m pytest scripts/prospecting/tests/test_bridge.py -q -p no:cacheprovider`; expect missing bridge module.

```text
py -3 -m pytest scripts/prospecting/tests/test_bridge.py -q -p no:cacheprovider
EXPECTED: ModuleNotFoundError: scripts.prospecting.manager.bridge
```

- [ ] **Step 3 — Implement the fixed bridge.**

```python
\# scripts/prospecting/manager/bridge.py
from __future__ import annotations
from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
from typing import Callable
from scripts.prospecting.manager.p5_contracts import ENTRYPOINTS
from scripts.prospecting.pii_guard import assert_vm_safe

@dataclass(frozen=True)
class BridgeResult: exit_code: int; code: str; summary: dict

def terminate_windows_tree(pid: int) -> None:
    subprocess.run(["taskkill","/PID",str(pid),"/T","/F"],check=False,
                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,shell=False)

class SshStager:
    REMOTE_DIR="C:/kb-prospecting/jobs"
    def __init__(self, run: Callable = subprocess.run): self.run=run
    def stage(self, path: Path, host: str) -> str:
        remote=f"{self.REMOTE_DIR}/{path.name}"; temporary=remote+".tmp"
        mkdir=["ssh","--",host,"powershell","-NoProfile","-Command",
               f"New-Item -ItemType Directory -Force -LiteralPath '{self.REMOTE_DIR}' | Out-Null"]
        copy=["scp","--",str(path),f"{host}:{temporary}"]
        move=["ssh","--",host,"powershell","-NoProfile","-Command",
              f"Move-Item -Force -LiteralPath '{temporary}' -Destination '{remote}'"]
        try:
            for argv in (mkdir,copy,move): self.run(argv,check=True,shell=False,capture_output=True)
        except Exception:
            self.cleanup(host,temporary); raise
        return remote
    def cleanup(self, host: str, remote: str) -> None:
        self.run(["ssh","--",host,"powershell","-NoProfile","-Command",
                  f"Remove-Item -Force -LiteralPath '{remote}'"],check=False,shell=False,
                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

class DesktopBridge:
    def __init__(self, job_dir: Path, launch: Callable = subprocess.Popen,
                 stage: Callable | None = None, cleanup: Callable | None = None,
                 terminate_tree: Callable[[int],None] = terminate_windows_tree):
        stager=SshStager(); self.job_dir,self.launch=job_dir,launch
        self.stage=stage or stager.stage; self.cleanup=cleanup or stager.cleanup
        self.terminate_tree=terminate_tree
    def _env(self) -> dict[str,str]:
        allowed=("PATH","SYSTEMROOT","WINDIR","TEMP","TMP")
        env={key:os.environ.get(key,"") for key in allowed}; env["KB_PROSPECTING_NO_NETWORK"]="1"
        return env
    def _command(self, agent_cli: str, job: dict, job_path: str) -> list[str]:
        operation=job.get("operation"); commands=ENTRYPOINTS[agent_cli]["commands"]
        if operation not in commands: raise ValueError("operation_not_allowed")
        values={key:str(value) for key,value in job.items() if isinstance(value,(str,int))}; values["job"]=job_path
        try: return [part.format_map(values) for part in commands[operation]]
        except KeyError as error: raise ValueError("missing_operation_argument") from error
    def invoke(self, agent_cli: str, job: dict, mode: str, host: str | None=None, timeout: int=120) -> BridgeResult:
        if agent_cli not in ENTRYPOINTS or mode not in {"local","ssh"}: raise ValueError("bridge_contract_rejected")
        operation=job.get("operation")
        if operation not in ENTRYPOINTS[agent_cli]["commands"]: raise ValueError("operation_not_allowed")
        assert_vm_safe(job,"desktop_job"); self.job_dir.mkdir(parents=True,exist_ok=True)
        path=self.job_dir/"job.json"; path.write_text(json.dumps(job,sort_keys=True,separators=(",",":")),encoding="utf-8")
        module=ENTRYPOINTS[agent_cli]["module"]; remote=None
        try:
            if mode == "local": argv=["py","-3","-m",module,*self._command(agent_cli,job,str(path))]
            else:
                if not host: raise ValueError("ssh_host_required")
                remote=self.stage(path,host)
                argv=["ssh","--",host,"py","-3","-m",module,*self._command(agent_cli,job,remote)]
            proc=self.launch(argv,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                             env=self._env(),cwd="C:/kb",shell=False,
                             creationflags=getattr(subprocess,"CREATE_NEW_PROCESS_GROUP",0))
            try: stdout,_=proc.communicate(timeout=timeout)
            except (subprocess.TimeoutExpired,TimeoutError):
                self.terminate_tree(proc.pid); return BridgeResult(-1,"timeout",{})
            if proc.returncode != 0: return BridgeResult(proc.returncode,"child_failed",{})
            if len(stdout.encode("utf-8")) > 65536: raise ValueError("stdout_limit")
            decoder=json.JSONDecoder(); value,end=decoder.raw_decode(stdout)
            if stdout[end:].strip(): raise ValueError("multiple_stdout_values")
            assert_vm_safe(value,"desktop_result")
            if not isinstance(value,dict): raise ValueError("invalid_desktop_result")
            return BridgeResult(0,"ok",value)
        finally:
            if remote is not None: self.cleanup(host,remote)
```

- [ ] **Step 4 — Run and confirm PASS.** Run the test from Step 2; expect `17 passed`. Inspect captured argv, exact environment keys, fixed working directory, all six operation templates, stage/cleanup calls, stdout bounds, and the `taskkill /T /F` tree-termination adapter; expect `shell=False` everywhere and zero inherited secret-shaped names.

```text
py -3 -m pytest scripts/prospecting/tests/test_bridge.py -q -p no:cacheprovider
EXPECTED: 17 passed
```

- [ ] **Step 5 — Report, no commit.** Report local/SSH argv shapes, timeout behavior, exit-code mapping, environment key names only, and PII-guard status. Never print stderr or environment values. Do not commit.

\## Report format (final message)
1. Files created/modified (paths). 2. Test command run + exact pass/fail counts. 3. Manifest
entries added. 4. Deviations from the task text and why (none is the expected answer).
5. Anything you could not finish. No prose beyond that.

\## Boss rulings (binding)
- Schema truth: read `scripts/prospecting/schema.sql` (pragma) and use real names; P5-only tables go in `scripts/prospecting/schema_p5.sql` (auto-discovered by `store.migrate`); never edit P1 files (`store.py`, `executor.py`, `schema.sql`, `gate.py`).
- P2/P3/P4 are on sibling branches, NOT in this worktree: their CLIs are not importable here yet. Task 0 runs with `--pending-ok` semantics (record P2-P4 as pending); pin P2/P3/P4 entrypoint names from the plans (`ENTRYPOINTS`) as string constants and mark import checks `xfail(strict=True, reason="pending phase merge")`.
- Agent declarations: use the REAL factory CLI (`py -3 -m scripts.agent_factory --help` first; it has `new`/`bump`, not `create`); draft eval cards under `orgs/prospecting/evals-draft/<agent>/` only (rule 8). Skills slim (<=120 lines, no paragraph >3 lines).
- No cards written to `queue/` on this branch; use the local outbox dir. No live cadence registration.

## Result

1. Created: `scripts/prospecting/manager/bridge.py`, `scripts/prospecting/tests/test_bridge.py`. Local/SSH argv templates, six-key environment allowlist, taskkill tree timeout, exit mappings, staging cleanup, and typed PII guards implemented.

2. `py -3 -m pytest scripts/prospecting/tests/test_bridge.py -q -p no:cacheprovider`: 1 passed, 16 Temp-ACL setup errors. With writable test base: 17 passed.

3. Manifest entries added: none.

4. Deviation: used typed PII sink envelopes required by the current `pii_guard` API.

5. Anything unfinished: none.
