import { buildRoster } from '../agents/roster.ts';
import type { AgentRosterEntry } from '../agents/roster.ts';
import { indexRepo } from '../planeA/indexer.ts';
import { readOrgStates } from '../planeA/states.ts';
import type { OverrideDoc, PolicyDoc } from '../routing/policy.ts';
import { readHeartbeatCadences, SYSTEM_PROJECT } from '../schedules/heartbeat.ts';
import type { HeartbeatCadence } from '../schedules/heartbeat.ts';

export type LivenessStatus = 'working' | 'active' | 'stale' | 'idle';

export interface AgentHealth {
  id: string;
  role: string | null;
  status: LivenessStatus;
  live: boolean;
  working: boolean;
  lastActive: string | null;
}

export interface OrgHealth {
  project: string;
  now: string;
  blocked: boolean;
  cadences: HeartbeatCadence[];
}

export interface HealthPanel {
  asOf: string;
  stalenessDays: number;
  agents: AgentHealth[];
  orgs: OrgHealth[];
  systemCadences: HeartbeatCadence[];
  cadenceCount: number;
  liveCount: number;
}

function isBlocked(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  return !/^\(?\s*(nothing|none|n\/?a|-|—)\b/i.test(trimmed);
}

function dayDiff(from: string, to: string): number {
  const fromDate = Date.parse(`${from}T00:00:00Z`);
  const toDate = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate) || Number.isNaN(toDate)) return Number.POSITIVE_INFINITY;
  return Math.round((fromDate - toDate) / 86_400_000);
}

function livenessOf(entry: AgentRosterEntry, asOf: string, stalenessDays: number): LivenessStatus {
  if (entry.working) return 'working';
  const lastActive = entry.ledger.lastActive;
  if (lastActive === null) return 'idle';
  return dayDiff(asOf, lastActive) <= stalenessDays ? 'active' : 'stale';
}

/** Build the retained fleet projection directly from roster, ledger, STATE, and cadence readers. */
export function buildHealthPanel(
  repoRoot: string,
  policy: PolicyDoc,
  override: OverrideDoc,
  options: { asOf?: string; stalenessDays?: number } = {},
): HealthPanel {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const stalenessDays = options.stalenessDays ?? 2;
  const roster = buildRoster(indexRepo(repoRoot), repoRoot, policy, override);
  const agents: AgentHealth[] = roster.map((entry) => {
    const status = livenessOf(entry, asOf, stalenessDays);
    return {
      id: entry.id,
      role: entry.role,
      status,
      live: status === 'working' || status === 'active',
      working: entry.working,
      lastActive: entry.ledger.lastActive,
    };
  });

  const cadences = readHeartbeatCadences(repoRoot);
  const orgs: OrgHealth[] = readOrgStates(repoRoot).map((state) => ({
    project: state.project,
    now: state.now,
    blocked: isBlocked(state.blocked),
    cadences: cadences.filter((cadence) => cadence.project === state.project),
  }));

  return {
    asOf,
    stalenessDays,
    agents,
    orgs,
    systemCadences: cadences.filter((cadence) => cadence.project === SYSTEM_PROJECT),
    cadenceCount: cadences.length,
    liveCount: agents.filter((agent) => agent.live).length,
  };
}
