# DcGmHU6NSjB — Claude Routine install (5+10 setup)
- post: https://www.instagram.com/p/DcGmHU6NSjB/ | author: @Max Johnson | published: 20260816 | duration: 61s

## What's demonstrated
Pitch for "Claude Routines" — scheduled, recurring Claude automations — walking through 5 example routines: (1) a daily 9am content-generator that scans Reddit/Instagram/X and writes a script "in my voice," (2) a daily 7am ad-spend/performance report across Meta/Google/TikTok Ads, (3) a weekly Monday competitor-analysis scan of 30 competitors that downloads their winning videos to recreate, (4) a daily n8n workflow-error report with fix instructions, (5) a daily email handler that reads/categorizes/auto-replies to inbox mail and escalates flagged items for approval. CTA: comment "Routine" for a setup guide covering these 5 plus 10 more.

## Dashboard / UI-UX observed
Entirely animated motion-graphics mockups (light background, soft-shadow cards, one consistent visual system across all 5 routines) intercut with talking-head B-roll — not a captured real product, but a cohesive and well-designed UI language worth stealing wholesale for any "automation routines" dashboard:

**Intro / hours-saved counter** [0:00-0:05]: a stack of small rounded icon cards (routine "type" icons: sparkle, bar-chart, magnifying glass, share, envelope) fanned out like a hand of cards, then a calendar-heatmap-style grid of small rounded squares filling in (orange = active) as a big number counts up ("6h" → "17h" → "20h SAVED / WEEK").

**Routine 1 — Content generator** [0:06-0:15]: a clock icon animates to 9:00; then a flow diagram — source cards on the left (Reddit, Instagram, X, each a small card with platform icon + greyed placeholder text lines) connected by dashed lines converging into a center circular "AI" node (sparkle icon, pulsing purple glow), which fans out via a single dashed line to a result card on the right ("Today's Script" header + green "Ready" pill + a progress bar that fills in, then placeholder text lines appear representing the finished script).

**Routine 2 — Ad report** [0:16-0:24]: three source cards stacked vertically (Meta Ads / Google Ads / TikTok Ads, each with a live-updating "$X spend" figure and a small circular progress ring), each with a dashed line converging to a result card "AD SPEND $X" that increments in real time as each source's checkmark turns green. This dissolves into a 4-stage funnel row (Impressions → Clicks → Leads → Sales, each a card with an icon and a live-counting number, connected by "->" chevrons and an underline progress bar), which drops down to a "REVENUE · YESTERDAY $4,361" summary card.

**Routine 3 — Competitor analysis** [0:25-0:35]: a header pill ("Monday · niche scan") plus a top-right counter ("X/30 analysed") over a 6-column grid of small colored competitor avatar cards, each showing a platform icon and a follower count (e.g. 842K, 1.2M) that appears once that card is "analysed" (a horizontal scan-line sweeps across rows). This transitions to a "Top performers" section: a grid of colorful video-thumbnail placeholder cards on the left, and a "Recreate this week — Winning videos to remake" panel on the right listing up to 5 slots that fill in one at a time with a progress bar, a follower/view count, and a green checkmark as each "winning" video is selected.

**Routine 4 — n8n error report** [0:36-0:44]: a labeled pill header ("n8n · daily check", "Lead Sync" status top-right), then a horizontal node-graph exactly mimicking n8n's own workflow canvas: Schedule (clock icon) → HTTP Request (globe icon) → Code (`</>` icon) → Send (paper-plane icon), each a rounded card with a subtitle. When the HTTP Request node fails it turns red with an error badge; a "Workflow error" notification card appears below (title, timestamp "Today · 09:00", a red "HTTP Request — 401 Unauthorized · credential expired — Failed" row) with a "HOW TO FIX" numbered checklist (1. Re-authenticate the HTTP credential, 2. Enable retry on fail (3x), 3. Redeploy & re-run the workflow) whose items check off green one at a time as the fix "runs," after which the node graph shows the HTTP Request node turning green.

