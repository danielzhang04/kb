# P2b Prompting Research — how to prompt codex CLI's `image_gen__imagegen` natively

Worker: P2b research worker (background Claude agent, sonnet), codex-image-engine arc.
SCRATCH = `C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine`
Started 2026-08-11.

Mission: establish HOW to prompt this tool optimally as its own discipline (not adapted-Gemini
prose), via published guidance (Part 1) + empirical probes (Part 2), feeding a codex-native prompt
composer design.

Ground truth already established, NOT re-probed here (from `p1-probelog.md`, P1's own probe run):
params = `prompt` (required, string), `referenced_image_paths` (array of **absolute** local paths,
hard cap **exactly 5**, clean server-side rejection above that); one image per call; no size/aspect/
quality params; aspect is steerable by prose ratio language but never pixel-exact; no structured
tool_call/tool_result telemetry in `--json` mode (harvest by `~/.codex/generated_images/<thread_id>/
*.png` newest mtime, scoped by `thread_id` from the `thread.started` event); every call re-pays a
large fixed token tax (~60k-115k input tokens) because each `codex exec` is a cold process that
re-reads the imagegen SKILL.md; the engine volunteers unrequested in-image text routinely; no
refusal path observed even for named real convicted-fraud figures.

Budget for THIS worker: separate 12-generation ceiling from P1's (P1 used its own 8/12 already, but
that was a different probe log's budget — treating this as its own fresh 12-image allowance per the
P2b brief). 4-min ceiling per gen + one re-issue. All codex calls:
`codex exec --sandbox workspace-write --cd SCRATCH`. Writes only under SCRATCH; kit + main checkout
read-only. $0 spend, subscription only, never touch .env/GEMINI_API_KEY.

Gen tally: **0 / 12** used at log start.

---

## PART 1 — Published guidance

Note on applicability: `image_gen__imagegen` inside codex CLI is very likely a wrapper around
OpenAI's GPT Image family (gpt-image-1 / gpt-image-1.5 / gpt-image-2 generation stack — same
company, same "one image per call, describe don't parameterize" contract shape as Probe A-H found).
No codex-CLI-specific prompting doc was found (codex CLI's own docs describe the tool's plumbing,
not prompt style) so the family's official model-level guidance is the best available published
source and is treated as authoritative for "what this model family rewards," with the caveat that
the exact minted version behind `image_gen__imagegen` is not confirmed.

### Sources

