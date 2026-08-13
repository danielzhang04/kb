# Task 18 — Acts 2–7 tranche plan and act-1 re-proof

All commands run for this report were `g4_dry.py batch` commands. Forge makes `batch` dry and says it loads no key/URL ([forge.py:3112-3115](../../../../../../.claude/skills/image-generation/scripts/forge.py#L3112)). No provider call was made.

## 1. Act-1 readiness re-proof

Exact command:

```text
py -3 g4_dry.py batch ../../shots.json <scratch>/t18-act1-recheck.json L01,L02,L03,L04,L05,L06,L07,L08,L09,L10,L11,L12,L13,L14,L15,L16,L17,L18,L19,L20,L21,L22,L23,L24,L25,L26,L27
```

Exit: **0**. No in-scope `PRE-GEN REVIEW GATE` or `refused as a seed` line.

Verbatim summary:

```text
  == batch: 27 scene(s) + 7 STEP-1 figure gen(s), 0 not generated -> C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/t18-act1-recheck.json ==
```

Also: `== scoped to 27 shot(s); 16 seeding-law violation(s) remain OUTSIDE the scope, unaddressed by this spec ==`.

**READY.** This exactly reproduces task 15: 34 requests, zero in-scope refusals, exit 0. Delta: **none**. The changed judge costume/L207 and today’s canonical records did not affect act 1.

## 2. Tranche map

| id | span | n | act coverage | cut rationale |
|---|---:|---:|---|---|
| T02 | L28–L51 | 24 | 2a | Bank funding/sent-turnaround-man ends; L52 begins Wiles’s entrance. |
| T03 | L52–L76 | 25 | 2b | Wiles entrance through target tyranny; L77 opens quarterly-number mechanism. |
| T04 | L77–L101 | 25 | 3 | Whole audit/sheet-swap/clean-audit act. |
| T05 | L102–L126 | 25 | 4a | Ratchet through brick reveal and “next level”; L127 begins shipment/return loop. |
| T06 | L127–L150 | 24 | 4b + 5a | Sales loop into audit sampling, ending at matched-weight proof. |
| T07 | L151–L174 | 24 | 5b + 6a | Fraud escalation, irony, layoffs, first Denver call; L175 starts exit-interview aside. |
| T08 | L175–L198 | 24 | 6b + 7a | Discovery/restatement/bankruptcy/lawsuits, ending at courtroom plate. |
| T09 | L199–L222 | 24 | 7b | Award/reversal/settlement/conviction through defence setup. |
| T10 | L223–L246 | 24 | 7c | Defence reversal, testimony, fallout, payoff, and closing frame. |

Nine tranches cover all 219 shots. A contiguous 24–27-shot plan cannot keep Act 3 (25) and Act 5 (27) whole while partitioning Act 4 (37): Act 4 must borrow across a neighbour. The Act-5-intact preference therefore conflicts with the band; L126/L127 is the least disruptive seam.

## 3. Per-tranche dry triage

“Cards” counts only dry-builder `GENERATE` cards; T02 has seven correctly `REUSED` cards, which create no request ([forge.py:2216-2238](../../../../../../.claude/skills/image-generation/scripts/forge.py#L2216)). R2 is non-delta scenes; R3/R4 are delta parent depth. Root plates in R2 still need board/stamp before sibling scenes seed them ([forge.py:1268-1275](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1268)).

| id | requests | R1 cards | R2 scenes | R3 d1 | R4 d2 | max d | cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| T02 | 36 = 24+12 | 12 | 20 | 3 | 1 | 2 | $1.404 |
| T03 | 43 = 25+18 | 18 | 21 | 3 | 1 | 2 | $1.677 |
| T04 | 40 = 25+15 | 15 | 22 | 3 | — | 1 | $1.560 |
| T05 | 40 = 25+15 | 15 | 21 | 4 | — | 1 | $1.560 |
| T06 | 41 = 24+17 | 17 | 22 | 2 | — | 1 | $1.599 |
| T07 | 36 = 24+12 | 12 | 18 | 5 | 1 | 2 | $1.404 |
| T08 | 37 = 24+13 | 13 | 21 | 3 | — | 1 | $1.443 |
| T09 | 39 = 24+15 | 15 | 20 | 3 | 1 | 2 | $1.521 |
| T10 | 34 = 24+10 | 10 | 16 | 7 | 1 | 2 | $1.326 |
| **total** | **346 = 219+127** | **127** | **181** | **33** | **4** | — | **$13.494** |

Base cost is $0.039/request, before retries. Each scoped dry run exits 1 because the builder intentionally stops before spec writing when blockers exist ([forge.py:2429-2439](../../../../../../.claude/skills/image-generation/scripts/forge.py#L2429)).

Direct primitive items below are **record-missing**: pixels exist; dry says “has no review record.” Place items are **pixels-missing**: dry says “would seed NOTHING” and identifies its root.

| id | dry refusals | record-missing (shots) | pixels-missing (needed mint) |
|---|---:|---|---|
| T02 | 7 | `expr-thinking` L30; `action-recoil` L32,L45; `action-celebrate` L35; `action-salute` L37; `expr-skeptical` L49; `point-at-thing` L51 | — |
| T03 | 12 | `action-accuse` L55,L74; `expr-skeptical`/`hold-paper-by-sides` L61; `sit` L66; `point-at-thing` L68; `handoff` L69; `expr-fear`/`kneel-beg` L70; `action-salute` L71; `action-recoil` L74; `expr-eyeroll` L76 | — |
| T04 | 11 | `expr-thinking` L81,L85; `sit` L81,L82; `point-at-thing` L85; `expr-skeptical`/`hold-paper-by-sides` L90; `expr-fear`/`surrender` L94; `sign-with-pen` L95; `action-thumbsup` L100 | — |
| T05 | 6 | `expr-fear` L106; `expr-thinking` L107,L113; `point-at-thing` L109; `hold-paper-by-sides` L115; `expr-confused` L124 | — |
| T06 | 11 | `point-at-thing` L128; `action-accuse` L130; `sign-with-pen` L132; `expr-skeptical` L133; `expr-thinking` L139; `action-thumbsup` L147 | rented L128,L139,L145,L147 → L112; Wiles office L130 → L65 |
| T07 | 8 | `expr-thinking`/`point-at-thing` L153; `hold-paper-by-sides` L171 | rented L151,L154,L159,L161 → L112; Wiles office L152 → L65 |
| T08 | 9 | `sit` L175,L194; `expr-thinking` L179,L180; `action-recoil` L181; `action-walk` L182; `point-at-thing` L184; `expr-eyeroll` L188 | rented L181 → L112 |
| T09 | 8 | `sign-with-pen` L204; `action-recoil` L205; `facepalm` L206; `expr-eyeroll` L221; `expr-confused`/`surrender` L222 | courtroom L207,L217 → L198 |
| T10 | 8 | `hold-paper-by-sides` L229; `sit` L236; `action-celebrate` L239 | courtroom L225,L230 → L198; warehouse L229 → L86; Colorado yard L239 → L114; rented L246 → L112 |

### First reach and schedule

| asset | first reach | consequence |
|---|---|---|
| miniscribe-floor plate | T02 / L28 | Pixels + verified manifest row present; no current mint. |
| wiles-office | T03 / L65 | Mint/stamp root; blocks T06/T07. |
| audit-room; miniscribe-warehouse | T04 / L84; L86 | Mint/stamp; L86 blocks T10. |
| audit-room variant | T04 / L96 | Mint/stamp before L97 delta. |
| rented-warehouse; colorado-brick-yard | T05 / L112; L114 | Mint/stamp; L112 blocks T06,T07,T08,T10; L114 blocks T10. |
| jury-courtroom | T08 / L198 | Mint/stamp; blocks T09/T10. |
| jury variant; stripped-floor variant | T10 / L230; L232 | Designated variants; stamp L230 before L231. |

The prompt calls these “5 place plates” but lists seven places; all seven are retained. First remaining unstamped primitive reaches: T02 `expr-thinking, action-recoil, action-celebrate, action-salute, expr-skeptical, point-at-thing`; T03 `action-accuse, hold-paper-by-sides, sit, handoff, expr-fear, kneel-beg, expr-eyeroll`; T04 `surrender, sign-with-pen, action-thumbsup`; T05 `expr-confused`; T08 `action-walk`.

There are **no still-unminted cast canonicals**: all 17 registry base paths exist and the four formerly parked characters have all-pass current review rows. First uses: brick-co-seller T05/L115, return-customer T06/L132, trial-judge T09/L207, hr-officer T10/L243. Their STEP-1 frames are derivative cards, not canonical mints.

| tranche | must be ready before dependent generation | preceding board can absorb |
|---|---|---|
| T02 | Stamp six primitives; L28 is present/verified. | none |
| T03 | Stamp seven primitives; mint/stamp L65. | T02 can pre-stamp primitives, not L65. |
| T04 | Stamp `surrender, sign-with-pen, action-thumbsup`; mint/stamp L84,L86,L96. | T03 can stamp the three. |
| T05 | Stamp `expr-confused`; mint/stamp L112,L114. | T04 can stamp it. |
| T06 | L112,L65 and its six records. | T05 can absorb L112/L114 and records. |
| T07 | L112,L65 and its three records. | T06 can stamp the three. |
| T08 | L112 and six records; mint/stamp L198. | T07 can stamp records, not L198. |
| T09 | L198 and six records. | T08 can absorb L198 and records. |
| T10 | L198,L86,L114,L112 and direct records; mint/stamp L230 before L231 and L232 as root. | T09 can pre-stamp existing primitives only. |

Largest mint dependencies: **L112 rented-warehouse**, **L198 jury-courtroom**, and the **L84/L86 audit roots** (especially L86 for T10). No mint/stamp was done.

## 4. Within-round concurrency probe

**Verdict: UNSAFE as written for two `t15_gen.py` drivers, even on disjoint shots.** Forge itself is safe for disjoint output names under the conditions below, but the driver races shared scratch files.

| concern | evidence | result |
|---|---|---|
| staging names | Targets are direct staging children `<name>.png` ([forge.py:1048-1060](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1048)). | Disjoint names imply disjoint PNG/lock paths. |
| reservation | `<name>.png.lock` is atomically created with `O_EXCL`, PID/token tracked, live reservation skipped ([forge.py:1158-1184](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1158)). | Same-name calls do not clobber; disjoint calls do not contend. |
| publish | Unique `.<name>.*.png.tmp`; non-force atomic hard-link refuses a concurrent survivor ([forge.py:1187-1209](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1187)). | Forge staging is safe if names differ and no `--force`. |
| review store | Forge fresh-reads `review.json` ([forge.py:1711-1721](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1711)); it says `stamp_review.py` alone writes verdicts and forge only reads ([forge.py:1741-1747](../../../../../../.claude/skills/image-generation/scripts/forge.py#L1741)). | Generation is read-only; do not stamp concurrently (no reader snapshot lock). |
| genlog/driver state | Forge has no genlog append. Driver writes fixed `_t15_one.json` ([t15_gen.py:63-69](t15_gen.py#L63)) and fixed `t15-round{rnd}-results.json` ([t15_gen.py:138-141](t15_gen.py#L138)). | Two processes can overwrite input before Forge reads it and clobber results. |

It is **SAFE-WITH-CONDITIONS** only after the driver gives every item a unique one-item spec and results path, generated names are disjoint, `--force` is absent, and no review/stamp writer runs during the generation wave. No concurrent live process was run.
