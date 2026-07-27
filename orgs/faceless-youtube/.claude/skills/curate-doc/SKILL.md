---
name: curate-doc
description: Restructures a drifted document (skill, playbook, channel doc, spec, notes — any markdown/text file or folder) into concise, structured, comprehensive form WITHOUT losing information. Use for "clean up this doc", "restructure this file", "this skill is a mess", "de-dupe this", "appended to over and over", "stale/outdated stuff in here". Maps real learnings, detects drift (dated blocks, contradictions, duplication), rewrites structured-by-topic, preserving every learning. Do NOT use to author a new file from scratch, to shorten at the cost of information, or to edit code logic.
---

# curate-doc

Turn a rotted document into a **clean, structured, comprehensive** one — same knowledge, better form. The
failure this fixes: files that grew by *appending* (dated "added YYYY-MM-DD" blocks, bolted-on corrections
that contradict earlier sections, piles of one-off examples) until a fresh reader can't tell what's current
or find the load-bearing rule. This is a **rebuild-in-place**, governed by `knowledge/operating-law.md`
§F-docs (integrate, don't append).

## The one hard rule

**Preserve every real learning; cut only noise.** This is a restructure, NOT a summary and NOT a purge.
"Verbose" ≠ "removable." Test every line: *does it carry information or teach craft?* → keep it (reworded/
relocated). *Is it just scaffolding, filler, an orphaned example, or a duplicate?* → cut it. When unsure
whether something is a real learning, KEEP it and flag it in the report — never silently drop it.

## Process

1. **Read the whole target** (the file, or every file in the folder). Understand what it's *for* and who
   reads it (a skill a future pipeline run follows? a doctrine other files inherit? a channel lock?).
2. **Map the real learnings.** List every genuine principle/instruction/fact/decision the doc contains,
   independent of where it currently sits. This inventory is your preservation checklist — nothing on it
   may vanish.
3. **Diagnose the drift.** Mark each of:
   - **Append-drift** — dated "added/correction YYYY-MM-DD" blocks; content stacked at the bottom instead
     of integrated into the relevant section.
   - **Contradiction** — two places that disagree (usually an old rule a later note silently overrode).
     Resolve to the CURRENT/correct one; overwrite the stale.
   - **Orphaned examples** — quotes/examples with no context showing *how* a learning applies. Cut them
     unless they demonstrably teach the application.
   - **Duplication** — the same point made in several places; the same thing restated 4×. Merge to one.
   - **Over-specificity** — a "learning" that's really tied to one instance/date; generalize it into a
     portable principle (or cut if it teaches nothing general).
   - **Verbosity** — filler phrasing around a real point; tighten without losing the point.
4. **Design the structure.** Group the mapped learnings by TOPIC into a clean heading hierarchy. Put the
   load-bearing rules where a reader will see them (surfaced, not buried mid-prose) — an even-weight list of
   everything is not triageable. One topic = one home.
   Author at **router altitude** — a fresh terminal with zero context can resume from the doc.
5. **Rewrite in place.** Produce the restructured file: every learning from step 2 present, organized per
   step 4, contradictions resolved, drift removed, load-bearing rules emphasized. Match the file's house
   conventions (heading style, frontmatter, tone). For a **skill**, keep the YAML `description` accurate and
   follow skill best-practice (concise, scannable, the actual procedure prominent).
6. **Verify against the checklist.** Re-check the step-2 inventory against the rewrite — every item still
   present? Any cross-references to now-moved sections updated? Any other file that references this one by
   an old anchor/name needs repointing (grep for it)?
7. **Report** (below).

## Guardrails

- **Locked/spec-value files** (e.g. a `style-bible.md` with palette hexes, an invariant checklist, a voice
  lock): restructure the *form* freely, but **preserve the exact spec VALUES verbatim** — other artifacts
  were built against them, so changing a value causes silent breakage. If a value looks wrong, FLAG it;
  don't change it.
- **Don't invent.** You may reword and reorganize; you may not add new claims/rules the doc didn't hold.
- **Don't relocate scope.** Channel-specific detail stays out of niche-agnostic docs, and vice versa — if
  you notice misplaced content, flag it rather than silently moving it across that boundary.
- **Cross-file consistency.** If you rename/restructure a file others reference, grep the repo and repoint
  every reference (with section anchors) so nothing dangles.

## Output

The restructured file, written in place. Then a short report: the drift you found (by type), the
contradictions you resolved (old→new), anything you cut (and why it was noise, not a learning), anything you
KEPT-but-flagged as maybe-stale for a human call, and any cross-file references you repointed. If a
non-trivial structural decision was made, note it for `knowledge/decisions.md`.
