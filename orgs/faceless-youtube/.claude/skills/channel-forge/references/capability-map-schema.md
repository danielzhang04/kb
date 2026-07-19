# Capability-Map schema (`channels/<name>/capability-map.json`)

Per-channel data: how each pipeline slot is satisfied for this channel (channel-forge spec §4).
Validated by `.claude/skills/channel-forge/scripts/validate_capability_map.py`.

## Shape

```json
{
  "channel": "<slug>",                 // required, string
  "production_pipeline": "<id>",       // required, string — a BUILT pipeline (spec §8)
  "slots": {                           // required, object
    "<slot-name>": {
      "resolution": "reuse|reconfigure|adapt|build|n/a",   // required
      "skill": "<skill-name>",         // required for reuse | reconfigure | adapt
      "config": "<path>",              // optional (reconfigure | adapt)
      "plan": "<path-to-plan-doc>"     // required for build
    }
  }
}
```

## Resolutions (spec §4)

- **reuse** — existing skill, as-is.
- **reconfigure** — existing skill, new channel config/grammar (e.g., `long-form-writer` + a new
  `storytelling-grammar.md`).
- **adapt** — fork an existing skill into a channel variant.
- **build** — a brand-new capability that doesn't exist yet; `plan` points at its implementation plan.
- **n/a** — slot unused by this channel.

## Rules (enforced by the validator)

- Top-level `channel`, `production_pipeline`, `slots` are required.
- `slots` must be an object.
- Each slot's `resolution` must be one of the five values above.
- `reuse` | `reconfigure` | `adapt` require a non-empty `skill`.
- `build` requires a non-empty `plan`.
- `n/a` requires no other keys.
