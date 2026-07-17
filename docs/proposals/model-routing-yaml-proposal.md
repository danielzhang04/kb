# Proposal — `governance/model-routing.yaml` + ops routing-override file + card-schema routing fields (Phase R)

**Status:** proposal only. `governance/**` and `governance/card-schema.md` are **human-edited only** (kb
constitution). An agent may draft this text; **Daniel** commits `governance/model-routing.yaml` and the
`card-schema.md` addition on protected `main`, then merges `main → ops` so the running fleet reads them.
The **ops routing-override file** (`queue/routing-override.yaml`, §2) is a coordination artifact — it is
*not* under `governance/`, so the dashboard writes it at runtime through the governed path; only its
**schema** is proposed here.

This pairs with `docs/plans/2026-07-17-phase-r-model-routing.md` (R1 = fleet consumption, R2 = dashboard
toggles). Three PROPOSE blocks live here:
- **§1** — the full `governance/model-routing.yaml` (the durable "standard plan"). **Human-committed.**
- **§2** — the `queue/routing-override.yaml` ops-side override **spec** (schema/precedence/TTL). The file
  itself is dashboard-written at runtime; this block defines its contract.
- **§3** — the `governance/card-schema.md` addition for the `runtime:` / `model:` frontmatter fields.
  **Human-committed.**

Precedence across all three is stated once, normatively, in **§4**.

---

## Why this file exists (what is dormant today)

Model/tool routing is **100% prose today** and read by **zero** code (verified this session):

- `routines/roles/*.md` declare a model tier in a bold first line — scout = Haiku, manager = Opus,
  worker = Sonnet (or Codex for coding), inspector = Opus fresh-context — and nothing in `scripts/`
  consults it. `dispatch.py` has **no** model-selection logic; `dispatch.run()` sets `role =
  cadence.get("role", "work")` and stamps `owner`/`autonomy`/`assurance_class`, but never a model.
- `governance/card-schema.md` has **no** `runtime:` or `model:` field.
- `scripts/preamble.py` has **no** per-step model-id assertion — the `month-1-backlog.md:23` line
  ("per-step model-id assertion is prose-only, unenforced — do not trust it until wired") is describing
  exactly this gap.
- The **cost ledger already carries a `model` column** (dynamic header; the `cost` kind only, because
  `agent_runner.ps1` and the M1 dispatch cost row happen to write a `model` key) — but nothing asserts
  it, and it records the model the runtime *actually ran*, read back after the fact, never a *routed*
  intent.

Committing §1 + §3 and building Phase R turns this prose into a two-level policy the dispatcher reads at
claim time and the dashboard can override instantly — with a routed-vs-ran audit closing the loop against
that existing ledger `model` column.

---

## §1 — PROPOSE (human-committed): `governance/model-routing.yaml`

**Exact file path:** `governance/model-routing.yaml` (repo root, sibling to `risk-tiers.md`,
`graders.yaml`, `card-schema.md`).

**Loader contract (how R1 reads it):** `scripts/routing.py:load_policy(repo_root)` reads this file with
the `budget.yaml` pattern — `path.exists()` guard, `yaml.safe_load`, and a conservative built-in default
if absent/empty/malformed (never crash dispatch; log + fall back). See the plan's R1.1.

