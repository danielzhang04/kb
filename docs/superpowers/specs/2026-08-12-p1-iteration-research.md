# P1 iteration research: Daniel's observed iteration grammar

**Date:** 2026-08-12  
**Scope:** research only for workflow-platform Phase 1. This describes observed practice; it does not design the implementation.

## Method and limits

Evidence came from the live control-plane snapshot and attempt/session records, durable decisions,
boss/agent memory, `origin/ops` handoffs, and review commits. The live snapshot contains 10 runs but
no retained semantic loop rows: `$.reviewLoops`, `$.reviewReceipts`, `$.stageGenerations`, and
`$.generationSupersessions` are empty. Its multi-attempt stages are recovery attempts, not artifact
rework. Round-count conclusions therefore combine the live-run evidence with durable project records;
they are a bounded sample, not a population estimate
(`C:/Users/danie/AppData/Local/kb-dashboard/control/control-plane.json:1`).

## The observed grammar

### 1. The object of iteration is an artifact, not a conversation

- A rework round starts from a concrete, versioned result. In the live P0 run, `revise` read the
  committed draft, checked that it was intact, and appended its own section; `signoff` then read the
  resulting file and emitted `PASS` only after verifying both sections
  (`run-74383969-3742-43d5-9c56-6024891f402e`;
  `attempt-io/attempt-af0fecc1-8ef1-4fb8-99d1-02aa2543e56d.jsonl:13-20`;
  `attempt-io/attempt-6171b348-f51d-4ecd-9594-fc6a41f3985e.jsonl:14-21`).
- Daniel's writing loop uses a versioned `verdict.rN.md` as the binding overlay for the next artifact
  generation; it archives the prior script, locks Daniel-verbatim lines for that generation, and stops
  if the verdict exposes a doctrine gap (`orgs/faceless-youtube/knowledge/decisions.md:3490-3498`).
- Verdict locks are generation-scoped: a later Daniel edit outranks an earlier verdict, so stale
  feedback cannot govern all future generations
  (`orgs/faceless-youtube/knowledge/decisions.md:3625-3627`).
- Session continuity is not the contract. A long-gap agent resume failed, while a fresh fixer using the
  persisted brief and report completed the round
  (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:53-55`).
- Retained live session chains contain no peer-chat evidence: the sessions' `brokerSteering` and
  `brokerReceipts` collections and the run's `agent-session-chains/...json` `messages` object are empty
  for the successful P0 run (`run-74383969-3742-43d5-9c56-6024891f402e`).

### 2. Rework may be initiated by a human, a judge, or a peer reviewer

- Daniel directly initiates rework by line-reviewing an actual draft and making the verdict the ruling
  record for the next generation (`orgs/faceless-youtube/knowledge/decisions.md:3436-3441`).
- A cold proxy judge can initiate rework: it returned `REJECT`, high confidence, anchor `CJ-001`, and
  required a scene-staged rebuild, one financial spine, and a concrete close; it explicitly ruled line
  edits insufficient (`origin/ops:handoffs/2026-08-04-fyt-pearlman-rerun.md:26-29,44-48`).
- Fresh-context task reviewers initiate ordinary fix rounds. In the Bricks work, they caught one
  Critical data misattribution and four Important board-bias defects that implementers missed
  (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:27-45`).
- The generating participant does not own its blocking verdict. Daniel-approved runner memory records
  that fresh-eyes twice overruled generator-lenient image judgments, so the gate belongs to a conductor
  or fresh-context reviewer (`memory/fyt-runner.md:18-24`).

### 3. A useful rework request is structured and falsifiable

Observed requests contain:

1. **The exact result under judgment.** Live signoff read the real lineage artifact; the board review
   independently reran a 214/214 caption census and used pixel-distance controls instead of accepting
   self-report (`run-74383969-3742-43d5-9c56-6024891f402e`;
   `origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:27-45`).
2. **A verdict and scope.** Examples are `PASS`, `REJECT`, `ADDRESSED/NOT`, or an honest `parked`
   state (`origin/ops:handoffs/2026-08-04-fyt-pearlman-rerun.md:26-29`;
   `origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:59-63`;
   `memory/fyt-runner.md:10-16`).
3. **Named findings tied to criteria and evidence.** The Bricks scoped re-review named I1-I4 and
   M2-M10, required one status per finding, and limited new review to regressions in the fix diff
   (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:59-63,87-93`).
4. **A bounded change instruction that preserves valued properties.** The live `revise` order required
   one append while keeping the draft unchanged; Daniel's verdict overlay locks exact lines and routes
   general lessons into doctrine before regeneration
   (`run-74383969-3742-43d5-9c56-6024891f402e`;
   `orgs/faceless-youtube/knowledge/decisions.md:3490-3498`).
5. **A stated next check.** Fixers report what changed and how it was re-proved; the Bricks fixer
   rechecked deterministic rebuilds and verified that only Q33's answer type changed
   (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:37-43`).

The reviewer proposes a diagnosis, not unquestionable implementation authority. In workflow-platform
P0, the implementer checked source behavior, corrected the reviewer's proposed mechanism, and the same
reviewer accepted the evidence on delta review (`origin/ops:memory/claude-boss.md:270-272,277-280`;
commit `ef3af4e`).

