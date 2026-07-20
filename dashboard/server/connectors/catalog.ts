/**
 * External-reach connector catalog — DESIGN SCAFFOLD (docs/specs/2026-07-20-external-reach-design.md §5).
 *
 * NOT WIRED. This module is pure, frozen, credential-free data plus a small pure query surface. It
 * declares which external capabilities exist, which tool-name prefixes / scripts implement them, and
 * which human OAuth gate cards must reach `queue/done/` before each can function. It has no filesystem,
 * network, or credential code path — by the AUTH INVARIANT (design §2.1) a connector declares *tool
 * names*, never a token.
 *
 * The reason this exists as data rather than living only in environment.ts: it makes the
 * profile→server→gate dependency machine-checkable (see catalog.test.ts), which turns two whole
 * classes of latent bug (a profile naming an unregistered server; a send/publish tool sneaking into a
 * profile) into test failures instead of silent runtime capability substitution.
 *
 * Wiring this (preflight, run-start gating) is increments 2–3 of the staged plan; the worker-side
 * allowlist reconnection (the actual severed wire) is increment 1 and lives in the control plane.
 */

export type ConnectorTransport = 'mcp-stdio' | 'script';

export interface ExternalConnector {
  readonly id: 'google-workspace' | 'youtube-uploader' | 'youtube-analytics';
  readonly transport: ConnectorTransport;
  /**
   * For `mcp-stdio`: the tool-name prefix every tool this connector provides shares
   * (e.g. `mcp__google-workspace__`). For `script`: the repo-relative script path.
   */
  readonly handle: string;
  /** Workflow-profile ids (environment.ts WORKFLOW_EXECUTION_PROFILES) this connector's tools serve. */
  readonly serves: readonly string[];
  /**
   * Gate card ids (queue/ cards on `ops`) that must reach `done` before this connector can function.
   * See docs/plans/2026-07-20-arc2-HANDOFF.md "Human gates waiting on Daniel".
   */
  readonly requiredGates: readonly string[];
  /** What to tell the operator when preflight finds this connector unavailable — names the missing gate. */
  readonly notAuthedHint: string;
}

/** Gate card ids, from queue/inbox on `ops` (arc-2 handoff). G1 is the root of all Google reach. */
export const GATE_G1_GCP_PROJECT = '6a5d6b23-12ddfee2';
export const GATE_G2_WORKSPACE_OAUTH = '6a5d6b23-05204b15';
export const GATE_G3_YOUTUBE_UPLOADER = '6a5d6b23-4c98aec0';
export const GATE_G4_YOUTUBE_ANALYTICS = '6a5d6b23-17e8d1be';

/**
 * The closed connector catalog. Frozen data; adding a connector is a code-reviewed capability change,
 * exactly like adding a workflow profile. A workflow definition can never introduce a connector.
 */
export const EXTERNAL_CONNECTORS: readonly ExternalConnector[] = Object.freeze([
  {
    id: 'google-workspace',
    transport: 'mcp-stdio',
    handle: 'mcp__google-workspace__',
    // gmail-triage + drive-author ship today; calendar-read + meeting-notes are IR-2 (increment 4).
    serves: ['gmail-triage', 'drive-author', 'calendar-read', 'meeting-notes'],
    requiredGates: [GATE_G1_GCP_PROJECT, GATE_G2_WORKSPACE_OAUTH],
    notAuthedHint:
      'Google Workspace MCP not available. Complete gate G1 (6a5d6b23-12ddfee2: GCP project + APIs + ' +
      'PUBLISH consent screen) then G2 (6a5d6b23-05204b15: uvx workspace-mcp OAuth + claude mcp add). ' +
      'Until then the mcp__google-workspace__* tools do not resolve.',
  },
  {
    id: 'youtube-analytics',
    transport: 'script',
    handle: 'scripts/yt_analytics.py',
    serves: ['producer'],
    requiredGates: [GATE_G1_GCP_PROJECT, GATE_G4_YOUTUBE_ANALYTICS],
    notAuthedHint:
      'YouTube Analytics token absent. Complete gate G1 then G4 (6a5d6b23-17e8d1be: ' +
      'py -3 scripts/yt_analytics.py --auth). The script exits NOT_AUTHED (code 3) until then.',
  },
  // NOTE: youtube-uploader (publish) is deliberately NOT served by any workflow profile. upload_video
  // is in FORBIDDEN_WORKFLOW_TOOLS (environment.ts) and publishing cannot happen inside a workflow run
  // at all (design §4.3). It is catalogued here only so preflight can report its gate status; `serves`
  // is intentionally empty.
  {
    id: 'youtube-uploader',
    transport: 'mcp-stdio',
    handle: 'mcp__youtube-uploader-mcp__',
    serves: [],
    requiredGates: [GATE_G1_GCP_PROJECT, GATE_G3_YOUTUBE_UPLOADER],
    notAuthedHint:
      'YouTube uploader never authenticated. Gate G3 (6a5d6b23-4c98aec0). Publishing is human-only and ' +
      'never reachable from a workflow regardless of auth.',
  },
]);

/** The connector whose tools serve a given workflow profile id, or null if the profile is local-only. */
export function connectorForProfile(profileId: string): ExternalConnector | null {
  return EXTERNAL_CONNECTORS.find((connector) => connector.serves.includes(profileId)) ?? null;
}

/** Every distinct gate card id any catalogued connector depends on. */
export function allRequiredGates(): string[] {
  return [...new Set(EXTERNAL_CONNECTORS.flatMap((connector) => connector.requiredGates))].sort();
}

/** The mcp-stdio tool-name prefixes the catalog knows about (used to detect orphan tools in tests). */
export function knownMcpToolPrefixes(): string[] {
  return EXTERNAL_CONNECTORS.filter((connector) => connector.transport === 'mcp-stdio').map(
    (connector) => connector.handle,
  );
}