**Routine 5 — Email handler** [0:45-0:55]: a header pill ("Email handler · daily", "auto-replied: N" counter top-right), an inbox list (sender avatar initials, name, greyed subject line) — Stripe, Ana Rossi, Michael K., Weekly Digest, Demo request, Sarah — each row gaining a colored category badge (Billing/Support/Client/Update/Sales/Personal) and a green "✓ Replied" tag one at a time as a loading spinner resolves. One item (Michael K., tagged "Client" with an orange "⚠ Approve" badge) instead opens a right-side "Needs your approval" panel showing the drafted reply text and two buttons: "Approve & Send" (filled purple) and "Edit" (outline).

## Concrete mechanism
Each "routine" = trigger (schedule) → multi-source fetch → LLM processing/transform → structured output card, with the email-handler routine additionally modeling a human-in-the-loop approval gate for flagged items and the error-report routine modeling an auto-diagnosed, auto-fixed workflow failure with a visible fix checklist.

## Named tools / repos / models / APIs
- n8n — named explicitly and its node-graph UI is directly mimicked (Schedule/HTTP Request/Code/Send node shapes) [frame + audio, "a daily N8N error report... tells me every time something breaks inside one of my n8n workflows"]
- Meta Ads, Google Ads, TikTok Ads — as data sources in the ad-report mockup [frame]
- Reddit, Instagram, X (Twitter) — as data sources in the content-generator mockup [frame]
- Claude Routine (the product being pitched) — [audio, throughout]

## Specific claim / result
"If you use all five, you'll be saving 20 hours a week easily." [audio, 0:03-0:05] — an unverified productivity claim illustrated only by an animated counter, not a real time-tracking log.

## Novel / buildable moments (with timestamps)
- [0:00-0:05] "Hours saved / week" heatmap-grid counter as an onboarding hook — reusable pattern for summarizing automation ROI at a glance.
- [0:08-0:15] Multi-source-converge-to-single-output flow diagram (source cards → central AI node → result card) — a clean, minimal visual grammar for "N inputs, one AI-generated output," directly applicable to any of our own routine/cadence status displays.
- [0:16-0:24] Funnel-stage row with live-incrementing numbers (Impressions→Clicks→Leads→Sales→Revenue) — good pattern for a marketing-ops summary card.
- [0:25-0:35] Grid-scan-with-progress-counter pattern ("X/30 analysed") for a batch-processing job — directly reusable for any of our own batch/crawl-status UI (e.g. this very video-analysis task could use this pattern for a progress dashboard).
- [0:36-0:44] Error-report card with a "HOW TO FIX" checklist that visibly executes step by step and feeds back into the node graph turning green — a strong pattern for our own error/incident cards in kb's dashboards (queue/ledgers currently show status but not a self-healing checklist visualization).
- [0:45-0:55] Inbox-with-approval-sidecar pattern (auto-handled items get a checkmark inline; flagged items open a right-side approve/edit panel) — directly relevant prior art for kb's own human-gate/approval UI patterns (memory notes we already value "human gates one at a time" — this is a concrete visual template for that).

## Transcript highlights
- "The first is a daily content generator. It runs every day at 9 a.m., researches Reddit, Instagram and Twitter for the top trending topics and then delivers me a script written in my voice, ready for filming that day." [0:05-0:15]
- "The fourth is a daily n8n error report. This just tells me every time something breaks inside one of my n8n workflows, it tells me exactly how to fix it so I never have to worry that something isn't working." [0:36-0:45]
- "The last is a daily email handler... reads all of my emails every day, categorizes them, then responds to all of them unless something important flags and requires my approval and it will send it to me first to approve it." [0:45-0:57]

## Reliability
Lead-magnet pitch (CTA: "comment Routine for the install guide") with no real product screen ever shown — every panel is an animated mockup, not a captured app. That said, the mockups form one consistent, well-designed visual system across all 5 cards, and several of the interaction patterns (batch-scan progress counter, self-healing error checklist, inbox-with-approval-sidecar) are directly buildable references for kb's own dashboards regardless of whether "Claude Routine" as marketed is real.
