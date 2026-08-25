import { describe, expect, it } from 'vitest';
import type { Deployment } from '../control/types.ts';
import type { DeployReadyCandidate, DeployReadyPort } from '../deploy/contracts.ts';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { decodeDeploymentInboxItem, deployReadyRevision, deploymentItemId } from './deploymentContracts.ts';
import {
  projectDeployReadyItem, projectDeploymentSubjects, projectStoredDeploymentItem, resolveSwapEscalation,
  type CommitAncestryPort, type DeploymentsReaderPort, type LivePtySessionsPort, type LiveReleasePort,
} from './deploymentSubjects.ts';

const TARGET_SHA = 'a'.repeat(40);
const LIVE_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const PTY_A = `pty-${'1'.repeat(32)}`;
const PTY_B = `pty-${'2'.repeat(32)}`;

function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    deploymentRef: 'deployment-1',
    revision: 3,
    targetCommit: TARGET_SHA,
    previousCommit: LIVE_SHA,
    state: 'requested',
    requestedAt: '2026-08-25T00:00:00.000Z',
    parkWarnAt: '2026-08-25T00:01:30.000Z',
    swapDeadlineAt: null,
    fenceRevision: 0,
    drainAcks: {},
    blockers: [],
    progress: { kind: 'idle', attemptRef: null, detail: null, since: null },
    abortRequestedAt: null,
    error: null,
    terminalOutcome: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

function terminalOutcome(kind: 'succeeded' | 'aborted' | 'failed') {
  return { kind, at: '2026-08-25T01:00:00.000Z', by: 'daemon' };
}

const noPty: LivePtySessionsPort = { liveSessionIds: () => [] };

// A store double whose WRITE methods throw. Only `listDeployments` (the declared read port) is ever
// called by the projector — this proves it structurally, not just by absence of imports.
function throwingWriteStore(deployments: readonly Deployment[]): DeploymentsReaderPort & Record<string, unknown> {
  return {
    listDeployments: () => deployments,
    createDeployment: () => { throw new Error('BUG: projector must never write'); },
    transitionDeployment: () => { throw new Error('BUG: projector must never write'); },
  };
}

const nullCandidatePort: DeployReadyPort = { latestCandidate: () => null };
function candidatePort(candidate: DeployReadyCandidate | null): DeployReadyPort {
  return { latestCandidate: () => candidate };
}
function liveReleasePort(sha: string | null): LiveReleasePort {
  return { liveSha: () => sha };
}
function ancestryPort(descendant: boolean): CommitAncestryPort {
  return { isStrictDescendant: () => descendant };
}

describe('projector performs NO store write [P5-C58]', () => {
  const ALL_STATES: Deployment['state'][] = [
    'waiting-confirmation', 'requested', 'parked', 'swapping', 'resuming',
    'succeeded', 'aborted', 'failed', 'acknowledged',
  ];

  it('survives a full projection pass over every stored state with a throwing-write store double', () => {
    const deployments = ALL_STATES.map((state, index) => makeDeployment({
      deploymentRef: `deployment-${index}`,
      revision: index + 1,
      state,
      swapDeadlineAt: state === 'swapping' ? '2020-01-01T00:00:00.000Z' : null,
      terminalOutcome: (['succeeded', 'aborted', 'failed'] as const).includes(state as never)
        ? terminalOutcome(state as 'succeeded' | 'aborted' | 'failed') : null,
      acknowledgedBy: state === 'acknowledged' ? { at: '2026-08-25T02:00:00.000Z', subject: 'operator' } : null,
    }));
    const store = throwingWriteStore(deployments);
    expect(() => projectDeploymentSubjects({
      deployments: store, pty: noPty, deployReady: nullCandidatePort,
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now: new Date('2026-08-25T03:00:00.000Z'),
    })).not.toThrow();
  });

  it('a candidate replaced by a newer sha simply stops being emitted, no store write and no throw', () => {
    const store = throwingWriteStore([]);
    const first = projectDeploymentSubjects({
      deployments: store, pty: noPty, deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now: new Date('2026-08-25T03:00:00.000Z'),
    });
    const newSha = 'd'.repeat(40);
    const second = projectDeploymentSubjects({
      deployments: store, pty: noPty, deployReady: candidatePort({ sha: newSha, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now: new Date('2026-08-25T03:00:01.000Z'),
    });
    expect(first.items.find((i) => i.subject.deploymentRef === `deploy-ready:${TARGET_SHA}`)).toBeDefined();
    expect(second.items.find((i) => i.subject.deploymentRef === `deploy-ready:${TARGET_SHA}`)).toBeUndefined();
    expect(second.items.find((i) => i.subject.deploymentRef === `deploy-ready:${newSha}`)).toBeDefined();
  });
});

describe('blockingPtyIds overrides every other rule in any pre-swap state [P5-C39]', () => {
  const pty: LivePtySessionsPort = { liveSessionIds: () => [PTY_B, PTY_A] };

  it('overrides an already-requested Abort at requested/parked', () => {
    for (const state of ['requested', 'parked'] as const) {
      const item = projectStoredDeploymentItem(
        makeDeployment({ state, abortRequestedAt: '2026-08-25T00:05:00.000Z' }),
        pty,
      );
      expect(item?.blockingPtyIds).toEqual([PTY_A, PTY_B]); // sorted, deduped
    }
  });

  it('populates blockingPtyIds at waiting-confirmation too (a pre-swap state)', () => {
    const item = projectStoredDeploymentItem(makeDeployment({ state: 'waiting-confirmation' }), pty);
    expect(item?.blockingPtyIds).toEqual([PTY_A, PTY_B]);
  });

  it('is empty for swapping/resuming/terminal states even with a nonempty live PTY set', () => {
    for (const state of ['swapping', 'resuming', 'succeeded', 'aborted', 'failed'] as const) {
      const item = projectStoredDeploymentItem(makeDeployment({
        state,
        terminalOutcome: (['succeeded', 'aborted', 'failed'] as const).includes(state as never)
          ? terminalOutcome(state as 'succeeded' | 'aborted' | 'failed') : null,
      }), pty);
      expect(item?.blockingPtyIds).toEqual([]);
    }
  });

  it('is empty by construction on the deploy-ready subject [P5-C59]', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date('2026-08-25T03:00:00.000Z'),
    });
    expect(item?.blockingPtyIds).toEqual([]);
  });
});

