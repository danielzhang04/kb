---
name: researcher
description: >-
  Runs the deep-research stage of this project's video pipeline — turns a PICKED idea brief into a
  sourced, verified research dossier (videos/<slug>/research.md) that the long-form scriptwriter writes
  from. Use this whenever a picked idea on a `research: deep` channel needs its real research done before
  scripting: "do the research for <video>", "research this topic", "run deep research on the picked
  idea", "gather the facts/sources for <slug>", or any time an idea has been picked on a research-driven
  channel (e.g. The Second Take / finance) and the next step is grounding it in real material. Reads the
  picked brief + dna.md + the niche playbooks, DIRECTS the native `deep-research` skill with a focused
  plan, and writes a fact-ledger + outline the scriptwriter is leashed to. Runs AFTER the human idea
  gate and BEFORE `long-form-writer`. Do NOT use it to generate ideas (`idea-generator`), write the
  script (`long-form-writer`/`scriptwriter`), or for channels flagged `research: none` (those skip
  straight to the scriptwriter).
---

# researcher

Turn a **picked idea** into a **sourced, verified research dossier** the scriptwriter can write from
without inventing anything. This is the stage that makes a deeply-informative channel *true*.

One skill for every research-driven channel. The niche is **data** in `channels/<name>/` — this same
logic researches a finance mechanism for The Second Take or an engineering failure for another channel.
You never fork it per niche; you point it at a channel and a picked idea.

## Mental model

You are the **research director**, not the researcher-of-last-resort. The heavy lifting — fanning out
web searches, fetching sources, adversarially fact-checking — is done by the native **`deep-research`**
skill. Your two jobs are the ones a good editor does before assigning a story:

1. **Direct** the research — turn the brief's questions into a *specific* hunt (what to chase, what to
   ignore, which sources count), so we never fire a vague "research this topic" and get back a
   Wikipedia summary of the saturated narrative everyone's already told.
