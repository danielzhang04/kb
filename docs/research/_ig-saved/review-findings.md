# Independent review — 2026-08-17-ig-saved-ai-build-ideas.md

Reviewer: independent (did not write the report). Checked report claims against `_ig-saved/notes/*.md` and `manifest.json`.

## Build-now (ideas 1–8) + TL;DR — VERIFIED CLEAN
All eight Build-now ideas and the TL;DR top-5 trace correctly to their cited notes and timestamps:
- #1 autonomy gate: Da6kEv3JMY3 @00:39 (20×@≥95%, revoke <90%, notify) — exact match; SkillTree 3-tier ladder DbYh2P @00:34 — match.
- #2 Git Timeline: DXwl0ryhbgV @00:04/00:23–00:25 (Planning/Execution/Review tabs, wave-Gantt, worktree auto-cleanup, Sonnet=simple/Opus=complex) — match.
- #3 rubric-in-skill: Dbi4ruODNlK @00:13 Maker/Checker, @00:44 /goal + criteria-in-skill; Dbs0166h9ZB @00:28–00:31 can-verify gate — match.
- #4 approval inbox: DcGmHU6NSjB @00:45–00:55, DZErwKSCT2z @00:56–01:01, DbY9KatgSMi @00:08 — match.
- #5 semantic layer: DbQrgz6haNi 21%→95% @00:00, define-once @00:24, single-source @00:48 — match.
- #6 cheap triage: Da6kEv3JMY3 @00:00 — match.
- #7 context-efficiency: DbPdttTxfjg (rules/ glob-scoped, block-dangerous-bash.sh, output-styles/terse.md all on the static infographic), DXwl0ryhbgV @00:26–27 OpenViking — match.
- #8 prompt-cache order: Daxhbdmk5G9 cache-node diagram + "cache the stable prefix" rule — match.
kb-fit claims across Build-now are honest and consistent with the primer (no "kb lacks X" overstatements found in this tier).

## FINDINGS (my own checks)

[minor] Build-now #1 ranking basis — The #1/TL;DR-#1 idea is sourced entirely from Da6kEv3JMY3, an animated allegory with NO product shown (note: "nothing here worth stealing visually … the only value is the described policy logic"; appendix flag T). The report DOES disclose this ("the reel narrates this as an allegory (no product shown)") and ranks on kb-feasibility, which is defensible — but a reader should know the flagship idea rests on a narrated policy, not a demonstrated mechanism. No fix required; disclosure is adequate. Logged for transparency.

[major] Surviving duplicate: budget/headroom tile appears twice — Idea #18 ("headroom/budget tile rendering spend-vs-cap + remaining daily budget from ledgers/cost + budget.yaml", cites Dbn6ElTvw_W @00:07–00:15) and Idea #29 ("a remaining-daily-budget headroom gauge", cites Dbn6ElTvw_W @00:14–00:15) are the same free-tier/budget-headroom tile from the same reel. Fix: drop the headroom gauge from #29 (keep #29's promote-to-cadence + $/unit-vs-baseline, which are distinct) and cross-reference #18, or merge the tile into one place.

[minor] Substantive video feeds no idea (possible dropped idea) — DcEQbIdK-p0 (appendix row 6, flagged **S**, "awesome list-of-lists as a ready taxonomy/seed corpus for a tool catalog") is cited by no ranked idea. Either it should feed idea #12/#27 (a seed taxonomy for the imported-skills/agent catalog) or be down-flagged. Fix: add a one-line fold into #12/#27, or note why it was dropped.

## High value (ideas 9–22) — verified against all cited notes
No blockers, no majors. All four scrutinized numeric/attribution claims check out: turbovec 31GB→4GB≈8× (report correct, caption's 16× IS an overstatement per the note's own math), task-observer 600/40 exact, OAuth `preview_render_cost`/`get_session_status` real on-screen, Pinchtab ~800-token/13× correctly flagged caption-level. Ideas #10,11,12,13,14,15,16,17,18,20,21 fully clean. No merge-worthy duplicates in this tier (#3↔#16 are siblings, not dupes). Minor fixes:

[minor] #9 governed tool-access — DboaQE_tYbn citation `@00:00–00:17` too wide: the fail-closed/folder-trust/JSONL README bullets are only in the frame held @00:00–00:04 (00:05–00:22 is a different artifact). Fix: narrow to `@00:00–00:04`.

[minor] #9 governed tool-access — Liman cited `@00:07` in DbG_xa3y_d6; the "Guardrails & permissions" slide (concept #7, where Liman sits) is at `@00:08` (00:07 is the prior "Orchestration patterns" slide). Fix: change to `@00:08`.

[minor] #9 governed tool-access — DcHPKO-gQLs labeled "caption-sourced" for blast-radius, but the BLAST RADIUS panel does appear on-screen inside stylized/generative B-roll (no real product). Internally inconsistent with idea #19, which calls the same reel "stylized B-roll." Fix: harmonize to "caption + stylized B-roll, no real product."

