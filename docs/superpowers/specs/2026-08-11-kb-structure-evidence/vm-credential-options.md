This is input to a human ruling, not a recommendation that overrides the existing security design.

The key finding: direct VM → GitHub `ops` is a reversal of a documented kb trust boundary. The repo’s current design treats “no fleet agent holds a GitHub REST Contents-write credential” as load-bearing for human-only, web-flow-signed approval records. A fine-grained PAT and a GitHub App installation token are both REST-capable; a write deploy key is not, but it is persistent and repo-wide for Git transport.

## VM ↔ hub options

| Option | Credential on VM | Compromise blast radius | Solo burden | GitHub outage |
|---|---|---|---|---|
| Fine-grained PAT, one repo, `Contents: read/write` | Long-lived bearer token over HTTPS | Read all private Git content in `danielzhang/kb`; write/delete files and unprotected refs/branches; REST Contents API too. No repo-admin API unless separately granted. No credential-level `ops` limit. | Lowest setup; manual secret placement, expiry replacement, reload, revoke. Token is tied to Daniel’s account. | Fetch/push fail; local checkout can run stale. Must spool commits and retry or lose coordination. |
| Deploy key, read-only | SSH private key for one repository | Read/exfiltrate the repository’s Git content only; no push, no GitHub REST API. | Low; generate/add/revoke key manually. Persistent until removed. | Pull fails; VM continues from last checkout. No upstream state path. |
| Deploy key, read-write | SSH private key for one repository | Read/write/delete unprotected Git refs and contents in that repository. GitHub documents write deploy keys as having the effective repository actions of a collaborator/admin; raw SSH key still cannot call GitHub’s REST API. No branch-specific key scope. | Low; persistent secret, manual replacement/revocation. | Same retry/spool requirement. |
| GitHub App, broker-minted installation token | Ideally only a ≤1-hour installation token; App private key stays on desktop/separate broker | Token can be limited to this repo and `Contents: read/write`; it can still alter any unprotected ref and use GitHub REST APIs during its life. Compromise is time-bounded after isolation/revocation—unless the compromised VM can keep asking the broker for more. | Highest: App registration, installation, broker policy/authentication, logs, token refresh, and broker availability. | No fresh token minting or Git fetch/push. Cached checkout runs; broker outage is also an outage. |
| Keep current desktop-push bare mirror | No GitHub credential on VM | No GitHub credential theft from VM. VM compromise can still poison/delete its local mirror or queued state, but cannot access GitHub. | Low–moderate: desktop relay must fetch/reconcile/push and surface a backlog. | VM↔desktop can continue over tailnet; desktop queues GitHub sync until service recovers. |
| VM writes a separate staging repo; desktop promotes | Prefer two keys: read-only deploy key for `kb`, read/write deploy key only for `kb-vm-outbox` | VM can read `kb`, but can only corrupt/exfiltrate the staging repo’s contents. Desktop promotion protects `kb`/`ops`. **A staging branch in the same `kb` repo does not achieve this reduction**: its write credential is still repo-wide. | Moderate: second repo, durable outbox, promotion/reconciliation workflow. | VM spools; desktop promotes when GitHub returns. Last known platform checkout remains usable. |
| Git bundles / one-way file sync | No GitHub credential on VM | No GitHub access. The transferred bundle can carry malicious Git objects/refs, so desktop must verify and promote deliberately. | Moderate–high: bundle inventory, watermarks/prerequisites, `git bundle verify`, and conflict/promotion handling. | Transfer can continue over tailnet/removable path; GitHub publication waits. Git bundles support fetch/clone/pull, not push. |

