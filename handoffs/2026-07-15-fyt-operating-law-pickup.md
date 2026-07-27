# PICKUP — operating law landed; 4 tasks left (2026-07-15)

> **▶ RESUME HERE.** The Enforcement Contract is now **repo law** at `knowledge/operating-law.md`,
> `@`-imported by `CLAUDE.md`, so **every terminal in this repo already loads it with zero
> invocation**. Branch `feat/operating-law` (off `master`, 15 commits, not merged). Worktree
> `C:/Users/danie/faceless-youtube-channel-forge`. Everything below is on disk.

## Why this exists

Process law was smeared across three docs with no declared winner — `CLAUDE.md` rules (21 lines), the
channel-forge Enforcement Contract (110), ~12 memory files — and drowned by a 264-line status
changelog auto-loaded into every session. Goal: **every terminal boots already knowing our
learnings.** Spec: `docs/superpowers/specs/2026-07-14-operating-law-and-governing-structure-design.md`.
Plan: `docs/superpowers/plans/2026-07-14-operating-law.md` (8 tasks; 1–4 + 6 done).

## Done

| | Before | After |
|---|---|---|
| `knowledge/operating-law.md` | — | **201 lines**, clauses A–H, `@`-imported by CLAUDE.md |
| `CLAUDE.md` | 400 lines (67% changelog) | **108** — a real router |
| memory store | 29 files | **8** (facts about Daniel + 2 techniques) |
| `knowledge/playbook.md` | 73 | 89 — gained the autonomy ramp + defaults; retitled *business & policy law* |
| `docs/handoffs/STATUS.md` | — | 274 — CLAUDE.md's status block, moved **verbatim** |

**One axis per doc:** law = how to work · playbook = what we're allowed to do · CLAUDE.md = router ·
`decisions.md` + dated handoffs = logs · `STATUS.md` = the live status *doc* (integrated in place) ·
skill/channel docs = craft law · memory = Daniel + his machine only.

**Craft law left the law** (it bloats it and is a different lifespan): the five-move generative-fix
method + derived-fields + prove-register-emit → `.claude/skills/README.md` §Design rules; the
doc-restructuring method → `curate-doc` (which already owned ~80% of it); 11 memory entries → the
visual-kit / image-generation / audio-director / motion-planner docs.

## ▶ NEXT — 4 tasks, in this order

1. **Hooks** (plan Task 5) — move `hook_block_git_add_all.py` out of `skills/channel-forge/scripts/`
   (a universal rule owned by one skill) to `.claude/hooks/`; **it has no test — write one first**;
   add a SessionStart `compact`-matcher hook re-injecting the law (the only real context-decay mode;
   a timer is NOT the fix — context doesn't decay on a clock). `settings.json` is committed, so hooks
   already apply in every worktree.
2. **`STATUS.md` curate pass** — it is a 274-line verbatim dump. Run `curate-doc` on it. This was a
   deliberate two-step: the move and the judgment stay separable.
3. **channel-forge contract → pointer** (plan Task 7) — `.claude/skills/channel-forge/references/
   enforcement-contract.md` is **still the untouched 110-line original**, i.e. a live duplicate of the
   law that will drift. Shrink to a pointer + walk-only mechanics (prune-on-lock, stage gates,
   capability map). Then `pytest` its 36 tests.
4. **Prove it** (plan Task 8) — the acceptance gate: a fresh terminal, given real work, visibly
   follows a clause it would previously have missed, unprompted. **Daniel judges.** Then log to
   `decisions.md` (the plan has the entry drafted).

## Open gates / decisions owed

- **`@import` is unproven.** Nobody has confirmed the law actually loads in a fresh session — it
  can't be self-tested from a session that already has it. **Ask Daniel to open a new terminal here
  and say "without reading any files, quote clause D."** If it reads a file first, the import is dead.
- **Merge conflict pending:** the main worktree (`C:/Users/danie/faceless-youtube`) has *uncommitted*
  `CLAUDE.md` edits and still carries the old 400-line structure. That terminal must commit before
  this branch merges.
- **`voiceover/SKILL.md` has no generation-logging rule** — `log-generation-reasoning` originated from
  voice batches (~20 lost tests) but only landed in `image-generation`. The failure isn't covered
  where it happened.
- **The layer-vs-delta-chain precondition has no backstop** — enforced only by the planner reading
  `animation-rules.md`; nothing in `critics.md` / `lint_motion_plan.py`. Per law §B-fix that is a
  floor, not a guarantee.

## Learnings from this run (the method, not the content)

- **The ≤130-line budget in the plan was fantasy** and cost hours. The law holds ~75 distinct
  learnings; it does not compress. Agent 1 "hit" 85 lines by writing 967-char lines (reflowed: 244).
  Measure **words**, not lines — a line budget is trivially gamed.
- **A fresh-eyes critic caught losses on every single edit pass** — including a clause written
  *backwards* from its source, a permission silently reversed into a prohibition, and a rule
  relabelled "not law". **Never self-certify a doc migration.** This is the law's own §B-fix,
  vindicated four times in one session.
- **The two-tier idea (sharp law + linked reference) is dead** — subagents get clauses by
  brief-injection, not by following links, so a reference reaches nobody the law binds. Shorter, and
  binds less. Don't re-propose it.
- **Check the destination before deleting the source.** Two `F-docs` rules were nearly cut on the
  assumption `curate-doc` covered them; it didn't. And a memory file's *diagnosis was wrong* (blamed
  a forge bug the code disproves) — one prune from becoming permanent craft law.
- **Craft law keeps trying to live in the law.** It bloated B, then F-docs. Route it (§G-route).

## Deferred / not done

- `channel-forge` itself is **parked** (Daniel's call). Its dogfood sits at the doctrine human gate —
  see `docs/handoffs/2026-07-14-channel-forge-pickup.md`. This branch took the contract *from* it and
  left the wizard alone.
- The Poyais image-gen props gate is still open on the other branch — unaffected by this work.
- `.superpowers/sdd/` (progress ledger + task reports) is scratch, intentionally untracked.
