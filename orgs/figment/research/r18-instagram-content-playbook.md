# r18 — Instagram content playbook (stages 7–9)

Compiled 2026-09-03. Feeds MANDATE stages 7 (content strategy), 8 (post + measure), 9 (optimise),
§"Content-mix and carousel capability", §"Template catalogue".

Method: the fifteen reference accounts were viewed read-only in the operator's signed-in Chrome, in
my own tabs, closed on exit; his tabs untouched. No login, no likes, comments, follows, DMs, saves,
story or highlight opens, and nothing downloaded. First grid page per account (171 tiles total) plus
11 opened post pages. Platform/API/playbook facts come from public web sources, cited in §8.
Per-account rows below carry format and cadence facts only — no appearance data; the register lives
in `pipeline/look-spec-v2.md` and is not restated. Extends `r3-posting-metrics.md` (API/publishing)
and `r5-meta-ai-policy.md` (labels/enforcement); neither is repeated here.

**Headline finding.** The cohort is a **carousel-first** set, not a reels-first one: 61% of first-page
tiles are carousels, 21% single stills, 18% reels. Carousels are small — 2–5 slides, median 4 — so they
are *photo dumps*, not slide decks. Reels are very short (5–9 s observed). Captions are 1–6 words.
Hashtags appear on reels only. This is a materially different shape from the "7–10 slide educational
carousel + 30 s reel + 20 hashtags" doctrine the marketing web sells, and our templates follow the
cohort, not the blogs.

---

## §1 Content-mix taxonomy for creator 001

Categories, sized so the generator knows what to make each week. "Unit" = one published post;
"stills" = images the pipeline must render (a 4-slide carousel costs 4).

| Code | Category | What it is | Persona in frame | Cost |
|---|---|---|---|---|
| A | Persona-at-angles | selfie / mirror / half-body, one look one light, several angles | yes | high (identity pass) |
| B | Outfit | full-body OOTD, styling detail crops | yes | high |
| C | Room / place | bedroom, desk, street, car interior, café interior | no / partial | low |
| D | Food & drink | plate, coffee, convenience-store haul | no | low |
| E | Flatlay | outfit laid out, bag contents, jewellery, makeup | no | low |
| F | Aesthetic filler | sky, texture, neon at night, flowers, blurred motion | no | lowest |
| G | Motion | reel-native: turn, walk, dress change, GRWM | yes | video pass |

### Target weekly mix — steady state (from week 3)

7 units/week = **3 reels + 3 carousels + 1 single**. Ratio chosen to sit between the cohort's
carousel dominance (their saves/engagement engine) and the reach advantage reels hold for an account
with no audience yet (§8 C7).

| Unit | Type | Composition | Category share |
|---|---|---|---|
| 1 | Reel | outfit turn or dress change | G |
| 2 | Carousel ×4 | A,A,B,C — photo dump | A/B heavy |
| 3 | Single | the week's strongest persona still | A |
| 4 | Reel | mirror pan / POV caption-led | G |
| 5 | Carousel ×4 | B,B,E,D — outfit set | outfit-led |
| 6 | Carousel ×5 | A,C,D,C,A — place set | lifestyle-led |
| 7 | Reel | walk-away / street | G |

Per week that is **14 stills + 3 short videos**. Category split of the stills: A 36%, B 21%, C 21%,
D 14%, E 7%, F as substitution stock. The non-persona slots (C/D/E/F ≈ 43%) are the cheap half —
they carry no identity risk, need no face detailer, and are what makes a 7-post week affordable.

### Per-platform variants

| Surface | Aspect | Notes |
|---|---|---|
| IG feed still / carousel | **3:4, 1080×1440** | measured 0.750 on every sampled feed still; render at 3:4 so the grid tile is uncropped |
| IG reel | 9:16, 1080×1920 | measured on all three sampled reels |
| IG story | 9:16 | safe zone: keep text/CTA out of top 250 px and bottom 320 px |
| TikTok | 9:16 only | re-cut from the reel master; no IG watermark, no IG-placed text; carousels convert to a photo-slideshow post |
| Fanvue | separate store, operator tier | mix not covered here |

---

## §2 Carousel slot templates

Slot 1 carries the post: it is the feed cover *and* the grid tile. Rule for every template: **slot 1
is the frame you would have posted alone; never open on filler.** Put the second-strongest at slot 2
(the re-serve claim in §8 C9 is weakly sourced, but the cost of obeying it is zero). Cap at 5 slides —
the cohort never exceeded it in the sample.

