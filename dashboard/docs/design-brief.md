# kb Mission Control — Design Brief

Desktop-only, single-operator fleet control plane. Aesthetic: **warm Claude-desktop dark**
(warm charcoal base + terracotta accent), sleek/calm/refined, NOT cold-blue terminal, NOT
over-engineered. Scalable IA with room to grow (Atlas, Sentinel, more agents/workflows/skills).
Build agents execute against this. Self-contained only — no external fonts/CDNs; hand-written CSS.
**Design + build work runs on Opus 4.8** (Daniel's directive — he lives in this UI and iterates on it).

> **Daniel override 2026-07-17 (review round 1 → U5.1): no decorative accent color; Claude-dark warm
> near-black; terracotta retired from chrome (semantic status colors only).** The tokens below are
> superseded for chrome. The `--accent-strong / --accent / --accent-quiet` trio now resolves to a
> NEUTRAL white/opacity hierarchy (dark: near-white `#ededea` / muted `#a3a099` / `rgba(255,255,255,.06)`
> wash; light: warm near-black `#2b2925` / `#6b6558` / `rgba(0,0,0,.05)`). All structural chrome — nav
> selection, KPI tiles, buttons, links, focus outlines, tab underlines, left-borders — is neutral; the
> active/selected device stays a left-border but in the neutral near-white/near-black, over a subtle
> raised wash. Dark surfaces are the warm Claude-desktop family: `--bg-base #262624`, panel `#2b2a27`,
> elevated `#34322e`, sunken `#1c1b19`; fg `#f5f4ef / #b8b5ad / #82807a`; hairlines `rgba(255,255,255,.08)`.
> **EXCEPTION — semantic status colors stay** (they encode data, not decoration): running/ok green
> `#5cae7e`, error/STOP red `#e0554a`, warning amber `#e0a040`, tier T1/T2/T3, and the T3 warning border.
> No new decorative color may be introduced. Light stays warm cream. Dark is the default and is pinned
> as an explicit `[data-theme=dark]` (beats the OS `prefers-color-scheme`); a quiet topbar toggle
> switches to `[data-theme=light]` and persists the choice to `localStorage['mc-theme']`. The exact
> live values are the source of truth in `src/styles/app.css` and `src/lib/theme.ts`.

## A) Palette — warm Claude-dark (dark = default)

Surfaces: `--bg-sunken #14110E` (code gutters/inputs/terminal), `--bg-base #1B1815` (app shell),
`--bg-panel #221E1A` (cards/sidebar/panes — workhorse), `--bg-elevated #2B2620` (popovers/palette/hover).
Foreground: `--fg-primary #F2EDE4`, `--fg-dim #B3A99B`, `--fg-faint #766D61`.
Accent (terracotta): `--accent-strong #D97757` (buttons/links/focus/active underline),
`--accent #C15F3C` (icons/active nav indicator/badge fill), `--accent-quiet #3A2A20` (selected wash).
Borders: `--border #332D26` (hairlines), `--border-strong #453D33` (inputs/dividers).
Semantic: `--error #E0554A`, `--warning #E0A040`, `--success #5CAE7E`.
Status: running `#E0A040`, done `#5CAE7E`, blocked `#E0554A`, idle `#766D61`.
Tier (escalating warmth = risk): T1 `#8A8175`, T2 `#C9922E`, T3 `#C1503A`.

Light remap (`prefers-color-scheme: light` / `[data-theme=light]`): bg-sunken `#EDE7DC`,
bg-base `#FBF8F3`, bg-panel `#FFFFFF`, bg-elevated `#F4EFE6`, fg `#221D17`/`#6B6255`/`#9C9284`,
accent-strong `#B5551F`, accent `#A2481E`, accent-quiet `#F1DDD0`, border `#E4DED2`/`#D6CDBD`,
error `#C4322A`, warning `#B67A1E`, success `#2F8F5B`, tier `#7A7266`/`#A97423`/`#B03D28`.

NOTE: the committed Sonnet foundation draft used a slightly different warm set
(`--bg #262624`, `--accent #c96442`). The Opus pass should reconcile toward THIS brief's exact
hexes (or improve on them with judgment) — the draft is structural scaffolding, not the final palette.

## B) Typography

Sans: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif`.
Mono: `ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace`.
Scale: xs 11 (eyebrow/badge/col-headers), sm 12 (secondary/timestamps/nav labels),
base 13 (body/table cell — dense tool), md 14 (inputs/active nav), lg 16 (section headers),
xl 20 (view titles / KPI numbers).
Mono for: card ids, content_hash/session-id, tier badges, timestamps, durations, paths, ledger
figures, model names. Sans for everything else. Weights: 400 body, 500 labels/buttons/active,
600 headers, 650 KPI numbers only (avoid 700/900). Line-height 1.2 headings, 1.45 UI, 1.6 KB reading.
`font-variant-numeric: tabular-nums` on all columnar/live numbers.

## C) Spacing / Radius / Elevation

Spacing (4px atomic): 1=4 2=8 3=12 4=16 6=24 8=32 12=48. Card padding 2/3, between panes 4/6,
page breathing 8+. Radius: sm 6 (buttons/inputs/badges), md 8 (cards/panels), lg 12 (modals/palette).
Elevation — hairline borders do most of the work, shadows neutral black low-opacity, reserved for
floating elements: panel = border only; elevated = `0 1px 2px rgba(0,0,0,.28), 0 4px 12px rgba(0,0,0,.24)`;
overlay = `0 8px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.3)`; sunken = `inset 0 1px 2px rgba(0,0,0,.35)`.
No colored/glow shadows.

## D) Information Architecture — scalable, config-array driven

Sidebar is a single typed config array (`src/nav/config.ts` `NAV_SECTIONS`) so a new destination is
ONE entry — no layout/routing/CSS change. Daniel locked an entity-first IA: three UNLABELLED,
divider-separated groups (hairline dividers only, no uppercase group headers — Linear pattern), all
13 destinations live:
- Home · Approvals (labelled "Inbox" in-nav; badge = pending count) · Activity · Atlas · Terminal
- Workflows · Agents · Tasks · Projects · Files
- Connectors · Ledgers · Sentinel

There is no pinned Session/Stop floor. Session state is the top-bar lock chip; the emergency-stop
controls (WebAuthn state + scoped stop + nuclear STOP) live on the Sentinel view, next to the
fleet-health readout they act on, not in a pinned shell region.

Collapse: icon-only 48px rail default (icon+tooltip hover, VS Code activity-bar/Linear pattern),
pin/expand to ~220px with item labels (groups stay unlabelled — dividers only). Command palette
(Ctrl/Cmd+K, Raycast pattern): centered overlay, navigate (any destination) + act (approve/launch/stop
— governed endpoints stay WebAuthn-gated; palette is a shortcut, never a bypass).

## E) Per-view layout

- **Approvals (security-critical):** two-pane — ranked list left (mono id + tier badge, highest-tier
  first, T3 gets tier-t3 left-border), corroboration panel right rendering id/action/risk-tier/
  `## Work order` body the INSTANT a card is selected, BEFORE any biometric prompt (ordering is
  load-bearing — never imply the challenge shows after a verify-click). Panel = border-strong frame +
  "this is what your signature covers" caption. Unavailable verify channels ABSENT, never disabled ghosts.
