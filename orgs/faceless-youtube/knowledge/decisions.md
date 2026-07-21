# Decision log (append-only)

Newest at the bottom. Every non-trivial decision or structural change gets a dated line with the
*reasoning*, so any future terminal can reconstruct how we got here. Never rewrite history — only
append. Open questions are tracked at the bottom.

---

**2026-07-01 — Architecture: Path B via validate-then-graduate hybrid.**
Claude Code orchestrates component APIs; Claude does all language work as file-based skills. Reason:
only composable APIs give the per-video originality + per-channel identity the July-2025 policy
requires; SaaS autopilots are closed loops. Source: Faceless Pipeline Build Report.

**2026-07-01 — Production: voiceover-led, not cloned-avatar.**
Reason: a cloned face adds a per-identity consent step that breaks unattended scheduling.

**2026-07-01 — Format strategy: long-form is the earner, Shorts are a funnel.**
Reason: Shorts RPM is 3–14% of long-form and the Shorts monetization bar is harder (10M views/90d).
See `research/format.md`.

**2026-07-01 — Verified two flagged claims.**
(a) 2025-12-04 upload-quota change (videos.insert ~1,600→~100 units, ~100 uploads/day). (b) 2025-07-15
"inauthentic content" policy rename + enforcement. Both confirmed via web search.

**2026-07-01 — Infrastructure decisions (from setup interview).**
- Region/language default: **US, English** (best RPM), overridable per channel.
- Budget: **no hard cap**, but prefer cheapest-that-works; log spend in `stack.md`.
- Guardrails: **no extra editorial guardrails**; YouTube policy/legal compliance still applies.
- Autonomy: goal is a **mostly-autonomous loop** via a staged trust ramp (currently Stage 0, full
  human gate). See CLAUDE.md.
- **Self-maintenance directive** [user-directed]: whenever work reveals the structure / CLAUDE.md /
  docs no longer match reality, change them and log it here — without asking.

**2026-07-01 — Built the project infrastructure.**
Niche-agnostic scaffold: CLAUDE.md router, `knowledge/` (playbook, stack, research), `channels/_TEMPLATE`,
`.claude/skills/`, `logs/`, git repo, dashboard wired in. No niche/channel committed yet.

---

**2026-07-01 — Research: dual-format niche pass (user request).**
Screened for niches that work as BOTH Shorts and long-form, excluding overplayed lanes (horror/Reddit
stories, true-crime gore, top-10 facts). Added a "Dual-format niches" section to `research/niches.md`
with an 8-niche ranked shortlist + a 3-part screen (atomic hook / narrative spine / asset reuse).
Leading fresh earners: Engineering Disasters, Business Collapses. Lowest-competition: "What If",
Internet Lore. Niche still not committed — this narrows the field for when we decide.

**2026-07-01 — Consolidated niches into ONE ranked list (user request).**
Collapsed the general shortlist + dual-format list into a single money-optimized ranking after a
YouTube-performance pass (named channels: MagnatesMedia, ColdFusion, How Money Works; Zack D. Films
26M subs / 65B views; Infographics Show 14M). Criteria: max RPM × dual-format × AI-generatable ×
proven. Recommendation: **#1 Business & Money documentaries** (best money + dual-format balance);
**#2 what-if / engineered curiosity** (virality). Horror re-checked per user: still growing / NOT
oversaturated, but a volume play with lower per-view RPM (tech-horror/internet-lore variant carries
higher CPM). Niche still not committed. `research/niches.md` now holds the single authoritative list.
Follow-up: user flagged Shorts performance matters for money+growth → weighted Shorts virality as a
first-class criterion and added the "viral FORMAT on high-CPM TOPICS" cheat code (e.g. a money what-if
Short → finance long-form) as the strongest strategy for the combined goal.

**2026-07-01 — Built the `idea-generator` skill (first pipeline skill).**
One niche-agnostic skill for all channels — niche is data in `channels/<name>/`, never forked per
niche. Design decisions from user interview: (a) idea depth = **structured brief** (angle, hook,
title options, target emotion, beats, why-original) — script-ready but leaves wording to
`scriptwriter`; (b) research = **hybrid/on-demand** — stored knowledge by default, live WebSearch in
strategy mode or on request; (c) format = **long-form primary → derive 1–3 short funnels each**;
(d) handoff = **generate + score + store; human picks now**, but every idea carries a
predicted-performance **score (/100)** and a **status** (`idea→picked→scripted→produced→published`)
so a future autonomous mode auto-advances the top-N by score with no rework (a filter, not a new
system). Originality guardrail built in (dedupe vs backlog + posted; no rival-cloning), per the
July-2025 policy. Updated `_TEMPLATE/idea-backlog.md` to the ranked-table + per-idea-brief format to
match the skill's output contract.

**2026-07-01 — Refined `idea-generator` (user request, same session).**
Three changes: (1) **Shorts bench of ~10** per long-form idea (was 1–3) — generate a deep bench, tag
2–3 `publish` + rest `bench`, since posting >2–3/video over-clips and hurts. Added
`references/shorts-clipping.md` (10 clip archetypes + hook/length/caption/B-roll rules) from web
research on long→short repurposing. (2) **Locked the scoring formula**: revenue-weighted /100 = hook
25 / demand-virality 20 / **monetization-RPM 15** (new, explicit revenue lever) / differentiation 15
/ emotion 10 / fit 10 / feasibility 5, with 0–N anchors in `references/scoring.md` for reproducibility.
(3) **Re-scoring cadence** = smart triggers + decay: re-score unused ideas on new `performance.md`
data + every strategy run + weekly time-decay on time-sensitive ideas; never re-score committed ones.
Also made the skill read a **niche-specific playbook** (being built by the tandem terminal) when one
exists, overriding general playbook for niche conventions. Created throwaway test fixtures
`channels/_test-money` + `channels/_test-whatif` for skill evals (marked TEST FIXTURE; safe to delete).
Note: a second terminal is concurrently building per-niche playbooks and will edit idea-generator +
scriptwriter afterward — coordinate, append don't clobber.

**2026-07-01 — Deep per-niche research (6 parallel subagents) → playbooks.**
Went deep on all 6 niches (dimensions: Discovery&packaging / Content&retention / Differentiation&angles;
user dropped the business/monetization dimension). Output: `knowledge/research/niche-playbooks/` with
`universal.md` (the "manager doc" — everything common across niches: hooks, titles, retention, packaging,
Short structure, the originality moat) + one niche-only file per niche (channels, title formulas, hook
flavor, beat-template, sub-niches, original formats, one illustrative worked example). Architecture per
user: universal content lives ONCE in `universal.md`; niche files hold only niche-specific info. Light
verification passed (Zack D. Films ~27M/70B ✔, MagnatesMedia ~1.84M ✔, hypnic-jerk mechanism ✔). Worked
examples kept illustrative (adapt per sub-niche), per user's over-templating concern.
**Skill-wiring HANDOFF (deferred — coordinate with tandem terminal):** wire idea-generator + scriptwriter
to read `universal.md` + the active niche playbook. NOT done here, to avoid both terminals editing the
same skill at once; tandem terminal owns idea-generator edits — coordinate via this log.

**2026-07-01 — Eval'd `idea-generator` (2 iterations, 4 subagent runs) + applied fixes.**
Tested with-skill vs no-skill baseline on two throwaway mock channels (`_test-money` strategy mode,
`_test-whatif` per-video mode). All assertions passed both with-skill runs; baseline comparison showed
the skill's value is disciplined *structure* (fixed revenue-weighted rubric, RPM as a metric, live-
research timeliness, 10-archetype shorts benches, pipeline-ready backlog file) that plain Claude
doesn't produce consistently. Iteration-1 surfaced 5 gaps → fixed in the skill: (1) ID prefix rule =
channel initials; (2) initialize a new backlog from `_TEMPLATE`; (3) evergreen ideas may skip citation
but get tagged `(evergreen — verify before scripting)`; (4) deterministic tie-break; (5) strategy-mode
bench sizing (full 10 only for top ~5, light 2–3 for the rest). Iteration-2 confirmed all 5 held, and
surfaced one more, also fixed: IDs are **creation-order, decoupled from Rank** (never renumbered), and
the tie-break chain now ends deterministically (total → Hook → Monetization → Differentiation → ID).
Skill is production-ready. Mock fixtures + eval outputs live in scratchpad/repo (`_test-*` marked
TEST FIXTURE, safe to delete).

