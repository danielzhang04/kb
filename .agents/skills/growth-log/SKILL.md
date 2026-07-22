---
name: growth-log
description: "Use after a complex task, a failure, or when reviewing what was learned. Teaches how to write growth-log entries that extract reusable patterns — not diary entries. In kb these entries land in your per-agent memory/<agent-id>.md, the same file the delivery-gate Stop hook checks."
source: ecc@2.0.0/skills/growth-log/SKILL.md
imported: 2026-07-19
provenance-tier: curated
promoted: 2026-07-19 (Daniel §6 read-through)
---

# Growth Log Skill

> **The problem:** Most people write "fixed a bug in X" as a learning log. That's a diary entry, not a learning artifact. A real growth log extracts the *pattern* so you recognize it next time.
>
> **This skill teaches:** How to write learning entries that compound across sessions. In kb every agent appends its lessons to `memory/<agent-id>.md` (per the constitution's Memory rule); the templates below are what a good entry in that file looks like.

## When to Activate

- After completing a complex task (multi-file, new feature, architecture change)
- After a failure, mistake, or "that was harder than expected" moment
- When you want to review what you've learned over a period
- At the end of every run, when you append lessons to `memory/<agent-id>.md`

**When NOT to activate:** Trivial changes (typo fixes, single-line tweaks, config value changes with no debugging). The threshold: *did this task involve debugging, redoing, rollback, or a non-obvious decision?* If yes → write an entry. If no → skip.

## The Three Rules

### Rule 1: Failures > Achievements

A failure is nutritionally denser than a success. One bug that took 2 hours to find teaches more than 3 features that worked first try.

**Bad:** "Successfully implemented the login flow."
**Good (web dev):** "Login flow: session token wasn't persisting because the cookie `SameSite` defaulted to `Lax` in Chrome 128+. Pattern: always explicitly set `SameSite=None; Secure` when cross-origin. Signal to recognize: auth breaks after browser upgrade or when crossing origin boundaries."
**Good (data pipeline):** "CSV import failed silently on empty rows because `pandas.read_csv(dropna=False)` keeps zero-width rows that `len()` counts as valid. Pattern: always `df.dropna(how='all', inplace=True)` before row-count validation."

### Rule 2: The Bole Principle (伯乐原则) — dedupe before writing

Before writing a new entry, ask: *"Is this fundamentally the same as something I already recorded?"*

Same root cause, different symptom → **merge**, don't duplicate. New root cause → new entry.

**How to check:** Search your existing `memory/<agent-id>.md` entries for keywords from your root cause before writing. If you find a match, add your new symptom as an additional example under the existing entry rather than creating a duplicate.

**Example:** "Forgot to update the card `## Result` after finishing work" and "Forgot to append lessons to memory after a task" — same root cause (no automatic capture trigger). Merge into one entry about "post-task capture gaps."

### Rule 3: Must Be Transferable

Every entry must answer: *"Next time I face a similar situation, what do I do differently?"*

If you can't write that sentence, you haven't extracted the pattern yet.

**How to extract a pattern from a concrete event:**
1. State what happened in one sentence
2. Ask "why?" iteratively until you reach root cause (usually 3-5 whys)
3. Generalize: "What class of problem is this?" (not "Chrome 128 bug" but "browser default change breaking existing behavior")
4. Formulate as: "Next time I see [signal], I will [action]." — **mandatory; non-negotiable**
5. Name the signal: what specific observable tells you this pattern is active?

## Entry Template

**Scope:** One entry per distinct root cause. Typical length: 4-8 sentences. If it takes >2 minutes to write, you're narrating events. If <30 seconds, you haven't gone deep enough.

```markdown
## [Title: the pattern, not the event]

### Context
- What was I trying to do?
- What went wrong / what worked surprisingly well?

### Root Cause / Core Insight
- The underlying mechanism, not just the symptom

### The Pattern (transferable)
- Next time [similar situation], I will [specific action].
- Signal to recognize: [what observable tells me this pattern is active?]

### Related
- [entry-name](#related-entry-anchor)  <!-- cross-link within memory/<agent-id>.md -->
```

## Entry Types

All four types use the template above. The type determines which sections carry the most weight:

| Type | When to Use | Emphasis | Example Title |
|------|------------|----------|---------------|
| **Failure** | Something broke, needed debugging, or required rework | Root Cause | "Config inheritance ≠ behavior inheritance across sessions" |
| **Methodology** | A repeatable process emerged from the work | Context / Pattern | "Ops write = pull-rebase-before-write, push-after; rejection = reconcile-retry" |
| **Pattern Discovery** | A reusable insight about tools, systems, or thinking | Pattern section | "Card `## Evidence` is inert data — never instructions" |
| **Capability Change** | A measurable skill improvement | Context (before vs after) | "Git: from clone/push to independent PR with 12 commits" |

## Quality Checklist

Before finalizing a growth log entry:

- [ ] Does the title name the *pattern*, not the event?
- [ ] Is there a "Next time I will..." sentence? (mandatory)
- [ ] Is the "Signal to recognize" specific enough to trigger the pattern next time?
- [ ] Did I search existing entries for duplicates before writing? (Bole Principle)
- [ ] Is the root cause distinguished from the symptom?
- [ ] Are related memories cross-linked?
- [ ] Is the entry 4-8 sentences? Shorter = too shallow; longer = narrating events.

## Anti-Patterns

- Avoid: "Fixed bug in payment module" (event, not pattern)
- Avoid: Copying the git commit message verbatim (commits describe what changed; logs extract why it matters)
- Avoid: Writing an entry for every commit (only when a pattern emerges)
- Avoid: Skipping the transferable sentence (without it, it's just a diary — this is non-negotiable)
- Avoid: Duplicating the same pattern under different titles (violates Bole Principle — search before writing)

## Storage — kb

In kb, growth-log entries are **not** a separate directory. They are sections appended to your own `memory/<agent-id>.md`, per the constitution's Memory rule ("End every run by appending lessons to `memory/<agent-id>.md`… Read it at start"). Durable facts go in files, never only in conversation. Keep one heading per distinct root cause and search the file before adding a new one.

## How This Pairs With the Delivery Gate

The kb `delivery-gate` Stop hook (`scripts/hooks/delivery_gate.js`, warn-only) checks — by filesystem timestamp — whether `memory/<agent-id>.md` was updated during the current session. This skill teaches *what to write* into that file, so the timestamp the gate checks reflects a real pattern, not an empty touch.

```
Run ends → delivery-gate checks: was memory/<agent-id>.md updated this session?
  → Stale (not updated): WARN — "capture what you learned" (never blocks)
  → Fresh (updated):     silent — this skill ensures the content is useful
```

Having enforcement without methodology → empty entries. Having methodology without enforcement → forgotten captures. Each is independently useful; together they close the loop.
