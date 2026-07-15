# Security rules

- Deny by default: never read `~/.ssh/**`, `**/.env*` (except .env.example), browser profiles,
  OS credential stores. Never run `curl|sh`-style piped installs or outbound `ssh`.
- No secrets in this repo, in cards, in ledgers, in memory files, or in cloud env vars.
- Cloud sessions: network allowlist stays "Trusted" unless the card's work order says otherwise.
- Skill promotion checklist (run per skill, record in the approval card):
  1. scripts/scan_skill.py passes (or every finding individually justified)
  2. Human read the FULL skill text including references/scripts
  3. No network calls except to APIs the skill's manifest declares
  4. No reads outside repo + declared paths; no writes outside its project
  5. Provenance manifest present (source, author, hash)