**2026-07-01 — Completed the niche-playbook skill-wiring HANDOFF (idea-generator side).**
Per the handoff above, wired `idea-generator` Step 1 to read `niche-playbooks/universal.md` every run
(shared craft layer) + the matching per-niche file (`business-money.md`, `what-if.md`, etc., mapped
from `dna.md`'s niche), with `universal.md` governing common conventions and the niche file governing
niche-specific ones; `knowledge/playbook.md` remains the policy/cadence source. **`scriptwriter` still
needs the same wiring — left for whoever builds/owns that skill (not done here).**

**2026-07-01 — Built `scriptwriter` + confirmed the idea→script handoff (user request).**
Scope this pass = the handoff pair. idea-generator was ALREADY wired to the playbooks by the tandem
terminal (reads `niche-playbooks/universal.md` + `<niche>.md`) — verified, NOT rewritten. Built
`.claude/skills/scriptwriter/SKILL.md`: reads the **picked** idea brief (idea-generator's output
contract) + dna.md + `universal.md` + the `<niche>.md` playbook + playbook.md + shorts-clipping.md;
writes a self-contained per-video folder `channels/<name>/videos/<slug>/` = `brief.md` (copied) +
`script.md` (long-form VO with `[B-ROLL]`/`[PAUSE]` cues) + `shorts/short-NN.md` (the FULL viable
bench, each carrying its `publish`|`bench` status). Decisions from user: (a) long-form + full short
bench scripted (quality over a fixed count; publishing still paces to 2–3 — publish-queue's job);
(b) long + shorts in ONE per-video folder, shorts point back to the long-form; (c) humanize = baked
anti-AI-tell rules + a final `humanizer` pass; (d) enforce niche accuracy gates (health two-source,
engineering analysis-not-gore); (e) status `picked → scripted`. Output contract = input for
metadata-writer / visual-prompt-writer / voiceover. Updated CLAUDE.md routing+status, skills README
(scriptwriter → Built), per-video folder template.

---

**2026-07-01 — Connected ElevenLabs (Free tier) as the TTS provider.**
Global-infra step: no channel needed. API key generated in the ElevenLabs dashboard (named
`faceless-youtube-pipeline`), scoped narrowly — TTS Access; Voices/Models/History/User Read;
everything else No Access. Wired into `.env` as `ELEVENLABS_API_KEY` (git-ignored). Sanity-tested
with a raw HTTP POST to `/v1/text-to-speech/{voice_id}` using preset voice **George**
(`JBFqnCBsd6RMkjVDRZzb`) on model **`eleven_v3`** — HTTP 200, 30 KB MP3 returned,
content-type `audio/mpeg`. Free tier is intentional and temporary: caps at 10k chars/mo, **has no
commercial license**, and requires attribution — none of which is workable for a monetized channel.
**Upgrade trigger:** the day we start scripting the first real video for a real channel. **Target
tier:** Creator $22 (100k chars/mo ≈ ~13 long-form videos/mo — comfortable for the 1–2 long-form/week
playbook cadence with headroom for a second channel; Starter $6's 30k is too tight). Per-channel
voice-ID lock remains deferred — it belongs in each channel's `dna.md`, and no channel exists yet.
SDK vs raw-HTTP decision (Python SDK vs `requests`) also deferred to when we build the `voiceover`
skill; either is fine and stays behind the file-based skill boundary.

**2026-07-01 — Verified the render provider (market sweep) + connected JSON2Video (Free tier).**
User asked to confirm JSON2Video is genuinely the best render/assemble tool before committing. Ran a
web sweep judged against OUR requirements (API-driven JSON→MP4, sync external ElevenLabs VO to
visuals, B-roll+captions+Ken Burns, long-form 8–15 min, cost-sensitive, provider-swappable). Field:
JSON2Video, Shotstack, Creatomate, Remotion (wildcard), Rendi. **Verdict: JSON2Video stays the
default.** Deciding factors: (1) it's the only big-3 that **bundles TTS + AI image generation into
render credits** — can collapse pipeline steps 6–8 and removes the need for a separate image-gen
connector; (2) 200 **Full-HD** min on Pro covers our cadence (~85 finished min/mo, 2–3× with
re-renders) whereas Creatomate's 144 min is short and Shotstack meters 1080p at a premium; (3)
purpose-built for faceless automation. **Disqualifiers found:** Shotstack "silently drops audio" in
automated Make/n8n flows + charges a 30% overage premium (unpredictable bills for an unattended loop);
Creatomate under-provisioned + fights you disabling default text animations. **Scale-up path noted:
Remotion** — self-hosted React, ~$0 marginal render, no per-minute meter; Claude can author the
compositions. Revisit when render-minutes become the cost bottleneck (≈ Stage 2 autonomy), not now.
Connected on the **Free tier** (same "don't pay until first real video" logic as ElevenLabs): key
wired to `.env` as `JSON2VIDEO_API_KEY`, role scoped to **Render** only. Sanity-tested end-to-end —
POST `/v2/movies` → poll `movie.status=done` → CDN MP4 verified `video/mp4` HTTP 200. **Upgrade
trigger:** first real video render → Pro $49.95. `render-builder` skill is now unblocked to build
against the free tier.

**2026-07-01 — Full doctrine rewrite: "entertainment, not education" (user request).**
User flagged the playbooks as too thin and too educational. Ran a fresh research pass — 4 parallel
Phase-1 agents (universal doctrine, hook archetypes, title/retention/payoff, long↔short interaction)
and 6 parallel Phase-2 agents (one per niche) — then rewrote in-place: `universal.md` (~6.5k words)
+ all 6 niche files (business-money, what-if, ai-tools, engineering-disasters, horror-internet-lore,
micro-health) + `idea-generator/SKILL.md` + `scriptwriter/SKILL.md` + `references/shorts-clipping.md`
+ `references/scoring.md` + `_TEMPLATE/idea-backlog.md`. Sources cited throughout. Load-bearing new
doctrine:
1. **Berger & Milkman 2012 anchor:** arousal, not valence, predicts virality. Awe/dread/outrage/
   amusement spread; low-arousal sadness doesn't. Every content decision downstream of this.
2. **The 10-lever emotional taxonomy** (curiosity gap, morbid curiosity per Scrivner's 4 dimensions,
   awe per Keltner-Haidt, morbid awe/dread, righteous anger, vindication/forbidden-knowledge,
   schadenfreude, hope-porn [face-required], tribal identity, wonder/puzzle). **One lever per
   channel, not per video** — the channels that survived July-2025 all lock one lever (Zack D. =
   dread, Bright Side = wonder, Coffeezilla = vindication). Cross-lever channels get flagged as slop.
3. **The 12 entertainment-not-education tactics** (withhold reveal via 5–7 STP cycles; personify
   institutions as characters; audience-as-detective; extended single analogy 90–120s; punchline-
   first; treat audience as smart; deadpan aside; named antagonist per video; etc.). Peer-reviewed
   Frontiers 2020 anchor: high-story-status videos 3.16× more likely to be popular; high-arousal
   videos ~3× more likely to hit high view counts.
4. **CCN rule** (Galloway): every video serves Core + Casual + New viewers.
5. **Expanded formula libraries with generative principles** (each pattern names its psychological
   lever so the writer can invent variants, not just clone examples): 20 long-form hook archetypes
   + 10 short-form; 10 opening structures for the 5–30s "second gate"; 15 title patterns; 15
   retention tactics; 6 payoff structures.
6. **Retention cadence updated for 2025-2026:** 55% first-minute cliff (Retention Rabbit 2025),
   value must land in 7s. Micro-interrupt every 30–45s (tightened from 60–90s). Macro re-hook every
   2–3 min. **Mandatory mid-video re-arm at 55–65% runtime** (the documented exodus zone the old
   playbook missed). **Withheld peak in final 20% is a hard rule.**
7. **Long ↔ Short algorithmically decoupled late-2025.** Shorts no longer passively lift long-form.
   Per-niche cadence bands replace the universal 2–3 cap: business 2–4 / what-if 3–6 / AI 2–3 /
   engineering 1–3 / horror-lore 4–8 / micro-health 3–5. Long-form ships first; shorts stagger
   every 2–3 days with pinned-comment link.
8. **Length bands are per-niche, not universal.** Killed the 8–15 min general rule. Horror/lore
   sweet spot is 22–35 min (short is bad here); engineering disasters 18–28 min; business collapses
   10–15 OR 25–45 min (the 16–24 min "death zone" is real); what-if 12–20 primary or 20–90
   blockbuster; AI tools 10–14 min; micro-health 8–12 min. Length band lives in the niche file,
   validated against 2025-2026 retention data.
9. **Faceless viability by niche (major finding):** AI tools + micro-health are *conditionally*
   faceless (9/15 top AI channels have a face; no credential-free live-footage faceless health
   channel exists at the top). Faceless AI successes (AI Explained, Two Minute Papers, Fireship)
   all have a structural moat (distinctive voice + investigative brand OR inimitable format).
   Faceless health survivors are all stylized-animation-first (Zack D., Nucleus, Kurzgesagt).
   Recommended for those niches: voice-forward faceless + hand cameos + screencap-first visuals +
   persona-anchored fictional narrator. Business-money niche needs human editorial direction even
   in AI-assisted pipelines (no purely-automated AI biz doc channel has broken 1M subs since July
   2025).
10. **AI-slop compliance verified:** July 15, 2025 "inauthentic content" policy — 16 major channels
    terminated by Jan 2026, ~35M subs and ~$9.8M/yr revenue wiped, Kapwing found ~21% of Shorts
    served to new users are AI slop. Compliant AI-gen playbook: original research + stated POV +
    proprietary signature format + consistent authored identity + premium TTS (ElevenLabs prosody
    tier minimum; stock TTS documented at 35% drop-off in 45s) + named creator identity behind the
    voice. Named refusals hold DNA legible.
11. **Score rubric reweighted:** Emotional lever bumped /10 → /20 (first-class); Hook trimmed
    /25 → /20 (mechanism is now doctrine-defined, less variance); Demand trimmed /20 → /15. Total
    still /100. **Cross-lever ideas score 0 on Emotional lever** (no partial credit — prevents
    slop). Tie-break chain now leads with Emotional lever, then Hook, then Monetization, then
    Differentiation, then ID.
12. **Shorts bench cap retired.** Old 10-archetype ceiling replaced with "as many as have integrity,
    sized to the niche cadence band." Idea-generator + scriptwriter + shorts-clipping.md +
    scoring.md + _TEMPLATE/idea-backlog.md all updated to match.
Sources: ~180+ cited across universal.md + 6 niche files. Full research pass = 10 subagent runs
(4 Phase 1 + 6 Phase 2), spanning peer-reviewed psychology (Berger-Milkman JMR 2012, Scrivner MCQ,
Keltner-Haidt awe), platform policy (YouTube July 2025), retention data (Retention Rabbit 2025,
AIR Media-Tech 18K channels, Paddy Galloway 3.3B-view Shorts study), and creator breakdowns across
~50 channels. **Skills are now production-ready with the new doctrine.** No niche committed yet;
still Stage 0 autonomy; open questions unchanged.

**2026-07-01 — Competitive stack scan + visual-pipeline wiring decision (Pattern A default).**
User asked (a) how our stack compares to real 2026 AI-gen faceless operators and (b) where visual
tools connect + which wiring is better. Ran a fresh web sweep. **Findings:** the median 2026 operator
runs LLM (GPT/Gemini/Claude) → ElevenLabs → image/motion gen → render (Shotstack/Creatomate/
JSON2Video) glued by **no-code n8n/Make/Zapier**, ~$25–70/mo. Two things put us *ahead* of the median:
(1) **orchestration** — Claude-Code/MCP direct tool control is the literal cutting edge the research
flags ("LLMs control tools like a human, no middleware"); we skip the n8n layer entirely, everything
version-controlled in files; (2) **script layer** — the #1 documented mistake is "commodity scripts,"
exactly what YouTube's 2026 algorithm demotes; our idea-generator + scriptwriter + humanizer + niche
playbooks + originality guardrail are built around that failure mode. Voice (ElevenLabs) and render
(JSON2Video) are industry-standard. **The one real gap = visuals:** the 2026 frontier moved to
**Kling 3.0 (motion) + Nano Banana 2 (stills)**, often blended with real stock (pure-AI B-roll "looks
uncanny"); **Sora was discontinued April 2026.** Our plan leans on JSON2Video's bundled Flux Schnell /
GPT, a tier below frontier — matters most for long-form documentary earners where B-roll quality
drives watch-time/RPM.
**Decision — visual generation wiring:** visuals connect at two points — prompt-writing
(`visual-prompt-writer`, step 5, pure Claude → `shots.md`) and pixel generation (step 7, external).
**Default = Pattern A** (JSON2Video generates inline + assembles; one API, one bill, fastest to a
working pipeline; right for validation). **Pattern B** (a `visual-generator` skill calling Kling 3.0 /
Nano Banana 2 + stock, JSON2Video downgraded to pure assembler) is the drop-in upgrade. **Hard
requirement:** `render-builder`'s contract is "assemble the clips/prompts referenced in `shots.md` +
the VO," so A→B is a **config flag, not a rewrite**. Which pattern wins is **niche-dependent**
(infographic/finance fine on A, maybe permanently; cinematic documentary → B); let the first real
video's quality bar decide. Don't pay for B's accounts/complexity before it's measured. Captured in
`research/tools.md` (visual rows + wiring section), `stack.md` (Image/animation row), skills README
(`render-builder` contract + optional `visual-generator` row). Recommend re-checking the exact
frontier visual models when `visual-prompt-writer`/`render-builder` are actually built — model
churn is fast (Sora died in ~2 months).

**2026-07-01 — Built `metadata-writer` (3rd pipeline skill, user request via skill-creator).**
Reads a scripted `videos/<slug>/` (`script.md` + `shorts/` + `brief.md` + `dna.md` + `universal.md §3/§8/§9`
+ the niche file) and writes one **`metadata.json`** (long-form + a block per short) that `publish-queue`
maps 1:1 onto the YouTube Data API v3. Design decisions from the interview:
- **Scope:** long-form **and every scripted short** get metadata (shorts are the funnel; publish-queue
  needs them). Carries each short's `publish`|`bench` status + archetype.
- **Titles = the A/B reality.** Verified via web search that YouTube's "Test & Compare" (up to 3
  titles + 3 thumbnails) is **YouTube Studio-only (desktop, long-form)** and **not exposed in Data API
  v3**; Shorts are **A/B-ineligible**. So the skill commits to **ONE primary title + ONE primary
  thumbnail** (the only thing the API can submit — pipeline connects perfectly, single unambiguous
  title) and parks **2 challenger titles + 2 challenger thumbnail concepts** in a Studio-only
  `ab_experiment` block for a human/future optimizer to set up by hand. The live A/B winner is not
  chosen here — it emerges from watch-time and returns via `analytics-reporter` → `performance.md`.
  Metadata-writer is now the **canonical home for final title/thumbnail packaging** (idea-generator
  only drafts raw title *options*; scriptwriter merely *selects* one for the slug — neither optimizes).
- **SEO research = hybrid** (knowledge/playbooks by default, live WebSearch on request/strategy),
  matching idea-generator.
- **Includes:** description (hook-first, chapters, links, hashtags, AI-disclosure line, Sources
  passthrough), tags, hashtags, **estimated chapters** (from script beats; flagged
  `re-time after render` since real durations exist only post-render), thumbnail concepts, and
  **pinned-comment** copy (long-form = engagement question; each short = soft `<long-form-url>` link
  back per `universal.md §9`).
- **Policy defaults (Stage 0):** `privacy_status: private` (audit gate), `contains_synthetic_media: true`
  (AI disclosure), `made_for_kids: false`; no misleading metadata (session-watch-time penalty + strike).
- **Doctrine-grounded:** titles per `universal.md §3` (anchor+lever, 40–55 chars, declarative,
  no numbered-list, no burned patterns); thumbnails per `§8` (proof-of-human, closed-mouth,
  neo-minimalism, ≤3–4 words). Full schema + field→API mapping + category-ID table + char limits in
  `metadata-writer/references/metadata-schema.md`.
- **Status flow:** leaves the idea-backlog lifecycle at `scripted` (the coarse
  `idea→picked→scripted→produced→published` has no per-sub-step rung; *files are the memory* — the
  step is done because `metadata.json` exists; flips to `produced` only when fully assembled).
- **Future skill noted (NOT built):** optional `packaging-optimizer` — an adversarial review panel
  (CTR / title↔retention-match / lever-fit / originality critics) that refines the same `metadata.json`
  in place (drop-in, no rewrite). Two insertion points: after metadata-writer, or a pre-publish
  "review everything" gate before `compliance-check`. Logged in the skills README build list.
Updated CLAUDE.md status, skills README (Built row + removed from to-build + added optional
packaging-optimizer). Skill still needs eval runs (skill-creator loop) before it's marked hardened.

---

**2026-07-02 — Sanity-ran `visual-prompt-writer` (4th pipeline skill) + fixed 5 spec gaps.**
- **What ran:** built a throwaway engineering-disasters fixture channel `channels/_test-eng/` (dna +
  a fully-scripted video `2026-07-02-the-connection-that-doubled/`: brief + script w/ `[B-ROLL]` cues +
  `metadata.json` + 3 shorts — Hyatt Regency walkway collapse, chosen because it forces the
  analysis-not-gore gate) and ran the skill end-to-end. Output: a valid `shots.json` (25 long-form
  shots = 15 cue-expansions + 10 densify inserts, 3 shorts w/ 10 shots, thumbnail primary + 2
  challengers). All schema mechanics passed (required fields, `stock_query` gating, `ken_burns` always
  present, exactly-2 challengers, ≤3-word overlays, 3–7-word short captions).
- **5 gaps found + fixed (SKILL + schema):**
  1. **Duration ↔ VO coverage (biggest).** SKILL densified to "cut every 3–8s" but never anchored
     `duration_s` sum to the VO runtime; the draft summed 143s vs a ~234s VO, so render-builder's
     re-time would *stretch* shots to ~9–10s/cut and silently break cadence. Added a coverage rule
     (Σ`duration_s` ≈ VO words ÷ ~155 wpm; min shots ≈ runtime÷8, hook zone ÷4) + a **diagram-first
     exception** (annotated schematics may hold 10–14s because in-shot annotation is the stimulus).
  2. **Added-fact leak.** A shot put a casualty count on screen the script deliberately withheld
     ("we are not going to dwell on the crowd"). Added SKILL rule: `on_screen_text`/prompts echo the
     VO, never introduce a count/date/name/stat the script omitted (load-bearing for analysis-not-gore).
  3. **`thumbnail_source` location ambiguous** — schema defined it only inside `thumbnail`, SKILL
     fallback-flag didn't say where, so it got written in both. Pinned to the `thumbnail` block only.
  4. **Cross-skill thumbnail-text cap.** metadata-writer's thumbnail `text` ran 4 words but §8 caps
     overlays at ≤3. Resolved ownership: **visual-prompt-writer owns the ≤3-word cap** — trims or
     zero-texts metadata's longer concept text and flags it in `composition` (metadata's `text` is a
     concept promise, not the literal overlay).
  5. **`beat` had no controlled vocab** (invented `thesis`/`aftermath`). Fixed enum in SKILL + schema:
     `hook · second-gate · premise · body · mid-arm · climax · withheld-peak · close`.
- **Kept:** Pattern-A default with both stills+motion specs always written (A→B stays a render flag);
  faceless→signature-artifact thumbnails (no face); every prompt inherits the `global_prompt_suffix`.
- Fixture retained as the skill's eval fixture (like `_test-metadata`). Skill still needs
  skill-creator eval runs before it's marked hardened. Updated CLAUDE.md status + skills README.

---

**2026-07-02 — End-to-end pipeline integration test (idea→script→metadata→shots) + fixed 2 findings.**
- **What ran:** built a fresh throwaway channel `channels/_test-pipeline/` (niche `what-if`,
  personal-scale dread — chosen to differ from the business/engineering fixtures and to exercise a
  *stylized-animation* visual path) with only the human setup artifacts (`dna.md` + empty
  `idea-backlog.md` + `performance.md`). A single subagent then ran all four skills in order by
  reading each SKILL.md and following it (skill-creator's fresh-eyes method; no Skill tool), producing
  real artifacts for slug `2026-07-02-car-sinks`. A contract grader (`grade_pipeline.py`) scored the
  handoffs.
- **Result: the pipeline chains cleanly.** 40/42 mechanical checks passed and **every structural
  handoff was clean** — slug / `source_idea_id` / channel / short-count all consistent across
  idea-backlog → script → metadata → shots; every referenced short file exists; field-passing works
  end-to-end. A fresh agent found every input where documented.
- **2 findings, both fixed:**
  1. **`ken_burns` dropped on 8/54 motion shots** (the 2 mechanical fails). Root cause: the
     "populate `ken_burns` even for `asset_type: motion`" rule (it's the Pattern-A fallback — Pattern A
     ignores `motion_prompt`, so a motion shot without `ken_burns` renders as a dead static frame) was
     scattered/soft. Made it loud in visual-prompt-writer Step 3 + `shots-schema.md` (notes + JSON
     comment + field line).
  2. **Runtime disagreement across three skills (the substantive defect).** Brief + script declared
     ~12 min and the script's beat headers carried timestamps to `12:00`, so metadata chapters ran to
     `11:30` — but the actual VO was ~977 words ≈ 6.3 min, and visual-prompt-writer (post the
     2026-07-02 coverage fix) correctly sized shots to 378s (6.3 min). Metadata said 12 min, shots said
     6 min: each internally consistent, mutually contradictory. **Fix (user chose source-of-truth +
     enforce length):** the project constant is **150 wpm**; scriptwriter now (a) writes enough words
     to actually hit the target band (a ~900-word script is a 6-min video, not 12), and (b) emits a
     machine-readable **`Estimated runtime: MM:SS`** in the script header derived from word count, with
     any beat timestamps computed from cumulative words. metadata-writer chapters and
     visual-prompt-writer shot-coverage both key off that one field instead of trusting beat labels /
     recomputing independently.
- **Not defects:** the humanizer pass was skipped (test-harness rule against invoking sub-skills), and
  the agent legitimately inferred a house-style block + `WHTY-` id prefix + niche category from dna +
  playbooks (documented, allowed).
- **Verified (iteration 2):** re-ran the three fixed skills on the same idea → all three now agree on
  runtime (script `Estimated runtime` **12:08** from 1,819 words ÷ 150; metadata last chapter **11:30**
  inside it; shots **Σ=720s**, ratio 0.989 to runtime; max cut 9s, cadence held) and `ken_burns` is
  **universal (113/113 long-form shots, motion 110/110)**. Contract grader: **42/42 PASS** (was 40/42).
  The committed `channels/_test-pipeline/` fixture is this clean iteration-2 output. Skills still need
  skill-creator eval hardening before marked hardened.

---

**2026-07-02 — Built `voiceover` (5th pipeline skill, via skill-creator) + quicktested live.**
The 5th skill and the first that drives an external API for real. Turns a scripted `videos/<slug>/`
into narration audio: strips `[B-ROLL]`/`[PAUSE]`/beat-headers/`> notes`/the Sources tail, reads the
channel's voice config from `dna.md`, calls ElevenLabs, and writes `assets/vo.mp3` + per-`publish`-short
mp3s + readable `*.txt` transcripts + `voiceover.manifest.json` (the contract render-builder syncs to).
Design decisions from the interview:
- **Client = raw HTTP over stdlib `urllib`** (not the ElevenLabs SDK, not `requests`). Chosen for
  long-term reliability: zero pip dependency means it can't break in a scheduled/subagent run where the
  env isn't provisioned, and the skill owns the exact wire contract (the "provider swappable behind the
  file boundary" rule). The deterministic engine is `scripts/voiceover.py`.
- **Voice config lives in `dna.md`, moderate block + project defaults.** Added a machine-read
  *Voiceover-config* fenced block (voice_id + model + stability/similarity/style/speaker_boost/speed/
  output_format) to `_TEMPLATE/dna.md` and the `_test-pipeline` fixture; only `voice_id` is required,
  every knob falls back to a project default, and there's a legacy-prose fallback so older channels
  still work. Per-lever starting points documented in `references/voiceover-contract.md`. Voice/character
  is deliberately a per-niche/per-channel decision made at channel setup, NOT hardcoded in the skill.
- **Publish gating:** long-form + only `**Status:** publish` shorts by default (bench shorts don't
  spend metered TTS chars until promoted); `--all-shorts` overrides.
- **Robustness:** long scripts chunked at paragraph boundaries under a safe per-request cap and stitched
  with `previous_text`/`next_text` for cross-seam prosody; retries w/ backoff on 429/5xx; clear errors
  on missing key / missing voice_id / 401. Manifest records real `est_duration_s` (CBR-mp3-size
  estimate) so render-builder replaces the earlier word-based runtime guess with ground truth.
- **`--dry-run` is SOP** (parse + transcripts + manifest, zero API quota) before any real synthesis —
  matters because free tier = 10k chars/mo, no commercial license.
- **Quicktest (skill-creator quicktest, real call chosen):** (1) full-fixture `--dry-run` → clean
  marker-strip verified (no `[B-ROLL]`/beat/`+ cues`/Sources leakage across long-form + 4 shorts;
  bench short-05 correctly skipped; `[PAUSE]`→break tags), and (2) a real ~300-char ElevenLabs call →
  **HTTP 200 + a genuine 274 KB ID3 mp3 + measured duration**; voice_settings correctly read from the
  dna block. Fixed 1 parse bug found (region slice started mid-heading → leaked "+ cues"; now starts at
  end-of-heading-line). Smoke-test mp3 artifacts cleaned (assets/ is gitignored + regenerable).
- **Environment gotcha logged:** on this Windows box the API call needs the native **`py -3`**
  interpreter (msys2 `python` ships no CA bundle → `CERTIFICATE_VERIFY_FAILED`). Script now prefers
  `certifi` if present, else system/Windows store, and turns the cryptic TLS failure into an actionable
  message; SKILL.md documents the `py -3` requirement. Not yet run through the full skill-creator eval
  loop (benchmark iterations) — quicktested only, like the others pre-hardening.

---

**2026-07-02 — Doctrine correction: payload-before-emotion + plain-concrete register + self-contained shorts (user feedback after listening to the first fixture).**
User listened to the `_test-pipeline` short-01 VO and read the script; verdict: the short delivers no
information/curiosity, gunning for an emotional reaction that doesn't land; the script reads like
cliché "bad movie-trailer" copy; and we hadn't actually studied what makes AI-gen shorts go viral. He
gave 5 exemplar channels (HeyHistorically, VisualVenture, CasuallyExplained, Explains101,
Crayon_Capital) and asked for research + consensus before editing. Ran **4 parallel research agents**
(the two explainer channels, the two AI history/visual channels, Crayon Capital, and a dedicated
AI-shorts-virality dig). Key findings:
- **Root cause:** our doctrine over-indexed on Berger-Milkman *arousal* as the PRIMARY axis and treated
  information/curiosity as secondary → produced portent with no payload ("it feels like safety but it
  isn't"). Every admired channel wins on the opposite: concrete specificity + genuine information +
  a simple distinctive identity; emotion rides on substance.
- **Shorts:** every credible 2025-2026 source treats a short as a **closed loop, not a trailer** — the
  algorithm optimizes satisfaction (viewed-vs-swiped, completion, replays; loops = views since Mar 31
  2025), so pointing off-video for the answer spikes drop-off and gets throttled. We had wrongly
  inherited long-form "withhold the reveal" into shorts. "If it needs more time to pay off, it's a
  long-form idea in disguise."
- **Register:** shift the DEFAULT to plain-concrete-specific (Explains101/Crayon), high-arousal dread
  kept as an *opt-in* register for horror-lore only.
- **Visuals:** a cheap **locked distinctive illustrated style beats photoreal AI B-roll** for abstract
  niches (Crayon); the failure quadrant is the generic semi-photoreal "uncanny middle." Visual register
  = a per-niche `dna.md` decision.
- **Honesty flags surfaced to user:** 2 of the 5 exemplars (HeyHistorically, VisualVenture) are NOT
  AI-automatable (human narrators + bespoke art) — use as quality/packaging targets, not clone
  templates; CasuallyExplained's edge is a human comedy writer (commodity-script trap) — borrow its
  *specificity*, not its jokes; Crayon launched in 2025 with no verified 1M, so "business needs
  editorial direction" stands, refined to "documentary-story (villain+number+in X min), not advice."
- **User mid-flight clarification (load-bearing):** *not* anti-emotion — anti-**cliché** and
  anti-forced-**WOW**. The emotional palette is the full human range (curiosity, sympathy, recognition,
  amusement, mild unease), not just high-arousal dread/awe which is hard to earn. Baked into §1-P +
  §1d-R: emotion is essential but rides on the payload and uses the quiet colors.

**Edits made (consensus list, all approved):**
- `universal.md`: new **§1-P (the payload rule — primary axis)**; **§1a** demoted to "register, not
  content"; **§1b** tactic 1 (withhold) marked long-form-only; new **§1d-R** (default plain-concrete
  register + banned trailer-voice/empty-portent list); new **§11-0** (shorts are self-contained closed
  loops: hook→context→payoff→loop, front-load, close, loop-seam); **§13** expanded (stylized-vs-real
  visual register by niche; ban the uncanny middle; cheap locked style > photoreal for abstract niches).
- `idea-generator`: added a **payload pass/fail gate** (Step 4); **rubric reweighted** — new *Payload/
  information value* **/20 (top weight)**, Emotional lever **/20→/10**, Hook /20→/15, Fit /10→/5;
  tie-break now leads with Payload; brief template gained a **Payload** field; shorts framing changed
  from "tease→CTA" to self-contained. `references/scoring.md` mirrors all of it.
- `scriptwriter`: payload-first + register rule at the top of Step 3; **shorts rewritten** to
  self-contained closed-loop; new **anti-cliché/anti-trailer-voice pass** in Step 5 (delete-the-line
  test); reads the locked register from `dna.md`.
- `visual-prompt-writer`: Step 2 now commits to a locked visual register (stylized-signature OR real
  footage) and bans the uncanny middle.
- `shorts-clipping.md`: rewritten from funnel/tease to self-contained; archetype library de-teased.
- `metadata-writer`: title must promise the payload the video keeps (no unclosed clickbait gap).
- `dna.md` template + `_test-pipeline` fixture: added **locked Script/voice register** + **Visual
  register** fields (fixture set to dread-but-plain-concrete + stylized-signature).
- **Proof run in progress:** a fresh-eyes agent re-scripting car-sinks short-01/02 under the new rules
  (before/after) to confirm the register+payload fix lands. Old vaporous shorts kept as the failure
  reference. Niches unchanged (history parked; no new niches added).

---

**2026-07-02 — Built `render-builder` (6th pipeline skill) + upgraded `voiceover` for true sync.**
The first skill that assembles a finished video. Turns `shots.json` + the voiceover into an MP4 via
**JSON2Video v2**. Engine = `scripts/render.py` (stdlib `urllib`, no pip dep, same pattern as
`voiceover.py`). Decisions from the interview:
- **Audio hosting = JSON2Video's own Media API**, not a third-party bucket. Verified live it's a
  **two-step presigned-S3 flow** (`POST /v2/media/file` JSON `{name,contentType,size,folder}` →
  `{uploadUrl, fileUrl}`, then `PUT` bytes to the presigned URL). Kept behind a swappable
  `upload_asset()` seam so R2/S3 is a one-function change later. Our **Render**-scoped key sufficed
  (no Editor role needed). Names are `time_ns()`-unique (a duplicate name 400s) and go to
  `folder:"temp"` (auto-deleted, stays under the free ~50 MB allowance).
- **VO sync = true per-line.** Upgraded `voiceover` to call ElevenLabs **`/with-timestamps`** and write
  `word_timings [[word,start_s],…]` + an exact (alignment-derived) duration into its manifest.
  render-builder's `retime_by_timings()` places each shot at its `vo_ref`'s real timestamp (sequential
  match, interpolate misses, **fall back to proportional** if <50% match or non-monotonic). **Contract:
  a shot's `vo_ref` must be a verbatim prefix of the spoken line** or sync degrades silently.
- **Captions** = one movie-level auto-subtitles track (whisper), big/tight on shorts, restrained on
  long-form (per user: both). **on_screen_text** overlays are separate (top on shorts to clear the
  caption band). **Ken-Burns** maps the shot's camera move to `zoom`/`pan` (every shot moves — Pattern A
  ignores `motion_prompt`). **Run scope**: default = long-form + all `publish` shorts; `--only`/
  `--all-shorts` target re-renders. **Pattern A default; B (`assets/clips/`) is a flag, not a rewrite.**
- **Free-tier reality:** 1 min/movie, 1080p, watermarked, ~600 lifetime credits — the full long-form
  can't render on free; full render gated on the Pro upgrade (first real video). `render.manifest.json`
  records `watermark:true` so `publish-queue` refuses free-tier renders. `--dry-run` builds the full
  payload for zero credits (SOP).
- **Quicktested LIVE end-to-end** against `_test-pipeline` short-01: presigned upload → submit → poll →
  download a real **1080×1920 21.4s MP4**, twice (proportional, then per-line-synced: basis
  `per-line-timings(20.57s, 57 words)`). Fixed 4 bugs found in the process: ken_burns subject-word leak
  ("tilt **down** to the **rising** water"), duplicate-upload-name 400, bare `TimeoutError` crashing the
  retry loop, and shorts overlay/caption overlap. Not yet run through the skill-creator eval loop —
  quicktested only, like the others pre-hardening. **Next:** `compliance-check`, then `publish-queue`.

**2026-07-02 — Voice-craft iteration: cadence, anti-cliché v2, humor/cultural texture, narrator persona (user feedback on the revised shorts' audio + script).**
User listened to the payload-first shorts and pushed further: (1) the VO cadence is metronomic ("hits
every beat like a metronome"); (2) the script still reads cliché/non-human ("Hit the window. Hit the
window!"); (3) wants **humor capability** — dry drops + cultural references like the reference channels,
not blatant bad jokes; (4) asked what else to add. Ran **4 parallel research/scrape agents** (humor
mechanics in Casually Explained / Half as Interesting / Sam O'Nella / Internet Historian; human
narration cadence; ElevenLabs prosody; anti-cliché v2). Findings + full plan approved by user.
**Q&A resolved:** `humanizer` is **text-only** (prose tells) — no "speaking humanizer" skill needed;
speech-humanness comes from ElevenLabs' own capabilities (punctuation-driven pacing, settings, v3 audio
tags) + the script's punctuation. Cultural references = **yes, evergreen texture only** (history/common
experience/legible deep-cuts, never memes). Humor level = **per-niche dna dial**. Added **narrator
persona** as the unifying upgrade (the channel is a recognizable person; the narrator is the moat, §13).

**Edits made (script-side; the other terminal owned the voiceover files, so those were left untouched):**
- `universal.md`: new **§1d-V (Voice craft)** — (A) narrator persona; (B) the anti-metronome **cadence
  self-check** (Gary Provost variance: no 3 same-length sentences in a row; every paragraph a short AND
  a long; no template 3× running; emphasis by escalation/specificity not repetition or "!"; punctuation
  as the breath score); (C) humor & cultural texture (drops not a set, **every joke carries a fact**,
  evergreen references, niche-tuned dial, dark-context rule).
- `scriptwriter`: reads narrator persona + humor dial from dna; Step-3 cadence + humor/cultural-ref
  rules + **write-for-the-ear/TTS-safe** (spell numbers/symbols/units); shorts carry the same craft
  (humor even sparser); Step-5 anti-cliché pass expanded to the **subtle tells v2** (repetition-for-
  drama, imperative-shouting, empty intensifiers, over-signposting, rhetorical-question tic, rule-of-
  three, "not X but Y", SVO monotony) + a **10-item pre-ship checklist**; chains the existing
  `humanizer` rather than reimplementing.
- `dna.md` template + `_test-pipeline` fixture: new **Narrator persona** + **Humor dial** fields (niche
  defaults: dry-sprinkle general / earnest finance-YMYL / dark-dry dread). Fixture set to a "calm
  field-guide" persona + dark-dry humor.

**HELD for coordination — voiceover engine upgrade (hand to whoever owns `voiceover.py`):** the uniform
`[PAUSE]→<break 0.6s>` is itself the metronome (and dense identical breaks cause ElevenLabs instability).
Planned: a **tiered pause map** (`[BEAT]`→0.3s / `[PAUSE]`→0.6s / `[PAUSE:LONG]`→1.2s), cap break
density per chunk, let **punctuation carry most cadence**, and an **opt-in `engine: v3`** per channel
(expressive audio tags `[deadpan]`/`[sighs]` for comedic niches, human-reviewed — v3 drops `<break>` and
is non-deterministic, so not the autonomous default). Register-tuned settings presets (dread = higher
stability/low style/0.95 speed; dry-witty = lower stability/higher style). **Interim (no engine change
needed):** scriptwriter now paces via punctuation (…, —, commas — already passed through untouched) and
uses `[PAUSE]` sparingly, which breaks the metronome without touching the engine. Not yet re-proofed
with a render (pending the engine coordination + a re-script of the fixture short).

**2026-07-02 — FIRST NICHE + CHANNEL COMMITTED: "What Happens To Your Money" (the cheat-code hybrid).**
After analyzing a real AI-video tutorial (Higgsfield MCP workflow) and a research pass on video-gen
controllability, the user committed the first real channel. Chosen = the **cheat-code hybrid** from
`niches.md`: the viral second-person **what-if FORMAT** run on **HIGH-CPM money topics** — maximizes
BOTH axes (Shorts virality + finance RPM), the project's stated goal. This session's factors decided it
over the paper #1 (business docs) and #2 (what-if): (a) it's **diagram-native → ideal for our
stylized-2.5D DIY render direction** (best continuity + control + $0-marginal), and (b) it reuses the
proven what-if pipeline we've already built + hardened this session.
- **Channel:** `channels/what-happens-money/` (display "What Happens To Your Money"; brandier alt "The
  Fine Print"; ID prefix `WHTM-`). Niche field = `business-money` so skills load the money craft + YMYL
  gate; the **what-if second-person is the signature FORMAT** (a dna choice, not the niche file).
- **Locked lever:** vindication / forbidden-knowledge ("you were lied to — here's the mechanism"),
  dread only as flavor. **Register:** plain-concrete calm-authority + light dry wit (humor dial
  dry-sprinkle). **Persona:** the level-headed insider (ex-bank, unimpressed). **Visual register:**
  stylized 2.5D flat-vector money diagrams (locked style-token; never photoreal).
- **Format:** 10–15 min long-form + 3–5 self-contained money-consequence Shorts each; YMYL accuracy
  gate (education-not-advice, 2 sources, dated mechanics).
- **Slop-risk guard (per doctrine):** the hybrid stays lever-pure by locking ONE format + ONE lever +
  ONE persona + ONE visual register — not "random high-CPM what-ifs."
- **Render direction implied:** user leaning to **build our own** (Remotion + 2.5D + frontier stills)
  over JSON2Video's weak inline images; Higgsfield MCP is the validation shortcut, DIY-stylized is the
  endgame (see the video-gen-controllability analysis this session). Decision to fully commit the render
  rebuild deferred until first video proves the register.
- **Open follow-ups:** pick the channel's real voice ID before video 1; finalize the name; generate the
  first idea slate (idea-generator) → script → produce video 1.

**2026-07-02 — REFINED same day: channel = finance/economics EXPLAINER (Crayon Capital model), not the
second-person survival what-if.** User pulled back from money-what-if (too format-specific) then toward
"broad curiosity" (flagged as slop/low-CPM risk), and landed on the three model channels: **Crayon
Capital** (faceless finance explainer + distinctive illustrated look + documentary-story framing) +
**Explains101** (curiosity-gap titles that pay off with the real mechanism) + **Casually Explained**
(dry-smart persona). Resolution: **topic-broad WITHIN finance, lane-locked** — this gives the ideas
breadth the user wanted *without* the CPM hit (it's all high-CPM finance), and stays slop-safe by
locking format + persona + visual + lever (not a narrow topic). Revised `channels/what-happens-money/
dna.md`: working name **"Rough Numbers"** (alts "The Fine Print"/"The Napkin"; ID prefix `RN-`); niche
stays `business-money`; **format = documentary/curiosity-gap explainer** (NOT survival-countdown); lever
= vindication/forbidden-knowledge; persona = dry-smart explainer; register plain-concrete + **dry-sprinkle
humor** (lean in more than straight-finance, the model channels' defining trait); visual = **our own
hand-illustrated 2.5D** (crayon/marker/sketch family — explicitly NOT a literal crayon clone, since that
look is already mass-cloned; moat = editorial voice + our shorts engine). **Our edges over the models:** a
real self-contained Shorts engine (Crayon under-invests) + payload/cadence/anti-cliché doctrine + own
2.5D render (which the illustrated look is perfect for → validates the DIY-2.5D direction). Still to
confirm: final name + our specific illustration variant + the voice ID.

**2026-07-02 — Working channel name set: "The Second Take" (provisional).** Folder renamed
`channels/what-happens-money/` → `channels/the-second-take/`; dna name + ID prefix (`ST-`) updated;
`business-money.references.md` re-pointed. **Provisional and swappable before publish** (Stage 0,
nothing live) — "second take" is a common phrase so verify @handle availability before the real YouTube
channel is created (fallbacks: "Second Take"/"On Second Take"/"Take Two"). Name is *not* money-specific
by design (content is money-tilted-broad). Earlier working names in history ("What Happens To Your
Money", "Rough Numbers") are superseded.

**2026-07-02 — Reference board reclassified as CHANNEL-specific (Tier 3), not niche.** Per user: they may
run **multiple channels under one niche that differ in content/style**, so the reference-channel board +
its learnings are **channel-specific**, not niche-wide. Moved
`knowledge/research/niche-playbooks/business-money.references.md` →
`channels/the-second-take/reference-channels.md` and re-scoped its header. **Corrected knowledge tiers:**
Tier 1 `universal.md` = craft for any channel; Tier 2 `business-money.md` = finance-*general* facts only
(CPM, YMYL gate, money-topic patterns); **Tier 3 = the channel folder** (dna + its own reference board +
style learnings). Supersedes the earlier "business-money.references.md (Tier-2 niche)" filing. Deep-
research learnings route: universal-craft → `universal.md`; finance-general → `business-money.md`;
this-channel-style → the channel board.

---

**2026-07-02 — Deep-research + video-analysis pass on the reference-channel board → tiered learnings.**
Ran a **16-agent research fleet** on The Second Take's reference channels — 5 core (Crayon Capital, How
Money Works, Wendover, PolyMatter, Casually Explained), 9 supporting (Half as Interesting, Sam O'Nella,
Internet Historian, Magnates Media, ColdFusion, Coffeezilla, Johnny Harris, RealLifeLore, Patrick Boyle),
and 2 cross-cutting dimensions (opening-15s, analogy craft). Each agent analyzed ≥3 top videos
(auto-caption transcripts) + scanned 10+ for titles/thumbnails/metadata, **tier-tagged every insight**,
and cited sources (video URLs + views/dates).
- **Environment reality (logged for future passes):** the `claude-video-vision` MCP pulled YouTube
  **metadata + auto-caption transcripts** fine, but could NOT download full video bytes — the
  `googlevideo` CDN is blocked in the subagent sandbox (HTTP 403 / DNS refused) *and* from the main
  session. So exact **wording, titles, view counts, chapter markers, thumbnails-via-web** are solid;
  **measured cut-cadence, loudness/music dynamics, frame-level thumbnail pixels are inferred/directional**
  and flagged as such everywhere. Some agents adapted well (archive.org mirrors + local whisper/ffmpeg
  for real silence/scene data — Internet Historian; opening-segment LUFS — ColdFusion). Verbatim quotes
  are ~98% (ASR); re-verify before production.
- **Routed strictly by tier (no cross-filing):**
  - **`universal.md` (craft):** §3d new title patterns (mocking-strawman, definitive-version,
    decline-verb, colon-escalation, definite-article outcome-noun); §5a new opening structures
    (protagonist-walkthrough, dream-then-turn, name-withholding, dated-artifact, testimonial-montage,
    mock-sincere) + the tangible-yardstick rule; **new §5b "Explanation & analogy craft"** (weighable
    prop, prediction-then-violation, exhaustive cast-list mapping, reader-as-counterparty, recursive
    concrete number, one-sentence recompression, change-one-variable, dialogue-reenactment,
    analogy-as-indictment) + steelman-then-kill; §8d thumbnail executions (text-as-reframe, corner
    wordmark, chart-as-image, open-mouth caveat); **§1d-V D/E** (finance-humor correction + cadence
    mechanics); §10 measured-cadence data.
  - **`business-money.md` (finance-general):** new "Reference-channel findings" section (high-RPM topic
    cluster + newsy-spike lever + legal-target CPM caution; making-numbers-watchable; finance analogy
    library; YMYL-fit credibility signals) + a **defamation counter-lesson** (Coffeezilla's opinion
    disclaimer FAILED in court — Logan Paul suit to trial 2026; trace hard claims to filings, phrase the
    conclusion as the viewer's inference).
  - **`channels/the-second-take/reference-channels.md` (this channel):** all 9 Learnings cells filled +
    a per-dimension synthesis of what The Second Take adopts, + honesty flags; status → filled.
- **Two doctrine corrections (load-bearing):**
  1. **"Finance = earnest" is retired.** Patrick Boyle (+ Casually Explained, How Money Works) shows dry
     humor is *credibility-positive* in YMYL finance under **four locks** (fact-rider · target = the-fool-
     never-the-viewer · deadpan + citation-first · ~1/min & OFF while teaching mechanics). Our
     dry-sprinkle dial is validated; `universal.md` §1d-V D added + the inline §1d-V line amended (not
     clobbered).
  2. **Two visual-reference corrections.** **Crayon Capital = clean digital vector cartoon, NOT literal
     crayon** (the hand-feel lives in marker title-cards + hand-drawn charts) → resolves our open
     "specific illustration variant" question: **clean 2.5D vector characters + marker-style charts/
     title-cards + one red accent** (also de-risks clone-bait, since the literal crayon look is
     mass-cloned). **PolyMatter = real footage + green/white annotation, NOT flat vector** → an
     annotation/typography reference, not an illustrated-look one.
- **Best single mechanic for this channel = "analogy-as-indictment"** (Crayon): an explainer analogy that
  teaches the mechanism AND exposes its flaw in one sentence — fuses our payload rule + vindication lever
  ("naked CDS = life insurance on your neighbor's grandma, and rooting for her to slip").
- **Follow-ups:** fold the visual corrections + humor validation into `dna.md` at illustration-lock;
  re-verify verbatim quotes before scripting; optional frame-level + Shorts-mechanics passes when the CDN
  isn't blocked. Sources: 16 agent reports, cited inline across the three files.

---

**2026-07-03 — Pipeline redesign: research-driven front+middle (user request; brainstormed + spec'd).**
The one-shot idea→script flow can't carry a deeply-informative YMYL channel (The Second Take). Reshaped
the front+middle into a funnel with an early human gate + a real research stage. Design spec:
`docs/superpowers/specs/2026-07-03-research-driven-pipeline-design.md` (brainstormed to approval, then
built — user opted to skip a separate writing-plans round). New shape:
`idea-generator → [HUMAN GATE: pick+edit idea] → researcher → long-form-writer → shorts-writer → …`.
- **Split by FORMAT, not niche.** Niche stays data; the scriptwriter splits into a long-form writer +
  a shorts writer because a 2,500-word researched arc and a 130-word self-contained loop are different
  crafts. One human gate only, at the idea pick (user: doesn't want to police the research — accuracy is
  the researcher's job, enforced by the native `deep-research` skill's adversarial verification + the
  scriptwriter's **leash to the fact-ledger**).
- **Per-niche wiring via a `dna.md` `Pipeline` block:** `research: deep|none` · `topic_scouting:
  live|stored` · `long_form: staged|single`. The Second Take = `deep/live/staged`. Both flows must work:
  `research: none` niches skip the researcher (idea→scriptwriter direct); the long-form writer works with
  or without a `research.md`. Added the block to `_TEMPLATE/dna.md` (lightweight defaults) + the channel.
- **Built this session (Phase 1, tasks 1–3 of 5):** (1) dna Pipeline block; (2) repositioned
  `idea-generator` — reads the flags, live topic-scouting when flagged, emits provisional angle + payload
  promise + **key questions the video must answer** (the research seed) instead of a speculative
  pre-research beat outline, routes picked ideas to `researcher`; (3) built the **`researcher`** skill
  (SKILL.md + `references/research-contract.md`) — research-director that *directs* + *shapes* the native
  `deep-research` skill into a fixed-shape sourced fact-ledger dossier. Leaves status `picked` (file =
  done). Source-quality bar + two-source/date rules + **defamation discipline** (the Coffeezilla
  counter-lesson) baked into the contract.
- **Still to build (Phase 1, tasks 4–5):** split `scriptwriter` → `long-form-writer` (outline →
  section-by-section drafts → one accuracy/quality editor pass → humanize, leashed to the ledger) +
  `shorts-writer` (self-contained shorts derived from the finished long-form + research); then wire
  routing + verify both flows. **Phase 2 (later):** expand the single editor into the full adversarial
  critic panel; skill-creator eval hardening. Per project precedent, skills are quicktested end-to-end,
  not run through the full eval loop pre-hardening.
- **Scriptwriter split — RESOLVED (tasks 4–5 built).** Split `scriptwriter` **by format** into
  **`long-form-writer`** (outline → section-by-section drafts → accuracy/quality **editor pass** →
  humanize on `long_form: staged`; single strong pass on `single`; **leashed to `research.md`'s fact
  ledger** on research channels — states only sourced facts, editor flags any claim without an `[F-NN]`)
  and **`shorts-writer`** (self-contained closed-loop shorts derived from the *finished* long-form +
  ledger). Both carry the full hardened craft (payload-first, §1d-R register, §1d-V cadence/persona/
  humor, anti-cliché pass, pre-ship checklist, `humanizer` chain). The user was away at the fork; chose
  the **de-risked "rename+extend"**: built the two new skills (single mode preserves the old long-form
  behavior → zero plain-path regression), first deprecated `scriptwriter` in place, then — **user
  confirmed the migration was faithful → `scriptwriter/` DELETED 2026-07-03** (recoverable from git
  history; faithfulness verified by diffing craft tokens: cadence tiers/pause map, v3 tags, 90s wall,
  withheld-peak rule, 150-wpm runtime contract, anti-cliché tells, humanizer chain, niche gates all
  carried over). Rewired: idea-generator handoff, skills README, CLAUDE
  routing + pipeline summary, and the downstream skills' "AFTER scriptwriter" mentions → the new pair.
  **Plain path is now** idea → `long-form-writer` (single) → `shorts-writer`; **deep path** idea →
  researcher → `long-form-writer` (staged) → `shorts-writer`.
- **Phase-1 status:** all 5 build tasks done (dna flags · idea-generator · researcher · the two writers ·
  wiring). **Not yet run end-to-end** — no picked idea exists for The Second Take yet, and deep-research
  costs real web-search budget, so a live full-pipeline quicktest is the natural next validation (the
  project norm; see the 2026-07-02 end-to-end integration test). **Phase 2 (later):** expand the single
  editor pass into the full parallel adversarial critic panel; skill-creator eval hardening.
- **Open for the user:** whether to run a live deep-path quicktest now (generate a first The Second Take
  idea → research → script) to prove the chain before hardening. *(Scriptwriter deletion — done.)*

**2026-07-03 — Visual-gen tooling: connected Recraft + Nano Banana after a 4-agent depth-search (user request).**
Hand-authored SVG (my attempts in the Style Lab) capped art quality — the honest fix was connecting a real
illustration engine. Ran a 4-way parallel research sweep (image-gen MCP/providers · character/style
consistency · vector/SVG + animation · Claude-ecosystem skills/plugins/repos); all four converged:
- **Recraft** = the pick for THIS channel — the only mainstream tool that emits **true editable SVG** AND
  has a **custom style-lock** (`style_id` from ~5 ref frames → every image on-brand), purpose-built for
  flat-vector cartoon. Official MCP + REST API, ~$0.04 raster / $0.08 vector.
- **Nano Banana (Gemini image)** = cheap zero-training scene + character consistency + legible on-screen text.
- Recurring-character lock (only if we commit a mascot): one-time **Flux LoRA** or Ideogram/Leonardo char-ref,
  or the reusable-vector-kit route. **Ruled out:** Midjourney/Playground (no API).
- **Render/animation:** Remotion confirmed (first-party `@remotion/rive`/`@remotion/lottie`; a "Remotion
  Superpowers" Claude plugin could accelerate the build). Full survey recorded in `research/tools.md` (TODO
  fold in) + `stack.md`.
**Connected + validated same day:** both keys wired to `.env`. **Recraft works and the quality is there** —
4 test images (character/scene/banker/piggy) came out genuinely on-vibe (OverSimplified/Crayon casual look)
from one prompt each, a night-and-day jump over hand-SVG; gallery in the channel Style Lab. Nano Banana
authenticates but image gen needs **billing enabled** on the Google project (free-tier limit 0) — deferred,
not blocking. **Recraft Cloudflare gotcha logged** (needs a browser User-Agent header). **Open:** lock a
custom `style_id` once the user picks favourites; the recurring-mascot-vs-no-cast fork; enable Nano Banana
billing. This **supersedes the 2026-07-01 Pattern-A-default** decision for The Second Take (JSON2Video's
inline gen produced the banned uncanny-middle look; Recraft/Nano Banana → optional vectorize → Remotion is
the new visual path).

**2026-07-03/04 — Visual identity iteration (Recraft/Nano) + handoff parked.**
Hand-authored SVG was abandoned (bad art). Connected **Recraft** + **Nano Banana** (both working), chose
the **thick-outline cartoon look**, and anchored on a **"chart-guy" house person** the user loves. Ran a
long iteration (derpy → too-stock → back to the chart-guy family) and generated **7 design variants**,
each with a cast of 5 + scenes (refs in `channels/the-second-take/visual-kit/refs/`). **User has not yet
locked a final design** — that's the next step. The Style Lab artifact was **reverted to the anchored
chart-guy state** per user request. **Full handoff written to
`channels/the-second-take/visual-kit/HANDOFF.md`** (the 6 open visual-pipeline tasks, current status,
Recraft Cloudflare-UA gotcha, Nano reference-image consistency trick, saved gen scripts in
`visual-kit/scripts/`, QC-via-ffmpeg-montage method). A fresh terminal resumes there. Also un-staled
CLAUDE.md (scriptwriter split is DONE, not in-progress; added the visual-work status line).

**2026-07-04 — Visual identity: staged character-first sweep (2 anchors + 5 new) on the pro model.**
User refined the approach: pick the CHARACTER design first, THEN generate the full matrix only for the
keeper(s) — cheaper + judges the design directly (prior terminal burned ~$25 on Nano pro testing). On the
model question, confirmed there's no true Gemini mid-tier (flash vs `gemini-3-pro-image`); since the goal
is a PERMANENT, exactly-recreatable channel aesthetic (the user's stated #1 requirement), chose the **pro
model** for its tighter prompt-adherence + style-hold across re-feeds. Built `scripts/gen_sweep.py`
(bases/full/probe modes; seeds each style off a `base.png`, re-feeds it for outfit-sheet + settings +
no-char scenes; `chartguy` reuses the approved `house-person.png`) and `scripts/build_lab.py`
(ffmpeg thumbs → lean 297KB Style Lab). Generated 7 bases → `visual-kit/sweep/<style>/base.png`:
anchors `chartguy`+`crayon`, new `inkwarm`/`chibiround`/`flatgeo`/`sketchy`/`sticker`. Style Lab
redeployed (same URL). My assessment: inkwarm ≈ chartguy > sketchy; crayon face good/body botched;
flatgeo too abstract; sticker drew a bear (off-brief); chibiround babyish. **Awaiting the user's pick;**
then `gen_sweep.py full` on the chosen style(s) only → matrix → lock (Task 3 in visual-kit/HANDOFF.md).

**2026-07-04 — Visual identity round 2: HeyHistorically over Crayon Capital → 4-character finalists.**
User rejected round 1's 7 style bases (`sweep/`): kept chart-guy but preferred **HeyHistorically**'s
character design to Crayon Capital, other 5 off-mark. Per user, analyzed HeyHistorically's real art:
`yt-dlp --flat-playlist --print id @HeyHistorically/videos` → downloaded 6 real maxres thumbnails from
`i.ytimg.com` (googlevideo CDN still blocked, but i.ytimg works) to `refs/historically/`. Their look =
**blank pale-white egg head + hyper-expressive minimal ink features + rough hand-inked line + painterly
halftone shading + dramatic lighting** — genuinely distinct from chart-guy's clean warm flat vector (the
shared DNA is only "simple blank-ish head + big expressive features"). Built `scripts/gen_four.py` (seeds
off house-person.png + the real soldier thumbnail) → 4 characters × (base + 3 outfit/expression variants)
= 16 imgs in `sweep2/<char>/`, forming a 2×2 of {clean-flat vs painterly}×{skin vs blank-white face}:
`chartguy` / `warmface` (clean+blank) / `roughwarm` (painterly+skin, the standout) / `historically`
(faithful match). Character identity held excellently across outfit+emotion changes (the recreatability
test). Style Lab redeployed (`build_lab2.py`, same URL). My read: roughwarm ≈ historically strongest;
flagged that the painterly-halftone look is the hardest to reproduce identically at lock time, so a
slightly cleaner bridge (roughwarm/warmface) may lock more reliably. **Awaiting the user's row pick;**
then Task 3 (full production matrix + cast for the chosen character → lock via Recraft style_id / locked
Nano ref set → `style.md` + fold into `dna.md`). Round-1 `sweep/` kept as reference.

**2026-07-04 — Visual identity: WARM-FACE chosen + full production matrix generated (awaiting sign-off → lock).**
User picked **warmface** (clean-flat render + blank pale-cream oval head) from the round-2 finalists. A prior
terminal had already corrected warmface's thinned outline back to a **thick bold warm outline** (`sweep2/
warmface_v2/`) — that line weight is locked. Built `scripts/gen_final.py` (canonical-base-then-fan-out: seeds
the style off `warmface_v2/a_teal_smug` + `house-person` for outline weight, generates one base, then seeds all
other frames off that base for identity consistency) and produced the **11-image matrix** in
`sweep2/warmface_final/`: `01_base` (recurring narrator) · `02-04` (3 outfits + expressions: suit/smug,
hoodie/worried, shirt/explaining) · `05-08` (scenes + a 2nd cast member + varied contexts: chart, street,
warzone-reporter, bank teller) · `09-11` (no-character B-roll plates: map-with-arrows, city park, money-props
flat-lay). Consistency held across all 11 (head shape/outline/palette; warzone stylised-not-gory). One drift
caught + fixed: `04_shirt_explain` first rendered bald → regenerated with an explicit hair-lock. **Style Lab
redeployed to the same URL** (`scripts/build_final.py`) with **bigger frames + a click-to-enlarge lightbox**
(user requested both; lightbox is now the default on these review artifacts). **Next (on sign-off):** lock via
Recraft `style_id` / fixed Nano reference set → write `visual-kit/style.md` + fold the Visual register into
`dna.md` (closes Tasks 3 + 6 in `visual-kit/HANDOFF.md`). Rejected explorations (`sweep/`, `sweep2/{chartguy,
historically,roughwarm}`, `refs/designs/`) kept as reference only.

**2026-07-04 — CORRECTION to the above: Warm-Face = BALD cream egg head; first matrix was wrong, regenerated.**
The first `warmface_final` batch (via `gen_final.py`) was WRONG and thrown away: it seeded off the prior
terminal's `sweep2/warmface_v2/` frames, which had themselves drifted — they gave the character HAIR and a
normal skin-tone face to force a thicker outline. That reproduced a generic hairy man and destroyed
Warm-Face's whole identity. **Warm-Face (the approved 2nd finalist) = a perfectly BALD, smooth EGG-shaped
head that is ONE uniform pale-cream colour (NO hair, NO skin tone), with large round expressive white eyes,
thin dark-brown brows, a small mobile mouth, a medium-thick warm dark-brown outline, and clean warm FLAT
colour.** True references: `sweep2/warmface/base.png` + `warmface/v1_suit_smug.png` (both bald). NOTE:
`warmface/v3_shirt_explain.png` and all of `warmface_v2/*` are DRIFTS (hair) — do not seed from them.
Rebuilt via **`scripts/gen_locked.py`**: seeds ONLY the approved bald frames, prepends ONE fixed exact
style descriptor (bald egg head / uniform #f3e3c8 cream face / large white eyes + thin brows /
medium-thick dark-brown outline / flat warm colour) VERBATIM to every prompt, and every one of the 11
outputs was visually verified bald + cream-faced before shipping (`01_base` regenerated-then-checked;
`02-08` characters+scenes incl. 2 two-character scenes with a 2nd bald cast member; `09-11` no-character
plates). Style Lab redeployed same URL (`build_final.py`). **Process directive [user-directed]:** when
generating for an EXACT approved style — (1) seed off the actual approved reference, not a downstream
derivative; (2) write exact/specific prompt language, never vague guesses; (3) analyse every output and
confirm it matches before using it. Also: image-review artifacts get big images + a click-to-enlarge
lightbox by default (saved to memory). **Still awaiting the user's sign-off → then lock (Task 3 tail).**

**2026-07-04 — CORRECTION: full-video watching now works (the 2026-07-02 "CDN blocked" limitation is retired).**
The 2026-07-02 16-agent reference pass logged that the `googlevideo` CDN was blocked from both subagents and
the main session, so that pass was **transcript + packaging-scan only** and its cut-cadence/loudness figures
were flagged *directional*. **That no longer holds.** The `claude-video-vision` MCP now downloads the full
video via `yt-dlp` (verified 2026-07-04: `video_info` on a HeyHistorically video pulled the real 882 MB
3840×1922 av1 file + the human-authored en-US subtitle track), so full frame-level + audio + measured
scene-cut/silence/loudness analysis is available. Corrected the stale "blocked/directional" caveats in
`channels/the-second-take/reference-channels.md`, `knowledge/research/niche-playbooks/universal.md` (§10
cadence note), and `business-money.md`. Process note for future passes: **confirm a capability with one
cheap probe, then fan out — don't serially re-test.** The current session is doing a fresh script/humor
deep-dive on the reference channels (esp. HeyHistorically, previously characterized only for its art) using
real video analysis, to build a Watchability Rubric + a blended narrator persona for The Second Take.

**2026-07-04 — Visual style-lock SYSTEM designed + built; The Second Take character LOCKED (Phase 1).**
Brainstormed + spec'd a reproducible visual-identity system
(`docs/superpowers/specs/2026-07-04-visual-style-lock-system-design.md`): a per-channel **style bible**
(data) + a small **canonical reference set** (ground truth) + a niche-agnostic **`asset-forge`** skill
(procedure) whose core move is generate → **verify against an objective checklist** → bounded retry /
escalate. Fixes drift both across AND within terminals (the load-bearing insight: mid-iteration re-rolls
lost the character because iteration wasn't *anchored* to the approved frame). Load-bearing decisions:
(1) accuracy comes from **seed-from-reference + change-ONE-variable + a mandatory VERIFY loop**, not from
prompt wording; (2) **invariants vs flex** — the checklist locks identity (bald egg head, head tone,
outline, eye/brow style, **NO nose**) but NOT pose/expression/**proportions**, so HeyHistorically-style
action exaggeration doesn't read as drift; (3) palette is **not** globally locked — only the character's
own colours (scene palettes move freely per video); (4) locked-file faults are **proposed, never
self-applied** (a silently-drifting lock is the exact failure we're killing), while other safe assets keep
generating. Character locked via staged exploration (every step an anchored iteration off the approved
frame, every output verified by *looking*): base tone **cream `#f5ead6`** (3-way compare vs warmer/whiter),
outline **dark brown-black `#241a12`** (vs brown/near-black), **calm no-nose face** (user rejected 8 face
variants + the nose; a 3-emotion + 2-exaggerated-action stress-test proved the base "comes alive" in
motion rather than needing a new face — the invariants held while proportions flexed). Built the narrator
**model sheet** (18 verified frames: base + 9 expressions + 8 actions incl. recoil/lean/slump) into
`refs/narrator/`, wrote `style-bible.md` + `registry/registry.json`, and **smoke-tested `asset-forge`
end-to-end** (reuse-lookup, gen-new, verify, single-variable iteration, register — all pass). Each step
shown as an image-review artifact (big images + lightbox). **Phase 2 (deferred):** a `style-lock`
establisher skill; the **Remotion motion layer** (actual animation of the stills); wiring `asset-forge`
into `visual-prompt-writer` → `render-builder`. HeyHistorically *motion* study still blocked by the
sandbox googlevideo CDN. Scratch exploration gitignored (`visual-kit/_*/`).

**2026-07-04 — Reference-channel measured deep-dive → Watchability Rubric + blended narrator persona (pipeline test, Step 0).**
Kicked off a live test+harden of the first-half pipeline (idea-generator → researcher → long-form-writer)
for The Second Take. Step 0 = characterize what makes the model channels *watchable* (colloquial, funny,
digestible — not monotone fact-dumps), because the goal is output that reads like them. Ran 5 parallel
analysis agents on full transcripts + **audio** loudness/silence (yt-dlp audio-only → ffmpeg ebur128/
silencedetect — avoids the brutal 4K-AV1 video decode that stalled one agent): Crayon Capital, Patrick
Boyle, Casually Explained, Half as Interesting, HeyHistorically.
- **Load-bearing finding: loudness is flat across ALL of them (1.8–3.7 LU).** Nobody manufactures energy
  with volume. So "not-monotone" is a **writing + pitch** property, never a loudness one — for our TTS,
  pick a voice with pitch life, don't fake volume swings, put the variance in sentence length + framing.
- **~145 wpm** is the explainer pace (Crayon 145, Boyle 145, HeyHistorically 144; the 200–233 wpm channels
  are pure-comedy stock-footage formats we aren't) — validates the project's 150-wpm constant.
- Near-zero silence; pauses are rare + structural. Every joke fact-rides (~60–100%). Density splits by
  register (dry-finance ~1/min; don't chase the comedy channels' 2.5–5/min — human-writer moat + TTS can't
  sell it).
- **HeyHistorically reframed:** its playfulness is NOT delivery (same flat loudness + 144 wpm as our dry
  channels) — it's **writing/framing**: in-media-res comedic sketches, a lightly-present self-aware
  narrator, anachronism/modern-slang reframes. So the user's "20–30% HeyHistorically" blend = **framing,
  not joke-frequency** (keep density at the finance ~1/min to protect the YMYL credibility gate).
- **Deliverables:** `channels/the-second-take/watchability-rubric.md` (12-dimension scored instrument /24
  + measured baseline table + covered-vs-gap map; the 4 gaps — colloquialism checklist, playful framing,
  dramatized reenactment, second-person relevance — are the skill-hardening targets, to be fixed
  *reactively* when a generated script misses them, not pre-emptively). Folded the approved **blended
  persona** ("the dry-smart insider who tells it like a story," 70–80/20–30) into `dna.md` Narrator-persona
  + Humor-dial. Updated `reference-channels.md` (measured data, previously flagged directional). Confirmed
  most watchability doctrine already exists in `universal.md §1d-V/§5` — this pass validated + measured it,
  didn't rewrite it.
- **Process:** corrected the stale "video download blocked" caveats (video-vision works now); allowlisted
  the video-vision MCP tools in `.claude/settings.json` so background agents don't stall on permission
  prompts. Next: Step 1 = run idea-generator on The Second Take → human idea gate.

**2026-07-04 — Packaging doctrine: the "familiarity anchor" cold-start rule (user catch during the first idea slate).**
Reviewing The Second Take's first slate (obscure money-story documentaries), the user flagged a real CTR
risk: HeyHistorically/OverSimplified/Crayon anchor even their obscure stories on *familiar* umbrellas
(Rome, WW2, *Wolf of Wall Street*, 2008), giving cold browse traffic a foothold. Our slate leaned on
obscure proper nouns (Comroad, Kreuger, Alves dos Reis). **Resolution:** the risk is obscure *anchors in
the packaging*, not obscure *stories* (obscurity is our differentiation moat). The fix is packaging, not
avoidance — **lead the title/thumbnail with the biggest familiar thing the story touches** (a famous
name/era/product/place or a universally graspable premise), obscure specifics as the payoff. Baked in:
`universal.md §3a` (new "Familiarity anchor" universal principle), `dna.md` title conventions (mandatory
+ dropped the "how X works" explainer title formula). **Scoring: NOT reweighted** — the existing
`Demand & virality /15` already penalizes low appetite and `Differentiation /15` rewards the moat, so
reweighting would double-count and undermine differentiation; instead the slate gained a **cold-start
Anchor tier (A/B/C)** as a *launch-sequencing* overlay (front-load Tier-A familiar-anchor picks while the
channel has no format trust; hold/repackage pure-obscure Tier-C gems like Comroad/Kreuger). Revised 4
titles on the slate to lead with the familiar anchor (Kreuger, Bre-X, Pearlman, Comroad). First-video
recommendation shifted from story-first-purity (Alves dos Reis/MiniScribe) to **familiar-anchor
discoverability (Pearlman / Buffett-salad-oil)** for the debut.

**2026-07-04 — Cost cap on the research stage (a Poyais deep-research run burned ~4M tokens; user flagged it as insane).**
Root cause: the native `deep-research` harness runs 5 search agents → ~15 fetches → a **3-vote adversarial
refutation of *every* extracted claim** → synthesis, and it was fed a fat 7-part prompt — so a stable,
well-documented 1820s history story got the full YMYL/legal-grade verification apparatus. Fix (in our
`researcher` skill, the lever we actually control — the bundled harness isn't durably editable): a new
**Step 2.5 research-intensity tier** — **LIGHT** (well-documented/historical/low-stakes = *do not invoke
the workflow*; 2–4 targeted WebSearch/WebFetch + a skeptic check on load-bearing claims only; the
default), **STANDARD** (one tight ≤3–4-sub-question deep-research call, verify only load-bearing claims,
~6–8 sources), **HEAVY** (full adversarial fan-out; only for live YMYL numbers a viewer would act on or
defamation-sensitive allegations about living people). `research-contract.md §2` updated to scale
adversarial verification to the tier. Poyais itself was redone as a LIGHT manual pass (`research.md`
written from the established record + scout sources, 3 contested figures flagged to spot-check at lock).
Principle: **match the machinery to the stakes; a text-research task should not cost millions of tokens.**

**2026-07-04 — Audio-delivery analysis folded into the voiceover skill (so the TTS isn't a flat AI read).**
The 2026-07-04 measured reference pass (loudness/silence/wpm on 5 channels) had shaped the *script* side
(universal.md §1d-V cadence + watchability-rubric), but its *delivery* implications weren't yet in the
`voiceover` skill. Added a **"Measured delivery targets"** section to `voiceover/references/voiceover-
contract.md`: liveliness = **pitch + sentence-variance, NOT volume** (all channels ran flat 1.8–3.7 LU),
so pick a voice with real **pitch life**, set **stability ~0.4–0.5 + style ~0.15–0.3** (pitch moves but
stays stable), **~145–150 wpm** (speed 1.0), **tiered pauses used sparingly** (`[BEAT]`/`[PAUSE]`/
`[PAUSE:LONG]`, punctuation carries the rest), and flat/compressed loudness is *correct*, not a defect.
Pointed the `dna.md` voice_id TODO at it. **Load-bearing caveat:** the biggest lever is the actual voice
pick (still the George placeholder) — settings can't make a flat voice lively; a pitch-alive voice must
be chosen before video 1. Script-side delivery craft was already implemented and is visible in the Poyais
`script.md` (short/long sentence collisions, punctuation-driven pacing, tiered pause cues, dry-conversational voice).

**2026-07-05 — Visual: style held to the locked original; MOTION MODEL decided (#1 hard-cut limited + #4 motion-graphics).**
Ran a style+movement iteration pass on the locked narrator (3 render directions × hold/snap, seeded off
`refs/narrator/base.png`+`action-recoil.png`, in gitignored `visual-kit/_style_iter/`; review artifact w/
lightbox). Identity held in all 6 (bald/cream/no-nose/no drift, incl. big off-balance snaps). **User chose to
keep the ORIGINAL locked look** (clean flat-cel; D2 hand-inked/halftone and D3 bold-graphic explored but not
adopted — D2 was the distinctive runner-up if we ever revisit).
- **Motion model LOCKED = #1 hard-cut "limited" animation (hold-then-snap + Ken Burns) + #4 motion-graphics
  for props/data.** Rationale: it's what our doctrine already prescribes, what our baked full-body stills
  already support, and what our two closest models (Crayon Capital, HeyHistorically) actually do.
- **Frame-by-frame ruled out** (TheOdd1sOut/Jaiden/Domics): not viable for an identity-locked, automated,
  low-cost AI pipeline — AI inbetweening/video models flicker + drift, defeating the lock. NOT "impossible,"
  just not viable under our constraints. **Key clarification:** HeyHistorically is NOT frame-by-frame — its
  appeal is writing/framing/cut-timing over mostly-still art, so that feel IS reachable via #1; we only give
  up Odd1sOut-style smoothness.
- **#2 rigged 2.5D puppet** (layered transparent parts + bone rig) kept as a *later, narrator-only* upgrade
  option if smoother acting is ever wanted — deliberately not now (different asset format, higher drift risk).
- **Asset-format implication:** baked full-body stills are the correct format (no layered-puppet parts needed).
  The quality levers for #1 are **expression/pose extremity in the stills + cut timing on the beat +
  motion-graphics props doing the "wow"** — NOT smoothness. Library = identity-ANCHOR reference set (seed
  frames), not the final shots; per-video shots are generated on demand at the needed angle/depth/action,
  seeded off the anchors. **Outstanding before mass-building the library:** an angle/depth/in-scene identity
  stress test (does the lock hold at 3/4 + profile, small-in-frame, inside a coloured environment?).

**2026-07-05 — Visual: reframed narrator → CAST (base template + shared locked rig); validated + codified.**
The channel is a cast-driven story world (OverSimplified/HeyHistorically model): a dry-insider VOICE narrates,
the SCREEN is many distinct characters acting the story — NOT a single on-screen host. Ran a cast test
(`visual-kit/_cast_test/`, `scripts/gen_cast_test.py`): 4 Poyais characters (con-man MacGregor, investor,
banker, emigrant woman) seeded off the narrator base for FORM only, + 2 MacGregor expressions + a group
lineup. **Result: works** — 4 instantly-distinct people, one cohesive family; reactions mapped onto a cast
member (MacGregor worried/delighted held identity); usable as real video-1 assets.
- **Rule locked (user-directed):** the **shared facial RIG is invariant on every character** — head shape
  (egg silhouette) + head-to-body proportions + facial layout (eye style/size/position, NO nose, brow
  position, mouth position). **Varies:** hair, facial hair, head tone, outfit, **body build** (stout/slight
  allowed — proportions stay, mass changes), age/reaction linework, and *slight* brow/mouth-size shifts.
  **Load-bearing payoff:** a fixed rig makes ONE reaction library map onto the whole cast (build once, apply
  to all) → cheap production. "Bald" demoted from universal invariant to the **narrator's trait**.
- **Codified:** `style-bible.md` reframed (new §1b rig rule; §1 cast framing; §2b new-character descriptor;
  §3 checklist restructured into family-invariants + narrator-only; §9 changelog). Registry NOT yet updated —
  cast bases stay in scratch until the real asset pass promotes chosen ones to `refs/` (MacGregor needs a
  re-roll to the locked head shape then — his head drifted tapered/handsome, the one flaw in the test).
- **Process:** each step reviewed via a lightbox artifact; findings logged in `_cast_test/notes.md`. Builds on
  the same-day motion-model decision (#1 hard-cut + #4 motion-graphics) and the angle/depth robustness test.

**2026-07-05 — Visual: reaction library filled + no-nose QC bug caught & fixed + base-is-a-template correction.**
Built the base-template reaction library out to **26 frames** (15 expressions + 11 poses) so the cast can act
stories; because the facial rig is shared, these map onto every character.
- **QC finding (user caught one; full sweep found 3):** `action-present`, `action-shrug`, `expr-thinking` had
  NOSES — the no-nose invariant slipped because the verify loop wasn't actually run on those (made by a prior
  terminal). Root lesson (user-directed): *generation and the vision-check must be coupled — every frame,
  no exceptions.* Regenerated all 3 with explicit no-nose enforcement; verified. Also generated a 9-frame
  delta (shock, despair, fear, greedy, pleading + accuse, head-in-hands, offering, celebrate) — the
  story-acting emotions the narrator-commentary set lacked. **All 12 new frames verified no-nose (0/12
  violations vs the prior 3/18)** — the explicit "*** NO NOSE ***" clause in the prompt is the fix; folded
  into the gen pattern. Promoted to `refs/narrator/` + registered in `registry/registry.json`.
- **Concept correction (user, emphatic × twice):** THERE IS NO NARRATOR. The base character is a **design
  TEMPLATE / rig anchor** — it does NOT appear in videos; narration is a VOICE only; on screen is the cast.
  Corrected `style-bible.md` §1 (base = template, not a host) + §3 (bald = the template's default, never a
  reject reason for cast) + registry note. Folder still named `narrator/` — **rename to `base/`/`template/`
  is a pending cleanup.** Killed the "dial governs the narrator's restraint" framing: no on-screen narrator to
  restrain, so the library covers the FULL emotional range; restraint is a voice/writing property.
- **Scratch:** `_delta/` (gen) + `_model_sheet/` (gallery) gitignored. Delta gen: `scripts/gen_delta.py`.

**2026-07-05 — Visual: spec hardened for scenes + layered/composite architecture PROVEN + cost model settled.**
Extended the visual system from characters to full story SCENES (per user: it's illustrated story shots — ship
sailing, island reveal, natives, flag-planting — not character-over-backdrop).
- **Cost/model finding (flash vs pro test, `_scene_test/`):** the 2D world STYLE locks cleanly on cheap
  **`gemini-2.5-flash-image`** (~4–5× cheaper); but flash drifts character IDENTITY (MacGregor went bald/bearded,
  a nose + ears crept in). So: **flash = plates/props/environments/style; pro (`gemini-3-pro-image`) = locked
  characters/elements only.** And our motion model is stills+Remotion (≈$0 render), so a video's cost ≈ its
  stills — bounded, not runaway. Image cost is the whole lever; flash-default cuts it ~70–80%.
- **Spec hardened (`style-bible.md`):** added **NO ears** invariant + "verify the full rig on EVERY character in
  EVERY scene" (§2/§2b/§3); **§8b model tiers**; **§8c layered/composite architecture** (flash plate +
  composited rig-controlled character/element layers; NEVER let flash free-draw named characters — that's what
  drifted the natives); **§8d recurring-element locks** (ships/locations locked + checked like characters + a
  reusable scene-style descriptor). Principle (user-directed): everything a character/element must be is
  *explicitly prompted AND checked*; unspecified traits drift (ears were never specified → the model invented
  "one ear").
- **Architecture PROVEN (`_proof/`):** generated 3 ISOLATED layers — a flash shore PLATE, a pro rig-locked
  MacGregor (no nose/no ears/egg head held), a flash canonical SHIP — flood-key-cut and composited (PIL) into
  one coherent, on-model, **drift-free** scene. Confirms: characters/elements generated in isolation on the rig
  + composited = no in-scene drift; recurring elements (ship) are reusable locked assets; most volume runs on
  flash. Real compositing is a Remotion (Phase-2) job; this is the still-stage proof. Remaining nit: pro
  MacGregor's hair got over-suppressed by the no-ears emphasis (fix: prompt "keep swept hair, ears hidden").
- **Process capture started:** `docs/superpowers/notes/visual-identity-process.md` — the reusable METHODOLOGY
  (questions to ask, inputs, tooling, workflow, failure modes) to be formalized into a niche-agnostic
  `style-lock` establisher skill later. Per user: capture the PROCESS, not the channel-specific rules; skill it
  once proven (now it is). Rename done: `refs/narrator/` → `refs/base/` (base = template, not a host).

**2026-07-05 — The Second Take voice LOCKED = "Jake" (`hxPRa8HUuKYsm1kiWDEi`), on eleven_v3.**
Replaced the George placeholder. Chosen after a measured multi-round audition (7 rounds; see
`channels/the-second-take/voice-lab/voice-lab.md`). Process learnings worth keeping: (1) **Voice-Design
(text-to-voice) previews are a trap** — the beloved "B-3" preview's cadence/emphasis was a one-off *design-model*
performance that **could not be reproduced** by production TTS (cadence/emphasis are per-utterance, not stored in
a voice_id) and IVC cloning was blocked on the key anyway; pivoted to **library voices** (built from real
recordings → human + consistent by default). (2) Voice text-descriptions are unreliable → built an **objective
acoustic screen** (`voice-lab/*.py`: F0 pitch via numpy autocorrelation + spectral-centroid brightness + silence
share) to filter the ~400-voice library on measured pitch/brightness/accent. (3) **Perceived pace = articulation
rate + pause share, not gross wpm** — the old 145-150 wpm target was miscalibrated (measured off dry/calm
channels); Jake sits at ~195 gross / ~26% pause and reads energetic-but-comfortable. Settings locked in `dna.md`;
`voiceover-contract.md` pace guidance corrected. Account tier is **creator** (not free as CLAUDE.md implied).

**2026-07-06 — Style-bible head-shape wording corrected + head-shape mechanism established; base unchanged.**
The base narrator head is a round near-circle, but the bible called it "egg-shaped / oval" — including in the
§2 LOCKED descriptor that `asset-forge`'s `forge.py` auto-injects into every generation (it reads the §2/§2b
blockquotes verbatim from `style-bible.md`). Corrected to "round near-circle (NOT egg/oval)" across §1b/§2/
§2b/§3 so the description matches the reference. Concern that drove it: would "circle" language make the engine
snap to an exact circle divorced from the base? **Tested — no.** A maximally forceful "perfect geometric
circle, no jaw, a ball" prompt seeded off `base.png` returned a pixel-identical head (measured H/W 1.294 vs the
base's 1.291; three rolls identical). The engine is sticky to the seed and treats the shape adjective as nearly
inert — so the wording fix is about *accuracy*, not drift-prevention, and the base needs no change (an exact
circle is neither needed nor promptable). Corollary now codified in §8: head drift toward a realistic jaw (e.g.
the con-man in `_cast_test/`) comes from human-defining CONTENT (age/hair/facial-hair/gender/build) invoking a
realistic-head prior, NOT the descriptor word; the lever is an explicit anti-realism clause + seed/rig-composite
(§5/§8c), to validate at the real cast pass. Also trimmed the bible for duplicate/verbose language while
preserving every directive. Tests (gitignored scratch): `_cast_circle/`, `_circle_base/`. Removed the §2
blockquote's markdown bold so literal `**` can't leak into prompts.

**2026-07-06 — Visual-narration GRAMMAR researched (6-agent frame-by-frame) → visual-prompt-writer rewritten + universal §13a.**
The visual layer was the weakest-understood part of the pipeline: `visual-prompt-writer` defaulted to
depicting the sentence literally. Ran a **6-agent frame-by-frame study** of the channels we based the
*visual* work on (not the script/packaging board): **HeyHistorically** (Dumbest Heist, Sieging Castles),
**Crayon Capital** (Petrodollar, 5000 Years of Gold), **OverSimplified** (Cold War Pt 1, Emu War — swapped
in for the 33-min Prohibition to balance length). Each agent sampled ~80–100 frames across the arc, aligned
every shot to the transcript, and classified the **narration-type → shot-type** relationship + within-shot
motion. **Anti-stall method (agents had stalled before on 4K/AV1 decode):** pre-downloaded all 6 at **480p
H.264 to local files** (yt-dlp), fed video-vision the local paths with `skip_audio` + 340px frames + cleaned
YouTube captions as the narration track — no whisper, no 4K decode, no per-agent re-download. Probed one
video in the main session first, then fanned out. All 6 completed clean.
- **Load-bearing finding (all six converged, unprompted):** *non-literal is the DEFAULT; literal depiction
  is reserved for concrete physical action/objects.* Plus: personify institutions + stage relationships as
  interactions; glue numbers to objects/diegetic surfaces; ironic-counterpoint is the humor workhorse;
  register-switches carry meaning; motion is cheap + cut-driven (one meaningful transform per shot).
- **User guardrail (load-bearing):** the learnings must be **KINDS of narration → KINDS of shot**
  (generative), NOT a rigid lookup ("say X → draw a genie"). A phrasebook over-fits and *is* the AI-slop
  failure mode. Mid-flight-steered the 3 still-running agents to abstract UP; all output landed at the
  generative altitude. Also corrected "finance" → "money-topic STORY."
- **Deliverables:** `channels/the-second-take/visual-kit/visual-narration-grammar.md` (the grammar +
  narration-type→shot-class table + within-shot motion + §8 channel translation + raw shot-logs preserved in
  `visual-kit/research/shot-logs/`). Niche-agnostic core promoted to **`universal.md` §13a** (shared craft).
- **Applied to the pipeline (§9 of the doc):** `visual-prompt-writer` rewritten — new **Step 2.5** (classify
  → pick shot-class → *invent* the shot), a **literal-check gate**, an **anti-slop guardrail**, and 3 new
  `shots.json` fields (`narration_type`, `shot_class`, `within_shot_motion`); schema ref updated w/ a
  non-literal worked example. `long-form-writer` + `shorts-writer` gained upstream cue-quality guidance (cue
  the beat's *meaning*; voice claims verbatim so visuals can unmask them; reach for vivid idioms).
  `asset-forge` gained a "build the recurring kit first" rule; `render-builder` now knows `within_shot_motion`
  (informational under Pattern A, load-bearing in the Phase-2 Remotion layer). **Deep asset-forge/render-builder
  work deliberately deferred** until the grammar is proven on a real video + Remotion is built (prove-before-
  over-building). **Not yet validated on a real video** — natural next test = regenerate the Poyais `shots.json`
  under the new grammar.

**2026-07-06 — The Second Take voice RE-LOCKED: Jake → "Miles" (`vSjOBQp24DUB2COr2xI9`) @ v3 stability 0.25.**
Reviewing Jake on the real Poyais script (not the short audition passage) surfaced two things. (1) **Injected
pauses were too long:** human/library voices already breathe at punctuation, so our `[PAUSE]`/`[BEAT]` tags
*stacked* on top and dragged. Fixed engine-wide in `voiceover.py` `clean_markers` — shortened the tier map
(`[BEAT]` → natural/no tag on v3; `[PAUSE]` → short pause; `[PAUSE:LONG]` → normal pause) + updated the pause
doctrine in `voiceover-contract.md`. (2) **Miles beat Jake by ear** across a short-pause + stability A/B on the
real slice; user chose Miles at the loosest/most-expressive rung tested (**stability 0.25**). The low-stability
variance worry was **measured, not assumed** — a consistency proof (two independent rolls of one passage + a
different passage) gave F0 148.1 / 148.1 / 144.1 Hz, ~175 gross wpm, ~18% pause: run-to-run drift is
human-bounded even without seed-locking, and 148 Hz is inside the 145–165 gate. Trade-off logged: pause-share
fell to ~18% (relentless-leaning) as a side effect of shortening pauses — lengthen `[PAUSE:LONG]` if a full
script feels breathless. Jake's rationale + all rounds preserved in `voice-lab/voice-lab.md`. Also fixed a
blocking v3 bug found en route: the engine sent `previous_text`/`next_text` (v2-only) which `eleven_v3` rejects
(HTTP 400) on any script >~2k chars — now gated off for v3.

**2026-07-06 — Script-craft A/B study (researcher + long-form-writer) → both skills upgraded.**
Sibling to the visual-grammar work: our researched scripts read like a straight-line telling of facts; the
reference channels' don't. Ran an **A/B experiment** (not just analysis, per user): **Phase 1** — 6 parallel
agents characterized reference scripts from transcripts (Crayon Petrodollar+Gold, HeyHistorically Dumbest
Heist, OverSimplified Cold War, **Coffeezilla** Argentina-memecoin [our lever], **MagnatesMedia** Beanie-Babies
[our format twin]); **Phase 2** — on 3 same-topic anchors (Dalton-gang heist, $LIBRA/Milei fraud, Beanie-Babies
bubble) we ran OUR current pipeline (researcher at a **bounded LIGHT tier, hard-capped** — no HEAVY fan-out, per
the user's strong cost concern) → writer → then a compare agent diffed ours vs theirs and **attributed every gap
to researcher or writer**. Artifacts preserved in `channels/the-second-take/research/script-craft/`.
- **Measured finding (settles the "is it storytelling?" question):** money-story references run **70–85%
  payload** (Cold War ~100%); the one low-payload script (35%) was history-comedy. So it's **NOT story-vs-facts**
  — the craft is a thin **staging layer over dense facts**, vindicating payload-first. The lesson is *better
  delivery of the same information*, not less.
- **Core diagnosis (confirmed 3× independently):** our pipeline yields a *lucid mechanism-essay*; the references
  tell a *character story with human wreckage* over the same facts. We lose on **people + staging, NOT rigor** —
  ours actually *won* on thesis, analogy-as-indictment, the person→system landing, and defamation/sourcing
  discipline. The gap is genuinely **both skills**: (a) the **researcher** flattens rich sources into a fact-ledger
  and prunes cast/motive/victims as "mood, not payload" — key nuance: it's **extraction DEPTH, not access** (a
  Coffeezilla interview we'd *already cited* was reduced to 2 bullets), so the fix is **cost-neutral** (deeper
  reading of sources already pulled); (b) the **writer** narrates flat even when material is present, and used
  **zero dramatized scenes** because it will only stage verbatim quotes the ledger lacked.
- **The craft grammar (`channels/the-second-take/script-craft-grammar.md`; niche-agnostic core → `universal.md
  §5c`):** scene-as-default-unit · mechanism-ASSEMBLY reveal (Magnates — our format spine) · verification-as-content
  (Coffeezilla — our lever; the "aha" fires when the viewer *watches the bar get cleared*) · character-first
  villainy + named human stakes · irony cross-cut for **pre-spoiled endings** (our genre's core problem) ·
  second-person universality bridge. One tension resolved: **stage scenes with hedged paraphrase, never invented
  quotes** (keeps defamation discipline).
- **APPLIED (user approved):** **`researcher`** — job expanded from fact-ledger to story-ready dossier; the
  "ignore mood" rule narrowed to "mood that carries NO payload"; **4 new required dossier blocks** (`Cast, motive &
  human-cost`, `Verbatim exchanges & scenes` [Q-NN], `Verification chain`, `Why this matters/universality`);
  research-contract.md §6 codifies extraction-depth (cost tier + defamation discipline unchanged). **`long-form-
  writer`** — a "STAGE the story" craft block in Step 3-shared (scene-default via hedged paraphrase, mechanism-
  assembly, staged verification, irony cross-cut, section-loops, villain/victim/universality beats; "transfer
  framing not frequency"), a new editor lens (#6 story-staging), reads the channel grammar doc. **`shorts-writer`**
  — a staging bullet (scene-first; verification/irony hook; one lever). **Doctrine** — `universal.md §5c` (story
  staging) + `watchability-rubric.md` grew to **/30** (new dims 13 mechanism-assembly, 14 verification-staged, 15
  character/named-stakes; dims 5/6/11 un-flagged as gaps). **Guardrails preserved:** the fixes must not erode the
  rigor/thesis/analogy/defamation strengths we already beat the references on, and richness comes only from
  *sourced* material (we correctly declined the references' unsourced color). **Not yet validated end-to-end** —
  next: re-run one A/B topic through the upgraded pipeline to confirm the gaps close without eroding the wins.

**2026-07-06 — Visual-pipeline exploration: findings + doc reconciliations pending (The Second Take).**
A long hands-on session testing how we actually generate a video's visuals (Poyais as the bench). What was
proven, and what it means for the doctrine:
- **One-shot-in-scene beats compositing for character shots.** Compositing separately-generated, front-facing
  character frames onto detailed plates reads as **paper-doll stickers** (proportion mismatch — chibi cast vs
  realistic-scale environments — plus paper-doll posing, lighting/scale mismatch; a soft shadow + grade does
  NOT fix it). Generating the character **into** the scene one-shot (pro), seeded off a canonical frame for
  identity, avoids all of that (proven on `_mac_clip/` — MacGregor in a candlelit room; mac2/mac5 held his
  identity via seed-from-reference). **This contradicts `style-bible.md` §8c**, which still frames scenes as
  flash-plate + composited character layers → **§8c needs reconciling** (one-shot-in-scene as the primary path;
  composite/Remotion reserved for motion or genuine multi-character control).
- **Environments = one-shot *pro* + a depth-layered prompt (foreground/midground/background + "no banding") +
  the §2b style descriptor.** That clears the Crayon bar (proven on `_scene_capital/`, `_opening_test/`).
  **Flash-for-plates was the failure** (crude banding in the earlier `_proof/`). **§8b still says "flash =
  plates default" — disproven; needs updating** to: pro for anything visible; flash only for drafts + deep
  background / blurred elements.
- **Non-literal depiction is gated UPSTREAM by the script.** The grammar-driven `visual-prompt-writer` can only
  be as non-literal / on-lever as the script gives it hooks (voiced spin, claims, idioms). The current Poyais
  script is **pre-grammar** (literal narration + literal `[B-ROLL]` cues), so the opening test still read as
  literal despite the grammar. The real lever is `long-form-writer` writing visual-aware scripts (voice the
  spin so the visual can unmask it — the vindication lever). Test the visual grammar on a *grammar-era* script.
- **Proven working recipes to keep:** non-literal prop/graphic shots + the signature **matched-state reveal**
  via seed-from-reference (poster → cracked → empty jungle, `_opening_test/`); **text-in-post** (gen clean with
  blank sign/banner areas, add titles later); **character consistency** via seed-off-canonical; **audio↔image
  sync** via ElevenLabs word timestamps → cut times → an in-artifact `<audio>` + timed slideshow.
- **Added to `style-bible.md` §8c (this session):** the **family rule** — every figure incl. background crowds
  & incidental extras must be the §1b family (round head, no nose/ears, flat cel) in era/story-appropriate
  clothing; never model-free-drawn (they drift off-style + off-era shot-to-shot). Base template's modern hoodie
  is moot since every video redresses the cast to its era (per user).
- **Still open / not yet proven:** the **signature ironic-unmask** (on-lever non-literal) has never actually
  been generated — a ceiling test is pending; rig drift persists (detailed period characters get a faint nose
  even with "no nose" — locked cast / anti-realism clause needed). Visual work **paused pending a grammar-era
  script + a fresh visual-prompt pass**. All test renders are gitignored scratch (`_scene_capital/`,
  `_layer_test/`, `_opening_test/`, `_mac_clip/`, `_cast_circle/`, `_circle_base/`, `_proof/`).

**2026-07-06 — REGISTER PIVOT: The Second Take → playful/comedic, story-first (dna re-lock + narrative-architecture layer).**
After the script-craft A/B (same day), the user reviewed a regenerated Poyais script and flagged two things the
A/B had missed: (1) it read like the old draft — the fix had been *beat-level staging under a linear dry
telling*, not a different *way of telling*; (2) the user wants the **comedic register** of Crayon Capital /
HeyHistorically ("jazz became the Wi-Fi of the 20s"), **not** the locked dry-serious voice. Pointed at Crayon's
"Great Depression Explained Like You're 5" as the North Star. Ran a **lean 7-video analysis** (Crayon Great
Depression + Petrodollar + Gold, HeyHistorically Heist + Castles, OverSimplified Cold War + Emu War) through
**two lenses**: **A = plot/storytelling across the video** (the macro gap) and **B = narration style** (the
comedic register). Grammar doc: `channels/the-second-take/narrative-register-grammar.md`; raw analyses in
`research/narrative-register/`.
- **Lens A findings (the layer the A/B skipped):** compelling channels *architect* a story, they don't tell it
  chronologically — **enter on a non-chronological hook** (in-media-res→rewind / mystery→rewind / paradox /
  tone-lock); **impose an arc-shape** (disaster-arc / rise-and-fall / question→rubric→evidence / one-souring-
  relationship / escalation-list-as-story — refuse chronology); a **controlling motif** that plants→pays→inverts
  (bookend the cold-open line); **narrate→dramatize→land** + vignette montage; a **designed emotional contour**
  (comedy is a DIAL that dials to zero for the human cost); a **deliberate exit** (deflate/mic-drop/bathos/hook,
  never a moral).
- **Lens B findings:** a fast wry third-person deadpan narrator; **jokes are anachronistic-analogies that
  TEACH** + deadpan undercuts + ironic re-labels + bathos, **every one fact-riding** (delete-test); smart-not-
  cringe = "laughs reward knowing the real thing"; evergreen only (no dating memes). Density ~2–3/min (up from
  dry-sprinkle ~1/min). **TTS rule:** fact+framing jokes keep; performance jokes convert to narrator-reported.
- **Two user-locked constraints (load-bearing):** **(1) NO second person** — never "you, the king," no viewer
  address; narration stays third-person. **(2) ONE narrator** — no distinct character voices / voiced dialogue;
  every dramatized beat + quote is the narrator's **reported speech**. (These also make it TTS-native on Miles.)
  The researcher stays register-independent (a small tweak only: flag humor-hook facts + architecture cues); the
  writer + doctrine carry the pivot. New doctrine rule: **illustrative-hypothetical devices** (a narrator-
  described "stock barber") are allowed and distinct from sourced facts.
- **APPLIED (user approved):** `dna.md` re-locked (register/persona/humor-dial → comedic + the two narrator
  locks + illustrative allowance); `universal.md` **§5d "Narrative architecture"** + **§1d-V F** (register +
  narrator are per-channel dials; retired second-person as a universal default) + removed the stray "direct
  you" cadence note; `watchability-rubric.md` → **/32** (dim 4 retuned to the comedic density, dim 11 repurposed
  to the third-person/one-narrator **lock**, new dim 16 **narrative architecture**); `long-form-writer` (outline
  pass now DESIGNS the architecture; Step-3-shared register + one-narrator/third-person scene rule; editor lens
  #7); small `researcher` + `shorts-writer` touches. **Kept intact:** payload-first, the fact-ledger leash,
  defamation discipline, and the staging grammar (now under the arc + register). **Validation:** regenerating
  the Poyais script under the full retune (in progress) — the test is whether it's genuinely fun + non-linear,
  third-person/one-narrator, without cringe or lost payload.

**2026-07-07 — Humor-execution correction: plain-FUNNY, not purple (The Second Take).**
The first comedic-register Poyais regen read as *literary flourish mistaken for wit* (user: "nothing about this
is funny"). Diagnosis: the source study was actually right — "jazz = the Wi-Fi of the 20s" is captured in
`research/narrative-register/` as the workhorse — but the grammar doc + `long-form-writer` abstracted that
concrete bar into "anachronistic analogy," and the writer then produced dead metaphors ("the load-bearing wall
of the con"), narrator self-editorializing ("the maddening thing," "refuses to sound real"), unglossed names
(Miranda/Bolívar), and near-zero actual jokes. A validated slice (the Poyais opening, user-approved) established
the fix. **Learnings baked in** — `narrative-register-grammar.md §B0` (the humor bar, PASS/FAIL), `long-form-writer`
(new "CLEAR THE HUMOR BAR" bullet + **killed the stale "don't import the comedy channels' joke density" bullet**,
which was pre-pivot and was keeping the writer dry), `watchability-rubric.md` (dim 2 register/no-self-editorializing,
dim 4 humor-bar auto-0, dim 6 voiced→narrator-reported), `universal.md §1d-V F`, `dna.md`:
1. The analogy must map onto a modern thing the viewer *instantly & universally* pictures — **BANNED:** dead/
   literary metaphors ("load-bearing wall," "coat-hook") and coined repurposings nobody's heard ("a bug in him").
2. Plain words; the narrator never editorializes its own material — a transition may label the *fact's* quality
   ("the strange part"), never the narrator's mood ("here's the annoying bit").
3. Actually be funny at the comedic density (three limp metaphors ≠ a comedy).
4. Concrete pictures over concepts; **gloss-or-cut** every unfamiliar name/term in one beat.
**Scope discipline (user-set):** these are NARROW, surgical refinements — do NOT strip good commentary/jokes/
metaphors; the validated slice's default voice stays. Two-phrase fixes should not balloon into a rewrite.
Regenerated the Poyais script to this bar.

**2026-07-07 — Transitions correction: deliver the moment, never announce it (The Second Take).**
User flagged the next pass's weak spots as almost all *section-openers that announce the CATEGORY of the coming
beat* ("here's the strange part," "the uncomfortable question," "the quietly brutal part," "here's the thing the
fraud historians keep noticing," "this is where it becomes a production") plus mechanical scaffolding ("Piece
one/two/three…"). Key insight (user): the problem is structural — transition *logic/formatting*, not vocabulary.
**Rule baked in** (`narrative-register-grammar.md §B7`, `long-form-writer` transitions bullet, `watchability-rubric.md`
dim 17 → /34): the narrator DELIVERS the moment, never announces it. Open each section on its content — the real
question it answers ("So who was he?") or the next action plainly ("After that, he…"); vary the connective tissue
(never a "Piece N" template); state it directly ("he wasn't a con-man" > "he doesn't read like a con-man"; "did not
hold back" > "did not undersell"). Applied across the whole Poyais script (14 section-openers rewritten); the loved
lines + the comedy-off death section kept byte-for-byte.

**2026-07-07 — Back-half register correction: keep it light, don't turn essayist (The Second Take).**
User: the first half's wry curiosity voice was good but didn't carry into the second half, which went "way too
literary" — an extended grief-dwell, a "worse and truer" moral thesis, and a paper-style conclusion (a list of
historical rhymes → "the tell never changes"). Refinements: (a) **comedy is a DIAL calibrated to the audience's
personal STAKE, not an auto-switch to zero** — these settlers are a distant curiosity, not a tragedy the viewer
grieves, so don't joke *at* the deaths but keep the light register (reserve full-solemn for genuinely resonant
suffering); (b) **don't over-dwell** — compress the darkness to one/two tight beats; (c) **kill literary
thesis-statements**; (d) **close on a quick wry button like the reference channels** (deflate/bathos/mic-drop/loop —
Crayon's sequel-hook, HeyHistorically's "Bloody children"), **never a paper-conclusion**. Baked into
`narrative-register-grammar.md §A8`, `long-form-writer`, `watchability-rubric.md` (dims 4/12/15), `universal.md
§1d-V E`, `dna.md`. Applied to the Poyais back half: compressed the death stretch (cut the Hastie/Providence-quote
beat + the "bought a new life" button), replaced the "worse and truer" thesis with a plain fast line, and swapped
the summarizing conclusion for a wry button ("Same con. Better graphics.").

**2026-07-07 — Humor density + ending fix; run the full skill flow (The Second Take).**
User read the improved draft: register now holds, but (1) **joke/humor density is still too low** — the script
"tells the facts" where the reference channels weave far more fun bits; push it up materially (no forced jokes /
no leash break). This is the pipeline's recurring miss — regens keep landing ~1 beat/min vs the 2–3/min target.
(2) **The crypto ending doesn't work** — "same con, better graphics… a whitepaper and a token for a product that
doesn't exist" reads as "Bitcoin is a scam" (a take we don't hold) and uses jargon ("whitepaper"). Rule: a modern
rhyme may invoke a *mania/bubble* parallel but must NOT accuse a real current asset of being a fraud, and no jargon;
prefer ending on the story's own irony. (3) Two awkward phrases to fix ("complicates the cartoon version"; "the
country he had genuinely helped to free"). **Process (user-directed):** regenerate via the ACTUAL skill flow —
`long-form-writer`'s staged writers-room (density draft → fresh-eyes editor subagent → revise) + the **`humanizer`
skill** as the final pass — not solo hand-edits. Baked into `narrative-register-grammar.md §B0/§A8`, `long-form-writer`,
`dna.md`.

**2026-07-07 — Craft-doc consolidation + register-model correction + project-wide structuring rule.**
User flagged that the craft docs and pipeline skills had rotted into **append-only date-logs** —
contradictory (one said "~1 joke/min dry-sprinkle," another "comedic ~2–3/min"), stuffed with Poyais-specific
post-mortems and orphaned reference-quotes, unstructured. Directed a **rebuild that preserves every learning**
(concise/structured/comprehensive), not a purge. Actions:
- **Merged `script-craft-grammar.md` + `narrative-register-grammar.md` → one `storytelling-grammar.md`**
  (§1 architecture · §2 register · §3 constraint re-routing · §4 staging · §5 our-edges); deleted both old
  docs (raw `research/**/char-*.md` notes kept as evidence archive).
- **Register model CORRECTED** from a fixed rate to a **DIAL set by topic gravity** (money-absurdity → hot;
  villainy → wry+sparse; **human cost → comedy OFF**), from a fresh teardown of NEW reference videos
  (HeyHistorically *Nassau* + *refugee-prince*; Crayon *AI Bubble* + *Rockefeller*). Channel is now
  **storytelling-first, more comedic than any pure finance/history channel, not a comedy channel.**
- **Linearity fix:** added a named **cross-cutting toolkit** (board-state / park-and-cut / ensemble / mirror /
  irony) + a **transition seam-kit** — the previously-weak architecture layer.
- **No quotes in scripts:** all dramatized beats are **narrator reported speech**; researcher's "Verbatim
  exchanges" block → **"Reportable scenes & characterization"** + a new **architecture-cues** deliverable.
- **Reconciled** long-form-writer (a "three rules the pipeline keeps missing" lead + architecture-first
  outline), `universal.md` §5c/§5d/§1d-V, `watchability-rubric.md` (held /36; dims 4/11/16/17 retuned),
  `dna.md`, `shorts-writer`, `reference-channels.md`, `visual-narration-grammar.md`.
- **Visual skill hygiene:** `visual-prompt-writer` (fixed a three→four miscount, surfaced silent-break rules),
  `asset-forge` (reframed the "locked" style-bible language), `style-bible.md` restructured **with spec values
  preserved verbatim** (palette hexes/descriptors/checklist untouched).
- **Durable mechanism (user-directed):** new **CLAUDE.md operating rule 6** (integrate-don't-append; general
  learnings, no dated log-blocks) + a new invokable **`curate-doc`** skill to restructure any drifted file.
Spec: `docs/superpowers/specs/2026-07-07-storytelling-grammar-and-skill-restructure-design.md`. **Status:
applied; NOT yet validated** — next is a Poyais long-form regen through the rebuilt pipeline.

**2026-07-07 — Visual-grammar consolidation + skill craft de-dup + doc deep-clean (session 2).**
Continuation of the same-day rebuild, extending the discipline to the visual pipeline and fixing a systemic
doc-rot the user named ("locked decisions never get written back, stale docs keep getting referenced").
- **Visual grammar consolidated + pacing made BINDING.** Merged `visual-kit/content-language.md` +
  `visual-narration-grammar.md` → one `visual-kit/visual-grammar.md` (our rig/cast/prop library + lever
  translation + the *committed* 2.5D-vector recipe; retired the stale §D A/B/C "directions open" section);
  deleted both old docs (shot-logs archive kept). Promoted the niche-agnostic visual grammar to
  `universal.md §13/§13a` as **binding law** — new **§13a-i** (within-shot motion: a shot is a COMPOSED
  SLATE — idle motion + one meaningful VO-synced transform + pop-in/type-on; enumerations → progressive
  reveal, "no church/no roads → drop an X per word" as ONE shot) and **§13a-ii** (cut cadence + the HARD
  RULE: a shot exceeds ~8s only with a progressive within-shot reveal — kills the stretch-to-fill dead-hold
  bug). This fixes the "one visual stretches too long" failure.
- **Shot-list ownership fixed.** `visual-prompt-writer` now OWNS the shot list, count, pacing, and durations
  and must author a choreographed slate (rich `within_shot_motion` per shot); `long-form-writer`'s `[B-ROLL]`
  cues are **meaning anchors only**, not the shot list (old mislabel removed).
- **Skill craft de-dup (single source of truth).** `long-form-writer` Step 3-shared cut from ~87 duplicated
  craft lines to a ~28-line §-anchored checklist + a hardened "you are BOUND to `storytelling-grammar.md`;
  the doc is the law" instruction (adherence UP, duplication OUT); `shorts-writer` dup collapsed to pointers;
  `visual-prompt-writer` Step 2.5 de-duped against `universal.md §13a`; `researcher` had no real dup (left).
- **Doc deep-clean (systemic fix).** `dna.md` reconciled to the current lock — Visual style now states the
  LOCKED recipe (clean 2.5D vector cast + built environments + marker charts + one red accent), killing the
  stale "hand-illustrated/crayon-sketch" framing, the superseded second-person "your money avatar," and the
  "finalize the variant before video 1" TODO; POV + thumbnail lines synced. `reference-channels.md` self-
  description + §3 persona headline reconciled to storytelling-first/gravity-dial (deadpan demoted to a tool);
  `idea-backlog.md` / `performance.md` audited clean. Enforced going forward by CLAUDE.md rule 6 + `curate-doc`.
Spec: `docs/superpowers/specs/2026-07-07-visual-grammar-consolidation-and-doc-deepclean-design.md`. **Status:
applied; NOT yet validated** — next: Poyais regen of BOTH `script.md` and `shots.json`.

**2026-07-07 — HARD RULE: no em/en dashes in scripts (user-set).** Em dashes are an AI tell and are
inaudible to a viewer (the audience only hears the VO), so they add nothing to a voiceover script. Banned
outright in all scripts. The prescriptive guidance that formerly taught "em-dash = sharp cut-in" is flipped
to a hard prohibition in `universal.md §1d-V` (punctuation/breath-score) + `long-form-writer` (pacing bullet
+ pre-ship checklist) + `storytelling-grammar.md §3` + `voice-lab.md`; every cut-in/aside is a period,
comma, or colon, enforced in the humanize pass. Applied to the Poyais `script.md` (zero em dashes). This
resolves the earlier conflict between the humanizer's zero-em-dash rule and the writer's em-dash prosody
guidance, in favor of the ban.

**2026-07-07 — Script-craft refinements from the Poyais read (casual register + lighter human cost + denser analogy).**
User reviewed the regenerated Poyais script: solid, but a notch too *polished-literary* where the channel wants
*casual-and-alive*. Five GENERAL script-generation learnings, each integrated into existing sections (no new
sections, no dated append-blocks):
- **L1 Casual storyteller, not a literary essayist** — no clever-convoluted sentences, no writerly aphorisms
  / profound summary-lines, no cliché stock transitions ("which brings us to," "the strangest turn of the whole
  story"), casual word choice. (Keeps the good casual deadpan buttons; the ban is on literary flourish.)
  → `storytelling-grammar §2.2` + `§1.9`.
- **L2 Plain word first** — jargon ("sovereign debt," "chieftainship") scares casual viewers even when
  glossable; reach for the plain word. → `§2.5`.
- **L3 Human cost kept LIGHT** — register it concretely and move (paradise → swamp → turned away → dream broke
  → most died → the villain was fine); NO named-victim biographies or grief-milking. A **calibration** of the
  earlier "named human stakes" rule, not a removal (the A/B fix was to stop being cold/abstract, not to dwell).
  → `§2.8`/`§4`; researcher human-cost block relaxed from "≥1 named victim (required)" to "light aggregate,
  named victim optional"; `universal.md §5c` made register-calibrated (documentary can name; entertainment
  stays light).
- **L4 Modern analogies CARRY the telling and run through the body** (dot-com bubble, tech-bro selling
  vaporware, five-star-resort-vs-swamp), not one at the end. Density under-shoots by default = the pipeline's
  #1 recurring miss. → `§2.1`.
- **L5 No essay conclusion** — end on the story's ironic image; the vindication insight is WOVEN into the body,
  never a closing lesson / "repeats every generation." → `§1.11`; researcher universality spine → optional body
  texture, never a mandated close.
**Enforcement (the load-bearing part):** the fixes live in the skill/rubric, not the executor's judgment, so any
run reproduces them — `long-form-writer` Step 3c editor lenses 4/6/7 + the Step 5 humanize pass now actively
flag clever-literary lines, thin analogy density, jargon, grief-milking, and essay-closes; `watchability-rubric`
dims 2/4/12/15 score them. **Status: applied; not yet re-validated on a script** (next: optional Poyais re-run).

**2026-07-08 — Scriptwriter rebuilt around a GOLD EXEMPLAR + a CRITIC LAYER (prohibitions → positive teaching).**
Root cause of the flat/buttoned scripts that survived every prior fix: the skill tried to fix a *generative
default* (literary voice, per-beat summary buttons, fact-stuffing, jargon) with ever more *prohibitions*
self-checked by the same model — which shares the blind spot, so the defects passed review. The fix is
architectural, not another rule. In order:
- **Gold exemplar.** The Poyais `script.md` was hand-locked line-by-line with the human as the canonical *voice +
  accuracy* benchmark the skill imitates (§0 of the grammar). A blind regen proved the exemplar teaches the
  target but can't enforce it alone.
- **`storytelling-grammar.md` rebuilt** (from 266 lines) around §0 gold + a **before→after bank** of the exact
  tells + positive principles; ~40 undifferentiated prohibitions collapsed (deleted where the exemplar now
  carries them). Old §-numbers remapped across `dna.md` / `watchability-rubric.md` / `reference-channels.md` /
  `visual-grammar.md`.
- **`long-form-writer` rebuilt** (from 435 lines): generation changed to **casual-first, leash-second** — distill
  research into a plain-English spine, set the ledger aside, write the story casual, THEN fact-check — so facts
  can't flatten the voice. Taste-prohibitions became **positive/mechanical checks** (de-button = "read the last
  sentence of every paragraph; end on a fact/action").
- **Color vs. dwell (grammar §2.5).** Density calibration: *color* = a new concrete detail (add it; the gold ran
  slightly too terse), *dwell* = restating a point for emphasis (cut it; a hands-off regen over-dwells). The gold
  was recalibrated to the middle.
- **No-second-person clarified.** The lock bans *casting the viewer into the story* ("imagine you're a settler,"
  "your money"), NOT the generic impersonal "you" ("gold you could wash out of the sand") — a judgment call, so
  it lives with the taste critic, not a grep.
- **Critic layer (Step 3d — `references/critics.md` + `scripts/lint_script.py`).** Because self-editing shares the
  writer's blind spot, a thin fan-out: deterministic lint (dashes/quotes/traces/wordcount) → **taste critic ∥
  leash critic** (flag only) → **editor** (applies in-voice, keeps color + fact-riding deadpan, keeps sourced
  facts on conflict) → re-lint. One cycle, subtractive.
**Validated:** the blind regen leaked 5 grandeur buttons + dwell + "first/then" enumeration (the self-edit blind
spot, as predicted). The critic layer caught **all** of them plus a subtle leash error (collapse vs. face value),
edited in-voice, kept every protected line, and tightened 1,989→1,788 words. One minor signpost slipped through =
the expected residual (a human glance catches the last one). The long-form scriptwriter is now considered
production-quality for The Second Take. Skill-creator + brainstorming + systematic-debugging skills used.

**2026-07-08 — `visual-prompt-writer` anchor contract hardened + `lint_shots.py` (shot↔script fidelity).**
Reviewing the Poyais `shots.json` surfaced two silent defects the skill allowed: a **paraphrased `vo_ref`**
(L22 "he commissioned…" vs the script's "MacGregor commissioned…") and **out-of-order densify inserts**
(L29b before L30, L55b before L56 — the insert's narration actually comes *later*). Root cause: `vo_ref` was
speced as a loose "first few words" tag with **no verbatim mandate, no narration-order invariant, and no
validation** — yet `render-builder` *times every cut* by matching `vo_ref`'s first 4 normalized words to the
real VO word-stream (`render.py::retime_by_timings`), so a paraphrase or disorder mis-times that shot and, past
a threshold, collapses the whole video to crude proportional timing. **Fix (structural, not more prohibitions —
the same lesson as the scriptwriter rebuild):** (1) SKILL.md + shots-schema.md now require `vo_ref` to be a
**verbatim** copy of the VO line's opening words (≥4) and shots in **strict narration order**; (2) new
**`scripts/lint_shots.py`** mirrors render-builder's matcher exactly (first-4-words, normalized, sequential) and
**HARD-fails** on either defect, so a clean lint guarantees the render's per-line sync holds; (3) on a clean pass
the lint `--write` **derives** two review-only fields — `vo_text` (each shot's verbatim VO span, anchor→next) +
a top-level `shot_counts`. **Constraint honored (user-directed):** `vo_text` is *derived, never authored, and
never a depiction brief* — the image stays anchored to its one moment (Step 2.5); a long computed span is a
signal to **densify** (add a cut), not to cram meaning into one prompt. Dogfooded on Poyais: reordered the two
inverted pairs, de-paraphrased L22, lint now passes clean (93/93 anchors verbatim + ordered; 3 densify heads-ups
raised, not blocking). The lint tokenizer was itself corrected during dogfooding (whitespace-split, not
word-char, so hyphenated words like "five-star" don't false-positive — matching render-builder's needle logic).

**2026-07-08 — IMAGE-GENERATION SYSTEM REBUILT (asset-forge → `image-generation`, two-pass flow, doc split by owner).**
The scriptwriter-rebuild pattern applied to the visual side. Root causes: (1) **the locked style never reached
the actual video** — render Pattern A sends `shots.json` prompts to JSON2Video's image model as bare text (no
seed-from-reference, no verify), so the entire style-lock applied only to library assets, never the B-roll;
(2) **per-shot independent generation can't hold recurring entities** (MacGregor re-invented per shot); (3) the
three visual docs overlapped and the scene rules were a NEVER-pile. Fix, architectural:
- **Two-pass flow** (in the renamed `.claude/skills/image-generation/`): **pass 1** derives a per-video asset
  library from `shots.json` (every NAMED character + any ≥2-shot/peak-beat prop/plate materialized ONCE,
  reuse-before-regenerate vs the channel registry) → `videos/<slug>/assets/library/` + manifest; **pass 2**
  assembles every scene generation-based from it (technique menu: reuse / multi-seed composition / plate-then-
  place / one-shot; delta-overrides-descriptor precedence; per-call **flash/pro model tiers** now wired in
  `forge.py --model`) → `assets/scenes/<shot-id>.png` + manifest. Two gates: the §3 **rig gate survives as-is**
  (verify-by-looking is already fresh-eyes — the scriptwriter's prohibition lesson does NOT apply to pixels) +
  a NEW **fresh-eyes scene-taste gate** (reads as beat/shot_class, on-recipe, not slop).
- **Doc split by owner:** `style-bible.md` = THE image-gen doc (absorbed the recipe + library build spec/build
  order from visual-grammar; locked values verbatim); `visual-grammar.md` slimmed to **staging law** (the
  visual-prompt-writer doc; + the consistent-entity-naming rule pass 1 depends on); the **live asset vocabulary
  = `registry.json`** (data — no prose copies). Pipeline order: VPW authors first from the channel-persistent
  registry; pass 1 derives the video library from what it invented.
- **Validated by two fresh-eyes paper dry-runs** (subagents with only the new docs + Poyais `shots.json`; no
  image spend): 22 findings round 1 (named-single-shot-character rule collision, no group/thumbnail/shorts
  recipes, unhandled `source:` values, model-tier boundary holes, registry mechanics gaps) + 6 round 2 — all
  fixed in-doc. **One locked-value clarification, human-ratified same day:** §3 "No text" scoped to
  **unrequested** text (composed scenes may carry shot-authored diegetic text — stamps/counters/labels; library
  frames stay text-free; requested text must render verbatim/legible) — without it ~40 of Poyais's 93 authored
  shots hard-fail their own plan. The §2/§2b descriptors keep their "no text" clause as the standing DEFAULT
  that suppresses spurious model text; a shot's delta overrides it only for the words it names.
- **Named follow-ups:** #1 wire render-builder to consume `assets/scenes/` (✅ done same day — next entry);
  #2 the Poyais two-pass dogfood (first approved composed scenes = the gold scene exemplars). Spec:
  `docs/superpowers/specs/2026-07-08-image-generation-rebuild-design.md`.

**2026-07-08 — RENDER-BUILDER WIRED TO THE TWO-PASS PIPELINE (scenes mode; the locked style now reaches the MP4).**
Follow-up #1 of the image-gen rebuild, same day. Previously the render's Pattern A sent every `still_prompt`
as bare text to JSON2Video's bundled image model — no seeds, no rig, no verify — so the entire style-lock was
bypassed at the last pipeline step. `render.py` + docs rebuilt around a third asset-resolution mode:
- **`scenes` (the pipeline default):** auto-detected when `assets/scenes/manifest.json` exists; each shot's
  visual = the verified `assets/scenes/<shot-id>.png` from `image-generation` (shorts:
  `<short-stem>-<shot-id>.png`), hosted via the existing presigned `upload_asset()` seam (`__LOCAL__`
  sentinel until submit). **A missing scene for an ai-gen/hybrid shot is a HARD ERROR** ("run
  image-generation pass 2") — silent off-style inline fallback is the exact bug this kills;
  `--allow-missing` is the explicit test-slice escape, recorded in the manifest.
  Chart/screencap/stock/archival shots (which image-generation deliberately skips) fall back inline and are
  counted (`scenes_from_files`/`inline_fallback`) so `compliance-check` sees exactly what's style-locked.
- **`inline` (alias A) / `clips` (alias B) survive** for channels without a style bible, test slices, and the
  dormant external-clips path. Mode precedence: flag > scenes-manifest auto-detect > `shots.json`
  `render_pattern` > inline. Scenes mode also spends no JSON2Video gen credits.
- **Zero upstream changes needed:** the file convention + scenes manifest carry the wiring; `still_prompt`
  stays authored on every shot (it's image-generation's input + the inline fallback's prompt).
  `visual-prompt-writer`/`shots.json` untouched (schema doc note only). `publish-queue` (when built) uses
  `scenes/thumbnail-primary.png` when present.
- **Validated by dry-run fixture** (no credits): auto-detect + hard-fail listed exactly the 88 missing ai-gen
  shots on a 93-shot Poyais copy (2 fixture PNGs + 3 chart fallbacks accounted); `--allow-missing` payload
  carried 2 `__LOCAL__` srcs + 91 inline with correct manifest counts; a no-scenes video auto-fell to inline
  unchanged. Spec: `docs/superpowers/specs/2026-07-08-render-builder-scenes-wiring-design.md`. Pipeline order
  is now: visual-prompt-writer → **image-generation** ∥ voiceover → render-builder → compliance → publish.

**2026-07-08 — SCENE CHAINING (held evolving stages) built + proven; no-fade lock; 4-digit hands; anchor lint.**
A cluster of visual-continuity work. (1) **No fades at the root:** `render.py` emits no scene transition —
hard cuts only (fades/cross-dissolves read as photo-doc B-roll on flat vector); shots-schema + render-schema
updated. (2) **Shot↔script anchor contract + `lint_shots.py`:** `vo_ref` must be a verbatim prefix in narration
order (render times cuts off its first 4 words); the lint HARD-fails paraphrase/disorder and derives review-only
`vo_text` + `shot_counts`. (3) **Hands LOCKED to 4 digits (3 fingers + thumb)** in style-bible §1/§2/§2b/§3 +
gate — no regen (a 5-finger attempt failed: the engine is sticky to the seed and ignored the worded delta;
verify image changes with a **pixel-diff**, never eyeball). (4) **Scene chaining:** a drift test proved seeding
each still off the *previous* still holds the set (~1.8–6.7 held-set Δ over 2 hops) vs. independent per-shot gen
(~40–57) — ~10× less drift; identity holds in both. Design (spec:
`docs/superpowers/specs/2026-07-08-scene-chaining-design.md`): a **STAGE** = one held set, a `base` frame +
**≤3 `delta`** frames, then re-base or hard-cut. **INTENT vs MECHANISM split** (future-proofs the coming
Remotion swap): visual-prompt-writer/shots.json author intent-only additive fields (`stage`, `stage_role`,
`changed_elements`), never "seed off prior"; image-generation owns the mechanism (new pass-2 technique
"seeded delta-chain" + a `forge.py diff` held-set gate; §5 seed-law gets a within-chain-only exception).
`universal.md §13a` gains the executor-agnostic continuity hierarchy (layer-move[Phase-2] > delta-chain[now] >
hard-cut). **Proven on Poyais:** the guidebook stage as base + 3 deltas (book → +golden city → +citizens/"POP.
20,000" → +red FICTION stamp) held the desk/candle/book through all 3 hops, on-style, with the signature red
unmask. Board: https://claude.ai/code/artifact/6bec46de-3691-43bb-9796-4b41456013e0 . **Phase-2 (deferred):**
Remotion assembler + element-cutout generation for layer-moves (the `changed_elements` schema future-proofs it).

**2026-07-08 — REMOTION MOTION ENGINE BUILT (local render = the default; JSON2Video demoted to legacy; motion.json contract).**
Phases 1+2 of the motion-engine plan (`docs/handoffs/2026-07-08-remotion-engine-prompt.md`), same day as the
image-gen rebuild + scenes wiring. **Why:** JSON2Video could only do Ken-Burns stills (no element animation, a
watermark + 1-min free cap + a Pro subscription on the roadmap), and its whisper captions re-transcribed audio
we already had exact word timings for. **Spike proof (gate passed):** Remotion 4.x (pinned; license free ≤3
people) rendered 12.2s of 1080p30 in ~7s (~1.5× faster than realtime → a 14-min video ≈ 10 min local, zero
API cost); word-synced stat-card pop + word-highlight captions straight from ElevenLabs `word_timings`; a
one-time ~70s Chromium download. **Architecture (fixed engine + per-video data):** a component library in
`render-builder/engine/` renders a per-piece **`motion.json`** (contract `references/motion-schema.md`,
schema `faceless-youtube/motion@1`) passed as Remotion inputProps; **`build_motion.py`** derives it
mechanically from shots.json + `assets/scenes/` + the VO manifest + `visual-kit/motion-tokens.json`
(channel look = data; engine niche-agnostic), **importing render.py's retime/resolve functions** so both
engines share one timing + hard-error semantics. Key mechanics: **one camera arc per STAGE** (the held-set
grammar — delta frames read as events on a stable set, not camera restarts); spring camera + idle baseline
(a dead static frame is unrepresentable); the **T2 device kit as CODE** (stat-card, counter, chapter-card,
meter, definition-card, progressive-reveal — real type, resolving the garbled-gen-text problem; long copy
belongs here, not baked into images); chart/screencap/stock shots render as **visible placeholder cards**
counted in the manifest (marker-charts-as-code = the T2 follow-on); `bundle(publicDir=assets/)` reads
scenes/VO in place, no copying; same `render.manifest.json` contract (`render_engine: "remotion"`,
`watermark: false`) so compliance/publish read it unchanged. The one judgment layer = augmenting a derived
motion.json's `overlays` with word-anchored devices (never hand-editing derived timing; re-derive instead).
**E2E fixture proof:** a 5-shot 16:9 piece (real word timings — cuts on words, a 3-shot stage arc, a
placeholder, an overlay) rendered in 7.5s + a 2-shot 9:16 short (no VO → estimate fallback) in 3.6s.
**Known issue for Phase-3 layers:** rembg cutouts soft-matte thin details (a character hand half-eaten) →
needs an alpha-threshold pass + a cutout QC gate; layered compositing stays gated on the Poyais dogfood.
JSON2Video Pro is never purchased; removing the legacy path is a follow-up after video #1 ships on Remotion.

**2026-07-08 — STILL-SIDE VISUAL AUTHORING REBUILT (VPW generator fix + two fresh-eyes check layers).**
The first rendered slice (`_chain-test`) exposed systematic still-frame defects; root-cause review traced
them to five causes, not twelve bugs — chief: **VPW authored animation for a retired renderer** (Pattern
A/B; its own law said "compose `still_prompt` *to move*") and composed stills as freeze-frames of imagined
motion (mid-stride characters), plus no fact/acting/casting discipline and gates that couldn't count.
**Fix followed the project's proven pattern — change what the generator produces, then net with independent
checks; no per-defect rule piles.** (1) `visual-prompt-writer` rebuilt in place: Remotion-reality mental
model (author intent, never mechanism; the renderable set = still + one camera arc per stage + overlays +
changes AT cuts) + six laws — **held tableau** (a still must read deliberate when frozen; freeze-of-motion
is broken output), **scene facts** (prompts state checkable load-bearing facts — layout/facing/targets —
"a stranger could verify the image"), **acting layer** (expression per beat), **casting pull-through**
(named figures incl. inside diegetic media route through the registry; costume pinned as identity),
**delta decisiveness** (world-flips flip fully), **hook-frame bar** (scroll-stop standard). `motion_prompt`/
`asset_type` retired to legacy; `ken_burns`/`within_shot_motion` FROZEN pending the motion-teardown's
intent-taxonomy enum. (2) **Pre-gen shot critic** (VPW Step 8, `references/critics.md`): fresh subagent, six
generalized questions, findings-only, author edits, before any gen tokens. (3) **Post-gen scene gate
extended** to taste + **prompt-fidelity** ("every stated fact realized, nothing extra") and the rig gate
now verifies countable invariants **at counting scale** (per-hand crops — a whole-frame look provably
passes 5-fingered hands). MacGregor's canonical re-registered (user-picked red/gold, ear-free, tan) with
costume pinned. **First live critic cycle validated the design:** a fresh-context VPW run on the slice
produced a strong 16-shot plan AND the critic caught 10 real plan-level defects pre-pixels (a mirrored map,
a continuity contradiction, a chain-breaking reframe, 6× unrenderable in-frame pops — that pop-reflex is
the documented gap the motion taxonomy must close). Validation's image-gen half pending user go. Spec:
`docs/superpowers/specs/2026-07-08-still-side-visual-authoring-rebuild-design.md`.

**2026-07-08 — MOTION+AUDIO GRAMMAR MEASURED (the teardown cycle) → three homes + fixed-POV camera law.**
Ran the planned frame-burst teardown (3–4fps windows, easing from frame spacing, cut lists from
scene-detection, audio from loudness traces + Gemini listening) over the approved set: Crayon ×3 (the
base — every video extracted TWICE independently by parallel runs; all headline claims converged, 6/6
frame spot-checks PASS), HeyHistorically Disappeared-8× (13 events + measured stats), OverSimplified
Prohibition 2nd half (13 events), Kurzgesagt (entrances/type, aspirational). Honest gaps: Pirates +
Prohibition 1st-half extractions lost to session-limit crashes (logs absent); Rockefeller's audio rollup
came from the parallel run. ~90 verified events + ~1,000 measured cuts total; logs + method + frame
evidence in `channels/the-second-take/visual-kit/research/motion-logs/`.
**The grammar in one line: the camera is furniture; the ELEMENT layer is the life; the cut is the verb.**
Key measured rows: camera locked by default (cards ALWAYS dead static; pictorial holds carry only a
0.3–1.5%/s micro-drift floor; overt moves = motivated single crawls, whips only inside montages/dialogue);
entrances pop>type-on>slide with 0.3–0.5s spring settles, each landing ON its spoken noun (fades
near-banned, reserved-meaning only); text always animates at speech pace (~12–15 chars/s story) and is
never a burned caption in the studied 16:9 grade (all diegetic or deliberate cards); held sets evolve
LIVE, never cut-to-changed-state (unanimous across every video — the Phase-2/3 layer-move evidence base);
numbers are sold in-world via dip→riser→carrier-prop→hit-on-the-word→contrast cut; hard cut ≈ 99–100% of
seams with ≤2 reserved-meaning devices/video; audio = one flat bed (LRA ~3.5 LU) + texture stings/LF booms
at chapter cards + sub-second −40dB dips as the ONLY silence (on gravity words; music THINS + SFX withheld
on human cost — the audio mirror of the register dial); SFX density is a FORMAT dial (story 4–20/min,
explainer ≈ zero). **Routed:** `universal.md §13a-iii` (the measured law + the beat-type→treatment
taxonomy VPW's frozen fields were waiting for) · `visual-grammar.md §4` + `motion-tokens.json` (channel
dials: story mode, long-form burned captions OFF — reference grade has zero; shorts keep them; red = only
emphasis ink; camera drift/type-on/entrance values + future audio-layer values) · `build_motion.py` +
`motion-schema.md` (mechanical: cards frozen, **fixed POV unless motivated [user-directed] — overt arcs
only on peak beats, one arc per stage, drift floor otherwise**, captions dial read from tokens; all three
paths dry-run-verified on a chain-test fixture copy). **Engine font LOCKED same day = Ink Free**
(user-picked from 5 local faces rendered in the real engine frames; styles engine-drawn text only —
in-image diegetic lettering stays style-bible territory). **Follow-ups named:** wire the §13a-iii
beat-type enum into VPW/shots.json/lint (unfreezes
`ken_burns`/`within_shot_motion` replacement); the engine audio layer from the measured audio grammar;
A/B the grammar on the 56s slice → motion gold exemplar; optional re-extraction of the 2 lost logs;
shorts (9:16) motion grammar unstudied — inherited from long-form until a shorts pass.

## 2026-07-09 — Pipeline governance audit + fix pass (motion ⇄ image-gen/VPW seams)

Ran a read-only audit of the two visual-pipeline subsystems (built in separate terminals) — the Remotion
motion side and the image-gen/VPW still side — across every governance file (skills, scripts, engine,
schemas, style-bible, visual-grammar, registry, universal §13a), cross-traced against the real `_chain-test`
artifacts. ~50 findings; applied all but the deferred `beat_type` seam via in-place edits (no tacked-on
rules). Findings + edit plan archived in the session scratchpad (`audit/MASTER-findings.md`).

**Highest-value fixes:** (1) **root cause of the prior image-gen problems found** — the **pro tier
(`gemini-3-pro-image`) now returns JPEG, not PNG**, and the pipeline assumed PNG everywhere; `forge.py` now
transcodes JPEG→PNG at the single entry point (needs Pillow) + validates bytes/magic BEFORE writing, killing
the zero-byte-survivor bug (`open(...,"wb")` truncated before the gen call). (2) `render.py` now treats a
sub-1KB/non-image scene file as MISSING and **reads the scenes `manifest.json` as a real gate** (hard-fails
on missing entry / `verified.scene|rig != true`) — previously it mapped by filename and ignored `verified`,
so a gate-failed or 0-byte scene rendered. (3) **Ink Free embedded** in the engine (base64 data URI, survives
the per-video `publicDir` override) + fail-loud font assertion — was silently falling back to Comic Sans on
any non-Windows host. (4) `lint_shots.py` now runs its HARD `vo_ref` check against the **real VO
`word_timings`** (the stream render times against), not just `script.md` tokens; added Σduration/shot-count
(stretch-to-fill kill) + stage-cap HARD gates. (5) device cards resolution-scaled (were fixed-px, overflowed
on 9:16 shorts); per-second drift floor; overlay collision stagger. (6) Doc reconciliations across both
terminals: `ken_burns` documented as "authored always, consumed only on peak beats" everywhere; `render_engine`
canonical manifest key; shorts scene-prefix unified; style-bible §4 **Accent `#d7402b`** pinned as the single
source of truth for in-image AND engine red; §10 refreshed (MacGregor registered); registry `environments[]`
removed (assets-with-kind is the one home); orphan `refs/house-person.png` deleted.

**Deferred (own follow-up): S6 — the `beat_type` seam.** §13a-iii names "VPW authors the beat type" but gives
no field name / no enum / no cardinality (and no row for a plain narrative shot) — the reason
`ken_burns`/`within_shot_motion` stay frozen. Landing it is a net-new contract across universal.md + VPW +
lint + build_motion + image-gen; kept out of this bugfix pass by design. Sketch in the audit findings.

**Verified green:** lint on `_chain-test` (HARD none), `build_motion --dry-run` (16/16 scenes through the new
gate, 56s/163-word per-line timing), engine `tsc` clean, forge CLI + crop/place/manifest smoke-tested. Docs
read end-to-end for cross-terminal coherence. **Not yet proven on a fresh generation run** — next: a full
`_chain-test` slice (VPW → image-gen → VO → render) with a human gate at every deliverable.

## proxy-judge ("taste me") built + PAUSED; a pipeline-simplification finding 2026-07-09

Built a new **`proxy-judge`** skill (branch `feat/proxy-judge-story-editor-me`, not merged): a fresh-context
proxy of **how Daniel judges** a finished long-form `script.md` — an additive acceptance GATE after
`humanize` that renders accept/revise/reject + `/36` + substantive redirects, imitating his content
preferences (not voice). Facet-agnostic harness; v1 = the story facet. Reuses the existing
rubric/critics/grammar; adds the missing acceptance verdict + a **calibration answer key** (41 entries: gold,
§5 bank, git-history first-draft→gold transforms, 17 transcript-mined uncodified judgments, 3 session-note
prefs). Tasks 1–6 done + tested; Task 7 proof: **verdict agreement 3/3 across held-out drafts**, substance-
match a **converging long tail** (tuning on one draft's lessons demonstrably generalized to the next).

**PAUSED before freeze/integrate.** Two open threads (full detail + resume checklist in
`docs/handoffs/2026-07-09-proxy-judge-and-pipeline-simplification-findings.md`):
1. **proxy-judge:** validate on ≥1 GENUINE end-to-end pipeline draft (HO-2/HO-3 were subagent-written from
   inline facts, off-distribution); bank the round-2 prefs; upgrade `score_agreement.py` to semantic matching;
   then decide freeze+advisory (living-calibration loop) vs. more rounds.
2. **Pipeline-simplification finding:** the two off-pipeline drafts (one subagent, grammar + inline facts, NO
   deep-research / staged writers-room / critics / humanize) came out **near-perfect on craft — possibly better
   than the full pipeline**. Hypothesis: the staged writers-room (and maybe research depth) may be
   over-engineered vs. a strong single grammar-guided pass. Caveat: facts were curated (accuracy/leash NOT
   tested), so the finding is about CRAFT, not research/accuracy. Revisit with a clean A/B (full vs. lean) on
   one topic, scoring craft AND accuracy — which doubles as the real-pipeline validation above.

## 2026-07-09 — image-gen: pre-baked environment library → characters-only Pass 1 (quality fix)

Mid-validation on the `_chain-test` slice, the two-pass image-gen model was judged to be degrading final
quality: **Pass 1 pre-generated a full per-video asset library including environment/prop PLATES, and Pass
2 assembled each scene by multi-seed compositing those plates + characters + props.** The failure mode: an
environment generated in ISOLATION commits its lighting, perspective, and negative space blind to the
figures that must live in it, so it fights the composite (the off-compositions in the prior run — elements
outside the frame, figures fighting plates). The underlying principle: **a character is a *portable
identity* (isolated clean canonical = the right anchor to seed from); an environment is *not portable*
(only makes sense as part of a specific shot's whole image).**

**Change (surgical, functionality-preserving — NOT a rebuild):**
- **Pass 1 = individual recurring CHARACTERS only.** Environments, props, plates, and crowds/ensembles are
  no longer pre-generated. (A channel-SIGNATURE element recurring across MANY videos is still a deliberate
  cross-video build via the §7 standing kit — never a per-video default.)
- **Pass 2 = each scene generated as ONE complete image:** seed the character canonical(s) present; the
  environment + props are DESCRIBED in the delta and composed in the same gen (never seeded from a
  pre-baked plate). Technique (c) "plate-first" retired → repurposed to "character-free scene."
- **KEPT verbatim in function:** frame-to-frame delta-chain seeding (held stages: base + ≤3 delta, seed
  the prior frame), both gates (rig + scene), the forge `diff` held-set gate, the character reuse-index,
  model tiers, aspect/crop. Held-set continuity still comes from delta-chaining, not from a shared plate.
- No long-range non-character reuse across gaps (a shot wanting a non-character element from many shots
  earlier is generated fresh — [user-directed], explicitly not built).

Edits: `image-generation/SKILL.md` (Pass 1 scope, Pass 2 technique menu, reuse index, worked examples) +
`style-bible.md` §5/§7/§8 (seed rules, standing-kit scope note, scene-assembly step). `forge.py`, VPW, and
render-builder unchanged. Coherence-swept for orphaned plate-seeding instructions (clean). Validated next
by re-running the `_chain-test` slice image-gen on the new flow. (Both docs then curate-doc'd in place — de-duped cross-file rationale, positive-framed
prohibitions, removed changelog-in-body language; all LOCKED style-bible values + section anchors preserved.) **VALIDATED 2026-07-09:** full `_chain-test` slice rendered end-to-end on the new flow — fresh VPW (18-shot plan) → characters-only image-gen (18 scenes + 3 thumbs, environments composed in-scene, delta-chains held, text verbatim, no JPEG/zero-byte failures) → 56.2s render. Also fixed a real render gap: `render-video.mjs` now caps concurrency + widens the delayRender timeout (full-length renders were OOM-ing a Chromium tab). **Open soft flags (rendered as-is, user's call):** a SYSTEMIC staging-law gap — staged-interactions (L16/L17) don't force eye-line convergence / equal height; L18 recompose is weakest; L12 seated→standing reveal jump. **Not yet built (deferred, then re-render this same slice):** the engine SFX/audio layer, T2 device cards, and burned captions.

## 2026-07-09 — Base-rig library refreshed + the hand-count rule hardened (real fix + the gate that was failing)

Refreshed The Second Take's standing base-rig character kit (the channel's reusable expression/action
library) on user direction, and — surfaced by it — fixed a real hand-digit defect that the gate had been
missing.

**Library edits (user-directed):** regenerated `annoyed` (was reading as angry), `fear` (dropped the
sweat-bead cliché), `talking` (calmer resting brows), `shrug` (simple mouth + brown outfit, was cream),
`walk` (hands down). Replaced `thinking` with an in-character contemplative (no cartoon chin-scratch) and
`despair` → **`crestfallen`** (milder somber — register stays off full human-cost wailing). Added
expressions **eye-roll, laughing, caught** and actions **power-stance, salute, thumbs-up, thumbs-down**.
Removed **lean-point + recoil** (broke the flat 2D plane — no foreshortening/gestures at camera). **Scrapped
money-rub** (the cha-ching gesture never read cleanly). **Final library = base + 18 expressions + 13
actions**, all registered into `refs/base/` + `registry.json`.

**The hand fix (the portable learning).** The 2026-07-08 "hand count LOCKED at 4 digits, no regen needed —
the base already renders four digits" claim was FALSE: the standing library was never hand-audited, and
**open / spread / raised-hand poses drift to 5 digits** (4 fingers + thumb) while hands-at-sides correctly
inherit the base's 3+1. Two failures, two fixes: (1) **generation** — the §2/§2b descriptors now name the
*classic 3-finger cartoon hand (Mickey/Simpsons)* prior (renders 3+1 far more reliably than fighting the
engine's realistic 5-finger default), plus a harsh per-frame "exactly 3 fingers + 1 thumb, no fifth digit"
clause for stubborn open hands; (2) **gate** — bible §3 + the image-generation skill now MANDATE native-tile
counting (`forge crop --regions auto`) or a counting subagent, and forbid counting on a downscaled montage,
which *passes* 5-finger hands (proven twice — the chain-test and this audit). The whole library was audited
and every open-hand offender regenerated + verified 3+1. **Reviewer-eye counting proved unreliable** (I
over-claimed a 3+1 pass on salute/money-rub that were actually 5): the reliable loop is harsh generation
enforcement + **the human making the final finger count off zoomed-crop artifacts**. Bible §10 provenance
corrected. (The `forge.py` pro-tier JPEG→PNG transcode also resurfaced here — already logged in the
2026-07-09 audit entry above.)

## 2026-07-09 — finger-count is a HUMAN gate, not an agent grind

> **SUPERSEDED 2026-07-09 by "checking slimmed to one batched review" (below).** The hand-crop
> checkpoint described here was removed — it was a source of the check-time blowup. The 4-digit
> invariant still stands (enforced in the §2 descriptor); the count is now just one thing the batched
> identity/rig review looks at in the full frame, residuals flagged for the human artifact. **No hand crops.**

Slimmed the hand-digit check in `style-bible.md §3` + `image-generation` gate 1: the **4-digit rig invariant
stays** (enforced in the §2 descriptor), but the COUNT moves off the agent onto the human — the skill now
surfaces a native-scale hand crop (`forge.py crop`) at the review checkpoint and the human glance-counts;
agents no longer forensically count every hand (slow + my own cartoon-hand count is unreliable). A whole-frame
view passes 5-fingered hands, so the crop is the catch, the human is the authority. [user-directed]

## 2026-07-09 — image-gen checking slimmed to ONE batched review

A full `_chain-test`-scale image-gen run (~20 shots) was taking ~30 min, most of it **re-checking images
that were already fine.** Root-caused to three overlapping gate layers (per-image rig LOOK grind +
per-batch scene gate + per-delta held-set diff-gate + a hand-crop-and-count sub-procedure) **plus a
finger-check self-contradiction** ("the human is the authority, don't grind a subagent" vs "the gate
MANDATES native-tile counting or a counting subagent") bred by **cross-file duplication** — the rig gate
was fully specified in BOTH `image-generation/SKILL.md` and `style-bible.md §3`, so the two drifted into
conflict and agents resolved it by doing everything, repeatedly.

Fix (brainstormed + spec'd + rebuilt-in-place): **ONE post-gen batched review** — 3 concurrent agents
(**identity/rig · fidelity · style/taste**) over the whole batch, each returning a flagged list — with
**retry-2-then-flag** (regen a flagged frame ≤2×, self-check only the flagged points, then keep-and-flag
for the human artifact). The **human artifact review (full frames, flagged ones marked) is the final
authority**; **no hand crops** anywhere. Finger correctness rides on the §2 descriptor (generation-side).
Split of ownership: the **skill owns the procedure (HOW)**, portable to any channel; **bible §3 is the
values-only rig checklist (WHAT)**. Generation flow, technique menu, and the §2/§2b descriptors are
unchanged — we removed redundant automated re-checking, not the quality bar. Same-day cross-file sweep
confirmed no surviving contradiction. Spec:
`docs/superpowers/specs/2026-07-09-image-gen-checking-slim-design.md`; plan:
`docs/superpowers/plans/2026-07-09-image-gen-checking-slim.md`. [user-directed]

## 2026-07-09 — all image generation moved to pro; flash tier removed

Two fresh validation runs of the slimmed checking (a campaign-route map + the poyais-promise delta chain)
exposed a generation-side finding, not a checking one: the cheaper **flash** tier (`gemini-2.5-flash-image`)
renders the **off-recipe soft-gradient "sticker" look with no `#241a12` outline** and mangles baked text
("Natienal Bank"), while **pro** (`gemini-3-pro-image`) holds both. Cost check (verified pricing): pro is
**$0.134/image** at our 2K tier vs flash $0.039; a full **8–15 min** video is ~70–130 scenes → ~120–180 gen
calls with retries → **~$15–30 all-pro** (I had earlier mis-estimated ~$8 off the 66-sec, 18-shot fixture —
corrected). At the current 1-video/week cadence that's ~$80–90/mo — immaterial vs a monetizing finance video.

Decision [user-directed]: **make pro the ONLY engine.** Deleted the tier system entirely — the skill's
per-technique `pro`/`flash` tags + the "Model tier" bullet, `style-bible.md` §8's "Model tiers" block, and
`forge.py`'s `--model` arg + pro/flash alias resolution + `engine_flash`. Every call now routes to the single
registry `engine` `gemini-3-pro-image`. **Side effect:** this also kills the mixed-tier-in-a-chain drift the
chain run surfaced (a delta chain can no longer switch render style mid-set). **Defer** a cheap tier until a
daily autonomous cadence makes the premium material — and then use the **Batch API** (half price, 24h) rather
than flash. Cost model logged in `stack.md`; provenance in `style-bible.md` §10.

## 2026-07-09 — production batch started: front-half pipeline on backlog ideas, one video at a time

Kicked off real production (not a test) on the front-half pipeline (research → long-form → metadata;
**shorts-writer skipped this batch**, idea-generator skipped — picking from the existing ranked backlog).
Running **one video at a time, fully, with a human checkpoint after every step** (Stage-0 gate; also the
first real generalization test of the rebuilt writer beyond Poyais, so gated tightly). First video =
**ST-004** "The Backstreet Boys Were Built to Hide a Fraud" (Lou Pearlman), slug `2026-07-09-pearlman`.
**Next up:** ST-006 (bricks-as-hard-drives). Idea selection favored A/B cold-start anchors and skipped
the C-tier obscure anchors (ST-003, ST-010) per the backlog's launch-sequencing note; the four-video
intent spreads across mechanisms/eras to satisfy the inauthenticity rule. **Thread B (staged-vs-lean
writers-room) explicitly scrapped for now** — pipeline runs as-is. [user-directed]

## 2026-07-09 — length/density norm rebalanced: ~10-min center of gravity, not terse-first

The storytelling-grammar's dominant framing ("compress hard," "economy governs," "never padding," "uses maybe
half the ledger," "a sentence or two and go") plus the writer's "a line with zero info is filler" tilted the
whole system toward **terse-by-default** — produce concise, add detail back only if short. A fresh Pearlman
draft came in at ~7:20 as a result. Corrected the framing **in place** (no stacked rules, no new do-nots):
grammar **§2.2** now "select by story value; **develop what you keep**" (names the race-through-a-beat miss as
equal to the cram miss); **§2.3** sets a **~10-minute center of gravity — soft, wiggle room, explicitly NOT a
target to pad toward or compress below** (a well-under draft means under-developed beats, not missing filler);
**§2.5** flips the calibration to name *too-terse* as the miss we correct most (lean toward color), while
keeping the color-vs-dwell distinction and the anti-dwell brake. `long-form-writer` Step 4 length line synced
to the same center so grammar and skill don't disagree. dna's "8-15 min primary" already contains ~10, left
as-is; the gold (Poyais, ~1,400 words / ~8-9 min) is now the lean floor, not the target. [user-directed]

## 2026-07-09 — coherence layer added to the writers-room + relational facts to research

A naive-viewer readthrough of the Pearlman draft exposed a comprehension defect the existing critics cannot
see: the story built the airline / savings-account / bands without ever establishing how they connect (root
cause: the connective fact that Trans Continental was the umbrella over *both* the bands and the fake airline
was never in `research.md`). Fixed as SYSTEM logic, not a one-off script edit, mirroring the taste-critic
architecture (the writer can't catch its own coherence gaps because it knows the connections in its head):
- **grammar §3.8 (new):** "non-linear, but followable" — keeps every non-linear device (§3.1/§3.3/§3.7), adds
  the bar that a first-time viewer can follow the causal through-line (introduce-before-use; establish
  connections before depending on them; structural fixes over add-on sentences).
- **`long-form-writer` Step 3a:** the spine must be read-cold followable.
- **`critics.md`:** a third parallel **coherence critic** (first-time viewer; flags only *unearned* confusion,
  never non-linearity/suspense; tags findings [LOCAL]/[STRUCTURAL]) + routing: [LOCAL]→editor, [STRUCTURAL]→one
  **capped** writer structural-revision pass (leashed) → single re-verify → human if still bad. Taste/leash stay
  subtractive; coherence is the one additive/structural lane.
- **`research-contract.md`:** the fact ledger must capture **relational/connective facts** (ownership, cause,
  identity, sequence-dependency) as sourced entries, not just atoms — with the firm-division guardrail (state
  relationships as they exist in the world, never as a narrative order/frame; the writer still owns story
  design). Fixes the upstream root so the coherence critic bounces less.

Discipline held: one concept = one home (no cross-file duplication), DO's changed rather than do-nots stacked.
Also this session: the length norm was rebalanced to a **~10-minute center of gravity** (was terse-first; see
the entry above). Live test pending: Pearlman research top-up (the umbrella fact) → scriptwriter re-run through
the coherence layer. [user-directed]

## 2026-07-09 — shot composition variety: make the class DRIVE composition

The generated Poyais shots were monotonous (characters same-size, centered, literal; flat repeated
expressions). Root cause (from reading the authoring flow, not asserting indiscipline): `universal §13a`'s
shot-class table already carries each class's composition (comparison → physicalized-imbalance/relative
size; relationship → staged-interaction: handshake/linked-arms/tug-of-war; etc.), but `VPW Step 2.5`
recorded the class as a TAG and then staged a generic centered shot — proof: L18 (`physicalized-imbalance`)
executed its class → the good scale shot; L16/L17 (`staged-interaction`) didn't → two figures parked. Also:
expression was decided (step 5) but not a STATED fact (step 6) so it never reached the prompt; and
composition was double-authored (VPW `still_prompt` + image-gen "placement/depth").

Fix [user-directed], all DO's, no new rules/field/taxonomy/checkpoint: (1) `VPW` — the class must DRIVE
composition (step 2) + framing/scale + expression become stated facts (rule 5, step 6); (2) `visual-grammar
§2` rebuilt as **payload-driven composition guidance** — composition is a decision driven by the payload,
vary the axes (scale/character-sizing, angle, literal-vs-symbolic); the class stays a *suggestion* (its
range lives in §13a — not duplicated), a centered shot is still valid, the goal is variety across the video;
(3) `image-generation` + `style-bible §5/§8` — image-gen EXECUTES the still_prompt's framing, stops
re-composing (VPW owns composition, authored once); (4) `style-bible §6` — diegetic art renders flat-cel.
`universal §13a`, the shots schema, and the pre-gen critic are untouched. Enforcement is the guidance +
a **gold exemplar** to be minted later (deferred — re-author + regen a slice, user approves, it becomes the
reference); the image-gen review-reliability gap (a nose slipped) is a separate follow-up. Deliberately kept
NON-determinative (no "class = framing" formula — that would trade one monotony for another). Spec/plan:
`docs/superpowers/specs|plans/2026-07-09-shot-composition-variety*`.

## 2026-07-10 — `beat_type` seam built: one signal drives camera + audio; camera drift fixed; V3 register (partial)

Built the `beat_type` seam (spec/plan `docs/superpowers/plans/2026-07-09-beat-type-seam-camera-and-audio.md`).
**One authored field replaces two frozen ones** and drives motion + audio from a single measured signal.

- **Enum codified — ONE home.** `universal.md §13a-iii` is now the single source of truth: a 12-value slug
  enum (11 measured treatment rows + `narration` default). Mirrored by `lint_shots.py::BEAT_TYPES` (HARD-checked)
  and the camera/audio derivations. `visual-prompt-writer` authors it per shot.
- **DELETED, not demoted:** `ken_burns`, `within_shot_motion`, `motion_prompt`, `asset_type` (schema + VPW +
  build_motion). The only reader left is the legacy JSON2Video path in `render.py`, which degrades to a locked
  camera on an absent hint — matching our new direction, so nothing breaks. Net authored fields **−4 +1 = −3**.
- **Camera drift bug FIXED (the visible win).** `build_motion.py::camera_from_beat_type` is **locked by default**
  (`move: none`); ONLY `gravity` (slow push-in) and `escalation` (micro-push) move — straight from the measured
  table. Killed the old `camera_from_ken_burns` that pushed 18/18 shots. On `_chain-test`: 1/19 moving (the one
  gravity beat). **Reference channels DO move the camera, but rarely + motivated (§13a-iii.1) — so this keeps the
  motivated motion and kills the aimless kind** (Option B, user-approved). Whip entrance now fires only on `dialogue`.
- **Idle bob/breathe OFF for The Second Take** (`motion-tokens.json idle.bob_px:0`, user-directed). The camera is
  furniture AND frames hold dead-still; life comes from hard cuts + element/overlay animation + the rare gravity
  push. Kept as a channel token (like `caption.enabled_long_form:false`) — the engine keeps the capability.
- **`beat` KEPT (demoted).** Audit (both code + docs) proved `beat`'s only live job was the camera gate, which
  `beat_type` now owns — but `beat` (narrative position) is a *different axis* from `beat_type` (treatment) and
  from `narration_type` (content), so it survives as authoring/review metadata, not deleted. Deleting would have
  conflated axes + contradicted every spec.
- **V3 register audio — the audible part shipped.** `build_audio.py::register_audio` reads `beat_type`: `gravity`
  → a sustained bed `thin_span` (audible under VO — confirmed by ear at 23s on the slice) + SFX withheld;
  `dialogue`/`aside` → SFX recede. **DEFERRED (not emitted, so we never ship an inaudible effect):** (a) the
  **number-reveal DIP** — a bed-only dip under our wall-to-wall VO is masked; the measured dip→number-in-the-gap
  needs a real VO pause = the **transition-breath** workstream; (b) the **chapter-boundary bed TRACK-CHANGE**
  (`music_states`) — needs the engine to switch beds mid-piece.

**Deferred follow-ups logged here so they aren't lost:**
1. **Four-taxonomies-per-shot audit** — `beat` + `beat_type` + `narration_type` + `shot_class` (three are not
   code-consumed); check for real redundancy as its own pass.
2. **Dead JSON2Video render-path teardown** in `render.py` — remove `ken_burns_to_motion` + the Pattern-A inline
   render, keeping the shared timing/scene functions `build_motion` imports.
3. **Engine bed-switch** for `music_states` (chapter track-change).
4. **Transition-breath** workstream — authored VO pauses → real silence → the number-reveal dip (and whoosh/cut)
   land in the gap. Highest-leverage pacing fix; owns the deferred number-reveal dip.

Discipline held: one enum home, DO's not stacked DON'Ts, deleted-not-zeroed cruft, cross-file consistency swept.

## 2026-07-10 — Transition-breath (A1): beat_type is now the control layer over the music

Built the render-time **transition-breath** (plan `docs/superpowers/plans/2026-07-10-transition-breath-beat-type-driven.md`),
the first piece of "beat_type controls the audio track." Layered, not a rewrite of the pause system.

- **Prosody KEPT, breath ADDED (separate layers).** The writer's `[PAUSE]`/`[BEAT]` markers stay baked in the
  VO (voiceover untouched, no `shots.json` dependency). The **breath** is a distinct, render-time,
  `beat_type`-driven silence gap — decided after an A/B proved the natural voice's pauses must stay (they carry
  the prosody), so the breath sits *on top*.
- **Mechanism (`build_motion` → `breath.py`).** For a breath-beat shot (`number-reveal`, `chapter-boundary`),
  find its first VO word via the shared `render.py` matcher, splice `breath_s` of silence into a **derived
  `vo.breath.mp3`** (original `vo.mp3` untouched), and **shift the word-timings ONCE** — every downstream
  consumer (retime, captions, `build_audio`) reads the shifted list. **Frame-hold is automatic:** the preceding
  shot's duration = the gap to the next anchor, so it expands to cover the silence (verified: L18 6.43→7.33s).
  Config is one knob: `audio-tokens.json breath_s_by_beat`; intent in `§13a-iii`.
- **The number-reveal DIP is re-enabled** (was deferred for lack of a gap): the bed cuts to near-silence across
  the breath — measured **−55.8 dB in the gap vs −28 dB** normal.
- **BED-TILE loop bug found + fixed (affects the whole audio layer).** The bed was a 31s `<Audio loop>`;
  Remotion's per-frame `volume` callback gets **loop-relative** frames, so *any* bed modulation (dip/thin/cut)
  past the bed's length silently misfired — the dip at 51.6s fell in loop 2 and never fired (the gravity thin
  only worked because it's at 23s, loop 1). Fixed by **tiling the bed to ≥ the video length** at render, so the
  loop never engages and the volume timeline is absolute. This fixes ALL bed modulation, not just the dip.
- **This is the foundation.** The proven primitives — beat_type-driven gap of a table-driven length · frame-hold
  · correctly-timed audio modulation (cut/dip) anywhere — are the control layer. The rest is additive on them:
  **fade** = a ramp shape of the dip; **swap/track-change** = `music_states` (deferred, needs an engine
  bed-switch); **buildup SFX** (riser/boom/hit in the gap) = **A2** (SFX-pool expansion). Not new mechanisms.

**2026-07-10 — Front-half batch: 4 more videos scripted (Bricks, Nauru, Silver, John Law).**
Ran ST-006 (MiniScribe), ST-008 (Nauru), ST-012 (Hunt silver), and ST-028 (John Law) each fully through
idea→research→long-form→metadata, one at a time, shorts skipped. All at the user review gate (with ST-004
Pearlman). Pipeline behaved: each = LIGHT/LIGHT+ research → staged writers-room → lint (clean) → 3 parallel
critics → in-voice editor → humanizer (clean each time). The critic layer caught real defects every run
(e.g. Silver: the close dropped the "deliverable silver" qualifier + the exchange conflict was asserted
before attribution + the price *crash* was never causally bridged; John Law: the inflation mechanic was
asserted as a known rule, fixed with a plain "more paper = each note buys less" bridge). Length norm held
(~8:20–9:42). Resume: `docs/handoffs/2026-07-10-fronthalf-batch-and-idea-expansion-pickup.md`.

**2026-07-10 — Idea backlog expanded 10 → 28, broadened past fraud.**
Three `idea-generator` runs (ST-011–016 classic frauds/manias/blowups; ST-017–021 Wirecard/McMillions/Ratner/
South Sea/Beanie; ST-022–027) plus hand-added ST-028 (John Law). Batch 4 deliberately broke out of "just
frauds" into the channel's FULL scope (a legendary legal trade, an absurd cartel heist, a market-mechanism
glitch, a what-is-money reveal, a business blunder, a monetary collapse) — the channel is money-*stories*,
not just cons. Reason: variety of mechanism/era protects against the July-2025 inauthenticity rule and widens
demand. All briefs are research-niche shape (hand to `researcher` on pick).

**2026-07-10 — Title-clickability doctrine + a 6-title polish pass; TODO to bake into idea-generator.**
Codified the 6 characteristics of a title that hits here (deadpan unbelievable fact · concrete anchor not
abstraction · built-in contradiction · loaded verb · unclosed curiosity gap · front-loaded ≤~55 chars,
declarative). Diagnosed the weak pattern (the generic "The Man Who [did a thing]" frame + flat "…was fake"
enders) and rewrote 6 (ST-001/002/003/005/010/016). Reason: the working titles born in `idea-generator` were
the source of the mid ones. **Durable move still open:** add this checklist to `idea-generator` so titles land
from the start. **Also open:** ST-017/ST-014 share a near-identical "$X that didn't exist" shape (rewrites
proposed, not applied); ST-001's final title still to be settled.

**2026-07-10 — New taste-defect rule: the self-insisting intensifier.** During John Law script review Daniel
flagged "genuinely ahead of its time" — the "genuinely/actually/really/truly/legitimately + adjective" pattern
asserts a judgment the narration should let the facts earn, and usually flags a beat that tells instead of
shows. Baked in generally (not patched in the one file): a before→after row in `storytelling-grammar.md §5`
(so the writer avoids generating it) + taste-critic hunt flag #11 in `long-form-writer/references/critics.md`
(so the fresh-eyes pass catches leaks). Fix = cut the intensifier or show the thing.

**2026-07-10 — Header runtime is now enforced, not optional.** Three of the five front-half scripts shipped with
`Estimated runtime: TBD` and a stale `Target length: 12-15 min` (copied from the idea brief) despite the SKILL
already asking for a computed runtime. Fixed structurally: `long-form-writer/scripts/lint_script.py` now
HARD-fails on a missing/unfilled header runtime and prints the exact `Estimated runtime: MM:SS (N words ÷ 150
wpm)` string to paste (also fixed a divmod rounding edge). SKILL.md now states runtime is REQUIRED (never TBD)
and that `Target length` = the `~10 min center of gravity` norm, not the brief's aspirational band. Backfilled
the three scripts (Nauru 8:46, Silver 8:34, John Law 8:22).

**2026-07-10 — SFX library built via the new `sfx-forge` skill (CC0+CC-BY, CLAP-ranked, human-gated).** Root
problem: the audio layer had one placeholder whoosh; sourcing SFX by hand doesn't scale + I can't judge sound by
ear. Built `sfx-forge` (Freesound search → objective ffmpeg vetting → **CLAP semantic ranking** [the "ear" that
curates so the human only judges finalists] → a two-section audition artifact → `pick` that normalizes/pools/
records provenance). Sourced a **16-role library** (whoosh/riser/boom/boing/record_scratch/cash/sting/womp/pop/
tick/stamp/ding/buzzer/sparkle/thud/powerdown; pluck dropped), peak-normalized to −1 dBFS, wired into
`audio-tokens.json`. **License relaxed to CC0 + CC-BY** (attribution = one description credit line, tracked in
`attribution.txt`; NC excluded; ElevenLabs-gen rejected — already flopped). cash/sting left **provisional** (the
iconic cha-ching + dun-dun-dunnn aren't on Freesound even under CC-BY; swap later from Pixabay). Render hardened
with a **missing-SFX-file defense** (`build_audio_spec(audio_dir=)` drops events with no file, never crashes).

**2026-07-10 — Emission is a SPLIT (malleable, not deterministic) — and it's the next phase, not built.** The
library is largely SILENT: `sfx_events` fires only whoosh (stage) + tick (on_screen_text); comedic SFX have no
trigger, and boom/pop/riser need device-card overlays `build_motion` doesn't produce. Decided: **element-coupled
SFX stay deterministic** (fire on visual events); **comedic/semantic SFX are malleable + opt-in** (an authored
`sfx` hint per shot; `beat_type` + measured density only *suggest*) — because firing the same SFX on every
instance of a beat type kills the comedy. Emission is Phase 2 of the arc below.

**2026-07-10 — Next audio work is ANALYSIS-FIRST (spec + plan committed).** Rather than guess the emission/music
behavior, we measure how reference channels use audio, then build from data. Arc (gated re-plans):
reference audio-analysis → SFX emission → active music lane → V4 checker. Analysis is **audio-only** (cuts can't
be inferred from audio + aren't load-bearing; beat maps are narrative/transcript-derived), **measurement-led**
(`[reliable]` measures load-bearing; transient-density + SFX-identity quarantined as `[directional]` — the
Gemini-hallucination fix: deterministic tools produce numbers, the LLM never "listens"). New `audio-analyzer`
skill: measurement battery (Tasks 1–5) DONE + tested; resume at Task 6 (Demucs precompute). Spec:
`…2026-07-10-audio-reference-analysis-and-emission-arc-design.md`; plan: `…2026-07-10-audio-reference-analysis.md`;
resume: `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`.

**2026-07-10 — Interaction-template spike: two-slot approach VALIDATED (paused before the correct-clasp template).**
De-risked the biggest piece of the character-asset-base expansion (design:
`docs/superpowers/specs/2026-07-10-character-asset-base-expansion-design.md`): a **blank two-mannequin template**
seeded with two canonical identities places two distinct characters into slots (X=left/Y=right) holding the rig,
no costume bleed, on **both 3/4 and full-body**. Three findings that shape the build: (1) **expression is
applied per-character (staged), NOT in one 5-seed gen** — the pot mis-routes/swaps/collapses; production merge =
pre-merge each character+expression then the interaction gen; (2) **clasp anatomy is a template acceptance
criterion** — every spike template rendered a wrong LEFT-to-RIGHT (inner-arm) shake, not true right-to-right;
fix once at the template (left figure reaches across body), verify by TRACING arms shoulder→hand, never eyeball;
(3) **seed, never word-prompt** faces/identity/expression (wording gave featureless faces; true profile also
resists wording). Paused mid a fresh regen on transient API 503/500. Nothing registered/committed; frames staged
in `_staging/` (gitignored). Resume: `docs/handoffs/2026-07-10-interaction-template-spike-pickup.md` → nail the
correct-clasp template → register banker + template → brainstorm + write the full-build plan.

### 2026-07-10 — Reference audio analysis (Phase 1 of the audio arc) — DONE + measured grammar written

Built the **`audio-analyzer`** measurement battery and ran it audio-only over **8 reference videos** (Crayon
×3, HeyHistorically, OverSimplified ×3 [Prohibition + the two top-view picks WW2-p1/ColdWar-p1], Kurzgesagt
as the restrained *floor*). Method: `yt-dlp -x` audio → **Demucs** `--two-stems=vocals` (cached, sequential —
the heavy step kept out of the fan-out) → a deterministic `analyze_audio.py` battery (ffmpeg `ebur128` +
librosa) → per-video `report.json` → `--synthesize` → `synthesis.md`. **Guardrail held: tools produce the
numbers; no model "listens"** (the earlier Gemini teardown hallucinated the SFX inventory — this is the fix).
Every metric carries a `reliable`/`directional` tag; directional (onset density, CLAP SFX-id, narrative beats)
never sets a dial. Logs: `channels/the-second-take/visual-kit/research/audio-logs/`.

**Bugs caught by validating on real content before trusting the fan-out** (not just Kurzgesagt): `parse_ebur128`
was reading a per-frame `−70 LUFS` intro value instead of the Summary block (loudness is load-bearing);
true-peak needed `peak=true`; librosa onset detection saturated the density band (~179→~45/min via a
top-quartile prominence filter); the breath measure washed to 0 (now reports pause-rate + median-pause-*when-
paused* per acoustic bucket, which surfaced the real signal); narrative "act" beats over-fire on gappy
auto-captions (dip-alignment now uses punchlines only).

**Measured grammar written into `universal.md §13a-iii.8`** (integrated — corrected the old "wall-to-wall bed"
claim) **and dials into `audio-tokens.json`:** bed is PLACED not wall-to-wall (~79% presence); ~−18 LUFS / LRA
~3.5–4.5 / references CLIP so **our** master holds TP ≤ −1 (`master_target`, for the Phase-4 checker); breath
trimmed to the measured ~0.55–0.8s (`number-reveal 0.9→0.7`, `chapter-boundary 1.2→0.9`); ordinary dips ~19 dB
vs the reserved −40 full-stop; SFX density ~20–40/min combined (directional); dips on ~⅓ of punchlines.
**`bed_db_under_vo=14` recorded as a CANDIDATE change, NOT flipped** — references keep the bed present (~2–3 dB
duck), so 14 dB likely over-buries, but that's a feel/mix call for a **Phase-3 listen** ([[audio-taste-is-human-judged]]).
**Reframe (user-corrected):** OverSimplified's "negative ducking" (music+SFX+VO dropping together on a beat) is
a WANTED comedic full-stop — the same device as our number-reveal dip, to be extended so SFX drop in the gap
too. Next: Phase 2 (SFX emission) re-planned at its gate using these numbers.

**2026-07-10 — Character asset-base expanded (+19 primitives) + two-slot interaction merge proven.** Grew The
Second Take's standing character kit from solo/front-facing to **19 new registered primitives** (52 assets
total): 6 poses (sit chair-less, facepalm, surrender, whisper-aside, kneel-beg, point-at-thing), 4
angle/movement (back-to-viewer, 3q-turn-right, walk-left/right), 6 object grips (object-agnostic — store the
grip, object is a per-scene generic placeholder), and **3 two-slot contact-interaction templates** (handshake,
handoff, fistbump — blank base mannequins, scene inserts two identities by `cast` order). **Hard rule
established: every pose/angle/grip/interaction asset carries the base NEUTRAL face** — expression is a separate
scene-time seed layer, a baked expression is a build reject (`style-bible §5`). **Learnings:** (a) a *strong
static* 3/4 resists the front `base` seed — the turn only lands with a reason to turn (walking), so `walk-left/
right` are the real turns and a standing 3/4 is weak (true profile stays deferred); (b) **seed exactly off
`base`** for these (proportions + neutral face held, only the body changes) — they are the base re-posed, not
new characters; (c) regen = **fresh from base**, never prompt-accretion or seeding off the prior bad output.
**Two-slot merge validated end-to-end** (MacGregor + banker → registered `handshake` template): correct slots
by `cast` order, no costume bleed, per-character hand tones, **staged-expression order** works (pre-merge each
character+expression, THEN the interaction gen — never one 5-seed gen, which mis-routes). **Bug found + fixed:**
an expression frame is bald-base, so the two-step merge was **stripping haired characters bald** — the
`image-generation` binding template now takes ONLY eyes/brows/mouth from the expression ref, head+hair from the
character ref. Docs: single-sourced across `image-generation` (merge mechanism), `visual-prompt-writer` (slot
convention), `style-bible §5/§7` (neutral-face law + build list). Spec/plan:
`…2026-07-10-character-asset-base-expansion-design.md` + `…-build.md`.

**2026-07-11 — Image-gen seeding: the base-bleed class fixed via attribute-provenance + staging (audit → fix).**
A deep audit (two independent agents CONVERGED — `docs/superpowers/analysis/2026-07-10-character-seeding-merge-audit.md`)
found the merge failures — tone reverting to base cream, hair stripped bald, blank face, wrong-hand clasp, no
eye-line — share ONE root cause: a merge stacks a **bald + cream + neutral base-derived seed**
(`pose_ref`/`expression_ref`/interaction template) alongside the character and routes features in PROSE, but the
engine BLENDS holistically, so base traits win a majority vote (2 base seeds vs 1 character). Fix = a logic
REWRITE, not another clause: (1) **attribute-provenance split** (`style-bible §5` owner; image-gen Pass-1b
executes; VPW unchanged) — from the CHARACTER seed: identity + head tone + hair + costume + face; from the
POSE/template seed: GEOMETRY only (pose, hands, clasp, eye-line); from the EXPRESSION seed: eye/mouth SHAPE only.
This REPLACES the accreted hand-tone / keep-hair / don't-blank clauses (they were each one instance of it).
(2) **§2 stops hard-coding cream** — head tone follows the character's registry `head_tone` (it was asserting
`#f5ead6` as an INVARIANT, fighting tan MacGregor `#d9ac82` even in the clean single-seed path). (3) **Seed
quality + staging** — clean-portrait seed (never a busy scene frame → the measured blank-face) + stage merges
**1-to-1** so a base seed never outnumbers the character. (4) **Eye-line is an ASSET property, PUPILS-only** — regenerated
the `handshake` template so the two figures LOOK at each other; a scene inherits it by seeding (no merge rule).
The eye-line must be **eyes-cut-sideways with the head staying FRONT + round** — a head-turn toward the partner
grows a nose/jaw and breaks the no-nose rig (dogfood v2 did exactly that; v3 fixed it with pupils-only). Noted
in the image-gen interaction guidance.
**Dogfooded on L17** (MacGregor + Bolívar handshake, seeded off the fixed template): tone held TAN (pixel-gated
`#a37856` family vs cream `#f5ead6`), hair/face/costume held, no bleed, they look at each other, clean clasp —
every prior failure fixed. **Residual:** the merge can thin a haired character's SIDE hair, leaving a bare
earless gap → added to the **§3 rig checklist** (verify-gate detection, not a generation prohibition). Kept the
library-seeding approach (no compositing pivot, per Daniel). Plan: `docs/superpowers/plans/2026-07-10-image-gen-seeding-fix.md`.

### 2026-07-11 — SFX emission Phase 2a — DONE (deterministic structural SFX, ear-gated)

Rebuilt the render's SFX emission (`build_audio.sfx_events`) off the REAL signals in `shots.json` (`beat_type`
+ stage/entrance) instead of the dormant device-card overlays that had no producer. Fires on
reliable-every-instance conditions only: **scene change (stage base/whip) → whoosh · delta-chain element-add
(stage_role 'delta' + `enumeration-within`) → pop · chapter-boundary → boom · escalation → thud · text → tick ·
gravity/dialogue/aside → withhold**. The beat_type→role map is DATA (`audio-tokens.json beat_type_sfx`,
ear-tunable). Removed the redundant `chapter-card→boom` (beat_type owns boom); kept the per-element overlay
branches (pop/riser/pluck) as **dormant** (correct trigger, no producer until Phase-2c device-cards). Added the
**synchronized full-stop** (every breath gap dips the bed to silence AND drops SFX; the intended hit lands at the
gap end) and fixed a **multi-breath bug** (a 2nd gap's dip/full-stop fired early by the 1st gap's length — now
uses the shifted breathed-timeline position). 22/22 hermetic tests green.

**Content-nuanced hits are deliberately NOT auto-fired** (the "weird in the wrong spot" failure): the
number-reveal *punch*, `aside`→sting, etc. are **2b authored cues**. Key discipline decided at the ear-gate:
**the audio LOGIC stays general; the specifics come from correct DATA/authoring** (e.g. "poyais doesn't pop"
falls out of the rule requiring a real delta — no hardcoding; "prince pops" is a VPW shot-tagging call, not
audio code). Element-accretion pops use a **stage-stable variant** (consistent within a chain, no in-chain
rotation). **Ear-gate → Phase-3 principles captured in the spec** (dips FADE not cut; a stop = fade→pause→
DELAYED resume, not on the hit; a silence needs a payoff; selective/notable whoosh). Validated on `_chain-test`
(retagged a shot to exercise chapter/escalation, then restored). **Follow-up:** `sfx-forge` normalize should
trim leading silence (done locally to the mp3s this session; a re-source would undo it). **Next = Phase 2b**
(authored `audio-cues.json` comedic layer + a focused author step + an audio critic). Spec/plan:
`…2026-07-10-sfx-emission-phase-2-design.md` + `…2026-07-10-sfx-emission-2a.md`.

**2026-07-11 — SFX emission Phase 2b (authored content cues) BUILT + ear-gated.** The content-nuanced hits 2a
correctly refused to auto-fire now live in a per-video **`audio-cues.json`** (separate from `shots.json` so VPW
stays visual). Each cue `{anchor, role?, pause_s?, gain_db?, in_pause?}`: `anchor` = a verbatim VO phrase
resolved to a word by the **shared `vo_ref` matcher** (a cue = a pseudo-shot; cursor-advancing); `pause_s` → a
silence gap merged into the SAME breath mechanism as the beat_type breaths (one shift; the 2a full-stop dips the
bed); `role` → an SFX event merged into `build_audio`'s stream (inherits density-cap + full-stop + missing-file
drop). New `audio_cues.py`; `build_motion`/`build_audio` wiring; `breath.py`+engine untouched; absent file = clean
no-op. **The number-reveal breath migrated automatic→authored** (removed from `breath_s_by_beat`; it's a content
position, not a structural boundary — chapter-boundary breath stays automatic). **Two refinements the ear-gate
surfaced** (kept because they're general idioms, not one-offs): (1) **`in_pause: true`** — an *interrupt* SFX
(record scratch/buzzer) fires at the gap START, in the silence, before the word drops — vs. the default gap-END
(on-the-word) landing for a reveal/number punch; (2) **sync-by-`vo_ref`** — to land an SFX with a shot's image,
anchor the cue to that shot's `vo_ref` opening words (shots are timed to `vo_ref`), and hold an image by
pure-pausing the NEXT shot's opening words. Hard-authoring model: Claude authors the cues, the human ear-gates
FEEL ([[audio-taste-is-human-judged]]). Ear-gated on `_chain-test` (crash on the fiction reveal synced to its
image + held before the grim turn, scratch-in-pause on the pivot, cash on the number, ding on the trinket).
**Deferred (named):** the **LLM cue-author + audio critic** fast-follow (re-planned at its gate); a genuinely
longer record-scratch = a `sfx-forge` re-source; **Phase 3 music lane** next (dips FADE not cut; stop =
fade→pause→delayed resume; revisit `bed_db_under_vo` by ear). Spec/plan:
`…2026-07-11-sfx-emission-2b-authored-cues-design.md` + `…2026-07-11-sfx-emission-2b.md`.

**2026-07-11 — SFX emission Phase 2b fast-follow (the `audio-cue-writer` skill) BUILT + dogfooded.** The 2b
mechanism is now autonomous: a new niche-agnostic **`audio-cue-writer`** skill authors the content-nuanced
`audio-cues.json` (the number-reveal punch, aside→sting, money→cash, deflate→womp, pivot record-scratch, + the
deliberate WITHHOLDS) so cues are no longer hand-written per video. **Grounded in `shots.json` `beat_type`**
(number-reveal→punch · aside→sting · gravity/dialogue→withhold) + a script scan; each cue anchored to its
shot's `vo_ref` opening words (sync-to-image). Flow = grounded draft → **fresh-context critic**
(`references/critics.md`: restraint/right-role/sync/withhold/no-2a-redundancy) → one revise →
**`lint_audio_cues.py`** hard gate (reuses render's ONE matcher — a cue that won't resolve at render fails here).
**Timid by default** (fewer SFX — not none, not everywhere; the correct failure is too few). It authors
PLACEMENT; the human **ear-gates FEEL** ([[audio-taste-is-human-judged]]). **Dogfood** on `_chain-test`: the
grounded draft independently reproduced the approved cue set, the fresh critic returned "no changes", the lint
passed, and it correctly DROPPED the test-only ding (no signal warranted it) — ear-approved (volume balance a
minor ear-tune, deferred to the Phase-3 level pass). **Caveat:** `_chain-test` IS the gold exemplar, so this
proves the machinery + logic but not generalization — the real test is a fresh front-half topic once it has a
`shots.json` (named follow-up). Registered (skills 11→12; README + CLAUDE.md consistent). **NEXT = Phase 3
music lane.** Spec/plan: `…2026-07-11-audio-cue-writer-design.md` + `…2026-07-11-audio-cue-writer.md`.

**2026-07-11 — VPW "disclosure order" law + Step-8 critic check BUILT (composition-variety gap #1).** The
fresh-agenda-blind Poyais retest showed a character identifiably *before* their authored reveal (MacGregor as
salesman/prince pre-spotlight) with nothing catching it. Fixed as a **7th canonical authoring law** — an image
must not disclose what the narration hasn't yet, **narrow**: fires only on a deliberate setup→payoff withholding
(a character identity, a fate, a twist object/number/place), never on an ordinary first-introduction. Placement =
**both** (matches the skill's author-intent + critic-enforcement pattern for every law): `SKILL.md` names the law
+ states brief authoring intent; the **definition** lives once in the **existing** Step-8 shot critic's
plan-level checks (`critics.md`), joining delta-decisiveness + stage-grouping (no new subagent/pass). Reliance is
on the fresh-eyes critic ([[fix-generation-not-prohibitions]] — a self-checked rule shares the author's blind
spot; the authoring law is cheap prevention only). **Fix direction = re-author the shot/chain with the withheld
entity ABSENT, never obscure** (back-to-viewer/silhouette still puts a recognizable figure in frame). No schema/
lint/image-gen change; nothing generated is invalidated. Cross-file "six→seven" law counts synced (grep-checked).
Validation deferred to the next Poyais VPW dogfood. Spec/plan: `…2026-07-11-disclosure-order-critic-design.md` +
`…2026-07-11-disclosure-order-critic.md`. **Remaining composition-variety gaps: #2 staged-interaction bar, #3
image-gen identity-review hardening.**

**2026-07-11 — Phase 3A music sourcing (`music-forge`) BUILT + RUN; channel music library wired.** The music
lane's sourcing step: a niche-agnostic skill in the `sfx-forge` mold (reuses its `vet.probe`/`rank`/CLAP) that
fetches CC-BY beds → objectively vets → CLAP-ranks → human-audition board → wires `music_pools`. Built via
subagent-driven-development (7 tasks, TDD, per-task + final whole-branch review — which caught two real defects
pre-audition: a `rank()` id crash and a board-stem-vs-pick-filename silent break). **Source decision:** a
spike proved **Freesound is the wrong catalog** (rich in lo-fi/cinematic, empty on the quirky-comedic-production
idiom); pivoted to **Incompetech (Kevin MacLeod, CC-BY)** — direct-mp3-downloadable, has the comedic catalog.
**Vetting lesson (first live run):** the original loop-ability + clip hard-rejects killed 17/18 real tracks —
curated pro music has intros/endings (tail decays to silence) + peaks near 0 dBFS and is NOT a seamless loop,
so vetting is now **minimal** (duration-band + not-near-silent); CLAP + the human ear rank/pick.
**Taste calibration (ear-gate, several rounds):** the default bed must be **wry/dry, NOT cheerful** — sunny
music fights fraud/human-cost stories (matches the register doctrine: default wry, cheerful opt-in). For a
**con-story channel the wry-mischief "sneaky" family IS the workhorse**, not a side-mood. Wired library:
`sneaky` ×6 (Sneaky Snitch/Scheming Weasel/Sneaky Adventure/Marty Gots a Plan/Investigations/Covert Affair),
`upbeat` ×1 (Monkeys Spinning Monkeys), `casual-bed` ×1 (Mining by Moonlight — **PROVISIONAL**: a soloed
audition couldn't pin the wry-not-cheerful base; the real test is under narration, so **revisit the base in
Phase 3B**). Provenance in `audio/manifest.json['music']` + CC-BY credits in `attribution.txt`. Spec/plan:
`…2026-07-11-phase3-music-lane-arc-design.md` + `…2026-07-11-phase3a-music-forge.md`. **NEXT = Phase 3B** (the
lane realizer + a `music-cue-writer` placement layer; also revisit `bed_db_under_vo=14` by ear).

**2026-07-12 — Phase 3B music lane BUILT + ear-gated; flat placeholder bed retired.** The looped
placeholder bed (one file, constant buried level) is replaced by a **placed music lane**. Realizer
`build_audio.build_music_lane` fills `music_states[]` (was a stub); the engine's `AudioBed` is rewritten to
a **`MusicLane`** (non-overlapping per-section `<Sequence>`s, each track pre-tiled to full length so
per-frame volume stays absolute); a new **`music-cue-writer`** skill authors a thin per-video
`music-cues.json` (mood-per-section + `dry` spans) grounded in register + `chapter-boundary` seams →
fresh-eyes critic → `lint_music_cues.py` hard gate (reuses the ONE `vo_ref` matcher). **The lane model —
music drops in exactly THREE cases (spec `…2026-07-12-phase3b…`):** (1) inherited **full-stops** (the −40
breath-gap dip — number-reveal/chapter), (2) authored **dry** spans + every `gravity` shot (auto), (3)
**track switches** between different moods, rendered fade→silence(`track_switch_gap_s`)→fade (NOT a
crossfade — the user's "run track, pause, run next" model). Otherwise music holds a **CONSTANT present
level** while playing. **Two measured behaviors deliberately NOT built (owner taste):** the per-phrase
~2–3 dB VO duck (calm > breathing, per [[camera-locked-by-default]]) and the references' frequent ~19 dB
on-beat dips (absurd as constant pumping). **Dead-path removal (grep-swept):** `bed`/`bed_default`
(`neutral.mp3` never existed)/`bed_db_under_vo`/`duck_spans`/`speech_spans` deleted across build_audio,
build_motion, the engine types+component, audio-tokens, and the motion-schema doc; 5 dead tests dropped.
**Ear-gate on `_chain-test`** (sneaky con-pitch → gravity dry-drop at ~24s → casual-bed backstory): approved
"across the board"; tuned **`music_present_db` 9→7** (9 read slightly too quiet) and **`music_fade_s` in
0.5 / out 0.9** (slightly longer). **Iterate-later (user-flagged):** the FULL music drop on a single
human-cost line reads slightly weird — candidate for a partial-thin (a smaller dip) rather than full
silence, revisit later. `casual-bed` stays PROVISIONAL until settled under a full front-half narration
(named follow-up). Skills 13→14 (`music-cue-writer`). **NEXT = Phase 4** (deterministic audio checker,
warn-not-fail, no model listening — spec `…2026-07-12-phase3b… §9`). Spec/plan:
`…2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md` + `…2026-07-12-phase3b-music-lane.md`.

**2026-07-12 — mastering reconciled + Phase 4 audio checker BUILT; audio arc complete.** Two closing pieces
after 3B. **(a) Mastering reconciliation:** the final-mix master ALREADY existed
(`build_motion.loudnorm_pass`, hardcoded −14/−1.5/11) — the `master_target` token was DEAD config (no
consumer). Wired `loudnorm_pass` to READ `master_target` (single source of truth; parameterized + a new
`--no-loudnorm` flag for A/B tests). **Ear-gated on an A/B** (raw `_chain-test` mix normalized both ways):
−14 read too loud, −15.5 slightly too quiet → settled **−14.5 LUFS / −1.0 dBTP / LRA 4** (real render hits
−14.1). Note: YouTube re-normalizes playback to ~−14 anyway, so the target mainly sets peak headroom +
compression character (the LRA 11-vs-4 difference doesn't manifest on a short already-compressed slice — it
matters on a full dynamic video). Deleted orphaned `gen_audio_kit.py` + `audio_loop.py` (the rejected
ElevenLabs music-gen path). **(b) Phase 4 checker** (`audio_checker.check_audio`, pure + wired post-loudnorm,
writes an `audio` block into `render.manifest.json`): **deterministic, warn-not-fail, NO model listening**
(the audio-analyzer doctrine — FEEL stays the human ear-gate). **Lean scope** (owner-approved): IN =
missing-files (`sfx_missing`/`music_missing`==0), LUFS/TP-vs-`master_target`, register-events-present (a
gravity beat produced a thin_span), music-lane sanity (no segment over a gravity span; `base_db` in band).
**Cut (named, not silent):** SFX↔VO collision (2b cues are intentionally word-synced → false positives),
gain-budget<0dBFS (loudnorm TP-limiter already guards output clip), standalone density (build_audio already
enforces the cap). Its ROI climbs at higher autonomy (Stage 0 ear-gates every render today). Clean on
`_chain-test` (ok:true). **The audio engine is now feature-complete** — production (VO · placed music lane ·
structural + authored SFX · breath/full-stop · register · mastering) + verification (the checker). Remaining
= NAMED follow-ups, not phases: partial-thin on the human-cost drop (the full silence reads slightly weird);
`casual-bed` settle under a full front-half narration; device-card SFX (stat/counter/meter → pop/riser/pluck)
light up automatically when the visual/animation work ships those overlays (the `_OVERLAY_ROLE` map is ready).
Spec/plan: `…2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md §9` + `…2026-07-12-phase4-audio-checker.md`.

**2026-07-12 — LAYERED-MOTION SYSTEM BUILT (the deferred "Phase 3"); camera decoupled from beat_type.** A
shot is now a `plate` + animated element **layers** instead of one flat baked image. Built across 5 phases,
all committed + tested: **(1) contract** — the `animation-menu.json` single-source vocabulary (Family A
cutout: slide/path/bob/appear; Family B engine-drawn) binding planner↔image-gen↔engine, the
`shots.motion.json` schema, and **camera decoupled from `beat_type`** (always locked — its camera role was
near-vestigial and we don't want camera motion; the engine keeps `CameraStage` for a future explicit move;
the whip entrance stays, being audio-coupled). **(2) image-gen** — `forge cutout` (rembg→alpha-harden→trim);
the rembg soft-matte fear was ANSWERED not by fixing the matte but by the architecture — the layered flow
NEVER cuts a figure from a busy scene, it generates the plate empty + the cutout on a clean plate, then
composites (MacGregor's 4-digit hand survives clean). **(3) engine** — `build_motion --motion-plan` merges
layers by id; the engine `LayerView` renders slide/path/bob/appear, unified into `Video.tsx`. **(4)
`motion-planner` skill** — reads `shots.json` → emits `shots.motion.json` (iterable ruleset + subtraction
decomposition + fresh-eyes critic + `lint_motion_plan.py` + human gate; timid-by-default; authors
PLACEMENT, human gates FEEL). **(5) hygiene sweep** — retired the T3/"Phase-2/3 deferred" ghosts across
`motion-schema.md`/`universal.md §13a`/CLAUDE.md, single-sourced the menu. **Key design calls:** ONE unified
layer mechanism (not N per-motion features); the animation menu is a capability-proven contract VPW/planner
may only pick from (prevents the `motion_prompt` "author assumes the engine can't do it" bug); seamless
integrated accretion (city→+bank→+cathedral) stays a baked delta-chain, NOT decomposed (seamless↔separable
are in tension); diegetic text → engine-drawn, plate leaves a blank region. **Proven E2E on Poyais L13
(MacGregor slides onto a stage plate) + L03 (ship paths a map drawing its route)** — via the real production
engine, from a planner-generated `shots.motion.json`. **Audio rework deferred to a separate later Step 2**
(rehome `beat_type`/pauses into an audio-director; the authoring is already mostly separate via the
cue-writers, so the payoff is small and it risks destabilizing the freshly-built audio). **Remaining:**
unify `layers[]`/`overlays[]` (a deferred nicety); the full-video run (materialize all layered shots +
human gate). Spec: `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`; plans:
`…2026-07-12-layered-motion-phase-{1..4}…md`.

## 2026-07-12 — Growth/optimization research; multi-channel "clone" idea rejected

Ran a 6-thread deep-research pass on channel growth/optimization → `knowledge/research/growth-optimization.md`
(complements `format.md`/`playbook.md`, doesn't duplicate them). **Key decision: the "spin up 3–5 same-niche
channels, keep the winner" idea is REJECTED** — it's the textbook "inauthentic content" pattern (whole-account
penalty + linked-termination tail risk across shared AdSense/email/device), splits the scarce human taste-gate,
and mis-reads our own "portfolio of *different* niches" doctrine. Adopted **"1 + iterate, then differentiate"**:
concentrate on one channel, test *within* it (native Test & Compare A/B), expand only to a *differentiated*
second channel later. Other load-bearing findings folded into the research doc: algorithm ranks
**satisfaction > session-time > CTR > retention** (comments are a weak correlational signal — pin/reply for
audience, not ranking); **posting-time barely matters at 0 subs**; **topic framing is a 2–4× RPM lever** (lean
money-ward) and **hybrid mid-rolls on our `chapter-boundary` beats** are a structural edge; **concentrate on
YouTube + native Shorts** (Reddit per-video, reserve handles, skip TikTok/IG for now); growth north-stars =
**Fern / MagnatesMedia / OverSimplified+IH / Company Man+ColdFusion**.

## 2026-07-12 — Audio-director rework: `beat_type` deleted, audio consolidated to one skill

The deferred "Step 2" from the layered-motion arc. **Goal (user-set):** get audio work OUT of the visual
skill and reduce the pieces governing audio, so real-video iteration lands in a clean structure. **What
changed:** (1) **`beat_type` deleted entirely** — a 12-slug enum `visual-prompt-writer` authored that, after
the 2026-07-12 camera-lock, drove nothing (its only live consumers were audio + a tiny whip entrance). VPW is
now fully freed of audio; the whip entrance is retired (every shot hard-cuts); `lint_shots.py` no longer
enforces it; `build_motion`/`build_audio`/`breath` no longer read it. (2) **One `audio-director` skill** now
authors ONE unified **`audio-plan.json`** (four cue kinds — `sfx`/`pause`/`music`/`dry`), replacing the two
retired cue-writers (`audio-cue-writer` + `music-cue-writer`). (3) **Structural sounds → selective judgment:**
whoosh/boom/pop are no longer mechanically auto-fired on every scene/boundary/delta; the director places them
by judgment (guided by `references/grammar-guidance.md` ← the measured `universal.md §13a-iii.8`), backstopped
by a fresh-eyes critic + `lint_audio_plan.py` + the human ear-gate. Realization stays deterministic in
`build_audio`/`breath`. **Learnings baked into the guidance/tokens:** whoosh is RARE (~0–2/video, never inside
a delta chain); `pop` fires only on additive accretion elements (not the base frame, not a character); item-
appearance SFX use `sync:"element"` to snap to the cut; whoosh/pop use ONE fixed variant (`consistent_sfx`,
no rotation) so they read as a recurring motif. A deliberate **pause** INSERTS silence (shifts the timeline);
a **`dry`** span CARVES existing silence (no shift) — kept as distinct cue kinds (conflating them was flagged
as the single most dangerous merge). **Hygiene:** the two old schema docs (`audio-cues-schema.md` +
`music-cues-schema.md`) were consolidated into one `audio-plan-schema.md`; the 12-slug beat-type→treatment
table + the beat-type-driven breath block were retired from `universal.md §13a-iii` (the measured §13a-iii.8
grammar preserved, reframed as the director's guidance); `grep beat_type` over the live tree (`.claude` /
`knowledge` / `CLAUDE.md` / channels' `visual-kit`) returns zero. **Ear-gated + approved by Daniel on
`_chain-test`** (`videos/_chain-test/assets/final.mp4` + the approved `audio-plan.json`). Two feel items
Daniel may iterate later (not baked): the "so what happened" pivot + the sudden stop into "never came home".
Spec: `docs/superpowers/specs/2026-07-12-audio-director-rework-design.md`; plans:
`…2026-07-12-audio-director-phase-{1,2,3,3b,4-5}…md`; resume:
`docs/handoffs/2026-07-12-layered-motion-and-audio-director-pickup.md`.

## 2026-07-12 — T2 device-card producer: motion-planner authors, build_motion routes

The engine's **T2 device kit** (stat-card / counter / meter / chapter-card / definition-card /
progressive-reveal) was built + declared in the `shots.motion.json` schema, but **DARK** — nothing
authored it and `build_motion.apply_motion_plan` silently dropped every non-cutout layer. Wired it the
**integrated** way (no new skill, no engine code — activated an existing surface): **`motion-planner`
authors device cards as `source:"engine"` device-layers** in `shots.motion.json` (those `kind`s were
already in the schema), with a **subtraction rule** (never card a number/term the shot's `still_prompt`
already depicts); **`apply_motion_plan` now ROUTES** engine device-layers → `motion.json` `overlays[]`
(the existing `OverlayView` renders them; `at_s` = the shot's start; `reveal` items stagger across the
shot, a v1 simplification). Ownership rationale: VPW owns what the *image* shows; motion-planner owns
what the *engine draws on top* — device cards are engine-drawn. **Diegetic `at_scene` text deferred**
(needs OverlayView scene-coordinate positioning that isn't built); its authoring rule was disabled so
image-gen stops leaving unfilled plate holes. Also **killed the never-built "hand-augment `motion.json`
overlays after dry-run" path** in `render-builder/SKILL.md` + `motion-schema.md` (double-path cleanup —
one story now: `on_screen_text`→plain text; motion-planner device-layers→device overlays; `at_scene`→
deferred). Device-card SFX will auto-fire once cards render (the `build_audio` overlay-SFX path already
reserves those roles). Validation deferred to the Tier-1 mock render (placeholder scenes + real VO on a
Poyais slice). Spec: `docs/superpowers/specs/2026-07-12-t2-device-card-producer-design.md`; plan:
`docs/superpowers/plans/2026-07-12-t2-device-card-producer.md`.

## 2026-07-13 — Pipeline integration test (Tier-1): chain proven end-to-end; 7 seams found, 6 fixed

Ran the tiered integration test's **Tier-1**: a fresh `VPW → lint_shots → motion-planner →
lint_motion_plan → voiceover (real ElevenLabs) → audio-director → build_motion → chunked Remotion
render` on a **~4:25 first-act Poyais slice** (scratch slug `videos/_t2-tier1-test/`, placeholder
scenes + real VO). The whole skill-handoff chain ran and produced a watchable MP4; the device cards +
audio were human-gated (cards + audio approved by Daniel). It doubled as the **audio-director dogfood**
(first run on real VO — 12 cues, master −14.35 LUFS/−0.89 dBTP, approved). The value was in the **seams
it flushed out that unit tests + the Tier-0 smoke test missed**:

1. **voiceover read the `## Sources` bibliography aloud** — the fallback extractor (any script without a
   `## LONG-FORM VOICEOVER` header = the gold format) didn't stop at the trailing appendix, so `- [S1] …`
   bullets got voiced. Latent on the real Poyais render. **Fixed:** fallback now bounds the body at the
   next `## ` heading, mirroring `_region` (`voiceover.py`).
2. **`--motion-plan` CLI crashed** — `build_motion.py` called `os.path.exists` with `os` never imported →
   `NameError` whenever a real plan is passed. The T2 kit was "render-proven" only at the FUNCTION level
   (Tier-0 called `apply_motion_plan` directly, bypassing the CLI). **Fixed:** `Path(mp).exists()`.
3. **A missing cutout layer would 404-crash the render** — `--allow-missing` degraded missing *scenes* but
   not missing *cutout PNGs* (engine `<Img>` has no fallback). **Fixed:** `apply_motion_plan` drops a
   cutout layer (keeps the placeholder background) when its asset is absent under `--allow-missing`.
4. **Flat full-length render OOMs** — a single-pass ~4:25/7,986-frame render exhausts the Chromium
   render-tab mid-run (surfaces as a "timeout" ~frame 3,200), unreliable at ANY concurrency on a
   memory-constrained box (non-monotonic 40/80/40% across concurrency 4/2/1). This ANSWERS the pickup's
   "chunk or not" ops question: **flat can't do full length.** **Fixed:** `render-video.mjs` now renders
   frame-range CHUNKS (`RENDER_CHUNK_FRAMES`, default 1500) and concats with ffmpeg `-c copy`; each pass
   opens/closes its own Chromium so memory stays bounded (validated — full render at 308 MB steady).
   Render timeout is now env-tunable (`RENDER_TIMEOUT_MS`).
5. **Device cards popped at shot-start, up to ~2.5s early** (Daniel's eye-gate) — `_device_overlay` fired
   at the shot cut, blind to when the carded number is actually spoken (counter 0→500 was 2.1s early,
   £200k stat 2.4s early). **Fixed:** device cards now carry an **`anchor`** (verbatim VO words, same
   convention as `vo_ref`); `build_motion` resolves it → `at_s` via **one shared resolver `render.anchor_time`**
   (reuses the ONE `match_shots_to_tokens` matcher, so a card times exactly the way a vo_ref does), falling
   back to shot-start when absent. Contract flows author→schema→lint→resolve consistently
   (motion-planner `animation-rules.md` + `shots-motion-schema.md` document it; `test_motion_plan_merge.py`
   locks it). Counter default climb shortened 1.5→1.0s (Daniel: "count faster, rest on the number longer").
6. **`--max-shots` doesn't shorten the composition** — it caps the shot LIST but the composition length is
   the full VO duration, so it can't be used to make a cheap short render. 📋 Noted, not fixed.
7. **Engine-only device-card shots will double-draw with real stills** — `apply_motion_plan` keeps the baked
   `scenes/<id>.png` for a device-card shot (only cutout shots get a regenerated subtracted plate), so at
   Tier-2 a carded number would appear on both the still and the card. 📋 **Deferred to Tier-2** (fix: either
   VPW omits the carded number from the `still_prompt`, or build_motion honors a `plate_prompt` for
   engine-only shots). Moot for Tier-1 (placeholders, no baked still).

**Status:** Tier-1 PASSED (chain proven; cards + audio gated). **Tier-2 is next (later):** `pip install
pillow rembg onnxruntime` → real image-gen → the cutout look + guidebook pops landing on visible elements
+ finding #7 + a full real render. Pickup: `docs/handoffs/2026-07-13-tier1-integration-test-pickup.md`.

## 2026-07-13 — Section-by-section render: `build_motion --chapter N`

To review a long video in pieces (Daniel: render a chunk, gate it, then the next — not one 9.5-min
all-or-nothing render), `render-builder` grew ONE flag: **`--chapter N`** renders only long-form chapter
N to its own clip `assets/final-chNN-<slug>.mp4`. Distinct from the internal `RENDER_CHUNK_FRAMES`
memory-chunking (which still concats to ONE file) — this emits a **separate reviewable clip per
section**. Kept deliberately minimal (no new authoring, no metadata-skill change): boundaries are
**auto-derived from the chapters already in `metadata.json`**, mapped onto the REAL retimed shot timeline
by nearest shot start (strictly-increasing; a chapter whose time sits past the content — e.g. full-video
metadata over a short slice — is dropped, not snapped to the last shot). It renders a **frame-window of
the full composition** via the engine's existing `renderRange`, so VO/music/SFX come out correct for the
window automatically (same absolute-positioned mechanism the memory-chunk path relies on) — no VO
splicing. `--chapter N --dry-run` just lists the resolved chapters. Validated: `chapter_ranges` unit tests
(`test_chapter_ranges.py`, incl. the slice-drop + collision cases) + a real ch-5 render of the tier1 slice
(frames 7657–7979 → a 10.8s clip with correct h264+aac). Known limits (fine for a review tool): boundaries
are nearest-time, not frame-accurate (metadata timestamps are pre-VO estimates; a verbatim per-chapter
`anchor` would make them exact — deferred until drift proves to matter); the assembled full render still
uses the concat path (its AAC-seam should be ear-checked on a long render). Files: `build_motion.py`
(`--chapter`, `load_chapters`/`chapter_ranges`/`_slug`, `render_piece(frame_range=)`), `render-video.mjs`
(optional `startFrame-endFrame` 4th arg → single-pass sub-range, no concat).

**2026-07-13 — image-gen Pass 1 locks recurring identifiable GROUPS, not just individuals (generalization
fix; surfaced by the Pearlman act-1 pipeline dogfood).** Poyais only ever had one individual lead +
anonymous crowds, so the character-lock rule quietly conflated two things: an *anonymous* crowd (different
nonrecurring people — drift invisible, compose per-scene) and a *recurring identifiable group* (a specific
named band/troupe that reappears — the Backstreet Boys / NSYNC — which drifts visibly if free-composed each
shot). Fix, **no new infra**: a recurring group is a **character whose canonical is a group frame** (its
members together in matching outfits); Pass 1 mints it once, Pass 2 seeds it into every appearance. It
locks IDENTITY only (count / outfits / look / rig); per-shot staging is composed in the scene gen (a group
uses no `pose_ref`/`expression_ref` → no Pass-1b merge). A member who later acts alone is promoted to an
individual character. Reworded **in place** (no dated append, no contradiction left) across
`image-generation` SKILL (Pass-1 split + derive rule + worked example), `visual-prompt-writer` SKILL (cast
step), `visual-kit/visual-grammar.md` (staging), `shots-schema.md` (cast note), and `style-bible.md §7` —
so no file still says "ensembles don't earn a slot." Bands stay **video-local** (`assets/library/`, like
the lead), not promoted to the channel registry. Applied to `_pearlman-act1-test` (cast `backstreet-boys` /
`nsync` into L01/L09/L10/L11/L12/L17). Design brainstormed + human-approved (Daniel); this binds future
terminals.

## 2026-07-13 — Visual-consistency + motion overhaul, Plan 2 (visual-authoring half) landed

The 2026-07-13 overhaul spec (`docs/superpowers/specs/2026-07-13-visual-consistency-motion-overhaul.md`,
unifying principle *consistency through reuse + register-appropriate render*) split into two disjoint-file
plans. **Plan 1 (render/engine/motion mechanism) landed earlier (6/6).** Plan 2 (visual-authoring
consistency) is now landed as cross-file LOGIC changes (no dated appends — each edit replaced the stale
rule in place), one vocabulary held everywhere ("crowd rig" / "prop lock" / "recurring identifiable"):
- **Crowd-rig tier (A1):** an anonymous crowd is now a PROMPTED simplified rig (round heads, DOT EYES, one
  simple mouth, no noses/ears/teeth) — never seeded — because the full rig's fine detail is exactly what
  drifts into noses on many tiny faces. Single-home verbatim clause = `style-bible §2d`; §1/§3/§8, VPW,
  image-gen, visual-grammar all reference it. §2c rig-hold reworded to scope to foreground/seeded figures
  so the two rigs coexist in one frame (sweep #1). **No asset build.**
- **Recurring-prop lock (A2):** a recurring identifiable prop (guidebook, a named banknote) earns a
  per-video `assets/library/prop-<name>.png` slot, seeded into each appearance like a character (a shot
  declares it in a new `props[]` array; no pose/expr, no merge). `forge._is_char_seed` exempts a `prop-`
  seed from the §2c rig-hold (sweep #4, TDD). Prop canonicals are a deferred human-gated asset build.
- **Expression restraint (A4):** the register is restrained BY DEFAULT — §6/§7/§3 + visual-grammar reworded
  (killed "push mouth extremity harder"; §3 review now REJECTS an over-the-top expression for its beat).
  The exaggeration is baked into the 18 `expr-*.png` source frames, so the real fix is re-authoring them to
  a moderate baseline (deferred human-gated asset build) + the ordered regen cascade (sweep #5, doc note).
- **Casting lint (A3):** `lint_shots.casting_check` flags a registry character named in a `still_prompt`
  but absent from `cast` (derived SOFT check, TDD). *Scoped deliberately to REGISTRY names — a generic
  capitalized-proper-noun heuristic was tried and CUT: it fired on the channel name in the house-style
  suffix and every place-name, all noise.*
- **Image-gen seams (C1 done earlier / C2):** the scenes manifest carries `verified:{scene,rig}` (render
  gate reads it); a card-only device-card background is a `scenes/<id>.png`, not a plate.
- **Authoring conventions (B1/D1/D2, VPW):** additive beats authored as shared-`stage` hybrid deltas
  (reuse the plate); one element per delta anchored to its own word; a character reveal enters on its
  naming moment with the canonical expression.

**Deferred (human-gated asset builds, not doc work):** the prop canonicals (A2), the 18 re-authored
expression frames + the posed-character/scene regen cascade (A4/sweep#5) — bring each to Daniel via an
Artifact. **Next:** re-run motion-planner → image-generation → render on `_poyais-test-slice` and gate the
visual result (visual FEEL stays the human's call). Plan docs:
`docs/superpowers/plans/2026-07-13-{motion-mechanism-and-render-robustness,visual-authoring-consistency}.md`.

## 2026-07-14 — Scratch video-slug cleanup + naming convention

The `channels/the-second-take/videos/` dir had accreted five underscore test slugs with opaque names
(`_chain-test`, `_act1-test`, `_t2-tier1-test`, `_pearlman-act1-test`, `_poyais-authoring-test`) plus
stray backup files. Cleaned up:
- **Deleted:** `_chain-test/` (222M — oldest scene-chaining bed, superseded; carried `_old_platemodel` +
  archived iteration dirs), the gold's `shots.old-schema-2026-07-04.json` backup, and
  `_poyais-test-act1/assets/_check/` review scratch.
- **Renamed to a `<subject>-test[-<scope>]` scheme:** `_act1-test`→`_poyais-test-act1` (visual-overhaul
  validation, real scenes), `_t2-tier1-test`→`_poyais-test-slice` (the ~4:25 integration slice — current
  Tier-2 work), `_pearlman-act1-test`→`_pearlman-test-act1`. Left `_poyais-authoring-test` untouched (a
  parallel terminal was live in it).
- **The GOLD is `videos/2026-07-04-poyais/`** (its `script.md` header declares it) — a real dated video,
  NOT any test slug. Untouched.
- **`.gitignore` now ignores `channels/*/videos/_*/`** so scratch slugs stop cluttering `git status`;
  real `YYYY-MM-DD-slug` videos stay tracked. Live doc refs (CLAUDE.md status, the two 2026-07-13
  handoffs) updated to the new names; historical specs/plans left as accurate period record.

## 2026-07-14 — Poyais visual authoring: assertive device cards, §2e base-rig tier, full user edit pass

Big day on the GOLD Poyais (`videos/2026-07-04-poyais/`). Full resume: `docs/handoffs/2026-07-14-poyais-edit-pass-and-image-gen-pickup.md`.
- **Motion-planner device cards flipped timid → ASSERTIVE** (`animation-rules.md` Family B). The timid
  default produced 0 device cards on a numbers-heavy finance story (bug). Now **promote-and-subtract every
  payoff number / section-turn / debunk-list** (card + omit the baked figure so the engine draws it);
  human-cost counts + incidental numbers (dates/page-counts) stay diegetic. Took the video 0→10 cards, then
  the user edit pass to 36 layered shots. Critic's over-animation check scoped to CUTOUTS.
- **§2e BASE-RIG tier added** (`style-bible.md`, propagated to image-gen/VPW/visual-grammar). Closed a real
  gap: an anonymous LARGE/foreground figure had NO rig path — `forge.should_hold` only auto-appends §2c on a
  seed, and §2d crowd-rig is too simplified for a prominent figure. **Three-tier model:** named/recurring →
  seeded canonical (§2c auto); anonymous foreground → **§2e** (full rig, AUTHORED as prose into the
  still_prompt, generic outfit, no canonical); anonymous small/many → §2d crowd rig. Choose by SIZE +
  RECURRENCE per figure.
- **User edit pass (~40 edits + 7 removals)** run via 7 disjoint cluster agents → merge → lint → global
  rig-sweep → **intent-critic 7/7 PASS**. Key patterns: prefer a **hybrid cutout layer** for a large
  DISCRETE added element (reuse prior scene as plate, `appear`/`slide` on) over a seeded delta (which is for
  integrated changes); camera stays LOCKED (no push/pull — user requests restaged); a layered/hybrid prior
  has no baked `scenes/<id>.png` to reuse, so such reuses self-plate.
- **Two new character canonicals** (`strangeways`, `hastie`) generated, user-approved, registered. **Lesson:
  batch-and-pick with the FULL rig spec** for character/prop locks — serial single rolls drift one rig
  feature per roll and waste credits.
- Pinned durable memory **`prefer-layered-shared-base`** (DEFERRED planner improvement): reuse shared bases +
  spawn/stamp/reveal onto them, don't cut to a fresh independent gen each beat.
- **Next:** image-generation on the video — Pass 1 (7 recurring props, human gate) → Pass 1b merges →
  Pass 2 scenes in ~20-shot chunks.

## 2026-07-15 — Poyais Pass 2 chunk 1: generated, human-gated, RENDERED; 4 skill bugs surfaced

First real Pass-2 chunk (L01–L26, 21 shots) run **parallelized** — the `image-generation` skill's own Pass 2,
cut into agent units and dispatched concurrently, then one batched 3-agent review. Ended in a watchable
**77s MP4 with real VO** (`videos/_poyais-chunk1/assets/final.mp4`). ~40 gens ≈ $5.4. Full resume state:
`docs/handoffs/2026-07-15-poyais-chunk1-pass2-pickup.md`.

**Method (generalizable).** Unit = one dependency family (shared `stage`, or `background.plate` reuse) OR a
bundle of ~4 gens of independent shots; a unit is one agent, so a chain stays serial inside it while units run
concurrently. Chunk cuts must not cross a family. Gen kind is decided by **`shots.motion.json`**, never by
prose. Derive the plan with a script; do not trust remembered numbers (doing so caught stale chunk bounds and
12 hybrids that must NOT bake a scene). Run-book:
`channels/the-second-take/videos/2026-07-04-poyais/_image-gen-plan-2026-07-14.md`.

**The batched review earns its cost.** All 8 generating agents reported their own work clean; the 3-agent
fresh-eyes review returned **24 flags, 4 blocking**. A generator self-checking shares its own blind spot —
the same root cause the scriptwriter rebuild found (`decisions.md` 2026-07-08).

**FOUR skill-level bugs found, all deferred by the user ("that's fine for now"), all will repeat:**
1. **`mode=environment` cites a seed that doesn't exist** — `forge.py`'s A5 rule passes NO image seed for
   `environment`/`style`, but the §2b descriptor says *"Draw in the SAME art style as the reference image"*.
   The sentence references nothing → the engine falls back to a **stock-clipart prior**. Cause of **every
   blocking flag** (glossy skies, thin pale-grey outlines instead of `#241a12`). **Forge contradicts
   style-bible §5**, which already requires environments to seed a ref for line weight. `refs/env/` is
   **already exempted in `_is_char_seed`** — the hatch was designed, never populated. **Affects ~82
   character-free gens.** Found independently by two agents.
2. **`--mode identity` hard-codes "perfectly bald ROUND head"** → stomps hair out of any haired cast member's
   seed. Unusable for most of the cast; same class as the fixed "expression merge stripped haired characters
   bald". Workaround: `--mode environment` (rig via auto-appended §2c, hair/costume/tone from the seed).
3. **Pass-1b merge leaks iris COLOUR from the expression ref** — §5 says the expression ref gives *only
   eye/brow/mouth SHAPE*; it never says "not colour", so colour leaked. Verified by pixel sample.
   `macgregor--action-armscrossed--expr-thinking` fixed; **`macgregor--sit--expr-thinking` still stale
   (L63, chunk 3)**.
4. **Head-turn language grows a NOSE** — *"surveying" / "turned away" / "looking off at"* pulls the rig into
   profile. §7 names the limit for true profile; nothing warns the author. Front-on framing + let the seeded
   pupils do the looking.

**Architectural law proven: layer only what has a canonical; delta-chain what must be invented.** Every
canonical-seeded figure cutout PASSED; every unseeded invented environment cutout (ship, capital, bank,
cathedral, stamp, town/farm/settler) FLAGGED. A cutout generated blind to its plate has nothing pinning its
style. Same logic the skill already applies to plates, never extended to cutouts. *Re-test once `refs/env/`
exists — bug #1 is part of the mechanism.* L05–L08 converted layers → delta chain (held 2.04/8.47/3.03) and
came back on-register **and cheaper** (4 gens vs 6).

**Corollary: a re-base inside the same location must seed the prior stage's BASE frame.** The `≤3 deltas then
re-base` cap assumes a re-base starts a NEW place; when the same place persists it throws the set away — L22
and L24 (one swamp, split by the cap) came back as **two different swamps**. Fixed for L22→L24→L26;
**`motion-planner` still has the bug.** Parallelism didn't cause this — it exposed it: the dependency graph
has no edge for *"this is the same place as that."*

**Craft rules the run hardened.** (a) **Measure, never eyeball** a matte or a colour — every measured call was
right, every eyeballed one wrong in both directions (a phantom halo that was only the viewer compositing under
transparent pixels; a real defect that "looked harmless"). (b) A **pale isolation field starves rembg** on a
pale subject — it silently drops parts; use a vivid/mid-grey void (the brief's "plain flat pale background" is
wrong for pale subjects; found independently by two agents). (c) **`--aspect 16:9` is for scenes/plates ONLY**
— a cutout on 16:9 leaves dead width the engine fills with **variant sheets**. (d) **`--force` destroys a
better earlier attempt**; retries should stage to a distinct name. (e) The scenes-manifest top-level key is
**`shots`**, not `scenes` (`forge.py:389` / `render.py::_load_scene_manifest`) — getting it wrong silently
fails the verify gate on every shot → all placeholders. (f) Don't re-describe a shot in a dispatch prompt: the
authored `still_prompt` already carries the subtraction (an early instruction would have double-drawn L05's
capital).

**`shots.json` mojibake** — 100/118 shots corrupted (em-dashes → `â€"`) by an ad-hoc script on 07-14, repaired
07-15 and verified by codepoint; every committed skill script reads/writes explicit UTF-8. A `lint_shots.py`
mojibake guard was **proposed and declined**.

**New tool: `.claude/skills/image-generation/scripts/build_review_artifact.py`** — the skill has always
mandated a human review artifact but shipped no tool, so every board was hand-built. Self-contained HTML
(CSP blocks external hosts → `data:` URIs), **checkerboard under real transparency** (a flat fill makes a
matted cutout read as an opaque box — the user reported the ship as non-transparent when it was already 38.5%
clear), per-image VO line + intended animation + flag reason, lightbox with **←/→ / Esc**.

**Next:** decide the 4 bugs (fix #1 before chunk 2), then chunks 2–6 (97 shots ≈ 109 gens ≈ $15).
`audio-director` on chunk 1 still owed — the render is VO only.

## 2026-07-15 — Operating-law governance LANDED on master + merged into the working branch

The `feat/operating-law` tail was finished and the whole restructure merged, replacing the old CLAUDE.md
regime everywhere. What landed:

- **Remaining plan tasks executed** (on the oplaw worktree, then ff'd to master): **Task 5** — hooks moved
  to repo-level `.claude/hooks/` (`block_git_add_all.py` got its first tests, 7/7; new
  `inject_law_on_compact.py` re-injects the law after compaction; `settings.json` repointed). Plan bug
  found: the compact hook's `print()` dies on cp1252 (the law contains `→`) → emit UTF-8 bytes via
  `sys.stdout.buffer`. **Task 7** — `channel-forge/references/enforcement-contract.md` shrunk 110 → 22
  lines to a pointer at `knowledge/operating-law.md` + walk-only mechanics (36/36 tests green). The live
  duplicate that would have drifted is gone.
- **master fast-forwarded** to the oplaw tip, then **merged into `feat/visual-consistency-motion-overhaul`**
  (`3fd5d9d`). Conflict policy: the 108-line router CLAUDE.md wins; the branch's status-block delta
  (Poyais Pass-2 chunk 1, the 4 deferred skill bugs, Tier-1 rename) migrated into `docs/handoffs/STATUS.md`;
  image-gen SKILL + style-bible unioned (newer "ONE re-authored retry" superseded the older retry-≤2 on
  both sides). A fresh-eyes loss audit of the merge: CLEAN.
- **STATUS.md curated** (chronological changelog → 8 topic sections, every status marker/value/pointer
  preserved). A second fresh-eyes audit caught ONE loss — the VPW pre-gen shot critic layer had been
  dropped — restored, plus the stale retry-≤2 wording updated to the current one-retry policy. The
  "never self-certify a doc migration" rule paid for itself again.
- **Still open from the oplaw pickup:** the prove-it acceptance gate (fresh terminal follows a clause
  unprompted — human judges); the `@import` fresh-session proof; `voiceover` lacks the
  generation-logging rule; the layer-vs-delta-chain precondition has no lint backstop. `channel-forge`
  itself stays parked (user call).

Alternative rejected: merging our branch → master at the same time. The visual overhaul + Poyais Pass 2
are mid-flight on this branch; master takes them when they're done, per the existing branch discipline.

## 2026-07-15 — Pipeline simplification: Pass 1b + engine text/device kit retired; boundary enforced

User-directed redesign ("revert to what 100% works"), branch `feat/pipeline-simplification`, phases 0-3
done in one arc:

- **Phase 0 probe before any edit (§D):** 6 gens (~$0.80) tested the two load-bearing bets. **6/6 PASS**,
  including the two cases the old staging law forbade: one-run multi-seed [canonical+pose+expression]
  held identity/costume, and the [handshake template + two canonicals] pot held BOTH identities. Baked
  text letter-perfect at 1-4 words incl. digits+comma. Caveats kept in doctrine: expression = softest
  seed (review now checks register); N=1 existence proof. Board:
  https://claude.ai/code/artifact/b4e21f70-329f-4aa4-9977-af7985f22720
- **What was retired:** Pass 1b (pre-merged posed-character library; scenes now multi-seed in ONE run);
  ALL engine-drawn text + device cards (stat/counter/meter/chapter/definition/reveal + on_screen_text
  word overlays; components parked dormant in the engine — producers removed, `source:"engine"` invalid
  in lint, menu cutout-only); sprite-walk; at_scene; vestigial fields (transform_note, render_pattern,
  transition_in); forge `diff`/`crop`. **Kept, explicitly:** props/prop canonicals, Pass 0 + the
  primitive library (now direct scene seeds), draw_line route, shorts captions, PlaceholderCard.
- **New enforced boundary (canon, mirrored across all owning docs):** DELTA-CHAIN = integrative growth
  of one scene's architecture (regen seeded off prior frame; a re-base inside the SAME location seeds
  the prior stage's BASE frame); LAYER = discrete addition on a persistent plate, and a layer must be
  discrete AND seedable (canonical, or plate + style anchor). All in-video text is baked diegetic,
  quoted verbatim, short, transcribed letter-by-letter in the review (blocking).
- **Bug #1 fixed structurally:** forge hard-errors any unseeded environment/style gen; `refs/env/`
  populated with three human-gated Poyais frames (zero gen cost, reuse-before-regenerate).
- **Alternatives rejected:** killing word-anchored text overlays but keeping cards (user: no engine text
  at all — text lives in the image); one prep-gen per scene instead of multi-seed (probe made it
  unnecessary); deleting the engine components (parked instead — revivable, and removal-of-producers is
  the actual guarantee).
- **Method note:** five parallel doc agents with one injected canon + a fresh-eyes loss audit over the
  combined diff; the audit found 4 real defects (worst: universal.md still carrying the superseded
  canonical-only layer law) — 6th consecutive audit with a real catch. Also fixed live: both hook
  registrations were cwd-relative and broke from subdirectories → `${CLAUDE_PROJECT_DIR}`-anchored.
- **Open on this branch:** Phase 4 lint backstop; Phase 5 dogfood slice (chunk-2 shots under the new
  doctrine) → user gate → chunk 2. User calls owed: chapter-card fate (universal §13a-ii still
  recommends them; as baked images, diegetic beats, or dropped?) and the probe-board eye-gate.

## 2026-07-15 — Chapter/title cards dropped entirely (user call)

No cards, baked or engine-drawn. A chapter turn is a hard cut to a new stage / a palette turn / a
VO-gap music dip. The channel recipe's hand-feel now lives in marker charts + baked diegetic
lettering. Reference-channel card measurements stay in the teardown records (they describe Crayon,
not us). Alternative rejected: chapter cards as baked diegetic images — full-frame title text is
gen-text's weakest case and the device adds nothing a stage turn doesn't.

## 2026-07-15 — Channel lettering LOCKED: "relaxed marker italic" (human-picked, 2-round audition)

All baked in-video text now renders in ONE lettering family, held by a seeded exemplar
(`refs/env/lettering-marker-italic.png` — lives under `refs/env/` so it never triggers the §2c
rig-hold) + a pinned descriptor (style-bible §6): relaxed hand-lettered marker capitals, slight lean +
baseline bounce, no joins, never calligraphy, ink `#241a12`. Image-gen adds the exemplar seed to every
text-bearing gen; VPW never describes fonts in a `still_prompt`. Review bar per the user: FAMILY match
loose (handwriting wobble is fine), spelling strict. Audition: 6 candidates over 2 rounds (round 1 all
"too rigid" → round 2 on the slightly-cursive axis); all 6 spelled every specimen clean. Measured
limit worth keeping: the engine reliably renders lean/bounce/flow tails but RESISTS true letter joins —
"cursive" in this pipeline means flow character, not connected writing. A font FILE cannot be fed to
the engine; exemplar-seed + descriptor is the mechanism, and the user accepted general-style (not
glyph-perfect) as the bar.

## Open questions (decide later)

- **First niche** — ✅ **CHOSEN 2026-07-02:** "What Happens To Your Money" (cheat-code hybrid). See the
  decision entry above; channel at `channels/what-happens-money/`.
- **Validation path** — AITuber MCP (~$29 throwaway) vs. build Path B directly vs. validate by hand.
- **Format mix per niche** — long-form-first vs. both-from-day-one; finalize when niche is chosen
  (`research/format.md`).

## 2026-07-15 — style-bible §3 gains an explicit identity-match invariant

**Decision:** land in §3 (human-approved wording): a seeded character's head tone + hair must MATCH
its canonical — a base-cream bald head on a haired/toned character is an identity FAIL even when every
form invariant passes. "Figure present + on-rig" is not an identity ruling.

**Why:** third identity-review miss of the redesign (L27-fix2: a scene-heavy delta starved the
character seed, the review passed the blank base template as "clean" because every FORM invariant
holds on a blank head too; the human caught it). The check is now a named invariant the identity/rig
agent must rule on explicitly, like proportion before it.

**Rejected:** leaving identity to reviewer judgment (failed 3x: nose slip, off-rig L27, blank-base
pass); adding a measurement gate (tone-sampling script) — overkill while the named-invariant fix is
untested at scale.

**Also:** L32's baked signature renders rotated toward the seated signer (upside-down to viewer) —
human ruled it diegetically correct and ACCEPTED; manifest stamped verified scene:true. No doctrine
change: text orientation follows the diegesis, not the viewer, when the shot stages it that way.

## 2026-07-15 — stamp lettering register locked (heavy block + dark contour)

**Decision:** big stamp-down marks (FAKE / FICTION / SOLD and kin) render in a dedicated LOCKED stamp
register — heavy block CAPITALS, dense saturated red `#d7402b` ink (thick solid strokes, distress only
at the edges), a thin `#241a12` letter contour hugging each glyph (a clean ink contour, NOT a drop
shadow / offset ghost), flat matte, hand-stamped edge distress. Canonical exemplar =
`refs/env/stamp-block-outlined.png` (registered `stamp` tag, seeds every stamp-mark gen). Stamps are
the ONLY exception to the marker family; ALL OTHER in-video text stays in the relaxed marker-italic
register (style-bible §6 lettering lock).

**Why:** human ruled the marker-hand rendering of stamps "too cartoony" and wanted a real
"stamped-down" look with weight. 2-round audition: round 1 = 4 registers (bordered rubber-stamp,
stencil, woodtype-flat, block); round 2 = 3 weight/contour variants of the block winner. Human picked
the combo — B1's heavy dense ink weight + B2's thin dark letter contour ("use the black outline in
double struck and it's perfect. Use that combo for all stamps"). Combo exemplar landed on the first
gen (dense red + clean dark contour, flat, correctly spelled FICTION/FAKE).

**Rejected:** bordered rubber-stamp (the ring/oval frame read as a logo, not a mark); stencil (too
mechanical); plain block "B" (too light — thin ink, no authority); B2 alone as a ghost/offset-shadow
double-strike (read as a print-registration error, not a contour); B3 edge-bleed variant
(over-distressed, illegible edges). Also rejected keeping stamps in the marker-italic hand (the
"too cartoony" complaint that triggered the audition).

## 2026-07-16 — two-gen identity pass is the DEFAULT for scene-heavy single-character shots

**Decision:** for a *scene-heavy single-character shot* — exactly ONE seeded cast figure in a
`still_prompt` dominated by environment/scene content — image-generation Pass 2 now generates it in TWO
gens by DEFAULT (no longer a fallback): **gen A** composes the whole scene (technique (b)/(d)); **gen
B** is an identity pass seeded [gen-A scene frame + character canonical + expression frame] that changes
ONLY the figure's identity (head tone + hair + face), holding the environment gen A built.
Multi-character and character-light/character-free shots are unchanged. Owner:
`.claude/skills/image-generation/SKILL.md` Pass 2 technique menu; style-bible §3 identity-match
invariant references it; the Pass-2 run-brief carries it operationally.

**Why:** the identity-starve failure (a scene-heavy delta renders the blank cream bald base template
instead of the seeded character — passes every §3 FORM check, still the wrong character) hit **3×**
across the dogfood slice + chunk 2, and the two-gen technique fixed it **3/3**. As the default it
removes the detect→retry loop that re-incurred on every such shot. Cost accepted: ~1 extra gen
(~$0.13) per scene-heavy single-character shot.

**Rejected:** keep two-gen as a FALLBACK (cheaper — fires only after a frame is flagged — but re-incurs
the retry loop on every scene-heavy single-character shot, and the 3/3 record says the starve is
predictable, not exceptional). Also rejected: a tone-sampling measurement gate (overkill while the
named-invariant check + the default technique carry it).

## 2026-07-16 — Poyais chunks 3–6 run as four parallel chunks with ONE combined review board

**Decision:** generate Poyais chunks 3–6 (C3=23, C4=24, C5=21, C6=17 gens; ~77 shots, ~85 gens ≈ $12)
all FOUR chunks in parallel, then a SINGLE combined human review board over the whole set. (C5 blocker
stands: `hastie-wife` has no canonical — generate seeded off `hastie` + style anchors, human-gate it
first.) Human-confirmed 2026-07-16.

**Why:** parallel + one board is the fastest wall-clock path and gives the human one review pass over
the full remaining video instead of four. Matches the chunk-1/chunk-2 parallelized-unit model already
proven.

**Rejected:** sequential per-chunk (slowest — four serial gen+review cycles); paired boards (C3+C4 then
C5+C6) — halves each board's review size but adds a mid-way wait for the human, for no gen-throughput
gain.

## 2026-07-16 — Poyais rework learnings codified into the durable image/motion doctrine

**Decision:** routed the human-confirmed Poyais chunk-2/round-1-3 rework learnings out of the run
briefs and into the docs a fresh session actually reads. Seven codifications: **(1)** a mechanical
**cutout-aspect ban** — `forge.py cutout` hard-errors on an input whose width/height ≥ 1.5 (regen at
2:3/4:3/3:2) unless `--allow-wide` is passed, plus the ban stated in the image-generation SKILL.md
aspect law + tests beside the cutout tests; **(2)** cutout **transparency craft** into style-bible §8
(engine emits no alpha → solid MAGENTA chroma field + deterministic key/despill; matte verification
samples ENCLOSED interior regions, not just the silhouette + corners); **(3)** stamp/seal/mark cutouts
**seed the register exemplar + destination plate**, a pre-lock/unseeded stamp is a register FAIL
(style-bible §6); **(4)** a recurring FIGURE across a held sequence is **ONE reused cutout** via the
`reuse:` field, never per-shot regens (motion-planner animation-rules; schema wired 2026-07-16, commit
cc3b491); **(5)** an exposed articulated hand (salute/wave/open palm/raised) **seeds the matching
`refs/base/` pose primitive** + states the 4-digit fact, never free-drawn (style-bible §5); **(6)** a
retry **re-authors HOW an authored fact is depicted, never WHETHER** — deleting a fact to dodge a defect
is a fidelity violation, flag it (image-generation SKILL.md retry policy); **(7)** baked text that
truncates mid-word got too little canvas → **re-author it as its own architectural element** with clear
margin (style-bible §6).

**Why:** every learning was human-confirmed across the review rounds (evidence:
`channels/the-second-take/videos/2026-07-04-poyais/_rework-log-2026-07-16.md`). Left only in the run
briefs they would bind nobody — a fresh terminal reads the style-bible, the skill docs, and the
animation-rules, not a video's scratch brief (operating-law §G-route reachability).

**Rejected:** leave them as run-brief-only (the pass-2 brief already carried operational versions) —
rejected because run briefs are session scratch, unreachable by future sessions; a lesson that lands
where nothing routes to it is a silent no-op. Also rejected fixing the cutout-aspect defect with a
self-checked prohibition alone — the "16:9 is scenes/plates only" rule already existed and nothing
enforced it, so the fix is the mechanical `forge.py` guard (a value/HOW-to-fire lesson lands in the
mechanism, not another prose rule).

## 2026-07-16 — Poyais chunks 3–6 rework round-1 learnings codified into the durable image/motion doctrine

**Decision:** routed the human-confirmed learnings from the chunks 3–6 board rework round ("I want these
changes made, learnings saved") out of the run briefs into the docs a fresh session reads. Landed each in
the LEAST general layer that holds it (§G-route):

- **(a) style anchor is MANDATORY on EVERY scene/plate gen, not just character-free ones** (the character
  seeds pin identity, not art style) — anchor = the shot's continuity parent frame, else a `refs/env/`
  register anchor, else an on-style scene. **Cross-chunk art-style drift is the proven failure when scenes
  run unanchored.** → style-bible §5 composed-scene bullet + image-generation Pass-2 seeding law.
- **(b) anonymous-figure proportion = the EXACT squat base-rig head-to-body proportion** (human-confirmed:
  "the crowd rig should be the exact same proportions as our base rig — the face is different, of course");
  a stated FACT in every crowd/base-rig delta AND a first-class review axis. → style-bible §2d (tightened
  "same proportions" → "EXACT same as base rig, only the face differs") + §3 proportion axis (already
  present, left intact).
- **(c) arrows / routes / progressive reveals are MOTION, never baked** — an arrow is a `path`+`draw_line`
  cutout; a progressive reveal (borders drawing on in spoken order, a crown breaking and staying) is
  sequenced `appear`/`draw_line` layers each anchored to its VO word, persisting end-states with
  `static:true`. → motion-planner animation-rules route bullet.
- **(d) maps: CROP the existing map canonical (PIL, deterministic), never regen a new region** — regen is
  the fallback only when the canonical doesn't cover the region, and then seeds the map canonical + the
  parchment-map register anchor. → style-bible §5 (new maps bullet) + image-generation Pass-2 ENV/maps
  bullet.
- **(e) match-prop shots seed the FIRST APPROVED prop frame as the canonical** (a bond design established
  in one shot seeds every later shot showing it) — the recurring-prop lock, even when not pre-locked in
  Pass 1. → style-bible §5 match-prop bullet.
- **(f) de-nose/de-ear fixes are a targeted identity-style pass budgeted for TWO gens** — the first pass
  (seed current frame + base-rig exemplar, change only faces) lands the nose fix but leaves a sticky
  C-shaped ear / residual nose ~half the time, so a second targeted pass seeded off the already-fixed
  frame is the reliable shape. → image-generation two-gen identity-pass section.
- **(g) a GENERATING agent's self-verification under-reports rig defects** (noses it ruled "within
  tolerance"/"minor" were ruled BLOCKING by fresh-eyes zoom review, twice adjudicated) — reaffirmed the
  fresh-eyes review as the rig authority: zoom faces 3–4x for noses/ears (the crop ban is hands-only), a
  generator's self-check never substitutes. → image-generation batched-review identity/rig mandate.

**Also revisited the 6 pending G-route candidates** from the board-gate pickup (the "learnings saved"
confirm covers them): **codified** — (1) a delta that REMOVES a transient element seeds the pre-transient
ancestor, not the immediate predecessor (style-bible §8); (2) whitelist a seeded prop's own designed
lettering from the text-free/unrequested-text fail (style-bible §3; the VPW-authoring half is out of this
pass's scope); (3) a crowd scene with one seeded lead restates the lead's costume + contrasts the crowd's
uniform/palette (image-generation Pass 2); (5) cutout gens force "one solid uniform FLAT magenta, no
glow/gradient" — the fringe failures were gen-side glows, not keying failures (style-bible §8).
**Already-covered, no edit** — (4) two-figure hand exchanges seed the interaction template (style-bible
§5/§7/§8 already route hand geometry + eye-line from the template); (6) style-reviewer matte flags are
usually viewer artifacts, measure opaque-chroma % first (style-bible §8 measure-a-matte bullet already
carries the exact viewer-artifact evidence).

**Why:** a lesson left only in a video's run brief binds nobody — a fresh terminal reads the style-bible,
the skill docs, and the animation-rules, not a scratch brief (operating-law §G-route reachability). Every
learning was human-confirmed this round.

**Rejected:** a lint/measurement gate for anonymous-figure proportion — rejected: proportion is a visual
judgment with no seed to measure against, so it lands as a stated delta fact + a review axis, not a
mechanical gate (§G-route: a taste/measure-by-eye pattern lands in the review layer, not a self-checked
lint). Leaving (a) as an optional "any needed style anchor" — rejected: optional is exactly what let the
cross-chunk drift through; the anchor is now mandatory on every scene gen. Routing candidate (2)'s
VPW-authoring half — deferred: VPW was out of this pass's allowed scope; the doctrine (whitelist) landed
in the bible where the reviewer reads it.


## 2026-07-16 — Chunks 3-6 rework round 1: the round's human decisions

- **Crowd/anon-figure proportion standard = EXACT base-rig squat proportions** (face treatment
  differs: crowd rig keeps dot eyes / simple mouth / no nose-ears-teeth). Daniel, verbatim: "Crowd
  rig should be the exact same proportions as our base rig. Face is different of course."
  Alternative rejected: flipping the standard to the taller human-proportioned figures seen in the
  drift shots (L73/L76 et al.) — the bible already said squat and Daniel confirmed it. A 3-agent
  audit swept every frame; all tall-drift in the rework window fixed; L30 (released chunk 1)
  surfaced for his call rather than auto-reworked.
- **L96 = fix to exactly TEN grave crosses** (7 adult + 3 child = the VO's payload), chosen over
  accepting the 9-cross render his feedback hadn't mentioned. Took two regens (11 on the first);
  count now structurally authored (front row of 6 + rear cluster of 4) and zoom-verified.
- **'Scrap 114' parse confirmed:** keep L114's framing; fix only the off-rig foreground figures +
  the 5-finger hand. (Identity pass held the composition; verified against the superseded frame.)
- **Review-vs-generator disagreements adjudicated by zoom, both times for the reviewer** (L76
  broker nose+ear, L122 guard noses were real). Reaffirms: generator self-checks never gate.


## 2026-07-16 — Chunks 3-6 rework ROUND 2: the crop-battery gen/verify redesign

Round 1's verify stack (unit self-check → 3-axis fresh-eyes zoom review → fix unit "verifies" by
zoom → orchestrator stamps `verified:true`) passed ~20 frames Daniel immediately failed for
ears/noses/5–6 fingers/proportion. Manifest + code evidence pinned four mechanisms: fix passes
seeded off the defective frame (defect lives in the strongest seed, ~50% sticky), seed dilution
(4–5-seed gens, `base.png` as an Nth anchor pinning nothing), a review layer structurally blind by
its own doc (hand crops banned, prose zoom claims with no evidence artifact), and a board compositor
bug rendering plate+layers cards bare. Human-approved design gate this date (spec
`docs/superpowers/specs/2026-07-16-round2-crop-battery-redesign.md`) — this approval IS the §G human
confirmation; FEEL re-gates on the republished board.

**Decided:**
- **Crop battery replaces full-frame rig review.** A localizer agent returns per-figure face + hand
  bounding boxes → `scripts/crop_battery.py` (PIL, deterministic) cuts them at 3–4× → a SEPARATE
  fresh judge rules PASS/FAIL per crop with the crop file path cited as evidence; prose zoom claims
  are inadmissible. Fix passes re-enter the battery before/after on every figure. → style-bible §3
  hands bullet + image-generation batched-review identity/rig mandate.
- **Seed cap ≤4 per gen** (canonical + ONE pose + ONE expression + one anchor/exemplar) — beyond 4,
  dilution weakens every prior. → style-bible §5 + image-generation Pass-2 seeding.
- **Regen-first: a rig FIX never seeds the defective frame** (regen fresh from canonicals; the defect
  rides the seed ~50%). The only defective-seed exceptions are an authored delta-chain parent and a
  human-ordered framing hold, both requiring a before/after crop diff on EVERY figure. → style-bible
  §5 + image-generation Pass-2 seeding.
- **Crowd exemplar** `refs/base/crowd-exemplar.png` (human-gated this date) is seeded into EVERY
  crowd-bearing gen as the crowd rig anchor — the §2d words stay in the prompt, but the exemplar seed
  pins proportion + face (a crowd carries no per-figure canonical). → style-bible §2d/§8 +
  image-generation Pass 2. Supersedes the earlier "author §2d words, no seed" crowd handling.
- **Orchestrator-only stamping** — generating agents never stamp `verified`; the orchestrator merges
  manifest entries only after the battery + fresh-eyes review pass (round-1 `verified:true` stamps
  voided). → image-generation Stamp-the-gate.
- **Board compositor fix** — `build_board` reads `layer.reuse` else `cutouts/<sid>-<layer-id>.png`
  (mirrors `build_motion.py:179`); board-only, no regen. → execution (P0), not a doctrine file.

**Alternatives rejected:**
- **Ensemble full-frame voting** (N judges vote on the whole frame) — rejected: the round-1 failure
  was not judge variance, it was full-frame blindness to small features + no evidence artifact; more
  votes on the same blind view raises cost, not the floor. Deterministic crops + evidence-cited
  per-crop rulings is the actual lever.
- **Crops-to-human-only** (skip the judge, hand raw crops straight to Daniel) — rejected: pushes the
  full per-crop grind onto the human on every batch; the judge raises the machine floor and the human
  gate stays final on the same embedded crop sheets, at seconds per shot.
- **Fix-passes-only** (keep seeding identity passes off defective frames, just review harder) —
  rejected: the manifest showed the defect riding the seed ~50% regardless of review; the fix is
  gen-side (regen fresh from canonicals), not more review on a doomed seed.

**Why:** the honest limit is that a model judge still misreads cartoon hands sometimes even on crops,
so the crop battery raises the floor (structured verdicts + evidence + human crop sheets) while the
real rig win is gen-side (seed cap + regen-first + crowd exemplar). A lesson left only in a video's
run brief binds nobody — a fresh terminal reads the style-bible and skill docs (operating-law
§G-route reachability). Every learning was human-confirmed via the design-gate approval this round.

## 2026-07-17 — Poyais round-3 board-feedback decisions

- **Scope ruling (Daniel):** round-2 items he did not re-flag (L62 L95 L96 + taste stack
  L61/L81/L109/L118/L53/L54/L57/L102/L112) are ACCEPTED AS-IS and ship. Alternative rejected:
  folding them into round 3 (more gens for items he did not ask about).
- **L79 fine-print layer CUT, L107 anger-mark layer CUT (Daniel, board feedback):** L107's anger
  now lives in the crowd itself (wheeled, pointing at the officer's pop-on spot; dedicated
  scenes/L107.png plate replaces the L105 reuse). Alternative rejected: keeping the comic glyph
  (Daniel: "scratch the anger mark").
- **L30 REVERTED to the pre-round-2 frame (Daniel):** the r2 squat rework is parked in
  _superseded-2026-07-17-r3. Lesson: a rework can lose qualities the human valued — the board
  must always offer the prior frame for comparison.
- **L75 layer coords are geography-bound:** country pop-ons must sit on the true drawn region
  (engine anchors layer CENTER, components.tsx:595/615). Composite-verified before the board.
- **NOT codified (awaiting Daniel per §G):** (1) §2e-anon ear defects are prompt-unsuppressible —
  composition (side-wrapping headwear / faceless) is the only proven fix (L48 x4, L115 x2, beach
  chain x2 incl. from-behind hat-brim ears); (2) "gaunt/aged" facial wording pulls photorealism —
  author age/grief as posture/silhouette; (3) hybrid shots' composed-shot still_prompt keeps
  being misread as "stale" by gen units — needs an explicit plate-vs-composed convention.

## 2026-07-17 — Poyais round-4 "simple prompts" rework decisions

- **Round-4 method (Daniel-directed):** VPW re-author to SIMPLE prompts + context-free regen after
  round 3 proved (a) prompt-block prohibitions cause defects rather than prevent them, and (b) the
  crop-only battery passes frames the human rejects. Alternative rejected: more targeted regens
  under the old prompts (4 straight failures on L48).
- **Battery hardened:** ear-HOLES are a named blocking invariant; a per-shot FULL-FRAME
  style-gestalt ruling is mandatory. `crop_battery.py` extended with an `ear_zones` part-type.
- **Result 11/14 clean** incl. three-round failures (beach chain, L93-as-hooded-shape) —
  simple-prompts + structural composition validated on real production shots.
- **Candidates for codification (await Daniel §G confirm):** (1) VPW law: ≤80-word scene prompts,
  no rig prohibitions, anon faces structurally covered/eliminated; (2) image-gen: two-gen identity
  pass CONDITIONAL on observed starve (unconditional pass balded healthy frames twice);
  (3) image-gen prompt clause: "the ONLY people in the scene are those stated" (kills invented
  galleries/mannequins); (4) far-scale figures should be authored featureless/silhouette (distant
  nose-bumps survived 2 rounds); (5) agent briefs: forge runs foreground-sequential (background
  batch + end-turn-to-wait stalled all three units under API 503 storms).

## 2026-07-17 — Poyais round-5 + full render decisions

- **L30/L63 "easier image" law applied (Daniel-directed):** L30 rebuilt around the proven shako
  soldier (MacGregor removed); L63 rebuilt as a top-down no-head desk scene. Daniel approved both
  ("There are fine"), accepting L63's residual 5-digit map hand after 4 re-rolls proved
  surface-resting hands structurally splay (grips pass 5/5). Retry-law deviation (extra passes
  beyond the one retry) was disclosed and is NOT a precedent — route the underlying lesson
  (hands grip or stay off-frame) through §G instead.
- **Render preflight honored the hard-stop design:** take 1 stopped on real gaps instead of
  silently falling back — validating the no-silent-fallback law. Fixes: render-builder plate-only
  passthrough wiring (commit 2f98bb6); verify stamps reconciled to recorded human rulings only;
  production VO + audio plan generated by their owning skills (never hand-rolled).
- **Alternative rejected:** rendering with --allow-missing to "see something" — would have shipped
  placeholder cards and bypassed the rig gate.
- **Full render shipped:** final.mp4 8:05, -14.54 LUFS, checker green. Daniel mid-watch-through;
  8 codification candidates parked in the pickup pending his §G gate.

## 2026-07-17 — Music retrack: restrained exposé-underscore replaces meme cues (Daniel-approved "Option A")

- **Decision:** the music-audit found the default con-spine/lift beds were meme-famous Kevin MacLeod
  comedy cues (Sneaky Snitch, Scheming Weasel, Monkeys Spinning Monkeys) — instantly recognizable
  "YouTube meme music" that cheapens the channel's Crayon-Capital exposé/credibility register. Daniel
  approved retracking to the goal-channel register. music-forge sourced a new **restrained
  exposé-underscore** bucket set (all Incompetech / Kevin MacLeod, CC BY 4.0, verified on the source
  FAQ), normalized to −20 LUFS and wired into `music_pools`:
  - **`underscore`** (NEW, DEFAULT con-spine — replaces `sneaky` as default): Crypto, Deliberate
    Thought, Comfortable Mystery 2, Private Eye — present, credible pizzicato/strings/keys tension.
  - **`upbeat`** (EXTENDED, not renamed/deleted): added **Fig Leaf Times Two** as upbeat-2 (non-meme
    market-mania lift); upbeat-1 (Monkeys Spinning Monkeys) preserved for deliberate comedic use.
  - **`somber`** (NEW, elegiac button tail): Meditation Impromptu 01 — so the button no longer
    resolves on the comedic con bed.
- **Meme cues STAY** — `sneaky` ×6 and upbeat-1 (Monkeys) are retained in the library for OCCASIONAL
  *deliberate* comedic use; they are no longer the default. Nothing deleted/renamed.
- **Register boundary widened, not broken:** the retrack adds a restrained-underscore register but the
  "NOT cinematic stinger/movie-score" guardrail still holds (music-forge SKILL.md reconciled to state
  both registers).
- **Alternatives rejected:** (B) drop bed coverage to the OverSimplified ~62% floor and (C) mostly-dry
  set-piece-only — both deferred; the audit's evidence said the register/track was the bigger defect
  than raw coverage, so re-tracking (A) is the smallest change that removes the most likely cause and
  stays inside the proven Crayon 71–85% band. A/B on coverage can follow on Daniel's ear.
- **Not changed:** `music_default_mood` (still `casual-bed`, the realizer fallback) and audio-plan.json
  — the audio-director re-authors cues separately and the human ear-gates FEEL on the render.

## 2026-07-17 — Poyais R7 (watch-through №2) decisions

- **Per-cue `track`/`variant` pins in the audio lane** (render-builder + lint). Mood-only cues
  couldn't express Monkeys-vs-Fig-Leaf or a specific sparkle variant — a blocker in 3 straight
  rounds, hand-managed via pool reordering. Rejected alternative: more/finer mood buckets
  (proliferates channel config per video; pool order stays rotation-fragile). A pinned-but-missing
  file is a HARD error (a directed choice never silently falls back).
- **`dip_in_pause:false` channel dial** [Daniel-directed, M15]: the bed plays THROUGH authored
  pauses; full music cuts only on human-cost dry spans + track switches. Old behavior (−40 dB dip
  in every pause) survives as the default=true dial for other channels.
- **Deterministic tile-composite for exact-count infographics** (L103): the gen engine hard-caps
  crowd grids at ~8–9 rows (proven twice: asked 10→9, asked 12→8), so ~250 figures cannot be
  generated directly at 16:9. Rejected alternative: a 3rd gen attempt (retry law + proven cap).
  The composite tiles VERIFIED sprites from the engine's own clean output — exact count, exact
  zero-overlap, rig by construction. Candidate §G lesson: infographic shots with narrated counts
  get deterministic assembly from generated sprites, not raw gen.
- **Cumulative-chain re-base seeds the LAST delta** (L09b prince seeded off the cathedral frame):
  deliberate deviation from §13a re-base-seeds-BASE, which exists for scene-SET drift; a
  cumulative build loses its accumulation if re-based on the stage base. Awaiting §G gate.
  Corollary landed via lint: a stage BASE renders as mode:"plate" (its own frame); the
  generation-time seed lineage is not a render-time chain.
- **Trio sash lettering kept sans (consistency-first)**: the L75 figures are exact crops of
  shipped L81; re-lettering only the cutouts would desync them from their baked twins. Flagged
  to Daniel; if rejected at the gate, re-letter BOTH in one regen round.
- **Monkeys Spinning Monkeys sanctioned for deliberate use** [Daniel ruling]: opening span
  ("It all started…"→"made himself the prince") + Paris-caper span. `upbeat-3` (Ascending the
  Vale, CC-BY) added as the con-spine-adjacent light bed (top non-meme CLAP match to Fig Leaf).

## 2026-07-17 — Poyais R8 (watch-through №3) decisions

- **Universal sentence-gap law** [Daniel-directed, R8-B]: +0.5s of spliced silence after EVERY
  spoken sentence (0.3s for chained ≤2-word sentences), on top of VO prosody; authored pause cues
  STACK on top (co-located gaps sum). Engine-wide (`breath.py sentence_gaps()/merge_gaps()`), dialed
  per channel in `audio-tokens.json`. Baked `[PAUSE]` script tags RETIRED for this channel — they
  were prosody-fragile and covered only 3 locations. Alternative rejected: max(gap, authored) —
  Daniel ruled stacking.
- **Chapter cards are own scenes** [Daniel ruling]: fully opaque full-frame near-black text scenes
  (channel font), not floating overlays. Engine realization: plan-level `cards[]` →
  `apply_cards()` aligns each card to its co-located spliced pause window, so the card occupies its
  own silence and causes ZERO downstream retime; `post_vo_hold_s` holds the end card 4s past the
  closing VO. Card titles are Daniel's verbatim. Alternative rejected: cards as timeline shots
  (would retime every downstream anchor on any card-length change).
- **SFX real-duration windows + `fade_out_s`**: the hard 2s SFX window caused audible chops; cues
  now play to their real duration with an optional authored fade, plus a tail-overshoot WARN audit.
- **Delta-shot own-frame guard** (`build_motion.py`): a reveal shot without its own image can never
  silently inherit the previous plate — the paradise one-beat-late root cause, fixed in logic.
- **Trio anchor disambiguation**: when an anchor word occurs twice in the VO, pin cues/pops via
  unique consecutive n-grams ("Colombia, Peru, Chile, showed") — candidate §G lint rule.
- **Music lane** [Daniel rulings R8-A/C]: Cheery Monday (1:17–4:08 register) replaces the vocal
  middle bed (demucs-verified vocal-free); Monkeys Spinning Monkeys runs from "After the news
  broke" to the END — somber tail + final dry span deleted. Heavier crack-2 + higher halo_vocal-2
  retracked into the pools (measured picks: f0/centroid).
- **Script cuts accepted at cost of full VO re-synthesis** (3 cuts + new closing line): whole-video
  prosody re-rolled — flagged as the top ear-gate item on the R8 board.
- **Status:** R8 rendered + verified (544.6s, −14.58 LUFS, all gates green); §G codification of
  R6–R8 learning candidates queued for a dedicated session after Daniel's gate.

## 2026-07-17 — Poyais R9: audio doctrine + card typography (Daniel-confirmed)

- **Audio doctrine (channel defaults, codified in audio-director `grammar-guidance.md`):**
  (a) the human-cost `dry` pull-back is RETIRED — music runs through human-cost sections;
  register comes from track choice/level, not silence. (b) Universal card law: music fades out
  (~1.2s) into every title card, silence during the card, next bed on the first post-card shot —
  never a bed over a card, never a hard cut in; END card exempt (finale bed carries the outro).
  (c) Variety law: no single bed unbroken for 3+ min — change track at a major narrative pivot.
  *Rejected:* keeping dry-on-human-cost (the silence read dead); one ~181s Cheery Monday block
  ("too much of the same audio gets pretty tiring").
- **Title-card typography LOCKED (board rounds 1-3):** Ink Free, Title Case, **104px @1080p,
  bold via 2.5px text-stroke**, cream #fffdf7 on #151310. The original 96px was an ungated
  component default. *Rejected:* stamp-register cards (baked-image route, unpicked), ALL CAPS,
  156-184px sizes, pure-#000/#fff "sharper" (unpicked), 112px (a touch big at full-screen).
- **Stamp/slam overlays FREEZE at impact** (engine: position co-terminates with the fade-in,
  clamped) — "hit and stay" ruling; the R8 durationInFrames freeze missed the settle path.
- **Q24 "cuts and cuts again" fixed as CADENCE, not engine:** a 1.953s delta (L95) between
  near-identical rainy-camp frames read as a stutter — cut folded (shot deleted, prior delta
  holds through the line). Lesson: near-identical delta frames must not carry sub-2s cuts.
- **§G candidates parked for the post-gate codification session:** viewer-readable diegetic
  text beats physics (the L32 upside-down signature; also: sticky baked text resists worded
  regen deltas — deterministic pixel-surgery on the best candidate is the proven fallback);
  fresh-eyes disagreement rule (R1 caught what R3 passed — orchestrator eyeballs the tiebreak).

## 2026-07-18 — Poyais R10: VO splice root-cause fix + long-fade audio doctrine (Daniel-directed)

- **VO "cuts" root-caused and fixed in the engine, not the artifact.** Measured diagnosis: the
  R8-B additive sentence-gap law cut the VO at nominal ElevenLabs word ONSETS (truncating voiced
  tails — "spo—t") and spliced −120 dBFS digital silence into live room tone at all 83 sentence
  boundaries; raw vo.mp3 was clean (TTS + voiceover skill were fine). Fix (breath.py):
  (a) valley cut — cut at the measured RMS minimum near the boundary; (b) sentence law is now
  PAD-TO-TARGET (total gap up to 0.65s / 0.45s chained; insert only the shortfall) — the additive
  +0.5s doubled natural pauses; (c) gaps fill with sampled room tone, never digital silence
  (authored card/beat pauses keep their durations); (d) NEW splice-continuity gate in
  audio_checker (FAIL > −30 dBFS pre-cut), wired into render QA via build_motion. Census after:
  truncations 4→0, −120 dBFS holes 83→0, sentence insertion 41.5s→5.65s, VO 524.3→488.5s.
  *Rejected:* longer splice fades alone (measured: a 0.10s fade against room tone carved 17 new
  silent notches — shipped 0.02s declick on the room-tone path instead); hand-patching cited sites.
- **Music fades are LONG by default (channel doctrine):** music_fade_s 0.5/0.9 → 1.2/2.5,
  track_switch_gap_s 0.8 → 1.2, card fades 1.2 → 2.5, post-prince outgoing bed 3.0s per-cue.
  Codified in audio-director grammar-guidance. *Rejected:* per-cue hand-tweaks (Daniel: "we've
  built out skills for a reason"); per-cue fade_in_s engine key (global default bump sufficed).
- **music_present_db 9 → 10** (−1 dB, "not by too much"). **halo_vocal pool reverted to
  halo_vocal-1** (Daniel prefers the pre-R8 lower ahh). **Floating-book ahh is ONE sustained
  composite** (halo_vocal_book-1 = halo_vocal-1 ×5, acrossfade-chained back-2/3, 4.44s, scoped to
  L36 only) replacing the R9 3-link chain that re-triggered and spilled two scenes; rebuilt from
  ×6 to ×5 when the pad-to-target timeline shrank L36 (ring-tail caught by the M20 dry-run warn).
  Five-star boom SFX removed (visual slam stays).
- **Visual regens through the skills** (visual-prompt-writer → seeded forge.py): L11 + L54 on the
  crowd rig (crowd-exemplar seed dominant; hardened zero-facial-hair/uniform-scale negation);
  L75 Colombia/Peru/Chile regenerated FRESH off the base rig (R9's "REUSE - on-rig" note was a
  mis-inspection — struck in the manifest); slim flat-cel L27 arrow at [0.302,0.42] hf 0.085.
  Reviewer-disagreement tiebreaks (nose claim, glossy-vs-flat direction) resolved by orchestrator
  pixel-scan + eyeball per the R9 rule; Chile neck chroma removed by deterministic despill.

## 2026-07-21 — Metadata teardown → doctrine + Poyais re-upload

- **Opening lead-in REJECTED by measurement:** 6 top videos (Crayon/HMW/Boyle) all land the first
  spoken word at 0.16–0.48s — no intros, no logo stings, no music-only lead-ins anywhere in the
  cohort. Poyais's 0.12s instant start IS the genre convention; the levers that matter are a
  hook-relevant 0:00 frame (ours is) and a ~0.3s breath after the hook sentence (ours has it).
  *Rejected:* adding a 0.5–1s settle/ambience lead-in (refuted by the data before build).
- **Metadata teardown (36 videos / 9 board channels) → `channels/the-second-take/research/
  metadata-teardown-2026-07-21.md`**, routed into `metadata-writer`: hashtags 0–3 default 0 (dead
  in genre, 6/9 channels use none); alternate-titles block = title_challengers as bare description
  bottom lines (Magnates move); chapter labels ≤5-word curiosity punches; pinned = warm engagement
  pin (future sponsor slot); tags/sources/AI-disclosure/hook-above-fold confirmed unchanged.
  *Rejected:* HMW script-excerpt SEO tail (slop against the humanize pass), Crayon
  "may-contain-inaccuracies" hedge (spends the trust the accuracy leash buys), competitor-name tags.
- **Chapters must ship MEASURED — enforced:** poyais went live with estimated chapters drifting up
  to ~31s. metadata-writer now specifies re-timing from motion-json per-shot starts;
  `compliance-check` FAILs `estimated…` chapters_status or desync'd description/array lines
  (+2 tests, 22 pass).
- **Poyais re-uploaded private as `tVmQR0pfp-Q`** (same final.mp4 SHA, new metadata: measured
  chapters, short labels, no hashtags, alt-titles block). Old `8Rv5SwFiZ4Y` superseded — record
  archived; Daniel deletes it in Studio + redoes thumbnail/A-B/pin/flip on the new ID.
