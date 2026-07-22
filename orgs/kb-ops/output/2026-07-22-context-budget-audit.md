# DRAFT — kb context-budget audit

Date: 2026-07-22  
Owner: codex-worker  
Scope: Claude Code, Codex CLI, dashboard Composer/workers, native subagents, repository routing  
Branch: `codex/context-budget-audit`

## Executive verdict

The suspicion is correct, but the cost is concentrated in a few paths.

1. **Codex opened at the kb root is not expensive because of `AGENTS.md`.** A no-model-call
   `codex debug prompt-input` probe was only 302 characters larger inside kb than in an empty
   directory. Codex automatically included the 245-byte `AGENTS.md`; it did not automatically
   include the bodies of `CLAUDE.md`, governance files, project contracts, or skill bodies.
2. **Claude's user-level plugin surface is the largest avoidable startup contributor.** The currently
   enabled plugins expose 373 top-level skills with 93,659 description characters (about 23.4k tokens
   by the deliberately rough chars/4 estimator). `ecc@ecc` alone exposes 279 skills / 62,817
   description characters. This is before a task begins.
3. **Faceless YouTube adds a second large fixed layer.** Its nested `CLAUDE.md` plus unconditional
   `@knowledge/operating-law.md` import is about 5.37k tokens, and its 21 project skill descriptions
   add about 5.28k more. Selecting `fyt-runner` adds a roughly 10.5k-token execution declaration.
4. **Composer repeatedly injects too much.** An fyt-runner-bound turn adds 45,298 fixed characters:
   3,122 characters of planning protocol plus 42,176 characters of declaration wrapper/body. It does
   this on every resumed turn, even though the provider session already contains earlier copies.
5. **Subagents are expensive because each performs a new model/tool loop, not primarily because kb's
   root file is large.** In this audit, three full-history Codex workers processed about 2.04 million
   cumulative input tokens across their original turns; about 1.83 million were cache reads. A
   no-history calibration worker began at 15,302 input tokens. Full-history workers began their own
   work at 19,232–28,246 tokens and then grew with tool results.

Caching is working, but cache reads still occupy the context window and consume rate-limit/quota
capacity. The right optimization is **smaller always-on discovery + bounded routing**, not deleting
task evidence or weakening gates.

## Method and limits

- Ran the repository preamble before each audit.
- Measured UTF-8 bytes/characters from files; token estimates shown for files use `characters / 4`
  only for relative sizing. They are not tokenizer or billing figures.
- Used the installed Codex CLI's no-model-call `debug prompt-input` diagnostic in kb and in an empty
  temporary directory.
- Parsed local Codex and Claude session JSONL numerically. No prompt bodies, credentials, or tool
  arguments were emitted. Claude streaming duplicates were de-duplicated by `message.id`.
- Claude "logical input" below is `input + cache_read + cache_creation` per unique response. Codex
  numbers are the CLI's reported input totals. These are cumulative processed tokens, not unique text.
- Exact startup categories should be confirmed interactively with Claude `/context`; the CLI does
  not expose an equivalent documented Codex command.

## What loads today

### Codex at the kb root

| Layer | Measured size / behavior | Classification |
| --- | ---: | --- |
| Platform/user baseline from `debug prompt-input` outside kb | 11,465 characters | automatic |
| Same probe inside kb | 11,767 characters | automatic |
| kb delta | 302 characters | automatic |
| Root `AGENTS.md` | 245 bytes | automatic |
| Root `CLAUDE.md` | 2,244 characters (~561 tokens) | explicit read mandated by `AGENTS.md` |
| `governance/agent-rules.md` | 1,975 characters (~494) | explicit read |
| Basic kb-ops navigation/contract path | about 1.7k–2.3k tokens total | explicit read |
| Seven curated skill bodies | 46,914 bytes (~11.7k) | on demand; not found in debug baseline |
| Codex MCP servers | none configured in the inspected CLI | no local MCP schema cost |

