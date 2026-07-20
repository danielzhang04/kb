# Atlas build — delta design (V0–V2 against kb as shipped 2026-07-19)

**Status:** approved by Daniel 2026-07-19 (conversation gate).
**Amends:** `2026-07-15-atlas-voice-layer-design.md` — every decision in that spec stands unless
named here. This doc reconciles the spec against the kb substrate as it actually shipped in the
four days since, and records the build-scoping decisions Daniel settled on 2026-07-19.
**Companion research:** `2026-07-15-atlas-voice-layer-research.md` + the 2026-07-19 refresh
findings in §6 below.

## 1. Scope and philosophy

Build **V0 → V1 → V2** (V3 phone deferred), in checkpoints. Guiding rule (Daniel, verbatim
intent): Atlas depends on kb's *general* infrastructure — queue, cards, ledgers, dashboards,
governance — never on specific files. It is a platform for running, interacting with, pulling
from, and adding to that infra. Infra changes should surface as small adapter edits inside
Atlas's one integration boundary (§3), not redesigns.

## 2. Layout (settled 2026-07-19)

- **`kb/atlas/`** — everything Atlas *is*:
  - `mcp/` — the kb-MCP server (§3)
  - `worker/` — LiveKit Agents app: wake word, three-lane router, STT/TTS plumbing
  - `config/` — teachable stores: `persona.md`, `intents.yaml`, `preferences.md`,
    `proactivity.md` (spec §7/§10/§10.5 relocated here from `orgs/atlas/`)
  - `tests/`
- **`orgs/atlas/`** — registration stub only: `_index.md`, `STATE.md`, `contract.md`.
  Exists because the constitution, ops-branch write rules, and dashboard/reconcile tooling
  key on `orgs/<project>/`. The empty `atlas-prep` scaffold is retired (nothing to migrate).
- Code lands via work-branch PRs (dashboard precedent); only the org stub rides `ops`.

## 3. kb-MCP boundary (spec §6, made concrete)

One Python **stdio MCP server** over the kb checkout — the *only* door between the voice stack
and kb. Wraps existing `scripts/*.py` rather than reimplementing them.

| Phase | Tools |
|---|---|
| V0 (read) | `read_dashboard`, `read_state(project)`, `queue_summary(state)`, `ledger_rollup`, `running_work` |
| V1 (write-through-governance) | `file_card` (via `scripts/cards.py` → `queue/inbox/` on ops; dispatcher does the rest), `launch_workflow` |
| V2 | `stage_approval` (stages only — §5 V2) |

Never: direct project-tree edits, `governance/` writes, pushes to main.

## 4. Governance deltas (drafted by agents, **committed by Daniel only**)

1. **Scoped-key carve-out** (approved 2026-07-19): a spend-capped Anthropic API key may exist
   *only* in the Atlas worker's own process environment — never in fleet agent env, never in the
   repo. The fleet preamble rule (`ANTHROPIC_API_KEY` unset) is unchanged for all fleet agents.
   Rationale: sub-second conversational turns need the API path; SDK-on-subscription is also not
   Anthropic's sanctioned production path (§6.4).
2. **Spend authorization** in `orgs/atlas/contract.md`: ~$50/mo voice services
   (Deepgram, LiveKit, TTS vendor, fast-lane API), ledgered to `ledgers/cost/atlas-*.tsv`
   under the existing daily budget guard.
3. **Accounts are a human gate**: Deepgram / LiveKit / TTS / scoped Anthropic key are created
   by Daniel at their plan position. Agents never sign up for anything.

## 5. Phasing with pre-flight sweeps and human checkpoints

Every phase **opens** with a sweep proving the infra it leans on works *that day*, and
**closes** with a demo checkpoint Daniel personally verifies.

- **V0 — Loop.** Sweep: kb scripts importable, ops state readable, LiveKit+Anthropic+MCP
  pairing smoke-tested (§6.2 bug). Build: MCP read tools → worker loop (wake word → Flux →
  Claude fast lane → TTS). Checkpoint: ask Atlas about kb state, spoken answer inside the
  latency bar (spec §2). A missed latency bar is a stop-and-reassess gate, not a plow-ahead.
- **V1 — Hands.** Sweep: dispatcher demonstrably consumes an inbox card end-to-end that day.
  Build: reflex lane, `file_card`/`launch_workflow`, completion callbacks (Agent SDK typed
  task events, §6.4), dashboard status panel + orb. Checkpoint: file a card by voice, hear
  its completion callback.
