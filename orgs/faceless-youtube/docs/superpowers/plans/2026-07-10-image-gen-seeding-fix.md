# Image-gen seeding fix — plan (2026-07-10)

**Goal:** kill the base-bleed class of merge failures (tone / hair / costume / face all reverting to the bald
cream base) by replacing the accreted per-attribute prose clauses with ONE **attribute-provenance** principle,
fixing the §2 cream-tone contradiction, and adding the gaze + seed-quality + staging rules — then dogfood L17.
Keeps the asset-library seeding approach (no pivot to compositing, no single-seed-words).

**Discipline (baked into every task):** CHANGE the logic, don't append; each rule lives in ONE owner doc with
pointers (not restatements) elsewhere; DELETE every clause the provenance rule supersedes (no dead info); keep
image-gen ↔ style-bible ↔ VPW aligned. Task 5 is a dedicated anti-pitfall pass.

---

### Task 1 — Encode the attribute-provenance split (the core logic change)
**Files:** `.claude/skills/image-generation/SKILL.md` (Pass 1b binding template — owner of the merge mechanism)
+ `channels/the-second-take/visual-kit/style-bible.md` §5 (seed rules — owner of the doctrine).
- Replace the current binding-template delta + its accreted clauses (hand-tone rule, head/hair clause, "not
  blank-faced", "only mouth/eyes") with the single provenance table: **CHARACTER seed → identity + head tone +
  hair/facial-hair + costume + face; POSE/TEMPLATE seed → body pose + hands + clasp + placement + eye-line;
  EXPRESSION seed → eye/brow/mouth SHAPE only (never tone/identity).**
- **DELETE** the superseded standalone clauses (they're now subsumed) — this is a rewrite, not an addition.
- style-bible §5: the doctrine (one paragraph) is the owner; image-gen Pass 1b executes it and may POINT to §5,
  not restate the table twice.

### Task 2 — Fix the §2 cream-tone contradiction
**File:** `style-bible.md` §2 LOCKED descriptor (the blockquote `forge.py` prepends to identity-mode gens).
- Change the head-tone clause from the hard-coded invariant **"SAME flat cream head colour (#f5ead6)"** to
  **"the character's OWN flat head colour (the base default is #f5ead6; a character carries its registry
  `head_tone`)"** — so the descriptor stops asserting cream for a tan character.
- Verify `forge.py::blockquote_after` still parses §2 cleanly after the edit (run a `gen --help`-level import /
  a dry parse). No code change intended; if the tone still won't hold in the dogfood, injecting `head_tone`
  into the prompt from the registry is the fallback (Task 6 decides).

### Task 3 — Fix the handshake base template asset (eye-line) — an ASSET fix, not a rule
**File:** `channels/the-second-take/visual-kit/refs/base/handshake.png` (+ registry re-register).
- The current template's two mannequins clasp correctly but their **heads/eyes point forward — they don't look
  at each other.** Regenerate the template (seeded off the current `handshake.png`) so the two figures **turn
  their heads/eyes to look at each other**, bodies + right-to-right clasp UNCHANGED. Human-gate, then re-register
  (replaces the committed `handshake.png`). No merge-logic rule — the eye-line lives in the seed asset, so it
  transfers like the clasp does. (handoff/fistbump get the same asset treatment later IF the dogfood confirms
  the eye-line carries through the merge.)

### Task 4 — Clean-portrait-seed + staged 1-to-1 doctrine
**File:** `image-generation/SKILL.md` (Pass 1b / interaction procedure).
- **Clean-portrait-seed rule:** seed a character in a merge from a clean, isolated single-character portrait
  (canonical or a pre-merged posed portrait), NEVER a busy scene frame (weak identity signal → base seed wins).
- **Staged 1-to-1:** stage merges so a base-derived seed never holds a majority — `[character + expression]`
  then `[+ pose]`, each step one-character-vs-one-base. Generalize the existing staged-expression note into
  this one principle (change the existing text, don't add a parallel one).

### Task 5 — Anti-pitfall file-check pass (dedicated)
- **Redundancy:** grep the three docs for the old clauses (hand-tone rule, head/hair clause, "not blank") —
  confirm each concept now has exactly ONE home; remove any leftover copy.
- **Dead info:** confirm the superseded clauses are DELETED, not just out-voted by a new paragraph.
- **Cross-file alignment:** image-gen ↔ style-bible §5 ↔ VPW say the same thing once, via pointers.
- **Logic-not-append:** diff-review that the merge *procedure* changed, not that a paragraph was tacked on.
- Fix anything inline. (No commit until this passes.)

### Task 6 — Dogfood L17 + log
- Regen L17 (MacGregor + Bolívar handshake) with: staged 1-to-1, clean-portrait seeds, the provenance rule,
  the gaze rule, §2 tone fix. Seed the fixed pieces off the registered `handshake` template.
- **Measure (human gate, artifact):** MacGregor's tan tone held? hair/costume/face held? clasp geometry +
  correct hand? both LOOKING at each other? Compare to the prior L17-staged.
- **Decide:** if tone/geometry hold → the fix works, log to `decisions.md` + commit the doc changes. If tone
  still reverts → escalate to the `head_tone` prompt-injection fallback; if geometry still fails → that's the
  evidence that clasp/eye-line need a non-prose carrier (revisit compositing). Either way, log the outcome.

---

**Commits:** doc changes (Tasks 1–4) commit together AFTER Task 5 passes AND Task 6 confirms; the dogfood
frames are scratch (not committed). Explicit paths only (shared tree).
