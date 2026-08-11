---
id: acceptance-run
project: kb-ops
title: Workflow-platform P0 chain smoke test
profile: scanner
stages:
  - id: draft
    title: Write the initial acceptance-run status file
    action: report:acceptance-p0-draft
    target: orgs/kb-ops/output
    riskTier: T1
    workOrder: "Write a BRAND-NEW file at orgs/kb-ops/output/acceptance-run-status.md (Write only — this profile has no Edit tool). Content: a level-1 heading '# Workflow-platform P0 acceptance run', then a '## Stage: draft' section containing today's UTC timestamp and one sentence stating this is stage 1 of 3 in the acceptance-run workflow definition, written to prove stage chaining and per-stage observable output. Use only Read/Glob/Grep/Write. Do not touch any file outside orgs/kb-ops/output/. Keep the whole file under 20 lines: this stage exists to prove the platform runs, not to produce real content."
    artifacts:
      - id: status-file
        path: orgs/kb-ops/output/acceptance-run-status.md
        description: The run's single status file, first written here.
  - id: revise
    title: Extend the status file with the revise stage's own section
    action: report:acceptance-p0-revise
    target: orgs/kb-ops/output
    riskTier: T1
    dependsOn: [draft]
    workOrder: "Read the existing orgs/kb-ops/output/acceptance-run-status.md written by stage draft. REWRITE the same file (Write, not Edit — this profile has no Edit tool) to APPEND a '## Stage: revise' section below the existing content: today's UTC timestamp, a one-sentence confirmation that draft's section was read and is intact, and a note that this is stage 2 of 3. The draft section's original text must remain unchanged above the new section — this is what proves dependsOn lineage: revise genuinely builds on draft's real output. Do not touch any file outside orgs/kb-ops/output/."
    artifacts:
      - id: status-file-revised
        path: orgs/kb-ops/output/acceptance-run-status.md
        description: The same status file, now carrying both the draft and revise sections.
  - id: signoff
    title: Verify the status file and write the signoff summary
    action: report:acceptance-p0-signoff
    target: orgs/kb-ops/output
    riskTier: T1
    dependsOn: [revise]
    workOrder: "Read orgs/kb-ops/output/acceptance-run-status.md in full. Verify it contains both a '## Stage: draft' section and a '## Stage: revise' section, each with its own timestamp. Write a NEW file, orgs/kb-ops/output/acceptance-run-signoff.md, containing: a one-paragraph summary confirming the full 3-stage chain (draft -> revise -> signoff) executed in order, an explicit PASS/FAIL verdict line (PASS iff both prior sections were found intact), and a short bullet list of what this run proved (stage chaining via dependsOn, per-stage observable output on disk). Do not touch any file outside orgs/kb-ops/output/."
    artifacts:
      - id: signoff-note
        path: orgs/kb-ops/output/acceptance-run-signoff.md
        description: The final PASS/FAIL verdict on the whole 3-stage chain.
---

# acceptance-run — kb workflow-platform P0 chain smoke test

A deliberately tiny, repo-local workflow whose only job is to exercise the platform live: stage
chaining (`dependsOn` lineage across draft -> revise -> signoff) and observable per-stage output on
disk. This is "hello world with structure," not a real deliverable: every stage's work is designed
to take an agent under a minute.

## Profile / capability note

This definition names the server-owned `scanner` profile (`Read`, `Glob`, `Grep`, `Write` — no
`Bash`, no `Edit`), the same capability cap `self-lint-report.md` uses. A stage that needs to
"extend" the status file does so by reading it and re-`Write`-ing the whole file with the new
section appended.

## Rules

- Write scope is `orgs/kb-ops/output/` only, on all three stages. No stage may write, edit, or
  delete any file outside that tree.
- No network access and no external action of any kind. All three stages are T1.
- If a stage cannot complete (e.g. the prior stage's file is missing or malformed), it writes what
  it found and why it stopped into its own declared artifact rather than guessing.