Current OpenAI guidance says `AGENTS.md` enters context automatically, should remain concise, and
should reference task-specific documents when it grows. Codex also caps its initial skill list (at
most 2% of the model window, or 8,000 characters when the window is unknown). The kb root mirror is
already appropriately small. The expensive behavior begins when the agent follows the mirror and
then carries those reads through a long tool loop or full-history delegation.

### Claude at the kb root

| Layer | Measured size / behavior | Classification |
| --- | ---: | --- |
| Root `CLAUDE.md` | ~561 estimated tokens | automatic from repo root |
| kb auto-memory `MEMORY.md` | 11,094 bytes / 69 lines (~2.77k) | automatic |
| Root project skill descriptions | 3,524 characters (~881) | automatic discovery |
| Enabled plugin skill descriptions | 93,659 characters across 373 skills (~23.4k) | automatic discovery |
| MCP tools | names at startup; schemas deferred by Tool Search | automatic, low until used |
| Hook programs | execute outside context unless they return context | runtime, normally zero tokens |

The plugin number is the standout. Across the two latest kb Claude parent sessions and their
subagent logs (79 JSONL files), only eight Skill tool invocations were found: five `superpowers`
calls, one `voiceover`, one `claude-in-chrome`, and one built-in review. No ECC skill invocation was
found in that sample. This is not proof that ECC is never useful; it shows that its always-discoverable
279-skill catalog is poorly matched to routine kb sessions.

There is also one exact duplicate: the enabled `example-skills@anthropic-agent-skills` and
`document-skills@anthropic-agent-skills` plugins expose the same 17 skill names, and all 17
`SKILL.md` files are byte-identical. A full installed-tree comparison found all 411 files identical
after excluding only runtime `.in_use` markers, and the repository contains no reference to either
plugin namespace. The duplicate contributes another 7,417 description characters (~1.85k estimated
tokens). Disabling one removes that namespace alias, so the rollout must still verify no personal
workflow depends on the alias.

### Claude inside Faceless YouTube

| Layer | Measured size / behavior |
| --- | ---: |
| `orgs/faceless-youtube/CLAUDE.md` | ~1.65k estimated tokens |
| Imported `knowledge/operating-law.md` | ~3.72k |
| 21 project skill descriptions | 21,122 characters (~5.28k) |
| Root seven skill descriptions | ~881 |
| Full `agents/fyt-runner.md` body when selected | ~10.5k |
| `.claude/agents/fyt-runner.md` shim | ~498, then routes to the full body |

The 37 repository skill bodies total about 93k estimated tokens, but there is no evidence that all
bodies load automatically. Claude documents the correct current behavior: descriptions load at
startup; bodies load when invoked. The optimization target is descriptions and unconditional
imports, not removal of useful skill instructions.

`orgs/faceless-youtube/.claude/hooks/inject_law_on_compact.py` re-emits the complete operating law
after compaction. It is not a startup duplicate, but it restores the same ~3.72k-token law later.

### Dashboard Composer and managed workers

- `dashboard/server/composer/planningInstruction.ts` sets a 6,000-character protocol cap. The actual
  protocol is 3,122 characters.
- Agent binding permits 64 KiB and appends the full immutable declaration on every turn. With the
  current fyt-runner body, the fixed appended block is 45,298 characters (~11.3k estimated tokens).
- `--resume=<id>` preserves provider context, so earlier copies remain in the resumed conversation.
  Re-appending the same full declaration grows context without adding new knowledge.
- When the provider handle is unavailable, `rehydratedPrompt` may carry up to 80,000 characters from
  12 visible turns, with each operator/assistant side sliced to 8,000 characters. This is bounded and
  only a recovery path, but can add roughly 20k estimated tokens.
- `scripts/agent_runner.ps1` is comparatively lean. It sends the authoritative Work order plus
  bounded dependency Results and Feedback inside an inert-data wrapper; Evidence is excluded. It
  does not concatenate repository documentation into the runner prompt.
- Managed Claude workers use small tool profiles (roughly 5–7 tools). Existing filesystem read scope
  limits access but does not itself prevent a worker from filling context with allowed files.

