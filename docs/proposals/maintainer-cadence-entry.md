# Draft: maintainer cadence entry

```yaml
cadences:
  - name: agent-maintainer-nightly
    schedule: "0 6 * * *"
    tier: desktop
    agent: agent-maintainer
    role: manage
    risk-tier: T1
    prompt: >
      Run the bounded, draft-only agent maintainer against its declared read-only sources.
      Return no more than five evidence-cited proposal drafts; do not write targets or queue state.
```

This entry is intentionally a draft, not a registration. Arming it is Daniel's act: he must review
the proposed cadence, commit it to the applicable `HEARTBEAT.md` on protected `main`, and approve
the first live fire. Until then the module is limited to fixture or explicitly supervised dry-runs.
