# kb-ops — STATE

_Updated: 2026-09-08 (A0/C0/D0/C1 schema ready; C1 delivery and D1 design paused; A1 preflight active)_

## Now

- The complete twelve-phase overhaul remains active. Phase 0 is incomplete and
  Phases 1–11 remain gated. A0, C0, D0, and C1 schema are independently ready; C1
  delivery work is paused for a specific user decision. None of this authorizes production.
- PR176 targets main at current source head
  `36f76379c422aa1133f5421fe6258dd254e9d35e`, which includes the ready C0
  claim-store port, D0 canonical-admission correction, and C1 schema after A0. The frozen
  Slice 1A adapter/grant files remain unchanged. D0's corrective source commit
  is `57aebea0`; the earlier plan review head is
  `ccb2ec9565f92a867c85f693a10f64a2e93032e0`. The coordination baseline is
  `9713208aaa2a7b84e38c409a29d162c1817cb34b` for PR177.
- Retained Slice 1A evidence is unchanged: Linux Y5mujQ passed 399 selected
  tests, typecheck, and a 128-module native Vite build; Windows passed 47 in
  5.55 s. HrOmLA's full/sparse mutation proof passed after the deliberate chmod
  mutant failed and exact source restoration passed. Node/npm differed from the
  repository pin (24.19.0/11.17.0 versus 24.18.0/11.16.0).
- **A0 — READY.** Independent Sol review found the dormant lifetime interface
  and outcome type ready; six focused behavioral cases passed in 196 ms and
  dashboard typecheck passed. No engine, activation, or lifetime binding changed.
- **C0 — READY.** Root independently verified dashboard typecheck and the exact
  focused claim-store command: 18/18 passed in 1.18 s (923 ms tests). **D0 —
  READY.** Its builder focused suite passed 45/45 in 2.64 s, including the
  red/green held scheduler proof for post-await forward mutations.
- **C1 schema: READY / COMMITTED.** Published as `5a480e5c`; final independent
  review passed all 230 tests in seven scoped files, full dashboard typecheck,
  and diff checking. **C1 delivery: PAUSED pending user approval.** Terra owns adapter delivery;
  Sol independently prepares adversarial probes. An absent claim port refuses
  before any effect. The deprecated drain option is never called; B wires the
  active chain store and lifetime only at the final integration stage. **D1 —
  PAUSED.** Its same rebase-recovery design finding failed two correction/review
  attempts; root has asked the user for one further bounded cycle. Do not change
  the D1 draft or dispatch implementation while that answer is pending.
- Requested native work was Terra-high and Sol-high; responding-model and cost
  telemetry are recorded as unknown. The last VM probe remains historical
  failed-systemd/HTTP-502 evidence; PR173 was last checked OPEN. The signed
  production gate persists.

C1 delivery is frozen after the same malformed write-intent fulfillment test
failed twice: cleanup first threw on an undefined result, then one prompt write
was observed after the partial correction. This test returns undefined; it does
not test a thrown undefined rejection. Root requested one bounded correction:
validate transition results before effects, preserve the malformed-return case,
and add actual durable-transition-then-throw probes. No C repair before approval.
Independent A1 engine/grant preflight is active, with no production edits.
The strict outcome type and a resumable tokenless boundary are being reviewed.

## Next

- Review the independent A1 engine/grant preflight. Await C correction approval and the
  user's D1-cycle decision before touching its design. Do not create a runnable
  controller, deploy, merge, or mark Phase 0 complete.

## Blocked

- Phase 0 still lacks generation-fence integration, browser/fault evidence, and
  its required human gate. Implementation remains bounded by its ordered stages
  and evidence.
- The VM is not ready on the observed release, browser proof is absent, and the
  Linux toolchain differs from the repository pin.

## Historical evidence (not current operational status)

- The prior adapter snapshot was 34 pass / 2 fail because a parent setgid bit
  produced 02700 where the fixture expected 0700. Earlier completed records and
  the 2026-09-07 recovery handoff remain historical evidence in Git.
