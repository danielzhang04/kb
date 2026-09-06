# KB implementation pre-build synthesis - DRAFT

The current deliverable is the [implementation sequence](../../implementation-sequence.md),
which refines the original phases 0-11 without starting runtime implementation.
Daniel's requirement to retain all capabilities outranks earlier default-retirement
suggestions and the examples in public platforms. Scope can be sequenced, not
silently reduced. Topology remains an explicit choice.

## Source use

Six goal-specific briefs are in [briefs.json](briefs.json); [sources.txt](sources.txt)
holds their complete references. One KB audit packet was reused, and five public
primary-source groups were refreshed. The n8n documentation endpoint returned an
unsupported Markdown content type; its worker source was accessible. Public
branch URLs are moving references, not SHA-pinned implementation evidence.

- **N8N:** explicit worker capacity, queue mode and graceful shutdown are concrete
  patterns in the inspected [worker source](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/commands/worker.ts).
  KB should copy the boundary and prove its own process behavior, not inherit a
  large broker stack by default.
- **TEMPORAL:** [workflow history and replay](https://docs.temporal.io/workflow-execution)
  make it a real alternative to custom recovery logic. Compare the same workflow
  and include upgrade/runbook/custom-code burden in the decision.
- **LANGGRAPH:** [thread checkpoints versus cross-thread stores](https://docs.langchain.com/oss/python/langgraph/persistence)
  clarify what belongs to agent continuation and what belongs to retained knowledge.
  Neither becomes a substitute for KB's authorization authority.
- **PREFECT:** [work pools](https://docs.prefect.io/v3/concepts/work-pools) offer a useful
  separation between orchestration and execution infrastructure, with defaults and
  capacity limits. Adopt the contract where useful, not necessarily the platform.
- **ECC:** the [repository](https://github.com/affaan-m/ECC) supplies scoped harness,
  skill, memory and review practices. KB already uses related practices; installing
  another broad kit would not supply missing durable scheduler bindings.
- **KB:** the [audit](../../README.md) supports keeping reviewed definitions,
  explicit human authority, strict route contracts, confined workers and provenance.
  It does not demonstrate superiority in performance, security, cost or reliability.

## Three design perspectives and reconciliation

The deliverable format is a Markdown implementation charter plus source briefs and
this decision record. Soft preferences are low maintenance cost, small modules,
fast feedback and familiar dashboard navigation. Hard limits are no runtime work
before the pre-build gate, no hidden capability removal, no weakened privileges,
no self-approved acceptance and no production authority migration without its gates.

1. **Implementation designer:** keep the established dependency sequence and split
   it into bounded packages. Use a disposable, identical-workflow SQLite/Temporal
   experiment before selecting the runtime. This follows KB and TEMPORAL evidence.
2. **Dashboard designer:** prove operator journeys alongside each package, using
   existing screens and guarded routes. Existing route-to-decoder tests are useful,
   but only real browser/server/broker paths establish that the UI operates the
   system. This agrees with the implementation boundary and adapts N8N/PREFECT
   worker semantics; it rejects a late visual rewrite.
3. **Independent adversary:** require early actual broker evidence and complete
   feature delivery. Reject a universal status aggregate, phase gates satisfied by
   `unavailable`, or a runtime choice judged by its own author. This applies the
   KB trust constraints and challenges unmeasured custom-engine assumptions.

Reconciliation: one runtime authority per datum, separate confined worker execution,
bounded read projections across existing UI screens, protected acceptance criteria,
and distinct experiment/build/judge roles. Keep the existing security and provenance
boundaries while reducing duplicate writers, state transitions, adapters and manual
release work. No public platform is adopted wholesale by this decision.

## Adversarial disposition

The first fresh review requested changes. The parent corrected the charter and the
same reviewer performed a bounded recheck in read-only mode.

| Objection | Final disposition |
| --- | --- |
| An unavailable System path could satisfy Phase 8 | Every required path must execute through the full isolated FIRE/restart/receipt journey; unavailable means incomplete |
| Real Linux execution appeared only in Phase 6 | Existing-broker baseline is a Phase 1 gate; unavailable Linux blocks that gate, not unrelated local work |
| A real-model canary only checked argv | It now requires meaningful checked output, artifact provenance, dashboard state and stop/terminal outcome |
| Cutover summary omitted crash transitions | Freeze, drain, marker, link, readiness and boot each require kill/restart tests and fail-closed legacy admission |
| Two candidate engines were one oversized package | Six explicit packages separate fixtures, candidates, comparison, human selection and shadow import |
| Each UI phase could grow a competing status owner | Existing screens share bounded revision/provenance semantics without a global polling aggregate |
| Disjoint IDs could imply renaming historical runs | Historical identities/digests remain immutable; writer ownership is fenced instead |
| Initial scopes omitted browser/broker ownership | Both are now explicit unissued scopes; proposed tests/modules are labeled |
| Confirmation could become a per-child ceremony | Initial revised plan/phase confirmation gates scaffolding; later risk/human gates remain without inventing approval for every ordinary child card |

Final reviewer verdict: **READY FOR SUMMARY AND EXPLICIT INITIAL-SCOPE CONFIRMATION.**
This is not a promotion-ledger grade. Initial build work remains unissued; runtime
selection, topology-dependent work and production cutover have separate gates.

## Guardrail check and evidence limits

- Met: no runtime, test, deployment, governance, credential or production changes;
  all required capabilities retained; independently reviewed design; new tests and
  performance targets described as proposed, not accomplished.
- Unmet by design: implementation acceptance, browser/broker execution, real-model
  canary, restore and runtime comparison. These are next-phase work.
- Unverifiable here: live VM health, final topology, RPO/RTO and actual native model
  identity/cost. The audit's 706 selected passing cases are prior evidence only.

Prose pass used the humanizer principles: retain technical distinctions, remove
promotional superiority claims and avoid treating a design specification as proof.
The short formulation changed from "a better unified platform" to "one runtime
authority with bounded dashboard projections and separately verified workers";
the latter states the proposed mechanism without an unmeasured result claim.