| ID | Type | Slots | Slot roles | Ordering rule | Caption rule | Use when |
|---|---|---|---|---|---|---|
| CT-1 | Photo dump | 4–5 | 1 hero A · 2–3 alt-angle A · last C/D/F | strongest → alt angles → cheap close | 1–4 words, lowercase, no period | default weekly carousel |
| CT-2 | Two-frame beat | 2 | 1 hook A · 2 punchline (expression flip / reveal) | setup → payoff, always exactly 2 | one joke line | cheapest unit; use to hold cadence |
| CT-3 | Outfit set | 3–4 | 1 full-body B · 2 half-body B · 3 detail crop · 4 flatlay E | wide → close → object | name the pieces (caption keywords are the SEO surface) | OOTD / new wardrobe family |
| CT-4 | Same-look grid | 4 | four angles of one look, one light | hero → widest → closest → off-guard | 1–2 words | identity reinforcement; also our best consistency evidence |
| CT-5 | Place set | 4–5 | 1 A in place · 2–3 C/D of the place alone · last A | open and close on the persona | place name or a question | lifestyle credibility on a cheap slot budget |
| CT-6 | Swipe-reveal | 2–3 | 1 covered/plain · last the payoff | payoff always last | 2–4 words teasing the swipe | ≤1×/fortnight; payoff is an **outfit** reveal, never skin (§8 C13) |
| CT-7 | Grid triptych | 3 | three frames built to sit adjacent in the profile grid | composed for the grid, not the swipe | none or one emoji | when curating the grid (rearrangement is in use across the cohort) |

### External catalogues, studied as patterns (nothing installed, nothing bought)

Every public carousel catalogue we surveyed teaches the **marketing** archetype — Hook slide →
N value slides → CTA slide, 7 slides, at PromptBase, Contentdrips and the AIPRM prompt store alike —
and the published taxonomies (educational/how-to, listicle, before-and-after, myth-vs-fact,
did-you-know, quiz, case study, data viz, product showcase) are B2B and creator-educator shapes.
**None of it fits a persona feed**, and our cohort does none of it. Only two archetypes cross over:
*photo dump* (which Canva flags as a 2026 saves/shares driver) and *before-and-after*, and both are
already CT-1 and CT-6. This is the main reason §2 is derived from the cohort rather than from the
catalogues.

What *is* worth lifting is the **shape of the catalogues, not their content**: the commercial packs
(Whop, Etsy, Gumroad AI-influencer prompt packs) are uniformly built as **theme × variable slots** —
a theme page (beauty, fashion, lifestyle, fitness, travel, luxury, nightlife, urban street) crossed
with per-shot variables (pose, outfit, background, mood, lighting) — rather than as fixed scenes.
That is the right data model for our template catalogue too: templates carry roles and variables,
and the persona's locked register fills them. The operator's own 10sorlabs package ships a
**"Viral Carousel Generator"** and a **"Social Media Growth"** Instagram/TikTok playbook module
(catalogued in `r14-10sorlabs-package.md`) — those are the two modules to re-implement natively
against §2/§3 rather than a generic carousel prompt.

---

## §3 Reel format templates

Manifest-ready. Every row: 9:16, 1080×1920, 30 fps, loud-normalised to −14 LUFS, burned captions off
by default (the cohort burns nothing).

| ID | Length | Hook (0–1 s) | Cuts | Audio | Text overlay | CTA |
|---|---|---|---|---|---|---|
| RT-1 outfit turn | 6–8 s | already mid-turn on frame 1, no build-up | 0–1 | licensed track, land the turn on the drop | none | none |
| RT-2 mirror pan | 5–7 s | phone already raised, camera moving | 0 | licensed track | none | none |
| RT-3 dress change | 8–12 s | first look held 1 s | 1 match-cut on beat | licensed track | none | none |
| RT-4 GRWM compressed | 12–20 s | bare-face frame 1 | 4–6 | original audio + low bed | 3-word step labels | one soft CTA |
| RT-5 POV caption-led | 6–10 s | static shot, line already on screen | 0 | original audio | one line, ≤7 words, upper third | question line invites comments |
| RT-6 walk-away | 8–12 s | motion already underway | 0–1 | licensed track | none | none |

Rules from the sample: **no build-up frames** — every observed reel opens already inside the action;
5–9 s is the cohort's own centre, so start there and only extend for RT-4. Loop cleanly (last frame
matches first) on RT-1/RT-2/RT-6 — replays count toward watch time (§8 C4).

