# Genesis stages (the default walk)

The ordered stages `channel-forge` walks to create a channel. Machine-readable form:
`genesis-stages.json`. **Every stage is human-gated** (Enforcement Contract clause H — everything committed
to a channel gets the human's final say). Rich per-stage option-generation
(research → generate → self-critique → present) is **Phase 3**; the Phase-2 conductor walks + gates + scaffolds.

| # | Stage | Decides | Produces |
|---|---|---|---|
| 1 | `niche` | What the channel is about (audience, subject lane) | brief + `dna.md` Identity |
| 2 | `doctrine` | The one-lever positioning (never per-video) | `dna.md` Doctrine |
| 3 | `format` | Length band, cadence, long-form/shorts mix | `dna.md` Format |
| 4 | `visual-style` | The locked look | `visual-kit/style-bible.md` (+ refs) |
| 5 | `voice` | The narrator voice | `dna.md` Voiceover config |
| 6 | `production-pipeline` | Which BUILT production pipeline the channel uses | `capability-map.json` `production_pipeline` |
| 7 | `capability-map` | How each production slot is satisfied (reuse/reconfigure/adapt/build/n/a) | `capability-map.json` `slots` (validated) |
| 8 | `storytelling-grammar` | The writing-craft grammar for the niche | `storytelling-grammar.md` |
| 9 | `guardrails` | Channel-specific guardrails | `dna.md` Guardrails |
| 10 | `scaffold` | Materialize the channel folder from the template | `channels/<name>/` |
| 11 | `backlog` | Seed the first ranked ideas | `idea-backlog.md` (via `idea-generator`) |
| 12 | `channel-page` | The YouTube channel PAGE: About copy, links, keywords, avatar/banner, trailer policy | `channels/<name>/channel-page.md` (locked copy + Studio checklist) |

## Notes
- **Stage 1 (`niche`) is genuinely first** — you cannot choose a look or voice before you know what the
  channel is.
- **Stage 6→7 order matters:** the production pipeline is chosen first, then each slot is resolved against
  it; a `build` slot (a capability that doesn't exist yet) routes into its own brainstorm→plan→build
  (Enforcement Contract clause B, self-application).
- **Reuse of existing artifacts:** stages that map onto existing skills/schemas reuse them (referenced, not
  duplicated — see `_TEMPLATE/README.md`). The wizard fills channel-specific content; the machinery is shared.
- **Stage 12 (`channel-page`) ships copy, not clicks:** channel branding (About description, links,
  business email, keywords, avatar/banner, trailer) is applied by the HUMAN in YouTube Studio — the
  Data API path needs credential handling the constitution's hard ceiling forbids, and channel-level
  branding is outward-facing (clause H). The stage produces the locked copy + an ordered Studio
  checklist; grounding = the 2026-07-21 channel-page harvest in
  `channels/the-second-take/research/metadata-teardown-2026-07-21.md` §channel-page.
