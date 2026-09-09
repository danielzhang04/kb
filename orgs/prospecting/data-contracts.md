# Prospecting data contracts

SQLite is canonical. JSON is UTF-8, sorted-key, compact canonical JSON at repository boundaries.
Timestamps are UTC ISO 8601 except the explicit local `HH:MM-HH:MM` policy window. IDs crossing the
VM boundary are opaque and match `^(cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt)_[0-9a-f]{16}$`
with the prefix required by the field kind. PII remains desktop-local.

## `target_policy`
`TargetPolicy(predicates, requested_companies, requested_people, extra_fields, lane_plan,
scorer_version)` is immutable. Each ordered predicate is exactly `Predicate(predicate_id,type,value)`.
Allowed types are `industry`, `company_type`, `company_stage`, `company_location`,
`person_location`, `title`, `seniority`, `school`, `platform`, and `company_list`. A company list is
an ordered tuple of opaque company IDs. The desktop-only compiler resolves locally entered names;
unresolved or ambiguous names fail. A VM-bound policy containing a name, URL, message, or free-form
predicate fails.

## Lane capability and eligibility
Each lane/type entry is `LaneCapability(outcome,reason_code,version)`, where outcome is `exact`,
`approximate`, or `unsupported`. Unsupported predicates fail. Approximate predicates require a
human-authored `PredicateOverride` bound to campaign, policy hash, predicate, lane, and capability
version before selection. Overrides and decisions are persisted in SQLite and override creation is
audited. `EligibilityDecision` preserves
ordered failed and approximate IDs; failures produce `ineligible`, an unoverridden approximation
produces `needs_override`, and only the remaining case produces `eligible`.

## `exec_request`
`ExecRequest(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state,reason)`
accepts an allow-listed caller/operation pair and an exact per-operation payload-key set. `operation`,
`lane`, `provider`, and `label_code` use closed enumerations. All other payload strings are typed
opaque IDs. Values containing whitespace, `/`, `\`, `;`, `|`, `&`, `$`, `<`, `>`, backticks, URLs,
`@`, or digit runs of seven or more are rejected before insertion. Payloads never contain commands,
credentials, or PII. Non-send
operations require null approval. T0 send is disabled. An enabled-tier send requires non-null
approval before insertion.

`vendor_lookup` payloads include typed `campaign_id`, `person_id`, and `provider`. Credit
reservations derive campaign ownership from that canonical request and require the request's
operation, provider, policy hash, and campaign to agree before charging the campaign budget.

## Approval
The schema binds campaign and non-unique policy hash, content kind/hash, contact, mailbox, approver,
tier, UTC window, single-use nonce, permitted action, and scope hash. An insert/update trigger makes
`content_kind=revision` resolve exactly once in `revision.hash` and `content_kind=reply_template`
resolve exactly once in `reply_template.body_hash`; cross-kind resolution fails.
Campaign activation instead requires a human `content_kind=campaign_policy` approval with
`permitted_action=activate_campaign`, bound to the campaign's current `(campaign_id, policy_hash)`;
revision and reply-template approvals never authorize activation.

## Runtime sinks and exports
Every VM sink accepts only a typed `{"kind": <sink>, "fields": {...}}` envelope. Sensitive field
names fail closed at any depth, and encoded email/phone forms are normalized before scanning.
One-way CSV exports have a single root, `%LOCALAPPDATA%\\kb-prospecting\\exports`; overrides, UNC
paths, symlinked roots, repository-local roots, and resolved destinations outside that root fail.

## Tranche views
`company_tranche(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane)`
and `person_tranche(person_id,campaign_id,first_name,full_name,title,company,linkedin_url,location,email,verification_state,one_line_blurb,fit_score,source_lane)`
are exportable glance views. Their leading `cmp_…` and `per_…` identifiers are opaque, permitted in
exports, and are not PII.
