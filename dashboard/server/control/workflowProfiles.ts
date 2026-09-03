/**
 * The server-owned workflow tool-allowlist profiles, as a LEAF module: types and one module-level
 * literal, with zero imports. (It is `readonly` to the type system, not `Object.freeze`d at runtime —
 * every consumer copies out of it, and no code path mutates it.)
 *
 * It has no filesystem, no registry, and no control-plane dependency ON PURPOSE. Two processes read
 * this table and they do not share a repo: the dashboard (which resolves the cap it approves) and the
 * kb-shell PTY broker (which re-resolves from the `toolPolicyId` NAME the launch recipe carries). The
 * broker payload is a compiled bundle with no repo access, so anything this module imported would
 * either have to be bundled too or would throw at broker start-up. Keeping it importless is what lets
 * both sides read one table instead of two, and two hand-written tables that disagree is exactly the
 * defect this module was extracted to end.
 *
 * WHAT THE RE-RESOLVED CAP BECOMES DIFFERS BY LAUNCHER, and it matters:
 *   - claude: `allowedTools` is joined into the child's `--allowedTools` argv, so the broker's copy of
 *     the profile has to reproduce the dashboard's byte for byte or `createAttemptToolPolicyIdResolver`
 *     refuses the launch. The tool cap IS the profile.
 *   - codex: the CLI takes no per-tool allowlist, so `allowedTools` never reaches codex argv. Each
 *     launcher uses the profile for two things only — the id must name a server-owned profile at all,
 *     and the profile's tools decide the codex `-s`/`sandbox_mode` (`codexSandboxMode` below, read by
 *     `buildBrokerLaunch` in pty/fdPinnedPaths.ts on Linux and `mapWindowsLaunchRecipe` in
 *     pty/launcherProfiles.ts on Windows). A codex worker is capped by the sandbox, not by a tool
 *     list, so that derivation lives HERE, in the one module both launchers already read, and not
 *     beside either of them.
 *
 * D13/D15 — these are the forward-looking capability caps a spawned worker is launched with. They are
 * SERVER-OWNED data (a code-reviewed change adds one) and a workflow definition can only NAME a
 * profile, never widen it.
 *
 * INVARIANT: no default profile grants a publish/send capability — never `upload_video`, never a
 * send-mail tool. Gmail reach is read/search/label/DRAFT only; email is never sent from a workflow.
 */
export interface WorkflowExecutionProfile {
  id: string;
  /** The closed `--allowedTools` set a worker on this profile may use. */
  allowedTools: readonly string[];
}

/** Tools a workflow worker may NEVER be granted through any default profile (external publish/send). */
export const FORBIDDEN_WORKFLOW_TOOLS: readonly string[] = [
  'upload_video',
  'mcp__google-workspace__send_email',
  'mcp__google-workspace__gmail_send',
  'mcp__claude_ai_Gmail__send_message',
];

/**
 * The `--permission-mode` every workflow profile launches under, in ONE place. `createWorkflowToolPolicyResolver`
 * (control/claudeLaunchPolicy.ts) uses it as its default and the Linux broker's recipe table reads it
 * directly, so the two sides cannot drift into launching the same profile under different modes —
 * which `createAttemptToolPolicyIdResolver` would then refuse, grounding every launch.
 */
export const WORKFLOW_PERMISSION_MODE = 'default';

export const WORKFLOW_EXECUTION_PROFILES: readonly WorkflowExecutionProfile[] = [
  {
    id: 'checker-readonly',
    allowedTools: ['Read', 'Glob', 'Grep'],
  },
  {
    id: 'research',
    allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'],
  },
  {
    id: 'gmail-triage',
    allowedTools: [
      'mcp__google-workspace__search_gmail_messages',
      'mcp__google-workspace__get_gmail_message_content',
      'mcp__google-workspace__list_gmail_labels',
      'mcp__google-workspace__modify_gmail_message_labels',
      'mcp__google-workspace__draft_gmail_message',
      'Read',
      'Write',
    ],
  },
  {
    id: 'drive-author',
    allowedTools: [
      'mcp__google-workspace__search_drive_files',
      'mcp__google-workspace__get_drive_file_content',
      'mcp__google-workspace__create_drive_file',
      'mcp__google-workspace__upload_to_drive',
      'Read',
      'Write',
    ],
  },
  {
    id: 'producer',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  },
  {
    // C1 (2026-07-21) — read-only scan class: Read/Glob/Grep to inspect + one Write for the report.
    // NO Bash (removes the git-plumbing object-store bypass entirely) and NO Edit. This is exactly the
    // capability self-lint-report.md already tells the worker to use. See
    // docs/specs/2026-07-21-worker-read-scope-design.md §5.3.
    id: 'scanner',
    allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
  },
];

