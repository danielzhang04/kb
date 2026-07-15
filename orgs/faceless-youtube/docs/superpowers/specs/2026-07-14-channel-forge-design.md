# channel-forge — Guided Channel-Genesis System (Design)

**Status:** DESIGN (brainstormed + human-approved 2026-07-14, Daniel). Not yet planned/built.
**Next:** `writing-plans` → a phased, iteration-gated implementation plan.

---

## 1. Purpose

Building **The Second Take** was an artisanal prototype — weeks of hand iteration to lock a niche,
a visual style, a voice, a pipeline, and the operating discipline to run it. **channel-forge** turns
that one-off effort into a repeatable, guided system: a fresh channel is created by *walking a
stage-by-stage conversation* where the machine researches, generates converged options, and the human
holds final say — with **all the Second Take learnings (tech AND process) baked in as structure, not
prose.**

Two goals, equally weighted:
1. **Borrow the tech** — reuse/adapt the skills, schemas (`dna.md`, `style-bible.md`, `registry.json`),
   guardrails, and infra we already built. Second Take is a *reference exemplar*, not a thing we clone
   wholesale.
2. **Borrow the process discipline** — encode the hard-won "how to work well" lessons (establish context,
   right-size effort, use the right skill, converge internally, don't redo good work, clean as you go, be
   critical) so run *N+1* is smarter and more efficient than run *N*, and no future terminal repeats
   Second Take's mistakes.

**Success test:** a new channel reaches "ready to produce video 1" with the human making only *taste /
strategy / final-approval* decisions (~2 iterations per locked artifact, not 30), a clean file tree, and
every guardrail baked in from birth.

---

## 2. Architecture — three layers with different lifespans

The core insight that makes "one skill" the right answer *and* preserves per-channel freedom: separate
what is currently fused into three layers.

| Layer | Lifespan | What it is |
|---|---|---|
| **A. Enforcement Contract** | Invariant (grows only via the learning loop) | The meta-learnings — the "how to work well" law. Shared by every channel and every process variant. §5. |
| **B. Capability Map** (per-channel recipe) | Data, divergent per channel | How each pipeline slot is *resolved* for this channel (reuse / reconfigure / adapt / build / n/a). §4. |
| **C. `channel-forge` conductor** | Stable, thin | The skill that **reads the Capability Map** and **enforces the Contract**. Does no creative work itself. §3. |

Because the variable part (B) is data and the invariant part (A) is a shared doc, the conductor (C) stays
small and stable. The human gets **one entry point** (`/new-channel`), **full freedom to diverge** per
channel, and **preserved learnings** — with no contradiction. A monolithic hard-coded skill would force a
choice between these; this does not.

This decomposition also rides on the existing **intent/mechanism split** already designed into the
pipeline ("future-proof the coming engine swap") — the conductor authors *intent*; the executor per slot
is swappable.

---

## 3. The conductor (`channel-forge`)

A **thin** skill, invoked as `/new-channel`. It owns exactly four things:

1. **The stage sequence** — drawn from the Capability Map, not hard-coded.
2. **The human gates** — where the human decides (taste, strategy, irreversible, money).
3. **Skill-routing** — each stage hard-names the skill that does the work (no in-the-moment "does this
   skill exist?"; the live skill registry is authoritative — consult/search before hand-rolling).
4. **The discipline gates** — it *structurally enforces* the Contract (won't advance until the critic
   pass ran, context was read, the workspace was pruned). The Contract *informs*; the conductor
   *enforces*. This distinction is load-bearing: "read the doc" alone is a wish (rules get skimmed);
   the gate is what actually binds.

**Runtime flow:** `/new-channel` → **Stage 0 (establish context)** → walk the stages from the Capability
Map, each producing a *locked artifact* into the channel folder → ends with a complete, guardrail-verified,
ready-to-produce channel + a seeded idea backlog → **post-run learning loop** (§7).

`channel-forge` is **resumable**: state persists to files, so a dead terminal picks up mid-genesis.

---

## 4. The Capability Map — stages as resolvable slots

A channel is not a fixed stage list. It is a set of **capability slots** (research · script/storytelling ·
visual/motion · audio · render · publish · analytics · …). For **each slot, per channel**, `channel-forge`
resolves *how it is satisfied*:

- **reuse** — existing skill, as-is.
- **reconfigure** — existing skill, new channel config/grammar (e.g., `long-form-writer` + a new
  `storytelling-grammar.md`).
- **adapt** — fork an existing skill into a channel variant.
- **build** — a brand-new capability that doesn't exist yet (e.g., an AI-video-prompt writer replacing
  image-gen for a fully-AI-video channel).
