---
schema-version: 1
id: 6acff3e5-bad86a41
project: kb-ops
action: filesystem-nyu-git-evidence-design
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 48505beb497edf46
state: done
approval: null
workflow: 01a13c4d-49f5-7f63-87e8-e5e8d7d2d4f8
depends-on: []
variant-group: null
role: work
session-id: 6acff2e9-080ef26f
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Read-only design review for remaining NYU Git evidence. TaskRoot C:/Users/danie/Projects/Filesystem-Cleanup. Read nyu-operation-journal.md, scripts/nyu-runtime-inventory.py only Git classifier portions, reviews/codex-nyu-collector-r4-review.md and reports/nyu-runtime-screening-999a130965c14f328024fd85876f2edc.json only Git boundary/unknown sections. These selected cleanup scripts/reports and KB governance are authorized for OpenAI review. Do not read actual source/course repositories, credentials, OAuth, private logs or config stores. Do not run Git against any source, write files, edit settings, fetch, checkout, reset, clean, execute project code or spawn agents. Required KB preamble allowed.
Task: propose the smallest safe next evidence step for preserving 19 repository histories, uncommitted/ignored/untracked work and repository pointers. Earlier ordinary git status was rejected due filter execution, fsmonitor/hooks, .git reparses and unbounded subprocess output. We intentionally disabled Git entirely. Use official Git documentation via native web if needed (cite exact URLs) to distinguish commands that may run filters/helpers from genuinely inert plumbing. Do not invent a huge migration system or say generic read-only flag is safe. Favor capturing raw admin bytes and validating separately in a sanitized disposable copy if that avoids executing live repo config; enumerate what cannot be inferred (worktree/common-dir links, alternates, nested .git). Return an implementation-ready bounded sequence and explicit refusal conditions, plus a small list of exact commands only if documented safe under specified config/env controls. Do not write scripts yet. 5 fixed roots: nyu, source/repos/ai(no Git observed), ait25,ait26,cs202. Exact paths in report. No egress of new source contents. Keep output under~1600words, finish within~300seconds.

## Result

\## Verdict

Do not re-enable Git against the live roots. The smallest safe next step is a two-phase collector:

1. Capture the five roots and every Git administrative object byte-for-byte using filesystem APIs only.
2. Validate Git state only in a sanitized, disposable copy whose configuration and external pointers cannot reach the live machine state.

This is necessary because the current collector deliberately leaves Git evidence pending ([classifier](</C:/Users/danie/Projects/Filesystem-Cleanup/scripts/nyu-runtime-inventory.py:604>)), while `ait25`, `ait26`, and `cs202` still have partial inventories or inventory errors. Therefore, reported `commondir=False`, `alternates=False`, and empty worktree lists are observations—not proven absences.

\## Boundaries requiring preservation

The report identifies exactly 19 repositories:

- `C:\Users\danie\nyu`: root plus `data-mgmt\hw\hw02`, `data-mgmt\hw\hw03`, `software-eng\projects\p1\.cache\exercise-repo`, `software-eng\projects\p1\.cache\slide-machine`
- `C:\Users\danie\source\repos\ait25`: `homework01-danielzhang04`, `homework02-danielzhang04-old`, `homework03-danielzhang04`, `homework04-danielzhang04`
- `C:\Users\danie\source\repos\ait26`: `final-project-danielzhang04`, `homework01-updated-danielzhang04`, `homework02-danielzhang04`, `homework03-danielzhang04`, `homework04-danielzhang04`, `homework05-danielzhang04`, `homework06-danielzhang04`, `homework07-danielzhang04`, `homework09-danielzhang04`
- `C:\Users\danie\source\repos\cs202`: root
- `C:\Users\danie\source\repos\ai`: no Git boundary observed; preserve the entire root anyway.

The existing journal already requires preserving separate histories and all modified, untracked, and ignored work ([journal](</C:/Users/danie/Projects/Filesystem-Cleanup/nyu-operation-journal.md:15>)). The r4 approval expressly excludes Git capability and live evidence ([review](</C:/Users/danie/Projects/Filesystem-Cleanup/reviews/codex-nyu-collector-r4-review.md:17>)).

\## Implementation-ready bounded sequence

1. **Finish boundary discovery without Git.** Re-run the no-follow inventory until all five roots report complete traversal and zero unexplained errors. Discover `.git` names case-insensitively, including ordinary files, directories, reparses, nested boundaries, and `.git` entries below administrative directories. A changed count is reconciled, never forced back to 19.

2. **Freeze one root at a time.** Establish a writer pause, record source identities, and require a unique absent destination plus sufficient capacity. Any pre/post identity, size, timestamp, entry-set, or stream delta invalidates that generation.

