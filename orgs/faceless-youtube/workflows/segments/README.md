# Committed workflow segments — the deterministic spine between the human gates

These four Claude Code **Workflow-tool** scripts (`segment-a`, `segment-b1`, `segment-b2`,
`segment-c`) are the *committed*, resumable spine of the faceless-YouTube video pipeline. Each one
runs a contiguous run of pipeline stages and **cuts exactly at a human gate**:

| Script | Stages (in order) | Ends at |
| --- | --- | --- |
| `segment-a.workflow.js` | idea → research → script → judge-gate | **GATE 1** (human script acceptance) |
| `segment-b1.workflow.js` | (shorts ∥ metadata) → shots → motion → (images ∥ voiceover) → image-review → board | **GATE 2** (human shot-board) |
| `segment-b2.workflow.js` | audio-plan → render → verify → thumbnail → compliance | **GATE 3** (human publish approval) |
| `segment-c.workflow.js` | preflight → upload → publish-record | (in-session **T3** publish leg) |

## Derived from `video-run.md` — that def is the DAG of record

The stage identity, order, and dependencies here are **derived from
`orgs/faceless-youtube/workflows/video-run.md`**, which is the single source of truth (the DAG of
record). Each script names it in a top-of-file comment. The segments slice that one DAG at the gate
boundaries; they do not redefine it. Two nodes here are conductor-side tail steps rather than
video-run stages: the **shot-board build** (`build_board.py`, the GATE 2 artifact) and segment-c's
**publish leg** — video-run.md deliberately ends at a verified local render, so publish/upload is a
separate human-gated T3 leg that lives only in segment-c.

## Shape rules (all four scripts obey these)

1. **`export const meta` is a pure literal** — `{name, description, phases}` with no variables,
   spreads, or interpolation. Each `phases` entry is `{title, detail}`, and every stage's
   `agent(..., {phase})` reuses the exact `title` string from `meta.phases`.
2. **One `agent()` per stage.** The prompt says, in effect: *"Follow `<skill SKILL.md path>` for
   `<videoDir>`; write staged output per the single-writer rule; your final text is the JSON gate
   result `{stage, ok, artifact, notes}`."* Every call passes `schema: gateSchema` pinning that
   shape (see below), plus `label` and `phase` for display.
3. **Stage order/deps mirror `video-run.md`** (stated in a comment in each file).
4. **A failed or refused gate stops the segment** and returns what completed. The runner repairs and
   **resumes the same run via `resumeFromRunId`**, so already-completed (paid) stages stay cached and
   are not paid for again (see *Resume & caching* below).
5. **No paid stage runs unless `args.spendAuthorized === true`.** This applies to segment B1's
   `images` and `voiceover` (the only paid stages in the pipeline — segments A, B2, C have none).
   Without authorization the stage returns an **explicit refusal gate** (`ok: false`, with a note) —
   it never silently skips and never spawns the paid agent.
6. **Segment C's first line throws** unless `args.approvedBy` is a non-empty string — the GATE 3
   publish approval must be on record before any preflight or upload work happens.
7. **Runtime forbiddens** (all four): no `Date.now()`, `Math.random()`, or argless `new Date()`
   (resume-safety); no TypeScript annotations; **no filesystem / Node API** (`fs`/`path`/`process`) —
   all file work happens *inside* the agents the script spawns, never in the script body.

## The gate-result schema

Every stage's final text is validated against this JSON Schema (all four fields required; `ok` is a
boolean):

```js
const gateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "ok", "artifact", "notes"],
  properties: {
    stage:    { type: "string" },   // the stage id, e.g. "script"
    ok:       { type: "boolean" },  // true ONLY if the stage genuinely succeeded
    artifact: { type: "string" },   // repo-relative path written (or "")
    notes:    { type: "string" },   // one-line status
  },
};
```

Each script returns `{ segment, gates: { <stageId>: <gateResult>, ... }, artifacts: [ ...paths ] }`.

## Resume & caching story

A segment is **fail-stop**: on the first gate whose `ok !== true` it records that result and returns
immediately with everything completed so far. It does **not** roll back or re-run earlier stages. The
runner inspects the returned `gates`, repairs the failure (a human fixes the script at GATE 1, regens
a bad frame at GATE 2, etc.), and **relaunches the same run with `resumeFromRunId`**. On resume the
Workflow tool replays the cached results of the already-completed `agent()` calls instead of
re-executing them — which is why the resume-unsafe primitives (`Date.now()`, `Math.random()`,
`new Date()`) are forbidden: cached stages must be deterministic. This is what protects the **paid**
`images` and `voiceover` stages from being paid for twice across a resume.

Because a refused paid stage returns `ok: false`, an unauthorized B1 run stops cleanly at the paid
boundary; re-running with `spendAuthorized: true` resumes from there with the earlier (free) stages
still cached.

## `args` shape

```
{
  channel: string,          // channel folder, e.g. "the-second-take"
  slug: string,             // video slug, e.g. "2026-07-04-poyais"
  videoDir: string,         // channels/<channel>/videos/<slug>
  spendAuthorized?: boolean // REQUIRED true for segment-b1's paid images ∥ voiceover; ignored elsewhere
  resumeShotIds?: string[]  // segment-b1 only: targeted image regen — regenerate ONLY these shot ids
  approvedBy?: string       // segment-c only: MUST be a non-empty string (GATE 3 approval) or the script throws
}
```

### Per-segment arg examples

Segment A (no spend, no extras):

```json
{ "channel": "the-second-take", "slug": "2026-07-04-poyais",
  "videoDir": "channels/the-second-take/videos/2026-07-04-poyais" }
```

Segment B1 — first run, authorized to spend:

```json
{ "channel": "the-second-take", "slug": "2026-07-04-poyais",
  "videoDir": "channels/the-second-take/videos/2026-07-04-poyais",
  "spendAuthorized": true }
```

Segment B1 — resume with a targeted image regen (only two shots):

```json
{ "channel": "the-second-take", "slug": "2026-07-04-poyais",
  "videoDir": "channels/the-second-take/videos/2026-07-04-poyais",
  "spendAuthorized": true, "resumeShotIds": ["shot-014", "shot-027"] }
```

Segment B2 (local render, no spend):

```json
{ "channel": "the-second-take", "slug": "2026-07-04-poyais",
  "videoDir": "channels/the-second-take/videos/2026-07-04-poyais" }
```

Segment C (publish leg — requires the GATE 3 approver):

```json
{ "channel": "the-second-take", "slug": "2026-07-04-poyais",
  "videoDir": "channels/the-second-take/videos/2026-07-04-poyais",
  "approvedBy": "daniel" }
```

## Validation

`node --check orgs/faceless-youtube/workflows/segments/segment-*.workflow.js` passes clean (exit 0)
for all four under Node 24 — that is the required check.

The bodies use both top-level `await` (an early stage feeds a later one) and top-level `return` (the
fail-stop). The Workflow runtime wraps each body in an async function that supplies the `agent`,
`parallel`, `args`, and `log` globals, so both are legal there, and Node's native module detection
accepts the files as written. If you force a stricter single mode, note the tension: renamed to
`.mjs` (strict ESM) `node --check` rejects the top-level `return`, and forced CommonJS rejects the
top-level `await`. The faithful stricter check is to wrap each body in an async function exactly as
the runtime does (`async function __wf(agent, parallel, args, log){ …body… }`) and `node --check`
that — which is also clean. See the task report for both harnesses and their results.
