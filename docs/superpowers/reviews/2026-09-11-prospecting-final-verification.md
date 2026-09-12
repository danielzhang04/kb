# Prospecting final verification status

This record covers the recoverable evidence-to-review pipeline, canonical draft-format
configuration, and bounded HTTP refusal repair. It grants no source attestation, send
approval or release authority.

## Accepted behavior and current verification

Canonical format configuration resolves copy_profile_missing without P8 fit approval or
repeating completed research. The public operation validates saved campaign integrity,
uses an owned transaction and full-policy precondition, refuses existing copy-dependent
work or missing guard tables, and preserves the targeting hash. Existing canonical format
is a read-only no-op. The authenticated status endpoint and CSRF-protected action expose
fixed errors; a failed optional format lookup does not hide the rest of the review screen.
Independent Opus148/150 reviews and root inspection accepted these boundaries. The renderer
uses campaign.ask_minutes; targeting excludes copy_profile and revision context includes it.

The approved real pilot completed all three qualification items (three artifacts, four
cumulative attempts including one historical refusal), ranked one selected person with a
five-person shortfall, and materialized a selected-person draft. Public format setup created
a backup; setup and draft replay were verified. Targeting, qualification and ranking hashes
are unchanged. The metadata audit found one binding and zero source attestations, approvals,
execution requests or sends. Actual native calls prove desktop authentication works.

HTTP refusals previously closed while declared body bytes could remain unread. The repair
flushes the refusal first, then discards eligible unread bytes under the existing byte cap
and one 250 ms deadline. Ambiguous, oversized and Expect framing is not drained; consumed
bodies are not read twice. Opus154 found an arbitrary-digit Content-Length conversion could
append a second response or expose an interpreter diagnostic; both conversion sites now
bound digit length before int(). Auth/CSRF ordering and no-mutation refusals are preserved.
Pre-authentication refusals retain the ordinary 72 KiB cap, including large upload routes;
this bounded mitigation does not promise graceful closure for every unsupported or late body.

Final HTTP suite: **42 passed, 0 failed/errors/skips**, 19.469 seconds in parsed JUnit
(test155-final-http.xml; CLI wall time19.52s). Root disabled draining in a separate process:
the strengthened real-HTTP regression failed, then passed with the repair. It measures
actual discarded bytes. Four framing cases assert zero attempted reads, and a deterministic
helper test detects coalesced second responses. Earlier shape-only tests passed without the
fix and were not treated as proof. No retry was added to the HTTP test helper.

Format evidence:40 actual-HTML JS checks;7 focused backend checks including one complete
public-create P15?P22 workflow; affected185 had184passes and one connection abort, whose
isolated rerun passed. Two snapshot checks passed. Post-isolation HTTP30 had29passes and
one connection abort; its focused case plus the new sentinel regression passed2/2. Those
intermittent aborts prompted the HTTP investigation rather than being dismissed as host noise.

Prior accepted evidence:320 selected/native checks,168 acquisition checks,37 retained-export
verifier checks,170 qualification/native checks and36 post-pin checks. Four actual model
adapters and public prepare passed on bundle
`e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814` (unchanged by this repair).
Synthetic editorial reached human_review in3calls/3artifacts/0repairs. Requested model was
gpt-6-astra; actual responding identity is unverified. Claude development workers resumed on
the existing source-only vCPU; responding Opus5/Sonnet5 identities were verified from JSONL.

## Full-suite history and remaining acceptance

The original full-suite123 JUnit records2087tests:2082passed,5failed,0errors/skips,
1245.491seconds. It is not a green full-suite result and was not rerun after these focused
changes. Three failures remain human-owned records:

- test_deployment::test_p6_manifest_is_numeric_and_complete
- test_p2_prerequisite::test_p2_00_p1_record_verifies
- test_p4_p1_contract::test_p4_00_p1_record_verifies

Two other failures passed focused reruns: the person-scope temp-root case and an HTTP
connection abort. The latter now has a source repair and focused acceptance above.
Agents have not modified or blessed the recorded evaluation manifests.

Supported browser initialization explicitly returns ?No browser is available,? so visible
private UI acceptance remains unverified. Source PR181 and coordination PR180 remain drafts;
no merge, deployment or release is claimed. Exact publication heads, private receipt paths
and remaining human gates are recorded in the canonical coordination handoff.
