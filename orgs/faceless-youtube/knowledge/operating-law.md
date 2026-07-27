# Operating Law — how we work in this repo

**Binding on every terminal, skill, and subagent in `faceless-youtube`. Not advisory — follow it.**
It changes only via §G-author, with human confirmation.

**Reach — a law nobody loads binds nobody.** Loaded automatically into every session (`@`-imported by
`CLAUDE.md`); **re-injected after compaction**. The flow conducting a run reads this at Stage 0 and
**injects each stage's governing clauses into that stage's brief** — that obligation is the primary
delivery mechanism; the `@`-import is a convenience on top, not a substitute. **Any agent dispatched
to do work receives its governing clauses injected into its brief.** Subagent inheritance is
undocumented and **MUST NOT** be relied on: a clause that exists only here has not reached a
dispatched agent.

**Some clauses state only a bias or a judgment call and cannot be mechanically checked: still
binding, still self-checked — but a self-checked rule is a floor, not a guarantee. That applies to
this document too** (the fix: `.claude/skills/README.md` §Design rules).

---

## A. Orient before acting

- **Context-first gate:** at the **start of a task**, read current state — `CLAUDE.md` routing, the
  latest handoff, `knowledge/decisions.md`, and the relevant existing assets. **Never propose what
  already exists or was already decided.**
- **Know what exists:** the live skill registry is the source of truth. Consult it (already in
  context) or **search** — before hand-rolling, or concluding no skill fits.
- **Self-maintain.** When work reveals that the folder structure, the file map, a rule, the status
  block (`docs/STATUS.md`), the dashboard, or any doc no longer matches reality, **change it
  without being asked** (add folders, update the map, revise the rule, fix the status) and log it in
  `knowledge/decisions.md`.
  Separately, on a **material** `knowledge/`-or-status change, also update the dashboard `index.html`
  (repo root — the human's only non-terminal window on the project) and bump its "Last updated" date.
  [user-directed]

## B. Use the right tool, the right way

- **Invoke the named skill; don't hand-roll what a skill does.** The *production artifacts* —
  `research.md`, `script.md`, `metadata.json`, `shots.json`, `vo.mp3`, `final.mp4` — must come from
  the skills/agents that own them: an artifact you made by hand proves nothing about a run without
  you. Doctrine/doc editing and design *proposals* are meta-work — fine to do directly **or via
  agent**.
- **Self-application:** when the task *is* creating/iterating a skill or doc, use the builder tooling
  (`skill-creator` / `writing-skills` / `curate-doc` / `humanizer`) — **never ad-hoc hand-edit.** We
  build our builders with the same discipline; no flow gets to hack a **skill** together — code and
  all — because it is "inside" a wizard or mid-run.
- **The craft of building a skill** — the five-move fix for a taste/quality defect, derived fields,
  reads-a-file-writes-a-file — lives in `.claude/skills/README.md` §Design rules. The principle here:
  **a taste defect in a generative skill is never fixed by more self-checked rules** (§G).

## C. Right-size the effort

- **No massive workflow for a small ask** — match research / agent fan-out to the question; a
  moderate question gets a direct answer, not a deep-research run.
- **Execute the agreed step.** Don't drift into adjacent work that wasn't asked for, don't widen
  scope mid-task. If the work reveals a different job needs doing, say so and let the human re-aim.
- **Fan out to go deeper faster — never to cut corners.** **Decompose** → probe a capability ONCE →
  fan out **agents** across independent parts (and *within* a task, for depth), **`run_in_background`
  by default**, each with a **deep, structured brief** → **aggregate the findings**. Serially
  re-testing a proved capability is the anti-pattern; parallelism buys depth per wall-clock hour,
  never speed traded against depth. **Delegating does not relax the standard** — every rule binding
  you binds inside each agent.

## D. Validate before you commit effort — up and down the chain

*(The anti-rework rule — Second Take's single biggest time sink.)*

- **Brainstorm before building; plan before implementing.** No jumping to scaffold/code.
- **Don't fire a generative/expensive step until its upstream input is validated/locked** (no
  image-gen off an unreviewed shot list). **Before spending gen tokens, show the plan** (a short
  table/list) and get a go-ahead — token spend is real money even when it isn't outward-facing.
- **Don't redo good work** — reuse-before-regenerate; if it passed, leave it.
- **Confirm the step is correctly configured before a batch run** (the "hand-running" bug).
- **Don't lock a stage on theory — dogfood it on one real artifact first** ("not yet proven on a real
  video" was the recurring failure). **Smallest slice that answers the question** (a video's first
  30–45s) → validate → then scale. **Bias toward validating direction over producing volume.**

