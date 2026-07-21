# Atlas V2a "Trust" — design (voice-stages / passkey-completes approval loop)

**Status:** DRAFT — awaits Daniel's conversation gate (the same gate V0 and V1 passed).
Nothing here is authorized to build until that gate.
**Amends:** `2026-07-19-atlas-build-delta-design.md` §5 (V2 row) and §3 (V2 tool row) — this doc
takes only the *approval-loop* portion of that V2 row and designs it in full. Every other decision
in the delta design and the V1 hands design stands.
**Supersedes:** `2026-07-15-atlas-voice-layer-design.md` §9 ("Spoken approvals" / "desk presence =
identity") — that voice-only-commit bar is **refuted** and listed as a non-goal in §4 with its
rationale. The delta design already began this reversal; this doc completes it.
**Written after:** V1 "Hands" merged live (PR #44 = `aa35b00`, prod 5317, 10 cards graded 95–97).
Informed by the 2026-07-21 go/no-go brief, whose **Option (b)** Daniel approved: V2a = the approval
loop *only*; proactivity / quiet-moment queueing / morning brief deferred to **V2b**; the
engineering-debt backlog split out to a separate **Atlas maintenance** card.

## 0. One-line intent

**Voice stages an approval; Daniel's WebAuthn passkey tap commits it.** Atlas never commits an
approval and never becomes a path weaker than the shipped D2.12 T3 bar. A new MCP tool
`stage_approval` writes (or moves) a card to the existing `approvals` boundary and stops there; the
already-shipped dashboard WebAuthn path (`POST /api/approvals/verify`, D2.3/D2.4) is the *only* thing
that commits. This preserves the V1 trust floor verbatim: everything Atlas does is read-only or lands
as a supervised card; Atlas never claims, transitions, self-assigns, or executes.

## 1. Scope

V2a adds exactly one capability: a **voice front-end to the human approval gate**, split across a
hard trust boundary.

- **Voice STAGES.** In an engaged session, Atlas can *surface* a card that is sitting at (or is
  eligible for) the approval boundary, read it back in full, take an explicit action-echo confirm,
  and — only then — call `stage_approval`, which parks the card in `queue/approvals/` (state
  `approvals`) so it shows up in the dashboard Human Inbox as a Decision awaiting verification.
  Staging mints **no approval**; it moves a card to the place where a human *can* approve it.
- **Passkey COMMITS.** Daniel taps his WebAuthn passkey in the dashboard, exactly as he does today
  (`buttonsFor(card)` → WebAuthn button → `POST /api/approvals/verify` with `channel: 'webauthn'` →
  `driveVerify` → `scripts/webauthn_verify.py` dispatcher-side assertion re-check → pinned-content
  execute + ops audit row). **No Atlas code path touches that route, the passkey, the credential
  store, or the assertion.** V2a changes nothing on the commit side; it only feeds the boundary.

Checkpoint (§9): Daniel speaks a real gated action to Atlas, hears the full readback, confirms by
echoing the action, watches the card appear as a Decision in the Human Inbox, taps his passkey, and
sees it commit and audit — one end-to-end spoken-stage / passkey-commit of one real T3 action.

**Sequenced, like V1:** the `stage_approval` tool + readback discipline land first as testable
units; the desk end-to-end is the closing human gate. No dashboard write-back is added — the
dashboard remains the read-only mirror V1 reaffirmed, plus the *already-existing* WebAuthn verify
route (which Atlas does not call).

**Deferred (named so they don't silently vanish) → V2b:** proactivity rules, quiet-moment queueing,
morning brief on request. **→ Atlas maintenance card:** `app.py` extraction (444 lines), console
`--input-device` by name substring, TTFT diet, spoken voice-switch, Bluetooth hot-follow output
routing, SSE panel push (replacing the 1s poll), Agent SDK typed task events. Neither set is V2a
scope and neither is designed here.

## 2. Where this rides in the substrate (integration points, real files)

Atlas keeps its single integration boundary — the kb-MCP server (`atlas/kbmcp/`) — and the dashboard
keeps its already-shipped approval surface. V2a wires the two through the *card queue*, never through
a new channel.

**The commit side already exists and is untouched by V2a.** For reviewers, the load-bearing files:

- `dashboard/server/approvals/routes.ts` — `GET /api/approvals` (read-only corroboration feed) and
  `POST /api/approvals/verify` (session-gated; the WebAuthn channel performs the dispatcher-side
  assertion re-check that *is* the T3 boundary). Atlas calls **neither**.
- `dashboard/server/approvals/inbox.ts` — `driveVerify(cardPath, channel, deps)` shells the verifier
  for the card's channel; only a `webauthn` success triggers the pinned-content `execute`. The
  verifier prints one JSON line and **never writes `queue/`** — the pinned `.card` bytes are the sole
  authority. Unchanged.
- `dashboard/server/approvals/humanInbox.ts` — `classify()` surfaces any `state === 'approvals'` card
  as a **Decision** with `buttonsFor(card)` gating, and treats an `approve:*` action as an operator
  gate via `isHumanGate()`. This is where a staged card *appears* for Daniel. Unchanged — V2a relies
  on it, adds nothing to it.
- `dashboard/server/approvals/assurance.ts` — `buttonsFor(card)` decides, purely from the
  fleet-emitted `card.meta.assurance_class`, which channels a card offers. A novel/first-ever T3
  (`T3-novel`) or any unknown class fails closed to **signed + WebAuthn only** (no possession/tap).
  V2a inherits this fail-closed cutline unchanged.
- `scripts/webauthn_verify.py` (D2.3) + the SHA-anchored credential store (D2.12, passkey armed for
  localhost, sentinel pinned) — the actual assertion verifier. **Not read, not touched, not proxied**
  by Atlas.

**The stage side is the only new code.** `stage_approval` rides the *existing* `file_card` mechanics
(V1 §6): `scripts/cards.py` → write a card into `queue/` on the **ops** worktree via the same
injected git seam V1 already uses (pull-rebase-before-write, rejected-push→reconcile→retry). The one
difference from `file_card` is the target state/section — see §3. No new vendor, no new key, no new
route, no new credential. Same key-free discipline that made V1's `GET /state` provably key-free: the
worker's process env never appears in a staged card, and `stage_approval` never reads it.

## 3. The `stage_approval` MCP tool (new — the only new surface)

Added to the single tool registry (V1 §6 consolidated the four edit-sites into one). Signature is
deliberately narrow and mirrors `file_card`:

```
stage_approval(card_id, readback_ack, session_transcript_ref) -> { staged: bool, card_id, state }
```

**Contract (binding):**

1. **Stages only, never commits.** Its sole effect is to place an *already-existing* card at the
   approval boundary (`state: approvals`, file in `queue/approvals/`) so the Human Inbox shows it as
   a Decision. It writes **no** `approval` field, **no** approval record, **no** assurance verdict —
   those are minted only by `scripts/webauthn_verify.py` behind Daniel's passkey. If a caller ever
   supplies an `approval`/`verified`/`assurance` value, the tool rejects the call.
2. **Never touches a credential/passkey as an object.** It does not read, create, or reference the
   credential store, the WebAuthn assertion, the challenge/nonce, or any key. It cannot — it only
   moves a card file. This is the credentials-as-objects hard ceiling; flag loudly in review.
3. **Operates on a card Atlas did not mint the authority for.** `stage_approval` takes an existing
   `card_id` (typically one Atlas or the fleet already filed, now eligible for approval). It does
   **not** invent the gated action inside the approval call — the action, target, and risk-tier are
   whatever the card already carries and were minted through the normal card path. Staging is a
   *routing* act, not an *authoring* act.
4. **Read-back is structurally required.** Like V1's `file_card` (`confirmed: true` schema flag), the
   tool requires `readback_ack` — a boolean the LLM may only set after it has read the card's
   action / target / risk-tier / scope aloud and received an explicit action-echoing confirm (§5).
   Persona/system instructions carry the standing rule; the schema makes a bare call impossible.
5. **Auditable surface.** The staged card is stamped so the surface is traceable exactly like
   `file_card`'s `workflow: atlas-voice` stamp — a `staged-by: atlas-voice` marker plus the
   `session_transcript_ref` linking to the voice transcript ledger (V1 §5), so every staging has a
   retained spoken-confirm trail alongside it.
6. **Supervised, per contract.** `orgs/atlas/contract.md` classes filing-on-behalf-of-the-user as
   *queues-for-me* (supervised until graded). Staging is the same posture: it queues a decision *for
   the human*, it does not act. It never appears in `acts-alone`.

**What `stage_approval` explicitly may NOT do:** commit or verify an approval; call
`/api/approvals/verify`; write to `queue/done/` or transition a card past `approvals`; self-assign or
set `owner`; touch `ledgers/grades/**` or `ledgers/activity/**`; launch or execute anything. Any of
these voids the trust floor and is a wake-me trigger.

## 4. Non-goals (binding)

- **Voice-only commit / "desk presence = identity" (the refuted bar).** The 2026-07-15 spec §9
  proposed that Atlas commit approvals itself under Daniel's git identity, justified by "anyone at the
  unlocked PC could already approve via browser; Atlas adds no weaker path." This is **refuted and
  out of scope.** Refutation rationale: (a) `governance/risk-tiers.md` (D2.13) pins **T3 → the
  dashboard/WebAuthn-signed channel ONLY; the weak/unsigned transport MUST NOT authorize a T3
  action** — a spoken confirm is exactly such a weak, unsigned, replayable transport. (b) D2.3/D2.12
  made the WebAuthn assertion (SHA-anchored credential store, dispatcher-side re-check) *the* T3
  boundary; a voice path that mints the approval bypasses that boundary by construction. (c) "Desk
  presence" is not authentication: a spoken phrase can be uttered by anyone in the room, replayed, or
  synthesized, and carries no cryptographic binding to Daniel's authenticator. The passkey tap does.
  V2a therefore keeps voice strictly on the *stage* side of the boundary; the commit stays on the
  passkey. (A later config-level relaxation remains theoretically Daniel's call, but is **not** in
  this design and would itself need a fresh gate — it is not assumed here.)
- **Proactivity, quiet-moment queueing, morning brief.** → V2b, after V1 desk soak informs them.
  Their unattended-execution and spend-creep risks are exactly what soak should shape.
- **Engineering-debt backlog** (`app.py` extraction, input-device-by-name, TTFT diet, voice-switch,
  Bluetooth hot-follow, SSE push, Agent SDK typed events). → a separate Atlas maintenance card. Not a
  Trust capability.
- **Any handling of a credential as an object** (create/read stores/modify), and **any unattended
  execution** — Atlas never claims, transitions, self-assigns, or executes; nothing runs on its
  spend-capped key. Unchanged hard ceilings.
- **Dashboard write-back from Atlas.** The dashboard stays the read-only mirror (V1 reaffirmed).
  V2a adds no route and calls no write route; the WebAuthn verify route is driven by Daniel's tap in
  the browser, not by Atlas.

## 5. The readback + action-echo confirm (the stage-side integrity control)

Staging is the one place voice touches the approval path, so the spoken discipline is the stage-side
analogue of the passkey — it does not *authenticate*, but it prevents a mishear or a loose "yes" from
parking the wrong card at the boundary. Mirrors and tightens V1's `file_card` read-back:

1. **Full readback before any stage.** Atlas reads back, at minimum, the card's **action, target,
   risk-tier, and scope signal** (e.g. "T3 merge of PR #NN into main"). The exact verbatim contents
   the readback must include are an open question (§8) — this doc pins that it is *at least* those
   four fields, drawn from the card's own frontmatter, never paraphrased into something softer.
2. **Action-echo confirm only.** A bare "yes" is insufficient (carried from spec §9). The confirm
   must echo the action or the card — "stage the merge of card 7", "yes, stage the PR-42 merge".
   "Show me first" surfaces the card/diff on screen (read-only). "Reject" and "later" are first-class
   and stage nothing.
3. **Confirm gates the schema flag.** Only after (1) and (2) may the LLM set `readback_ack: true`.
   The persona carries this as a standing rule with a persona-test (the V1 confirm-rule test
   precedent); the schema refuses a stage without the flag.
4. **The readback is a courtesy, not a credential.** It never substitutes for the passkey. Even a
   perfect readback + confirm only *stages*; Daniel's tap is still required to commit. This asymmetry
   is the whole design.

## 6. Prerequisite gates (in plan order)

Following the delta design's "every phase opens with a same-day sweep, closes with a desk checkpoint"
discipline. These are **binding gates**, not aspirations:

- **(P1) Same-day live passkey approval sweep — BEFORE any V2a build.** On the build day, prove the
  shipped WebAuthn commit path works end-to-end at the desk: a real card at `state: approvals`,
  tapped and committed via `POST /api/approvals/verify` (`channel: webauthn`), producing a verified
  ops audit row. This is the delta §5 "passkey approval loop verified live" opener. A failed sweep is
  a stop-and-reassess gate, not a plow-ahead. (P1 is a *build-day* verification, not a build blocker
  for authoring this spec.)
- **(P2) T3-grade adversarial security review as an explicit wave stage.** The approval loop is a T3
  security surface, not a feature (go/no-go risk #1). The wave includes a dedicated adversarial
  review stage — fresh-context, reading the `stage_approval` implementation and its tests against the
  invariants in §3 and the threat model in §7 — whose explicit job is to try to find a path by which
  voice commits, or by which staging opens anything weaker than the WebAuthn-signed channel. This
  stage must pass before the desk checkpoint.
- **(P3) Desk checkpoint = end-to-end spoken staging + passkey commit of one real gated action.**
  The closing human gate (§9). Daniel personally verifies the full loop on a genuine T3 action.

## 7. Threat-model sketch — ways the loop could degrade the T3 bar, and the invariant that blocks each

The design's job is to make it *structurally impossible* for the voice side to weaken the passkey
bar. Enumerated failure modes and the blocking invariant for each:

| # | Degradation path | Blocking invariant |
|---|---|---|
| 1 | **Voice commits directly** — `stage_approval` (or a sibling) writes an `approval` field / verified record. | The tool writes only card *state/location*; it rejects any `approval`/`verified`/`assurance` input and has no code path to the verifier. Only `scripts/webauthn_verify.py` behind the passkey mints an approval. (§3.1, §3.2) |
| 2 | **Staging forges a stronger assurance class** to unlock a weaker channel (e.g. stamps `T3-established` to surface a possession/tap button on a novel T3). | `assurance_class` is fleet-emitted (`promotion.decide()`), read-only to the dashboard; `buttonsFor` fails closed to signed+WebAuthn for anything it doesn't recognize, and `verify_telegram_approval`'s F4 check re-enforces "no possession for novel T3" dispatcher-side. `stage_approval` never sets `assurance_class`. |
| 3 | **Mishear / wrong card staged** — Atlas parks the wrong action at the boundary, and Daniel taps trusting the readback. | Full readback of action/target/risk-tier/scope from the card's own frontmatter + action-echo confirm gate `readback_ack` (§5); and the passkey commit shows the pinned card view — Daniel still sees what he is signing, independent of the spoken readback. |
| 4 | **Replay / spoofed voice** confirms a stage (someone in the room, a recording, TTS synthesis). | Staging is not authentication — a spoofed confirm can at worst *stage* a card; it cannot commit. The commit requires the WebAuthn assertion bound to Daniel's authenticator, which a voice replay cannot produce. (§4 refutation, §5.4) |
| 5 | **Weak-channel smuggling** — a staged card offers or routes to Telegram/possession for a T3. | `buttonsFor` + `POSSESSION_ADMISSIBLE` gate channels from assurance class, not from who staged; a T3-novel card shows only signed+WebAuthn. `stage_approval` cannot alter that. D2.13 rule holds: weak transport MUST NOT authorize T3. |
| 6 | **Credential-as-object leak** — the tool reads/persists the passkey, credential store, or an assertion. | `stage_approval` only moves a card file; it has no reference to the credential store, challenge, nonce, or assertion. Provably key-free like V1 `/state`; the worker's process env never enters a staged card. (§3.2) |
| 7 | **State-jump** — staging transitions a card past `approvals` (to `done`/executed), skipping the gate. | The tool's only legal target is `state: approvals` / `queue/approvals/`; it may not write `queue/done/`, set `owner`, or transition beyond the boundary. Anything else voids the trust floor (wake-me). (§3 "may NOT do") |
| 8 | **Unattended staging loop** — Atlas stages on its own initiative / on a timer, flooding the gate. | Staging happens only inside an engaged session after a spoken readback+confirm; there is no proactive/timer path in V2a (proactivity is V2b, explicitly out). Contract keeps staging *queues-for-me*, never `acts-alone`. |
| 9 | **Audit gap** — a staged (or mis-staged) card leaves no trail. | Every stage is stamped `staged-by: atlas-voice` + `session_transcript_ref` into the retained voice transcript ledger (§3.5); the commit path already writes an ops audit row on success (`routes.ts` FINDING 3). |

The invariant that subsumes the table: **voice can only ever move a card *to* the boundary; crossing
the boundary requires the passkey, which voice cannot reach, forge, or replay.**

## 8. Open questions for the conversation gate

These are design decisions I could **not** settle from the sources. They are surfaced honestly rather
than silently decided; each needs Daniel's call at the gate before the plan is written.

1. **Which card states/tiers may `stage_approval` target?** Does it stage only cards already sitting
   in `inbox`/`working` that carry an `approve:*` action or `owner: human-operator` gate, or may it
   also stage T1/T2 cards (which D2.13 allows over weaker channels anyway, making voice-staging them
   lower-value)? Recommended default: T3 gated actions only (that is the capability's whole point),
   but this is unconfirmed.
2. **May Atlas stage a card it did not itself file?** E.g. a merge card the fleet produced. §3.3
   assumes yes (staging is routing, not authoring), but the eligibility set (any pending card? only
   `atlas-voice`-stamped ones? only ones surfaced in this session?) is undecided.
3. **Staging-card TTL / expiry.** Spec §12 mentioned a "24h expiry" on the approval hash. Does a
   *staged* card expire if not tapped within some window, auto-reverting out of `approvals`? Or does
   it simply sit in the Human Inbox until Daniel acts? No TTL mechanism exists in the read code today.
4. **What must the readback contain verbatim?** §5 pins *at least* action/target/risk-tier/scope, but
   the exact required fields and phrasing (does scope mean diff size? test state? PR number?
   dependency count?) and whether the readback must quote the card body's Work order are unsettled.
5. **Error / timeout UX.** What does Atlas say and do when: the WebAuthn tap never comes (Daniel
   walks away)? the sweep (P1) is failing that day? `stage_approval` can't reach ops (git rejected)?
   the card vanished/changed between readback and stage? None of these spoken flows are specified.
6. **Does a staged approval appear specially in the Human Inbox, or identically to any other
   `approvals` card?** Today `classify()` renders every `state: approvals` card as a Decision with no
   notion of "voice-staged." Should the Inbox badge that Atlas staged it (and show the transcript
   ref), or stay channel-agnostic? Adding a badge touches `humanInbox.ts` — in scope or not?
7. **Does staging require the card to already be at the `approvals` boundary, or may `stage_approval`
   *move* a card into it?** i.e. is Atlas allowed to transition `inbox → approvals`, or may it only
   surface cards the fleet already moved there? This is the sharpest boundary question — moving a card
   into `approvals` is itself a state transition, which brushes the "never transitions" floor and
   needs an explicit ruling.
8. **Confirm-phrase strictness.** How strict is "action-echo"? Must it name the card id, the action
   verb, or either? What's the fallback when Atlas can't parse an unambiguous echo — re-ask, or
   refuse to stage?
9. **Relationship to `launch_workflow`.** Some gated actions are launches. Is voice-staging a
   *launch* approval in V2a scope, or only static approvals (merge/publish/deploy)? Undecided.

## 9. Human checkpoint (closing gate)

**Gate:** end-to-end, on a real gated action. Daniel speaks the action to Atlas → hears the full
readback (action/target/risk-tier/scope) → gives an action-echoing confirm → Atlas calls
`stage_approval`, the card lands in `queue/approvals/` → Daniel sees it as a Decision in the dashboard
Human Inbox with the WebAuthn button → he taps his passkey → the existing verify path commits it and
writes the ops audit row. Verified personally, like V0's loop and V1's card-by-voice. A miss anywhere
is a stop-and-reassess, not a plow-ahead.

## 10. Verification strategy

V1/V0 discipline unchanged — everything testable without audio hardware, and the security surface
tested hardest:

- **`stage_approval` unit tests** against the conftest `kb_fixture` (real card schema) + a throwaway
  git repo with a local bare remote for the ops seam (the V1 §5/§10 pattern). Assert: it writes only
  state/location; it rejects `approval`/`verified`/`assurance` inputs; it never sets `owner`,
  `assurance_class`, or a done state; it never reads process env; the `staged-by` + transcript stamps
  are present.
- **Boundary tests** proving the tool has no reference to the credential store, verifier, or verify
  route — a grep-level and a call-graph assertion that `stage_approval`'s module imports nothing from
  the auth/approvals commit path.
- **Readback discipline** exercised through the REPL (typed, no audio): a stage is refused without
  `readback_ack`; the persona confirm-rule test extends the V1 standing test to cover staging.
- **Adversarial review stage (P2)** as a first-class wave node — the explicit T3 security review of
  the whole loop against §7.
- **Desk facts** (the spoken loop, the tap, the audit row) verified only at the §9 human gate.

## 11. Execution model

Same as V1 (§11 there): cards on ops (`project: atlas`, workflow e.g. `atlas-v2a`), implementers
Opus 4.8 or below (model self-reported AND orchestrator-verified), orchestrator reviews every diff
and owns pushes/ops writes, inspector grades fresh-context, human gates one at a time. Named gates:
**P1** = same-day live passkey sweep (build-day opener), **P2** = T3 adversarial security review
(explicit wave stage), **P3 / §9** = desk end-to-end checkpoint. Work branch `claude/atlas-v2a`
(worktree under `C:/Users/danie/kb-worktrees/`), one PR at wave end unless review says split. This
design doc itself is the conversation-gate artifact and must be approved by Daniel before any of the
above is authorized.
