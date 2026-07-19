---
id: card-parse-invalid-frontmatter
capability: card-parse
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: parse
  card_text: |
    id: no-fence-001
    project: kb
    action: report
    state: inbox
expected:
  ok: false
  error_contains: no frontmatter
---

# Canary: a card without `---` frontmatter is refused

Text that does not open with a `---` fence is not a card. `cards.parse_text`
must raise `ValidationError` ("no frontmatter") rather than silently accept
untrusted bytes.