```yaml
# governance/model-routing.yaml — Phase R "standard plan" (human-committed).
#
# The durable, human-authored routing policy. scripts/routing.py:resolve() reads it at card-claim time
# and maps (role x risk-tier) -> a runtime + a model. This formalizes the model-tier prose in
# routines/roles/*.md (scout=Haiku, manager=Opus, worker=Sonnet/Codex, inspector=Opus) into something
# code enforces. Human-edited ONLY (CLAUDE.md): an agent may PROPOSE edits in docs/proposals/, Daniel
# commits them here. Precedence (exactly one winner): card frontmatter > queue/routing-override.yaml >
# THIS FILE > built-in safe default. See docs/proposals/model-routing-yaml-proposal.md §4.

version: 1

# ---------------------------------------------------------------------------
# runtimes: the registry of execution runtimes and the concrete model ids each
# one knows. This is the authority for "model id unknown to runtime" — resolve()
# fails LOUD (never substitutes) if a resolved (runtime, model) pair is not
# listed here. `default_worker` is the owner id dispatch claims a card as when a
# cadence does NOT pin `agent:` and the resolved runtime needs an owner; each
# such worker id must be one a runner is bound to (agent_runner.ps1 -Agent ...).
# `aliases` map policy-level tier names (opus/sonnet/haiku/codex) to the exact
# published model id, so the policy block below stays readable and model-id
# churn is a one-line edit here.
# ---------------------------------------------------------------------------
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus:   claude-opus-4-8     # manager / inspector / consolidate tier
      sonnet: claude-sonnet-5     # worker (volume) tier
      haiku:  claude-haiku-4-5    # scout (cheap fan-out) tier
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker  # the identity agent_runner.ps1 -Agent codex-worker owns
    aliases:
      codex: gpt-5-codex          # CONFIRM the exact Codex CLI model slug at commit time; the
                                  #  codex runner does NOT pass --model today (R1.3 optionally wires
                                  #  `codex exec -m`), so for codex-runtime cards `model` is a RECORDED
                                  #  INTENT the routed-vs-ran audit checks against the read-back id,
                                  #  not a hard input — see the plan's R1.3 / non-goal N4.
    known_models: [gpt-5-codex]
  # gemini: deferred (memory: Gemini deferred). Add a block here when it onboards; no code change
  #   needed beyond listing its known_models — resolve() is data-driven off this registry.

# ---------------------------------------------------------------------------
# policy: the role x tier matrix. Key 1 = role (cards.py ROLES: scout|manage|
# work|inspect|consolidate). Key 2 = risk-tier ("T1"|"T2"|"T3"), or "*" to apply
# to every tier for that role. Value = {runtime, model-alias}. resolve() looks up
# policy[role][tier], falling back to policy[role]["*"], then to role_default.
# The model value is an ALIAS resolved through runtimes.<runtime>.aliases.
# ---------------------------------------------------------------------------
policy:
  scout:
    "*": { runtime: claude, model: haiku }      # scouts are cheap and disposable
  manage:
    "*": { runtime: claude, model: opus }       # managers make the trusted judgment calls
  work:
    T1: { runtime: claude, model: sonnet }
    T2: { runtime: claude, model: sonnet }
    T3: { runtime: claude, model: opus }        # T3 coding gets the strong tier
  inspect:
    "*": { runtime: claude, model: opus }       # grading runs on the strongest tier, fresh context
  consolidate:
    "*": { runtime: claude, model: opus }       # consolidate = fresh-context judge, per the Inspector principle

# ---------------------------------------------------------------------------
# role_default: last resort inside THIS file when policy[role] has no entry for
# the card's role/tier (e.g. a future role). This is the "role-prose default"
# rung of the precedence chain, formalized. It is NOT the corrupt/missing-file
# fallback — that is the hard-coded safe default in scripts/routing.py (claude +
# sonnet), which applies only when this whole file is unreadable.
# ---------------------------------------------------------------------------
role_default: { runtime: claude, model: sonnet }
```

**Model-id accuracy note (for the committer).** The three Claude ids are the current published strings
(`claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`); do not append date suffixes. The Codex alias
(`gpt-5-codex`) is a placeholder for the Codex CLI's own default model slug — **confirm the exact slug**
against `codex` before committing, since it is the one value here not pinned by the Claude model catalog.
Because the codex runner does not pass `--model` today, a wrong codex slug only mis-labels the
routed-vs-ran audit; it never mis-drives a Claude card.

---

## §2 — PROPOSE (spec only; dashboard-written at runtime): `queue/routing-override.yaml`

**Path (proposed):** `queue/routing-override.yaml`.

**Why this path.** It must be a **coordination artifact**, not governance: the dashboard writes it
*instantly* when Daniel flips a toggle, so it cannot live under human-committed `governance/**`. `queue/`
is already the fleet's coordination root (cards, plus the D1 files-only `queue/paused/<cadence>` markers),
lives on `ops`, and is the natural sibling for another files-only, dashboard-writable, `ops`-committed
sentinel. A single top-level file (not a per-entry directory like `queue/paused/`) is chosen because the
resolver must read the *whole* override set on every claim and the dashboard rewrites it atomically under
one governed write. It does **not** collide with the four real `queue/` subdirs (`inbox/ working/ done/
approvals/`) or with `cards.py` state routing.

**Schema:**