## Observed token behavior

### Recent Claude sessions

Two recent kb parent sessions contained 454 and 406 unique model responses. Their average logical
inputs were approximately 255,935 and 324,005 tokens per response; maxima were 515,900 and 643,029.
Ten recent custom subagent traces averaged from 58,163 to 147,450 logical input tokens per response,
with observed maxima from 70,425 to 206,569.

Those sessions are long and not a clean A/B benchmark. They do establish that context is routinely
large enough for small fixed costs to be multiplied hundreds of times.

### This Codex audit

After excluding the four identical parent-history usage records copied into each full-history trace:

| Worker | Original model turns | Input tokens processed | Cached input |
| --- | ---: | ---: | ---: |
| Repository topology | 14 | 649,472 | 586,240 |
| CLI measurement | 17 | 820,266 | 749,312 |
| External research | 14 | 568,124 | 495,104 |
| **Total** | **45** | **2,037,862** | **1,830,656** |

The minimal `fork_turns="none"` calibration required three short model turns (preamble, file read,
answer): 46,379 total input / 41,216 cached, beginning at 15,302 input tokens. It demonstrates the
correct default for self-contained grunt work. It does not make subagents free; it prevents unrelated
conversation and previous tool output from being copied into them.

## Recommendations

### P0 — immediate, reversible, no unique capability removed

1. **Disable the duplicate `example-skills` plugin wherever `document-skills` is enabled.** The active
   installed trees are byte-identical across all 411 files. Expected discovery reduction: 7,417
   characters (~1.85k tokens) per Claude session. Verify the removed namespace alias is not used by
   personal commands before rollout.
2. **Make bounded Codex workers default to `fork_turns="none"` or a small positive turn count.** Put
   every required constraint/path in the worker prompt. Reserve `all` for a judge/manager that truly
   needs conversational decisions. This becomes the boss-terminal default for future work.
3. **Use native observability before installing another optimizer.** Capture `/context`, `/memory`,
   and `/mcp` at root, kb-ops, and FYT baselines. Use Codex `debug prompt-input` for startup diffs and
   numeric JSONL summaries for cumulative usage.
4. **Keep `claude-context-optimizer@cco`.** It already blocks redundant unchanged-file reads. Do not
   add a proxy compressor that destabilizes prompt-cache prefixes or subscription OAuth routing.

### P1 — high-impact, functionality retained through routing

1. **Create a lean kb Claude plugin profile.** In routine kb sessions, disable `ecc@ecc` and other
   development-only catalogs; keep them available in an explicit "ECC/full" terminal/profile. The kb
   project already disables the ECC hooks, and the sampled sessions invoked zero ECC skills. The
   expected discovery reduction from ECC alone is up to 62,817 characters (~15.7k estimated tokens).
   This needs a human-reviewed allow-list because plugin skills cannot be hidden individually with
   `skillOverrides`; Claude requires plugin-level management.
2. **Compress FYT skill descriptions, not their bodies.** Target <=240 characters per description,
   keeping trigger phrases, exclusions, and artifact names. The current 21,122 characters could fall
   near 5,000 (about 4k estimated tokens saved) while the full instructions remain on demand.
3. **Separate Composer's full bootstrap from its always-visible invariant bundle.** On first turn,
   recovery rehydration, and any detected provider compaction, inject the full protocol and immutable
   declaration. On a normal `--resume`, append a compact model-visible bundle containing every binding
   human gate, spend boundary, scope rule, and governance refusal, plus the protocol version and
   declaration id/hash. A hash alone is not sufficient enforcement. Acceptance: the ordinary resumed
   turn's fixed append is under 4,000 characters, while compaction/recovery paths restore the full
   declaration and tests prove constraint equivalence.
4. **Add a planning projection for large agent declarations.** Keep `agents/fyt-runner.md` as the full
   execution authority. Give Composer a bounded, hashed planning projection containing role, gates,
   scope, workflow refs, and hard boundaries. Do not make Composer carry stage-by-stage commands.