---

## §4 Cadence and warm-up

**Documented vs folklore, explicitly.** Instagram publishes *no* new-account warm-up schedule and no
daily follow/like/DM rate table; every specific number in circulation comes from proxy and
automation vendors (§8 C15). What *is* documented: the 7,500 total-follow ceiling, the Graph API
limit of 100 API-published posts per rolling 24 h read live from `GET /content_publishing_limit`
(r3 §1), and the Messaging API's 24-hour interaction window (§8 C19). The day-by-day plan below is a
deliberately conservative operating schedule, not a platform rule.

### Days 1–14

| Day | Posts | Stories | Other |
|---|---|---|---|
| 1 | 3 (CT-4 · single · CT-1) so the grid is not empty | 2 | profile complete: bio, **AI-generated-profile label**, bio link, no highlights yet |
| 2–3 | 0 | 2/day | reply to comments only; no follows |
| 4 | 1 reel (RT-1) | 2 | first highlight created |
| 5–6 | 1 carousel (CT-2) | 2/day | — |
| 7 | 1 reel (RT-2) | 2 | week-1 Insights snapshot (thin, expect noise) |
| 8–10 | 1/day alternating carousel · reel | 2/day | second highlight |
| 11–14 | 1/day, mix per §1 | 2–3/day | switch posting times to own Insights once ≥10 posts have 48 h of data |

Cumulative by day 14: ~13 posts. No DM automation, no comment-to-DM flow, and no scheduler
connection in weeks 1–2 — the only genuinely load-bearing convention in the warm-up folklore is
"don't look automated before you look human", and it costs nothing to honour.

### Weeks 3–8

Steady state §1: 7 units/week, 2–3 stories/day, one broadcast-channel post/week once the channel
exists. Re-mix from week 5 on measured data (§6), not on the plan.

### Timing

Start from the published windows — Tue/Wed strongest, 11:00–18:00 local, with Later's outlier
finding that reels and carousels peak at very different hours (§8 C11) — and treat them as a seed
only. From day 14 the rule is: post at the account's own top-two `reach`-by-hour windows from
Insights, one primary and one secondary, re-derived monthly. Every source that publishes best-time
data says the same thing about its own data.

---

## §5 Caption, hashtag, audio, CTA, and disclosure rules

**Caption.** Default 1–6 words, lowercase, no terminal period — the cohort's observed median is about
three words ("Meow🖤", "green light", "Too pretty not to post."). One **question caption per week**:
the single clearest comment-driver observed was a direct question to the reader, which produced a
thread of substantive replies rather than emoji ("Would you trust me to plan our next adventure?",
`kimvinabun`, 2026-09-02). One long diary-voice caption per fortnight is on-register (`ja.dey` runs
~250-character rambles) and is where caption keywords can live.

**Hashtags.** Cohort split is sharp: **0 hashtags on stills and carousels**, 3–5 on reels. Follow it.
Reel hashtags are niche and topical (`#ootd`, `#gwenstacy`, `#chainsawman`) — never the broad-spam
family (`#viral`, `#trending`, `#explore`), which appears in the cohort but is a documented
spam-pattern risk for us (r5 §6). Hashtags no longer drive distribution (Mosseri, Jul 2026, §8 C5);
the actual discovery levers are caption keywords, alt text, and the location tag. **Set alt text on
every published still** — it is free, indexed, and we control it.

**Location tag.** Used across the cohort (New York / NYC / America). Tag every feed post with the
persona's home city. Cheap surface, no downside.

**Audio.** Mixed in the cohort — original audio on two sampled reels, a named licensed track on a
third; nobody is chasing trends. Rule: licensed track for RT-1/2/3/6, original audio for RT-4/5.
Discovery path when a trend is wanted: tap the audio name on any reel → audio page shows use count
and an upward arrow when trending; Professional Dashboard → Tips and resources → Trending Audio for
the curated list (§8 C6). Save audios rather than chase them.

**CTA.** The cohort's funnel is **bio + highlights**, not captions — link-in-bio hubs (`hoo.be`,
`linktr.ee`, `oopsie.bio`, `link.me`) plus a highlight literally named for the link. Copy that
shape. At most one caption CTA per week (RT-4/RT-5 only). No comment-to-DM automation before week 8;
when it is added, it must be comment-triggered inside the documented 24-hour window (§8 C19), never
cold DMs.

**AI disclosure — four placements, all mandatory.**