```yaml
# queue/routing-override.yaml — ops-side fast routing override (dashboard-written, WebAuthn-gated,
# audited). NOT governance: this is a coordination artifact the dashboard writes at runtime through the
# governed ops path (pull-rebase-push). scripts/routing.py:load_override() reads it override-over-policy
# at claim/spawn time. Absent / empty / malformed -> treated as {overrides: []} (fall back to policy),
# logged, never crash dispatch. Human hand-edits are allowed but the dashboard is the normal writer.
version: 1
overrides:
  - scope: agent            # "agent" | "card"
    key: codex-worker       # scope=agent -> matches cards whose `owner` == key
                            # scope=card  -> matches the card whose `id` == key
    runtime: claude         # optional; must be a key under governance/model-routing.yaml runtimes
    model: claude-opus-4-8  # optional CONCRETE id (not an alias); must be in that runtime's known_models
    expires: 2026-07-18T00:00:00Z   # optional ISO-8601; past/at -> entry ignored (treated as absent), logged
    set-by: daniel@webauthn         # audit provenance (who wrote it)
    set-at: 2026-07-17T14:03:00Z    # audit provenance (when)
  - scope: card
    key: 6a5950ae-19654711
    model: claude-sonnet-5  # a card-scope entry may set only `model`, leaving runtime to policy
    expires: null           # null / omitted = no expiry
    set-by: daniel@webauthn
    set-at: 2026-07-17T14:05:10Z
```

**Override-file precedence & semantics:**
- **Entry ordering (within the file).** For a given card, a `scope: card` entry whose `key == card.id`
  outranks a `scope: agent` entry whose `key == card.owner`. If two entries have the same scope+key, the
  **last** one in the list wins (dashboard appends; a "clear" removes the entry). Exactly one entry is
  selected — see §4 for how it slots into the global chain.
