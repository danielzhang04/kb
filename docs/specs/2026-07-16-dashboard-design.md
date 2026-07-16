# kb Web Dashboard — Design Document (Month-1 Draft)

Status: synthesis draft for Daniel's decision. Merges four research tracks (observability, interaction-model, stack/identity, steering). Where the tracks disagreed, the conflict is resolved inline and flagged **[CONFLICT RESOLVED]**. A security + feasibility review panel then hardened this draft; its findings are folded in inline and summarized in **§8 Review changelog**.

---

## 1. Purpose + relationship to the fleet

**What it is.** An *optional* local web daemon on Daniel's Windows 11 desktop that renders the fleet's live state and, later, lets him steer it — from the desktop or a phone. It is the **Mission Control surface** named in the fleet-layers brainstorm, made real.

**What it is not.** It is not a database, not an orchestrator, and not load-bearing. **Git stays the database.** Every durable fact the dashboard shows already lives in the repo (`queue/`, `ledgers/`, `dashboards/*.md`, `orgs/*/STATE.md`, `skills/`, `memory/`) or in local Claude Code JSONL transcripts under `~/.claude/projects/`. The dashboard is a **projection over files + a thin GUI over the same governed CLI paths agents already use** — never a second brain. If it is off, the fleet coordinates through git exactly as today; the dispatcher, cloud Routines, and cards keep running untouched.

**Two data planes it joins (no new store):**
- **Plane A — the kb repo (`ops` branch):** cards, ledgers, dashboards, project STATE/contract/HEARTBEAT, skills, workflows, memory. The coordination truth.
- **Plane B — Claude Code local artifacts (`~/.claude/projects/<slug>/*.jsonl` + `<session>/subagents/agent-*.jsonl` + `.meta.json`):** the execution truth — the reasoning/tool/result stream. In v0/v1 this is read by **tailing JSONL, which lands at message/record granularity** (a `thinking`/`tool_use`/`tool_result` line appears when that event *completes*, ~1–2s latency) — so v0 lets you "watch an agent's **steps land live** (message-granular)," not a live intra-turn token stream. True token-level streaming arrives only with the v2 Broker's in-process SDK stream (§3.1, §4).

The join key that stitches them: the dispatcher writes the spawned `sessionId` into the card at claim time, so a card links to its transcript, and each subagent `.meta.json`'s `toolUseId` joins back to the parent's `Task` tool-use block — giving a full spawn tree purely from files.

**Where it sits among the coming layers.** It *hosts* the other fleet-layers rather than competing with them: Mission Control (this surface), Flight Recorder (git-committed trace permalinks), Sentinel/Quartermaster (health + cost panels), Atlas (reads the same projection aloud). New layers dock in as panels.

---

## 2. THE INTERACTION-MODEL CHOICE — pick one

All three sit on the same spine (render repo + tail JSONL + write through governed CLI). They differ only in **how much editing/terminal surface sits on top**, i.e. where on the vibe-code↔real-code spectrum the *front door* lives. Each card walks the same session: **7am phone check → click into a running pipeline → stop it → change a skill → rerun.**

A capability present in **all three** and orthogonal to the choice: a **vibe-code chat box** that spawns a real `claude` session against the kb and streams it back live — "describe it, watch it happen," at $0 marginal API cost. **Because free-form text into that box is a live prompt into a real Claude session with the fleet's full reach (an RCE-equivalent surface, not "## Evidence" inert data), it is gated behind the same enrolled-device / WebAuthn session as approvals, rate-limited, and audited — never gated by network location alone** (see §3.5, §3.6).

### Option A — Mission Control (no-code-first)
Cards, buttons, forms, a pipeline canvas, a ranked approval inbox. No terminal, no text editor in sight. An air-traffic-control tower, not a cockpit.

- **Session:** 7am, phone. Top of screen: 3 approvals ranked, fleet strip (4 agents, 2 running, budget 38%). Taps the T3 approval → typed review panel → Approve (token minted). Taps the running `faceless-youtube` pipeline → five card-nodes wired by `depends-on`, "shots" node pulsing, live spectator timeline. Wrong direction → **Stop** on the node. A **structured form** slides up ("tone: grittier, shot density: +2") → **Rerun** dispatches a fresh card. Never saw code.
- **Effort:** Medium. Renderers are projections (agent-buildable). The cost is the **per-skill form schemas** — every "tweak" needs a form spec, ongoing authoring debt as skills multiply.
- **Extensibility:** Great for *adding surfaces* (Sentinel/Quartermaster/Atlas panels drop in). Poor for the long tail — the day the buttons don't cover something, there's no escape hatch.
- **Phone:** Best of the three. Taps and cards, no keyboard, pairs perfectly with push.
- **Verdict:** Commits hard to one end of the spectrum Daniel said he's *unsure* about; can't slide.

### Option B — Hybrid Workbench (no-code console + real terminal + light editor) — **RECOMMENDED**
Option A's console, plus two power panes one click away: a **real embedded terminal** (xterm.js + node-pty/ConPTY) and a **light code editor** (CodeMirror 6). VS Code-*ish*, not VS Code. A cockpit with an autopilot — buttons most of the time, grab the stick when you want.

- **Session:** Same board, same tap-to-approve, same click into the pipeline. Wrong direction → **Stop** → a **CodeMirror pane** opens directly on `skills/curated/visual-prompt-writer/SKILL.md` (editable on the phone), edit the actual prose, save (commits through the governed path). Then the **terminal pane**: `python scripts/dispatch.py rerun <card-id>` — or just click **Rerun**. Can run *anything you could in a VS Code terminal* because it is a real PTY on the desktop.
- **Effort:** Medium-High. A's renderers **plus** a PTY (mature: node-pty is VS Code's own terminal stack, ConPTY on Win 1809+) and CodeMirror-with-governed-save. Every ingredient off-the-shelf. *(Note: the security-critical WebAuthn verifier and the v2 Broker are NOT "medium" — they are carved out as separate High-effort, human-reviewed lines; see §6.)*
- **Extensibility:** Best-in-class. No-code surface scales for the 90%; the terminal is the **universal escape hatch** for the 10% no panel covers. New capability never *requires* new UI. This *is* the slider Daniel asked for.
- **Phone:** Good, honest caveat. Board + CodeMirror are phone-friendly; a full terminal on a phone is usable-but-fiddly — reserve real terminal work for desktop. That posture is a *feature*: you're not trying to make an internet-exposed shell a great phone experience.
- **Verdict:** The literal answer to "I don't know where on the spectrum I want to live" — B is the mixer. Has a shipping precedent over Claude Code, free (Vibe Kanban: board + per-task worktree + terminal + diff review).

