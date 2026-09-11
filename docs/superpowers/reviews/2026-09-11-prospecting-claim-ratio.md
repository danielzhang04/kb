# Claim ratio acceptance

Independent reviewer86 responded as verified Claude Opus 5. It accepted production
counting and identified a vacuous negative test. Verified Claude Sonnet 5 repair90
removed the extra sender claim that made that test insensitive to incorrect reference
normalization. Root reviewed the exact patches and source hashes before applying.

Identity exclusions use only the three exact authoritative sender-name/signature
references, including the actual CLI producer's sender.signature. A slot alias cannot
hide a substantive sender claim. Duplicate recipient values do not manufacture credit;
duplicate sender aliases of the same reference/value are counted once. Upstream binding
validation continues to verify authoritative values. Public interfaces are unchanged.

Verification after repair90: QA, personalizer CLI, editorial controller, selected
pipeline and selected source review ran together: 199 passed in113.47s. The test now
puts each of14 malformed reference variants on the ratio decision boundary.

Scope is qa.py and test_qa.py. No source-confirmation, readiness, approval or send
authority changes. Earlier missing sender.signature caused nine CLI regressions;
the current combined check includes the real producer and stable20-draft fixture.
