---
name: metadata-writer
description: >-
  Writes the YouTube publishing metadata for a scripted video in this project — the title (primary +
  A/B challengers), description, tags, hashtags, chapters, thumbnail concepts, and pinned-comment copy
  — for the long-form video AND every scripted short, emitted as one videos/<slug>/metadata.json that
  feeds the publish-queue skill (YouTube Data API v3). Use this whenever the user wants metadata, a
  title, titles, "titles and tags", a description, YouTube SEO, tags/keywords, hashtags, chapters/
  timestamps, thumbnail text, a pinned comment, or wants to "package"/"prep for upload"/"write the
  metadata" for a video or short — for ANY niche. Runs AFTER long-form-writer + shorts-writer and BEFORE
  visual-prompt-writer / voiceover / render-builder / publish-queue. Reads script.md + brief.md +
  dna.md + the universal & niche playbooks. Do NOT use it to generate ideas (idea-generator), write
  the script (long-form-writer / shorts-writer), or actually upload (publish-queue).
---

# metadata-writer

Turn ONE scripted video into **upload-ready metadata** — for the long-form video and every scripted
short — for one faceless-YouTube channel. One skill for every channel; the niche is **data** in
`channels/<name>/`, never forked into code.

## Mental model

the scriptwriters (`long-form-writer` / `shorts-writer`) decided *exactly what is said*; you decide *how the video is found, clicked, and
watched to the end* — the packaging that lives outside the video itself. Your output is the contract
for `publish-queue`, which maps it 1:1 onto the YouTube Data API v3 upload. So the metadata must be
(1) **doctrine-grounded** (the title/thumbnail craft in `universal.md §3` + `§8`, matching the
channel's **locked emotional lever**), (2) **policy-safe** (private by default under the audit gate;
AI-synthetic disclosed; no misleading metadata), and (3) **shaped for the real platform** — one
primary title/thumbnail the API can actually submit, with the extra variants parked in a Studio-only
A/B block (see *The A/B reality* below). **Write for the click AND the retention** — a high-CTR title
the video can't pay off costs the channel more than it earns (session-watch-time algorithm,
`universal.md §3a`).

## The A/B reality (read once — it shapes the whole output)

YouTube's "Test & Compare" lets a creator test **up to 3 titles + 3 thumbnails**, but it is a
**YouTube Studio-only feature (desktop, long-form only)** — it is **NOT exposed in the Data API v3**,
and **Shorts are not eligible at all.** The Data API's `videos.insert` accepts exactly **one** title;
`thumbnails.set` sets **one** thumbnail. Therefore:

- You commit to **ONE primary title + ONE primary thumbnail** per video — this is the only thing
  `publish-queue` uploads. The pipeline always has an unambiguous single title. Nothing about the
  extra variants can break that contract.
- You also propose **2 challenger titles + 2 challenger thumbnail concepts** for the long-form,
  parked in an `ab_experiment` block flagged *Studio-only* — a human (or a future `packaging-optimizer`
  skill) sets those up manually in Studio. Make challengers test **genuinely different angles/hook
  framings within the locked lever**, not trivial rewrites — an uninformative A/B wastes the slot.
- **Shorts get a single title/thumbnail, no challengers** (ineligible). Don't emit an A/B block for them.
- You do **not** run the test or pick a live winner — that emerges from real watch-time and flows back
  later via `analytics-reporter` → `performance.md`, which informs future title picks.

## Step 0 — Identify channel + video
1. **Channel** from the request → `channels/<name>/`.
2. **Which video?** The scripted one: a `videos/<slug>/` folder whose idea is status `scripted` in
   `idea-backlog.md`. Given a slug/ID, use it. Several scripted with no metadata → do the one named,
   or the most recently scripted, or ask. **No scripted video / no `script.md` → stop** and tell the
   user to script one first (metadata for an unwritten video is guesswork).

## Step 1 — Read (always)
- **`videos/<slug>/script.md`** — the source of truth. The actual content, the hook, the withheld
  peak, the beat structure (for chapters), any Sources list (for YMYL/health/engineering trust), and
  the shorts count. Titles/descriptions must reflect *what the video actually delivers* — mismatch
  hurts session watch time (`universal.md §3a`).
- **`videos/<slug>/shorts/short-NN.md`** — each short's archetype, hook, `publish`|`bench` status.
  Write metadata for **every** short (even `bench` ones — the library stays ready); carry the status.
- **`videos/<slug>/brief.md`** — the idea's title options, angle/POV, **emotional lever**. The brief's
  title options are raw ideation; you produce the final CTR-tuned set from them + `universal.md §3c`.
- **`channels/<name>/dna.md`** — the **locked emotional lever**, voice/tone, title naming conventions,
  visual/thumbnail style, audience/region/language, and any category override. Everything you write
  serves *this* lever and *this* identity.