- **Partial overrides.** An entry may set `runtime` only, `model` only, or both. A field left unset
  **falls through to the next-lower precedence source** for that field alone (so `model`-only card-scope
  entry keeps the policy's runtime). resolve() composes the winner field-by-field but records the single
  highest source that supplied each field, so the audit trail is unambiguous.
- **TTL.** `expires` (ISO-8601, or `null`/omitted for none). An entry at/after its `expires` is treated
  as **absent** by the resolver (falls through to policy) and logged — the resolver never mutates the
  file. A separate governed "prune expired" action (dashboard button or a cadence) rewrites the file to
  drop dead entries; it is not required for correctness, only hygiene.
- **Reset.** Full reset = the dashboard writes `overrides: []` (or deletes the file). Absent file ≡ empty
  overrides ≡ pure-policy routing.
- **Corrupt/missing.** `load_override()` returns `{"overrides": []}` on missing/empty/unparseable/
  schema-invalid content, emits a WARN, and dispatch proceeds on policy. A corrupt override file must
  **never** freeze or misroute the fleet — fail *open to policy*, not closed.
- **Validation on write (R2).** The dashboard validates every entry before committing: `runtime` ∈ the
  policy's `runtimes`; `model` ∈ that runtime's `known_models` (concrete id, not alias); `scope` ∈
  {agent, card}; `expires` parseable. An invalid toggle is rejected at the API, so the resolver almost
  never sees a bad entry — but it still fails open if it does.

---

## §3 — PROPOSE (human-committed): `governance/card-schema.md` routing fields

Doc side of the R1 `cards.py`/`dispatch.py` edits (the `runtime:`/`model:` frontmatter fields). Daniel
reviews and commits into `governance/card-schema.md` on `main`, then merges `main → ops`.

Current normative frontmatter block ends (verified) with:

```yaml
role: scout|manage|work|inspect|consolidate  # consolidate = judge card
session-id: <str|null># executing worker's Claude Code session id
```

**Proposed addition (two new lines immediately after `session-id`):**

```yaml
runtime: <claude|codex|null>  # SET BY dispatcher/routing ONLY (never from untrusted text) — the
                              #  execution runtime this card is routed to. Resolved at claim time from
                              #  the routing precedence (card > queue/routing-override.yaml >
                              #  governance/model-routing.yaml > safe default) and stamped onto the card.
                              #  A non-null value here is the HIGHEST-precedence routing input (a per-card
                              #  override, e.g. from the dashboard per-card toggle). null on legacy cards.
                              #  A runner asserts card.runtime == its own runtime before executing and
                              #  fails loud on mismatch. Inert metadata; never parsed as instructions.
model: <str|null>             # SET BY dispatcher/routing ONLY. The CONCRETE model id routed for this
                              #  card (e.g. claude-opus-4-8), resolved alongside `runtime`. A non-null
                              #  value is a per-card model override outranking policy. Recorded to the
                              #  cost ledger `model` column at run time for the routed-vs-ran audit. For
                              #  codex-runtime cards it is a recorded intent (the codex runner may not
                              #  pass --model). null on legacy cards. Inert metadata.
```

**Parse/act boundary.** `runtime`/`model` join `action`/`target`/`risk-tier` as **dispatcher-authored,
never-from-untrusted-text** fields (same rule the schema already states for `action`/`target`). A card
body, `## Evidence`, or `## Feedback` can never set them.

**Hash-binding note (do not "fix" silently).** The existing card-schema hash note says the dashboard
WebAuthn `content_hash` preimage covers `action`/`risk-tier`/`owner`/`target`/`## Work order`; a new
`runtime`/`model` field is **not** automatically covered. **Recommendation:** because the dashboard
per-card routing toggle (R2) is a governed write that changes `runtime`/`model` on a card, add both fields
to the dashboard `content_hash` preimage so a routing change is tamper-evident, and record that decision
here. (This is a dashboard-hash change only; it does **not** touch the fleet `payload_hash`, which
deliberately binds `action`+`target`+work-order only — the two channels canonicalize differently on
purpose.) Left as a flagged recommendation for the committer, not a silent unification.

---

## §4 — Precedence (normative; exactly one winner)

Routing resolves at card **claim** time (`dispatch.run()`, immediately after `cards.claim(card, owner)`)
and again wherever the dashboard computes *effective* routing for display (R2). The chain has exactly one
winner, evaluated top-down, field-by-field for `runtime` and `model` independently:

1. **Card frontmatter** — `card.meta["runtime"]` / `card.meta["model"]`, when non-null. Set by the
   dispatcher for the self-routing case, or by the dashboard **per-card toggle** (R2, governed write of
   the card). Highest authority: a human pinned this card.
2. **`queue/routing-override.yaml`** — the highest-ranked matching, non-expired entry (card-scope key ==
   `card.id` beats agent-scope key == `card.owner`). The dashboard's **fast override** surface
   (per-agent toggle writes an agent-scope entry; a policy-matrix/editor override may write either).
3. **`governance/model-routing.yaml` policy** — `policy[role][tier]` → `policy[role]["*"]` → the file's
   `role_default`. The durable human "standard plan".
4. **Built-in safe default** — hard-coded in `scripts/routing.py` (`runtime: claude, model:
   claude-sonnet-5`). Reached only when the policy file itself is unreadable. Guarantees dispatch never
   stalls for lack of a route.

`resolve()` returns `(runtime, model, source_runtime, source_model)` where each `source_*` ∈ {`card`,
`override`, `policy`, `default`} — the provenance the audit and the dashboard display use. **Unknown-model
guard:** after composing the winner, resolve() verifies `model` ∈
`runtimes[runtime].known_models`; if not, it raises `RoutingError` (fail loud) — dispatch converts that to
a `wake-me:unroutable-card` card (mirroring the existing `wake-me:unknown-tier` pattern) and skips
dispatching that card, **never** substituting a default silently.

**Runtime-split / no-race rule.** The resolved `runtime` determines **which runner executes the card**,
expressed through the existing single-valued `owner` pickup: `agent_runner.ps1 -Agent <id>` claims only
cards whose `owner == <id>`, and each runner is bound to exactly one runtime's worker identities (the
`default_worker` per runtime in §1). So two runners never both match one card — `owner` is single-valued.
The stamped `runtime` field is the runner's **pre-execution assertion** (`card.runtime == myRuntime` or
fail loud — catches a mis-owned card) and the audit record; it is not itself the pickup key. When a
cadence does not pin `agent:`, dispatch selects `owner` from the resolved runtime's `default_worker` so
the correct runner picks it up. See the plan's R1.2/R1.3.

---

## §5 — How to apply (for Daniel)

1. **Confirm the Codex model slug** (§1 `runtimes.codex.aliases.codex` + `known_models`) against the
   installed `codex` CLI; correct it if `gpt-5-codex` is not the exact slug.
2. **Commit `governance/model-routing.yaml`** (§1) on a fresh checkout of protected `main`:
   ```
   git commit -m "gov(model-routing): add Phase R standard plan (runtimes registry + role x tier policy)"
   ```
3. **Commit the `card-schema.md` addition** (§3) — paste the two `runtime:`/`model:` lines after
   `session-id`, plus the parse/act and hash-binding notes:
   ```
   git commit -am "gov(card-schema): add dispatcher-authored runtime/model routing fields (Phase R)"
   ```
4. **Merge `main → ops`** so the running fleet + dashboard read both:
   ```
   git checkout ops && git pull --rebase origin ops && git merge main --no-edit && git push origin ops
   ```
   Do this **before** the R1 fleet consumption task runs against `ops`.
5. The **override file** (§2) needs no commit — the dashboard creates `queue/routing-override.yaml` on the
   first governed toggle (R2). Until then, absent ≡ pure-policy routing.
