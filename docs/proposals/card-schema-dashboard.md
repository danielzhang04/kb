# Card-schema additions — dashboard plan D1.4

Doc side of the D1.1/D1.3 code edits (`scripts/cards.py`, `scripts/dispatch.py`). Verbatim
additions proposed for `governance/card-schema.md`; Daniel reviews and commits these on `main`,
then merges `main → ops` so the running fleet sees the schema (governance is human-committed —
this repo's constitution forbids an agent editing `governance/` directly).

## 1. `session-id` field

Current (`governance/card-schema.md`, YAML block, after `role: work|consolidate`):

```yaml
role: work|consolidate    # consolidate = judge card: scores/picks/merges its
                          #  variant-group siblings' results
```

Proposed addition (new line immediately after):

```yaml
session-id: <str|null>  # the EXECUTING WORKER's Claude Code session id, stamped by the
                         #  worker runner at transition-to-working (D1.2). For the cloud
                         #  self-executing carve-out case only, the dispatcher may stamp it
                         #  at claim time instead (D1.1). Joins the card to its Plane-B
                         #  transcript. Optional; null on unclaimed/legacy cards.
                         #  Do NOT describe this as "the dispatcher's session" — it is the
                         #  worker's, except in that one self-executing carve-out.
```

`session-id` is inert metadata: never parsed, never executed, never treated as instructions —
consistent with how `## Evidence` is already treated.

## 2. `state` enum extension — steering-floor states

Current (`governance/card-schema.md`, YAML block):

```yaml
state: inbox|blocked|working|done|approvals|approved|rejected
```

Proposed replacement:

```yaml
state: inbox|blocked|working|done|approvals|approved|rejected|stop-requested|halting|halted
                       # stop-requested/halting/halted: the steering-floor cooperative-stop
                       #  ladder (files-only). A worker polls for stop-requested at a
                       #  checkpoint, moves itself to halting, then halted. SIGKILL is the
                       #  backstop for a worker that never polls. Only a working card may
                       #  enter the ladder; halted is terminal.
```

## 3. Cadence `paused` marker convention

New subsection, proposed for insertion after the `role` bullet's explanation (or as a new
paragraph following the YAML block):

> **Cadence pause marker.** A files-only `queue/paused/<cadence-name>` sentinel file that
> `dispatch.due()` consults: if present, that cadence's next scheduled beat is skipped. This is
> **suppress-only** — a paused marker can never trigger or widen a cadence's schedule, only skip
> a beat that would otherwise fire, and a marker for one cadence name never affects any other
> cadence. It is **not** an edit to the human-committed `HEARTBEAT.md`, and it is **distinct**
> from the per-card steering-floor stop above: `paused` suppresses a whole cadence's *future*
> beats; `stop-requested`/`halting`/`halted` stops one *already-dispatched, in-flight* card.

## 4. `## Feedback` body-section convention

New body-section, proposed for addition alongside the existing `## Work order` / `## Evidence` /
`## Result` list:

> `## Feedback` — steer text appended for a requeue/rerun. **Inert like `## Evidence`**: free
> text that may originate from a human or another agent's review, never executed as
> instructions, never treated as a source of `action`/`target`/`risk-tier`. Consumed only by
> whichever agent picks the requeued/rerun card back up, as read-only context.

## 5. Cross-plan hash note — dashboard vs. fleet `content_hash`/`payload_hash`

New note, proposed for addition wherever `governance/card-schema.md` discusses hashing/signing
(or as a standalone callout near the `approval` field):

> **Confirmed:** the dashboard's WebAuthn `content_hash` preimage covers the **full canonical
> card payload**, including `action`, `risk-tier`, `owner`, and `target` — this is what D2.2/D2.3
> bind their signature over.
>
> **Cross-plan note (do not "fix"):** the *fleet* signed channel's `payload_hash` (fleet 1.1)
> binds `action` + `target` + work-order **only** — it does **not** cover `risk-tier` or `owner`.
> Tier-laundering prevention on the *fleet* channel therefore rests on the **re-approval rule**,
> not on hash-binding. The two channels canonicalize their signed payload **differently on
> purpose** (different threat models, different signing surfaces) — a future editor must not
> assume the fleet hash covers `risk-tier`, and must not "harmonize" the two preimages without
> re-deriving both channels' security arguments from scratch.

---

Pairs with the code-side implementation:
- `scripts/cards.py`: `"session-id": None` default in `new_card`; `stamp_session(card, session_id)`;
  `STATES`/`STATE_DIR`/`LEGAL` extended with `stop-requested`/`halting`/`halted` (all three map to
  the `working/` directory; ladder is `working → stop-requested → halting → halted`, terminal at
  `halted`).
- `scripts/dispatch.py`: `run(..., session_id=None)` stamps the session id onto the **work** card
  only (after `cards.claim(...)`), never the `inspect` sibling (a different, future session grades
  it); `due(cadence, today, repo_root=None)` returns `False` when `queue/paused/<cadence-name>`
  exists, backward-compatible with every pre-D1.1 two-argument call site.