- **Timeline:** dense single-column log — mono timestamp, fg-dim actor, content; tool-use rows get an
  accent LEFT-BORDER (not full-row highlight). Auto-scroll on tail, freeze on manual scroll-up + "N new" pill.
- **Browser:** two-pane VS-Code explorer — tree left (indent guides in border, chevrons fg-faint),
  rendered content right at base/1.6 (reading comfort beats density). Active node = left-border accent.
- **Terminal (future D3):** natural extension not foreign xterm drop-in — bg-sunken (deepest surface),
  mono only, accent-strong cursor, persistent header chip showing the constrained fleet identity;
  fully override xterm default black/green even temporarily.

## F) Signature details + anti-patterns

Signature: (1) hairline borders everywhere, shadows almost nowhere; (2) mono tabular-nums for every
id/hash/tier/count/timestamp — the sans/mono contrast reads as "engineered"; (3) left-border marker
for active/selected everywhere (nav/tabs/tree/tool row) — one language learned once; (4) restrained
motion 150-200ms ease-out opacity/transform, no bounce/spring/parallax; (5) NO decorative accent
(Daniel override 2026-07-17, see §A note) — all chrome is a neutral near-white/near-black over a subtle
raised wash; colour is reserved for semantic status only (green/red/amber/tier/STOP), never a wash.
Anti-patterns: (1) rainbow status/badge soup — new taxonomies get shape/label/mono differences, not new
hues; (2) glassmorphism/gradients/glow — reads as generic AI-template; (3) cramming growth into Board.

## Doctrine — governed-run surfaces (2026-08-06 ruling)

Superseded: "governed RunDetail never hosts a terminal" (2026-08-05). Current law: a governed agent's
expanded workings ARE interactive — a structured stream view (never a PTY/ConsolePane) with a composer
whose input rides the session-gated agent-messages route and lands in the run journal as an audited
event. "Chat sessions never look governed" stands unchanged; the governed panel keeps its own visual
register. Design + full rationale: `docs/superpowers/specs/2026-08-06-live-run-graph-design.md`.

## Sources
21st.dev sidebar + dark-mode community components (no live MCP inside subagents — pulled from public
registry via web; live 21st.dev MCP IS connected at the boss seat for direct pulls during the view pass),
Claude brand palette, shadcn Claude theme, Linear UI redesign, Raycast command-palette notes, Vibe
Kanban interface, Vercel/Grafana/Datadog dense-data patterns.
