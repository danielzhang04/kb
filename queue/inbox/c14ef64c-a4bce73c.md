---
id: c14ef64c-a4bce73c
project: kb-ops
action: fix:drain-rehearsal-chainbase-and-gate-rejection-linkage
target: rehearsal drain tooling (drain shapes / lock route via proxy 4417), dashboard/server routes.ts:1983-2000 (POST /api/control/iteration-gates/:ref/resolve), human-requests respond route
risk-tier: T2
owner: null
claim-token: null
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: null
model: null
---

## Work order

Two linked hook/route gaps found during 2026-09-22/23 rehearsal and live prod use:

(a) Drain rehearsal shapes lack `-ChainBase <40hex>`. The rehearsal drain must route through the
proxy URL on port 4417 for the lock route, not a direct call, or the chain base is left unset and
the drain shape is incomplete.

(b) Rejecting a completion gate creates an intervention with no `gateKind` set. Both
`POST /api/control/iteration-gates/:ref/resolve` (`routes.ts` ~1983-2000, refuses with
`iteration-gate-linkage-ambiguous` because `parkGate = gateKind === 'iteration-park'` has nothing
to match) and the human-requests respond route (refuses as iteration-linked) then refuse to
resolve it. The run is left stuck in `waiting-human` with no route able to move it forward. Live
instance: `run-cdae7121-c6e2-427c-b92d-f7f272c6e8f5` on prod, 2026-09-23 — the boss's rejection of
its completion gate is what produced the stuck state.

Fix: (a) thread `-ChainBase` through the rehearsal drain's shape builder and point the lock route
at the 4417 proxy; (b) stamp `gateKind` on the intervention created by a gate rejection (not only
on approval), so the resolve and human-requests-respond routes can identify and resolve it.

## Acceptance

- A rehearsal drain run produces a shape with `-ChainBase` populated and resolves its lock via the
  4417 proxy.
- Rejecting a completion gate produces an intervention with `gateKind` set; `POST
  /api/control/iteration-gates/:ref/resolve` no longer returns `iteration-gate-linkage-ambiguous`
  for a rejection-created intervention.
- `run-cdae7121-c6e2-427c-b92d-f7f272c6e8f5` (or an equivalent stuck run) can be moved out of
  `waiting-human` through a normal route call, not a manual DB/state edit.

## Evidence

> From the ops close-out brief (2026-09-23), finding 3, verified by the boss:
> "F13/F14 hook + routes: (a) drain rehearsal shapes lack `-ChainBase <40hex>`; the rehearsal
> drain must use the proxy URL 4417 for the lock route; (b) rejecting a completion gate creates an
> intervention with no `gateKind`, which `POST /api/control/iteration-gates/:ref/resolve` refuses
> (`iteration-gate-linkage-ambiguous`, `routes.ts` ~1983-2000, `parkGate = gateKind ===
> 'iteration-park'`) and the human-requests respond route also refuses (iteration-linked) → the
> run is stuck `waiting-human` (`run-cdae7121` on prod). Tier T2."

## Result
