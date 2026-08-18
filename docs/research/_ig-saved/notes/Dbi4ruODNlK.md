# Dbi4ruODNlK — Building your first verification loop (Boris Cherny)
- post: https://www.instagram.com/p/Dbi4ruODNlK/ | author: @Chanyoung Ryu (Chandler) | published: 20260802 | duration: 61s

## What's demonstrated
A split-screen video: a talking-head interview clip of a man labeled "Created Claude Code" (on-screen credit, presumed Boris Cherny) saying verification loops are the single most important skill for building agents that actually finish work, intercut with the creator (Chandler) narrating a concrete recipe for how to build one in Claude Code using a skill file + the `/goal` command. Several diagram overlays are shown explaining loop mechanics.

## Concrete mechanism
The recipe given: (1) write a skill file that tells Claude both how to do the task well AND how to grade its own output — "the exact set of standards you go through when you examine Claude's work" — in the same file; (2) when giving Claude the task, invoke `/goal` so Claude Code runs a loop: Claude works → an evaluator model checks the work against the goal criteria → if not met, sent back to work → repeats until goal is met or a turn/try limit is reached → loop ends. One on-screen example goal string: "/goal get the homepage Lighthouse score to 90 or above, stop after 5 tries." If the loop still doesn't produce good enough output after setup, the fix is to improve the verification loop itself, not to keep manually re-prompting.

## Named tools / repos / models / APIs
- **Claude Code** — the tool being discussed throughout; on-screen credit "Created Claude Code" attached to the interviewee [frame 00:02]
- **`/goal`** — Claude Code slash command shown explicitly as a UI card: "Claude Code /goal" [frame 00:44-00:45], and used to trigger the Goal-Based loop type in the loop-taxonomy diagram [frame 00:58]
- **Skill file** — referenced repeatedly as the artifact that carries both task instructions and grading criteria [audio 00:22, 00:37]
- No specific external repos, third-party APIs, or model names beyond "Claude"/Claude Code are shown or spoken.

## Specific claim / result
No quantitative benchmark is given for the technique itself; the only concrete number is the illustrative example goal string ("Lighthouse score to 90 or above, stop after 5 tries") used purely as a syntax example, not a real measured result.

## Novel / buildable moments (with timestamps)
- 00:13 — Maker/Checker diagram: DISCOVER → PLAN → EXECUTE → VERIFY, split into a "Maker Agent" (discover/plan/execute) and "Checker Agent" (verify) — a clean two-role loop pattern worth adopting directly for any agent pipeline needing a self-check stage.
- 00:44–00:47 — Concrete syntax pattern: put grading criteria in the same skill file as task instructions, then invoke `/goal` so Claude Code's own evaluator model loops until the goal condition is met or a try-limit is hit — a directly actionable Claude Code feature, not just a concept.
- 00:57–00:58 — "Types of Loops" taxonomy chart, four patterns each with a trigger and flow: **Turn-Based** (triggered by user prompt; gather context → take action → check work → response), **Goal-Based** (triggered by `/goal`; Claude works ↔ evaluator model → loop ends on goal-met or turn-limit), **Time-Based** (triggered by a time interval; runs a fixed prompt on a schedule, sleeps between runs), **Proactive** (triggered by event/schedule/human prompt; dynamic workflow → trigger → fix → review → task closed). This is a reusable design vocabulary — directly overlaps with and could sanity-check our own loop-design-check skill/HEARTBEAT cadence patterns.

## Transcript highlights
- 00:13–00:15 — "Verification loops are the single most important thing when building AI agents that actually get your work done."
- 00:24–00:29 — "It says it's done just like you wanted, but when you take a look, it's not up to your standards."
- 00:31–00:34 — "What you should be doing is have Claude verify its own work. In other words, build a verification loop."
- 00:36–00:39 — "In the same skill file, tell Claude how to grade its own work."
- 00:43–00:48 — "Then when you give it a task, you slash goal so that the loop keeps running until it's met your standards."
- 00:48–00:52 — "If by any chance it still doesn't do a good enough job, then you need to fix your verification loop."
- 00:52–00:56 — "But once you have this setup, you'll have agents that hit your standards without asking for your help."

## Reliability
Substantive and directly actionable — not a thin lead-magnet. The core mechanism (skill file with embedded grading criteria + `/goal` command) is a real, specific Claude Code feature shown by name on screen, and the "Types of Loops" taxonomy is a genuinely useful conceptual framework, not vague hype. The only lead-magnet element is the closing "comment LOOP and I'll send the full guide," which gates a deeper writeup but doesn't undercut the substance already shown on screen.