## E. Think critically — don't yes-man

- Push back; surface problems **and opportunities** first; ask clarifying questions; **narrow scope
  throughout**. Be **critically honest** — weaknesses before wins. **Before executing, check the
  scope is right, name any hidden assumption, and say if the approach has a flaw.** Surfacing it
  early beats delivering agreeable work late. [user-directed]
- Present **options** for taste/design calls, not one pre-picked answer — **prototyped/rendered**
  side by side (real sample assets, not described directions) → the human reacts → iterate → **lock →
  only then build at scale**. Compare **one axis at a time** (lock dimension by dimension, not whole
  gestalts against each other). Research/synthesis may be conclusive; the *style/creative* call
  arrives as options.
- **Converge internally, then present:** research → generate → self-critique against this law + the
  `knowledge/playbook.md` guardrails → refine → *only then* show the human, who spends ≤2 rounds on
  taste, not on fixing obvious misses.
- **Resolve, don't punt.** When the human signals uncertainty or asks to know more, do the research +
  self-critique + iteration and return a *decision-ready* answer. Never hand the investigation back
  as a "want me to…?". A concern you raise ("is this AI-slop risk real?") is **yours to resolve with
  evidence, not the human's to adjudicate** — go find out, then say what you found and what it means.
- **Enrich, don't replace.** When the human asks for *more*, the new deliverable must be a
  **superset** — preserve every piece of analysis they were deciding from (rankings, scores,
  reasoning, prior options) and ADD. Never silently drop signal they found useful. (The over-cutting
  failure; complement of §F-docs' integrate-don't-append, which guards against doc *rot* — both serve
  "keep exactly the useful content, well-structured".)

## F. Files, git & housekeeping

- **Nothing important lives only in a conversation** — every durable fact, decision, or output is a
  file, or it dies with the terminal. Each skill/task reads files and writes files.
- **F-log — `knowledge/decisions.md`:** log every non-trivial decision (niche, tool, rule, structural
  change) with the reasoning **+ the alternatives rejected**, so calls aren't re-litigated.
  Append-only. Dates absolute (`YYYY-MM-DD`), **taken from the session's current date** — never a
  stale one copied from context.
- **F-status:** `docs/STATUS.md` is the live status — a **doc**, kept current in place.
  Dated pickups/handoffs carry resume state for in-flight work only; they live in the kb
  repo-root `handoffs/` (fyt scope) and are **deleted on pickup or completion** per the
  `handoffs/README.md` lifecycle — git history keeps them recoverable.
- **F-docs — integrate, don't append:** write the change into the right section and delete what it
  supersedes; never stack dated blocks, bolt on corrections contradicting earlier sections, or grow a
  pile of one-off notes. Docs stay structured by topic, **concise**, comprehensive, non-overlapping,
  at **router altitude**, learnings **general** (portable to a new run, never tied to one video/date).
  **Preserve every real learning** — restructure drift with **`curate-doc`**, which owns the method.
  [user-directed]
- **F-git — parallel terminals share the tree:** stage explicit paths; **never `git add -A` and never
  `git commit -a`/`-am`** — both sweep whatever a parallel session has half-written, and the second
  bypasses staging entirely. (A hook blocks `git add -A`; the `commit -a` half is still on you.)
  Before committing, check `git status` for files you didn't touch and leave them alone. **Never
  rewrite history** while other terminals may be live — disclose instead.
- **F-agents — brief deeply, then check on them:** a stuck or drifting agent gets killed or
  **re-dispatched with an edited prompt addressing the failure**, never waited on. Agents write
  findings to disk **incrementally** (append per section), never only in a final message — subagent
  context is volatile (usage limits, restarts, MCP crashes) and only disk survives; two of those are
  uncorrelated with duration, so a short agent is not exempt.
