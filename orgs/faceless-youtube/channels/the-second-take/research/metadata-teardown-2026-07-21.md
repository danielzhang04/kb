# Metadata teardown — 2026-07-21 (36 videos, 9 reference channels, fetched live)

**What this is.** The packaging half *outside* the pixels — two layers: **per-video** metadata
(descriptions, links, hashtags, tags, chapters, pinned comments, disclosures, creator comment
behavior — 4 long-form videos each, 2 top-view + 2 recent) and **channel-page** packaging (About
description, header links, keywords, trailer, shelves — §Channel-page below), harvested live via
yt-dlp from all 9 board channels (`../reference-channels.md`).
Grounds the description/chapters/tags/pinned rules in `metadata-writer`. Raw JSON archived in the
session scratchpad only; this doc is the durable record. Titles and thumbnails are NOT covered here
(that is `thumbnail-teardown-2026-07-21.md` + `universal.md §3`).

## The one-sentence finding

**Descriptions in this genre are not discovery surfaces — they are a fixed per-channel boilerplate
skeleton with one or two variable slots (sponsor line, video-specific block); discovery is carried
entirely by title + thumbnail, and every "SEO" field (hashtags, tags) is either unused or frozen
boilerplate at the reference tier.**

## Per-channel template (what stays constant vs varies)

| Channel | Skeleton (constant, in order) | Variable slots | Tags | Hashtags | Chapters | Pinned comment |
| --- | --- | --- | --- | --- | --- | --- |
| Crayon Capital | [sponsor] → Google-Doc source link → 4 chapters → ⚠️ simplified-may-be-inaccurate disclaimer → business email → copyright notice → [hashtag row] | sponsor; hook para (older virals only) | 5–24, subject-front-loaded + "oversimplified style" hitchhike | 9 → 0 (dropped in 2026 uploads) | **Always exactly 4**, curiosity mini-headlines | Only when sponsored (= sponsor line dup) |
| How Money Works | sponsor → related link → newsletter/books/Spotify → sister channels → editor/music/footage credits → business email → fair-use + no-advice disclaimer → 3 hashtags → `*** Sources ***` bare-URL list (14–21) → **first ~90s of script pasted verbatim** | sponsor; sources; script excerpt; 1 topical hashtag | 16–24, channel-name variants + long-tail question phrasings (unproofread) | Exactly 3, mid-desc | None | Sponsor line dup, every video |
| Patrick Boyle | sponsor → 150–250-word editorial summary → [one named source in prose] → books/Patreon/site/socials/podcast/join | sponsor; summary; source | Same 14 broad channel tags + a few specific appended | 0 | None | Sponsor line dup, every video |
| Wendover | sponsor/Nebula → social block → **crew credits** | sponsor only | **0** | 0 | Rare (1/4), YouTube-editor side, incl. honest sponsor chapter | None |
| RealLifeLore | sponsor/Nebula stack → "Please Subscribe:" → Spotify/FB → Getty/AP credits → MapTiler/OSM license block | sponsor only | Same frozen 13 brand tags every video | 0 | None | 2/4: folksy Nebula/"support my journalism" CTA |
| ColdFusion | sponsor → 2–3-sentence synopsis ending "In this episode, we take a look." → Spotify → own-music links → socials → creator credits | sponsor; synopsis | Same frozen 10 generic tags every video | 0 (1 sponsor-mandated) | None | 3/4: engagement question + thanks + sponsor re-plug |
| Magnates Media | sponsor emoji-bullets → own-product/affiliate stack → "DESCRIPTION:" SEO paragraph → [book-sourcing sentence] → **alternate-titles block (bare lines)** → 10–14 "Chapter N:" chapters incl. honest ad-read chapters → disclaimers → business email → subscribe gag → brand footer | sponsor; SEO para; alt titles; chapters | 23–30, subject-front-loaded then broad | 0 | 10–14, curiosity, 00:00 first | Always: "Hey legends" warmth + course/sponsor links |
| Half as Interesting | sponsor/Nebula → merch → suggest-a-video → socials → **"Video written by <name>"** → sister channels | sponsor only | **0 (at 1M+ views)** | 0 | None | Only when sponsor requires |
| Casually Explained | one deadpan joke + sponsor read (150–550 chars total) | joke; sponsor | Same frozen 13 comedy-brand tags for 5+ years | 0 | None (auto key-moments only) | Recent: sponsor blurb re-pinned (keeps the desc a pure joke) |

## Cross-channel verdicts (n=36)

1. **Hashtags are dead.** 0 usage on 6 of 9 channels; Crayon dropped its 9-tag block in 2026; HMW's
   steady 3 is the lone systematic user; one #sponsor-mandated exception. → Dial: **0–3, default 0.**
2. **Tags carry no distribution.** HAI ships 1M-view videos with an empty tags field; RLL/ColdFusion/
   Casually paste one frozen brand set on every video; HMW doesn't proofread theirs. Subject
   disambiguation is the only real job. → Keep a modest subject-front-loaded set; cap the effort.
