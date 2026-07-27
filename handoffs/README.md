# handoffs/ — the one place session handoffs live

Every dated handoff, pickup, or resume document in kb lives HERE and nowhere else.
Filename: `YYYY-MM-DD-<scope>-<topic>.md` — scope is `kb`, `fyt`, `dashboard`,
`atlas`, `ecc`, or a future org id. This directory is append-only history; writes
follow the ops-branch coordination flow (`git pull --rebase origin ops` before,
push after), same as queue/ and memory/.

Related surfaces with different jobs (do NOT put handoffs there):
- `memory/<agent-id>.md` — per-agent LESSONS only (what worked/failed as reusable patterns)
- `orgs/<project>/STATE.md` — current state of a project (a doc kept current, not a log)
- `dashboards/handover.md` — GENERATED index pointing at the newest handoff per scope

## Template

A handoff contains everything a good handoff naturally contains — context, what
shipped (with evidence), what failed and why, what remains, gotchas. The skeleton
below standardizes the structure and adds the Load list; write real content under
each heading, add extra sections freely.

    # <topic> handoff — YYYY-MM-DD
    ## Context      — what this arc is, why it exists, where it stands
    ## Done         — what shipped, with evidence (PRs, commits, verified checks)
    ## Remaining    — ordered next steps, open questions, known gotchas
    ## Load list    — the specific files/dirs a resuming terminal should read FIRST,
                      as repo-relative links, plus any skill to invoke
                      (e.g. orgs/faceless-youtube/STATE.md, docs/plans/<plan>.md)

The Load list is the routing mechanism: a resuming terminal reads five named files
instead of re-exploring the repo.