/**
 * The codex sandbox mode a profile launches under, DERIVED from its tools rather than hardcoded.
 * `recipe.sandbox` on the wire is the frame's launcher DISCRIMINATOR (`codex-workspace-write`) and has
 * never been read as a mode, so the `-s workspace-write` literal both launchers used to carry made
 * `checker-readonly` and `producer` produce byte-identical argv: a review stage whose work order says
 * "Read only. Never edit the artifact" launched with unattended write and command execution across the
 * worktree, held read-only by prose alone. Codex takes no `--allowedTools`, so the sandbox is the ONLY
 * place a codex worker's cap can be expressed — this is the codex half of what `--allowedTools` does
 * for claude.
 *
 * A profile granting none of Bash/Write/Edit cannot write or execute, so it launches `read-only`;
 * anything else launches `workspace-write`. `danger-full-access` is never emitted under any
 * circumstance: it is unreachable from this function by construction, and it must stay that way.
 *
 * ONE definition, deliberately: the Linux broker (pty/fdPinnedPaths.ts) and the Windows launcher
 * (pty/launcherProfiles.ts) both import it from here. A second copy beside either of them is exactly
 * the drift this leaf module exists to end — and it is a pure function over a string array, so hosting
 * it here costs the module none of its zero imports.
 */
const WRITE_CAPABLE_TOOLS: readonly string[] = ['Bash', 'Write', 'Edit'];

export function codexSandboxMode(allowedTools: readonly string[]): 'read-only' | 'workspace-write' {
  return allowedTools.some((tool) => WRITE_CAPABLE_TOOLS.includes(tool))
    ? 'workspace-write'
    : 'read-only';
}

/** The prefix every MCP-server tool name carries; `--tools` names only the CLI's BUILT-IN set. */
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * THE ACTUAL TOOL CAP for a claude worker, as argv.
 *
 * `--allowedTools` is a PROMPT-SUPPRESSION list, not an allowlist: it says which tool calls skip the
 * permission prompt, and it says nothing about which tools the child is given. Verified on the VM
 * against claude_code_version 2.1.257 - a `scanner` launch (profile `Read, Glob, Grep, Write`) came up
 * with 68 tools in its `system/init` event, Bash/Edit/Task/WebFetch/WebSearch among them, and the
 * worker then called Bash three times with an empty `permission_denials`. The cap the profile table
 * describes, and that docs/specs/2026-07-21-worker-read-scope-design.md section 5.3 designed ("No
 * Bash, no Edit ... removing Bash removes the git-plumbing bypass entirely"), was never applied.
 *
 * `--tools` is the flag that applies it. From the installed CLI's own help:
 *   `--tools <tools...>   Specify the list of available tools from the built-in set. Use "" to
 *                         disable all tools, "default" to use all tools, or specify tool names
 *                         (e.g. "Bash,Edit,Read").`
 * It is stated as the SET of available tools, so it is an allowlist and not an exclusion list - which
 * is why it is preferred over `--disallowedTools`: an exclusion list cannot name a tool a future CLI
 * release adds, and the 68-tool init above is exactly what such a list would keep missing.
 *
 * MCP tools are NOT in the built-in set, so `--tools` cannot cap them and they are filtered out of its
 * value. A profile that names no `mcp__*` tool therefore also gets `--strict-mcp-config`:
 *   `--strict-mcp-config   Only use MCP servers from --mcp-config, ignoring all other MCP
 *                          configurations`
 * Neither launcher passes `--mcp-config`, so on that reading of the help text "only the servers from
 * --mcp-config" is the empty set and the child loads no MCP server - which would remove the
 * `mcp__claude_ai_Gmail__send_message` and `mcp__claude_ai_Google_Drive__trash_file` reach the same
 * init event listed. THAT REMOVAL IS EXPECTED, NOT YET OBSERVED: `claude --tools Read,Glob
 * --strict-mcp-config --version` on the VM proves only that the flags parse. The acceptance criterion
 * is the post-deploy `system/init` event - its `tools` array must shrink to exactly the profile and
 * carry no `mcp__*` entry. A profile that DOES name MCP tools (gmail-triage, drive-author) still needs
 * its servers loaded, so it does not get the flag, and its MCP surface stays capped by `--allowedTools`
 * alone; narrowing that is a follow-up that needs a per-profile `--mcp-config`, not a line here.
 *
 * `--allowedTools` stays alongside on purpose: the capped tools still have to be pre-approved or the
 * child prompts for every call and a headless worker hangs on the prompt.
 */
export function toolCapArgv(allowedTools: readonly string[]): string[] {
  const builtIn = allowedTools.filter((tool) => !tool.startsWith(MCP_TOOL_PREFIX));
  // `--allowedTools` accepts a SCOPING form (`Bash(git *)`); `--tools` names built-in tools and nothing
  // else, so a scoped entry would land in the cap as a tool name that matches nothing. `isWellFormedToolName`
  // permits parentheses, so this is the only place that catches it - and it fails closed rather than
  // shipping a cap whose meaning depends on how the CLI treats an unknown name.
  const scoped = builtIn.find((tool) => tool.includes('(') || tool.includes(')'));
  if (scoped !== undefined) {
    throw new Error(
      `refusing to spawn a worker: profile tool '${scoped}' is an --allowedTools scoping form, not a built-in tool name`,
    );
  }
  // An all-MCP profile would join to '', the help's "disable all tools" value. Refuse instead: no
  // server-owned profile is shaped that way today, and a cap whose correctness rests on the CLI's
  // handling of an empty option value is not a cap we can verify.
  if (builtIn.length === 0) {
    throw new Error(
      'refusing to spawn a worker: the workflow execution profile grants no built-in tool, so no --tools cap can be built',
    );
  }
  const argv = ['--tools', builtIn.join(',')];
  if (builtIn.length === allowedTools.length) argv.push('--strict-mcp-config');
  return argv;
}
