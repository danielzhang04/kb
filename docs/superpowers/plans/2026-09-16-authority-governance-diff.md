# Proposed governance/schema diff — T2 WebAuthn removal

`governance/**` and `schemas/cards/v1.schema.json` are human-edited only (CLAUDE.md). T2 (remove
WebAuthn/passkeys end to end) found three places where these files name the now-deleted WebAuthn
channel. T2 does **not** apply these edits — they are proposed here for Daniel to review and apply by
hand (or explicitly authorize an agent to apply).

## Why these three

- `schemas/cards/v1.schema.json`'s `assurance` enum still admits `"webauthn"`, but nothing in the
  dashboard can drive that channel anymore: `dashboard/server/approvals/cardVerifier.ts#ApprovalChannel`
  is now `'signed' | 'possession'` only (T2 deleted `scripts/webauthn_verify.py`, the D2.3 verifier the
  `webauthn` channel shelled out to), and `dashboard/server/approvals/assurance.ts#ApprovalButtons` no
  longer emits a `webauthn` button. A card stamped `assurance: webauthn` would now be schema-valid but
  have no verifier that can ever clear it — a silent dead end rather than a schema-enforced impossibility.
- `governance/card-schema.md`'s `execution-controller` field comment and its "Hash-binding note" both
  name WebAuthn as the live mechanism. The mechanism they describe still exists in substance (the
  execution latch; the canonical card-content hash), just not under that name or transport anymore.
- `governance/risk-tiers.md`'s D2.13 approval-channel table pins T3 to "dashboard/WebAuthn-signed channel
  ONLY" — the authority-and-guardrails plan's whole point (T3 of that plan) is to replace that channel
  with an ssh-signed one. Once T3 lands, this line will describe a channel that no longer exists.

## Proposed diff 1 — `schemas/cards/v1.schema.json`

```diff
-    "assurance": { "enum": ["signed", "possession", "webauthn"] },
+    "assurance": { "enum": ["signed", "possession"] },
```

## Proposed diff 2 — `governance/card-schema.md`

Two sites.

```diff
                        #  (2026-08-06 ruling: writing this field routes, it never authorizes;
-                       #  authorization stays with risk tiers and the operator's armed passkey
-                       #  window, and T3 actions always park for human approval); "terminal" ⇒
+                       #  authorization stays with risk tiers and the operator's armed execution
+                       #  window, and T3 actions always park for human approval); "terminal" ⇒
```

```diff
-**Hash-binding note (cross-plan, do not "harmonize").** The dashboard's WebAuthn `content_hash` preimage covers the full canonical card payload including `action`, `risk-tier`, `owner`, `target`, and the ## Work order body. The fleet signed channel's `payload_hash` binds `action` + `target` + work-order only — it does not cover `risk-tier`/`owner`; tier-laundering prevention on the fleet channel rests on the re-approval rule, not hash-binding. The two channels canonicalize differently on purpose; do not assume the fleet hash covers `risk-tier`, and do not unify the two preimages without re-deriving both channels' security arguments.
+**Hash-binding note (cross-plan, do not "harmonize").** The dashboard's `content_hash` preimage (`dashboard/server/auth/cardHash.ts#canonicalCardPayload`/`contentHash`) covers the full canonical card payload including `action`, `risk-tier`, `owner`, `target`, and the ## Work order body. The fleet signed channel's `payload_hash` binds `action` + `target` + work-order only — it does not cover `risk-tier`/`owner`; tier-laundering prevention on the fleet channel rests on the re-approval rule, not hash-binding. The two channels canonicalize differently on purpose; do not assume the fleet hash covers `risk-tier`, and do not unify the two preimages without re-deriving both channels' security arguments.
```

## Proposed diff 3 — `governance/risk-tiers.md`

```diff
 ## Approval channels (D2.13, decided 2026-07-17)
 Approval tokens are tiered by channel:
-- **T3 (merge to main, external publishing, deploys) → dashboard/WebAuthn-signed channel ONLY.**
+- **T3 (merge to main, external publishing, deploys) → dashboard/ssh-signed channel ONLY.**
   The weak/unsigned transport (e.g. Telegram) MUST NOT authorize a T3 action.
 - T1–T2 may be approved over the weak channel.
 - T4 is never carded (unchanged).
```

Note: this third diff assumes the authority-and-guardrails plan's T3 (signed-approval verifier, nonce
store, and the gate) lands and actually stands up the ssh-signed channel it describes. If Daniel applies
this diff before T3 merges, T3 items would have **no** working channel at all in the interim (the old one
is gone, the new one not yet built) — sequence the edit after T3, or reword to something channel-neutral
("a signed channel per the authority-and-guardrails design") if it needs to land sooner.

## What T2 did NOT propose changing

- `governance/risk-tiers.md`'s broader D2.13 discussion (if any exists elsewhere in the file) beyond the
  one line quoted above — not reviewed for this diff; only the exact "WebAuthn-signed channel" phrase was
  in scope for T2's cleanup.
- Nothing in `governance/agent-rules.md` — grepped for `webauthn`/`passkey`, no hits.
