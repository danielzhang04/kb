---
name: email-manager
description: Create deterministic, pre-approved in-thread reply draft requests.
---

# Email manager

Use `scripts.prospecting.campaigner.replies` to create only deterministic-template
reply revisions and typed draft requests. Resolve thread headers in the executor;
do not handle raw bodies, call an adapter, or send mail. A missing or mismatched
template hash is a fail-closed result for human review.