5. **Trim the auto-memory index.** Keep durable topic files; reduce `MEMORY.md` to a small active index
   so older arcs are loaded only when referenced. Current automatic cost is ~2.77k estimated tokens.

### P2 — governance-sensitive; proposal only

1. Split the FYT operating law into a compact always-on invariant set and path/task-scoped rules.
   Retain the complete law as the authority and load it for governance, orchestration, review, and
   contract changes. This could save roughly 2–3k tokens on ordinary craft turns, but it changes a
   currently binding `@` import and therefore requires human governance review.
2. Reduce the Composer 80k recovery history with a server-produced rolling summary plus the last few
   verbatim turns, retaining an operator-controlled full rehydrate option. This needs continuity evals.

## Tools considered

- **Claude `/context`, `/memory`, `/mcp`: recommended.** Native and closest to actual loaded context.
- **Codex `debug prompt-input`: recommended.** Safe no-model-call startup manifest; not a billed-token
  meter and does not expose every provider-hidden/tool-schema token.
- **Local JSONL usage summarizer: recommended to build.** Numeric-only output, de-duplicated, with
  per-agent first-turn/average/max and cache ratios.
- **MCP Inspector: optional.** Useful for listing/testing tool schemas, not for measuring actual model
  context. Keep its authenticated proxy bound to localhost because it can spawn local processes.
- **Serena: optional for very large symbol-heavy code audits.** It can reduce full-file reads, but it
  adds an MCP/tool surface and does not solve plugin descriptions, Composer repetition, or inherited
  conversation.
- **Repomix: task-specific only.** A compressed one-shot repository pack can help external review but
  is the wrong default for this already-routed monorepo.
- **Context compression proxies / LLMLingua-style pruning: not recommended here.** They risk prompt
  cache instability, auth-path changes, and loss of load-bearing governance text.

## Acceptance plan

Before changing behavior, record Claude `/context` screenshots/text for four cases: repo root,
`orgs/kb-ops`, `orgs/faceless-youtube`, and an fyt-runner-bound Composer workspace. Then apply one
change at a time and remeasure.

Required gates:

- duplicate plugin removal shows no missing capability because `document-skills` remains enabled,
  and a namespace-reference check covers repository plus documented personal commands;
- lean profile can open an explicit full/ECC session when requested;
- FYT routing evals select the same skill for representative tasks after description compression;
- Composer first-turn, normal resume, provider compaction, fork, process-restart, and
  provider-handle-loss tests all preserve the immutable declaration hash, full load-bearing constraint
  set, and governance protocol;
- no change touches `CLAUDE.md` or governance files without human review;
- subagent work orders remain self-contained and fresh-context reviewers still receive every artifact
  needed to judge accurately.

Suggested success targets:

- reduce routine kb Claude startup by at least 12k tokens in the native `/context` report;
- reduce FYT startup by at least 30% without changing task-routing results;
- reduce an fyt-runner Composer ordinary resumed-turn fixed injection from 45,298 to under 4,000
  characters without omitting any binding constraint;
- default bounded Codex delegation to no-history and keep full-history use explicit in the work order.

## Sources

- Anthropic, [How Claude remembers your project](https://code.claude.com/docs/en/memory)
- Anthropic, [Explore the context window](https://code.claude.com/docs/en/context-window)
- Anthropic, [Extend Claude Code](https://code.claude.com/docs/en/features-overview)
- Anthropic, [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Anthropic, [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- Anthropic, [Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)
- OpenAI, [Codex manual](https://developers.openai.com/codex/codex-manual.md), especially the
  Subagents, Best practices, AGENTS.md, and Skills sections
- Model Context Protocol, [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

## Decision requested

Approve a Phase 1 implementation branch containing only:

1. the exact duplicate plugin removal/profile change;
2. the lean kb plugin profile;
3. a numeric-only context audit script and baseline fixtures;
4. default no-history prompts for bounded Codex workers.

Composer/FYT declaration changes should be a separate Phase 2 branch with routing and recovery evals.
