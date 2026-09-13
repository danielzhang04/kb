# Current-source HTTP/UI integration — acceptance plan

Status: root architecture review and work-order preparation, September 13. No implementation or independent design acceptance is claimed. The exact Opus design-source packet is awaiting consent; this local plan does not transfer it or change its contents.

## Intended behavior

For an exact prepared generation-plan ID and digest, an authenticated operator can deliberately request one bounded local source observation. The UI displays a last-check result tied to that plan revision and request owner. It never starts generation, grants quality approval or turns recorded content assignments into freshly validated evidence.

Preserve existing GET `studio-gen-plans@3`, POST preparation/idempotency, uncertainty handling and exact recorded-slot navigation. No reader process starts on GET, render, polling, inventory refresh, remount or selection change. The observation requires its own explicit POST action.

## Existing seams verified locally

| Seam | Consequence for the new work |
| --- | --- |
| `studioGenPlan.ts` inventory returns ordered plan/ID/digest pairs and a session-subject-derived `requestScope`. | Select an exact pair; preserve the recorded inventory contract and ownership boundaries. |
| `studioPublishedPlans.ts` exposes bounded marker discovery, published-plan hashing, retained observations and both fixed allocation roots. | Reuse exact marker/plan binding before and after observation. Legacy inventory remains readable; a plan outside the Figment authority root cannot gain source-check authority. |
| `surface.ts` registers Studio under origin/rate/session, then admission and fleet-preamble hooks. Only two exact discovery GETs bypass new-work admission. | Register the manual POST inside this governed Studio scope. A read-only child process is still new local work under the existing policy; do not silently add a POST exemption. |
| `context.ts` carries injectable Figment runner/config seams; `makeSurfaceContext` resolves configuration once. | Add a narrow source-reader configuration/runner seam without changing authentication resolution or unrelated context behavior. |
| `studioPlanProcess.ts` resolves capture only after verified owned-tree teardown and pipe closure; combined stdout/stderr bytes are bounded. | Reuse containment, timeout and uncertainty handling. Do not replace it with a generic shell subprocess. |
| Its capture result contains only `stdout`; stderr content is discarded. | The present result cannot prove stderr was empty. If the new contract requires that proof, add a narrowly reviewed opt-in rejection or byte-count seam; never claim the existing API already provides it. |
| `StudioGenPlans.tsx` tracks owner generations in addition to token/fetch values. | Preserve protection against owner A→B→A changes. A child keyed only by plan ID or credential text is insufficient when the digest or ownership generation changes. |

These are integration constraints, not findings that previously accepted features are broken. Existing video-ruling behavior remains separately scoped.

## Trusted configuration and data boundary

Configuration is server-owned, immutable after registration and limited to the existing two-plan capacity. It names a trusted absolute Python executable, the fixed adapter path/pin, five exact dependency pins, and selected/source roots with independent plan digests. Browser input supplies only a bounded exact plan identity/revision and any required request-owner binding; it cannot supply paths, code hashes, flags, environment, executable or source-root selection.

An absent configuration disables this feature with useful local operator copy. Malformed present configuration fails closed. Clone and validate nested values before registration; callers must not be able to mutate a retained object into new authority. For JSON configuration, plain `JSON.parse` alone cannot reject duplicate keys. Existing strict parsers are private helpers in unrelated modules, so choose a small bounded local implementation or an explicitly reviewed shared extraction; do not import an unrelated subsystem merely for its private parser. Unknown keys, duplicate/escaped-equivalent keys, nonfinite values, oversized/deep input and unexpected prototypes require tests.

Do not hash mutable files at request time and call the resulting digests trusted. Compare bounded regular adapter bytes to an independently supplied pin before execution, retain that observation and recheck after. Pass the five frozen dependency pins to the reader, which verifies bytes before compiling them. The trusted runtime, canonical spelling and stable code-ancestor assumptions remain explicit; this is cooperative observation, not hostile-concurrency isolation.

The configured selected root must match the current canonical allocation and published marker/plan pair. Independently bind the source root and source plan digest. Root layouts must satisfy the reader's non-overlap/persona/pipeline restrictions. Recheck original marker/plan observations and inventory identity after the child finishes. Reject a changed source, replaced plan, duplicate identity, newly conflicting root or wrong response binding. Do not take a new baseline halfway through and erase the original observation.

