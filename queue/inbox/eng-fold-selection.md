---
id: eng-fold-selection
project: faceless-youtube
action: draft:engagement-selection-delta
target: orgs/faceless-youtube/docs/deltas
risk-tier: T2
profile: scanner
owner: dashboard-engine
state: inbox
execution-controller: dashboard
---

## Work order

Author a doctrine-delta document at
`orgs/faceless-youtube/docs/deltas/2026-07-22-selection-doctrine.md`. You write exactly ONE new file
and change nothing else. The delta proposes exact text changes for a human integrator to apply on a
review branch.

Context: the channel owner's verdict on the first released long-form includes "the content itself is
just a bit boring… it's curious content, but it's not engaging." Craft research (2026-07-21) locates
this UPSTREAM of writing: story selection and angle. High-retention topics carry tension in the
premise; the same story gets told gripping or boring depending on the angle chosen at selection time.
The fix is a hard selection gate before any brief is written: a **12-point story-selection scorecard**
— (1) a nameable villain (a person, not "the system"), (2) a protagonist facing a real dilemma,
(3) a concrete jaw-dropping sum at stake, (4) escalating and irreversible consequences, (5) irony
density, (6) a reversal or comeuppance the viewer waits for, (7) a hidden-truth framing, (8) ONE
dominant question that stays open the whole runtime, (9) a bridge to why it touches the viewer today,
(10) resonance between the historical story and a current one, (11) at least three gripping titles of
at most 65 characters writable at selection time (if the titles will not write, the core is weak),
(12) one vivid cold-open moment already identifiable. Scoring guidance from the research: a story that
cannot name a villain, a sum, an open question, and a today-bridge is "curious but boring" — re-angle
or drop it. The scorecard grades the ANGLE, not just the topic: the deliverable of selection is the
angle that makes the built-in tension hit hardest.

Read for context: `orgs/faceless-youtube/.claude/skills/idea-generator/SKILL.md` and
`orgs/faceless-youtube/.claude/skills/researcher/SKILL.md` (the two candidate homes — place the
scorecard where ideas are graded and briefs are shaped; propose the split that fits how those two
skills actually divide the work) plus `orgs/faceless-youtube/channels/the-second-take/idea-backlog.md`
(to see what a real idea entry carries today).

Your delta document must contain, in order:
1. The problem statement (owner verdict + the upstream-selection finding).
2. The scorecard itself, written as replacement-ready doctrine text (the 12 axes with a one-line test
   each, the scoring rule, and the re-angle-or-drop law).
3. For each affected skill: proposed changes as blocks (existing passage quoted for location, full
   replacement/addition text verbatim, one-line rationale) wiring the scorecard in as a hard step —
   ideas below the bar do not advance to a brief.
4. A worked example: score the channel's released story (the 1822 fake-country loan fraud — villain
   Gregor MacGregor, roughly two hundred thousand pounds raised in London, settlers who sailed and
   mostly died, an acquittal and a decorated burial) against the scorecard to show the format, then
   score a deliberately weak counter-example of your own construction to show what re-angle-or-drop
   looks like.
5. A "what does NOT change" section: the fact leash (research ledger), the channel's niche and
   register, the existing brief format (the scorecard feeds it, not replaces it).

Repo doctrine voice. One new file only. If context is unreadable, note it and finish.