### 4. Initial review is independent; re-review is scoped

- Fresh initial review is load-bearing: independent reviewers found a Critical missed by boss
  spot-checking and caught compile breakage in a killed worker's apparently coherent artifact
  (`origin/ops:memory/claude-boss.md:255-257,262-264`).
- After that independent pass, the same reviewer may judge the delta. P0's same-reviewer delta verdict
  cost about one-third of a fresh review while retaining the original standard
  (`origin/ops:memory/claude-boss.md:269-272`).
- Scoped re-review asks whether named findings are addressed and whether the fix introduced new
  breakage; it probes final artifacts rather than replaying the whole project
  (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:59-63`).

### 5. Rounds are few and explicitly bounded

| Observed case | Semantic rounds | End state |
|---|---:|---|
| `idea-generator` evaluation | 2 iterations / 4 subagent runs | Five first-round gaps held on round 2; one last gap fixed; production-ready (`orgs/faceless-youtube/knowledge/decisions.md:100-112`). |
| Bricks SDD tasks 0-1 | 1 fix round per completed unit | Task 0 review-clean; Task 1 fixed I1-I4 plus nine minors, then a scoped re-review was queued (`origin/ops:handoffs/2026-08-11-fyt-bricks-taste-forensics.md:27-45,76-81`). |
| Silver script | 2 generated passes, then Daniel hand-edit | All 15 verdict directives landed by r2 and met the declared `<=2-pass` condition (`orgs/faceless-youtube/knowledge/decisions.md:3562-3567`; commits `07d1630`, `46d59fa`). |
| Keep-awake hardening | 3 review/fix rounds | 129/129 tests, three Opus reviews, live-fire, then SHIP (`origin/ops:memory/claude-boss.md:285-288`; commits `b47471c`, `f9bdbc6`, `ac5d215`). |
| Bricks scripting overhaul | 4 content rounds | Daniel accepted round 4 after three final line edits (commit `0a2cce5`; `orgs/faceless-youtube/knowledge/decisions.md:3436-3441`). |

The center of the sample is one to three rounds; four is a content-tail exception. The existing engine
already encodes the same conservative ceiling: a review definition permits zero to two creator
reworks, meaning at most three judged artifact generations
(`dashboard/server/workflows/defs.ts:545-581`).

### 6. Termination is an explicit state transition

- **Approval / acceptance:** the live P0 chain advanced only after two artifact-specific operator
  approvals and ended after a final `PASS`; its immutable lineage was draft `409f64f` -> revise
  `2865b0f` -> signoff `c24cd83`
  (`origin/ops:handoffs/2026-08-12-dashboard-workflow-platform-p0.md:5-18`).
- **Judge verdict, then human gate:** Pearlman advances only on cold-judge greenlight; revise/reject
  permits one more targeted writer round and one re-judge, not an open-ended retry
  (`origin/ops:handoffs/2026-08-04-fyt-pearlman-rerun.md:75-89`).
- **Honest park:** known defects have a representable `parked` state, and byte-identical/no-work stage
  output parks to `waiting-human` rather than silently passing
  (`memory/fyt-runner.md:10-16`; `orgs/faceless-youtube/knowledge/decisions.md:3721-3730`).
- **Durable failure beats prose:** one live worker claimed success but timed out; the run is durably
  failed and its downstream stages remain blocked
  (`run-96ce771d-c3d5-4ed7-843e-457704334fdd`;
  `attempt-io/attempt-73e862c4-8a71-426b-bdd2-6131624b1e1a.jsonl:22-23`).
- **Recovery exhaustion parks:** the P0 `revise` stage needed three infrastructure attempts; execution
  and budget failures created human interventions rather than being counted as semantic rework
  (`run-74383969-3742-43d5-9c56-6024891f402e`, attempts 15/17/18 and human requests 10/11 in
  `C:/Users/danie/AppData/Local/kb-dashboard/control/control-plane.json:1`).
- **Repeated severe findings change the problem:** after two DO-NOT-SHIP rounds with real HIGHs,
  Daniel's approved response was rearchitecture; the recorded rule is to stop patch-and-re-review when
  it spins (`origin/ops:memory/claude-boss.md:30-34`).
- **A moving structural dependency stops autonomous iteration:** the boss record explicitly says to
  take the sequencing call to the human instead of spinning another fix/review cycle
  (`origin/ops:memory/claude-boss.md:262-268`).
- **Local retries are also bounded:** a transient render timeout retries once; a second failure is a
  real defect to diagnose (`memory/fyt-runner.md:51-58`).

## Resulting grammar to imitate

1. Bind every turn to the exact committed artifact generation it reads.
2. Carry a structured request: sender, recipient, verdict/disposition, criteria, named findings with
   evidence, bounded instructions, preserved invariants, and the next acceptance check.
3. Let peers, a judge, or a mediator initiate the next turn only through declared routes.
4. Use an independent first judgment; allow cheap scoped delta judgments after it.
5. Terminate on an authorized accept/pass/consensus verdict, an explicit park, or the declared cap.
6. On cap exhaustion, repeated severe failure, or structural contradiction, preserve the artifacts and
   park to the normal human gate. Never silently add a round.