3. **Above-the-fold line 1 = the monetization slot** on every sponsored video (24+/36). Unsponsored
   (us, for now): Crayon's unsponsored virals use a 2–3 line curiosity hook — our current rule. When
   sponsorship ever arrives, the hook yields the fold to the sponsor line.
4. **Chapters split by channel type**: story/explainer-with-acts channels use them (Crayon exactly 4;
   Magnates 10–14; both curiosity mini-headline labels, 00:00 first); talking-head/essay channels use
   none. **Labels are SHORT** — 2–5 word punches ("The Ghost", "The SUV Loophole", "The Convenient
   Death"), never sentence-length. Magnates/Wendover label ad reads as honest chapters.
5. **Pinned comment = monetization/warmth surface, never a bare engagement question.** 20/36 pinned;
   every pin carries a CTA; ColdFusion's formula (engagement question + thanks + plug) and Magnates'
   "Hey legends" warmth are the closest to community-building. Zero uploader replies or hearts across
   ~350 sampled comments on all 9 channels — comment-ops is nobody's playbook.
6. **Sources at the reference tier are thin to absent**: majors cite nothing; Crayon links one Google
   Doc; HMW dumps bare URLs; Boyle names one source in prose as a credibility flex; Magnates has one
   book-sentence + "I am NOT an investigative journalist" hedge. Our annotated sources block is a
   deliberate DIVERGENCE (YMYL trust moat, board §7) — keep it, keep it compact.
7. **Nobody discloses AI** (n=36, including the AI-adjacent ELY5 format; Crayon hedges with a
   "may be simplified/contain inaccuracies" disclaimer instead). Ours stays — policy-required, and we
   do not adopt the inaccuracy hedge (we are accuracy-leashed; hedging against inaccuracy would spend
   the trust the leash buys).
8. **Steal-worthy singletons**: Magnates' **alternate-titles block** (bare lines of alt titles as free
   search surface — maps 1:1 onto our already-written `title_challengers`); Wendover/HAI's
   crew/writer credit line; HMW's script-excerpt SEO tail (**rejected** for us: reads as slop against
   our humanize pass, and our sources block already provides the text density); Crayon's copyright
   notice (**not needed**: all assets original/licensed); business-inquiries email (**parked** until a
   real inbox exists).

## What The Second Take adopts (routed into `metadata-writer` 2026-07-21)

- Hashtags **0–3, default 0**; never a hashtag wall.
- **Alternate-titles block**: paste `title_challengers` as bare lines near the description bottom.
- **Chapter labels ≤5 words**, curiosity mini-headlines; count stays content-driven (our 8-beat story
  sits between Crayon's 4 and Magnates' 10+).
- **Chapters must ship measured, not estimated** — re-timed from the render's per-shot starts
  (`assets/motion/<piece>.motion.json`); `compliance-check` now FAILs estimated or desync'd chapters.
- Pinned comment stays an engagement pin but framed warm (thanks/observation + one question); it is
  also the future sponsor slot.
- Keep: hook above the fold (until sponsored), annotated sources block, ~15–25 subject tags,
  AI-disclosure + not-financial-advice lines, Education category.

## Channel-page (harvested same day, all 9 channels)

**Skeleton of an About description in this genre, in order:** (1) a **one-line positioning
statement with attitude, always first** — it doubles as the search snippet ("Big finance, drawn
small." — Crayon; "Mini movies about business & money." — Magnates; "Education-y explainer videos
that are almost good enough to watch." — HAI); (2) optional 1–2-sentence genre expansion; (3)
creator-identity/authority claim **only on channels with a face** (Boyle/ColdFusion/Magnates) —
faceless channels skip it; (4) optional subscribe CTA; (5) finance-specific: Boyle carries a
4-sentence not-financial-advice disclaimer (the most markets-adjacent channel — the one to copy for
YMYL). **Length is bimodal**: ultra-short (25–270 chars: Crayon/HMW/HAI/Casually/Wendover/RLL) or a
full ~700–1000-char pitch (Boyle/Magnates/ColdFusion — all have an identity or product to sell);
nobody sits between.

**Other channel-level facts (n=9):** business email affordance on ALL 9 (table stakes); links —
the faceless no-product wing carries 0–4 (Crayon: **zero**; HMW: one newsletter; nobody links Nebula
in the header); channel keywords optional (Crayon + HAI rank with none; when present: ~5–25
niche+brand+adjacent terms); upload cadence stated by exactly 1/9 (skippable); trailer slot filled
by 6/9 but almost always with a representative banger, not a made-for-purpose trailer (only
ColdFusion made one) — **a new channel leaves it empty (Crayon) until a banger exists**; home
shelves: standard Popular/Videos/playlists, with Magnates substituting welcome-copy shelf titles
for a trailer.

**Crayon Capital — the closest analog (young, small, faceless, finance-story) — runs the minimal
answer:** 25-char description, zero links, zero keywords, no trailer, no shelves. The channel page
does almost nothing; the videos carry everything.

**Routed to:** `channel-forge` stage 12 (`channel-page`) + this channel's `../channel-page.md`.