| Placement | Mechanism | Timing | Note |
|---|---|---|---|
| Account | "AI-generated profile" label in profile settings | before post 1 | skipping it costs Explore/Reels non-follower recommendation eligibility (r5 §2) |
| Bio | one plain line, persona voice | before post 1 | cohort precedent exists in the inverse: one account's bio reads "Not AI 🖤" |
| Per post | `is_ai_generated: true` on the media container | **at container creation, before `media_publish`** | cannot be added or removed after publishing; on carousels the flag lives on the parent only, children are excluded (r5 §1) |
| Manifest | `persona.is_ai_generated` field carried into the publish call | build time | makes the flag a property of the persona, not a per-call decision an operator can forget |

Observed and worth logging: the one cohort account the operator has identified as AI-generated
carries **no AI-info label and no bio disclosure** as of 2026-09-03 — i.e. exactly the profile class
the 2026-08-31 policy targets, still unlabelled because enforcement has not begun (§8 C2).

---

## §6 KPIs, Graph API fields, attribution

Current API is **v26.0** (2026-07-29). `impressions`, `plays`, `video_views`,
`clips_replays_count` and `ig_reels_aggregated_all_plays_count` are **deprecated** — `views` is the
successor across all surfaces (§8 C20). Do not build against the dead names.

### Per-media pull (nightly at +24 h, +48 h, +7 d)

| Field | FEED (image/video/carousel) | REELS | STORY |
|---|---|---|---|
| `views` | ✓ | ✓ | ✓ |
| `reach` | ✓ | ✓ | ✓ |
| `likes` `comments` `shares` `saved` `total_interactions` | ✓ | ✓ | shares only |
| `follows` `profile_visits` `profile_activity` | ✓ | — | ✓ |
| `ig_reels_avg_watch_time` `ig_reels_video_view_total_time` | — | ✓ | — |
| `reels_skip_rate` | — | ✓ (estimated) | — |
| `navigation` `replies` `link_clicks` | — | — | ✓ |

Account level `/{ig-user-id}/insights`: `reach`, `views`, `accounts_engaged`,
`total_interactions`, `follows_and_unfollows` (needs ≥100 followers), `profile_links_taps`,
`saves`, `shares`, `likes`, `comments`, `replies`, `reposts` — most require
`metric_type=total_value`; `media_product_type`, `follow_type` and `contact_button_type` breakdowns
are what let us attribute reach to format. Demographics via `follower_demographics` and
`engaged_audience_demographics` (`period=lifetime`, breakdowns age/city/country/gender, ≥100
followers, top 45 segments only). Scopes: `instagram_business_basic` +
`instagram_business_manage_insights` on the Instagram Login path. Data lags up to 48 h — never grade
a post before +48 h. Rate limit is the Business Use Case formula (4800 × 24 h impressions), not a
flat cap.

### The KPI set stage 9 actually optimises on

| KPI | Formula | Drives |
|---|---|---|
| **Sends per reach** | `shares` ÷ `reach` | the single most-cited non-follower-reach signal; the primary format score |
| **Saves per reach** | `saved` ÷ `reach` | carousel template ranking |
| **Follows per reach** | `follows` ÷ `reach` | which template converts a viewer into an audience |
| **Watch-through** | `ig_reels_avg_watch_time` ÷ duration | reel length and hook decisions |
| **Skip rate** | `reels_skip_rate` | first-frame (hook) quality |
| **Non-follower reach share** | `reach` breakdown by `follow_type` | whether recommendation eligibility is intact — our shadowban/AI-label canary |
| **Profile→link rate** | link clicks ÷ `profile_visits` | bio and highlight funnel |
| **AI-suspicion rate** | manual/classifier tag over pulled comment text | MANDATE stage 8 explicitly wants this logged |

Comment sentiment is **not** an API field — Meta gives the raw comment stream (`/{media-id}/comments`,
plus `comments`/`mentions` webhooks); we classify `text` ourselves.

### Attribution

`website_clicks` was deprecated 2025-01-08 with no clean successor; `profile_links_taps` returns an
aggregate tap count with a `contact_button_type` breakdown and **no destination detail**, so it
cannot carry per-door attribution on its own. Use it as a denominator only. The working method
(consistent with r3 §6): one short link per door on our own domain, UTMs on every URL, click series
pulled from the shortener API (Short.io or Bitly both expose per-link time series, geo and device),
and the persona/media-id/batch join kept in figment rather than at the shortener. Instagram does
**not** strip UTM parameters from bio or story links, but its in-app browser drops the `Referer`
header — so referrer-based attribution silently buckets as Direct and UTMs are the only reliable
mechanism.