- **n/a** — slot unused by this channel.

At each slot the conductor is **smart**: from the channel's declared shape (niche + chosen production
pipeline), it *proposes* the resolution with reasoning ("your look is AI-video → image-gen slot resolves
to **build** a prompt-writer; audio → **reconfigure**; research → **adapt**"), and **prompts the human** to
confirm or redirect.

**Build slots route into the full disciplined path** (self-application, §5-B): a `build` resolution does not
get hacked inline — it invokes `brainstorming → writing-plans → implement → TDD → dogfood → register`, then
the new capability becomes a selectable option for future channels. `channel-forge` thus orchestrates
*capability creation*, disciplined, not just channel filling-in.

**The per-stage internal-convergence loop** (this is what turns 30 human iterations into 2): when a stage
runs, the machine iterates *before the human ever sees anything* —
> scope-bounded research → generate options → **fresh-eyes self-critique vs. the Contract + guardrails** →
> refine → *only then* present converged options (in an Artifact).

The human spends their ~2 rounds on taste, not on fixing obvious misses. This is the proven scriptwriter
critic-layer pattern, reused as the engine of the wizard.

---

## 5. The Enforcement Contract

The invariant law (Layer A). Every clause is written to be **enforceable** (a structural gate or a
brief-injection), not vague advice. It governs the conductor, every stage skill, and every `build`
sub-flow (recursively).

### 5.1 Usage grammar — how this doc is actually used at runtime
- **Standing invariant** at a known path; **binding**, not advisory.
- **Read at Stage 0** by the conductor; the **relevant clauses are injected into each stage's brief** so a
  subskill/subagent operating a stage receives them.
- **Enforced structurally where possible** — the conductor gates advancement on the checkable clauses
  (critic pass ran? context read? workspace pruned? upstream validated?), rather than trusting
  self-policing. A few *mechanical* clauses (never `git add -A`; stage explicit paths) become actual
  **harness hooks**.
- **Evolves ONLY via the learning loop** (§7), with human confirmation — never ad-hoc. Versioned.

### 5.2 The clauses

**A. Orient before acting.**
- *Context-first gate:* before suggesting anything, read current state — CLAUDE.md routing, latest handoff
  + `decisions.md`, the relevant existing assets. Never propose what already exists or was already decided.
- *Know what exists:* the live skill registry is authoritative — consult it (it's in context) or search
  before hand-rolling or concluding no skill fits.

**B. Use the right tool, the right way (incl. self-application).**
- Invoke the **named skill** for a task; don't hand-roll what a skill does.
- **Self-application:** when the task *is* creating/iterating a skill or doc, use the builder tooling
  (`skill-creator` / `writing-skills` / `curate-doc` / `humanizer`) — **never ad-hoc hand-edit.** We build
  our builders with the same discipline. `channel-forge` doesn't get to hack a skill together because it's
  "inside" the wizard.
- **Brainstorm before building; plan before implementing.** No jumping to scaffold/code.
- Surface progress on long async work; don't run opaque chains silently.
- *(No comprehensive task→skill table — it duplicates the skill descriptions and rots. The principle +
  the live registry are the mechanism; only genuinely non-obvious routings are called out inline.)*

**C. Right-size the effort.**
- Match research / agent fan-out to the question. No massive workflow for a small ask *(the
  deep-research-for-a-moderate-question mistake)*.

**D. Validate before you commit effort — up and down the chain.** *(The anti-rework rule — Second Take's
biggest time sink.)*
- **Don't fire a generative/expensive step until its upstream input is validated/locked** (no image-gen off
  an unreviewed VPW).
- **Don't redo good work** — reuse-before-regenerate; if it passed, leave it.
- **Confirm the step is correctly configured before a batch run** (the "hand-running" bug).
- **Don't lock a stage on theory — dogfood it on one real artifact first** ("not yet proven on a real
  video" was the recurring Second Take failure).

**E. Think critically — don't yes-man.**
- Push back, name problems first, ask clarifying questions, narrow scope. Be **critically honest**
  (weaknesses before wins).
- Present *options* for taste/design calls, not one pre-picked answer.
- **Converge internally, then present** (§4) — the human sees converged output, spends ≤2 rounds on taste.

**F. Files, git & housekeeping.**
- Files are the memory; every durable decision/output is a file. **Log decisions with rationale + rejected
  alternatives** (provenance, so calls aren't re-litigated). Dates absolute.
- **Integrate, don't append.** Keep docs structured, concise, general; author at **router altitude** so a
  fresh terminal with zero context resumes; restructure drift (`curate-doc`).
- **Parallel terminals share the tree:** stage explicit paths, never `git add -A`, never rewrite history.
- **Clean as a verb:** exploration is ephemeral and pruned on lock; after work, **actively sweep** —
  irrelevant scratch slugs, resolved handoffs, superseded files. Only named, locked assets persist.

**G. Learn from every run.** *(The engine — see §7.)*
- After a run, harvest what tripped us up and what worked → **confirm the generalization with the human**
  (abstract it, don't over-fit to the one channel) → fold it into the right durable layer (Contract /
  Capability Map / a skill / guardrails). This is what makes run *N+1* smarter.

**H. Human authority.**
- Everything committed to a channel gets **human final say**. The machine converges; the human owns
  taste/feel.
- **Ask at the right altitude:** gate the decisions genuinely the human's (taste, money, strategy,
  irreversible); decide sensible defaults yourself and just report.
- **Confirm irreversible / outward-facing actions** (publish, spend, create external accounts) unless
  durably authorized.
- Review via the right medium: **Artifact** for images/option boards, **VS Code** for files, the **device
  player** for video/audio.

### 5.3 Deferred (known future additions, not built in v1)
- **Compliance & business safety** (YouTube inauthentic-content differentiation, licensing, AI disclosure,
  audit/publish gate). Deferred because the project is at Stage-0 full-human-publish-gate anyway; add before
  autonomy advances.

---

## 6. Clean file-system model

The `_style_iter` / `_tone_compare` / `_angle_test` litter in Second Take's `visual-kit/` *is* the "dirty
work" this project eliminates. Rules:

- **Named, locked assets persist** in a tidy, predictable channel tree (mirrors `_TEMPLATE/`, enriched).
- **Exploration is ephemeral** — each stage explores in a `.workspace/<stage>/` that is **auto-pruned when
  the stage locks** (the chosen artifact is promoted to its named home; the rest is deleted).
- **Active housekeeping** at run end: sweep irrelevant scratch slugs, retire resolved handoffs, remove
  superseded files.
- **Inheritance:** universal infra (`universal.md`, playbook, the skills, dna/style-bible/guardrail
  *schemas*) is **referenced, never copied**; only channel-specific content is written into the channel
  folder.

*(Exact tree layout + the promote/prune mechanics are pinned during `writing-plans`.)*

---

## 7. The learning loop (Contract clause G, expanded)

The mechanism that satisfies the whole goal ("every run preserves learnings and gets more efficient"):

1. **Harvest** — at run end (and on notable mid-run friction), the conductor captures what caused rework,
   what a stage got wrong before converging, what the human redirected.
2. **Abstract** — generalize each item to a portable lesson (not "the horror channel's research was too
   broad" but "research scope must be declared per niche-shape"). Avoid over-fitting to the one channel.
3. **Confirm with the human** — surface the proposed generalization; the human approves/edits before it is
   codified (our `feedback-is-a-learning-system` rule).
4. **Route to the durable layer** — fold the confirmed lesson into the Contract, the Capability Map
   defaults, a skill, or the guardrails — *integrated in place*, not appended.

Result: the Contract and the smart-proposal defaults improve monotonically; channel #3 is built more
efficiently than channel #2.

---

## 8. Production-pipeline registry (the extension seam)

"Which animation/render style?" reads from a registry of **built** production pipelines. Today: one
(stylized-stills + Remotion compositing — Second Take's). New pipelines (2D-animated ComfyUI stack;
AI-video-gen) are **separate projects**; once built, each **registers itself** as a selectable option — a
clean plug-in, not a retrofit. The conductor *selects and configures* among what exists; it never conjures
a pipeline that hasn't been built.

---

## 9. Non-goals / out of scope (v1)
- **Building new production pipelines** (2D-animated, AI-video) — each is its own brainstorm→plan→build
  project that plugs into §8. v1 targets the wizard against the pipeline we *have*.
- **Compliance automation** — deferred (§5.3).
- **The niche brainstorm** is *Stage 1 of the wizard*, not a separate deliverable.

---

## 10. Open questions for `writing-plans`
- The exact **default Capability-Map / stage sequence** (the seed recipe).
- The precise **clean-FS tree layout** + promote/prune mechanics.
- Which discipline clauses become **harness hooks** vs. conductor gates vs. brief-injection.
- **Phasing:** likely (1) Contract + conductor skeleton + clean-FS + Capability-Map model + one reused
  pipeline, dogfooded; then (2) the internal-convergence stage skills; then (3) the learning loop; then
  (4) richer slots. The dogfood target (a low-risk real channel vs. re-deriving Second Take) is a planning
  decision.
