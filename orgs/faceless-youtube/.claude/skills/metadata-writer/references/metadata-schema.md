# metadata.json — schema, API mapping, limits

The exact contract `metadata-writer` writes and `publish-queue` reads. One file per video at
`channels/<name>/videos/<slug>/metadata.json`. Follow this exactly so `publish-queue` maps onto the
YouTube Data API v3 with **no interpretation**.

## Table of contents
1. Full JSON shape
2. Field → YouTube Data API v3 mapping (the 1:1 handoff)
3. Category ID table (+ niche defaults)
4. Character / count limits
5. Policy defaults (audit gate + disclosure)
6. The A/B block (Studio-only)

---

## 1. Full JSON shape

```json
{
  "schema": "faceless-youtube/metadata@1",
  "channel": "<channels/ folder name — the addressable slug, e.g. collapse; NOT the human display name in dna.md>",
  "video_slug": "YYYY-MM-DD-slug",
  "source_idea_id": "<id from idea-backlog.md>",
  "generated": "YYYY-MM-DD",
  "status": "metadata-drafted",   // this file's own production state, NOT the idea-backlog lifecycle (that stays `scripted`)

  "defaults": {
    "privacy_status": "private",
    "made_for_kids": false,
    "contains_synthetic_media": false,
    "default_language": "en",
    "default_audio_language": "en",
    "license": "youtube",
    "embeddable": true
  },

  "long_form": {
    "title_primary": "string (~40–55 chars, one anchor + the locked lever)",
    "title_challengers": ["string", "string"],
    "description": "string with \\n line breaks; hook line first, then body, chapters, links, hashtags, disclosure, sources",
    "tags": ["string", "..."],
    "hashtags": ["#Tag1", "#Tag2", "#Tag3"],
    "category_id": "27",
    "category_name": "Education",
    "chapters": [
      {"time": "00:00", "label": "string"},
      {"time": "01:45", "label": "string"}
    ],
    "chapters_status": "estimated-from-script — re-time after render before publish",
    "pinned_comment": "engagement question tied to the lever / withheld peak",
    "ab_experiment": {
      "eligible": true,
      "dimension": "title_and_thumbnail",
      "note": "YouTube Studio-only (Test & Compare, desktop, long-form). Data API v3 cannot submit this. Set up manually: pick title_primary+challengers here + the thumbnail primary+challengers from assets/thumbs/ (visual-prompt-writer authors thumbnail prompts; image-generation produces the candidates)."
    }
  },

  "shorts": [
    {
      "file": "shorts/short-01.md",
      "archetype": "string (from the short)",
      "status": "publish",
      "title": "string (≤~50 chars, punch-first)",
      "description": "1–2 lines + hashtags",
      "tags": ["string", "..."],
      "hashtags": ["#Shorts", "#Tag2", "#Tag3"],
      "category_id": "27",
      "category_name": "Education",
      "pinned_comment": "Full breakdown: <long-form-url>",
      "thumbnail_note": "first frame IS the thumbnail (universal.md §8/§11)"
    }
  ]
}
```

Notes:
- `chapters` only appear if the video is long enough to warrant them (≥3 chapters, else omit).
- `title_challengers` is always exactly 2 for long-form; omit the whole `ab_experiment` + `challengers`
  concept for shorts (Shorts are A/B-ineligible).
- `pinned_comment` on shorts carries a literal `<long-form-url>` placeholder; `publish-queue` fills it
  after the long-form uploads.

---

## 2. Field → YouTube Data API v3 mapping (the 1:1 handoff)

`publish-queue` builds each `videos.insert` request like this (long-form; each short identically from
its block). This is why the JSON stores API-ready scalars — no transformation needed.

| metadata.json field | YouTube API location |
| --- | --- |
| `long_form.title_primary` | `snippet.title` |
| `long_form.description` | `snippet.description` |
| `long_form.tags` | `snippet.tags` |
| `long_form.category_id` | `snippet.categoryId` |
| `defaults.default_language` | `snippet.defaultLanguage` |
| `defaults.default_audio_language` | `snippet.defaultAudioLanguage` |
| `defaults.privacy_status` | `status.privacyStatus` |
| `defaults.made_for_kids` | `status.selfDeclaredMadeForKids` |
| `defaults.license` | `status.license` |
| `defaults.embeddable` | `status.embeddable` |
| `defaults.contains_synthetic_media` | `status.containsSyntheticMedia` *(altered/synthetic-content disclosure)* |
| *(thumbnail — not in this file)* | `assets/thumbnail.png` uploaded via `thumbnails.set`; prompts authored by visual-prompt-writer |
| `long_form.pinned_comment` | posted after upload via `commentThreads.insert`, then pinned |
| `long_form.title_challengers`, `ab_experiment` | **not submitted** — Studio-only |