**What "optimise" adjusts, in order:** (1) the §1 weekly mix, by format sends-per-reach and
follows-per-reach; (2) the §2/§3 template ranking, retiring the bottom template each month;
(3) posting windows, from the account's own reach-by-hour; (4) reel length band, from watch-through;
(5) slot-1 selection policy, from carousel reach vs the same still posted alone.

---

## §7 Cohort evidence table

First grid page each, observed 2026-09-03. Format and cadence facts only. "Grid" = tile counts on
the first page (pinned tiles counted under stills unless a format icon said otherwise).

| Handle | Followers / posts | Grid mix | Cadence (from visible dates) | Format facts | Visible performance |
|---|---|---|---|---|---|
| `murayunaki` P | 193K / 13 | 6 car · 5 still · 1 reel | ~2026-06-19 → 09-01, every 5–10 d | 2-slide carousels; reel 5.7 s 9:16; captions 2–3 words; location-tagged | like counts hidden — evidence unavailable |
| `wox4ever` P | 100K / 12 | 10 car · 1 still · 1 reel | 2024-04 → 2025-11, then dormant 10 months | carousel-only feed; sole reel carries 5 broad hashtags | not readable |
| `yunareix` P | 157K / 25 | 6 car · 4 still (3 pinned) · 2 reel | 2026-01 → 09-02, ~2/month, reels clustered at the top | reel 8.4 s 9:16, named licensed track; reel caption is a hook line ("Showing you my favorite dress") | counts not shown on reel |
| `r.evrii` P | 41.6K / 36 | 3 car · 9 reel | 2025-10 → 2026-08, bursty | **most reel-forward primary**; "Original audio"; captions 2–4 words, self-deprecating | hidden |
| `ellllybaby` P | 95.3K / 6 | 4 car · 1 still · 1 reel | 2026-04-26 → 09-02, ~1/month | whole public grid is 6 posts at 95K followers — reach without volume | hidden |
| `shirleypunn` P | 250K / 51 | 10 car · 2 reel | grid **non-chronological** (manually rearranged); bio admits "all my post are 5 months late" | 4-slide carousels; reels 6.3 s, "Original audio", 4–5 niche hashtags; carousel captions 2 words | reel **1,734 likes @12 h** (0.69% of followers); carousel **6,512 likes @5 w** (2.6%) — the only account where both are readable |
| `kimvinabun` S | 51.3K / 46 | 10 still · 2 car | **near-daily** (Aug 22,24,25,26,27,29,29,30,31, Sep 1,2) | highest cadence in the pool and the only stills-first grid; 3:4 stills | question caption drew a thread of real answers — clearest comment-driver observed; like counts hidden |
| `sera.changg` S | 85.4K / 29 | 9 car · 2 still (pinned) · 1 reel | 2026-08-04 → 09-02, every 2–3 d | 2-slide carousels; NYC location tag; caption "Too pretty not to post." | hidden |
| `rinhyami` S | 41.3K / 13 | 11 car · 1 reel | 2026-03-30 → 09-02, ~2/month | carousel-only; two tiles are collab posts co-authored with a second account | hidden |
| `vampeess` S | 65.2K / 99 | 9 still · 1 car · 2 pinned | **near-daily** (Aug 21 → Sep 2) | stills-first, like `kimvinabun`; highest post count of the near-daily pair | hidden |
| `meowriff_` S | 160K / 14 | **12 car / 12** | 2024-12 → 2026-09-02, grid non-chronological | 100% carousel, 4 slides, caption "Meow🖤" | counts hidden; comments are compliment-only |
| `nekoatnight` S | 241K / 9 | **9 car / 9** | 2025-12 → 2026-07-16, ~1/month | 100% carousel; entire public grid is 9 posts at 241K | hidden |
| `ari_n3ko` S | 791K / 99 | 10 reel · 2 still (pinned) | 2026-07 → 09, several per week | **most reel-forward account in the pool**; templated caption "<name> 🖤 / Follow @… for more 🖤 / #<series>"; bio states "Not AI 🖤" | hidden |
| `onlineoyuki` S | 695K / 60 | 10 car · 2 reel | 2026-02 → 09-02, non-chronological grid | reel caption uses dot-spacers before 5 broad hashtags; one collab reel | hidden |
| `ja.dey` S | 795K / 89 | 11 car · 1 reel | 2025-12 → 2026-07, non-chronological grid | 5-slide carousels; long diary-voice captions (~250 chars) — the pool's caption outlier | hidden |