GitHub’s current fine-grained PAT model can restrict a token to one resource owner, selected repositories, and selected permissions, but it does not restrict a token to a branch. [GitHub PAT documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

A deploy key is one-repository scoped; read-only is genuinely pull-only, while enabling write permits deployment pushes. [GitHub deploy-key documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) GitHub’s API documentation explicitly warns that a write deploy key has the effective actions of an organization admin or personal-repo collaborator. [Deploy-key API](https://docs.github.com/en/rest/deploy-keys/deploy-keys)

## Branch restriction: what is and is not possible

`main` can absolutely be protected so the VM cannot directly update, force-push, or delete it: require PRs, required checks if useful, signed commits if useful, and protect against deletion/force pushes. Do not put the VM’s actor on `main`’s bypass list. [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

But “the VM credential can only push `ops`” is not a PAT/deploy-key property:

- PATs and deploy keys are repository-scoped, not ref-scoped.
- A protected `main` prevents an update to `main`; it does not by itself stop a compromised writer from creating or updating another unprotected branch.
- With a PAT for the repository owner, GitHub sees the owner identity, not “the VM.” That makes credential-specific branch permissions especially weak.
- GitHub’s branch-restriction actors are users, teams, and installed Apps—not an individual deploy key. In particular, the documented “restrict who can push” control is an organization-repository feature. [Protected-branch restrictions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

A GitHub App is the cleanest identity if direct `ops` writes are truly required: install it only on `kb`, grant only Contents read/write, allow/bypass that App on `ops`, and do not allow/bypass it on `main`. GitHub rulesets can name an installed App as a bypass actor. [Ruleset configuration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)

That limits direct protected-ref writes, not all possible unprotected-branch writes. Test this explicitly with negative cases: direct `main` push, force-push, delete, arbitrary new branch, and direct `ops` push.

The existing kb ruleset already blocks the worker deploy key from direct `main`/`ops` updates. Allowing continuous direct `ops` writes would therefore be a policy change as well as a credential change.

## Mitigations that materially change the calculus

- Preserve the source/read and state/write split. A read-only `kb` deploy key plus a separate write-only staging repository is the cleanest way to make VM compromise unable to mutate canonical coordination state.

- Protect `main` regardless of option. For an App-direct design, protect `main` with no App bypass and configure the App only for `ops`. For a PAT, enable enforcement against administrators as appropriate; otherwise the owner identity may bypass the control.

- Treat signed commits as integrity/audit control, not VM-compromise containment. A VM-held signing key lets a VM attacker produce signed malicious commits. Requiring signatures on `ops` can prevent accidental unsigned updates and improve provenance, but it does not transform a compromised writer into a trusted writer. [Required signed commits in rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

- Make GitHub outages fail closed but not lossy: commit locally to a durable outbox, retry with bounded backoff, alert loudly, and reconcile against fresh `origin/ops` before replay. “Best effort” without an outbox silently drops the coordination property the redesign is meant to gain.

- PAT reality as of 2026-08-11:
  - For this personal-account repo, a fine-grained PAT can be scoped to the `danielzhang` resource owner and selected `kb` repo; the outside-collaborator limitation is not the immediate issue.
  - Fine-grained PATs cannot span multiple organizations, work for outside/repository collaborators, access Packages, call Checks APIs, or access user-owned Projects; there is a 50-token limit. Those matter if the topology later becomes multi-org or uses a machine collaborator. [Current PAT limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
  - A personal fine-grained PAT may be created without expiry. For organization resources, GitHub’s default maximum-lifetime policy is 366 days; an org/enterprise may impose another maximum and may require approval. [PAT organization policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
  - Rotation is manual replacement, deployment/reload, verification, then revocation of the old token. An expired/revoked token cannot be restored. [Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)

- App tokens improve lifetime and attribution, not the existing approval invariant. Installation tokens expire after one hour and can be down-scoped to installed repositories/permissions; GitHub supports them for HTTPS Git. The private App key does not expire, so it must remain outside the VM in the broker design. [App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [App key management](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)

## Prior art

There is clear GitOps-controller precedent for both sides of this decision:

- Flux image automation is the direct-write pattern: a controller reads Git state and commits image updates back to Git; its guide explicitly calls for a write-enabled deploy key when using SSH. [Flux image-update automation](https://fluxcd.io/flux/guides/image-update/)

- Argo CD Image Updater supports Git write-back using repository credentials or GitHub App credentials. It also explicitly supports a separate write branch or PR flow when the target/default branch is protected—strong precedent for “machine proposes, protected branch promotes.” [Argo write-back methods](https://argocd-image-updater.readthedocs.io/en/stable/basics/update-methods/)

- The existing kb worker pattern is a third, directly relevant precedent: write deploy key for Git transport, protected `main`/`ops`, and human/cloud PR promotion into `ops`. It preserves the human-only REST/write approval boundary.

Git bundles are the deliberately disconnected alternative: Git’s official format supports full and incremental offline transfer and verification, but deliberately has no push operation. [git-bundle](https://git-scm.com/docs/git-bundle)

## Ranked recommendation

1. **Keep desktop promotion; strengthen it with a durable VM outbox, or use a separate staging repo.**  
   Load-bearing reason: it preserves the existing “human-only GitHub REST write” trust anchor while still giving the VM continuous local coordination and eventual hub sync.

2. **If continuous VM publication is operationally necessary, use a separate staging repository plus read-only canonical-repo access—not a staging branch in `kb`.**  
   Load-bearing reason: compromise can damage the staging stream but cannot directly modify canonical `ops` or platform code; desktop remains the intentional promotion boundary.

3. **If direct VM → `ops` is judged worth the trust-boundary reversal, use a brokered GitHub App, not a PAT.**  
   Load-bearing reason: distinct App identity, one-hour tokens, installation/repository permission limits, and App-targeted ruleset policy are materially better than a user PAT. This requires an explicit redesign of the current approval assurance model, because the VM can use the token for REST Contents writes.

A direct write deploy key is preferable to a PAT only if preserving the no-REST invariant outweighs the risk of a persistent repo-wide Git writer—and it still does not provide a clean, credential-specific direct-`ops` authorization path.

Checkpoint notes were saved to `findings-checkpoint.md`.

--- codex-dispatch card 6a7bcd0b-bf559304 | model gpt-5.6-terra | exit 0 | 311s | ops publish: pushed | log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a7bcbda-e4ff2ac2.jsonl | session 019ff394-5d1b-7f80-80f7-43b636153d18 (follow up with --follow-up 019ff394-5d1b-7f80-80f7-43b636153d18)
