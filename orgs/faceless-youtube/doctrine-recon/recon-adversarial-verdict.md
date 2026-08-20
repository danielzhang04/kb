# Adversarial verdict — doctrine reconciliation plan

## Verdict: SHIP-WITH-CHANGES

**Finding count:** 0 critical · 1 high · 3 medium · 2 low.

The plan does not directly delete a protected structural win: its REVERTs (§§5, 44, 47),
HYBRIDs, and DELETE/relocations retain the named seed/STEP-1, three-state, HARD-delta,
closed-world, partition, byte-equality, and single-stamper mechanisms.  The survival guards are
substantive for the old crowd/anonymous-tier, weak-seed, and soft-delta failures: the current
`lint_shots.py` and `forge.py` have reachable hard gates for those cases.  That is not sufficient
to ship the one live provider-behaviour change below.

## Findings

### HIGH — H1: Ship-blocking A/B gate is being bypassed for a known untested axis

**Location:** `reconciliation-plan.md` §§26/30, lines 289–305 and 332–350; execution order
lines 709–713.

The plan makes the suffix precede the authored payload and calls that payload provider-final.
This is a behavioural change to every assembled scene request, not merely a reconciliation or
byte-lock relocation.  Its cited audit explicitly calls it an *untested* difference
(`prompt-diff-analysis.md:9, 401`) and specifies the required controlled arm: same prompt and
seeds, current suffix at the tail versus the identical suffix immediately before payload
(`prompt-diff-analysis.md:409–418, 479`).  It further says only the winning arm earns a doctrine
change (lines 461–463).  The evidence establishes a correlation and a plausible recency mechanism;
it does not establish that the reorder improves pixels, nor that it preserves current style
integrity.  The plan itself concedes this at lines 299–302, then nevertheless hard-codes the
experimental arm in the implementation.

**Required change:** keep the current order in the reconciliation patch; run the two-arm,
same-seed/provider-order A/B as its own human-gated Bricks arm and promote the reorder only if it
wins the predeclared pixel/human measures.

### MEDIUM — M1: The cross-channel design is not executable under its “no new function” premise

**Location:** `reconciliation-plan.md` §§15, 19, 24, 30, 37, lines 184–190, 219–226,
274–280, 334–347, 401–410, and cross-channel lines 681–695.

The plan says shared code will obtain crowd/rig, technique, lettering, and review values from an
active kit, while kitless channels fail soft.  The only actual production registry schema is
`{channel, engine, characters, assets}`; its assets expose only `name/file/character/kind/tag`
(`registry.json`), not policy sets for the proposed dynamic lint/review values.  The proposed
derivation therefore requires a new configuration interpretation (or new fields/branches), which
contradicts “no new field or channel-specific branch” and makes the promised −35/−45-line code
reductions unverifiable.

This is not theoretical portability debt.  `_TEMPLATE`, `_test-eng`, `_test-metadata`, and
`_test-pipeline` have no `visual-kit`; the current global linter applies TST-only technique rules
to them.  In particular `_test-pipeline` receives 206 current hard failures, including one
`photoreal` failure per prompt, from `_BANNED_RENDER_TERMS` in `lint_shots.py:1397–1413`; its DNA
explicitly calls for stylized 3D/flat-vector, first-person-limb work.  The plan has no resolved
capability contract explaining which generic checks remain HARD without a kit and where each
optional policy is declared.

**Required change:** add a bounded capability matrix and fixtures before editing: generic-hard,
kit-declared-hard, and kitless-pass-through for each moved rule; name the existing source of every
declared value, or explicitly authorize the minimal new configuration surface.

### MEDIUM — M2: The claimed net −261 is a target, not a credible estimate for the proposed code migration

**Location:** `reconciliation-plan.md` §§19/30/37 and net estimate lines 656–677.

The arithmetic sums to −261, but it counts deletions without costing the dynamic resolution,
missing-kit handling, and fixture coverage that M1 requires.  Three representative checks:

| Planned file | Estimate | Current evidence | Review result |
| --- | ---: | --- | --- |
| `lint_shots.py` | −35 | 2,754 lines; the named TST fingerprints/archeology have 29 matching locations, but its replacement needs kit discovery and policy selection. | Not credible as a net estimate without a concrete source schema. |
| `forge.py` | −45 | 3,208 lines; the named hard-code set occurs in 93 matching locations, including assembly, seed routing, preflight, and diagnostics. | A safe genericization cannot be budgeted as comment removal. |
| `visual-grammar.md` | −24 | The proposed deletion includes the 23-line stage block (lines 72–94) plus duplicated place/mechanism prose, while §§41/45 add restored and reordered rules. | Plausible only after paragraph-level before/after accounting; currently unproven. |

The plan properly says to stop if the actual diff is non-negative, but that is too late to preserve
the commission's net-negative constraint: an implementation may have already had to choose between
omitting required portability work and breaking the budget.

**Required change:** replace per-file targets with a before/after line ledger for every changed
paragraph/function, including tests/fixtures required by the new capability behavior; re-approve if
the honest predicted net is not negative.

### MEDIUM — M3: Prop-text bake is neither closed nor cleanly represented in the evidence ledger

**Location:** `reconciliation-plan.md` lines 19–27, §14 lines 174–180, §53 lines 596–601, and
live-test lines 766–769.

Keeping the supplied/verbatim guard is correct, but it does not test the open mechanism: an
otherwise legal prose-named prop can induce invented glyphs.  The only planned response is a
post-generation inventory of L01–L25; it has no named fixture, pass/fail comparison, or acceptance
criterion beyond parking a bad frame.  In addition, §53 calls the de-badged `miniscribe-rep`
costume a “badge/prop-text-bake recurrence.”  The cited incident was an authored costume/registry
instruction faithfully reproduced (`adversarial-full-file.md:53–77`), not the provider-invented
lettering mechanism the plan labels OPEN.  Conflating them overstates present coverage.