- **V2 — Trust.** Sweep: passkey approval loop verified live. Build: **voice-prepares /
  passkey-completes** approvals — full readback + explicit action-echo confirm *stages* the
  approval; Daniel's WebAuthn passkey tap commits it. Voice never becomes a path weaker than
  the shipped D2.12 T3 bar (this supersedes spec §9's desk-presence-only bar; a config-level
  relaxation remains possible later, Daniel's call). Plus proactivity rules + quiet-moment
  queueing + morning brief on request. Checkpoint: end-to-end spoken approval of a real
  gated action.

## 6. Research refresh (2026-07-19; two Opus 4.8 subagents, model-verified)

1. **Decisive fact holds:** Anthropic still has **no realtime speech API** — cascade stays.
2. **LiveKit Agents 1.6.6** (Windows-compatible; `livekit-plugins-anthropic` 1.6.5 maintained).
   **Named risk:** open bug — MCP-derived tools can crash when paired with the Anthropic LLM
   plugin (livekit/agents #2519). Fallback (either way the MCP server is untouched): the worker
   wraps kb-MCP calls as plain `function_tool`s itself instead of the native MCP attach.
   The V0 sweep tests this pairing before anything builds on it.
3. **Deepgram Flux** healthy; price nearer **$0.0078/min** than the spec's $0.0065 (budget
   impact ≈ $1–2/mo). openWakeWord steady at v0.6.0, Colab training path maintained.
   Cartesia flagship now **Sonic 3.5** (same latency/pricing); ElevenLabs Flash unchanged.
4. **Claude Agent SDK** (`claude-agent-sdk` Python) exposes typed task lifecycle/completion
   events — the V1 async-callback hook. Subscription auth works but is not the sanctioned
   production path → supports the §4.1 carve-out.

## 7. Status surface = dashboard panel

An **Atlas view in the existing dashboard** (orb, LISTENING/THINKING/SPEAKING/MUTED state,
live transcript, running work + badges), fed by a small local worker state endpoint. No bespoke
always-on-top widget in v1; if a pinned browser panel proves insufficient in practice, a tray
widget wrapping the same view is a follow-on, not a redesign. (Resolves spec §13.1.)

## 8. Verification strategy

- Everything testable **without audio hardware**: MCP tools via pytest against a fixture repo
  (dashboard `__fixtures__` pattern); router logic unit-tested on text transcripts; a typed-text
  **debug REPL mode** drives the worker's lanes bypassing STT (doubles as the dev tool).
- Audio-path facts (wake-word trigger rate, real turn latency, barge-in) get a scripted
  measurement harness; numbers land in checkpoint reports, not pass/fail CI.
- Latency measured **per stage** (EOT / TTFT / TTFA) so a miss names the vendor or knob.

## 9. Build execution model

ECC-wave pattern: cards on ops (`project: atlas`), work by **Opus-4.8-or-below** subagents with
specific instructions (model self-reported *and* orchestrator-verified), orchestrator reviews
diffs / runs tests / commits, inspector grades fresh-context, human gates presented one at a
time at their plan positions. Wave-end redundancy/consistency sweep.

## 10. Open items deliberately left to the implementation plan

- Reflex-lane intent matching mechanism (spec §13.3) and engagement-window timeout (§13.4).
- TTS vendor + persona voice — decided by ear from samples during V0 (spec §2/§10).
- Exact worker state-endpoint shape feeding the dashboard panel.
- Deepgram Flux keyterm-boosting support verification (research flagged as unconfirmed).

## 11. Cost-research amendments (2026-07-20, approved by Daniel)

Three Opus 4.8 research agents (model-verified) swept for cheaper equal-functionality alternatives
before any vendor spend. Bar set by Daniel: equal-or-better only — latency/quality bars non-negotiable.

1. **STT — keep Deepgram Flux.** $200 signup credit ≈ 25,600 min ≈ ~7 years at wake-word-gated
   volume; native <300ms in-model EOT is the thing our 500–800ms bar depends on. Successor of
   record when the credit runs out: AssemblyAI Universal-Streaming ($0.0025/min, first-party plugin).
2. **TTS — 3-way bake-off; Deepgram Aura-2 presumed default.** Cartesia/ElevenLabs free tiers
   (20k/10k chars/mo) cannot sustain daily use; Aura-2 rides the same Deepgram credit (~6.7M chars)
   and rates above ElevenLabs on conversational naturalness. Ear-test can still overrule (paid tier
   ~$4–5/mo fits §4.2). Local fallback of record: Kokoro-82M via Kokoro-FastAPI — GPU-gated
   (CPU TTFA ~1.8s misses the bar).
3. **Transport — no LiveKit account for V0–V2.** livekit-agents console mode runs with no LiveKit
   server (docs-verified; credentials only needed for LiveKit Inference, unused here). §4.3's
   LiveKit signup is deferred to V3 phone/SIP. Caveat: no WebRTC AEC in console mode —
   headphones or AEC mic at the desk.
4. **Fast lane — unchanged.** Haiku 4.5 ($1/$5 per MTok) ≈ $10/mo at 30 q/day incl. tool-loop
   cumulative input; $20 cap right-sized; prompt caching inapplicable (stable prefix below Haiku's
   4,096-token cache minimum); no sanctioned cheaper realtime path (§4.1 stance unchanged).
   Task 8 latency harness is API-only (Daniel, 2026-07-20).

Net: expected steady-state spend ≈ **$10/mo** (scoped Anthropic key only); human gate 4 shrinks to
Deepgram + Cartesia-free + ElevenLabs-trial (LiveKit removed).
