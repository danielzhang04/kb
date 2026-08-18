# DbyA5hlSvI7 — Figma visual framework for an agent setup
- post: https://www.instagram.com/p/DbyA5hlSvI7/ | author: @Oliver Merrick | published: 20260808 | duration: 152s

## What's demonstrated
A talking-head duo (two people, casual home-studio setting) narrate over screen-recorded cutaways of a Figma board displayed on a large curved monitor. The Figma file is titled "THE CLIMB" and is structured as five numbered stage-cards (01–05) laid out along a rising diagonal line-chart background, each card a self-contained "maturity level" for building an AI-run business/agent operation: 01 Context, 02 Execution, 03 Delegation, 04 Autonomy, 05 Compound. Figma browser tabs visible at top show this sits inside a larger workspace alongside other project pages ("MEZ Digital Products", "MEZ Studios Library", "Reel-Thumbnails", "Inspo Websites", "Mez-YouTube-Thumbnails"). Narration walks through a 5-step operator playbook: audit/document the business, put everything in one Notion/second-brain, wire Claude Code/Codex into real tools per department, automate triggers (heartbeat/cron/event), then compound via a repeatable "one factory, many products" pipeline.

## Dashboard / UI-UX observed
This is the core value of the video — a well-designed Figma information-architecture template, panel by panel:

- **Card 01 "Context"** (tag: OPERATOR): headline "AI knows your business cold." Contains a labeled numbered checklist "THE MOVES" (1 Build the Brain — all SOPs/offers/voice/rules in one Notion the AI reads; 2 Capture your voice; 3 Write your offers; 4 Connect and test), a "PROOF YOU'RE HERE" checkbox row, and a small flow diagram: "YOUR STUFF" (writing, client records, SOPs/docs, chat/voice notes, files/data) → arrows into a "THE BRAIN" node (Notion icon, "single source of truth") → arrow labeled "reads" → "OUTPUTS" node (Claude icon → "Answers in your voice" / "Drafts and decisions"). Footer tip strip: "Context beats cleverness."

- **Card 02 "Execution"** (tag: WORKER, WIRED IN): headline "AI does the work, wired into your real tools." Same THE MOVES / PROOF YOU'RE HERE layout. Flow diagram "THE WORKFLOW": YOU ASK (one copy-paste task) → CLAUDE CODE (icon, "the worker, with hands") → DONE, with a "Draft · Review" gate node above the arrow. A second sub-diagram "UNDER THE HOOD" shows a literal folder tree: YOUR WORKSPACE `/mezcorp` → `departments/` (cfo·cmo·cro·cdo·cos), `skills/` (the moves it can run), `data/·repos/` (projects and code), `.env·CLAUDE.md` (keys and house rules), with a leaf file `organic_jobs.json` and a note "the record it writes" pointing at a Notion icon.

- **Card 03 "Delegation"** (tag: MANAGER): headline "AI owns whole jobs." THE MOVES include "Write the brief: the job as a standing Notion page (trigger, steps, rules, examples)" and "Set the review loop: what the AI does freely vs. what stops for your yes." Org-chart diagram: YOU ("The operator") branching to three AGENT boxes — CFO (Finance icon) / CMO (Content icon) / CRO (Sales icon) — each expanding to its own task list (CFO: Reconcile, Invoice, BAS; CMO: Script, Render, Post; CRO: Enrich, Proposal, Follow-up). Caption: "Runs on Claude Code — one runtime, three agents, nine workflows."

- **Card 04 "Autonomy"** (tag: ARCHITECT): headline "It runs without you." Diagram "RUNS WHILE YOU SLEEP": TRIGGER box (6:00 AM → daily run / New lead → instant run) → arrow "FIRES" → "RUNS ON ITS OWN" box (Claude Code icon + a cron-style icon, annotated "Mac Mini + cloud · 24/7") → GUARDRAIL box (✓ pass → write / ✗ fail → alert) → "ON PASS" arrow into a Notion box ("the Brain · single source of truth", "row updated · status set · logged"). Side label running the length of the diagram: "REPEATS 24/7 · NO HANDS."

- **Card 05 "Compound"** (tag: OWNER, implied by "You architect, it scales"): "WHAT YOU POINT IT AT" row of three inputs — Data (leads, footage, docs), A goal (what to produce), Your rules (brand, offers, voice) — each with a downward arrow into "THE SYSTEM YOU DESIGNED: One factory. Many products." A horizontal pipeline diagram: GATHER → REASON → ASSEMBLE → PRODUCE (four icon nodes), with a MEMORY·NOTION icon hanging beneath the Reason→Assemble link. Footer: "IT SHIPS WITHOUT YOU — one run, fifty finished things," feeding into REELS / EMAILS output boxes.

