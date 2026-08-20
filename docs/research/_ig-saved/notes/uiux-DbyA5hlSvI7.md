# UI/UX note — Instagram DbyA5hlSvI7 (Oliver Merrick, "The Climb")

- URL: https://www.instagram.com/p/DbyA5hlSvI7/
- Creator: Oliver Merrick
- Format: 2m31s reel, mostly a hand pointing at a curved ultrawide monitor showing a FigJam/Miro-style whiteboard, cut with short talking-head segments
- Caption: "Six departments. 67 processes. One shared brain. And the agents come last... Audit everything... Then build the brain... Then hands... Then delegation... Then autonomy... Then compound."
- Accessible: yes, downloaded clean via yt-dlp

## What's on screen

Not a live product — a **Figma/FigJam whiteboard artifact** titled "THE CLIMB", used as a visual maturity-model / roadmap. Browser-style tab bar across the top lists sibling boards ("CRSLs", "Claude Code Carousels", "MEZ Digital Products", "MEZ Studios Library", "Reel-Thumbnails", "Inspo Websites", "Mez-YouTube-Thumbnails") — i.e. this whole workspace is one of several planning boards, browsed like open tabs.

### The Climb board structure
- A single rising diagonal line (mountain-climb metaphor) runs across the canvas; small circular waypoint markers sit on the line at intervals.
- Below each waypoint hangs a vertical dashed connector down to a **phase card** — 5 cards total, numbered 01-05, each roughly the same template:
  - Small pill badge top-left naming the *role* at that phase (OPERATOR, MANAGER, ...).
  - Big number top-right (01, 02, 03...) as a stage index.
  - Bold H1 phase name ("Context", "Execution", "Delegation", ...) + one-line subtitle in caps below it ("AI knows your business cold.", "AI does the work, wired into your real tools.", "AI owns whole jobs.")
  - "Graduate when: ..." — one sentence, the exit criterion for the stage.
  - "THE MOVES" — a numbered list (1-4) of concrete actions, each bolded verb-lead ("1 Build the Brain: All your SOPs...", "2 Capture your voice: ...").
  - "PROOF YOU'RE HERE" — a 2-item checklist with check-marks, i.e. observable done-criteria.
  - An embedded **mini diagram specific to that phase**, e.g.:
    - Phase 01 "Context": three-column flow "YOUR STUFF" (5 input boxes: your writing, client records, SOPs and docs, chat/voice notes, files and data) -> "THE BRAIN" (single box, "Notion, single source of truth") -> "OUTPUTS" (Claude icon box -> "Answers in your voice" / "Drafts and decisions").
    - Phase 02 "Execution": "YOU ASK" -> "CLAUDE CODE (the worker, with hands)" -> "DONE", with a side branch to "DRAFT - REVIEW". Below it, "UNDER THE HOOD": a folder tree diagram — "YOUR WORKSPACE (one folder Claude Code reads and writes)" branching to `departments/` (cfo · cmo · cro · cdo · cos), `skills/` (the moves it can run), `data/ - repos/` (projects and code), with example files `post_render.py`, `organic_jobs.json`.
    - Phase 03 "Delegation": literal small org chart — "YOU (the operator)" at top, branching to 3 agent boxes "AGENT: CFO (Finance)", "AGENT: CMO (Content)", "AGENT: CRO (Sales)" each with a colored icon, each expanding to its own task checklist below (CFO: Reconcile/Invoice/...; CMO: Script/Render/Post; CRO: Enrich/Proposal/Follow-up). Footer note: "Runs on Claude Code."
  - A "REMEMBER" callout strip at the bottom of the card with a one-line maxim (e.g. "Context beats cleverness. Feed the model your real docs, folders and rules first, then ask.").
- A definitions strip appears too: "DEFINITION — An agent is a named worker you hand a job to. Give each..."

## Visual system
- Very dark navy/near-black background, white/off-white line-art and text, minimal color (mostly monochrome with one accent per phase — blue, purple, red — used sparingly on icons/boxes only).
- Typography: bold condensed sans for headers, small-caps section labels, plenty of whitespace inside each card despite the density of text.
- Motion: none (static board), but pointer/hand-drag simulates a walkthrough — the creator narrates by literally touching the screen phase by phase.

## Steal-worthy patterns
1. **"The Climb" maturity-model board** — a single rising line with numbered waypoints, each dropping to a self-contained stage card (name, exit criterion, moves, proof checklist, phase-specific diagram, one-line maxim). This is a strong template for a kb "fleet/org maturity roadmap" or an onboarding path for a new project (`orgs/<project>/contract.md` maturity ladder), rendered as a single browsable canvas instead of a doc.
2. **"Graduate when: ..." exit criteria on every stage** — forces each roadmap phase to have one falsifiable sentence, not vibes. Directly reusable for kb wave/phase gates.
3. **"PROOF YOU'RE HERE" checklist** distinct from "THE MOVES" — separates the *actions* to take from the *evidence* you're actually done, which matches kb's verify-before-completion discipline.
4. **Folder-tree "under the hood" diagram embedded inside a narrative phase card** — showing `departments/`, `skills/`, `data/-repos/` as a literal directory map with example filenames. Good pattern for documenting kb's own repo structure inline in a roadmap doc/artifact instead of a separate reference page.
5. **Per-phase embedded diagram instead of one big system diagram** — each maturity stage gets its own small, purpose-built flow chart (input->brain->output; ask->worker->done; operator->agents->tasks) rather than reusing one master diagram at different zoom levels. Keeps each concept legible on its own.
6. **Sibling-boards tab bar** — the whole planning workspace is one of several named boards in a browser-tab-style strip, letting the audience see there's a whole library (thumbnails, carousels, inspo sites) without opening them. Analogous to a "workspace switcher" for kb's own multi-project artifacts/dashboards.
7. **One-line "REMEMBER" maxim per stage** — a pull-quote style takeaway distinct from the instructional content, good for reinforcing doctrine in kb's own docs/dashboards.