describe('swapping past swapDeadlineAt escalates rather than stalling (movement:90,113,164)', () => {
  it('projects no escalation before the deadline', () => {
    const escalation = resolveSwapEscalation(
      makeDeployment({ state: 'swapping', swapDeadlineAt: '2026-08-25T04:00:00.000Z' }),
      new Date('2026-08-25T03:00:00.000Z'),
    );
    expect(escalation).toBeNull();
  });

  it('emits exactly one escalation subject past the deadline, Abort still absent from the item', () => {
    const deployment = makeDeployment({ state: 'swapping', swapDeadlineAt: '2026-08-25T02:00:00.000Z' });
    const now = new Date('2026-08-25T03:00:00.000Z');
    const escalation = resolveSwapEscalation(deployment, now);
    expect(escalation).not.toBeNull();
    expect(escalation?.subject.deploymentRef).toBe('deployment-1');
    expect(escalation?.swapDeadlineAt).toBe('2026-08-25T02:00:00.000Z');

    const result = projectDeploymentSubjects({
      deployments: { listDeployments: () => [deployment] }, pty: noPty, deployReady: nullCandidatePort,
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now,
    });
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.id).toBe(escalation?.id);
  });

  it('resolves to the SAME escalation subject id/revision across two projection passes (deduplicated)', () => {
    const deployment = makeDeployment({ state: 'swapping', swapDeadlineAt: '2026-08-25T02:00:00.000Z' });
    const now = new Date('2026-08-25T03:00:00.000Z');
    const first = resolveSwapEscalation(deployment, now);
    const second = resolveSwapEscalation(deployment, new Date('2026-08-25T03:30:00.000Z'));
    expect(first?.id).toBe(second?.id);
    expect(first?.revision).toBe(second?.revision);
  });

  it('no escalation for resuming, or for swapping with no swapDeadlineAt', () => {
    expect(resolveSwapEscalation(makeDeployment({ state: 'resuming' }), new Date())).toBeNull();
    expect(resolveSwapEscalation(makeDeployment({ state: 'swapping', swapDeadlineAt: null }), new Date())).toBeNull();
  });
});

describe('deploy-ready gate reads its candidate ONLY from DeployReadyPort [P5-C42]', () => {
  it('an injected null candidate projects nothing', () => {
    const item = projectDeployReadyItem({
      deployReady: nullCandidatePort, liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date(),
    });
    expect(item).toBeNull();
  });

  it('requires an available live SHA', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(null), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date(),
    });
    expect(item).toBeNull();
  });

  it('requires a strict-descendant candidate', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(false),
      deployments: { listDeployments: () => [] }, now: new Date(),
    });
    expect(item).toBeNull();
  });

  it('is refused by a non-terminal Deployment', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [makeDeployment({ state: 'parked' })] }, now: new Date(),
    });
    expect(item).toBeNull();
  });

  it('is refused by a terminal-but-unacknowledged Deployment [P5-C35]', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: {
        listDeployments: () => [makeDeployment({ state: 'succeeded', terminalOutcome: terminalOutcome('succeeded') })],
      },
      now: new Date(),
    });
    expect(item).toBeNull();
  });

  it('is admitted once the prior deployment is fully acknowledged', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: {
        listDeployments: () => [makeDeployment({
          state: 'acknowledged', terminalOutcome: terminalOutcome('succeeded'),
          acknowledgedBy: { at: '2026-08-25T02:00:00.000Z', subject: 'operator' },
        })],
      },
      now: new Date(),
    });
    expect(item).not.toBeNull();
  });

  it('projects BOTH breaking variants of the same candidate, differing only in downstream action', () => {
    const green = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date('2026-08-25T03:00:00.000Z'),
    });
    const breaking = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: true }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date('2026-08-25T03:00:00.000Z'),
    });
    expect(green?.state).toBe('deploy-ready');
    expect(breaking?.state).toBe('deploy-ready');
    expect(green?.subject.deploymentRef).toBe(breaking?.subject.deploymentRef);
    expect(green?.revision).toBe(breaking?.revision);
  });

  it('the deploymentRef is the derived deploy-ready:<sha> and is stable across two projection calls [P5-C17]', () => {
    const build = () => projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date('2026-08-25T03:00:00.000Z'),
    });
    const first = build();
    const second = build();
    expect(first?.subject.deploymentRef).toBe(`deploy-ready:${TARGET_SHA}`);
    expect(first?.subject.deploymentRef).toBe(second?.subject.deploymentRef);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(deploymentItemId(`deploy-ready:${TARGET_SHA}`));
  });

  it('revision is the derived deploy-ready:<sha256> and decodes as such, never deployment:<n>', () => {
    const item = projectDeployReadyItem({
      deployReady: candidatePort({ sha: TARGET_SHA, attestationDigest: DIGEST, breaking: false }),
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true),
      deployments: { listDeployments: () => [] }, now: new Date('2026-08-25T03:00:00.000Z'),
    });
    expect(item?.revision).toBe(deployReadyRevision(TARGET_SHA, LIVE_SHA));
  });
});