## Process, output and display contract

Reserve the single source-check slot synchronously before any asynchronous validation. Use `idle`, `running`, and `quarantined` states. Confirmed process failure releases the slot and yields a fixed unavailable response; uncertain teardown or an unclassified runner failure quarantines it. Browser timeout, disconnect or cancellation is not evidence that the server-owned process died and must not release its slot. Known pre-spawn validation failures can return to idle without pretending a child existed.

Require the reader's exact one-line ASCII/LF response, at most 4,096 bytes, native exit 0 and verified owned-tree teardown. Validate exact keys, lowercase digests, creator, selected/source digests, gen count/list correspondence and all three false claims. Reject duplicates, extra lines, trailing content, malformed encoding, unexpected fields, nonzero exit and valid-looking output associated with the wrong request. A proposed stderr-empty condition needs the runner seam described above. Preserve fixed errors; no raw paths, argv, environment, stderr or exception text leaves the endpoint.

The shared browser decoder validates the projected bounded DTO and exact requested ID/digest. Use plain “Source checked”/“Last checked” wording with a server-recorded check time or interval described honestly. It is a past observation, not continuous currentness. Keep `launch_ready`, `quality_approved` and `atomic_snapshot` false; leave recorded assignment `currentSourceRevalidated` semantics unchanged. Store no observation or authority in local/session storage.

The UI request owner includes parent ownership generation, token/fetch identity, inventory request scope and exact plan revision. Invalidate results before painting a different owner or revision, including A→B→A transitions. Check ownership again after asynchronous body decoding. Disable repeated clicks synchronously; discard late responses; never auto-retry after timeout. Inventory refresh and preparation keep their original behavior and cannot silently dispatch a source check.

## Review and verification order

1. **Independent design:** Opus reviews the already prepared exact source packet after consent. Root reconciles its recommendations with this local acceptance matrix. Decide precise endpoint/DTO/config names and the stderr contract before implementation.
2. **Bounded backend slice:** Sonnet implements shared contract/config parsing and the route, with a separate reviewed runner change only if necessary. Opus reviews code that crosses trust/process boundaries. Source pins stay unchanged unless an independently justified reader defect appears.
3. **Boundary tests:** malformed/duplicate config, mutation after registration, wrong ID/digest/owner, legacy root, adapter/dependency drift, original-observation replacement, output framing/bounds, false claims, busy, confirmed failure, uncertain teardown and late pipe data. Prove refusal occurs before spawn where applicable.
4. **Governed wiring tests:** real `buildApp` origin/host/session/read-vs-write rate/admission/preamble chain. Unauthorized, frozen and degraded requests must not reach the runner. Configuration absence must not break existing Studio routes. Route-only injected tests cannot establish this gate.
5. **UI slice:** Sonnet implements an explicit manual child control with owner/revision invalidation. Test same-ID/new-digest, A→B→A, selection while decoding, old requests resolving late, double click, refresh/remount, malformed responses, unavailable/busy/quarantine, and zero automatic POSTs. Run relevant typecheck/build once after accepted changes.
6. **Real local journey:** use actual synthetic `build_plan`, `build_grade`, `apply_rulings`, generation-plan publication, isolated reader, default contained runner and real HTTP/session. Exercise success, checkpoint/persona drift refusal, exact restoration/recovery and stale request identity. No production media, provider call, model download or fake human-quality success. Keep a short Windows fixture root and the finite copied dependency closure proven by the accepted producer tests.
7. **Rendered evidence:** inspect actual local browser states and request trace: initial unchecked, manual success, unavailable after drift, stale-owner/plan recovery. Verify no accidental preparation or paid action, original-byte restoration and cleanup. Retain before/after/current source/runtime pins, native statuses, raw outputs and screenshots. Report each gate's actual scope separately.

The source reader and genuine producer join are already accepted. Do not rerun those entire suites without a code change or a concrete new integration concern. This plan still owes HTTP/UI implementation, independent review and runtime evidence; it grants no actual creator-media acceptance, deployment or publication authority.