3. **Capture the complete root, not merely `.git`.** This is what preserves tracked, modified, untracked, and ignored bytes without first asking Git to classify them. Preserve empty directories, ADS, ACLs, timestamps, reparses without traversal, hardlink relationships where supported, and every `.git` byte—including index, refs, packed refs, reflogs, objects, packs, stash refs, hooks, config, logs, worktree metadata, and submodule administrative stores. Raw configuration is retained but never printed or semantically inspected for credentials.

4. **Parse only pointer topology with non-Git code.** Bounded lexical reads should cover:

   - working-tree `.git` files;
   - `commondir`;
   - `objects/info/alternates`;
   - `worktrees/*/gitdir`;
   - `modules/**`;
   - environment-originated object locations, if any are detected by the controlled capture process.

   Preserve exact bytes in recovery; reports expose only containment class and digest. Git documents that `.git` may be a pointer file, `commondir` makes the repository incomplete without another directory, alternates borrow another object store, and `worktrees` contains linked-worktree administration. [Repository layout](https://git-scm.com/docs/gitrepository-layout), [worktree layout](https://git-scm.com/docs/git-worktree).

5. **Close external dependencies before validation.** Every pointer target must either be captured into the same generation or cause a refusal. Rewrite absolute pointers only in a second analysis copy, retaining untouched originals. Never resolve them against the live filesystem during Git execution.

6. **Sanitize the analysis copy.** Replace copied local and worktree config with a generated allow-list containing only required structural keys, such as repository format, bare/filemode/symlink/case behavior, object format, ref storage, and worktree-config extension. Reject includes, unknown required extensions, partial-clone/promisor configuration, command-valued settings, or paths escaping the copy. Use known-empty system/global config files, an empty hooks directory, disabled fsmonitor/untracked cache, no network, no terminal prompting, a child-process deny policy, bounded runtime/output, and no writable access outside the disposable generation. Git confirms that config has system, global, local, worktree, and command scopes, and that `core.hooksPath` controls executable hooks. [Configuration](https://git-scm.com/docs/git-config), [hooks](https://git-scm.com/docs/githooks).

7. **Validate without `status`, checkout, or diff drivers.** First parse HEAD, refs, packed refs, reflogs, and index independently. Then run only the bounded commands below against the sanitized copy. Compare staged entries to parsed HEAD trees; use the two path enumerations to identify untracked and ignored content. For unstaged content, independently compare captured worktree bytes/modes to index blobs. If attributes imply EOL conversion or a filter, report Git-semantic modification status as unknown rather than executing it. Git filters are configured commands and may download, decrypt, or transform content. [Attributes and filters](https://git-scm.com/docs/gitattributes).

8. **Publish evidence only after cross-checking.** Require matching boundary counts, complete object connectivity, captured pointer closure, and a complete partition of worktree entries into tracked, untracked, ignored, administrative, or explicitly unknown. Reports contain hashes, modes, object IDs, and paths only—never source bytes.

\## Permitted Git commands

Only inside the sanitized disposable copy:

```text
git -c core.hooksPath=<empty-dir> -c core.fsmonitor=false -c core.untrackedCache=false ls-files -z --stage
git -c core.hooksPath=<empty-dir> -c core.fsmonitor=false -c core.untrackedCache=false ls-files -z --others --exclude-standard
git -c core.hooksPath=<empty-dir> -c core.fsmonitor=false -c core.untrackedCache=false ls-files -z --others --ignored --exclude-standard
git -c core.hooksPath=<empty-dir> fsck --full --strict --no-progress --no-dangling
```

`ls-files --stage` reports index modes/object IDs, while `--others` and `--ignored --exclude-standard` classify worktree paths using ignore rules. [ls-files](https://git-scm.com/docs/git-ls-files). `fsck --full` also follows alternate object pools, which is why it is permitted only after every alternate has been internalized. [fsck](https://git-scm.com/docs/git-fsck).

\## Explicit refusal conditions

Refuse the affected root if inventory remains partial; a `.git` marker is a reparse or malformed pointer; any pointer/alternate/common directory escapes authorized captured scope; a linked worktree is uncaptured; shallow/promisor state prevents a complete local history; objects or refs change during capture; unsupported ADS/ACL/hardlink/reparse behavior would lose bytes; destination exists; capacity is insufficient; configuration sanitization encounters an unknown required extension; Git attempts a child process, network access, prompt, or external-file access; or any bounded process exceeds its time/output limit.

No Git command is approved against a live NYU root, including `status`, regardless of “read-only” flags.
