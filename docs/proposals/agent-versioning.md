# Agent definition versioning

Agent declarations may carry `version: <positive integer>`. A missing or malformed value is read as
version 1 so every existing declaration remains valid. `io` may describe free-form `inputs` and
`outputs`; `defaults` may advisory-describe `budget_usd`, `max_retries`, and `escalation`. These are
declaration metadata only: they do not grant authority, set a runtime budget, or alter routing.

Use `py -3 scripts/agent_factory.py bump <id>` after a behavior-changing definition edit. It changes
only the definition's version field; ordinary edits never auto-bump. `eval_trigger --range A..B`
reports `WARNING: def changed without version bump` when it sees a changed, comparable declaration
whose endpoint versions match. The warning is visible review evidence, not a gate.

Direct Codex dispatches may name a declaration with `--agent <id>`. Their post-hoc record then carries
`agent_version: <id>@v<version>` (for example `fyt-story@v3`) beside `kit_sha`. Omit `--agent`, or
leave a declaration unavailable, and no version stamp is recorded; dispatch behavior is unchanged.

## Card-schema addition for Daniel

Paste this inert metadata declaration immediately after `kit_sha` in
`governance/card-schema.md`:

```yaml
agent_version: <agent-id>@v<positive-integer>|absent>  # SET BY codex_dispatch.py ONLY on its
                       # post-hoc terminal dispatch record, after an explicitly named, valid
                       # declaration was read before worker spawn. Optional; absent on no --agent,
                       # unsafe id, missing, malformed, linked, legacy, orphan, and non-Codex
                       # dispatches. Inert metadata; never parsed as instructions.
```

### Rationale and implementation anchors

- `scripts/agent_definitions.py:load_agent_definition` validates the direct-child declaration wall.
- `scripts/codex_dispatch.py:pinned_agent_version` reads the immutable value before `spawn`, and
  `stamp_agent_version` records that held value after the worker exits.
- `scripts/agent_factory.py:bump_agent_version` updates the declaration's version digits only;
  `scripts/eval_trigger.py:definition_version_drift` reports changed normalized content without an
  advancing version.
