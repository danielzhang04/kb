# Proposed BOSS.md / MEMORY.md edits — token discipline (2026-09-11)

Daniel-edits-only per the constitution. Four independent hunks; apply any subset.

## 1. 150k boundary rule (L2, spec S4) — add to BOSS.md's "Execution discipline" section

    - Past 150k context (statusline `context_window.used_percentage` is the cue —
      hooks cannot read context size): finish the current task's review or fix
      round, write the ledger/handoff, then either let auto-compact run or end
      the turn with "restart me". Running subagents continue uninterrupted;
      their notifications arrive after compaction (verified empirically,
      2026-09-11 token-discipline Task 0 probe C).

## 2. Brief-rule pointer (L3, spec S5) — add to BOSS.md's "Delegation" section

    - Every dispatch brief (Claude Agent tool AND dispatch-codex) follows the
      one brief rule in `docs/runbooks/subagent-brief-rules.md`: the worker
      writes its full output to a file and returns <= 300 words in its final
      message.

## 3. BOSS.md trim to rules-only (L4, spec S6)

Recommend cutting BOSS.md's prose explanations down to the imperative rule
each subsection already states, e.g. collapsing multi-sentence "why" framing
in "Startup" and "Planning" into the rule sentence plus one clause. Not
scripted here (a hand-edit judgment call) — the ask is: audit BOSS.md line by
line, keep every RULE, cut restated context the rule already implies.

## 4. MEMORY.md arc collapse at session close (L4, spec S6)

    - At session close, for any arc entry in MEMORY.md marked SHIPPED / MERGED
      / CLOSED this session, collapse it to a single pointer line (as several
      entries already do, e.g. "Bricks superseded chain") pointing at the ops
      STATE.md or the merged PR, rather than leaving the full multi-line
      history inline. MEMORY.md is personal (outside the repo); this is a
      boss-session habit, not a script.

## Task 4 — BOSS.md trim
(appended by Task 4)

## Task 3 — BOSS.md pointer to subagent-brief-rules

Redirect of the brief's own Step 6 ("edit skills/curated/dispatch-codex/SKILL.md"): Task 5
already landed its own edit to that skill in this same plan, so Task 3 lands its pointer here
instead. Add to BOSS.md's "Delegation" section:

    - Every dispatch brief (Claude Agent tool AND dispatch-codex) follows the one brief rule in
      `docs/runbooks/subagent-brief-rules.md`: the worker writes its full output to a file and
      returns <= 300 words in its final message.

(This duplicates hunk 2 above verbatim — hunk 2 was already the same rule, landed by an earlier
task in this plan; this entry exists so Task 3's own scope is traceable in this file without
re-editing hunk 2's text.)
