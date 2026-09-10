# Prospecting email template revisions

Status: design record with implementation checkpoint. The three version-2 template updates and
networking current-role fallback are implemented and independently accepted. The template files
contain the final copy; examples below retain the design discussion. Root's joined regression run
passed 156 tests, and independent focused review passed 13 tests. This supplies no runtime
Humanizer receipt, semantic-review result, or evidence of a response-rate effect.

## Problem in the current v2 copy

The three current templates repeat the same long construction about a recipient's perspective and
"disciplined decisions." The result is formal, generic, and harder to read than a short request for
an informational conversation. It also explains the sender's interest after several abstractions
instead of using the recipient hook first.

The renderer already supplies evidence-bound recipient slots, sender-profile slots, a policy-bound
ask, and a signature. A revision must retain all of them. Generic templates must remain neutral. An
AI-specific sentence belongs only in a separately selected template or optional block whose intake
angle is explicitly approved.

## Proposed v2 templates

Increment each `template_version` from 1 to 2. Keep the existing template IDs, intent values,
subjects, and every placeholder below unchanged.

### `startup_ops_corporate`

```text
Hi {first_name},

{shared_signal_sentence} I noticed {firm_specific_hook}, and your {their_role} work at {firm} gave me a useful view of the transition from {transition_from} to {transition_to}. {sender_intro} {sender_proof}

I would value hearing how you approached that transition and the operating choices that mattered. Would you have {ask_minutes} minutes for an {ask_mode} in {time_window}?

{signature}
```

### `startup_ops_noncorporate`

```text
Hi {first_name},

{shared_signal_sentence} I noticed {firm_specific_hook}, and I was interested in your {their_role} perspective at {firm}, alongside the transition from {transition_from} to {transition_to}. {sender_intro} {sender_proof}

I would value hearing about the choices that mattered in your work and transition. Would you have {ask_minutes} minutes for an {ask_mode} in {time_window}?

{signature}
```

### `curiosity_thesis`

```text
Hi {first_name},

{shared_signal_sentence} I noticed {firm_specific_hook}, and your {their_role} perspective at {firm} made me curious about the transition from {transition_from} to {transition_to}. {sender_intro} {sender_proof}

I would value hearing how you frame that work and the questions you return to. Would you have {ask_minutes} minutes for an {ask_mode} in {time_window}?

{signature}
```

Each draft has one recipient-specific hook, one sender bridge, and one informational ask. The neutral
copies do not make claims about an internal practice, strategy, product, metric, or background fact.

## Evidence-eligible fallback and routing

`startup_ops_corporate`, `startup_ops_noncorporate`, `curiosity_thesis`, and the currently selected
`startup_nonops` route require `shared_signal_sentence`, `transition_from`, and `transition_to`.
The existing evidence bridge correctly refuses drafting when the career-path evidence is absent. That
behavior must remain.

`shared_signal_sentence` cannot be reused for this fallback. Today it maps to `why_them`, which the
evidence bridge resolves only from a same-person prior-employer record. It also provides the current
deterministic name-swap signal. Removing that placeholder without a replacement would fail both the
evidence bridge and QA.

Add a dedicated future template ID, for example `startup_current_role_hook_v1`, rather than changing
legacy slot requirements. Its exact synthetic body would be:

```text
Hi {first_name},

{recipient_hook} I noticed {firm_specific_hook}. {sender_intro} {sender_proof}

I would value hearing how you approach the work in your role. Would you have {ask_minutes} minutes for an {ask_mode} in {time_window}?

{signature}
```

`recipient_hook` is a new, typed, person-specific evidence slot. It may be populated only by either:

1. a same-person, current-company, current-role observation that states the selected role at the
   selected firm; or
2. a same-person authored-work observation represented by the existing `own_writing` source type.

The first form may render a neutral sentence such as "Your {their_role} work at {firm} caught my
attention." The second may render a sentence tied to the specific authored work. A company thesis,
firm-level research hook, or board/portfolio item alone may support `firm_specific_hook`, but cannot
serve as `recipient_hook`: it is not enough to prove the copy is about this person.

Every eligible source must have the selected person as its entity, match the selected current company
when it is a role hook, be unexpired and copy-allowed at render time, and pass the existing confidence
threshold. The firm hook must independently be current, copy-allowed, and bound to the selected
company. If no typed recipient hook exists, the candidate parks. The current code has no mapping that
turns arbitrary current-role or company curiosity into `why_them`, so this is a proposed new mapping,
not a claim that dropping placeholders is sufficient.

Minimal implementation scope after approval: add `recipient_hook` construction and provenance checks
in `affinity/evidence_bridge.py:resolve_slot_facts`; map the new template slot in
`affinity/templates_v2.py:BINDING_MAP` and `_slot_values_with_clamp_count`; and extend
`personalizer/qa.py` so a cited, entailed `recipient_hook` qualifies as person-specific alongside
`why_them`. The flow owner must then make `_family()` select this new ID for eligible operations,
strategy, and chief-of-staff recipients that lack a career-path bridge. This is a bounded routing
change, not merely a documentation decision.

## Required integration changes

1. Update the three named template files, and separately review `startup_nonops`, to version 2 after
   approval. `load_registry_v2()` already loads by template ID. The fallback is a new dedicated ID,
   not a new required slot in a legacy template.
2. Preserve the legacy IDs and evidence requirements. The dedicated fallback adds its own registry,
   binding, and networking routing entries for eligible Operations, Strategy, and Chief-of-Staff
   contacts without a career-path bridge. Other intents retain their existing routing.
3. Confirm the final text stays inside the saved copy profile's body-word band and has exactly one
   question. The renderer's existing `check_bands()` and `ask_sentence()` are the relevant gates.
4. Add structural tests for version 2 that render each template with synthetic slot values and assert:
   every existing slot remains in `slot_inventory()`; one question only; no links or attachment text;
   all body copies meet the configured band; and an unsupported required slot still fails before a
   revision is created. Preserve the existing revision identity tests for new template versions and
   new revisions.
5. Add structural fixtures for the new fallback's source combinations: valid same-person current-role
   hook, valid same-person authored-work hook, wrong-person hook, stale or copy-disallowed hook,
   current-company mismatch, and firm-only hook. Assert the invalid cases park before revision write.
6. Add a separate semantic-review obligation for unsupported claims, causal language, and whether a
   recipient hook entails the rendered sentence. The current deterministic `name_swap` check is a
   guardrail, not proof of that semantic judgment.

## Humanizer editorial notes for synthetic template text

This proposal retains editorial notes, not a runtime draft/audit/final receipt. The Humanizer review
removed stock language such as "disciplined decisions" and "useful early-career judgment," led with
the evidence-bound hook, shortened the ask, and removed AI wording from generic templates. The final
proposed copy retains the exact legacy placeholders and contains no em or en dash. This is a
template-development pass using the curated Humanizer skill, not a runtime humanizer gate.

## Reference pattern only

The locally discovered Claude Email Ops guidance favors reading the relevant thread, drafting, then
verifying and reporting exact state. This proposal borrows only the concise, evidence-first drafting
pattern. It does not import, promote, or execute that external cached skill.
