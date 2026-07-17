# Phase R — Model / Tool Routing — Implementation Plan (TDD, wave-ordered) — R1 fleet + R2 dashboard

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans`) to implement this plan task-by-task, strict TDD (failing test first,
> minimal green, refactor). Steps use checkbox (`- [ ]`) syntax. The R1 Python edits extend
> **`tests/test_routing.py`** (new), **`tests/test_dispatch.py`**, and **`tests/test_cards.py`** (pytest);
> the R2 dashboard units run on **vitest** under `dashboard/`.

> **This plan doc + branch.** Lives at `docs/plans/2026-07-17-phase-r-model-routing.md` on
> **`claude/phase-r-plan`**. R1 **code** (routing resolver + dispatch/runner consumption + audit) is
> durable content → PR to `main`; its `dispatch.py`/`cards.py` edits **must join the fleet plan's
> serialized `dispatch.py` queue** (see Execution order). R2 **code** is dashboard durable content on the
> dashboard work branch → PR to `main`. The governance text (`governance/model-routing.yaml`,
> `card-schema.md` fields) is **human-committed** from `docs/proposals/model-routing-yaml-proposal.md`.

**Goal.** Turn the model-tier prose in `routines/roles/*.md` into an enforced **two-level routing policy**:
a durable human "standard plan" (`governance/model-routing.yaml`) plus a fast ops-side override
(`queue/routing-override.yaml`) the dashboard writes instantly, with a per-card frontmatter override
outranking both. **R1** makes dispatch + the runners consume the policy at claim/spawn time (fleet-side,
touches `dispatch.py` → joins the serialized edit queue) and adds a routed-vs-ran ledger audit. **R2** adds
the dashboard Agents view + per-agent / per-card toggles that write the override / card fields through the
governed WebAuthn path. Git stays the database; routing is a projection the dispatcher resolves and stamps,
never a hidden runtime knob.

**Timing (Daniel, binding).** Phase R lands **after the Mission Control UI pass merges to `main`** and
**before the D3 build starts**. R1 (fleet-side) can proceed independently once the fleet's serialized
`dispatch.py` chain has drained through dashboard **D1** (its next link). R2 (dashboard-side, governed
writes) requires the **D2 governed-write foundations** (WebAuthn session, audit log, governed-save path)
to be merged — it reuses them, it does not rebuild them.

## Daniel's locked decisions folded in (binding)

1. **Two-level policy.** Durable defaults in `governance/model-routing.yaml` (human-edited role/task-kind ×
   risk-tier → runtime + model), plus a fast ops-side override file the dashboard writes instantly
   (WebAuthn-gated governed write, audited). Dispatch/runners read **override-over-policy** at claim/spawn.
   **Per-card frontmatter override (`runtime:`/`model:`) outranks both.**
2. **Toggle surfaces (build order).** Per-agent (Agents view) + per-card (detail / DAG node bar) **FIRST**
   (R2.2, R2.3). The policy-matrix-as-form and the editor routing bar are **deferred to a later R-phase**
   (non-goal N6) — proposed sequencing: they land in the D3 wave alongside D3.4's DAG bars, once the
   per-agent/per-card toggles have proven the governed override-write path.
3. **R1 = schema + policy file + dispatch/runner consumption + tests** (fleet-side; touches `dispatch.py`
   → MUST join the repo's serialized `dispatch.py` edit queue as its **next link**; the prior chain was
   fleet `3.4 → 4.1 → 4.2 → 5.2 → dashboard D1`). **R2 = Agents view + toggles** (dashboard-side, governed
   writes).
4. **D3.4 DAG node spec (forward-reference for the D3 wave).** Each node = agent/work card with name,
   status dot, one-line summary, **mono model chip**, **inline model toggle (governed write)**,
   click-through to full timeline/transcript. R2's per-card routing write path is the exact governed write
   D3.4's inline toggle reuses — see the D3 forward-reference block.
5. **Ledger `model` column** enables the routed-vs-actually-ran audit (R1.4).
6. **Governance is human-committed.** R1 contains an explicit **HUMAN GATE R1.0** where Daniel commits
   `governance/model-routing.yaml` + the `card-schema.md` routing fields from the proposal text.

## Ground-truth corrections (verified this session — trust these over any prose)

- **`dispatch.py` has ZERO model-selection logic.** `run(repo_root, tier, agent_id, today=None,
  session_id=None)` sets `owner = cadence.get("agent", agent_id)`, calls `promotion.decide(...)` (returns
  `autonomy` + `assurance_class`, **no model**), sets `role = cadence.get("role", "work")`, builds the card
  via `cards.new_card(...)`, and **claims it at the anchor `cards.claim(card, owner)`** (the exact stamping
  site, mirrored by the existing `if session_id: cards.stamp_session(card, session_id)` two lines later).
  `tier` here is the dispatcher partition (`cloud`|`desktop`), **not** a model tier — do not overload it.
- **`cards.py` has no routing state.** `new_card(project, action, target, risk_tier, body="", **extra)`'s
  default meta has no `runtime`/`model` key; `_validate` checks `REQUIRED` + `risk-tier ∈ RISK_TIERS` +
  `state ∈ STATES` + `role ∈ ROLES` (only when present), and lets unknown extra keys pass through.
  `ROLES = (scout, manage, work, inspect, consolidate)`. `stamp_session(card, session_id)` exists as the
  pattern to mirror for a new `stamp_routing`. Adding `runtime`/`model` mirrors the `session-id: None`
  default exactly.
- **`ledger.py` headers are dynamic** (`fields = sorted(record)` on a new/0-byte shard) — there are **no**
  fixed header constants. The `model` column exists **only in the `cost` kind**, and only because
  `agent_runner.ps1` (`{usd, billing, model, card_id, codex_exit}`) and the M1 dispatch cost row write a
  `model` key. `append(repo_root, kind, agent, record)` uses `extrasaction="ignore"`; `cost_today` sums
  the `usd` column. `KINDS = (dispatch, cost, activity, grades, approvals)`. So the routed-vs-ran audit can
  read the **runtime-ran** model from the cost ledger with **no ledger schema change**.
- **The codex runner IS the codex runtime.** `agent_runner.ps1 -Agent codex-worker` picks up cards purely
  by `owner == $Agent` over `queue/inbox` + `queue/working`, then runs `codex exec` — it passes **no**
  `--model`, and only reads the model back via regex into the cost ledger. `desktop_dispatch.ps1` is a
  scheduler wrapper (`dispatch.py --tier desktop --agent dispatcher-desktop`), no model flag. There is no
  Claude worker runner in-repo yet; the Claude runtime today is the desktop/cloud dispatcher's own session
  and the (future) worker runners the fleet plan's Wave 5 onboards. Runtime selection is therefore
  expressed through **which agent-id owns the card** and which runner is bound to that id — the basis for
  R1.2/R1.3's no-race design.
- **`preamble.py` has no model-id assertion** (`check()` = STOP + `ANTHROPIC_API_KEY` + budget only). The
  `month-1-backlog.md:23` "prose-only, unenforced" line is describing this gap. **Decision (below):** R1
  wires enforcement as a **soft routed-vs-ran ledger audit**, not a hard preamble block.
- **`governance/model-routing.yaml` does not exist**; `queue/` has only `inbox/ working/ done/ approvals/`
  (`queue/paused/` and the routing-override file are new coordination paths). `card-schema.md` has no
  `runtime`/`model` field.

## Enforcement decision (month-1-backlog:23 — stated explicitly)

**R1 WIRES enforcement, as a routed-vs-ran ledger audit — NOT a hard block, NOT a preamble gate.** The
resolver stamps the **routed** `(runtime, model)` on the card; the runner records the **actually-ran**
model in the existing cost-ledger `model` column; R1.4 adds `routing.audit_routed_vs_ran(...)` that
compares them and emits an advisory `activity`-ledger row (and, on a runtime mismatch, a
`wake-me:routed-vs-ran` card) when they diverge. It **never** blocks or kills a run. Rationale: a hard
preamble model-id gate would freeze the fleet on benign divergences (a runtime silently upgrading a model
id, the codex runner not passing `--model`), which is worse than the drift it guards. This is the "wire
it" the backlog asked for, done as observability. The one place Phase R **does** fail loud is an *unknown*
model id at claim time (a routing bug, not a run-time drift) — see ordering-law 3.

---

## Ordering law (binding on the whole plan)

1. **Governance is human-committed (HUMAN GATE R1.0 first).** `governance/model-routing.yaml` and the
   `card-schema.md` `runtime:`/`model:` fields are **PROPOSE-only** for an agent
   (`docs/proposals/model-routing-yaml-proposal.md`); Daniel commits them on `main` and merges `main →
   ops`. No R1 code that *reads* the policy is meaningful until the file exists on `ops`, so R1.0 gates
   R1.1's real-data behavior (R1.1 is still built + unit-tested against fixtures first).
2. **Exactly one fleet-file coupling: R1's `dispatch.py`/`cards.py` edit — it JOINS the serialized
   `dispatch.py` queue as the NEXT link after dashboard D1.** The fleet plan serializes every `dispatch.py`
   edit through one worktree in order `3.4 → 4.1 → 4.2 → 5.2 → D1`; **R1 appends after D1**, re-running
   `tests/test_dispatch.py` after it lands. The new resolver module (`scripts/routing.py`) is a *new* file
   — zero contention — but the `run()` call-site edit and the `cards.py` field/`stamp_routing` edit are
   additive edits to the coordination-critical path and must ride the single serialized insertion. No R2
   dashboard task edits `dispatch.py`/`cards.py`/`routing.py`.
3. **Unknown model id fails LOUD at claim; runtime split never races; never silently substitute.**
   `resolve()` raises `RoutingError` if the resolved `(runtime, model)` is not in the policy's
   `runtimes[runtime].known_models`; `run()` converts that to a `wake-me:unroutable-card` and skips
   dispatching that card (mirroring the existing `wake-me:unknown-tier` path) — it never falls back to a
   default model for a card that *named* an unknown one. The resolved `runtime` selects the **owner**
   (single-valued → single runner picks up); the stamped `runtime` field is the runner's fail-loud
   pre-exec assertion. Corrupt/missing **override** or **policy** files fail **open to policy / safe
   default** (dispatch never stalls); an unknown **named** model fails **closed** (surfaced, not run).
4. **Precedence has exactly one winner** — card frontmatter > `queue/routing-override.yaml` > policy >
   built-in safe default — resolved field-by-field with recorded provenance (proposal §4). No merging of
   two sources into a blended runtime.
5. **R2 reuses D2, never rebuilds it.** Every R2 write (override file, per-card routing field) goes through
   the **existing** D2 WebAuthn-session gate + D2.9 audit log + governed branch routing (`queue/**` and
   card writes are **coordination** → `ops` pull-rebase-push). R2 adds no new auth, no new audit sink, no
   raw `fs.write` into `queue/`/`governance/`. R2 is HARD-GATED on the D2 governed-write foundations being
   merged to `main`.
6. **The credential ceiling holds.** Nothing in Phase R handles a credential as an object; the routed model
   is a data field, not a secret. R1 runs entirely within existing fleet identities; R2 within the existing
   dashboard identity + WebAuthn session.

**Branch discipline (per CLAUDE.md).** R1 code lands on `claude/phase-r-plan` (or a fresh
`claude/phase-r-r1` work branch) → **PR to `main`**, with the `dispatch.py`/`cards.py` parts inserted at
the tail of the fleet's serialized `dispatch.py` queue after D1. R2 code lands on the dashboard work branch
→ **PR to `main`**. Governance text is **human-committed** (HUMAN GATE R1.0). Runtime writes the dashboard
makes (`queue/routing-override.yaml`, card `runtime`/`model` fields, audit rows) are **coordination** → the
usual `ops` pull-rebase-push.

---

# Wave R1 — Fleet-side routing (schema + policy + dispatch/runner consumption + audit)

> The single fleet-file coupling. Build `scripts/routing.py` (new, no contention) and unit-test it against
> fixtures first; the `dispatch.py`/`cards.py` edits ride the serialized queue after D1. R1.0 (governance
> commit) gates real-data behavior but not the fixture-driven build.

### HUMAN GATE R1.0 — Daniel commits `governance/model-routing.yaml` + card-schema routing fields (agent PROPOSES exact text)
- [ ] Agent deliverable (already produced): `docs/proposals/model-routing-yaml-proposal.md` — the verbatim
  `governance/model-routing.yaml` (§1), the `queue/routing-override.yaml` schema (§2), and the
  `card-schema.md` `runtime:`/`model:` additions (§3), with the one-winner precedence (§4).
- [ ] **Daniel** confirms the Codex model slug (§1), then **commits** `governance/model-routing.yaml` and
  the `card-schema.md` routing fields on `main` (governance is human-committed), and merges `main → ops`
  so the running fleet + dashboard read them. (Proposal §5 has the exact commands.)
- [ ] **Decision to record at the gate:** whether to add `runtime`/`model` to the **dashboard**
  `content_hash` preimage (proposal §3 recommendation — recommended **yes**, so an R2 per-card routing
  write is tamper-evident). If yes, it is a dashboard-hash change folded into R2.3, not a fleet change.

### Task R1.1 — `scripts/routing.py` — the precedence resolver (policy + override + fail-loud)  *(AGENT-BUILDABLE)*
**Goal.** A pure, side-effect-free routing resolver: load the policy (`budget.yaml`-pattern, safe-default
on absent/corrupt), load the override (safe-empty on absent/corrupt), and `resolve()` a card to exactly one
`(runtime, model)` with recorded provenance — failing loud on an unknown *named* model, failing open to
policy on a corrupt override/policy file.

**Files touched:** `scripts/routing.py` (new — `load_policy(repo_root)`, `load_override(repo_root)`,
`resolve(card_meta, cadence, repo_root, *, policy=None, override=None) -> Routed`, `RoutingError`,
`_resolve_alias(policy, runtime, model_or_alias)`, `SAFE_DEFAULT = ("claude", "claude-sonnet-5")`),
`tests/test_routing.py` (new).

**Failing tests first (named ids):**
- `tests/test_routing.py::test_policy_role_tier_lookup` — `work`/`T3` → `(claude, claude-opus-4-8, "policy")`;
  `scout`/any → `(claude, claude-haiku-4-5, "policy")` (alias resolved through `runtimes.claude.aliases`).
- `::test_policy_star_tier_fallback` — a role with only `"*"` (e.g. `manage`) resolves for `T1`/`T2`/`T3`
  identically via `policy[role]["*"]`.
- `::test_role_default_when_role_absent_from_policy` — a card whose role is not in `policy` resolves to the
  file's `role_default` with `source == "policy"` (the role-prose default rung).
- `::test_card_frontmatter_outranks_everything` — `card_meta["runtime"]="codex", card_meta["model"]=
  "gpt-5-codex"` wins over both override and policy; `source_runtime == source_model == "card"`.
- `::test_override_card_scope_beats_agent_scope` — an override file with a `scope:card key:<id>` entry and a
  `scope:agent key:<owner>` entry resolves to the card-scope entry; provenance `"override"`.
- `::test_override_beats_policy_but_not_card` — an override entry outranks policy but a non-null card field
  outranks the override.
- `::test_partial_override_model_only_keeps_policy_runtime` — a `model`-only override entry sets `model`
  from `"override"` and `runtime` from `"policy"` (field-by-field provenance).
- `::test_expired_override_entry_ignored` — an entry with `expires` in the past is treated as absent (falls
  through to policy) and is not selected.
- `::test_unknown_model_raises_routing_error` — a card naming `model:"claude-ultra-9"` (not in any
  `known_models`) raises `RoutingError` — **never** silently substitutes.
- `::test_corrupt_override_falls_back_to_policy` — an unparseable/`schema-invalid` `queue/routing-override.yaml`
  → `load_override` returns `{"overrides": []}` + logs; `resolve` uses policy (fail open).
- `::test_missing_policy_uses_safe_default` — absent `governance/model-routing.yaml` → `resolve` returns
  `SAFE_DEFAULT` with `source == "default"` (dispatch never stalls).
- `::test_owner_runtime_registry_lookup` — `runtimes[runtime].default_worker` is exposed for dispatch's
  owner selection (a helper `default_worker_for(policy, runtime)`).

**Implementation.** `load_policy`/`load_override` mirror `preamble._daily_limit`: `path.exists()` guard,
`yaml.safe_load(path.read_text())`, `try/except` → default + `logging.warning`. `resolve` composes the
winner field-by-field down the chain (card → override → policy → safe default), resolves any alias through
`runtimes[runtime].aliases`, then asserts the concrete `model ∈ runtimes[runtime].known_models` or raises
`RoutingError`. Pure function — no writes, no ledger, no card mutation (that is R1.2). Return a small
frozen dataclass/namedtuple `Routed(runtime, model, source_runtime, source_model)`.

**Verification.** `python -m pytest tests/test_routing.py -q` green.

**Commit message:** `feat(routing): precedence resolver (card>override>policy>default), fail-loud on unknown model, fail-open on corrupt files`

### Task R1.2 — `cards.py` routing fields + `stamp_routing` (rides the serialized cards edit)  *(AGENT-BUILDABLE)*
**Goal.** Give cards optional `runtime`/`model` frontmatter (mirroring `session-id: None`) and a
`stamp_routing` setter mirroring `stamp_session`, so dispatch can persist the routing decision and legacy
cards stay valid.

**Files touched:** `scripts/cards.py` (add `"runtime": None, "model": None` to `new_card`'s default meta
dict; add `stamp_routing(card, runtime, model)`; extend `_validate` with an optional `RUNTIMES` check —
mirror the `role`/`ROLES` pattern: validate only when the field is present/truthy), `tests/test_cards.py`.

**Failing tests first (named ids):**
- `tests/test_cards.py::test_new_card_has_null_runtime_and_model_by_default` — a fresh card's meta contains
  `runtime: None` and `model: None`.
- `::test_stamp_routing_sets_fields` — `stamp_routing(card, "claude", "claude-opus-4-8")` sets both; a
  `save`/`parse` round-trip preserves them.
- `::test_missing_routing_fields_still_validate` — a legacy on-disk card with no `runtime`/`model` key
  parses without `ValidationError` (backward compatibility).
- `::test_invalid_runtime_rejected_when_present` — `runtime: "gpt"` (not in `RUNTIMES = ("claude","codex")`)
  raises `ValidationError`; `runtime: None`/absent does not (mirror the `role`/`ROLES` rule).
- `::test_existing_card_behavior_unchanged` — every prior `new_card`/`_validate`/`STATE_DIR`/`LEGAL`
  behavior holds (regression: existing card tests stay green).

**Implementation.** Purely additive: two new default-meta keys, one setter, one optional enum check. Keep
`model` free-form (concrete ids are validated against the runtime registry by `routing.resolve`, not by
`cards._validate`, to avoid coupling `cards.py` to the policy file). Pair with the `card-schema.md`
addition committed at R1.0.

**Verification.** `python -m pytest tests/test_cards.py -q` green (old + new).

**Commit message:** `feat(cards): optional runtime/model routing fields + stamp_routing (session-id-shaped, legacy-safe)`

### Task R1.3 — `dispatch.py` consumption at claim + owner-by-runtime (THE serialized dispatch edit)  *(AGENT-BUILDABLE)*
> **Serialized-queue compliance.** This is the sole Phase-R `dispatch.py` edit. It **appends to the fleet
> plan's serialized `dispatch.py` chain after dashboard D1** (`3.4 → 4.1 → 4.2 → 5.2 → D1 → R1.3`), through
> the one dispatch worktree, re-running `tests/test_dispatch.py` after it lands. Do R1.3 **only after D1
> has merged.** R1.1 (`routing.py`) and R1.2 (`cards.py`) can be built/tested ahead of the queue slot;
> R1.3 is the insertion.

**Goal.** In `run()`, after the claim anchor, resolve routing for the work card, select the **owner** from
the resolved runtime when the cadence does not pin `agent:`, stamp `runtime`/`model`, and on an unroutable
card emit a `wake-me:unroutable-card` and skip it — never mis-drive.

**Files touched:** `scripts/dispatch.py` (import `routing`; extend owner selection and add the stamp +
unroutable-wake around the `cards.claim(card, owner)` anchor — see below; add `_emit_unroutable_wake(...)`
mirroring `_emit_unknown_tier_wake`), `tests/test_dispatch.py`.

**Failing tests first (named ids):**
- `tests/test_dispatch.py::test_run_stamps_routing_from_policy` — a `work`/`T3` cadence (no `agent:`, no
  card override, override file absent) emits a card with `runtime == "claude"`, `model == "claude-opus-4-8"`
  (policy), stamped on the **work** card only (not the `inspect` sibling).
- `::test_run_owner_selected_from_resolved_runtime` — with no cadence `agent:`, a card resolving to
  `runtime: codex` is claimed as `owner == default_worker_for(codex) == "codex-worker"`; a `claude`-runtime
  card as the claude `default_worker`. (Guards the no-race owner selection.)
- `::test_cadence_agent_still_wins_for_owner` — a cadence pinning `agent: codex-worker` keeps that owner
  (explicit `agent:` outranks runtime-default owner selection); routing still stamps `runtime`/`model`,
  and `run()` cross-checks the pinned owner's registered runtime == resolved runtime, emitting a
  `wake-me:owner-runtime-mismatch` on conflict rather than silently mis-owning.
- `::test_card_frontmatter_override_wins_in_dispatch` — a cadence carrying `runtime:`/`model:` (dispatcher
  self-route or a pre-set card) stamps those verbatim over policy.
- `::test_unroutable_card_emits_wake_and_skips` — a cadence naming an unknown model → `run()` catches
  `RoutingError`, emits a `wake-me:unroutable-card` into `queue/inbox/`, and does **not** dispatch that
  cadence's work card (mirrors `test`-shape of the existing unknown-tier path).
- `::test_existing_dispatch_paths_unchanged` — every current `test_dispatch.py` case stays green; the
  no-override / no-card-field path with a present policy is the only behavior change (cards now carry
  `runtime`/`model`).

**Implementation.** After `owner = cadence.get("agent", agent_id)` and the `promotion.decide` block, and
**around** the `cards.claim(card, owner)` anchor:
1. `routed = routing.resolve(card.meta, cadence, repo_root)` — inside a `try/except RoutingError` that
   calls `_emit_unroutable_wake(repo_root, project, cadence)` and `continue`s the cadence loop (skip).
2. If the cadence did **not** pin `agent:`, set `owner = routing.default_worker_for(policy, routed.runtime)`
   before `cards.claim`; if it **did** pin `agent:`, keep it but assert its registered runtime matches
   `routed.runtime` (else `wake-me:owner-runtime-mismatch`, skip).
3. `cards.claim(card, owner)`; then `cards.stamp_routing(card, routed.runtime, routed.model)` (mirroring
   the existing `if session_id: cards.stamp_session(...)` line); stamp **only the work card**, never the
   `inspect` sibling (a future session/model grades it).
All three are additive to `run()` and ride the single serialized insertion. `_emit_unroutable_wake` mirrors
`_emit_unknown_tier_wake` (dedup via `_wake_already_filed`, into `queue/inbox/`).

**Verification.** `python -m pytest tests/test_dispatch.py tests/test_cards.py tests/test_routing.py -q`
green (old + new); confirm no other `dispatch.run(`/`due(` call site regresses.

**Commit message:** `feat(dispatch): resolve+stamp runtime/model at claim, owner-by-runtime, wake on unroutable (serialized dispatch edit)`

### Task R1.4 — Runner runtime-assert + routed-vs-ran audit  *(AGENT-BUILDABLE)*
**Goal.** Make the runner refuse a mis-owned card (fail loud on `runtime` mismatch) and add the soft
routed-vs-ran audit over the cost ledger's existing `model` column — the "wire it, as audit not block"
decision.

**Files touched:** `scripts/agent_runner.ps1` (add a pre-execution assertion: after resolving a claimed
card, if `card.runtime` is set and `!= 'codex'`, refuse the card and emit a `wake-me:runtime-mismatch`
rather than running it under Codex — the codex runner must not silently run a Claude-routed card; a tiny
`scripts/assert_runtime.py <card_path> <my_runtime>` shim keeps Python out of the runner inline, mirroring
`stamp_session.py`), `scripts/assert_runtime.py` (new shim), `scripts/routing.py` (add
`audit_routed_vs_ran(repo_root, day=None) -> list[Mismatch]` — join the day's `cost` ledger rows (`model`
actually ran, keyed by `card_id`) against each card's stamped `model`, returning mismatches; optionally an
`activity`-ledger writer `record_routing_audit(repo_root, agent, mismatch)`), `tests/test_routing.py`,
`tests/test_assert_runtime.py` (new).

**Failing tests first (named ids):**
- `tests/test_assert_runtime.py::test_assert_passes_on_matching_runtime` — a card with `runtime: codex`
  asserted against `codex` returns success (exit 0).
- `::test_assert_fails_loud_on_mismatch` — a card with `runtime: claude` asserted against `codex` returns
  non-zero (the runner refuses); a card with no `runtime` (legacy) passes (backward compatible — no field,
  no assertion).
- `tests/test_routing.py::test_audit_flags_routed_vs_ran_model_mismatch` — a stamped `model:
  claude-opus-4-8` with a cost-ledger `model: claude-sonnet-5` row for the same `card_id` produces one
  `Mismatch`; matching ids produce none.
- `::test_audit_ignores_cards_without_ran_model` — a card with no cost row yet (not run) is not a mismatch
  (advisory audit, not a completeness check).
- `::test_audit_is_advisory_never_raises` — the audit returns a list and never raises/kills; a runtime
  mismatch (`claude` routed, codex ran) is flagged distinctly from a mere model-id drift.

**Runner shape test:** `test_runner_asserts_runtime_before_work` (prose/shape test mirroring the fleet
runner shape tests) — the runner invokes `assert_runtime.py` **before** transitioning the card to `working`
and refuses on non-zero.

**Implementation.** The runtime assertion is load-bearing (fail loud, ordering-law 3); the model audit is
advisory (enforcement decision above). `audit_routed_vs_ran` reads `ledger.read_day(repo_root, "cost",
day)` and the cards' stamped `model`, joining on `card_id` (the cost row already carries `card_id` from
`agent_runner.ps1`). Emit an `activity` row and, on a **runtime** mismatch only, a `wake-me:routed-vs-ran`
card — never on a model-only drift (too noisy; the activity row is the record). No ledger schema change —
the `cost` `model` column already exists.

**Verification.** `python -m pytest tests/test_routing.py tests/test_assert_runtime.py -q` green; runner
shape test green.

**Commit message:** `feat(routing,runner): runtime pre-exec assertion + soft routed-vs-ran cost-ledger audit`

**Wave-R1 exit criteria:**
1. `governance/model-routing.yaml` + the `card-schema.md` `runtime:`/`model:` fields are **human-committed**
   to `main` and merged to `ops` (HUMAN GATE R1.0).
2. `scripts/routing.py` resolves the one-winner precedence (card > override > policy > safe default) with
   provenance; fails **loud** on an unknown named model, fails **open** to policy on a corrupt override/
   policy file; `tests/test_routing.py` green.
3. `cards.py` carries optional `runtime`/`model` + `stamp_routing`; legacy cards still validate; all prior
   `test_cards.py` stays green.
4. `dispatch.run()` resolves + stamps routing at the claim anchor, selects owner-by-runtime (no race — one
   owner, one runner), and emits a `wake-me:unroutable-card` on an unknown model instead of mis-driving —
   landed **through the shared serialized `dispatch.py` queue after D1**; all prior `test_dispatch.py`
   stays green.
5. The runner asserts `runtime` before work (fail loud on mismatch); the routed-vs-ran audit runs over the
   existing cost-ledger `model` column (advisory). `test_assert_runtime.py` green.
6. **No R2 dashboard task edits `dispatch.py`/`cards.py`/`routing.py`.**

---

# Wave R2 — Dashboard routing surfaces (Agents view + per-agent / per-card toggles, governed override write)

> HARD-GATED on the **D2 governed-write foundations merged to `main`** (WebAuthn session D2.1, audit log +
> rate-limit D2.9, governed-save/branch-routing D2.5). R2 **reuses** them — it adds no auth, no audit sink,
> no raw `queue/` write. Every toggle is a WebAuthn-session-gated, `Origin`-validated, audited governed
> write of a **coordination** artifact (`queue/routing-override.yaml` or a card's `runtime`/`model` field)
> to `ops` via pull-rebase-push. Read surfaces (effective-routing projection) need no gate.

### HUMAN GATE R2.0 — Confirm the D2 foundations are merged (precondition)
- [ ] Confirm dashboard **D2.1** (WebAuthn registration/assertion + short-TTL session), **D2.9**
  (append-only git-committed audit log + rate-limit/lockout middleware), and **D2.5** (governed save /
  target-classified branch routing) are merged to `main` and the running daemon has them. **If any is
  missing, R2 does not start** — R2's writes have nothing to gate on and would either bypass the gate
  (forbidden) or reinvent it (forbidden by ordering-law 5).

### Task R2.1 — Effective-routing projection + override-file reader (parity with the Python resolver)  *(AGENT-BUILDABLE)*
**Goal.** A read-only server module that computes, for every agent and every card, the **effective**
`(runtime, model, source)` by the *same* precedence the Python `resolve()` uses — so the Agents view shows
what dispatch would actually route, with provenance. This is the projection R2.2/R2.3 toggle against.

**Files touched:** `dashboard/server/routing/policy.ts` (`loadPolicy(repoRoot)`, `loadOverride(repoRoot)`
— read `governance/model-routing.yaml` + `queue/routing-override.yaml`, safe-empty on absent/corrupt),
`dashboard/server/routing/effective.ts` (`effectiveForCard(cardMeta, cadence, policy, override)`,
`effectiveForAgent(agentId, policy, override)` — mirror the Python one-winner chain incl. alias resolution
+ expiry), `dashboard/server/routing/effective.test.ts`.

**Failing tests first** (`dashboard/server/routing/*.test.ts`, fixtures mirroring `tests/test_routing.py`):
- `effective.test.ts > card frontmatter runtime/model outranks override and policy`.
- `effective.test.ts > override card-scope beats agent-scope beats policy` (same ordering as the Python
  resolver — a shared fixture set asserts parity).
- `effective.test.ts > expired override entry is ignored`.
- `effective.test.ts > absent/corrupt override or policy falls back safely` (no throw; empty override →
  policy; absent policy → safe default).
- `effective.test.ts > effectiveForAgent reports the source (card|override|policy|default)`.

**Implementation.** Pure readers over the Plane-A index (D0.2 already watches `governance/` and `queue/`).
`effective.ts` is a faithful TS port of the Python precedence — the **authoritative** resolver remains the
Python `routing.resolve` at dispatch; this projection only *displays* effective routing, and a shared
fixture set (the same JSON the Python tests use) guards parity so the dashboard never shows a route
dispatch wouldn't take. No writes.

**Verification.** `npm test -- routing` green.

**Commit message:** `feat(dashboard): effective-routing projection + override reader (parity with Python resolver)`

### Task R2.2 — Agents view roster + per-agent routing toggle (governed override write)  *(AGENT-BUILDABLE)*
**Goal.** An Agents view listing each fleet agent with its **effective** runtime + model (and source
chip), and a per-agent toggle that writes/clears an **agent-scope** entry in `queue/routing-override.yaml`
through the governed WebAuthn path — audited.

**Files touched:** `dashboard/server/agents/roster.ts` (`listAgents(index, policy, override)` — one row per
known agent id: effective runtime/model + provenance, from R2.1), `dashboard/server/write/routingOverride.ts`
(`setOverride(entry, session)`, `clearOverride(scope, key, session)` — validate against the policy registry,
then write `queue/routing-override.yaml` via the D2.5 **coordination** path (`ops` pull-rebase-push) and
emit a **D2.9 audit row**), `dashboard/src/views/Agents.tsx` (roster + per-agent runtime/model toggle).

**Failing tests first:**
- `roster.test.ts > lists each agent with effective runtime+model and source`.
- `routingOverride.test.ts > rejects a setOverride without a valid WebAuthn session` (401).
- `routingOverride.test.ts > rejects an entry whose runtime/model is not in the policy registry` (400 —
  schema validation on write; the resolver's fail-open is a backstop, not the first line).
- `routingOverride.test.ts > setOverride writes queue/routing-override.yaml via the ops pull-rebase-push
  path, never a raw fs.write` (assert on a fake git runner: `pull --rebase origin ops` precedes commit; no
  push to `main`; retries on a rejected push).
- `routingOverride.test.ts > every setOverride/clearOverride emits exactly one D2.9 audit row`.
- `routingOverride.test.ts > clearOverride removes the matching entry (agent-scope) and is idempotent`.

**Implementation.** `setOverride` = session-gate (D2.1) → registry-validate (`runtime ∈ runtimes`, `model ∈
known_models`) → append/replace the agent-scope entry (stamp `set-by`/`set-at`) → write through the D2.5
governed coordination path → D2.9 audit. Never a raw `fs.write` into `queue/`. The Agents view shows the
effective row (R2.1) and, after a toggle, re-reads the projection so the source chip flips to `override`.

**Verification.** `npm test -- agents routingOverride` green.

**Commit message:** `feat(dashboard): Agents view roster + per-agent routing toggle (governed override write, audited)`

### Task R2.3 — Per-card routing toggle (card detail; governed card-field write)  *(AGENT-BUILDABLE)*
**Goal.** On a card's detail view, a runtime/model toggle that writes the card's **frontmatter**
`runtime:`/`model:` fields (the highest-precedence override) through the governed path — the exact write
D3.4's inline DAG-node toggle will reuse.

**Files touched:** `dashboard/server/write/cardRouting.ts` (`setCardRouting(cardId, {runtime, model},
session)` — child-process `scripts/cards.py`'s `stamp_routing` via a small documented module interface
(`python -c "import cards; ..."`) **or** a governed re-save through the D2.5 path; never a raw `queue/`
write; validate against the policy registry; emit a D2.9 audit row; if the R1.0 hash decision was "yes",
include `runtime`/`model` in the `content_hash` preimage), `dashboard/src/views/CardDetail.tsx` (routing bar
+ source chip).

**Failing tests first:**
- `cardRouting.test.ts > rejects setCardRouting without a WebAuthn session` (401).
- `cardRouting.test.ts > writes card runtime/model via scripts/cards.py stamp_routing, never a raw queue
  write` (assert on a fake child-process/git runner: the card is re-saved through the governed coordination
  path; no raw `fs.write`).
- `cardRouting.test.ts > rejects a runtime/model not in the policy registry` (400).
- `cardRouting.test.ts > a card-field override makes the effective projection report source=card` (ties
  R2.1's projection to the write — end-to-end: the toggle changes what the resolver would pick).
- `cardRouting.test.ts > every setCardRouting emits one D2.9 audit row (and, if enabled, binds runtime/
  model into the content_hash preimage)`.

**Implementation.** Session-gate → registry-validate → governed re-save of the card with `stamp_routing`
applied (coordination write → `ops`) → D2.9 audit. Because the card frontmatter field is the top precedence
(proposal §4), this toggle is how Daniel pins one card regardless of policy/override. The write path is
factored so **D3.4's inline node toggle imports `setCardRouting` unchanged** — see the forward-reference.

**Verification.** `npm test -- cardRouting` green.

**Commit message:** `feat(dashboard): per-card routing toggle (governed card-field write, registry-validated, audited)`

### Task R2.4 — Routing audit surfacing (routed-vs-ran + override provenance in the UI)  *(AGENT-BUILDABLE)*
**Goal.** Surface R1.4's routed-vs-ran mismatches and every override's provenance (`set-by`/`set-at`/
`expires`) read-only in the dashboard, so a mis-route or a stale override is visible — no new writes.

**Files touched:** `dashboard/server/routing/audit.ts` (`readRoutingAudit(repoRoot)` — read the `activity`
ledger rows R1.4 writes + the override file's provenance/expiry), `dashboard/src/views/Agents.tsx` (a
"routing audit" strip: mismatches + expiring/expired override entries).

**Failing tests first:**
- `audit.test.ts > reads routed-vs-ran mismatch rows from the activity ledger` (empty-safe when none).
- `audit.test.ts > flags override entries at/near expiry` (surfaces `expires` so a stale pin is visible).
- `Agents.test.tsx > renders the routing-audit strip from a projection (no writes)`.

**Implementation.** Pure projection over the `activity` ledger (R1.4) and the override file. Empty ledgers
render an empty state (the `ledgers/activity/` reality). No governed write — this is observability closing
the enforcement-as-audit loop for a human.

**Verification.** `npm test -- audit` green.

**Commit message:** `feat(dashboard): routing-audit strip (routed-vs-ran mismatches + override provenance/expiry, read-only)`

### Forward-reference — D3.4 DAG node model chip + inline toggle (fold into the D3 wave)
> **Not built in R2 — recorded here so the D3 wave inherits it.** D3.4's React-Flow node bar (Daniel's
> locked D3.4 spec: name, status dot, one-line summary, **mono model chip**, **inline model toggle
> (governed write)**, click-through) reuses R2 wholesale: the **model chip** renders
> `effectiveForCard(...)` from **R2.1** (with the source chip), and the **inline toggle** calls
> **R2.3's `setCardRouting`** unchanged (same WebAuthn gate, same D2.9 audit, same coordination write). No
> new routing write path is introduced in D3 — D3.4 is a second *surface* over R2.3. The deferred
> policy-matrix-as-form and editor routing-bar toggles (locked-decision 2, non-goal N6) also land in the D3
> wave, writing agent/card-scope override entries through R2.2/R2.3's exact governed paths.

**Wave-R2 exit criteria:**
1. **D2 foundations confirmed merged** (HUMAN GATE R2.0); every R2 write is WebAuthn-session-gated,
   `Origin`-validated, rate-limited, and **D2.9-audited**, and routes as a **coordination** write to `ops`
   (pull-rebase-push) — none writes `governance/` and none does a raw `queue/`/`fs.write`.
2. The effective-routing projection (R2.1) matches the Python resolver on a shared fixture set (parity) and
   reports provenance (card|override|policy|default).
3. The Agents view lists each agent's effective runtime/model with a governed **per-agent** toggle (writes
   an agent-scope override entry); the card detail has a governed **per-card** toggle (writes the card
   frontmatter fields — top precedence).
4. Every toggle validates `runtime`/`model` against the committed policy registry before writing (the
   resolver's fail-open is a backstop, not the first line).
5. R1.4's routed-vs-ran mismatches and override provenance/expiry are surfaced read-only.
6. All TS (`vitest`) suites green; **no R2 task edited `dispatch.py`/`cards.py`/`routing.py`.**

---

## Phase R exit criteria (overall)

Phase R is done when all hold:
1. **Governance committed** (R1.0): `governance/model-routing.yaml` + `card-schema.md` routing fields on
   `main`, merged to `ops`.
2. **Fleet consumes routing** (R1): `dispatch.run()` resolves the one-winner precedence at the claim anchor
   and stamps `runtime`/`model`; owner-by-runtime prevents runner races; an unknown named model fails loud
   (`wake-me:unroutable-card`) while corrupt override/policy files fail open to policy; the runner asserts
   `runtime` before work; the soft routed-vs-ran cost-ledger audit runs. The `dispatch.py`/`cards.py` edits
   landed **through the shared serialized dispatch queue after D1**.
3. **Dashboard steers routing** (R2, after the D2 foundations): Agents view + per-agent and per-card
   toggles write the override / card fields through the **existing** governed WebAuthn + audit path; the
   effective-routing projection matches the Python resolver; the routing audit is surfaced.
4. **Enforcement is wired as audit, not a hard block** (month-1-backlog:23 resolved): the routed-vs-ran
   comparison is live over the ledger `model` column; the only fail-closed path is an unknown *named* model
   at claim.
5. **All tests green:** `python -m pytest tests/test_routing.py tests/test_cards.py tests/test_dispatch.py
   tests/test_assert_runtime.py -q` + `npm test` (vitest R2 suites).

## Explicit non-goals (Phase R)

- **N1 — No hard model-id preamble gate.** Enforcement is the soft routed-vs-ran audit (R1.4); `preamble.py`
  is **not** given a per-step model-id assertion. (month-1-backlog:23 is resolved *as audit*, by decision.)
- **N2 — No new ledger kind or schema change.** The audit reuses the existing dynamic `cost`-ledger `model`
  column; no `ledger.KINDS` edit.
- **N3 — Gemini not routed.** The `runtimes` registry has a commented Gemini slot; onboarding it is a later
  data-only edit (memory: Gemini deferred). Phase R ships `claude` + `codex`.
- **N4 — Codex `--model` not driven by default.** `agent_runner.ps1` still lets the Codex CLI pick its own
  model; the routed `model` for codex cards is a recorded intent the audit checks, not a hard input. Wiring
  `codex exec -m <model>` is an optional stretch inside R1.3, flagged, not required.
- **N5 — No transcript-level per-turn model verification.** The audit is card-granular (routed vs the
  ran-model the runner records), not a Plane-B per-turn model check. The Plane-B `message.model` field is
  available to a future deeper audit but is out of Phase-R scope.
- **N6 — Only two of the four toggle surfaces.** Per-agent + per-card ship in R2 (locked-decision 2). The
  policy-matrix-as-form and the editor routing bar are **deferred to the D3 wave** (forward-reference),
  reusing R2's governed write paths — not built in Phase R.
- **N7 — No routing of tool/skill availability.** "Tool routing" in the phase name is scoped to
  runtime+model selection; per-card tool/skill allow-lists are not in Phase R.
- **N8 — R1 does not add a Claude worker runner.** R1 threads routing through the *existing* dispatch +
  codex runner and the dispatcher's own session; standing up dedicated Claude worker runners is the fleet
  plan's Wave-5 concern, which will consume the same `runtime`/`owner` contract R1 defines.

---

## Build-session execution order

**Strictly serial spine:**
- **HUMAN GATE R1.0** (governance commit + `main → ops`) before R1.1 has real-data behavior (R1.1 is still
  built/fixture-tested first).
- **R1.1 (`routing.py`) ∥ R1.2 (`cards.py`)** build in parallel (independent files), each fixture-tested.
- **R1.3 is the serialized `dispatch.py` insertion — it appends after dashboard D1** in the fleet's single
  dispatch worktree (`3.4 → 4.1 → 4.2 → 5.2 → D1 → R1.3`); do it **only after D1 merges**, re-running
  `tests/test_dispatch.py`. R1.4 follows R1.3 (needs the stamped fields + runner).
- **R2 is HARD-GATED on the D2 governed-write foundations** (HUMAN GATE R2.0). Within R2: **R2.1** (read
  projection) first; **R2.2 ∥ R2.3** (the two governed toggles, independent write modules over the same D2
  path); **R2.4** (audit surfacing) last.
- **The D3.4 DAG node chip/toggle + the deferred policy-matrix/editor toggles are folded into the D3 wave**,
  reusing R2.1/R2.3 — not part of Phase R's serial spine.

**Safe to parallelize (independent file sets):** `routing.py` (R1.1) and `cards.py` (R1.2); within R2,
R2.2 and R2.3 (distinct write modules) after R2.1. R1.3 is not parallelizable against other `dispatch.py`
work by construction (the serialized queue).

**Recommended batching:** Session 1 = R1.0 gate + build R1.1 ∥ R1.2 (fixtures). Session 2 = insert R1.3 at
the tail of the fleet dispatch queue after D1 merges, then R1.4. Session 3 (only after the D2 foundations
merge) = R2.0 gate + R2.1, then R2.2 ∥ R2.3, then R2.4. The D3 forward-reference work is picked up by the
D3 wave.