### Option C — IDE-first (code-server as the shell; dashboard as a panel inside it)
Front door is **VS Code in the browser** (code-server, MIT); the fleet dashboard is a **webview/sidebar extension**. The repo is just the open folder. "The IDE is the OS, the fleet is a plugin."

- **Session:** Opens code-server. Full file tree of `orgs/`, `skills/`, `queue/`. Fleet panel shows approvals → mint token. Click pipeline → spectator timeline, or open the JSONL as a file. Wrong direction → **native integrated terminal** kills the card, opens the skill in **full Monaco with IntelliSense**, edits, commits via the Git panel, reruns. Entire power of VS Code for free.
- **Effort:** Low-Medium for the *shell* (install, not build) but Medium-High for the *fleet panel* — VS Code extension authoring is a real, specific skillset, and that's where all the value lives. code-server is also a **heavier always-on process**, closer to the "required daemon" line.
- **Extensibility:** Strong for code-shaped work (whole VS Code ecosystem); weak for at-a-glance ops — an IDE is a workbench, not a control tower. Calm standalone layers (Atlas voice, ambient briefs) fit awkwardly in editor chrome.
- **Phone:** Weakest. code-server on a phone is a known pain (dense chrome, tiny targets, keyboard-dependent, Monaco's 2–5 MB bundle). You'd end up building B's front-end anyway.
- **Verdict:** Over-serves the daily use-case (90% is watch + approve + nudge). Best kept as an *optional v2 annex* on the tailnet for heavy multi-file coding, linked from the dashboard — never the front door.

### Recommendation: **Option B, reached by shipping Option A first and adding B's two panes.**
Reasoning: (1) B *is* the answer to Daniel's stated uncertainty — calm board for the daily 90%, terminal+editor for the 10%, one window, slide freely. (2) It matches the substrate's grain — a small optional Node daemon + a PTY + CodeMirror, not a heavyweight IDE server (C) and not a no-code cul-de-sac (A). (3) It has a working free precedent over Claude Code (Vibe Kanban). (4) The terminal future-proofs the layer roadmap: every layer drops in as a panel, and you're never blocked waiting for a panel to exist. Treat **A as a phase, C as an optional annex.**

---

## 3. Architecture for the recommended option (B)

**Security posture — the load-bearing correction.** The dashboard authenticates **every consequential action** — approve, governed-save, card launch/rerun, PTY open, vibe-code spawn, and every Broker steering verb — with a **WebAuthn-backed enrolled-device session**, plus per-request `Origin`/`Host` validation. **Network location (tailnet / localhost) is never treated as a trust boundary**, because the threat model explicitly names the same-desktop agent — which lives on localhost — as the real adversary. Tailnet membership and the localhost bind are *reductions in attack surface*, not authentication. This principle governs §3.1, §3.3, §3.5, and §3.6.

### 3.1 The two-process split **[CONFLICT RESOLVED]**
The steering research forces a split the other tracks glossed: **graceful mid-turn steering needs an in-process SDK handle, which an external dashboard cannot hold.** Therefore:

- **The Broker** — a long-lived, **dispatcher-side** session-owner that spawns fleet workers as SDK streaming sessions and holds their control handles. It exposes a **localhost-bound control socket** with five verbs. It **runs regardless of the dashboard** and **must honor `STOP`**. PM2-supervised.
  - **The socket is authenticated per-connection — localhost bind is NOT the control.** Any process on the desktop (the named adversary) can reach a localhost socket, and an unauthenticated Broker socket would grant a genuinely new lateral-movement capability: injecting instructions into a *sibling* agent's in-flight turn via `query()`-inject/`interrupt()`/fork, which a plain shell does not otherwise grant. Every connection must pass **both** a peer-credential check (`SO_PEERCRED` / Windows named-pipe peer PID→owner check) **and** a per-boot secret token that the dispatcher issues only to itself and the dashboard daemon at spawn time. Reject unauthenticated callers.
  - **STOP is actively mechanized, not merely "checked before spawning."** Because the Broker is persistent and already holds live handles, it runs a **`STOP` file-watch** that, on `STOP` appearance, actively `interrupt()`s and then drains/kills every live session handle it owns (escalating `interrupt()`→SIGTERM→SIGKILL on the per-session timeout), rather than only ceasing to spawn new work.
- **The Dashboard daemon** — the **optional** Node/TS web app. Reads Plane A + Plane B, serves the UI, and is a **thin, authenticated client** to the Broker's socket for any steering verb. If it dies, you lose the GUI, not the fleet, and not the Broker's handles.

Neither is load-bearing for coordination (git is). The Broker is what *upgrades* steering from kill+rerun to graceful — see §4. Remote access reaches the *dashboard*, which (with a valid WebAuthn session) reaches the *broker* over the authenticated socket; the broker socket never binds to a public interface *and* never trusts an unauthenticated local caller.

### 3.2 Stack **[CONFLICT RESOLVED: Node/TS, not Rust]**
One **Node/TypeScript** daemon (Fastify), serving a **Vite + React SPA** with a tabbed **Control** view (no-code) and **Code** view (editor/terminal) over one backend.

- **Terminal:** xterm.js ↔ **node-pty (ConPTY)** over WebSocket — literally VS Code's terminal stack, the most de-risked path on Windows 11. Process-group tracking for granular stop. **Build note:** node-pty is a native addon; it needs a matching prebuilt binary or a node-gyp toolchain (VS Build Tools) and must match the daemon's Node/Electron ABI — a Node upgrade can force a rebuild. **Pin the daemon's Node version** and vendor a known-good prebuild so a bare Windows box isn't a from-scratch native build.
- **Editor:** **CodeMirror 6** as the default (≈50 kB, phone-friendly, mobile-first) for markdown/skill files. **Monaco optional/deferred** — it earns its 2–5 MB only if a genuine full-IDE feel is wanted. *(The stack track floated Monaco for the Code view; the interaction track argued CodeMirror. Resolution: CM6 default, Monaco opt-in — both tracks actually agree CM6 is the better default.)*
- **DAG/canvas:** React Flow for the pipeline view (v2).
- **JSONL engine:** byte-offset incremental tailer that skips non-message record types (`queue-operation`/`summary`), joins `tool_result.tool_use_id → tool_use.id`, and descends the subagent tree via `meta.toolUseId`. Study/light-fork `claude-view` (parser+tree), `claude-code-log` (static permalink renderer), `hoangsonww` (hook push + "Waiting" column) — but reimplement in TS rather than adopting a Rust core, so the fleet can maintain it and it shares one process with the PTY/WebAuthn code. Run stock `claude-view`/`clog` alongside as a zero-build fallback viewer.
- **Language rationale:** Node/TS wins because the two hardest Windows pieces — the PTY and WebAuthn — have their best-supported libraries there (node-pty, SimpleWebAuthn), and React has the richest supply for the DAG/editor/terminal surfaces. *(Observability track left Rust-vs-TS open; stack track's Node case is decisive on Windows. Open item retained in §7 only as "who maintains it.")*

### 3.3 Data flow
- **Read path (v0):** file-watch `queue/`, `ledgers/`, `dashboards/*.md`, `orgs/*/STATE.md`, `skills/**`, `workflows/*.md` → in-memory index (disposable, regenerated on start — no SQLite source-of-truth) → SSE/WebSocket to the SPA. In parallel, file-watch `~/.claude/projects/**/*.jsonl`, seek from last byte offset, parse complete newline-terminated lines only, push transcript deltas **at message/record granularity** (~1–2s; not intra-turn tokens). **Hooks are an opt-in latency upgrade, not a dependency** — a fire-and-forget `POST` on `PreToolUse`/`SubagentStart`/`Stop` that always `exit 0`; file-watch alone must fully suffice so the fleet is never coupled to the daemon.
- **Live tails:** foreground WebSocket while the app is open (iOS PWAs have no background sync — live watching is a foreground/desktop activity; push is only for alerts/approvals). The read WebSocket upgrade is subject to the same `Origin` check and session requirement as the API (§3.6).
- **PTY (v2) — constrained identity, WebAuthn-gated:** xterm.js ↔ node-pty child, process-group tracked. **[CONTRADICTION RESOLVED — the PTY runs under a *constrained fleet identity*, never "as Daniel's user."]** The earlier "as Daniel's user" phrasing is withdrawn: streaming a live PTY to a phone means any `env` / `cat ~/.claude/.credentials.json` would **transmit ambient runtime credentials over the wire onto a remote device**, which the constitution's credential ceiling forbids ("ambient runtime credentials … never printed, copied, persisted, or transmitted"). Therefore the PTY child runs under a dedicated fleet account whose environment **excludes Daniel's git push credential and the `CLAUDE_CODE_OAUTH_TOKEN`**, and it is gated behind a fresh WebAuthn step with a short session TTL (this is a hard requirement, not the Open-Q5 "or trust the tailnet" option).
  - **Scope of the "one enforcement point" claim once a real shell exists:** the governed-write guarantee below (never raw writes; all mutation through `scripts/*`) binds the **dashboard's own action surface** — buttons, forms, approvals, governed-save. A real PTY is deliberately an *escape hatch* and can bypass it (a shell can `git` directly). It is contained not by the enforcement point but by (a) running under the constrained identity above — which lacks the `ops` push credential, so it cannot silently push coordination writes as the fleet — and (b) the WebAuthn gate + audit on opening it. State this honestly: the PTY is powerful-by-design and is contained by identity + gate + audit, not by the write-path funnel.
- **Write path (governed, one enforcement point for the dashboard's own actions):** the dashboard **never** does raw writes to `queue/`/`ledgers/`/`governance/`. Every mutation shells out to the **same scripts agents use** — `scripts/cards.py`, the approvals flow, `sync-skills` — as child processes, then `git pull --rebase origin ops` → commit → push, honoring branch rules. File/skill edits land on a human/agent branch, never direct-to-`main`. Governed-save and card launch/rerun are **WebAuthn-session-gated** (§3.6), not open to any tailnet caller. The dashboard is a GUI over the CLI; branch discipline, schema, hash-binding, and claim logic stay defined in one place.

### 3.4 Runtime + remote access
- **How it runs:** **Task Scheduler "at logon" under Daniel's account** (restart-on-failure), *not* an NSSM/SYSTEM service. A session-0 service wouldn't carry his git credential, user PATH/toolchain, or an interactive session for Windows Hello — all of which the daemon needs. "No dashboard when signed out" is correct by design (non-load-bearing). *(The daemon needs Daniel's git credential for the governed `ops` write path; the separate constrained PTY child in §3.3 deliberately does not inherit it.)*
- **Remote:** **Tailscale Personal (free; 6 users / unlimited devices) + Tailscale Serve.** Backend binds localhost-only behind Serve; the phone reaches it over the tailnet with **no public port and no exposed shell**. Serve provides HTTPS on a stable `*.ts.net` origin — required for the WebAuthn RP-ID and the PWA secure context. Cloudflare Tunnel is the fallback (public hostname, TLS-terminated at CF edge — strictly weaker for a PTY-exposing box). **ntfy/Telegram** is a complementary push + low-tier-approve channel, not the dashboard.
  - **Never `funnel`; scope to Daniel's own devices.** `tailscale funnel` (as opposed to `serve`) would make the shell-exposing box **public to the internet** — an explicit guardrail forbids it, and startup asserts the listener is tailnet-scoped, not funnelled. Even correct `serve` exposes to the *entire* tailnet (up to 6 users, shared nodes), so a **Tailscale ACL restricts the daemon port to Daniel's own devices/tag** rather than the whole tailnet.
- **Phone surface:** installed **PWA** (Add-to-Home-Screen). Foreground-WS for live tails; Declarative Web Push for approval/alert notifications. Passkeys (Face ID → Secure Enclave) work in the installed PWA over the Tailscale HTTPS origin.

### 3.5 Approval-minting identity — WebAuthn/passkeys, verified by the dispatcher
The single most security-critical surface. **This is bespoke, security-critical protocol code where a subtle bug silently defeats the whole T3 gate — it is therefore carved out as human-reviewed security work with an explicit design/threat-review gate (High effort), NOT routine agent-buildable work (see §6).**

1. **Enrollment (one-time, human):** Daniel registers passkeys (Windows Hello/TPM on desktop, Face ID/Secure Enclave on phone) against **RP-ID pinned to the full stable Tailscale host** (never the bare `ts.net` suffix — a suffix RP-ID would allow cross-node phishing on a shared tailnet). **Public keys are committed to `governance/`** (human-edited, branch-protected against all agents).
2. **Approve:** to approve card X the server issues a challenge `= base64url(card_id ‖ action ‖ content_hash ‖ server_nonce)`. The browser requires user verification (biometric); the authenticator signs `authenticatorData ‖ SHA256(clientDataJSON)`, and clientDataJSON binds both the challenge **and the origin**. *(Bind card_id + action, not the hash alone, to defeat a confused-deputy across two cards with identical bodies.)*
   - **`content_hash` preimage is the full canonicalized card payload — including `risk-tier`, `owner`, and `target`** — not just the body. Any consequential field left outside the hash would let a post-approval tier/owner/target mutation escape the binding; the §4 rule "steering never launders a tier bump" depends on this completeness.
3. **Record:** the governed approvals script writes the assertion (authenticatorData + clientDataJSON + signature) to `queue/approvals/` on `ops`.
4. **Verify (dispatcher, independently) — full WebAuthn assertion check:** Only then does the T3 action execute. The verifier confirms, at minimum:
   - **`content_hash` recomputed and present in clientDataJSON**, pinned to the **exact committed object/commit hash** the assertion was issued against — and the action executes **against that pinned content**, not a re-read of `ops` (closes the TOCTOU: the same-desktop agent has `ops` write access and could push a replacement card between verify and execute).
   - **origin** in clientDataJSON == the expected ts.net RP origin.
   - **`authenticatorData` flag checks: `UV == 1` (user-verification/biometric actually performed) and `UP == 1` (user present).** Without the UV-flag check the entire "authenticator required biometric" guarantee is unenforced — a silent, no-user-verification assertion would otherwise pass.
   - **`rpIdHash == SHA256(expected full host)`** inside authenticatorData.
   - **signature chains to a governance-pinned pubkey.**
   - **monotonic signature counter** (clone detection) — reject a non-increasing counter.
   - **freshness / single-use** of the server_nonce.

**What this holds against — stated honestly:**
- **The same-desktop agent is the real adversary.** It has ambient git credentials and can even write to `queue/approvals/`, but it has no TPM/Secure-Enclave key and no biometric, so its forged approval is rejected for lacking a valid assertion (identical to today's "agent-set approval field = tampering" rule). A network attacker is blocked by tailnet membership *and* origin-binding *and* the WebAuthn session.
- **[CORRECTION — a compromised dashboard can DoS AND can induce mis-signing; the earlier "cannot forge" claim was overstated.]** WYSIWYS gap: the human sees only what the (possibly compromised) dashboard renders, and the OS biometric prompt shows only "authenticate to `<rp-id>`," never the card body/action/tier. A malicious UI can display a benign card while requesting a signature over a *different, malicious high-tier* card; the human biometric-signs the attacker's choice and the dispatcher verifies a technically **valid** assertion. Mitigations, layered:
  - **Out-of-band confirmation.** On execution the dispatcher emits an **independent** ntfy/push notification — "you approved card X: `<action>`, tier `<T>`" — sourced from the dispatcher's own verified view, not the dashboard, so a mis-sign is *detectable after the fact* on a second channel.
  - **Corroborable challenge step.** The challenge-confirmation UI renders the exact `card_id + action + risk-tier` the signature will cover, from a source the human can independently corroborate (the committed card on `ops`), before the biometric prompt.
  - **Residual risk stated plainly:** a fully compromised dashboard *can* induce a one-shot mis-signing of a card the human is tricked into confirming; the out-of-band channel converts that from silent-forgery into rapidly-detectable, and the pinned-hash execute prevents post-approval content swap. This is an accepted, documented residual — not "impossible."
- **Rate-limiting, lockout, and an independent audit trail.** Approve/steer/spawn endpoints throttle attempts and lock out on repeated failure, and every approve/steer/spawn/PTY-open is written to an **append-only, git-committed audit log** independent of the dashboard's own logs.

The dashboard is transport; the proof, verified in the dispatcher against pinned keys with the full assertion checks above, is the guarantee. This is the §7 "human-identity + content-hash contract" extended to a third channel alongside GitHub-merge and Omnara.

*(Passkey-sync note, Open-Q3: a phone passkey synced via iCloud/Google Keychain means an Apple/Google account compromise yields approval-forging capability — outside the "no TPM/Secure-Enclave key to forge" claim. Prefer a **device-bound** signer for the approval role, or explicitly accept synced-account compromise as a documented residual risk. See §7.)*

### 3.6 Session auth for all non-approval actions **[NEW — panel BLOCKER fixes]**
Approve is not the only privileged action. **Governed-save, card launch/rerun, PTY open, vibe-code spawn, and every Broker steering verb require an active WebAuthn-backed enrolled-device session** — the same enrolled credential proves presence, and steering/save/PTY actions carry a short-TTL session token minted at that WebAuthn step. None of these is authorized by tailnet or localhost presence.

**Origin/Host + CSRF validation on every request and WebSocket upgrade.** The localhost bind + Serve is *not* authentication: it leaves the full API reachable by any local process (the named adversary) and by browser **DNS-rebinding** against `localhost:<port>`. So the backend **validates `Origin`/`Host` == the ts.net RP origin on every HTTP request and every WebSocket upgrade, rejecting mismatches**, and applies CSRF / WebSocket-origin checks. This closes both DNS-rebinding and drive-by local-process access.

### 3.7 The vibe-code / subscription-auth path **[CONFLICT PARTIALLY RESOLVED — OPEN GOVERNANCE RISK]**
The chat box and the Broker both drive real Claude at **$0 marginal API cost** by riding the Max subscription with **`ANTHROPIC_API_KEY` unset** (already enforced by `scripts/preamble.py`). Two mechanisms, one banned:
- **CLI subprocess:** `claude --print --output-format stream-json` (what Vibe Kanban/Happy/Omnara do). Good for the vibe-code chat box. **This is the fallback that does not depend on the SDK/OAuth path** and must be kept working independently.
- **Agent SDK with its own OAuth flow:** `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` in the Broker's env. This is Claude Code's *own* auth, and it is **what the Broker needs** to get `interrupt()`/`set_model()`/`rewind_files()` handles.
- **Banned — scraping the OAuth token into a homegrown raw API client** (the OpenClaw pattern the spec forbids). The line: *use the CLI/SDK's own auth; never hand-roll an HTTP client around a lifted token.*

**[DOWNGRADED from "resolved" — this is a live governance risk, not settled.]** Anthropic's help center frames subscription Agent-SDK use as permitted *under the currently paused credit model*, but a parallel, still-current policy strand says Pro/Max OAuth tokens are "intended exclusively for ordinary individual use of Claude Code and claude.ai," and that anyone "building products or services that interact with Claude's capabilities (including via the Agent SDK) should use an API key." A personal Broker holding long-lived SDK sessions sits exactly on the ambiguous "individual use vs. product/service" line. Therefore:
- The **Broker's very existence** (not merely its cost) is contingent on **re-verifying ToS at build time**; treat it as an open governance decision for Daniel, not a resolved technical detail.
- Keep the **CLI-subprocess-only fallback** as a first-class path so the fleet degrades to "subscription-interactive only" if the SDK/OAuth route is disallowed or ever metered.

**Cost is $0 in dollars but NOT free in capacity.** With the billing split paused, programmatic use draws from your Pro/Max 5-hour and weekly **rate-limit caps**. A Broker holding many long-lived streaming sessions **plus** a vibe-code chat box is a continuous quota draw that can exhaust those caps — a **capacity failure, not a bill**. Ledgers are correctly "usage not spend," but the **rate-limit ceiling is the real scarce resource**; budget and monitor it (see Q7/Q11/Q12). **Watch item:** the June-15 credit-pool change is *paused, not cancelled* — re-verify at build time and design both paths to degrade to "subscription-interactive only" if unattended `-p`/SDK ever becomes metered.

---

## 4. Steering semantics (per target type; honest possible-vs-best-effort)

**The one-sentence truth:** you cannot gracefully pause an in-flight LLM turn from an external process. Graceful mid-turn stop exists **only** for whoever holds the in-process SDK handle — i.e. the Broker, for sessions it spawned. Everything else is between-turn cooperative steering or destructive process kill.

**HARD BOUNDARY (not an open question): graceful steering covers ONLY Broker-spawned SDK streaming sessions.** Interactive TTY sessions, headless `claude -p` runs, and cloud Routines are **kill-only** — they never get graceful `interrupt`/`query`-inject/`set_model`/fork, because no external process holds their handle. This is a design invariant, stated here rather than deferred to Q7.

**[CONFLICT RESOLVED — the "fork is impossible on subscription" pessimism is stale.]** The observability and stack tracks both said true mid-run restore is impossible on subscription and it's always "re-simulate from reconstructed context." The steering track corrects the *reachability*: on subscription-OAuth the SDK's `interrupt()` / `query()` inject / `set_model()` / `stop_task()` / `rewind_files()` and **resume-with-`fork_session=true`** all work — **for Broker-owned sessions only**. The remaining honest caveat both sides share: fork + `rewind_files` is a **re-simulation from context, not a KV/state restore** — non-deterministic, tokens/cost best-effort. So: graceful *control* is real; perfect *time-travel replay* is not.

**Five verbs × four targets** *(SDK-call precision: "fork" is not a standalone method — it is `resume` with `ClaudeAgentOptions.fork_session=true`, gated by `enable_file_checkpointing`. `stop_task(task_id)` stops an **in-session background task**, not an arbitrary external PID; a bash-launched ffmpeg/render is halted by process-group kill, not `stop_task`.)*:

| Verb | Claude Code session (Broker-owned) | Fleet card | Scheduled cadence | Long render/build |
|---|---|---|---|---|
| **list** | Broker session table + JSONL scan | `queue/` scan by state | cadence registry / HEARTBEAT | Broker task table + OS process list |
| **inspect** | Tail JSONL (turns/tools/tokens) + live stream | Card md + ledger rows + trace | registry + last-run ledger | task log / stdout, PID, runtime |
| **stop** | **Graceful:** Broker `interrupt()`. **Backstop:** SIGINT/kill PID | Set `stop-requested:true` / state→`halting`; worker polls at checkpoint; kill as backstop | Set `paused:true` overlay (next beat skips); `STOP`=all | `stop_task(id)` **only if launched as an in-session background task**; else SIGTERM→SIGKILL process group |
| **steer** | Broker `query()` inject + `set_model`/`set_permission_mode` — *graceful, turn-boundary* | Edit Work order / append `## Feedback`, requeue; or interrupt + re-dispatch | Edit params (via approval — HEARTBEAT is on `main`) | Rarely steerable — stop + relaunch with new args |
| **rerun** | `--resume`/`--continue` (same thread) or **resume with `fork_session=true`** (branch, history intact) seeded with feedback | New card, `depends-on:[orig]`, feedback in `## Evidence` | Trigger one off-cadence run now | Relaunch child with revised inputs (idempotent) |

**Honesty ladder:**
- **Cleanly graceful (real APIs / deterministic file writes):** SDK `interrupt`/`query`/`stop_task`/`rewind_files`/`set_model` on Broker-owned sessions; cadence pause; card rerun-as-new-card; session fork (resume + `fork_session=true`).
- **Best-effort cooperative:** card `stop-requested` — the worker only sees it when it yields (between steps / before an expensive tool call). Mid-turn it won't see it until the turn ends.
- **Reliable but destructive:** SIGKILL / process-group kill — loses in-flight tool state (half-written mp4, partial git); re-attach via `--resume`. The right model for idempotent renders (kill+rerun, not pause).
- **Impossible from outside:** pausing an in-flight LLM turn without the in-process handle. Not a gap to engineer around — a fact to design with. Sessions the Broker did *not* spawn (interactive TTY, headless `claude -p`, cloud Routines) get **files-only + kill** control, never graceful steer.

**Cross-cutting rules:**
- **Steering never launders a risk-tier bump past the gate.** A `steer` that injects "also publish to prod" must re-trigger approval if it raises the tier. Reversible T1/T2 stop/pause/rerun is free; anything irreversible/T3 mints a token. This depends on `risk-tier` being inside the `content_hash` preimage (§3.5).
- **Iterate-on-results = a `depends-on` follow-up card by default** (git-native, cross-session; feedback goes in `## Evidence`, which the constitution already treats as inert data so it can't inject instructions). Offer fork (`fork_session=true`) + `rewind_files` for tight same-thread loops. **Checkpoint ≠ git:** `rewind_files` only tracks direct file-edit-tool changes, not bash-touched files (ffmpeg/`rm`/`mv`) — git is the authoritative rollback for anything a bash step produced.
- **Two granular controls, not one panic button:** "stop this card's PTY/session" (scoped) vs. the nuclear `STOP` file (whole fleet) — the VS Code-style steering Daniel asked for.

---

## 5. v0 → v1 → v2 phasing

**Sequencing law:** fleet foundations first, dashboard after. The whole one-enforcement-point + approval-verification story depends on `scripts/cards.py` + the approvals flow being the sole write path, and on the identity/approvals hardening shipping, **before** any dashboard control lands. Control does not ship until approvals hardening ships, **and the WebAuthn verifier passes its human security/threat review (§6).**

**v0 — Read-only Observatory + KB browser (the "watch" release).**
Tiny Node/Vite daemon, localhost-bound, reachable via Tailscale (with `Origin`/`Host` validation from day one, §3.6). Renders: KB file tree (read-only, over the local checkout + markdown render + `git log --follow`/blame per file — GitHub mobile is the zero-build equivalent), card queue by state, `dashboards/*.md`, ledger rollups (labeled **usage** — tokens/steps/wall-clock — not "spend"; subscription has no per-call dollar figure), skills/workflows/connections registries, and the **live spectator timeline** tailing active JSONL — **steps land message-granular (~1–2s: thinking → tool_use → tool_result, subagent tree, todo-tree, per-turn tokens), not an intra-turn token stream.** Push via ntfy/Telegram. **No writes.** Fully agent-buildable. Satisfies "see the whole KB + everything happening + click into a running workflow live." Existing Omnara/Happy cover steering until v1.

**v1 — Governed writes (the "steer" release; gated on approvals hardening + verifier security review).**
- **Approvals inbox** with typed renderers, minting WebAuthn human-identity + content-hash tokens through the §3.5 contract (with the corroborable challenge step + out-of-band confirmation).
- **Launch/rerun** buttons that dispatch cards to `ops`, honoring branch rules — **WebAuthn-session-gated** (§3.6).
- **CodeMirror editor** on KB/skill files, saving through the governed branch path — **WebAuthn-session-gated**.
- **Vibe-code chat box** shelling to `claude --print --output-format stream-json`, streamed, steerable/stoppable, subscription-billed — **WebAuthn-session-gated, rate-limited, and audited** (it is a live Claude prompt with fleet reach).
- **Coarse stop** (files-only floor: `STOP`, `stop-requested`/`halting`, cadence `paused`, SIGKILL backstop) — the dashboard-down-safe layer that never needs the Broker.
Full B feature set minus the raw terminal and graceful steer.

**v2 — Terminal + graceful steering + canvas + layer panels (the "power" release).**
- **Real terminal pane** (xterm.js+node-pty/ConPTY), Tailscale-private, **running under a constrained fleet identity (no `ops` push credential, no `CLAUDE_CODE_OAUTH_TOKEN` in env), WebAuthn-gated with short session TTL, audited** (§3.3) — not "god-mode," not "trust the tailnet."
- **Graceful Broker steering** (Option-1→2 ladder): workers run as SDK streaming sessions under the Broker; `interrupt`/`query`/`set_model`/`stop_task`/fork/`rewind_files` exposed over its **authenticated** localhost socket (§3.1), rendered as dashboard buttons. **Note this is a re-architecture of how the whole fleet executes work, not a panel — see §6.**
- **Pipeline canvas** (React Flow) over `depends-on`/`variant-group` DAGs with per-node stop/rerun.
- **Layer panels** as they ship: Sentinel health, Quartermaster cost, Flight Recorder run-diff/fork, Atlas reading the projection aloud.
- **Optional code-server annex** on the tailnet for heavy coding — linked from the dashboard, never the front door.

---

## 6. Build inventory

### AGENT-BUILDABLE (the fleet builds these itself, gated by normal approval)
- v0 read-only projection daemon: Plane-A file indexer + Plane-B JSONL tailer (byte-offset incremental, skip non-message records, subagent-tree join), SSE/WebSocket hub (with `Origin`/`Host` validation), React SPA shell.
- KB file-browser pane (read-only tree + markdown render + `git log --follow`/blame).
- Skills / workflows / connections registry views (derivations of `skills/**/SKILL.md`, `workflows/*.md`, per-project MCP settings; overlay trust/grade from `ledgers/grades/`).
- Live spectator timeline (tail → render; same code path for replay and live; **message-granular**).
- Static trace permalinks: post-run render of each dispatch's transcript to self-contained HTML (light `claude-code-log` fork), committed under `traces/<card-id>/…` (the Flight Recorder artifact).
- Optional non-blocking hook scripts (`PreToolUse`/`PostToolUse`/`SubagentStart`/`Stop`/`TaskCreated`), always `exit 0`, STOP-aware.
- v1 write modules — all via child-process to `scripts/cards.py` / approvals flow / `sync-skills`, then rebase-commit-push, **all WebAuthn-session-gated (§3.6)**:
  - Typed approval-inbox renderers + `challenge = card_id‖action‖content_hash‖nonce` construction; SimpleWebAuthn registration/assertion endpoints; the corroborable challenge-confirmation UI.
  - Card launcher/rerun; CodeMirror editor with governed save; vibe-code launcher (spawn `claude -p`, stream, wire stop, rate-limit, audit).
  - Files-only control floor: writers for `STOP`, `stop-requested`/`halting`, cadence `paused` overlay; rerun-as-`depends-on` filer.
  - Independent append-only, git-committed audit log of every approve/steer/spawn/PTY-open; rate-limit + lockout middleware.
- PWA manifest + service worker (Declarative Web Push); responsive layout; Task Scheduler XML (at-logon, run-as-Daniel, restart-on-failure) + install script; ntfy/Telegram tier-gated approve endpoint; **dispatcher out-of-band approval-confirmation push emitter**.

### HIGH-EFFORT, HUMAN-REVIEWED SECURITY WORK (carved out — NOT routine approval; explicit design + threat-review gate before merge)
- **The approval-verification module in the dispatcher** — the load-bearing T3 trust boundary. Bespoke security-critical protocol: recompute + pin `content_hash` to the exact committed object (TOCTOU-safe execute), origin check, **full WebAuthn assertion verification (UV=1, UP=1, `rpIdHash`, monotonic sign-count)**, signature-chain to `governance/` pinned pubkeys, freshness/single-use. SimpleWebAuthn helps with registration/assertion but **not** the custom challenge-binding + independent verifier — treat this as its own High-effort line with a human security review, because a subtle bug silently defeats the entire gate.
- **The Broker daemon (v2) — its OWN effort line, rated High, not a dashboard panel.** It is a **re-architecture of how the fleet executes work**: "every steerable worker runs as an SDK streaming session under a PM2-supervised session-owner holding control handles" changes the spawn model fleet-wide. Scope: spawns SDK streaming sessions, holds handles, **authenticated** localhost control socket (peer-cred + per-boot token) for the five verbs, **active `STOP` file-watch that drains live handles**, worker-side cooperative-cancellation poll at checkpoints, fork/rewind iterate flow, dashboard thin-client over the socket. Its very existence is contingent on the §3.7 ToS re-verification, with the CLI-subprocess fallback retained.
- v2 non-Broker panels (ordinary effort): xterm.js↔node-pty terminal (constrained identity, WebAuthn-gated, process-group tracking, pinned Node/prebuilt binary); React Flow canvas; layer panels.

### HUMAN-ACTION (Daniel only — accounts, credentials, identity, governance, network)
- **Pick the interaction model** (§2 — recommend B) and the vibe↔code default landing mode (recommend Control-view landing, Code-view one toggle away).
- **Install Tailscale** on desktop + phone; join tailnet; enable Tailscale Serve on the daemon port; confirm localhost-only bind; **add the ACL restricting the daemon port to your own devices/tag; confirm `funnel` is never used.**
- **Register passkeys** (Windows Hello/TPM + iPhone Face ID) against the **full-host RP-ID** and **commit the public keys to `governance/`** (agents cannot — branch-protected).
- **Add-to-Home-Screen** the PWA on iPhone (no auto-install prompt on iOS).
- **Approve the card-schema changes** (governance is human-edited): add the `sessionId` join field; add `stop-requested`/`halting`/`halted` states and the `## Feedback` convention; add cadence-`paused` overlay semantics + the `main`-vs-`ops` split (HEARTBEAT stays on `main`); **confirm the `content_hash` preimage covers action + risk-tier + owner + target.**
- **Run `claude setup-token`** and provision `CLAUDE_CODE_OAUTH_TOKEN` to the Broker's env (a T4 credential act — agents never handle it); confirm `ANTHROPIC_API_KEY` stays unset; **confirm this token is NOT present in the PTY child's environment.**
- **Set tier policy:** which risk tiers may be approved via the weak Telegram/ntfy channel vs. WebAuthn-dashboard-only (recommend T3 = dashboard-only).
- **Decide hook-trust posture** (installing fleet-wide hooks touches session settings) and confirm the fire-and-forget/STOP-aware contract — or defer hooks entirely (file-watch suffices).
- **Sign off / security-review gate** that the embedded terminal and vibe-code sessions run as **constrained** fleet identities (branch + approval + WebAuthn gates still bind), and approve the merge of dashboard code — with the **WebAuthn verifier and Broker passing an explicit security/threat review** per §6.
- **Re-verify SDK-on-subscription ToS at build time** (§3.7) before committing to the Broker; accept the CLI-subprocess fallback.
- Confirm acceptance of "no dashboard when signed out" (vs. a SYSTEM service, which would break the git-credential/Windows-Hello model).
- (If Cloudflare chosen over Tailscale) create the Tunnel + Access app + IdP.

---

## 7. Open questions for Daniel

1. **Interaction model:** confirm **B** (Hybrid Workbench), and the default landing view.
2. **Hooks in v1, or file-watch only?** File-watch keeps agents fully decoupled at ~1–2s latency; hooks cut latency but touch every session's settings. Lean: file-watch first, hooks opt-in.
3. **Passkey posture:** device-bound (Windows Hello/TPM — stronger, re-enroll on device loss) vs. iCloud/Google-synced (more convenient, leaves hardware). **Recommend device-bound for the approval signer specifically** (a synced passkey means an Apple/Google account compromise can forge approvals — outside the "no key to forge" claim); synced acceptable for read-only phone use. If synced is chosen for the signer, accept that as a documented residual risk.
4. **RP-ID stability:** the **full** `*.ts.net` hostname must stay pinned or passkeys break (pin the full host, never the `ts.net` suffix — suffix pinning enables cross-node phishing on a shared tailnet). Also register a separate `localhost` credential for desktop-direct use? (Different RP-ID = separate passkey.)
5. **Terminal + PTY identity:** even inside the tailnet a live PTY is the crown jewel. The design now **requires** the PTY to run under a constrained fleet identity (no push cred / no OAuth token) behind a WebAuthn step + short TTL, audited — confirm this posture (it is no longer "or trust the tailnet"). Explicit review gate before v2.
6. **Maintenance language:** Node/TS is recommended (best Windows PTY + WebAuthn story; note node-pty's native-build/ABI pinning). Confirm the fleet is comfortable maintaining a TS daemon and a light fork of `claude-view`'s parsing rather than its Rust core.
7. **Broker scope:** confirmed **hard boundary** — only Broker-spawned SDK sessions are gracefully steerable; interactive TTY, headless `-p`, and cloud Routines are kill-only (Cloud Routines are git-polled, transcripts not local → "fine live-watch is desktop-only"). Confirm acceptance.
8. **Escalation ladder:** worst-case time before `stop-requested` auto-escalates to `interrupt()` then SIGKILL — pick the timeout (also used by the Broker's STOP-drain, §3.1).
9. **Structured skill forms (Option-A flavor):** worth the per-skill schema debt for the highest-traffic skills, or lean entirely on CodeMirror text editing?
10. **Trace retention:** committing full transcripts under `traces/` grows the repo fast — distilled-vs-raw + GC policy needed (shared with Flight Recorder).
11. **OAuth token lifecycle + rate-limit ceiling:** `CLAUDE_CODE_OAUTH_TOKEN` expiry/rotation becomes a fleet-availability dependency — needs a refresh chore; the Broker must degrade gracefully, never silently fall back to `ANTHROPIC_API_KEY`. **Separately, subscription rate-limit quota (5-hour/weekly caps) — not dollars — is the real scarce resource** a Broker + vibe-code box consume continuously; set a quota-exhaustion watch.
12. **Billing-pause reversal + SDK ToS:** the paused metering change could return, **and** SDK-on-subscription for a persistent Broker sits on the ambiguous "individual use vs. product/service" ToS line (§3.7). Accept designing both vibe-code and Broker to degrade to subscription-interactive-only, keeping the CLI-subprocess fallback, and **re-verify ToS at build time** before the Broker ships?

---

## 8. Review changelog (panel findings → disposition)

Security lens: S1–S12. Feasibility lens: F1–F8. All BLOCKER/MAJOR fixed; all MINORs applied (cheap).

- **S1 (BLOCKER) Broker socket + non-approval actions unauthenticated** → FIXED. §3.1 authenticates the socket per-connection (peer-cred + per-boot dispatcher-issued token); §3.6 requires a WebAuthn-backed session for steering/save/PTY. §3-preamble states localhost/tailnet is not a trust boundary.
- **S2 (BLOCKER) vibe-code chat box = unauthenticated RCE** → FIXED. §2 preamble, §3.6, §5-v1, §6 gate the chat box behind the WebAuthn session + rate-limit + audit.
- **S3 (MAJOR) "compromised dashboard can't forge" false (WYSIWYS)** → FIXED. §3.5 withdraws the claim, adds out-of-band dispatcher push confirmation + corroborable challenge step + pinned-hash execute, and states the residual mis-sign risk honestly.
- **S4 (MAJOR) verification omits WebAuthn assertion checks** → FIXED. §3.5 step 4 now verifies UV=1, UP=1, rpIdHash, monotonic sign-counter, plus origin/signature/freshness.
- **S5 (MAJOR) PTY "as Daniel's user" vs "ordinary fleet identity" + credential ceiling** → FIXED. §3.3 resolves to a constrained fleet identity (no push cred, no OAuth token in env), WebAuthn+TTL gate, and scopes the "one enforcement point" claim honestly (PTY is a deliberate escape hatch contained by identity+gate+audit).
- **S6 (MAJOR) localhost+Serve needs Origin/Host validation** → FIXED. §3.6 validates Origin/Host on every request + WS upgrade, adds CSRF/WS-origin checks, names DNS-rebinding.
- **S7 (MINOR) TOCTOU verify→execute** → FIXED. §3.5 pins to the exact committed object hash and executes against pinned content.
- **S8 (MINOR) content_hash scope** → FIXED. §3.5 defines the preimage as the full canonicalized payload incl. risk-tier/owner/target; §6 human-action confirms.
- **S9 (MINOR) Serve-vs-Funnel + whole-tailnet exposure** → FIXED. §3.4 adds never-funnel guardrail, startup assertion, and a device-scoped ACL.
- **S10 (MINOR) STOP-honoring not mechanized** → FIXED. §3.1 specifies an active STOP file-watch that drains/kills live handles.
- **S11 (MINOR) synced passkey widens trust boundary + RP-ID suffix** → FIXED. §3.5 + Q3/Q4 prefer device-bound signer (or documented residual) and pin RP-ID to the full host.
- **S12 (MINOR) no rate-limit/lockout/independent audit** → FIXED. §3.5 + §6 add throttling, lockout, and a git-committed append-only audit independent of dashboard logs.
- **F1 (MAJOR) SDK-on-subscription presented as resolved** → FIXED. §3.7 downgraded to open governance risk, contingent on build-time ToS re-verification, CLI-subprocess fallback retained.
- **F2 (MAJOR) Broker folded into a panel bullet** → FIXED. §6 splits the Broker into its own High-effort line and names it a fleet-wide re-architecture; §4 makes "graceful = Broker-spawned only" a hard boundary.
- **F3 (MAJOR) WebAuthn verifier labeled routine agent-buildable** → FIXED. §3.5 + §6 carve it out as High-effort human-reviewed security work with a design/threat-review gate; §5 makes control-ship contingent on it.
- **F4 (MINOR→MAJOR) "watch an agent think live" oversells JSONL granularity** → FIXED. §1/§3.3/§5 qualify to message-granular (~1–2s); token-stream reserved for the v2 Broker.
- **F5 (MINOR) fork_session is a resume option, not a verb** → FIXED. §4 table + ladder describe it as resume with `fork_session=true`.
- **F6 (MINOR) stop_task scope narrower than implied** → FIXED. §4 table notes stop_task only for in-session background tasks; else process-group kill.
- **F7 (MINOR) "$0 cost" hides rate-limit quota draw** → FIXED. §3.7 + Q11 flag subscription rate-limit caps as the real scarce resource.
- **F8 (MINOR) node-pty Windows native-build friction** → FIXED. §3.2 notes prebuild/toolchain/ABI and pins the daemon Node version.

No findings rebutted — all were accepted and applied. Nothing unresolved that requires a rebuttal appendix.
