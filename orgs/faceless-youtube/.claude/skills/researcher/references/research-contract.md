# Research contract — source discipline, YMYL rules, ledger schema

The detail behind `researcher/SKILL.md`. Read this once per run before writing `research.md`.

## 1. The source-quality bar

Rank sources; prefer the top of this list and say when you had to settle lower:

1. **Primary documents** — SEC/regulator filings, court complaints & rulings, official statistics
   (BLS, Fed, Treasury, Eurostat), company 10-Ks/press releases, the actual law/rule text.
2. **Primary reporting** — a named journalist who did the original work at a reputable outlet, with
   the primary docs cited.
3. **Reputable secondary** — established outlets/academics summarizing primaries.
4. **Weak (use only to *point* toward a primary, never as the cite)** — blogs, forums, other faceless
   videos, undated aggregators, AI summaries. If a claim only exists here, it goes in *Open questions*,
   not the *Fact ledger*.

**Two-source rule (YMYL):** any hard claim — a rate, a dollar figure, a timeline, a legal/financial
mechanism — needs two independent reputable sources, or one primary document. One blog is not a source.

**Date everything.** Finance/tax/legal mechanics change by year and jurisdiction. Every such fact gets
"as of <year>" (and jurisdiction if it matters) in its Note so the writer hedges instead of stating a
2026 rule as timeless. A fact with no date on a time-sensitive claim is a bug.

## 2. Adversarial verification (why the human can skip reviewing this)

**Scale this to the SKILL Step-2.5 intensity tier — verify what's *contested or load-bearing*, not
everything.** On a LIGHT (well-documented / historical) topic a source + a sanity check is enough;
reserve multi-vote adversarial refutation for STANDARD/HEAVY **load-bearing** claims (contested numbers,
live data, legal allegations). Verifying stable, well-documented history three times over is the exact
waste this discipline exists to prevent.