Visual system throughout: dark navy cards on a light cream background, a thin white rising-line "climb" chart threading between the numbered cards, consistent card anatomy (tag pill → headline → subhead → "THE MOVES" numbered list → "PROOF YOU'RE HERE" checklist → a bespoke flow/org-chart diagram → a footer tip strip). This card anatomy (goal / graduation criterion / numbered moves / proof checklist / diagram) is a directly reusable IA pattern for any staged-maturity framework document.

## Concrete mechanism
5-stage operator maturity model, each stage gated by an explicit "Graduate when:" criterion (not shown verbatim in the frames captured but implied by card structure — e.g., Card 04's proof is "one workflow triggers itself and runs without your hand" / "it ran all weekend, untouched"). Underlying implementation per audio: one Notion workspace as single source of truth ("the Brain"); one CLAUDE.md departmentalized by function (marketing, revenue, ops, finance, delivery, design); Claude Code/Codex or a Mac Mini running Hermes/OpenCode-style agents per department; automation triggers via heartbeat (20–30 min cadence) or event-based hooks (new sale, new booking, new email from a given person) mapped to specific workflows.

## Named tools / repos / models / APIs
- Claude Code — daily driver / "the worker, with hands" [frame, card 02] [audio: "Claude Code or codex on your computer or your Mac mini"]
- Codex — alternative runtime, mentioned alongside Claude Code [audio]
- Notion — "the Brain," single source of truth / second-brain, explicitly named as one option among "Notion, Obsidian, local MD files" [frame + audio]
- Mac mini — hardware for always-on heartbeat/cron execution [frame diagram label "Mac Mini + cloud · 24/7"] [audio]
- CLAUDE.md — the root instruction file referenced in the folder-tree diagram [frame, card 02 under-the-hood]
- Vercel — a cron-style icon in Card 04's "RUNS ON ITS OWN" box is plausibly Vercel Cron based on shape/color, but not verbally confirmed — treat as uncertain [frame, unconfirmed by audio]
- Hermes agent / open core — named only in audio as alternative Mac-mini runtimes, not shown on the Figma board [audio]

## Specific claim / result
No quantified before/after metrics are shown on the board itself (unlike some other reels in this batch); the claim is structural/qualitative — "the business ran a full week without you; nothing broke" and "your calendar is mostly design and strategy" appear as literal PROOF-YOU'RE-HERE bullet points on Card 05, framed as self-reported graduation criteria rather than externally verified results. [frame]

## Novel / buildable moments (with timestamps)
- 00:00–00:04, 00:37–00:53 (Card 02 diagram): the literal `/mezcorp` folder-tree convention — `departments/`, `skills/`, `data/·repos/`, `.env·CLAUDE.md` — is a directly copyable repo-layout convention for a multi-department Claude Code operator setup.
- 00:56–01:23 (Card 03 org-chart): the "one operator → N department agents → each agent's own task list" org-chart diagram is a clean, reusable visual template for documenting a multi-agent delegation structure.
- 01:27–02:01 (Card 04 diagram): the TRIGGER → FIRES → RUNS ON ITS OWN → GUARDRAIL (pass/fail) → write-to-Notion pipeline is a concrete, implementable always-on automation shape, directly analogous to kb's own HEARTBEAT-cadence pattern.
- 02:05–02:24 (Card 05 diagram): "one factory, many products" GATHER→REASON→ASSEMBLE→PRODUCE pipeline with a shared Notion memory node is a reusable content/output pipeline shape.
- The overall five-card "goal statement / graduation criterion / numbered moves / proof checklist / diagram" template (all cards) is itself the most exportable artifact — a ready-made structure for documenting any staged capability rollout.

## Transcript highlights
"Six departments. 67 processes. One shared brain. And the agents come last. That last part is where everyone gets it backwards. People buy the agents first." [audio]
"Every SOP, offer, rule and decision in one Notion workspace. Claude reads all of it before it answers a single question." [audio]
"A heartbeat on a Mac mini wakes every 30 minutes and runs whatever is due. A sale, a booking, an email can each trigger their own workflow." [audio]
"Hand the system a goal, the data and the rules, and it runs the playbook on its own." [audio]

## Reliability
Substantive relative to most lead-magnet reels in this batch — while it ends on the standard "comment GUIDE" CTA, the Figma board shown is a genuinely detailed, well-designed artifact (not a mockup teaser): five fully worked cards each with a real numbered checklist, a graduation-proof checklist, and a bespoke system diagram. No hard metrics or screenshots of the live automations firing are shown — the "it ran all weekend, untouched" claims are unverified self-report — but the IA/template pattern itself is directly worth stealing regardless of whether the underlying business results are real.