1. [GPT Image Generation Models Prompting Guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) — OpenAI Cookbook, official.
2. [Gpt-image-1.5 Prompting Guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-1.5-prompting_guide) — OpenAI Cookbook, official, version-specific.
3. [Image generation | OpenAI API](https://developers.openai.com/api/docs/guides/image-generation) — official API guide (param-level, size/quality; not fetched in full, surfaced by search).
4. [Best practices for prompt engineering with the OpenAI API](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-openai-api) — official Help Center (general LLM prompting, not image-specific; surfaced by search, not deep-fetched — lower priority than 1/2).
5. [Negative prompts for text generation — OpenAI Developer Community](https://community.openai.com/t/negative-prompts-for-text-generation/203346) — community thread on negative-prompt behavior.
6. [Negative Prompting 2026: Guard Against Bad AI Outputs — promptquorum.com](https://www.promptquorum.com/prompt-engineering/negative-prompting) — community synthesis, cites GPT Image 1.5 negative-prompt behavior specifically.
7. GPT Image 2 vs Gemini comparisons (community, lower-confidence, directional only): [MindStudio](https://www.mindstudio.ai/blog/gpt-image-2-vs-gemini-image-generation), [Tom's Guide](https://tomsguide.com/ai/i-just-tested-chatgpt-5-vs-gemini-2-5-pro-with-9-ai-image-prompts-and-one-crushed-the-other).

### Distilled findings (sources 1+2, both official, both converge on the same structure)

**Prompt ordering doctrine — this is the headline finding.** OpenAI's own guidance states the
canonical order is **background/scene → subject → key details → constraints**, and explicitly
instructs to state the intended use ("ad, UI mock, infographic") up front to set "mode and level of
polish." This is the OPPOSITE emphasis from Gemini, where P1/prior kb doctrine treats the LAST
sentence as highest-weighted (suffix-recency behavior — see `global_prompt_suffix` convention in
this kit's own `shots.json`, appended at the tail because Gemini honors trailing instructions most
strongly). **If GPT Image genuinely reads front-loaded structure as primary, then bricks kit's
entire "style suffix at the end" idiom is backwards for a codex-native composer** — this is the
single highest-leverage hypothesis for Probe E (length/position sensitivity) to test empirically.

**Constraints go LAST, not first, within the prompt — but this is a *within-constraints* ordering
rule, not a contradiction of the above.** Source 1's own top-line finding says "put constraints at
the end of your prompt after all positive descriptors, as placing them early can cause the model to
weight them as compositional guidance rather than exclusions." So the full doctrine is: **scene →
subject → details → [constraints last, as their own labeled block]** — constraints are a distinct
final movement, not intermixed with descriptive prose. This is a nuance a "everything Gemini-style
goes at the tail" composer would miss: GPT Image wants ONE tail block (constraints), not the whole
style-suffix repeated as a coda.

**Format is explicitly stated to be flexible, but labeled/segmented is preferred for complexity.**
Direct quote: "Minimal prompts, descriptive paragraphs, JSON-like structures, instruction-style
prompts, and tag-based prompts can all work well as long as the intent and constraints are clear."
For anything non-trivial, "use short labeled segments or line breaks instead of one long paragraph."
This licenses the labeled-field format probe (Probe B format 2) as genuinely idiomatic, not an
adaptation — it's what OpenAI's own doc recommends, not an invented structure.

**Exclusions/invariants must be EXPLICIT and NAMED, not implied by omission.** Direct quote pattern:
"State exclusions and invariants explicitly (e.g., 'no watermark,' 'no extra text,' 'no logos/
trademarks,' 'preserve identity/geometry/layout')." This maps directly onto two real P1 failure
modes: unrequested in-image text (Probe E/H) and identity/costume drift — official guidance says
name these as explicit negative/invariant items, not trust the positive description to imply them.
**Directly actionable for the composer: every codex-native prompt should carry an explicit "no
extra text / no invented signage / no logos" clause** given P1 found this engine volunteers text
unprompted in every single gen call.

**Text-in-image control: quotes/ALL CAPS + spelled-out letters for hard words.** "Put literal text
in quotes or ALL CAPS... For tricky words, spell them out letter-by-letter." Since bricks house
style explicitly wants no unrequested text but DOES want intentional in-world lettering sometimes
(hand-lettered marker-style signage per `global_prompt_suffix`), the same quoting mechanism that
suppresses unwanted text is also the on-ramp for wanted text — quote exactly what should render,
leave everything else undescribed rather than described-and-hoped-to-be-suppressed.

**Reference images: cite BY INDEX AND DESCRIPTION, and state the INTERACTION explicitly.** Official
pattern: "Image 1: product photo… Image 2: style reference…" then explicit interaction language
like "apply Image 2's style to Image 1" or "put the bird from Image 1 on the elephant in Image 2."
This is a strong, direct steer for Probe D (seed-role description): ordinal + content-descriptive
+ explicit interaction verb, combined, is the officially documented idiom — not a three-way
either/or as the brief's phrasing implied. Style-transfer specifically: describe "what must stay
consistent (style cues) and what must change (new content)" — i.e. tell the model the style tile's
role is style-only and forbid content transfer in the same sentence, which is exactly the
cast-free-only law's concern in Probe D role-purposed framing.

**Composition/style levers:** framing + viewpoint + perspective + lighting as separate explicit
clauses ("close-up, wide, top-down" / "eye-level, low-angle" / "soft diffuse, golden hour,
high-contrast"). For photorealism, the literal word "photorealistic" is a strong activator — by
inversion this suggests the *inverse* register words ("flat cel," "2.5D vector," "no photorealism")
should carry similarly strong weight for holding a NON-photoreal register, i.e. Probe B/C's flat-cel
recovery may respond well to doubling down on explicit anti-photoreal vocabulary rather than only
describing the desired style positively.

**Aspect ratio / size: parameterized in the family's HTTP API (`size`, discrete or flexible
constraints), NOT prose-only** — this is a genuine mismatch with codex CLI's actual observed
contract (P1 Probe D: no size param exists on `image_gen__imagegen`, aspect is prose-only and only
ratio-steerable, never pixel-exact). **This confirms codex CLI's tool wraps the family but exposes
a deliberately reduced parameter surface** — the published API-level aspect guidance does not
transfer; prose-ratio steering (P1's finding) is the only lever actually available through this
specific tool, so the "size" section of official docs is not composer-actionable here.

**Iteration doctrine: single small changes, not one giant prompt.** "Start with a clean base
prompt... refine with small, single-change follow-ups" rather than overloading initial asks. Given
codex CLI has no image-edit/follow-up call in this tool's contract (P1: one image per call, no
persistent editing turn) this doctrine mostly does NOT transfer to codex CLI's shape — each call is
a fresh mint, not an edit-in-place — but it does support keeping any single prompt's constraint
list SHORT and targeted rather than exhaustive, since the model family's own doctrine treats
long/compound instructions as something to decompose, not something it reliably holds all of.

### Negative-prompt / avoid-list findings (sources 5+6)

**Mixed evidence, model-family-dependent, and directly relevant to composer Part C.** Source 6
explicitly says "GPT Image 1.5 responds well to negative prompting in text prompts" (in contrast to
other models needing positive-only workarounds), which supports building an explicit Avoid-list
field into the composer. But the same source's broader synthesis (drawing on SDXL/SD3 research) also
warns some negative prompts are simply ineffective at removing certain concepts regardless of model,
and that vague/soft phrasing ("avoid if possible") underperforms direct phrasing ("Never use the
words..."/"no X"). **Actionable synthesis: an Avoid list is worth building into the composer
(family-level evidence supports it for this specific model line), but it must be phrased as hard
direct negation, not hedged, and should stay short (2-4 items) rather than exhaustive** — this
matches Source 1's official framing where exclusions are stated as a short explicit list, not prose.
No source directly confirms or denies avoid-list-vs-flowing-negative-prose efficacy in a controlled
way — **this remains an open empirical question that Probe C (empirical) is positioned to answer**,
published guidance only establishes "explicit, short, hard-phrased" as the right shape, not the
prose-vs-list format question itself.

### What this model family rewards that Gemini's last-instruction-weighted prose does not (distilled)

1. **Front-loaded scene/subject ordering** as the primary structural signal, with constraints
   pulled into one distinct trailing block — not a single tail-weighted suffix carrying everything.
2. **Explicit named exclusions/invariants** as their own clause, rather than trusting a positive
   description to imply what should NOT appear (Gemini kit doctrine currently has no formal
   Avoid-list convention at all per P1's read of `shots.json`).
3. **Explicit reference-image indexing + interaction verbs** ("apply Image 2's style to Image 1")
   as a first-class documented idiom, not an inferred convention.
4. **Format flexibility is officially sanctioned** — labeled-field prompts are not a workaround,
   they are one of five explicitly endorsed shapes for this model family, which the current
   Gemini-oriented `shots.json` prose convention does not use at all.
5. **Single-change iteration philosophy** (not directly portable to this single-shot tool contract,
   but implies the model family does NOT reward maximally-exhaustive one-shot mega-prompts — the
   opposite bias from "pack everything into one paragraph and let recency-weighting sort it out").

What Gemini-optimal likely retains value for here: nothing in official GPT Image guidance argues
AGAINST rich descriptive detail — it argues for reordering and labeling it, not truncating it. The
scene-content substance built for Gemini prompts is probably reusable; the shape it's poured into
is the thing to change. This is the hypothesis Probe B is designed to test head-to-head.

### CRITICAL ADDITIONAL SOURCE — the local SKILL.md is not "web guidance," it IS codex's operating
### instructions for this exact tool. Read directly, not summarized secondhand. Supersedes web docs
### wherever they conflict, because this is literally what codex consults before every call.

Discovered while researching the invocation mechanics (see Part 2 methodology note below): the
`image_gen__imagegen` tool is backed by a local skill at
`C:\Users\danie\.codex\skills\.system\imagegen\SKILL.md` (+ `references/prompting.md` +
`references/sample-prompts.md`), read fresh by the agent on every `codex exec` process (this is
the ~9.5k-word read P1 already clocked as fixed per-call token tax). This is **the actual governing
document**, not just "good practice someone wrote about the model" — codex is instructed to consult
it and follow it. Its content converges almost verbatim with the official OpenAI cookbook docs
(source 1/2 above), which is reassuring (independent confirmation), but it adds composer-critical
specifics the web docs don't:

**The exact labeled schema codex itself is told to produce** (`SKILL.md` L214-229):
```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```
This is the field set and field NAMES Probe B's "labeled-field format" variant should use verbatim
— it is not an invented idiom, it is codex's own documented native schema, closer to ground truth
than reconstructing one from the web cookbook alone. Note it has a dedicated `Avoid:` field distinct
from `Constraints:` (constraints = keep/must-preserve; avoid = negative/forbidden) — Probe C should
respect this exact split rather than merging them.

**Order confirmed a third way, worded slightly differently again:** `references/prompting.md` L24:
"scene/backdrop -> subject -> key details -> constraints -> output intent" (SKILL.md's own workflow
doc adds "-> output intent" as a fifth trailing stage beyond the cookbook's four — i.e. state the
intended final use/context AFTER constraints too, not only up front as the cookbook implied. Minor
tension between SKILL.md L24 "include intended use... to set polish level" implying it's early, and
the taxonomy `Use case:` field being the FIRST labeled line in the schema — output intent appears to
belong at the very front as a `Use case:` line, not the tail. Read literally, the sequence is
Use-case-first, THEN scene->subject->details->constraints.)

**Most important finding for Probe A (verbatim pass-through), found BEFORE any probe A gen call
returned:** `SKILL.md` step 9 (workflow) and `references/prompting.md` "Specificity policy" both
state: **"If the user's prompt is already specific and detailed, normalize it into a clear spec
without adding creative requirements."** This is an explicit, standing instruction to REFORMAT
input prompts into the labeled schema, not pass them through untouched — even for prompts that are
already detailed. **This predicts, before any empirical test, that naive verbatim requests are
fighting the skill doc's own default behavior**, and that achieving true pass-through (if possible
at all) will require an explicit, forceful override instruction that this "normalize" default can
be shown to yield to. Probe A is designed exactly to test whether such an override works.

**Reference-image labeling doctrine, stated plainly:** `references/prompting.md` L63-68 — "Label
each image by index and role (`Image 1: edit target`, `Image 2: style reference`)" and "for
compositing, describe how the images interact." This is the same idiom as the web cookbook (index +
role + interaction verb) but with codex's own example phrasing — directly informs Probe D's
role-purposed format as the documented default, not an invented option.

**Iteration doctrine confirmed identical to the cookbook** (small single-change edits, re-specify
invariants each time) — again mostly non-portable to a single-shot `codex exec` process per P1's
contract, but reinforces "keep any one prompt's constraint list targeted, not exhaustive."

---

## PART 2 — Empirical probes

### Methodology note: verbatim-ground-truth upgrade over P1's self-report method

Before Probe A, found a materially better ground-truth source than asking the agent to self-report
its tool call. `codex exec` writes a full session transcript to
`~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread_id>.jsonl` (thread_id matches the
`thread.started` event from `--json` mode, so it's the same handle P1 already uses for image
harvesting). That rollout log contains a `custom_tool_call` item whose `input` field is the **literal
JavaScript source the model wrote to invoke the tool**:
```js
const params = {
  prompt: "...",
  referenced_image_paths: ["..."]
};
const result = await tools.image_gen__imagegen(params);
text(JSON.stringify(result));
```
This is a structural discovery in its own right: **`image_gen__imagegen` is not called as a native
OpenAI-style structured function call — it is invoked from inside a sandboxed JS `exec` snippet the
model authors itself**, calling into a `tools.*` namespace. This means the model re-serializes the
prompt as a JS string literal every time, which is itself a transcription step (escaping, quoting)
distinct from "the model decided what to say." For verbatim-pass-through testing, diffing this
logged `params.prompt` JS-string value against the source text is **strictly better ground truth
than the model's spoken self-report** (which could itself paraphrase what it "recalls" sending,
independent of what actually got sent) — so Probe A below uses the rollout-log `prompt:` field as
the primary verdict, with the model's spoken self-report captured as a secondary reliability check
on the self-report channel itself.

### Sandbox-mode finding (non-gen, but consumed wall-clock — logged as a hard constraint)

First Probe A attempt used `--sandbox read-only` on the theory that it might fail fast before any
render (same shape as P1's non-billable relative-path/6-seed rejections) and give a free look at the
logged JS source at zero gen cost. **It did not fail fast — it hung past the 4-minute stall ceiling**
(killed manually at ~7 minutes wall clock, 4 live `codex.exe` child processes still running, zero
bytes ever written to the redirected `--json` output file). Unlike P1's validation-error rejections
(bad path, >5 seeds), which are checked and rejected before any network call, `--sandbox read-only`
apparently does not cleanly refuse an image-gen call — it likely lets the agent proceed into the
tool call and then blocks/retries at the network layer without surfacing a clean error, which is a
worse failure mode (silent hang) than a clean validation rejection. **Practical finding: there is no
free/cheap way to inspect the pass-through JS source without spending a real generation — `--sandbox
workspace-write` is required for any image_gen probe.** This consumed the probe's one allowed
re-issue; the retry below runs directly in `workspace-write` and counts as GEN #1.

---

## Probe A — verbatim pass-through (GEN #1, #2)

Gen tally after this section: **1 / 12** (this GEN #1 call).

### GEN #1 — result: BYTE-FOR-BYTE VERBATIM, via a mechanism better than expected

Invocation: `codex exec --json --sandbox workspace-write --cd SCRATCH "Read the file
.../probeA-prompt.txt verbatim... Call image_gen__imagegen tool EXACTLY ONCE, passing prompt = the
exact file content character for character with zero paraphrasing... referenced_image_paths =
[seeds/figA-qt-wiles.png]. This is a pass-through fidelity test -- your normal instinct to normalize
or restructure prompts is explicitly overridden for this one call."` Source prompt file
`probeA-prompt.txt`, 1747 chars, labeled-field-ish structured content with unusual fingerprints
(fictional name "Q.T. Marchbanks-7", quoted signage "AUDIT ROOM 4B" / "CONFIDENTIAL - DO NOT COPY",
hex codes, a batch-ID string "TB-0091-rev3") chosen specifically to make any paraphrase/drift easy to
spot on diff.

**Ground truth used: the session rollout log, not the model's self-report** (see methodology note
above). Extracted the literal `custom_tool_call` JS source the model wrote
(`~/.codex/sessions/2026/08/11/rollout-2026-08-11T16-22-24-019ff27d-....jsonl`, item index 130):

```js
// @exec: {"yield_time_ms": 120000, "max_output_tokens": 2000}
const reader = await tools.mcp__node_repl__js({
  code: "var passThroughPromptA = await fsA.readFile('C:\\\\Users\\\\danie\\\\...\\\\probeA-prompt.txt','utf8'); nodeRepl.write(passThroughPromptA);",
  title: "Load exact image prompt",
  timeout_ms: 30000
});
const prompt = reader.content.find(x => x.type === "text").text;
const result = await tools.image_gen__imagegen({
  prompt,
  referenced_image_paths: ["C:\\Users\\danie\\...\\seeds\\figA-qt-wiles.png"]
});
```

**This is the headline finding of the entire probe set.** When explicitly told to preserve a prompt
verbatim, the model did **not** retype the prompt text into the JS string literal at all (which
would have reintroduced a transcription/paraphrase risk each call) — it wrote code that **reads the
prompt from disk at execution time and pipes the file's exact contents directly into the `prompt`
field as a variable**, never re-authoring the string itself. Confirmed against the actual
`custom_tool_call_output` (the tool's own returned JSON, which echoes back `{"prompt": "...", ...}`
verbatim): programmatic diff of the captured `prompt` field against the source file —
**`len(source)==len(captured)==1747`, `source == captured` → `True`, zero-byte difference.**

**Design implication — this is the composer's core invocation incantation:** verbatim pass-through
is reliably achievable, but the reliable path is **materialize the prompt as a file on disk and
instruct codex to read-and-pass-through programmatically**, not embed the prompt inline in the
instruction text and hope the model retypes it faithfully. This sidesteps the "normalize into a
clear spec" default behavior documented in `SKILL.md`/`references/prompting.md` (Part 1 finding)
entirely — the model never even runs its prompt-authoring judgment over the text because it never
has to "compose" the string, only reference a variable holding it. **If the composer writes the
finished prompt to a scratch file and the invocation instructs "read this file's exact bytes as the
prompt argument, do not compose or rephrase," the composer owns 100% of what the tool sees.**

**Side finding, corrects a P1 read:** P1's Probe A/C log said the raw tool return "never reaches the
CLI's visible text/JSON output at all, only the file path does" (based on one agent's spoken
disclaimer that it couldn't reproduce a truncated base64 blob). The rollout log shows this is
**not a hard capability limit** — the tool's actual JSON return value **does** include the full
`data:image/png;base64,...` inline payload (confirmed present in this call's `custom_tool_call_output`,
a ~7,497-character JSON blob including the full data URI), it just isn't something the agent chooses
to paste into its spoken final summary (sensible: would blow the response budget). The file-path
harvest method P1 recommended is still correct as the practical integration path, but "the base64
never reaches the process" was an overstatement — it reaches the JS sandbox, the agent just doesn't
echo it back in prose.

**Side finding — the ambient-repo-read side effect (P1 finding #7) is worse than P1 characterized,
not just "some declarative side effect."** This one call's rollout log shows the agent spent **24
separate tool calls before the actual image_gen call**, systematically reading (via a persistent
`node_repl__js` state, plus raw `shell_command` calls): the imagegen `SKILL.md`, this repo's
`CLAUDE.md` (twice, via two different mechanisms after the first attempt), a directory listing of
the worktree, `ALL_TOOLS` introspection (twice), walking up to the **kb repo root** to read
`orgs/kb-ops/contract.md`, `orgs/kb-ops/STATE.md`, `BOSS.md`, `memory/` directory listing, `_index.md`
(twice), a `fs.stat`/`fs.access` check for the constitution's `STOP` file, and an attempted direct
execution of `py -3 scripts/preamble.py` (**the kb constitution's own preamble script**) — before
finally calling `view_image` on the seed and then `image_gen__imagegen`. None of this leaked into the
image or the final report, but it **more than 8x'd this call's token cost relative to a comparable
P1 single-seed call** (936,102 input tokens here vs. Probe C's 114,002 for a similarly-shaped single-
seed request) and represents the agent actively trying to self-orient using this repo's governance
files from inside a task that should have stayed scoped to SCRATCH. **This is a real repo-boundary
control gap, sharper than P1's phrasing suggested — worth flagging as a hard risk for the composer
build, not a curiosity**: nothing stops a codex-mediated image call from reading (not just failing to
read) sensitive ambient files if they're reachable from its `--cd`, and a repeated pattern of this
per-call is a meaningful cost tax even when harmless.

Harvested output: `out-p2b/probeA-gen1.png` (from
`~/.codex/generated_images/019ff27d-93f6-7ab1-afb8-fcfb84121f05/exec-5a2c2c62-....png`).

### Register-target recalibration (non-gen — corrects P1's ground truth for Probe B/C ahead of running them)

P1 had no real Gemini-rendered frames available and used the style-bible's pinned outline hex
(`#241a12` -> R-B = **+18**) as the only ground truth. This worker's SCRATCH now has real
Gemini-minted baseline frames (`gemini-baseline/L26-L50.png`, 23 files, provided for this worker
specifically). Measured all 23 with the same darkest-3%-by-luma R-B method (`measure.py`, validated
against P1's own G1/G2 numbers first — reproduced `-6.5` and `+8.0` almost exactly, `+7.9` in P1's
manual read, confirming the method is stable):

| Stat | Value |
|---|---|
| Range | +0.5 (L29) to +53.3 (L49) |
| Mean | **+20.4** |
| The pinned-hex target (+18) | close to the mean, but... |
| Same-shot ground truth (L29, the shot Probe B reuses) | **+0.5** — a striking outlier, one of the coolest/darkest frames in the set |

**Finding: the single pinned-hex "+18" target is a reasonable population mean but a poor per-shot
comparison target — real Gemini output varies from +0.5 to +53.3 shot-to-shot (roughly a 100-point
spread) depending on scene lighting/palette, not a tightly-held constant.** This matters directly
for Probe B, which reuses shot L29: the *real* Gemini rendering of this *exact* shot measures only
**+0.5**, nowhere near +18. Two consequences for how Probe B's verdict should be read below: (1) the
correct apples-to-apples baseline for probe B is L29's own +0.5, not the population's +18 or +20.4;
(2) "beating +18" is not actually the right bar for a codex output styled after L29's specific
content — the honest verdict is closeness to L29's own render, informed by the fact that no single
number generalizes across the channel's own shots. Both comparisons (vs. same-shot L29, vs.
population mean +20.4) are reported below so neither reading is hidden.

---

### GEN #2 — consistency check, deliberately varied one thing (scoping instruction added)

Gen tally after this section: **2 / 12**.

Same instruction as GEN #1 with one addition: `"Do not read any files outside this scratch
directory."` Goal: check both (a) does verbatim fidelity hold on a second independent run, and
(b) does an explicit scope instruction curb the ambient-repo-read side effect from GEN #1.

**(a) Fidelity: holds, via a DIFFERENT mechanism this time.** GEN #2's rollout log
(`rollout-2026-08-11T16-30-18-019ff284-....jsonl`) shows the model did **not** reuse GEN #1's
file-read-into-variable trick this run — it directly embedded the prompt text **inline as a JS
string literal** in the `tools.image_gen__imagegen({prompt:"...", ...})` call, i.e. retyped/
reproduced the string manually inside the code it wrote, a strictly riskier mechanism (this is the
transcription step GEN #1 avoided entirely). To check fidelity here (the tool's own output this run
only echoed back `{image_url, output_hint}`, not the prompt, so P1-style self-report/JSON-echo
wasn't available as ground truth), extracted the raw JS source from the rollout log and ran it in a
sandboxed Node harness (`extract-prompt.js`, stubs `tools.image_gen__imagegen` to capture its
`params.prompt` argument, executes the real captured source unmodified) to get the literal string
value the model's own code would have passed at runtime, then diffed against the source file:
**`source len 1747`, `captured len 1747`, `EQUAL: true`.** Byte-for-byte identical a second time,
via the less-safe manual-retype path. **Two independent runs, two different call-construction
mechanisms (programmatic file-read vs. manual inline retype), zero drift in either** — this is a
meaningfully stronger consistency result than one lucky run.

**(b) Scoping instruction helped but did not fully eliminate the ambient-read side effect.** GEN #2
made **11** `custom_tool_call`s before finishing (down from GEN #1's 25) and `input_tokens` dropped
to **246,742** (down from 936,102) — roughly a 3.8x reduction, meaningful but the call still cost
~2.2x a clean P1-style single-seed call (114,002). The detour was shorter but not gone; not
independently re-verified item-by-item here (out of gen budget to spend re-probing this specific
side question), logged as a partial mitigation, not a fix.

Harvested output: `out-p2b/probeA-gen2.png` (from
`~/.codex/generated_images/019ff284-d05e-7653-8860-758c0d141fa3/exec-cce9c4e5-....png`).

### Probe A verdict

**Verbatim pass-through is RELIABLE when explicitly requested with override language, confirmed
byte-for-byte across 2 independent runs via 2 different internal mechanisms.** The mechanism
matters for robustness but not, in these two tests, for correctness:

- **Best-practice invocation incantation (what the composer should use):** materialize the finished
  prompt as a UTF-8 text file on disk, then instruct codex explicitly: *"Read the file at &lt;absolute
  path&gt; and pass its exact byte content as the `prompt` argument to `image_gen__imagegen`. Do not
  compose, paraphrase, normalize, or reformat this text — read and pass through only."* This gives
  the model an easy, low-effort path (a file read) that is strictly safer than asking it to retype a
  long string inline, and GEN #1 shows the model will spontaneously choose the safer programmatic
  read when a file path is available and normalization is explicitly forbidden.
- Do not rely on inline-embedded prompt text in the natural-language instruction alone and hope the
  model reproduces it — while GEN #2 shows manual retyping CAN be perfectly faithful, it is a
  strictly riskier mechanism the composer should not depend on when a file-based alternative exists
  and costs nothing extra.
- **The standing "normalize into a clear spec" default (Part 1 finding, `SKILL.md`/
  `references/prompting.md`) can be reliably overridden** with explicit, forceful pass-through
  language ("this instinct is explicitly overridden for this call") — both runs honored it fully,
  zero reformatting into the labeled schema, zero added/removed content.
- **This is the single most important fact for the composer's architecture**, per the brief: it
  means the composer can own 100% of what the tool sees. A prompt-composition layer that builds the
  final string (whichever format Probe B below finds best) and writes it to a scratch file, then
  issues a read-and-pass-through invocation, gets exactly its own text into the tool with no
  paraphrase risk to design around.
- Residual, unresolved risk carried forward (not eliminated by this probe): the ambient-repo-read
  side effect (P1 finding #7, sharpened above) is real, costly, and only partially curbed by an
  explicit scope instruction — a production composer needs either a hard sandbox boundary (not just
  a prompt-level instruction) or acceptance of a recurring token tax and a residual (so-far harmless)
  repo-boundary read risk.

---

## Probe B — format shootout (GEN #3, #4) + Probe C folded in (no extra gens needed)

Gen tally after this section: **4 / 12**.

Same shot content throughout (L29, miniscribe-rep seed = `seeds/figB-miniscribe-rep.png`), three prompt
SHAPES, same underlying facts. All three requested 16:9 explicitly and all three landed at the same
output resolution (**1672x941**, ratio 1.776, matching 16:9's 1.778 within 0.1%) — aspect adherence
is a non-issue across all three formats, consistent with P1 Probe D/G.

- **Format 1 (adapted-Gemini prose)** = P1 Probe G2's exact prompt, **reused, not regenerated**
  (`out/probeG2-withSuffix.png`) — this is genuinely the same prompt text (verified: both this
  worker's `probeB-format1-gemini-prose.txt` and P1's G2 invocation contain the shot's `still_prompt`
  + `global_prompt_suffix` concatenated verbatim). 1061 chars.
- **Format 2 (labeled-field)** = `probeB-format2-labeled-field.txt`, using the exact field names
  from `SKILL.md`'s own shared prompt schema (Part 1 finding) — `Use case / Asset type / Primary
  request / Input images / Scene-backdrop / Subject / Style-medium / Composition-framing /
  Lighting-mood / Color palette / Materials-textures / Text (verbatim) / Constraints / Avoid`. 1740
  chars, generated via the file-read-and-pass-through invocation (Probe A's confirmed-reliable
  method).
- **Format 3 (minimal-prose + hard avoid-list)** = `probeB-format3-minimal-avoid.txt`, terse
  descriptive prose (no labels) + a single trailing `Avoid:` clause. 617 chars — the shortest of the
  three by a wide margin.

### Measurements

| Format | Chars | Dims | Darkest-3% RGB | R-B | vs L29 real (+0.5) | vs pinned-hex target (+18) |
|---|---|---|---|---|---|---|
| 1 — Gemini prose (reused G2) | 1061 | 1672x941 | (38.1, 34.3, 30.1) | **+8.0** | off by 7.5 | off by 10.0 |
| 2 — labeled-field | 1740 | 1672x941 | (29.4, 25.9, 24.8) | **+4.6** | off by 4.1 | off by 13.4 |
| 3 — minimal + avoid | 617 | 1672x941 | (9.3, 7.8, 6.8) | **+2.5** | **off by 2.0 (closest)** | off by 15.5 |
| *(reference) real Gemini L29* | — | 1376x768 | (7.0, 8.7, 6.5) | +0.5 | — | — |

**Reading this against the recalibrated target (see above): the honest bar is closeness to L29's
own real render (+0.5), not the population-level pinned hex (+18) — and by that bar, format ranking
INVERTS from what "port the native Gemini prompt as-is" would predict.** Format 3 (shortest, most
minimal, hard avoid-list) lands closest to the real same-shot baseline; format 2 (full labeled
schema) is second; format 1 — literally the exact prompt text that produced good results on
Gemini — is the FURTHEST from the real target when run through codex. If judged only against the
old pinned-hex population target, the ranking looks opposite (format 1 closest to +18) — which is
exactly why the recalibration above matters: judging by population mean rewards the warmest/most
saturated-ink output, but judging by this specific shot's real ground truth rewards the coolest.

### Eyeball read (flatness, gradients, unrequested text, identity)

- **Format 1** (`out/probeG2-withSuffix.png`): visible ambient shading on ceiling support beams and
  a soft floor gradient/reflection; MINISCRIBE sign correct, benches/tote-bins/roller-door all
  present and correctly placed; delighted power-stance held; **zero unrequested text** this run (the
  E2 "TOTE RACK / STAGE-LEFT" mislabel from P1 did not recur here — likely prompt-specific, not a
  guaranteed failure).
- **Format 2** (`out-p2b/probeB-format2.png`): visibly flattest of the three — minimal shading
  anywhere, clean flat fills, cool grey-teal-cream palette rendered close to the requested locked
  palette; MINISCRIBE sign correct (teal-on-cream, matches "hand-lettered marker style" reasonably);
  tote bins correctly stage-left; foreground table cropped lower-right as requested; **zero
  unrequested text**; strong identity hold (tan blazer, brown shirt, dark hair, delighted expression,
  stocky build all present).
- **Format 3** (`out-p2b/probeB-format3.png`): also very flat, minimal shading; MINISCRIBE sign
  rendered boldly in the red accent color (a reasonable, arguably correct interpretation of "red
  accent... used only semantically... the final punch element" carried over from format 1's DNA even
  though format 3's own text never said to color the sign red — worth flagging as a mild
  over-interpretation, not a violation); added unrequested floor lane-marking lines and extra
  workbench equipment (lamp, red trays/bins) not in the prompt — plausible embellishment, same
  "volunteers extra content" tendency P1 flagged, but **still zero unrequested TEXT** (the specific
  house-style violation P1's Probe E/H hit); strong identity hold, matching format 2.

**Verdict: format 2 (labeled-field) and format 3 (minimal + avoid) both measurably and visibly beat
format 1 (ported Gemini prose) at holding the flat-cel register on this engine**, with format 3
edging format 2 on the numeric ink metric but format 2 showing tighter control over unrequested
scene embellishment (format 3 added floor markings and extra props format 2 did not). Given the
composer's stated design fear is content leak/embellishment more than a few points of ink-warmth,
**format 2 (labeled-field) is the safer default recommendation; format 3 is a viable lighter-weight
alternative when prompt length needs to stay minimal** (e.g. token-cost-sensitive batch runs, tying
back to P1's per-call token-tax finding).

### Probe C (avoid-list efficacy) answered by Probe B's own data — no additional gens spent

The brief's instruction was to only spend new gens on this if Probe B doesn't already answer it.
Probe B's three formats already isolate the variable cleanly: format 1's negatives are **flowing
prose embedded inside the suffix** ("no photorealism, no on-screen narrator or host face, no
unrequested text, no logos"); formats 2 and 3 both use a **dedicated, explicit trailing `Avoid:`
field** (differing only in how much positive description precedes it). The register measurements
above show both dedicated-Avoid-field formats (2 and 3) beat the flowing-prose-negative format (1)
by a wide margin (+4.6 and +2.5 vs +8.0, i.e. 2-3x closer to the real target), and neither
dedicated-Avoid format produced any unrequested text (matching Part 1's official guidance that GPT
Image family responds to explicit, short, hard-phrased negatives). **Verdict: yes, an explicit
dedicated Avoid field measurably beats the same negative content folded into flowing descriptive
prose, both quantitatively (ink-register) and qualitatively (zero unrequested text in both dedicated
cases vs. still-present ambient shading in the flowing-prose case).** This confirms Part 1's
published-guidance hypothesis empirically rather than just citing the source.

---

## Probe D — seed-role description (GEN #5, #6, #7)

Gen tally after this section: **7 / 12**.

Three seeds together (max-realistic multi-seed case): `figA-qt-wiles.png` (character), `env-prop-
beige-pc.png` (recurring prop), `env-scene-style-tile.png` (style tile — a full, content-rich
vintage-computer-shop interior scene: wood shelving, boxes, terrazzo floor, a "1983" placard, a
shopfront window — chosen specifically because it has real content to leak, not just an abstract
palette swatch, per the brief's concern). Same target scene across all three (qt-wiles inspecting
the beige computer at a desk, plain flat office backdrop) — only the seed-role framing sentence(s)
change. All fired via the confirmed-reliable file-read-and-pass-through method, all three seeds in
the same order.

- **D1 (ordinal):** "The first reference image is the character... The second... is a prop... The
  third... is a style reference only." `probeD1-ordinal.txt`, 427 chars.
- **D2 (content-descriptive):** "the grey-suited man with silver hair... = qt-wiles... The beige
  boxy computer... = a recurring prop... The vintage computer-shop interior scene = a style/register
  exemplar only... not a location to reuse." Longer, more content-descriptive.
- **D3 (role-purposed):** "Match the character in Image 1 EXACTLY... Match the prop in Image 2
  EXACTLY... Use Image 3 ONLY as a style/line-weight/palette reference... do NOT reuse any of its
  contents (no shelving, no terrazzo floor, no '1983' placard, no shopfront window)." Most
  explicit/verbose of the three, names the specific leak risks by name.

### Measurements + content-leak check (the primary question)

| Probe | R-B | Identity hold (qt-wiles) | Prop hold (beige PC) | Style-tile CONTENT leak? |
|---|---|---|---|---|
| D1 ordinal | +32.7 | Strong — silver hair, charcoal 3-piece suit, tie clip, deadpan expression, all present | Strong — case shape, drive slot, keyboard all match | **None.** Plain office, window+cityscape, no terrazzo/shelving/placard |
| D2 content-descriptive | +23.1 | Strong — same fidelity as D1 | Strong — same fidelity as D1 | **None.** Plain office, window+blinds+clouds, no leak |
| D3 role-purposed | +43.4 | Strong — same fidelity as D1/D2 | Strong — same fidelity as D1/D2 | **None.** Plain office, dramatic sunbeam, no leak |

**Headline finding: zero content leak in all three conditions, including the weakest/shortest
framing (D1's one-line ordinal labels).** The specific failure mode the cast-free-only law fears —
a rich, content-bearing style-reference image bleeding its own scene elements (shelving, floor
pattern, signage, storefront) into an unrelated shot — did not occur under any of the three
role-description strategies tested, including the cheapest one to write. This is a genuinely
reassuring result for the composer: **seed-role framing does not need to be verbose or exhaustively
enumerate forbidden elements to prevent content leak; even a minimal "this one is style-reference
only" label held.** Identity hold and prop hold were also uniformly strong across all three —
neither the character nor the prop degraded regardless of role-description verbosity, and no
cross-seed bleed occurred between the character and the prop seed either (matching P1 Probe E2's
"no identity bleed" finding, now replicated with 3 simultaneous seeds instead of 2).

### A genuine surprise: register control tracked with the Avoid-field's PRESENCE, not with seed-role verbosity

None of D's three prompts included Probe B/C's dedicated `Avoid:` field (D's prompts were kept
focused specifically on isolating the seed-role variable), and all three landed markedly warmer/less
flat (+23 to +43 R-B) than Probe B's format 2/3 results (+2.5 to +4.6) — closer to Probe B's format-1
(ported-Gemini-prose, no dedicated Avoid field either) territory. **Counter-intuitively, D3 — the
prompt with the MOST explicit style-transfer instruction ("copy its rendering approach: flat cel
color, outline weight, lighting flatness") — produced the WARMEST, least-flat result of the three
(+43.4), while D2 (plain content-descriptive, no explicit style-copying instruction at all) produced
the flattest (+23.1).** Sample size is 1-per-condition so this specific ordering should not be
over-read, but the pattern is consistent with Probe C's conclusion: **register/flatness control is
governed by whether a dedicated Avoid field is present, not by how much style-transfer or seed-role
language surrounds it.** Telling the model to "copy the flat rendering approach" in prose is not a
substitute for an explicit `Avoid: gradients, cast shadows, soft ambient shading...` clause — the
two are separate levers, and Probe D's own numbers (all three worse than any Probe B dedicated-Avoid
format) reinforce rather than contradict Probe C's verdict.

### Probe D verdict

**Doctrine: describe reference images by role, keep it short, and do not conflate seed-role framing
with register control.** Any of the three tested framings is safe against content leak — pick based
on prompt economy, not on a belief that more elaborate role language is protective (it measurably
was not, on this ink metric). Recommend **D1's ordinal-or-lightweight-role framing** (cheapest,
equally safe) for the composer's default, reserving D3-style explicit "do NOT reuse X, Y, Z" language
for cases where a specific PAST leak has actually been observed with a specific style tile (a
targeted fix, not a standing default). **Always pair seed-role instructions with Probe B/C's
dedicated Avoid field** for register control — they are additive, not substitutes for each other.

---

## Probe E — length / stress sensitivity (GEN #8, #9)

Gen tally after this section: **9 / 12**.

Same shot, same seed (`figB-miniscribe-rep.png`) as Probe B, so both variants are directly
comparable to Probe B's format 2 (1740 chars, R-B +4.6) and format 3 (617 chars, R-B +2.5) baselines.

- **E1 (long/stress):** `probeE1-long-stress.txt`, **4032 chars** — the exact same facts as
  format 2's labeled schema, deliberately bloated with redundant qualifiers, repeated emphasis words
  ("hard requirement, not a suggestion," "without any deviation whatsoever," "no exceptions"), and
  exhaustively spelled-out detail on every field, to simulate the "pack everything in, maximally
  explicit" antipattern the brief asked about.
- **E2 (head+tail repetition):** `probeE2-head-tail-repeat.txt`, 924 chars — format 3's exact 617-char
  content, unchanged, with one extra sentence echoing the core register constraint ("Flat 2.5D vector
  cartoon, dark warm brown-black outline, flat cel color... this house style governs the entire
  image.") prepended before the scene description, and a second echo ("Reminder: flat cel color
  only... absolutely no gradients or soft ambient shading anywhere") appended after the existing
  `Avoid:` list — testing whether head+tail duplication of the same constraint (mimicking Gemini's
  suffix-recency-weighted convention) helps on an engine Part 1 suggests is NOT suffix-weighted.

### Measurements

| Variant | Chars | R-B | vs. same-content baseline |
|---|---|---|---|
| Format 2 (baseline for E1) | 1740 | +4.6 | — |
| **E1 long/stress** | **4032** | **+29.1** | **+24.5 worse** (far less flat) |
| Format 3 (baseline for E2) | 617 | +2.5 | — |
| **E2 head+tail repeat** | **924** | **+10.4** | **+7.9 worse** (less flat) |

### Findings

**(1) Length/verbosity measurably hurts register adherence, even holding the same facts and the same
Avoid-list content constant.** E1 has essentially the same information as format 2 (same schema,
same fields, same Avoid list) — it is not adding new requirements, only restating the existing ones
more verbosely and emphatically. Despite that, its ink-register result (+29.1) is close to Probe D's
weakest (no-Avoid-field) results and nearly 6.5x further from flat than format 2's tight version.
This directly confirms Part 1's cookbook/SKILL.md doctrine ("if the prompt is already specific and
detailed, normalize... do not blindly expand") from the other direction: **verbose restatement of
already-clear constraints does not reinforce them — it appears to dilute them**, plausibly by
burying the actual Avoid list under a much larger volume of descriptive prose the model has to
weight against it. Eyeballed (`out-p2b/probeE1-long-stress.png`): visibly warmer, more wood-grain
texture and ambient shading on the sign and ceiling trusses than format 2's version, plus mild
unrequested set-dressing (a second pegboard bench not in the original scene description) — the same
"volunteers extra content" tendency, more pronounced here.

**(2) Head+tail repetition of the same constraint did NOT help, and the measurement moved in the
wrong direction.** This is a direct test of whether Gemini's suffix-recency convention (repeat the
house-style block, expect the LAST-stated instruction to dominate) transfers to codex's engine — and
the answer, on this one paired test, is **no**: E2 (with the constraint stated twice, head and tail)
measured *warmer* (+10.4) than format 3 (constraint stated once, tail only, +2.5). This is consistent
with Part 1's published-guidance finding that this model family orders by **scene → subject →
details → constraints**, not by last-instruction recency — adding a second, earlier echo of the
constraint did not add reinforcing weight the way it would on a recency-weighted model, and adding
prose bulk at the head (even reinforcing prose) pushed the same direction as E1's dilution effect.
Eyeballed (`out-p2b/probeE2-head-tail-repeat.png`): still fairly flat and clean, comparable
compositionally to format 3, but with unrequested extra props (a desk lamp, a wall pegboard with
tools, an office chair) that format 3's single-pass version did not add — again pointing toward "more
prose volume, even reinforcing prose, invites more volunteered content," independent of the specific
words used.

### Probe E verdict

**Shorter, single-pass, tightly-scoped prompts control register better than longer or repeated ones
on this engine — the opposite of what Gemini's own suffix-weighted convention would predict, and
consistent with Part 1's official guidance to normalize rather than expand already-specific
prompts.** Two composer-actionable conclusions: (a) do not pad a prompt with redundant emphasis or
qualifier language in hopes of "locking in" a constraint harder — state it once, in the dedicated
Avoid field, and stop; (b) do not port Gemini's practice of repeating the house-style block at both
the start and the suffix — on this engine that measurably cost register fidelity rather than
reinforcing it, in both of Probe E's paired comparisons. Format 3's shape (short prose + one
single trailing Avoid list, ~600-900 chars) remains the strongest register performer across every
probe run in this log.

---

## COMPOSER BRIEF

Gens used: **9 / 12** (2 Probe A, 2 Probe B, 0 Probe C [answered from B's data], 3 Probe D, 2 Probe E).
3 held in reserve, not spent. All raw JSONL/stderr/prompt files/outputs under `SCRATCH/` (`probe*-
raw.jsonl`, `probeA/B/D/E*.txt` prompt sources, `out-p2b/*.png`, `measure.py`).

### (a) Verbatim pass-through verdict + the invocation incantation

**Reliable, confirmed byte-for-byte across 2 independent runs via 2 different internal mechanisms**
(programmatic file-read, and manual inline retype — see Probe A). Ground truth used: the session
rollout log (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl`), not the model's spoken
self-report — a materially better verification method than P1's, because it captures the literal
JS the model wrote to call `tools.image_gen__imagegen(params)`, not what it later claims to have
sent.

**The incantation:** write the finished prompt to a UTF-8 text file, then instruct:
> "Read the file at &lt;absolute path&gt; and pass its exact byte content as the `prompt` argument to
> `image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text — read and
> pass through only."

This defeats `SKILL.md`'s own standing "normalize into a clear spec" default (a real, documented
instinct this tool's underlying skill doc gives the model — see Part 1) reliably when stated this
forcefully. **The composer owns 100% of what the tool sees** as long as it materializes prompts as
files and issues this style of invocation, rather than embedding prompt text inline in a natural-
language instruction and hoping for faithful reproduction.

### (b) Winning prompt format, with a full worked example

**Winner: labeled-field format using `SKILL.md`'s own native schema, OR the minimal-prose+hard-
Avoid-list format — both measurably and visibly beat porting the exact Gemini-authored prompt
verbatim.** Across every register measurement in this log, formats with a dedicated `Avoid:` field
outperformed formats with negatives folded into flowing prose (Probe B/C), and shorter, single-pass
prompts outperformed longer or repeated ones (Probe E). Recommend the labeled-field format as the
composer's default (tighter control over unrequested embellishment per Probe B's eyeball read) with
the minimal+avoid format as a lighter-weight fallback for token-cost-sensitive batches.

**Full worked example** (this is Probe B format 2's actual prompt, R-B +4.6 vs. a same-shot real
target of +0.5 — the best all-around result in this log once both the numeric and eyeball reads are
weighed):

```text
Use case: illustration-story
Asset type: documentary-style animated video still frame
Primary request: miniscribe-rep, delighted expression, power-stance pose, planted centre in the
entrance at the back of the MiniScribe assembly floor, a painted board reading "MINISCRIBE"
hanging over him
Input images: Image 1: character reference for miniscribe-rep -- match exact costume,
proportions, and line style
Scene/backdrop: the assembly floor as established -- two long steel benches running back into the
depth, a rack of tote bins at stage-left of frame, a shut roller door beyond
Subject: miniscribe-rep, matching the character reference exactly
Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline
(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no
realistic detail
Composition/framing: foreground depth from a cropped bench end at lower-right; 16:9 landscape
Lighting/mood: flat strip light, cool grey-teal-cream palette
Color palette: locked 2-3 colour scene palette (cool grey-teal-cream) plus a single red accent
#d7402b reserved only for alarm / prohibition / ownership / the final punch element
Materials/textures: flat cel fills only, no gradients, no ambient occlusion
Text (verbatim): "MINISCRIBE" (on the painted board only)
Constraints: preserve miniscribe-rep's exact costume, proportions, and line weight from the
reference image; environment stays a built-but-flat environment -- minimal geometry plus one
foreground depth prop, not a fully rendered set
Avoid: photorealism, on-screen narrator or host face, unrequested text or signage beyond the
quoted board text, logos, gradients, cast shadows, soft ambient shading, invented staging labels
```

### (c) Seed-description doctrine

**Describe reference images by role, keep it short — verbosity is not protective.** All three tested
framings (ordinal, content-descriptive, role-purposed-with-explicit-forbid-list) prevented style-tile
content leak equally well, including the cheapest one-line ordinal version (Probe D). Recommend the
lightweight ordinal/role framing as default: *"Image 1 is the character to depict exactly as shown.
Image 2 is a prop to include exactly as shown. Image 3 is a style reference only."* Reserve longer,
explicit "do NOT reuse X/Y/Z" language for a specific tile that has actually leaked before, not as a
standing default. **Critically, seed-role framing and register control are separate, additive
levers** — Probe D's three role framings, none of which had a dedicated Avoid field, all drifted
warm (+23 to +43 R-B) regardless of how carefully the seed roles were described; a composer must
supply BOTH a role-labeled `Input images:` line AND a dedicated `Avoid:` field, not treat one as a
substitute for the other.

### (d) Register-lever ranking, with measurements

Ranked by how much each single change moved the M1 ink metric (R-B, lower = flatter/cooler = closer
to this channel's real same-shot Gemini baseline of +0.5 on L29):

| Rank | Lever | Effect size | Evidence |
|---|---|---|---|
| 1 | **Dedicated `Avoid:` field vs. negatives folded into flowing prose** | 2-3x closer to target (+8.0 → +4.6/+2.5) | Probe B/C |
| 2 | **Prompt length/verbosity, holding facts constant** | ~6x WORSE when bloated 1740→4032 chars (+4.6 → +29.1) | Probe E1 |
| 3 | **Head+tail repetition of the same constraint** | ~4x worse (+2.5 → +10.4) — helps on Gemini, hurts here | Probe E2 |
| 4 | **Seed-role framing verbosity (ordinal vs. content-descriptive vs. role-purposed)** | Small, inconsistent, dominated by lever #1's absence in all three conditions (+23 to +43 range) | Probe D |
| — | Aspect-ratio prose steering | N/A to register, but reliable to ~0.1-2% of the requested ratio in every probe (this log and P1) | All probes |

**Single biggest lever: presence of a dedicated Avoid field.** Length/verbosity is the second-biggest
and cuts the WRONG way relative to intuition (more explicit ≠ more compliant on this engine).

### (e) What codex-optimal DIFFERS from Gemini-optimal in

| Axis | Gemini-optimal (this kit's existing doctrine) | Codex-optimal (this log's findings) |
|---|---|---|
| Structural weighting | Last-stated instruction dominates (suffix convention: `global_prompt_suffix` appended at the tail of every shot) | Front-loaded scene→subject→details, constraints as one distinct trailing block (Part 1, official) — NOT recency-weighted (Probe E2 disproves suffix-repetition helping) |
| Negatives | Folded into the trailing style-suffix prose alongside positive style description | Dedicated, explicit, short `Avoid:` field, separate from `Constraints:` (measurably 2-3x better, Probe B/C) |
| Prompt length under detail pressure | Kit's prompts are already long/exhaustive (shot prompt + full house-style suffix, 1000+ chars is normal) | Shorter is measurably better even holding facts constant (Probe E1); the "iterate with small single-change follow-ups" doctrine (Part 1) implies this family is tuned for concise, decomposed asks, not maximal one-shot prompts |
| Repetition/emphasis | Repeating the house-style block or using intensifiers is harmless-to-helpful (kit convention) | Repetition/intensifiers measurably hurt register fidelity (Probe E1, E2) — extra prose volume, even reinforcing, invites drift and unrequested embellishment |
| Reference-image handling | This kit's own doctrine explicitly avoids image-seeded environments/style anchors (`refs/env/README.md`: "forbidden... forge's hardened scene descriptor carries rendering style without content bleed") | Officially documented and empirically confirmed to work well: index+role-labeled multi-image input, explicit interaction verbs (Part 1, `SKILL.md`); style-transfer-without-content-leak held cleanly even with a content-rich style tile (Probe D) — this is a capability the kit's own doctrine currently doesn't use at all on Gemini and could adopt for codex specifically |
| Text-in-image | Staging language ("stage-left") risked literal misreads as signage on the P1 run (Probe E2 in P1) | Quoting the exact intended text + an explicit "no unrequested text/signage" Avoid clause is the documented, and in this log's runs, effective control (zero unrequested text in every dedicated-Avoid-field run) |
| Verbatim control | Not applicable — Gemini path is a direct HTTP call, the composer already owns the exact string | Achievable via file-read-and-pass-through invocation (Probe A) — the composer can own the string here too, contrary to the working assumption that an agent-mediated CLI necessarily paraphrases |

### (f) Open questions the composer build must probe next

1. **Does the "dedicated Avoid field beats flowing prose" and "shorter beats longer" pattern hold
   across other scene types** (crowd shots, interiors with more named props, action poses) or is it
   specific to this single-character storefront-style shot used throughout this log? All measurements
   here are single-sample-per-condition on 1-2 shot templates; a wider sample before hard-coding the
   composer's defaults would de-risk this.
2. **Does the file-read-and-pass-through verbatim method hold under `--sandbox read-only` or a
   tighter production sandbox** (this log only tested `workspace-write`; `read-only` hung past the
   4-minute ceiling rather than failing cleanly — a real integration risk, not just a probe
   inconvenience, since a production composer will want the tightest safe sandbox).
3. **Can the ambient-repo-read side effect (P1 finding #7, sharpened here to 24 unauthorized tool
   calls and an 8x token-cost spike in one run) be eliminated at the sandbox/`--cd` level rather than
   only mitigated by a prompt-level scope instruction** (which cut it ~74% but did not zero it out)?
   This is a real repo-boundary and cost-control risk for a production composer, not just a curiosity.
4. **Is the register gap (codex's best result, +2.5, vs. real Gemini's same-shot +0.5) closeable
   further**, e.g. via style-tile seeding specifically for line/ink weight (not tested here — Probe D
   used a style tile for a different question and did not isolate ink-weight transfer alone), or is
   +2-5 R-B the practical floor for this engine on this house style?
5. **Does the "shorter is better" finding have a floor** — at what point does trimming a prompt start
   costing content accuracy (identity hold, prop fidelity, composition) rather than only costing
   register fidelity? Not tested; all of this log's shortest prompts (format 3, E2) still held
   identity and composition well, but a much terser prompt was not tried.
6. **Multi-shot batching within one `codex exec` session** (P1's cost-mitigation recommendation) was
   not tested here — every probe in this log was a fresh one-image-per-process call. Whether the
   verbatim-pass-through method and the Avoid-field/length findings hold identically across multiple
   sequential tool calls in one longer-lived session is untested and directly relevant to the
   composer's real-world cost shape.

---

*End of P2b research log. 9 real generations used of a 12-call budget. All raw event JSONL, stderr,
prompt source files, and output PNGs are under `SCRATCH/` (`probe{A,B,D,E}*-raw.jsonl`,
`probe{A,B,D,E}*.txt`, `out-p2b/*.png`, `measure.py`, `extract-prompt.js`).*

