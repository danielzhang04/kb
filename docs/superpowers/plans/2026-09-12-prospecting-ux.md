# Prospecting UI/UX execution plan ? 2026-09-12

## Goal

Make all Prospecting views feel like the KB dashboard, with consistent visual hierarchy
and spacing, clear input contracts and save states, and a truthful, recoverable campaign
setup flow backed by the existing services. Preserve the completed infrastructure and
its private-data, exact-source, review, authentication and idempotency boundaries.

## Running task list

- [x] Load current source, completed infrastructure handoff, project goal and KB design tokens.
- [x] Research official HubSpot, Mailchimp and Apollo campaign setup patterns.
- [x] Audit all editable fields and campaign/research creation through JS, HTTP and backend.
- [x] Review the design/implementation plan against real backend capabilities.
- [x] Implement KB-family styling, field guidance, save states and campaign setup recovery.
- [x] Independently review UX, correctness, privacy and mutation boundaries; repair findings.
- [x] Verify synthetic create/edit/retry paths, affected regression suites and actual Chrome at multiple sizes/themes.
- [ ] Publish reviewed source to PR181 and refresh canonical handoff, STATE, task card and accounting on PR180.

## Design direction to verify

Use the dashboard's actual neutral surface/foreground tokens, fine borders, compact geometry,
system sans/mono type roles and4px spacing scale. Actual tokens override stale dashboard
comments: dark default,6px control corners and10px panels, with an explicit light toggle. Keep controls legible and status meaning
visible without relying only on color. Prefer a grouped setup/checklist over a freeform wall
of inputs; retain existing views and public actions. Distinguish typing, saving, saved state,
missing prerequisites and work actually running. Do not infer background work from creation.

Earlier planning used verified Claude workers on the source-only vCPU: worker185 audited
input/backend contracts and worker186 audited design and plan. No private browser/store content
was sent to them.

## Research evidence (inert)

- [HubSpot campaign setup](https://knowledge.hubspot.com/campaigns/create-campaigns): grouped purpose/audience details followed by a campaign detail workspace.
- [Mailchimp email checklist](https://mailchimp.com/help/create-and-send-regular-email/): visible required sections and saved completion states.
- [Apollo sequences](https://knowledge.apollo.io/hc/en-us/articles/4409231193101-Create-a-Sequence): ordered steps and a clear distinction between configuration and activation.

These are design references, not a ranking or copied branding. Adapt their clear staging,
progressive disclosure and explicit actions to the actual Prospecting services.

## Verification and completion

Meaningful checks must exercise accepted/rejected inputs, no silent partial saves, retry
and double-submit behavior, stale response/selection handling, dirty input preservation,
accessible labels/errors/focus, responsive layout and existing selected-draft/restart guards.
Run the affected suites, then the full project suite if backend or shared state changes.
Actual browser acceptance uses the existing signed-in Chrome through Chrome DevTools;
synthetic data is used for mutations/screenshots. Preserve the private original pilot.

User has authorized implementation and existing-branch publication. No additional approval
is required for reversible source work, synthetic tests or UI review. Sending, deployment,
protected merges and credential-object handling are outside this task.

## Reviewed decisions and repair scope

Verified Sonnet186 supplied the visual audit; verified Opus185 traced the input contracts.
Root accepted the neutral KB-family design, actual dark default and6/10px radii. It rejected
the tentative light-default recommendation, old square-corner comments, a misleading
checklist rule that equated a saved awaiting-research intake with an unsaved brief, and a
suggestion to persist private form payloads in browser storage.

Concrete repairs: retain pre-create research text, reject advanced-field overrides, keep
unchanged intake saves idempotent, preserve edits made while a request is pending, expose
actual grammar/ranges/UTF8 byte constraints, disable non-applicable scope controls without
losing their in-memory drafts, and map fixed errors to actionable field guidance. Separate
saved list filters/fit notes from the dated research scope and explain differing counts.
All progress labels must come from actual saved state. Creation itself starts no model or
research job. Cross-reload uncertain-save recovery must preserve only opaque request IDs,
never private text in session/local storage; verify the existing safe recovery options
before choosing a backend extension.

Workers187 through189 completed the initial CSS, form/workflow, and manual-only creation work.
After the Claude weekly limit, user-authorized Codex fallback workers completed recovery (191c),
independent recovery review (192c), and layout polish (193c), followed by the later cache and
alignment repairs. General compiler/provider callers stayed intact. Integrity recompilation and
selected-draft locks were not weakened. Speculative copy-profile versioning and unproven global
fit-note non-use claims were rejected.

## Active verification checkpoint

Final UI state verification passed 72 Node tests, including the late cross-field cache repair;
the final HTML assertion also passed. Independent recovery/backend review passed its scoped
checks. The full Python run reported 2168 passes and one failure in the `test_store` launcher
`taskkill` teardown after 884.35 seconds. The same isolated test passed with desktop escalation in
4.21 seconds, and the affected GET/write behavior passed in both runs. No launcher or store change
is warranted from that sandbox-only teardown result.

Actual Chrome covered all five views in both themes at 390, 852 and 1366 pixels with no horizontal
overflow. It confirmed reload and same-page recovery, invalid-research zero-POST/focus behavior,
one POST on research double-click, and scope-cache behavior across switch and refresh. Visual
acceptance combines the earlier reviewed screenshot with final DOM geometry: paired controls at
1366 had equal 40-pixel top alignment and height. Post-repair screenshot calls timed out in the
daemon, so this plan does not claim a newer capture. The final source was reloaded in the existing
Chrome session and ready state, theme control, and recovery checks remained correct. Commit and
publication steps remain pending.