describe('revision emitted as deployment:<n> for stored records; closed decode round-trips', () => {
  it('a requested Deployment decodes through the W0 closed decoder unchanged', () => {
    const item = projectStoredDeploymentItem(makeDeployment({ revision: 7 }), noPty);
    expect(item?.revision).toBe('deployment:7');
    expect(decodeDeploymentInboxItem(item)).toEqual(item);
  });
});

describe('deterministic ids and sort', () => {
  it('sorts the composed item set by id, stably across repeated calls', () => {
    const deployments = [
      makeDeployment({ deploymentRef: 'deployment-a', revision: 1, state: 'requested' }),
      makeDeployment({ deploymentRef: 'deployment-b', revision: 1, state: 'parked' }),
    ];
    const build = () => projectDeploymentSubjects({
      deployments: { listDeployments: () => deployments }, pty: noPty, deployReady: nullCandidatePort,
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now: new Date('2026-08-25T03:00:00.000Z'),
    });
    const first = build();
    const second = build();
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
    const sorted = [...first.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(first.items.map((i) => i.id)).toEqual(sorted.map((i) => i.id));
  });
});

describe('acknowledged and acknowledged-terminal subjects are absent', () => {
  it('state acknowledged projects nothing', () => {
    const item = projectStoredDeploymentItem(makeDeployment({
      state: 'acknowledged', terminalOutcome: terminalOutcome('succeeded'),
      acknowledgedBy: { at: '2026-08-25T02:00:00.000Z', subject: 'operator' },
    }), noPty);
    expect(item).toBeNull();
  });

  it('a terminal state with acknowledgedBy already set projects nothing (defensive)', () => {
    const item = projectStoredDeploymentItem(makeDeployment({
      state: 'succeeded', terminalOutcome: terminalOutcome('succeeded'),
      acknowledgedBy: { at: '2026-08-25T02:00:00.000Z', subject: 'operator' },
    }), noPty);
    expect(item).toBeNull();
  });

  it('an unacknowledged terminal state still projects (needs Acknowledge)', () => {
    const item = projectStoredDeploymentItem(
      makeDeployment({ state: 'failed', terminalOutcome: terminalOutcome('failed') }),
      noPty,
    );
    expect(item).not.toBeNull();
  });
});

describe('a failed deployment source yields a source-failure row, never a false empty', () => {
  it('a throwing listDeployments returns items:[] with state failed, not a legitimate empty ok', () => {
    const result = projectDeploymentSubjects({
      deployments: { listDeployments: () => { throw new Error('boom'); } },
      pty: noPty, deployReady: nullCandidatePort, liveRelease: liveReleasePort(LIVE_SHA),
      ancestry: ancestryPort(true), now: new Date(),
    });
    expect(result.items).toEqual([]);
    expect(result.state).toEqual({ status: 'failed', errorCode: 'unavailable' });
  });

  it('a genuinely empty store with no candidate is the legitimate ok-empty case', () => {
    const result = projectDeploymentSubjects({
      deployments: { listDeployments: () => [] }, pty: noPty, deployReady: nullCandidatePort,
      liveRelease: liveReleasePort(LIVE_SHA), ancestry: ancestryPort(true), now: new Date(),
    });
    expect(result.items).toEqual([]);
    expect(result.state).toEqual({ status: 'ok' });
  });
});

describe('negative: no run-gate/next-fire/read/snooze/archive field can decode', () => {
  it('the closed decoder refuses an item carrying any Home/Approvals-shaped extra field', () => {
    const base = projectStoredDeploymentItem(makeDeployment(), noPty)!;
    for (const extra of [
      { runGate: true }, { nextFireAt: '2026-08-25T00:00:00.000Z' }, { read: false },
      { snoozedUntil: '2026-08-25T00:00:00.000Z' }, { archived: false },
    ]) {
      expect(() => decodeDeploymentInboxItem({ ...base, ...extra })).toThrow(ContractDecodeError);
    }
  });
});