**Important — `description` is already complete.** `metadata-writer` writes the full description string
including the chapter lines, the hashtags line, links, the AI-disclosure line, and Sources (Step 4).
`publish-queue` submits `snippet.description` **verbatim** — it does NOT re-inject chapters or hashtags.
YouTube only creates chapter markers when `mm:ss Label` lines physically appear in the description text,
which they already do.

- `long_form.chapters[]` and `long_form.hashtags[]` are **structured mirrors** of what's already in the
  description — kept for machine use (re-timing, analytics), not for publish-queue to render.
- **Re-timing after render:** whoever finalizes timestamps against the rendered VO updates **both** the
  `mm:ss` lines inside `description` **and** the `chapters[]` array so they stay in sync.

`snippet.title` and thumbnail A/B challengers have **no API path** — they are Studio-only. `publish-queue`
uploads only the primary.

---

## 3. Category ID table (+ niche defaults)

Common `categoryId` values (US):

| ID | Category |
| --- | --- |
| 22 | People & Blogs |
| 24 | Entertainment |
| 25 | News & Politics |
| 26 | Howto & Style |
| 27 | Education |
| 28 | Science & Technology |

**Niche defaults** (override with `dna.md` if the channel specifies one):

| Niche | Default category | ID |
| --- | --- | --- |
| business-money | Education | 27 |
| what-if | Science & Technology | 28 |
| ai-tools | Science & Technology | 28 |
| engineering-disasters | Education | 27 |
| horror-internet-lore | Entertainment | 24 |
| micro-health | Education | 27 |

Pick the category that best matches the *actual* content and the channel's SEO intent; these are
starting points, not rules.

---

## 4. Character / count limits

| Field | YouTube hard limit | Our target |
| --- | --- | --- |
| Title | 100 chars | **40–55** (front-load keyword; mobile truncates ~40) |
| Description | 5,000 chars | first 1–2 lines carry the promise (only ~110–157 shown before "…more") |
| Tags (combined) | 500 chars total (YouTube's count includes the commas/quotes joining tags) | ~15–25 tags; keep the raw sum ≤ ~450 for margin |
| Hashtags in description | 60 max, but only first 3 shown above title | **3–5**, first one broad |
| Short title | 100 chars | **≤~50**, punch-first |

Exceeding the title/tag limits is a hard API error — stay within target.

---

## 5. Policy defaults (audit gate + disclosure)

These come from `knowledge/playbook.md` + CLAUDE.md and are non-negotiable at **Stage 0**:

- **`privacy_status: "private"`** — an unaudited OAuth app uploads everything locked private. Never
  default to `public` or `unlisted`. `publish-queue`/a human flips this only when the audit has cleared
  and the human gate approves.
- **`contains_synthetic_media`** — an explicit boolean per the channel's visual register (ruling
  2026-07-21): `false` for clearly-animated registers (YouTube's disclosure covers *realistic*
  synthetic media only; no description AI-line either); `true` — plus the human-readable
  description line — only for content a viewer could mistake for real.
- **`made_for_kids: false`** — these niches are not child-directed. Set `true` only if a channel
  genuinely is (rare here; changes comment/personalization behavior).
- **No misleading metadata** — the title/thumbnail must be something the video actually pays off.
  Under the 2025 session-watch-time algorithm a mismatch costs more than it earns, and it risks a
  policy strike.

---

## 6. The A/B block (Studio-only)

`ab_experiment` exists to hand a human (or a future `packaging-optimizer` skill) everything needed to
set up YouTube's native **Test & Compare** by hand — because the Data API cannot. Keep it:
- **Long-form only** (`eligible: true`). Shorts, scheduled lives, and Premieres are ineligible — omit
  the block for shorts entirely.
- **Informative** — the 2 title challengers and 2 thumbnail challengers should test genuinely
  different framings *within the channel's locked lever*, so the test yields a real signal.
- **Non-blocking** — `publish-queue` ignores it and uploads the primary. A/B is a bonus layer, never a
  dependency.