- **`knowledge/research/niche-playbooks/universal.md`** — read every run. Load-bearing here: **§3**
  (title principles + anti-patterns + the 15-pattern library with levers), **§8** (2026 thumbnail
  rules), **§9** (funnel: pinned comment + description link + end-screen). Also §1a (one lever per
  channel).
- **`knowledge/research/niche-playbooks/<niche>.md`** — match from dna.md's niche. Its niche-flavored
  **title formulas**, thumbnail conventions, and any **policy quirk** (health YMYL, engineering
  analysis-not-gore framing, business defamation care) constrain wording.
- **`knowledge/playbook.md`** — policy: audit-gate (private default), AI-synthetic disclosure, no
  misleading metadata.
- **`references/metadata-schema.md`** (in this skill) — the exact `metadata.json` structure, the
  field→YouTube-API mapping, the category-ID table, char limits, and the policy defaults. **Follow it
  exactly** so `publish-queue` maps 1:1.
- `channels/<name>/performance.md` (if it has data) — reuse title/thumbnail shapes that have proven
  CTR/retention for *this* channel; avoid ones that flopped.

## Step 2 — Titles (long-form: primary + 2 challengers)
Apply `universal.md §3`:
- Every title = **one concrete anchor** (proper noun / specific number / "you") **+ one emotional
  trigger** — never both slots generic. The trigger must be the channel's **locked lever**.
- **Front-load the subject/keyword** (search + mobile truncation); target **~40–55 characters**.
- **One idea per title. Never answer the question the video exists to answer** — the title opens the
  loop the video closes. **The title promises the video's payload (§1-P) and the video must keep it** —
  open a real gap the content actually closes, never a clickbait gap it can't (unclosed = throttled).
- Prefer **declarative over question-mark** (question marks −15–20% on documentary long-form) and
  **avoid numbered-list titles** unless the countdown is intrinsic (−11% on average). Skip burned
  patterns ("The Truth About X", neutral "Understanding X / The Economics of X").
- **Primary** = your single best bet the video fully pays off. **Challengers** = two different framings
  (a different §3c pattern or a different anchor) *within the same lever* — informative to test, not
  cosmetic variants.
- Match the channel's **title naming conventions** in `dna.md`.

## Step 3 — Thumbnails (long-form: primary + 2 challengers)
Concepts only — text overlay + visual concept (the actual pixels come later from
`visual-prompt-writer`/render). Apply `universal.md §8`:
- **Title + thumbnail = one asset**: the thumbnail delivers the promise visually; neither fully
  resolves the question. Don't restate the title text on the thumbnail.
- **≤3–4 words** of overlay text, **no all-caps** (mobile-CTR negative). Neo-minimalism: one dominant
  subject, **≥50% negative space, ≤2 primary colors**.
- Prefer **"proof of human"** (real-photo subject + AI/graphic background beats fully-AI ~18–22%) and
  a **closed-mouth determined expression** over open-mouth shock (+15–20% CTR) *where the channel's
  faceless visual style allows a subject* — otherwise use the channel's locked signature subject.
- Each challenger pairs with its title challenger as a coherent package.

## Step 4 — Description
Structure (see `references/metadata-schema.md` for exact field + char limits):
1. **First 1–2 lines (the only part visible before "…more")** = a compelling restatement of the
   promise with the **primary keyword up front**. Not the title verbatim; open curiosity, don't resolve.
2. **Body (2–4 sentences)** expanding the promise — keyword-rich but **natural language, no keyword
   stuffing** (stuffing is spam under policy and reads as slop).
3. **Chapters** (see Step 5).
4. **Links / CTA** — related-video or playlist link if relevant. If the target will exist at publish
   but isn't known yet, use a `<...-url>` placeholder (same convention as the shorts' `<long-form-url>`);
   if there is genuinely nothing to link (e.g. the channel's first video), **omit this section**. (The
   Short→long-form CTA lives in the short's **pinned comment**, not here — `universal.md §9`.)
5. **Hashtags line** — 3–5 (the first 3 render above the title). Include a broad niche tag + specific
   ones; for Shorts include `#Shorts`.
6. **AI-synthetic disclosure line** (human-readable) — required by policy; pair with the machine flag.
7. **Sources** — if `script.md` carried a Sources list (health/engineering/business trust), reproduce
   it. This is part of the originality/trust moat.

## Step 5 — Chapters (estimated)
Derive chapter markers from the script's beats (hook → second gate → body cycles → mid-video re-arm →
withheld peak → close). **First chapter must be `00:00`.** Real timestamps only exist after render, so
mark `chapters_status: "estimated-from-script — re-time after render before publish"`. Include chapters
only when the video warrants them (≥3); otherwise omit.