- **F-progress — never run an opaque chain silently.** Two triggers, either alone sufficient: **chain
  depth** (latency COMPOUNDS — *each agent looks fine alone*, but audit→edit→author→critic→gen behind
  terse status lines reads as a frozen session) and **per-call latency on a big batch** (a 40-image
  run at ~10–30s per call is one shallow, very long step). Say plainly that work is **inherently
  slow, not hung**; asked for status, answer **precisely** ("here's exactly where we are; nothing is
  generating yet").
- **F-clean — clean as a verb:** exploration is ephemeral and pruned on lock. After work, actively
  sweep scratch slugs, resolved handoffs, superseded files. Only named, locked assets persist.
- **F-encoding:** ad-hoc file edits read/write explicit UTF-8 — this machine's shell default is cp1252
  and has mojibake'd tracked files; verify any bulk text edit by codepoint, never by eye.

## G. Learn from every run

*(The engine that makes run N+1 smarter than run N.)*

- **Fix the skill — its logic or its doc — not the artifact.** Wrong output means a broken generator;
  repairing the one file leaves it broken.
- **Harvest EVERY note**, not just post-run retros: each piece of iteration feedback ("this slide's
  too fast", "this SFX is wrong", "the research was too broad") must change the **workflow logic**,
  never patch the one artifact. Also harvest what caused rework, what a stage got wrong before
  converging, and **what the human redirected** — a re-aim leaves no artifact note but is the
  sharpest signal there is.
- **Abstract** to a portable lesson — not "the horror channel's research was too broad" but "research
  scope must be declared per niche-shape". Don't over-fit: one note may be genuinely case-specific,
  so **ask** — over-generalizing a single reaction corrupts the grammar.
- **Confirm the generalization with the human** before it is codified.

### G-route — a lesson lands in the LEAST general layer that holds it

A DEFAULT value → a token. WHEN to fire/withhold → the owning ruleset or a skill's critic. A recurring
TASTE pattern → gold exemplar + critic layer, **never a self-checked prohibition**. A wrong ASSET →
re-source via the forge skill, **not a one-off swap**. A whole CATEGORY off against the reference set
(not one instance) → **re-measure** (a measurement battery / teardown — never by eye), then update the
grammar. HOW to build or fix a skill → `.claude/skills/README.md` §Design rules. A fact about **the
human or their machine** → the memory store. Policy / compliance / originality / quota / excluded
formats → `knowledge/playbook.md`, or the **Capability-Map defaults** if it is per-channel. **Only
genuinely universal process law reaches this doc — it is *how to work*, nothing else.** Always
integrated in place, never appended.

- **Reachability — a lesson survives ONLY if it lands where a fresh session actually reads.** A
  learning written where nothing routes to it is a silent no-op. Confirm the destination is loaded
  (this law, an auto-loaded doc, the memory store) or routed to (`CLAUDE.md` → the owning
  skill/grammar/tokens). This binds future terminals, not just this one. [user-directed]
- **The loop closes on a human gate, not on the edit.** Routing a lesson changes the logic; **FEEL
  stays the human ear/eye-gate** — re-gate the next real render/artifact before calling it learned.

### G-author — changing this law

- **Changes only via this clause, with human confirmation. Never edited ad-hoc mid-run.**
- **A clause must be enforceable** — a **structural** gate, a brief-injection, or a hook — **not
  vague advice**. "Be thorough" is not a clause; "don't fire a generative step until upstream is
  validated" is. Where checkable, the conducting flow **gates advancement** on it (was context read?
  did the critic run? was upstream validated? is the workspace pruned?); with no conductor, the
  terminal gates itself at the same checkpoints. The **mechanical** ones become **actual** harness
  hooks (the `git add -A` ban, §F-git).

## H. Human authority

- Everything committed to a channel gets **human final say.** The machine converges; the human owns
  taste/feel.
- **Ask at the right altitude:** gate the decisions genuinely the human's (taste, money, strategy,
  irreversible); decide sensible defaults yourself and just report.
- **Confirm irreversible / outward-facing actions** (publish, spend, *create* external accounts)
  unless durably authorized.
- **Review in a medium the human can perceive** — images/option boards → an **Artifact**; files →
  **VS Code** (`code <path>`); video/audio → the **device player**. **Always inline the link or
  path.** A fact about their machine, so the memory store holds the authoritative *current* version
  (§G-route) — restated here because a dispatched subagent gets its clauses by brief-injection and
  cannot read that store.

---

**Provenance:** clauses A–H are promoted from the channel-forge Enforcement Contract (design source:
`docs/superpowers/specs/2026-07-14-channel-forge-design.md` §5), `CLAUDE.md`'s former rules 1–6, and
the human-feedback memory store. **Every clause is human-confirmed** (§G forbids codifying a lesson
before the human confirms it), so none is open to quiet re-litigation. **[user-directed]** marks the
ones the human worded themselves.
