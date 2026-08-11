---
id: acceptance-run
project: kb-ops
title: Workflow-platform P0 acceptance run (no-spend chain + gate smoke test)
profile: scanner
stages:
  - id: draft
    title: Write the initial acceptance-run status file
    action: report:acceptance-p0-draft
    target: orgs/kb-ops/output
    riskTier: T1
    workOrder: "Write a BRAND-NEW file at orgs/kb-ops/output/acceptance-run-status.md (Write only — this profile has no Edit tool). Content: a level-1 heading '# Workflow-platform P0 acceptance run', then a '## Stage: draft' section containing today's UTC timestamp and one sentence stating this is stage 1 of 3 in the acceptance-run workflow definition, written to prove stage chaining and per-stage observable output. This is a read/write-scoped, no-network, no-spend smoke stage — use only Read/Glob/Grep/Write. Do not touch any file outside orgs/kb-ops/output/. Keep the whole file under 20 lines: this stage exists to prove the platform runs, not to produce real content."
    artifacts:
      - id: status-file
        path: orgs/kb-ops/output/acceptance-run-status.md
        description: The run's single status file, first written here — the artifact gate g1-mid-run-check asks the human to read before releasing stage revise.
  - id: revise
    title: Extend the status file with the revise stage's own section
    action: report:acceptance-p0-revise
    target: orgs/kb-ops/output
    riskTier: T1
    dependsOn: [draft]
    humanGates:
      - id: g1-mid-run-check
        kind: approval
        prompt: "GATE 1 (mid-run) — read orgs/kb-ops/output/acceptance-run-status.md and confirm stage draft actually wrote it, then approve to release stage revise. This is the first of this run's two human gates; answer it from either the run tab or the dashboard Inbox."
    workOrder: "Read the existing orgs/kb-ops/output/acceptance-run-status.md written by stage draft. REWRITE the same file (Write, not Edit — this profile has no Edit tool) to APPEND a '## Stage: revise' section below the existing content: today's UTC timestamp, a one-sentence confirmation that draft's section was read and is intact, and a note that this is stage 2 of 3. The draft section's original text must remain unchanged above the new section — this is what proves dependsOn lineage: revise genuinely builds on draft's real output, not a fresh rewrite that happens to look similar. No network, no spend, no file outside orgs/kb-ops/output/."
    artifacts:
      - id: status-file-revised
        path: orgs/kb-ops/output/acceptance-run-status.md
        description: The same status file, now carrying both the draft and revise sections — read at gate g2-pre-signoff before signoff runs.
  - id: signoff
    title: Verify the status file and write the signoff summary
    action: report:acceptance-p0-signoff
    target: orgs/kb-ops/output
    riskTier: T1
    dependsOn: [revise]
    humanGates:
      - id: g2-pre-signoff
        kind: approval
        prompt: "GATE 2 (pre-signoff) — read orgs/kb-ops/output/acceptance-run-status.md and confirm both the draft and revise sections are present and coherent, then approve to release the signoff stage. This is the second of this run's two human gates; answer it from whichever surface (run tab or Inbox) you did not use for GATE 1, so both answering paths get exercised."
    workOrder: "Read orgs/kb-ops/output/acceptance-run-status.md in full. Verify it contains both a '## Stage: draft' section and a '## Stage: revise' section, each with its own timestamp. Write a NEW file, orgs/kb-ops/output/acceptance-run-signoff.md, containing: a one-paragraph summary confirming the full 3-stage chain (draft -> revise -> signoff) executed in order with two human gates answered in between, an explicit PASS/FAIL verdict line (PASS iff both prior sections were found intact), and a short bullet list of what this run proved (stage chaining via dependsOn, two human gates answered mid-run, per-stage observable output on disk). No network, no spend, no file outside orgs/kb-ops/output/."
    artifacts:
      - id: signoff-note
        path: orgs/kb-ops/output/acceptance-run-signoff.md
        description: The final PASS/FAIL verdict on the whole 3-stage chain — the artifact that closes this acceptance run out.
---

# acceptance-run — kb workflow-platform P0 acceptance run

A deliberately tiny, no-spend, repo-local workflow whose only job is to exercise the platform live:
stage chaining (`dependsOn` lineage across draft → revise → signoff), TWO human gates mid-run (so
both the run-tab and the dashboard-Inbox answering surfaces get exercised — see
`docs/superpowers/specs/2026-08-11-workflow-platform-design.md` Phase 0's acceptance line), and
observable per-stage output on disk. This is "hello world with structure," not a real deliverable:
every stage's work is designed to take an agent under a minute.

## Profile / capability note

This definition names the server-owned `scanner` profile (`Read`, `Glob`, `Grep`, `Write` — no
`Bash`, no `Edit`), the same no-spend, no-network capability cap `self-lint-report.md` uses. A stage
that needs to "extend" the status file does so by reading it and re-`Write`-ing the whole file with
the new section appended — there is no `Edit` tool on this profile. The scanner cap removes `Bash`
entirely (no git-plumbing bypass) and `Edit` (no in-place mutation of an existing file by any other
means than a full rewrite this stage's own work order controls).

## What this run is / is not

- It is a **smoke test of the platform mechanics**: a multi-stage run appearing in the live graph,
  an agent's live stream being watchable, a gate being answerable from two different surfaces, and a
  fleet cost ledger row landing on `ops` at run end (billed `$0`, subscription).
  It is **not** a real kb-ops deliverable — the status/signoff files it writes carry no operational
  meaning beyond proving the chain ran.
- All three stages are **T1**. No stage calls a paid API, reaches the network, or touches anything
  outside `orgs/kb-ops/output/`. No stage declares `spendAuthorization` or
  `publicationAuthorization` — this run authorizes no spend and publishes nothing.

## Gates (G1–G2) and where they are declared

Per the load-bearing rule this project's other multi-stage def (`video-run.md`) documents: a stage's
`humanGates` block **that stage**, so each gate is declared on the stage it must hold back — the
stage AFTER the work being judged, never the stage producing it.

| Gate | Judges the output of | Declared on (and therefore blocks) |
| --- | --- | --- |
| `g1-mid-run-check` | draft | revise |
| `g2-pre-signoff` | revise | signoff |

## Rules

- Write scope is `orgs/kb-ops/output/` only, on all three stages. No stage may write, edit, or
  delete any file outside that tree.
- No external action of any kind: no network call, no money movement, no publish, no credential use.
- If a stage cannot complete (e.g. the prior stage's file is missing or malformed), it writes what it
  found and why it stopped into its own declared artifact rather than guessing or fabricating content.
