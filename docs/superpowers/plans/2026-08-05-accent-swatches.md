# Accent swatches — three candidates for Daniel (2026-08-05)

**Status: DECIDED — C (warm parchment) landed 2026-08-05.** Daniel picked C from live previews
(https://claude.ai/code/artifact/d26251c1-141e-4ef5-98ae-15e1f3b4d72a); `#d9c7a8` dark / `#6b5b41`
light now set in all four theme blocks of `app.css`. Candidates A/B below kept for the record.

## What is already wired

`dashboard/src/styles/app.css` declares one accent slot in `:root`:

```css
--mc-accent: var(--accent-strong);   /* defaults to the existing neutral — no colour landed */
--mc-accent-fg: var(--bg-base);      /* text colour that sits ON a filled accent */
```

Every place an accent would touch now reads that slot instead of `--accent-strong` directly:

| Surface | Selector |
| --- | --- |
| Active nav item's 2px left rail | `.mc-nav-item--active` |
| Primary button fill + its label | `.mc-btn--primary` |
| The unlock (lock-chip) focus ring | `.mc-session-chip:focus-visible` |
| Theme toggle focus ring | `.mc-theme-toggle:focus-visible` |
| Copy-id focus ring | `.entity-name__copy:focus-visible` |
| Emergency-stop input focus ring | `.mc-stop input:focus-visible` |
| The shared clickable-row rail + focus ring | `.mc-row-link:hover` / `:focus-visible` |
| Selected task row, task focus ring, card-gate rail | `.v-tasks__row*`, `.v-tasks__gate` |
| Inbox row focus ring + the "decision" eyebrow | `.v-approvals__row:focus-visible`, `.v-approvals__category--decision` |
| Home waiting tile, row/project hover rail, input focus | `.v-home__kpi--accent`, `.v-home__row`, `.v-home__input` |
| Entity detail: active tab rail, row-link rail, back/tab focus rings | `.entity-detail__tab--active`, `.entity-row--link`, … |
| Layer sub-tab underline | `.v-panels__tab--active` |

Landing a choice is therefore a **one-line change per theme block** — `:root`,
`:root[data-theme='dark']`, `:root[data-theme='light']`, and the `prefers-color-scheme: light` block.
No selector changes, no markup changes.

## Constraints the candidates were chosen against

- The shell is warm near-black (`--bg-base #1a1815`, panels `#232120`). A cold blue-grey accent fights
  it; a fully saturated accent shouts on it. Muted and mid-value is the target.
- The accent must NOT be confusable with the semantic palette, which already owns four hues and encodes
  data, not decoration: `--success/--status-running #5cae7e` (green), `--error/--status-blocked #e0554a`
  (red), `--warning #e0a040` (amber), and the risk tiers `#8a8175 / #c9922e / #c1503a`. **That rules out
  every green, red, and orange.**
- It carries meaning at 2px (a left rail) and at 8px (a focus ring), so it needs enough contrast against
  both `--bg-base` and `--bg-panel` to read as a line, not a smudge.
- Both themes must work. Each candidate below gives a dark value and a light counterpart.

## The three candidates

### A — Slate blue

```css
--mc-accent: #8fa3b8;        /* dark theme */
--mc-accent: #4a5f75;        /* light theme */
```

Cool, low-chroma blue-grey. The safest choice: it is the furthest of the three from every semantic hue,
so an accented rail can never be misread as a status. Contrast ≈ 6.7:1 on `--bg-base`, so it reads
cleanly as a 2px line. The trade-off is that it is the least warm — it reads as a deliberate cool
counterpoint to the shell rather than as part of it, which is either the point or the objection.

### B — Muted lilac

```css
--mc-accent: #9c8fbf;        /* dark theme */
--mc-accent: #5c4e82;        /* light theme */
```

Desaturated violet. No status vocabulary in the app is anywhere near violet, so it is unambiguous
without being cold, and it gives the product a small amount of identity that neither a grey nor a blue
does. Contrast ≈ 6.0:1 on `--bg-base` — the lowest of the three, still comfortably above the 3:1 a
non-text UI boundary needs. Highest-personality option, and therefore the one most likely to feel wrong
in six months if the mood changes.

### C — Warm parchment

```css
--mc-accent: #d9c7a8;        /* dark theme */
--mc-accent: #6b5b41;        /* light theme */
```

A warm, very low-chroma sand. The smallest step from where the UI already is — it reads as the existing
near-white neutral with warmth added, so it barely announces itself as "a colour". Contrast ≈ 10.6:1 on
`--bg-base`, the strongest of the three. **Caveat to weigh:** it is the closest of the three to the
amber/tier family (`--warning #e0a040`, `--tier-t2 #c9922e`). At this chroma the two do not collide in
practice — the tier chips are saturated and this is not — but it is the one candidate where a
side-by-side check on the Workflows and Tasks surfaces is worth doing before committing.

## Recommendation

**A (slate blue)** if the priority is that an accent can never be mistaken for a status signal.
**C (warm parchment)** if the priority is that the near-black direction stays exactly as it feels now.
B is the option to pick only if the dashboard is wanted to have a recognisable colour of its own.

## Landing a choice

1. Set `--mc-accent` in the four token blocks of `dashboard/src/styles/app.css` (dark value in `:root`
   and `:root[data-theme='dark']`; light value in `:root[data-theme='light']` and the
   `prefers-color-scheme: light` block).
2. `--mc-accent-fg` stays `var(--bg-base)` for all three — every candidate is light enough in the dark
   theme, and dark enough in the light theme, that the shell colour is the correct label on a filled
   primary button.
3. Walk the five surfaces (Home, Inbox, Workflows, Agents, Tasks) plus the Sentinel emergency-stop
   section in both themes, and confirm no accented element sits adjacent to a status dot in a way that
   reads as a fifth status.