**Required change:** retain the OPEN label but add a separate, predeclared prose-named-prop probe
and review transcript to the Bricks gate; report badge/costume propagation separately from invented
lettering and do not claim it closes the latter.

### LOW — L1: §8 treats a repair correlation as evidence that partitions caused it

**Location:** `reconciliation-plan.md` lines 124–129.

`vpw3/critic-verdict-r2.md` supports that the repaired candidate removed the cited repeated phrase
families, but it does not isolate act partitions from the concurrent re-authoring.  KEEP-PRESENT is
reasonable because no evidence shows harm; the causal wording should be downgraded to coexisting
evidence.

**Required change:** say the r2 result is consistent with, not proof of, partition benefit.

### LOW — L2: “Zero protected-win impacts” is accurate for mechanism deletion, but too broad for provider semantics

**Location:** decision frame lines 14–17; §§26/30.

Suffix byte equality survives the reorder, and no seeded-cast, review, no-op, closed-world,
parallelism, or stamping gate is deleted.  But the current tail is itself a provider-weighted
control surface (`forge.py:277–294`); moving it changes its effect even while its bytes remain
identical.  The claim should distinguish structural invariants from untested rendered behaviour.

**Required change:** limit the zero-impact claim to the seven structural invariants and list prompt
order as an open rendered-behaviour risk pending H1's A/B.

## Evidence honesty spot-check (10 verdicts)

| Plan section | Result | Evidence check |
| --- | --- | --- |
| §2 depiction | Supported | Character audit records 48/204 (23.5%) human shots versus 119/214 (55.6%) liked and says priority caused the collapse. |
| §4 closed world | Supported, control-only | `6c2-genlog.md:564` records 8/8 corrective retries passed; it is not taste evidence, as the plan says. |
| §5 three planes | Supported | VPW3 r1 records 202/243 cropped/foreground patterns and only 6/70 small/tiny named leads. |
| §7 palette | Supported but non-causal | Palette forensics records 50.0% new blue+orange versus 22.2% Poyais and 23.8% liked; it identifies interacting authoring and suffix pressure, not a controlled sole cause. |
| §8 partitions | Overstated | r2 records the repair outcome, not an isolated partition experiment (L1). |
| §14 text contract | Supported/open | `rig-script-lettering.md:88` reports zero unrequested lettering in its sampled review; that does not test prose-named props. |
| §20 delta lint | Supported | 26/109 fresh versus 0/22 Poyais no-ops is real; the era map correctly notes no post-E5 comparative proof. |
| §26 prompt order | Evidence correctly labels it untested, verdict is not justified | The cited source requires the A/B before adopting it (H1). |
| §34 three-state review | Supported | 6c2 closes at 23/25 verified and 2 parked, matching the plan. |
| §53 registry/costume | Partly misstated | The badge root fix is supported; it is not evidence that the prose-named-prop lettering mechanism is closed (M3). |

## Cross-channel and baseline lint battery

Channel inventory: `the-second-take` is the only channel with `visual-kit/` (11 `shots.json` files).
`_TEMPLATE` and `_test-metadata` have no shots; `_test-eng` and `_test-pipeline` have one each and
no kit.  Thus the plan is correct that there is no production sibling, but incorrect to treat
portability as already demonstrated.

Command run for every extant file (read-only):

```text
py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py <shots.json>
```

| shots.json | Current result |
| --- | --- |
| `channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` | clean (0 HARD; 7 heads-up) |
| `channels/_test-eng/videos/2026-07-02-the-connection-that-doubled/shots.json` | 27 HARD; 8 heads-up |
| `channels/_test-pipeline/videos/2026-07-02-car-sinks/shots.json` | 206 HARD; 43 heads-up |
| `channels/the-second-take/videos/_bricks-seg/shots.json` | 25 HARD; 18 heads-up |
| `channels/the-second-take/videos/_bricks-vpw2-slice/shots.json` | 34 HARD; 16 heads-up |
| `channels/the-second-take/videos/_pearlman-test-act1/shots.json` | 53 HARD; 48 heads-up |
| `channels/the-second-take/videos/_poyais-authoring-test/shots.json` | 44 HARD; 30 heads-up |
| `channels/the-second-take/videos/_poyais-chunk1/shots.json` | 22 HARD; 28 heads-up |
| `channels/the-second-take/videos/_poyais-test-act1/shots.json` | 25 HARD; 55 heads-up |
| `channels/the-second-take/videos/_poyais-test-slice/shots.json` | 107 HARD; 64 heads-up |
| `channels/the-second-take/videos/2026-07-04-poyais/shots.json` | 186 HARD; 44 heads-up |
| `channels/the-second-take/videos/2026-07-19-wells-fargo/shots.json` | 279 HARD; 140 heads-up |
| `channels/the-second-take/videos/2026-07-19-wells-fargo/staging/shots.json` | 272 HARD; 18 heads-up |

Baseline: **1/13 clean, 12/13 pre-existing failures.**  Post-plan validation must compare every
file's exit status and violation count to this table; “lint clean today” applies only to
`2026-07-28-bricks-fresh`.

## Required changes before ship

1. Gate §§26/30 behind the existing two-arm, same-seed provider-order A/B; do not reorder in the doctrine patch.
2. Specify and fixture a capability matrix for generic, kit-declared, and kitless rules before externalizing TST values.
3. Re-baseline the net line budget with paragraph/function/test accounting rather than target-only estimates.
4. Add a distinct prop-text probe and stop counting the authored badge incident as proof against invented lettering.
5. Downgrade the partition causal claim and restrict “zero impacts” to structural invariants.