P = primary, S = secondary (per look-spec-v2 §0).

**Aggregate over 171 tiles: 104 carousel (61%) · 36 still (21%) · 31 reel (18%).**
Carousel slides sampled: 2, 2, 4, 4, 5 (median 4). Reel durations sampled: 5.7 s, 6.3 s, 8.4 s.
Feed still aspect measured: 0.750 (3:4) in every case. Four of fifteen grids are visibly
non-chronological, so **grid rearrangement is normal practice in this cohort** and slot-1 thumbnails
are a curated design surface, not just a byproduct.

---

## §8 Claims table

| # | Claim | Source | Date | Conf |
|---|---|---|---|---|
| C1 | Instagram will limit recommendation reach for AI-person profiles that skip the "AI-generated profile" label; labelled profiles are not penalised | [TechCrunch](https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/) | 2026-08-31 | high |
| C2 | Enforcement (detection + owner notification) begins "in the coming weeks" — not active yet | TechCrunch, as above | 2026-08-31 | high |
| C3 | No creator-reported reach data yet exists on that policy; best-known AI personas had not applied the label within hours of the announcement | [implicator.ai](https://www.implicator.ai/instagram-will-cut-the-reach-of-ai-personas-that-skip-its-new-label/) | 2026-09-01 | medium |
| C4 | Watch time (incl. replays), likes-per-reach and sends-per-reach are the signals Mosseri discusses most; "views" is the unified *reported* metric, not a ranking signal | [Social Media Today](https://www.socialmediatoday.com/news/instagram-updates-metrics-to-focus-creators-on-views/723645/); Mosseri Jan-2025 statement as paraphrased across trade blogs | 2025-01 / 2026 | medium — the original Mosseri statement could not be reached; the "3–5× vs likes" multiplier in circulation is **unsourced, do not cite** |
| C5 | Hashtags do not drive distribution; Mosseri: "I wouldn't try to think of hashtags as a way to get more distribution" | [Kontentino](https://www.kontentino.com/) / Digital Diplomacy citing a Jul-2026 Mosseri Q&A | 2026-07 | medium (quote consistently attributed, original not reached) |
| C6 | Hashtag-following was removed | [Social Media Today](https://www.socialmediatoday.com/news/instagrams-removing-option-follow-hashtags/733155/) | 2024-11-17 (article); effective ~2024-12-13 per secondary sources | high for the follow-removal; the "Recent" tab clause is dropped — the cited article does not mention it, and hashtag pages' "Recent" tab has its own unrelated 2020/2022 history (see §8 claim-check) |
| C7 | Reels out-reach carousels ~1.36× and single photos ~2.25× (Buffer, 4M+ posts) | Buffer analysis, seen paraphrased | 2026 | medium |
| C8 | Carousels beat reels and single images on engagement *rate* (~0.55% vs ~0.50% vs ~0.36%) and generate far more saves | Socialinsider 2026 benchmark; [Metricool 2026 IG study](https://metricool.com/press-release-instagram-study-2026) | 2026 | medium |
| C9 | Instagram re-serves a carousel to non-swipers ~24–48 h later, sometimes on a later slide | multiple marketing blogs, no Instagram source | 2026 | **low — folklore; obeyed only because it is free** |
| C10 | Optimal carousel slide count 7–10 | vendor blogs, mutually contradictory (5–8 / 7–10 / 8–12) | 2026 | **low — and contradicted by our own cohort measurement of 2–5** |
| C11 | Best days Tue/Wed (Sprout) or Mon/Tue/Thu (Hootsuite); Later finds reels and carousels peak at very different hours; every source says account data overrides | [Hootsuite](https://blog.hootsuite.com/best-time-to-post-on-instagram/), [Sprout Social](https://sproutsocial.com/insights/best-times-to-post-on-social-media/), [Later](https://later.com/blog/best-time-to-post-on-instagram/) | 2026 | medium-high for the caveat, medium for the windows |
| C12 | Reel completion falls sharply with length (~74% at 7–15 s vs ~46% at 60 s+) | vendor benchmark pages, numbers vary by source | 2026 | low — directional only |
| C13 | Sexually-suggestive-classified content (incl. plain swimwear) is excluded from Explore/hashtag recommendation to non-followers but still reaches existing followers | [Instagram Help Center](https://help.instagram.com/251027992727268); [WWD](https://wwd.com/fashion-news/intimates/feature/instagram-policy-demotes-sexually-suggestive-photos-1203132041/); [Fox News](https://www.foxnews.com/lifestyle/lingerie-swimwear-company-instagram-algorithm-inappropriate-concerns) | 2019–2026 | high |
| C14 | Account Status (Settings → Account → Account Status) shows content violations, feature restrictions, recommendation eligibility, monetization access; appeal is in-app | inro.social, user-rights.org summarising Instagram's Recommendation Guidelines | 2026 | medium |
| C15 | Instagram publishes **no** new-account warm-up schedule and no daily follow/like/DM limits; the 7,500 total-follow ceiling is real | negative finding across all searches; circulating numbers trace to proxy/anti-detect-browser vendors | 2026 | high as a negative finding; **low** for every specific warm-up number |
| C16 | Instagram broadcast channels: professional accounts, up to 5 channels, 1,000-char limit, follower minimum largely removed | Sendible, NapoleonCat | 2026 | medium (no Meta doc reached) |
| C17 | Published bio-link conversion-rate benchmarks do not exist; circulating "40–80% lift" figures are vendor copy | negative finding | 2026 | high as a negative finding |
| C18 | EU AI Act Art. 50 transparency obligations apply from 2026-08-02; AI content resembling a real person must be disclosed clearly on first exposure; penalties to €15M / 3% turnover | [EU AI Act Art. 50](https://artificialintelligenceact.eu/transparency-rules-article-50/); [EC FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) | 2026 | high |
| C19 | Meta Messaging API: 24-hour interaction window, 100 calls/s for text/link messages, 750/h for private replies to comments; comment-to-DM tools are compliant only because they are comment-triggered | [Meta rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) | rolling | high for the API limits, medium for the tool convention |
| C20 | v26.0 is current (2026-07-29); `impressions`/`plays`/`clips_replays_count`/`ig_reels_aggregated_all_plays_count` deprecated at v22.0 with an all-versions cutoff 2025-04-21; `video_views` dead after 2025-01-08; `views` is the successor | [IG media insights reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/); [changelog](https://developers.facebook.com/docs/graph-api/changelog) | 2025–2026 | high |
| C21 | `website_clicks` deprecated 2025-01-08 with no direct successor; `profile_links_taps` gives an aggregate tap count with `contact_button_type` breakdown and no destination detail | Meta account-insights reference | 2025 | medium-high |
| C22 | Instagram does not strip UTM parameters from bio/story links, but its in-app browser drops the `Referer` header, so referrer attribution buckets as Direct | [flyn.to](https://www.flyn.to/blog/instagram-in-app-browser), [Ruler Analytics](https://www.ruleranalytics.com/blog/social-media/track-instagram-traffic/) | 2026 | medium (third-party corroborated, no Meta doc) |
| C23 | No published content-mix ratio exists for virtual-influencer accounts; general creator rules (80/20, 4-1-1) are 2010s marketing heuristics with no canonical study | negative finding across agency/trade sources | 2026 | high as a negative finding |
| C24 | Trending-audio discovery path: tap the audio name on a reel → audio page (use count, upward arrow when trending, Save/Use); Professional Dashboard → Tips and resources → Trending Audio | SocialPilot, heytrendy, consistent UI descriptions | 2026 | medium |
| C25 | Cohort tile mix 61% carousel / 21% still / 18% reel; carousel slides 2–5 (median 4); reels 5.7–8.4 s; feed stills 3:4 | direct observation, 171 tiles + 11 post pages, this report §7 | 2026-09-03 | high for what was measured; sample is first-grid-page only |
| C26 | Every public carousel-prompt tool defines the same archetype: Hook slide → N value slides → CTA slide, typically 7 slides | [PromptBase](https://promptbase.com/prompt/instagram-carousel-post-generator-2), [Contentdrips](https://contentdrips.com/blog/2023/05/create-carousels-using-chatgpt/) | 2023–2026 | high |
| C27 | Published carousel archetypes are educator/B2B shapes (how-to, listicle, before-after, myth-vs-fact, did-you-know, quiz, case study, data viz, product showcase); only photo-dump and before-after transfer to a persona feed | marketersclique taxonomy; Canva "Photodump & Listicle Reels" collection | 2026 | medium |
| C28 | Commercial AI-influencer prompt packs are structured as theme pages (beauty/fashion/lifestyle/fitness/travel/luxury/nightlife/street) × per-shot variables (pose, outfit, background, mood, lighting), not as fixed scenes | Whop "Viral AI Influencer Prompt Pack" (~980 prompts / 24 categories), Etsy and Gumroad listings | 2026 | medium (listing descriptions; several pages 403 on direct fetch) |
| C29 | 10sorlabs ships a "Viral Carousel Generator" bonus module and a "Social Media Growth" Instagram/TikTok playbook among 13 modules | [10sorlabs.com/pages/home](https://10sorlabs.com/pages/home) | 2026-09-03 | high |
| C30 | Metricool's 2026 study: carousels ≈2× reach, ≈4× interactions and ≈9× saves vs single-image posts | [Metricool 2026 IG study](https://metricool.com/press-release-instagram-study-2026) | 2026 | medium |

---

## §9 Evidence unavailable

1. **Eromify template catalogue (partial).** Browser navigation to `eromify.com/studio/image` was
   refused by this session's permission classifier, and `https://www.eromify.com/` returns HTTP 403
   to server-side fetches. Only nav- and marketing-level category names were recoverable from the
   search-indexed `.in` mirror — studio sections *Avatar / Templates / Gallery*, niche generator
   pages (*AI Fashion / Fitness / Female / Male / Instagram Influencer*), use-case buckets (*Social
   Media Content, Brand Campaigns, E-commerce Modeling, YouTube & Video, Newsletter & Blogs,
   Faceless Business*), and credit tiers (*Beginner / Creator / Professional / Enterprise*). The
   thing actually wanted — the pose/outfit/scene preset list behind `/avatar/templates` — was not
   read. Needs an operator-run pass or an allow rule. The §2 templates were derived from the cohort
   instead, which is the better ground anyway (see C26–C27).
2. **Like counts** are hidden on 13 of 15 accounts. Only `shirleypunn` exposed comparable numbers
   (reel 1,734 @12 h vs carousel 6,512 @5 w). All per-account "what performs" reads in §7 are
   therefore format-and-cadence inferences, not engagement measurements. Real relative-performance
   data has to come from our own account's Insights, not from this cohort.
3. **Saves, shares and reach are not public on any account** — the three metrics stage 9 cares about
   most cannot be observed externally at all.
4. **Story highlights were not opened** — viewing one leaves a seen-receipt with the account owner,
   which is an interaction. Highlight *titles* were read from profile pages only, so the funnel
   structure inside them is unknown.
5. **Posting hour-of-day** is not exposed on the web grid (dates only, and relative stamps like
   "22h" for recent posts). No cohort timing analysis was possible; §4 timing rests on published
   benchmarks plus our own future Insights.
6. **Instagram Explore / Reels tab were not browsed.** Browsing Explore in the operator's signed-in
   session would train his recommendation profile, which is a change to his account state. The
   platform-trend material in §8 is from public web sources only.
7. **Mosseri's original 2025/2026 statements** (ranking signals, hashtags) could not be reached
   directly; C4 and C5 rest on consistent secondary attribution.
8. **`reached_audience_demographics`** could not be confirmed as a distinct metric name, and the
   `contact_button_type` enum values were not readable from the fetched docs — verify both against
   the live reference before wiring the analytics view.

---

## Claim-check (2026-09-03, sonnet)

Facts-only pass over §8 (C1–C30) and the §6 field list against public web sources
(developers.facebook.com/docs/instagram-platform, help.instagram.com, artificialintelligenceact.eu,
and corroborating outlets). §7 was not re-verified (read-only browser observations, out of scope);
scanned only for internal consistency against §1–§5 — none found (the 104/36/31 tile split sums
correctly to 171; the 2-tile still/car ambiguity traces to `vampeess`'s notation, not a math error).

**Counts:** 30 claims checked + §6 field list. VERIFIED 15 · PARTLY 9 (of which 2 were true
corrections, 7 confirm the report's own existing vendor-sourced hedge) · UNVERIFIED 5 (not
re-fetched this pass, no red flags) · WRONG 0. §6 field list: VERIFIED.

**Corrections made:** C6 (dropped the unsourced "hashtag Recent tab" clause; the cited Social
Media Today article only covers hashtag-follow removal and is dated Nov 17 2024, not Dec 13); C11
(added the missing Later source URL for the reels-vs-carousels-peak-at-different-hours claim).

Full verdict table: `claimcheck-r18.md` (scratchpad, this session).
