# Channel page — The Second Take (source of truth for the YouTube channel-page state)

> Produced 2026-07-21 from the channel-page harvest (`research/metadata-teardown-2026-07-21.md`
> §Channel-page). **The human applies this in YouTube Studio** (channel branding is not
> API-writable under the credential ceiling, and it is outward-facing — clause H). Once applied,
> this file is the record the live page must match; edit here first, then Studio.
> Status: **DRAFT — awaiting Daniel's Studio pass** (live page is empty as of 2026-07-21).

## Display name — FLAG for decision

Live channel currently reads **"Second Takes"** (`@ssecondtakes`, UCSiK6AWvPQJTl-jmD-6qVUQ). The
locked working name everywhere in this repo (wordmark, dna.md, video descriptions, tags) is
**"The Second Take"** (decisions 2026-07-02; the name was provisional pending handle availability —
but the *display name* is free-text and need not match the handle). **Recommendation: set display
name to "The Second Take"; keep the handle.**

## About description (recommended: ultra-short band)

The genre's About length is bimodal — ultra-short (25–270 chars: Crayon/HMW/HAI/Wendover) or a full
700–1000-char identity pitch (only channels with a face/product). We are faceless with no products:
**ultra-short**, one-liner first (it doubles as the search snippet), plus our locked YMYL/AI lines
(Boyle precedent — the most markets-adjacent channel carries the disclaimer).

**Recommended (≈175 chars; no AI line — Daniel's ruling 2026-07-21: YouTube disclosure covers
realistic synthetic media only, and our register is clearly animated):**

```
Every money story has an official version. This is the second take.

True stories of cons, bubbles, and billion-dollar mistakes. History and entertainment, not financial advice.
```

One-liner alternates (pick one; same register, different angle):
- B: `True stories of money, cons, and everyone who didn't read the fine print.`
- C: `Big cons, bad bets, and the fine print nobody read.`

Rejected: a cadence promise (1/9 reference channels state one; we haven't committed to a cadence);
a creator-identity paragraph (faceless channels skip it, n=9); the full-pitch band (nothing to
sell yet).

## Links

**None at launch.** Genre-valid: Crayon Capital (closest analog) carries zero; the faceless
no-product wing carries 0–4 and links only to properties that exist. We have no newsletter, no
socials, no Patreon. Add links only when the property is real — first candidates in order:
newsletter → one social actually maintained → Patreon/membership.

## Business email

Set one in Studio (the "sign in to see email address" affordance — table stakes, present on all 9
reference channels). Do NOT print it in the description. Address = Daniel's choice; record it here
once set.

## Channel keywords (optional — set once, cheap)

Crayon/HAI rank with none, so this is a floor-effort field; if setting (Studio → Settings →
Channel → Keywords):

```
The Second Take, finance, financial history, money stories, business documentary, scams, cons, financial fraud, economic history, animated documentary, business stories, history of money
```

## Art

- **Avatar:** `visual-kit/brand/avatar.png` (locked 2026-07-12)
- **Banner:** `visual-kit/brand/banner-plain.png` (default) or `banner-subscribe.png` (baked
  subscribe CTA) — Daniel picks; plain is the safer long-term choice (the CTA can't be unbaked from
  screenshots/embeds).
- **Video watermark** (Studio → Customization → Branding): optional; the corner wordmark already
  lives inside the thumbnails/videos — skip unless wanted.

## Trailer + home shelves

- **Unsubscribed trailer: leave EMPTY** until the first public video earns banger status, then slot
  the best performer (6/9 references use a representative hit, not a made-for-purpose trailer; only
  ColdFusion made one). Revisit after the first analytics cycle.
- **Shelves:** default layout (Popular/Videos) until there are ≥2 playlists' worth of content.
  Magnates' welcome-copy shelf titles are a later option once shelves exist.

## Studio checklist (ordered, one sitting)

1. Customization → Basic info: display name → **The Second Take**; paste the About description.
2. Basic info → contact email: set (record above).
3. Settings → Channel → Basic info: paste keywords.
4. Customization → Branding: avatar + banner (files above; banner needs 2048×1152 safe-area check
   in the Studio preview).
5. Trailer: skip (deliberate).
6. Mark this file's Status line **APPLIED <date>** and note any Studio-side deviations here.