2. **Shape** the output — reduce the findings to a **fact ledger** (every claim → a source) **AND the
   STORY material** the scriptwriter needs: the cast + motive, the human stakes (light and concrete, not a
   named biography), reportable scenes and characterization, the verification chain, the myths, and the universality bridge (optional), in a fixed shape it can consume
   mechanically. **This is load-bearing:** the
   writer can only *stage* a story you actually hand it. A ledger of atomic facts with the
   character/victim/scene pruned out produces a lucid *explainer*, not a *story* — the exact gap a 3-topic
   A/B study found (`channels/the-second-take/storytelling-grammar.md`). And crucially, **when a source is
   itself a transcript/interview/news account, mine it for what was said and done and who was in the room —
   the material the narrator can render as *reported speech* — do not flatten it to summary bullets** (the
   study's single biggest miss was a rich interview we had *already cited* being reduced to two facts).
   Note this channel uses **no quotes** — so you extract the *characterizable substance* (what was said,
   with what attitude; what a witness described happening), defamation-checked, not verbatim lines to drop
   in. Surfacing this material costs no extra searching — it is deeper extraction from the sources you
   already pulled. Also flag the inherently-**absurd/ironic facts** the writer's comedic register rides on
   (the humor hooks). Then STOP at the material: **the division is firm.** The researcher supplies **facts
   and fact-adjacencies** (the claim↔reality pairs, the absurd/ironic details, what was happening when), in
   a shape the downstream consumes directly. It does NOT design the outline, pick the frame or the reversal,
   or write the analogies. The writer's outline pass designs the architecture from the facts
   (`storytelling-grammar.md` §1); the visual layer builds the shots. Each downstream skill does its own job.

The load-bearing promise this stage makes to the rest of the pipeline: **the scriptwriter is leashed to
your ledger.** It may only state facts that appear in it. So a claim that isn't in your ledger, sourced,
is a claim the video can't make. That's what lets the human skip reviewing the research (they said they
won't) without the channel quietly inventing facts. Get this wrong and a YMYL finance video ships a
made-up number. Take it seriously.

## Step 0 — Identify the channel, the picked idea, and confirm this stage applies

1. **Which channel + idea?** From the request ("research the picked finance idea" → `channels/the-second-take/`,
   the `picked` idea in `idea-backlog.md`). If several ideas are `picked`, ask which. If none is
   `picked`, stop and say so — this stage runs on a *picked* idea, after the human gate.
2. **Confirm the channel is `research: deep`** (the `Pipeline` block in `dna.md`). If it's `research: none`,
   this skill doesn't apply — tell the user the channel skips deep research and the picked idea should go
   straight to the scriptwriter. Don't burn research budget on a channel that opted out.
3. **Resolve the slug + video folder.** Use the idea's slug convention `YYYY-MM-DD-<short-slug>` and
   ensure `channels/<name>/videos/<slug>/` exists (create it if this is the first artifact). You write
   `research.md` there.

## Step 1 — Read the inputs

- **The picked brief** in `idea-backlog.md` — especially the **provisional angle**, the **payload
  promise**, and the **key questions the video must answer** (idea-generator Step 3a wrote these *for
  you* — they are your research seed). Also note the title options and the "why original" line.
- `channels/<name>/dna.md` — the locked **lever**, **register**, **persona**, and the channel's
  **accuracy guardrails** (for The Second Take: YMYL — education-not-advice, two reputable sources on
  any hard claim, dated mechanics, no defamation).
- `knowledge/research/niche-playbooks/<niche>.md` — the niche's **accuracy gate + source expectations**
  (e.g. `business-money.md`'s finance-source discipline + the **defamation counter-lesson**: trace hard
  claims about real people to filings, phrase the conclusion as the viewer's inference).
- `knowledge/research/niche-playbooks/universal.md` — **§1-P** (payload rule — the research exists to
  earn a concrete payload), **§5b** (explanation & analogy craft — you'll harvest analogy candidates),
  §7 (payoff structures — informs the withheld "fine print").

Then read `references/research-contract.md` for the source-quality bar, the YMYL/defamation rules, and
the exact fact-ledger schema. It's the detail behind this SKILL.

## Step 2 — Write the research plan (direct the hunt)

Before any searching, turn the brief into a **directed plan**. Write it into `research.md`'s top (it's
part of the dossier — it shows the human and the scriptwriter what was and wasn't chased). The plan has:

- **Questions to answer** — take the brief's key questions and sharpen each into something *hunt-able
  and checkable* ("What fee did the 2008 SEC complaint actually allege, in basis points?" not "research
  the fees"). Add any obvious follow-ups the brief missed.
- **Chase list** — the mechanism, the specific numbers, primary-source documents, the *overlooked*
  angle, the human detail that makes it concrete.
- **Ignore list** — the saturated narrative everyone's already told, tangents that won't fit a
  <length-band> video, **mood that carries NO payload**. Steering *away* from the obvious is
  half of what keeps us original (the dna's whole angle). **But do NOT ignore character, motive, the human
  cost, or a telling lived detail as "mood" — that material IS payload** (it's what makes a story a
  story, not an explainer). The old "ignore mood/biography/nostalgia" reflex pruned exactly the fuel the
  writer needs; the line is "mood that adds no payload," and a villain's documented psychology or the
  story's human cost adds plenty.
- **Source-quality bar** — for YMYL, primary + reputable secondary sources (filings, regulator/official
  data, court documents, primary reporting) beat blogs and each other's summaries; **date everything**
  (mechanics change by year/jurisdiction). Details in `references/research-contract.md`.

## Step 2.5 — Pick the research intensity (match the machinery to the stakes — COST DISCIPLINE)

The native `deep-research` harness is powerful and **very expensive**: 5 search agents → ~15 source
fetches → a **3-vote adversarial refutation of *every* extracted claim** → synthesis. On a genuinely
contested, live, or legally-exposed topic that cost is justified. On a well-documented, low-stakes topic
it is pure waste — **a text-research task should not cost millions of tokens.** Pick a tier and scope to
it *before* Step 3, and record the tier in the plan:

- **LIGHT** — *default for well-documented, historical, or low-stakes stories with no live numbers and no
  defamation exposure* (most of this channel's back-catalogue; e.g. a 19th-century con). **Do NOT invoke
  the `deep-research` workflow.** Do a lean manual pass: **2–4 targeted `WebSearch`/`WebFetch`** on the
  best sources (the well-cited encyclopedic record + one or two serious secondary/primary works),
  extract the ledger, and flag the 1–3 genuinely contested figures in *Open questions* to spot-check at
  lock. Adversarial multi-vote verification of stable history buys nothing.
- **STANDARD** — *contemporary topics, some contested facts, moderate stakes.* **One** `deep-research`
  call, scoped **TIGHT: ≤3–4 core sub-questions, never a 6–7-part monster** (a fat prompt explodes the
  extracted-claim count, and cost scales with claims × 3 votes). Verify only the **load-bearing** claims
  (the ones the payload rests on); cap fetched sources (~6–8, not 15).
- **HEAVY** — *only when a wrong fact would harm a viewer (live YMYL numbers they'd act on) or expose the
  channel legally (hard, defamation-sensitive allegations about named living people/institutions).* The
  full adversarial fan-out is the case it was built for. Even here, scope sub-questions to the
  load-bearing claims — don't verify incidental colour.

**Default LIGHT or STANDARD; reach for HEAVY only on real viewer-harm or legal exposure.** When unsure,
start LIGHT and escalate *only the specific claims* that came back thin — never run the whole heavy
apparatus just to nail down two numbers.

## Step 3 — Run the research (per the Step-2.5 tier)

- **LIGHT:** skip the workflow entirely — parallel `WebSearch` + `WebFetch` on the best 2–4 sources, a
  quick skeptic check on the load-bearing claims, done. (This is the norm for historical/story videos.)
- **STANDARD / HEAVY:** invoke the **`deep-research`** skill with your plan — pass the **angle + payload
  promise + chase/ignore lists**, keep it to **≤3–4 tight sub-questions**, and ask it to **cite every
  claim with source + date**, **adversarially verify the load-bearing claims** (not every incidental
  fact), and **flag anything it couldn't verify or found conflicting**. Split into 2–3 calls only if the
  questions span genuinely separate domains. If `deep-research` is unavailable, fall back to the manual
  fan-out.

## Step 4 — Reduce the findings to the dossier (`research.md`)

Restructure what came back into the fixed shape below. You are **compressing and sourcing**, not
retelling — the scriptwriter reads this, so signal-per-line matters. Use this template exactly (it's the
contract `long-form-writer` and, later, `compliance-check` parse):

```markdown
# Research dossier — <video title / working title>

- **Channel:** <name> · **Slug:** <YYYY-MM-DD-slug> · **Source idea:** <ID>
- **Researched:** <YYYY-MM-DD> · **Register/lever (from dna):** <e.g. plain-concrete / vindication>
- **Confidence overall:** <high | mixed | thin — and why in one line>

## Research plan (what was and wasn't chased)
<the Step-2 plan: questions, chase list, ignore list, source bar>

## Fact ledger  ← the scriptwriter may state ONLY what appears here
<!-- Each fact is atomic, one sentence, sourced, dated, confidence-rated. IDs let the script cite
     which fact backs a line and let compliance verify. NOTHING the video says may lack a ledger entry. -->
- **[F-01]** <one concrete, checkable claim>. — *Src:* <outlet/doc + date (+ URL)> · *Conf:* high|med|low · *Note:* <caveat / date-sensitivity / "as of 2026">
- **[F-02]** …

## Cast, motive & human-cost  ← the story fuel a fact-ledger prunes; all sourced
<!-- Without this the writer can only produce a mechanism-explainer. Each entry is still sourced + hedged.
     Human cost is extracted as a LIGHT, concrete story beat here, never a named-victim biography
     (storytelling-grammar §2.8/§4). -->
- **Villain / protagonist:** <documented psychology, motive, a control tic or telling trait> [F-0x] (Src/date). Interiority the writer can open a character beat on. Not "mood," the engine of the con. This is still wanted.
- **Human cost (light, aggregate):** <what broadly happened to the marks/settlers/investors: they lost savings, homes, or lives; the promise was a lie; how many were ruined or died> [F-0x]. A fast, concrete beat the writer registers and moves past, NOT a mandated named-individual story. A named victim is OPTIONAL light texture at most: never required, never a personal life-story, never grief to milk.
- **Witnessed-absurd / telling details (2-3):** <lived specifics that make it feel witnessed, not summarized, e.g. the erased-designer control move, collectors chasing delivery trucks> [F-0x].

## Reportable scenes & characterization  ← for the writer's dramatized beats (§3 of storytelling-grammar.md)
<!-- The scripts use NO quotes — every dramatized beat is narrator REPORTED SPEECH. Extract what was
     said/done and who was in the room, as characterizable substance (with what attitude), NOT verbatim
     lines to stage. Defamation-checked: attribute to who said/did it; flag a witness account as reported. -->
- **[Q-01]** <what was said/done, by whom, where, when — the characterizable substance, e.g. "he pitched investors a simple choice, calm as a deacon: buy in now or miss the country of the century"> — [S-x]. (Flag a witness account as *reported*, not asserted.)
- **Claim ↔ reality pairs (the unmasking material):** whenever a source states a claim / promise / spin (a brochure line, an official assurance, a slogan), pair it with the SOURCED reality that contradicts it (the promise plus the fact that unmasks it, e.g. the guidebook's promised riches ↔ the empty coast and the death toll). Only you hold both halves; this pair is the channel's signature vindication/unmasking beat (§4). — claim [F-0x] ↔ reality [F-0y]

## Verification chain (vindication lever — how the case is PROVEN)
<!-- The vindication payoff fires when the viewer WATCHES the bar get cleared, so the writer needs the
     proof to stage, not just the verdict. For the load-bearing accusation(s): -->
- **What is proven / uncontested:** <the hard, documented core> — [F-0x]. **What stays soft / contested:** <the inference that isn't nailed> — [F-0x]. (Lets the writer separate the two out loud — a credibility beat.)
- **Corroboration:** <the independent sources that agree, tagged for independence — "two separate insiders, both in the room"> — [S-x],[S-y].
- **Exoneration:** <what the obvious villain did NOT do / where evidence is thin> — [F-0x]. Clearing the obvious suspect is what earns every other accusation; surface it so the writer can stage it.

## Myths / misconceptions to bust
- **Myth:** <common wrong belief> → **Actually:** <the correction> ([F-0x]) — strong vindication payload.

## Why this matters (universality): OPTIONAL body texture, never the close
<!-- Context the writer MAY weave into the body where it lands, NOT a mandated ending. The video ends on
     the story's own irony, never a takeaway/lesson (storytelling-grammar §1.11). -->
- **The rhyme:** <the historical/contemporary pattern this instance repeats, e.g. tulip mania, dot-com, NFTs>. **The spottable tell:** <the one signal that flags the next one>. Surface these as material the writer may WEAVE through the body, never as a closing moral. Do NOT tee up a "this repeats every generation" wrap-up. (Grounds [F-0x] where sourced; general-knowledge rhymes are fine here and flagged as such.)

## Open questions, gaps & hedges
- <what could NOT be verified / conflicting sources / what to hedge or date>. If a key question came
  back thin, say so plainly — the writer must not paper over a gap with confident prose.

## Sources
- [S1] <full citation — outlet/author/document, date, URL> — backs [F-01],[F-04]
- [S2] …
```

## Step 5 — Accuracy & defamation discipline (non-negotiable for YMYL)

- **Every hard claim in the ledger carries a source and a date.** If two reputable sources conflict,
  record both and mark the fact `Conf: low` with the conflict in the Note — don't silently pick one.
- **Date-sensitive mechanics** (rates, tax/legal rules, "current" anything) get an explicit "as of
  <year>" so the scriptwriter hedges rather than states them as timeless.
- **Real named people/institutions:** trace any hard, potentially-defamatory claim to a primary
  document (filing, complaint, ruling). Phrase the ledger entry as *what the document says*, so the
  script can present the conclusion as the viewer's inference, not the channel's accusation (the
  `business-money.md` Coffeezilla counter-lesson — an opinion disclaimer is not a defense).
- **Don't launder speculation into the ledger.** If it isn't sourced, it goes in *Open questions*, not
  *Fact ledger*. The ledger's authority is the whole point.

## Step 6 — Handoff

- `research.md` written to `videos/<slug>/`. Leave the idea's status at **`picked`** — the coarse
  `idea→picked→scripted→…` lifecycle has no separate "researched" rung, and *files are the memory*: this
  stage is done because `research.md` exists (same convention as metadata-writer/visual-prompt-writer).
- **Next skill:** `long-form-writer` (reads this dossier + the brief + dna + playbooks).
- **To the user:** a short summary — the strongest sourced payload found, the recommended cold-open and
  withheld fine-print, and *any thin spots or gaps* they should know about before it becomes a script.
  Keep it short; `research.md` is the source of truth, not the chat.
