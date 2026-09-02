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
 *   - codex: the CLI takes no per-tool allowlist, so `allowedTools` never reaches codex argv. The
 *     broker uses the profile for two things only — the id must name a server-owned profile at all,
 *     and the profile's tools decide the codex `-s`/`sandbox_mode` (see `buildBrokerLaunch` in
 *     pty/fdPinnedPaths.ts). A codex worker is capped by the sandbox, not by a tool list.
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