The native `deep-research` skill adversarially checks claims; lean on it *for the tiers that call for it*.
For every **load-bearing** claim (one the video's payload depends on), the dossier should reflect that
someone *tried to refute it* and failed. If you're doing the manual fallback, run a skeptic pass: for each load-bearing claim, search
specifically for the counter-evidence and the "actually, that's a myth" version. A claim that survives a
genuine refutation attempt earns `Conf: high`; one you couldn't stress-test is `Conf: med` at best.

## 3. Defamation discipline (real named people & institutions)

This channel tells stories about real scams, collapses, and named actors. The `business-money.md`
counter-lesson is load-bearing: **an "this is my opinion" disclaimer failed in court** (Coffeezilla /
Logan Paul, to trial 2026). So:

- Trace any hard, potentially-defamatory claim about a named person to a **primary document** (the
  filing, the complaint, the ruling, the sworn testimony).
- Write the ledger entry as **what the document says/alleges**, with the document as the source — not as
  the channel's own accusation. E.g. `[F-12] The SEC's 2009 complaint alleged X. — Src: SEC v. Y, 2009`
  rather than `[F-12] Y committed X.`
- That phrasing lets the scriptwriter present the conclusion as **the viewer's inference from documented
  facts**, which is the defensible posture. Flag any claim you *can't* trace to a primary as a defamation
  risk in *Open questions* so the writer routes around it.

## 4. Fact-ledger schema (exact)

Each entry is **atomic** (one claim), **sourced**, **dated**, **confidence-rated**, and **ID'd**:

```
- **[F-NN]** <one concrete, checkable sentence>. — *Src:* <outlet/doc + date (+ URL)> · *Conf:* high|med|low · *Note:* <caveat / "as of YYYY" / conflict / jurisdiction>
```

- **IDs** `F-01, F-02, …` in creation order, never reused. The scriptwriter cites them per line; the
  future `compliance-check` verifies against them. Sources get their own IDs `S1, S2, …` and each fact's
  `Src` points at one (keeps the ledger readable, the Sources list de-duplicated).
- **Atomic** matters: "Madoff's fund claimed ~10%/yr returns and was ~$65B in stated assets by 2008" is
  *two* facts (`F-a` the return, `F-b` the stated size) with possibly different sources/confidence.
  Split them so the writer can use one without dragging in an unverified other.
- **Relationships are facts too, capture them, don't let atomicity shred them.** Splitting into atoms is for
  sourcing, but a pile of disconnected atoms loses how the story actually fits together: who owns what, what
  caused what, which two things are really the same entity, what had to happen before what. Record these
  **connective facts** as their own sourced entries (e.g. an `[F-NN]` stating that one umbrella company owned
  *both* the legitimate business and the fraudulent one). A missing connective fact is exactly what later
  leaves the writer unable to make the story cohere. **Guardrail (the division stays firm):** state a
  relationship *as it exists in the world*, ownership, cause, identity, sequence-dependency, and **never** as a
  telling order, an opening, or a frame. "X owned Y" is a fact you supply; "open on X, then reveal Y" is a plan
  the writer makes, and you still never write it.
- **Confidence** is honest, not decorative: `low` on anything single-sourced, conflicting, estimated, or
  stress-tested-and-wobbly. The writer treats `low` facts as hedge-or-omit.

## 5. What "enough research" means (scope to the video, don't boil the ocean)

Enough = the ledger can support the whole arc **and** the withheld fine-print payload, with the
load-bearing claims at `Conf: high`. That's usually **15–35 solid facts** for a 10–15 min explainer —
enough for a cold-open number, a mechanism walked in 3–5 sourced steps, a mid-video reframe, and a
final-20% payoff. Fewer than ~12 solid facts is a thin video; say so in *Open questions* rather than
padding the script with confident-sounding filler (that filler is exactly the vapor the payload rule
exists to kill). More than ~40 and you're likely researching a series, not one video — note the split.

## 6. Story material — extract deep, don't flatten (the character/scene/verification/universality blocks)

A fact-ledger alone produces a lucid *explainer*; a *story* also needs cast, stakes, scenes, and the
proof staged. A 3-topic A/B study (`channels/the-second-take/storytelling-grammar.md`) found our dossiers
pruned exactly this fuel — so the SKILL's template now **requires** more blocks, and they follow the
same sourcing/defamation discipline as the ledger:

- **Cast, motive & human-cost:** the villain's *documented* psychology/motive; the human cost as a LIGHT,
  concrete beat (what broadly happened to the marks: lost savings, homes, or lives; the promise was a lie;
  how many were ruined); and 2-3 witnessed-absurd telling details. A named victim is OPTIONAL light texture
  at most, never required and never a personal life-story (storytelling-grammar §4). These are payload,
  not "mood," but still sourced and hedged (a `Conf: low` motive is flagged, not dramatized as fact).
- **Reportable scenes & characterization** `[Q-NN]` — what was said/done and who was in the room, inside
  your sources. Dramatized beats default to narrator reported speech (storytelling-grammar.md
  §4), so extract the *characterizable substance* — what was said, with what attitude; what a witness
  described happening — NOT verbatim lines to stage. **This is extraction depth, not extra searching:** when
  a source is a transcript, interview, or news account, mine it for this material instead of reducing it to
  summary facts. The study's biggest single miss was a rich interview we had *already cited* being flattened
  to two bullets. Defamation rule still applies — attribute the substance to who said/did it/where; flag a
  witness account as "reported," not asserted. **Claim ↔ reality pairs:** when a source states a claim /
  promise / spin, pair it with the sourced reality that contradicts it (the promise plus the fact that
  unmasks it); only you hold both halves, and that pair is the channel's signature unmasking beat (§4).
- **Verification chain** — for the vindication lever: what's proven/uncontested vs. soft, the
  independence-tagged corroboration, and the exoneration (what the obvious villain did *not* do). This is
  what lets the writer *stage the proving* rather than assert a verdict.
- **Why this matters (universality):** the historical rhyme + the spottable tell, as OPTIONAL body texture
  the writer may weave in where it lands, never a mandated close (the video ends on the story's own irony,
  not a lesson; storytelling-grammar §3.5). General-knowledge rhymes (tulips to NFTs) are allowed here and
  flagged as such.

None of this loosens §1–§3: story material is still sourced, dated, confidence-rated, and defamation-safe.
It does NOT change the cost tier (Step 2.5) — it's deeper reading of sources already pulled, so LIGHT
stays LIGHT.

## 7. One skill, every niche

Nothing here is finance-only except the examples. For another research niche the source hierarchy and
the two-source/date/defamation rules apply the same way — the *primaries* just differ (an engineering
niche → NTSB/accident reports + standards docs; a history niche → archives + primary accounts). The
niche playbook names its own primaries; read it (SKILL Step 1) and apply this contract's shape to them.