[minor] #22 token-cheap web perception — over-specifies the mechanism: "accessibility-DOM snapshots with stable element refs" and "smart-diff mode" appear only in the IG caption, not the captured frames (the note supports only "Page snapshots," Go binary, HTTP API, on-screen benchmark table). Report flags ~800-token/13× as caption-level but not the accessibility-tree/stable-ref/smart-diff framing. Fix: mark those as caption/inferred too.

[minor] #19 fleet-grid — weakest-sourced High-value entry: all three sources are appendix-flagged **T**, and its distinctive selling element (ACCESS LEADER / BLAST RADIUS / ACTION HEAT panels) comes only from DcHPKO generative B-roll, no real product. Report is honest ("bot-farms — take only the pattern") but this sits at the High-value/Interesting-later border. Fix: flag the security-panel novelty as B-roll-only, or note the tier borderline.

## Interesting-later (23–30), Dashboard refs, Appendix — verified
Ideas 23–30 mechanisms all trace correctly. Dashboard-refs bullets all spot-check clean (incl. the DboaQE "Qwen beats Fable 5" narration-vs-chart note — corroborated: chart shows Fable 5 #1/1318, Qwen #2/1305). **Appendix table: all 37 rows' author + publish-date + post-id match manifest.json exactly; "23 substantive / 14 thin" count is correct.** No wrong authors/dates/links. Fixes:

[minor] Idea #25 fyt short-form — DcG5MjqOVYp cited `@00:11–00:27` but the video is only 21s (00:27 doesn't exist). Actual surfaces: config-health pills @0:11, output-gallery @0:13–14, config.toml/deploy @0:17–18. Fix: change to `@00:11–00:18`.

[minor] Dashboard refs — "Batch web-enrichment builder … Pairs with the 'X/N analysed' scan-line counter, DcGmHU6NSjB @00:00–00:05." At 00:00–00:05 the note shows the hours-saved heatmap counter, not the X/N counter; the "X/30 analysed" grid-scan is @00:25–00:35. Fix: change the parenthetical to `@00:25–00:35`.

[minor] Appendix row 28 (DcBcYSwN5U7) flagged **T** while its note documents a real running product dashboard (profitphones.com Fleet Control Center). Defensible under the report's own "T = about the video" rule (7s, music-only, caption-only stats, account-farm) and the row already says "UI real, but account-farm"; logged for completeness, no change required.

## DROPPED high-value dashboard/UI ideas (user explicitly wanted these)

[major] Three buildable dashboard/UI patterns are present in the notes but absent from the report:
- **A. Per-stage HUMAN-LED / CLAUDE-LED input→output card pairs** (DXwl0ryhbgV @00:06–08). Each pipeline stage renders paired cards naming who drives it + explicit typed Input/Output artifacts. A clean who-does-what template for documenting kb workflow-platform stages; distinct from the Git Timeline view (#2). Fix: add as a dashboard-ref bullet or fold into #20/#21.
- **B. "N sources → central AI node → result card" converge-flow grammar + live funnel-stage row** (DcGmHU6NSjB @00:08–24). The report mined this reel's self-healing card, inbox sidecar, and scan counter but skipped the reusable multi-source-converge flow diagram and the live-incrementing funnel row — both directly usable for kb cadence/routine status displays. Fix: add a dashboard-ref bullet.
- **C. Operator→N-department-agents→per-agent-task-list org-chart** (DbyA5hlSvI7 @00:56–01:23, "Delegation" card). One-operator→department-agent→task-list org diagram that maps onto kb's dispatcher→agents IA. Report folded this reel's staged-maturity card but dropped the delegation org-chart. Fix: add as a dashboard-ref bullet.
Lower-priority also-absent: HITL / on-loop / out-of-loop 3-mode diagram (DbG_xa3y_d6 @00:10, pairs with #1).

---

## Summary counts
- **blocker: 0**
- **major: 2** — (1) surviving duplicate: budget/headroom tile in both #18 and #29; (2) three dropped buildable dashboard/UI ideas (A/B/C above).
- **minor: 9** — five #9/#22/#19 precision+timestamp fixes, two timestamp fixes (#25, dashboard-ref X/N), DcEQbIdK-p0 feeds no idea, plus logged-only items (#1 disclosure, row 28 flag) requiring no change.

Overall: the report is highly accurate — every Build-now and High-value numeric/attribution claim traces correctly to its note, and the entire 37-row appendix is error-free on author/date/link. No fabricated claims or wrong-reel citations found. The only substantive gaps are one real duplicate and three dropped dashboard/UI patterns.

**Most important fix:** add the three dropped dashboard/UI patterns (A/B/C) — the user explicitly asked for dashboard/UI-UX ideas, they are concrete and buildable, and they are the only genuinely missing content (everything present is well-sourced).