**Timestamps come from the script's real word timing, not its beat labels.** The script header's
**`Estimated runtime`** (words ÷ 150 wpm) is the single source of truth for length — your last chapter
must fall inside it, and each chapter's `mm:ss` should track the **cumulative word position** of that
beat (words-before-the-beat ÷ 150), not a round number a beat header happens to display. If the script
carries aspirational beat timestamps that overshoot its own word-count runtime, trust the word count —
otherwise the chapters will claim a 12-min video that is really 6, and desync from the shot list.

**Write them in two places, kept in sync:** (1) the `mm:ss Label` lines **inside the description string**
in the position Step 4 specifies — YouTube only creates chapter markers when the timestamps physically
appear in the description, so this is what actually works; and (2) the structured `chapters[]` array as a
machine-readable mirror for re-timing. `publish-queue` submits the description **verbatim** and does not
re-inject chapters. After render, whoever finalizes timings updates **both** the description lines and the
array. Keep labels curiosity-open, not spoilers.

## Step 6 — Tags
Front-load the **exact-match subject keyword**, then close variants, then broader niche terms. ~15–25
tags, **≤500 characters total**, no stuffing/irrelevant tags (misleading-metadata risk). Tags carry
minor SEO weight today; their real job is disambiguation. Shorts get a tighter, Short-appropriate set.

## Step 7 — Pinned comments
- **Long-form:** an **engagement prompt** — a question tied to the video's lever/withheld peak that
  invites comments (comments are a ranking signal). Not "like and subscribe."
- **Each short:** a **soft link back to the long-form** ("Full breakdown: <long-form URL>") — the
  Short→long CTA belongs in the pinned comment, and a description/pinned link on Shorts is worth
  ~+12% conversions among non-subscribers (`universal.md §9`). `publish-queue` fills the real URL after
  the long-form uploads; write the copy with a `<long-form-url>` placeholder.

## Step 8 — Shorts metadata
For every short in the folder, emit a block: single `title` (Short hook, ≤~50 chars, first-person or
punch-first), `description` (1–2 lines + `#Shorts` + 2–3 hashtags), a tight `tags` set,
`category_id`, the `pinned_comment` from Step 7, and `thumbnail_note: "first frame IS the thumbnail"`
(`universal.md §8`/§11). **No A/B block** (Shorts ineligible). Carry the `publish`|`bench` status and
`archetype` from the short file.

## Step 9 — Policy defaults (non-negotiable at Stage 0)
Set in the `defaults` block, applied to long-form + every short:
- `privacy_status: "private"` — the **audit gate**; unaudited OAuth uploads everything private. Never
  default to public. (`playbook.md` / CLAUDE.md.)
- `contains_synthetic_media: true` — AI/altered-content **disclosure** (also add the human-readable
  line in the description).
- `made_for_kids: false` (these niches are not child-directed; override only if a channel truly is).
- `default_language` / `default_audio_language` from `dna.md` (default `en`).
Enforce any **niche policy quirk**: no health claim in metadata without the script's sourcing; no
defamatory phrasing in business collapse titles; keep engineering framing analysis-not-gore; never
write a title the video doesn't pay off (misleading-metadata = policy strike + session-time penalty).

## Step 10 — Write the file + hand off
Write **`videos/<slug>/metadata.json`** per `references/metadata-schema.md` (one file: `defaults` +
`long_form` + `shorts[]`; set the file's own `status: "metadata-drafted"` field — that is the file's
production state, distinct from the idea-backlog lifecycle). **Leave the idea-backlog lifecycle status
at `scripted`** — the project's
coarse lifecycle (`idea → picked → scripted → produced → published`) doesn't have a per-sub-step rung,
and *files are the memory*: this step is "done" because `metadata.json` now exists in the folder (the
idea flips to `produced` only when the video is fully assembled). The folder is now ready for
`visual-prompt-writer` (thumbnail concepts + `[B-ROLL]` shots) → `voiceover` + `render-builder` →
`compliance-check` → `publish-queue`.

## Output to the user
Short summary only: the metadata.json path, the **primary long-form title** (+ char count) and its 2
challengers, the thumbnail primary concept, chapter count (flagged estimated), and the count of shorts
metadata written (and how many `publish`). `metadata.json` is the source of truth; keep the chat brief.

## Output contract (what publish-queue reads)
`videos/<slug>/metadata.json` — a single JSON object:
- `defaults` — privacy/disclosure/kids/language/license flags applied to every asset.
- `long_form` — `title_primary`, `title_challengers[2]`, `description`, `tags[]`, `hashtags[]`,
  `category_id`/`category_name`, `chapters[]` + `chapters_status`, `thumbnail.{primary,challengers[2]}`,
  `pinned_comment`, `ab_experiment` (Studio-only note).
- `shorts[]` — one per short: `file`, `archetype`, `status`, `title`, `description`, `tags[]`,
  `hashtags[]`, `category_id`, `pinned_comment`, `thumbnail_note`.
Field→YouTube-API-v3 mapping is documented in `references/metadata-schema.md` so `publish-queue` maps
1:1 with no interpretation.
