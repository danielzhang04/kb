import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../lib/sessionContext';
import type { TimelineModel } from '../lib/timelineModel';
import type { ComposerSession } from '../composer/workspaceClient';
import {
  decideProposalRevision,
  getProposalRevision,
  importProposal,
  launchProposalRevision,
  listProposalRevisions,
  type ProposalDecision,
  type ProposalRevisionDto,
} from './controlClient';
import { ProposalCard } from './ProposalCard';

export interface ProposalReviewPanelProps {
  composerSession: ComposerSession;
}

/** Display-only cue that the assistant emitted a proposal block. The server's import route is the
 *  authoritative parser; this only decides whether to surface the "proposal ready" banner. */
function hasProposalFence(model: TimelineModel | null): boolean {
  if (!model) return false;
  return model.turns.some((turn) =>
    turn.steps.some((step) => step.kind === 'text' && typeof step.text === 'string'
      && step.text.includes('```kb.plan-proposal/v1')),
  );
}

/** Secondary, exact-revision review for proposals emitted by completed Composer turns. */
export function ProposalReviewPanel({
  composerSession,
}: ProposalReviewPanelProps): React.JSX.Element | null {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const completedTurns = useMemo(
    () => composerSession.turns.filter((turn) => turn.state === 'complete'),
    [composerSession.turns],
  );
  const [revision, setRevision] = useState<ProposalRevisionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const proposalReady = useMemo(
    () => hasProposalFence(completedTurns.at(-1)?.model ?? null),
    [completedTurns],
  );

  const refresh = useCallback(async (token: string): Promise<void> => {
    const items = await listProposalRevisions(composerSession.composerRef, token);
    const latest = items.sort((a, b) => b.revision - a.revision)[0];
    setRevision(latest ? await getProposalRevision(latest.proposalRef, latest.revision, token) : null);
  }, [composerSession.composerRef]);

  useEffect(() => {
    if (!sessionToken || completedTurns.length === 0) return;
    let alive = true;
    refresh(sessionToken).catch(() => { if (alive) setRevision(null); });
    return () => { alive = false; };
  }, [completedTurns.length, refresh, sessionToken]);

  if (completedTurns.length === 0) return null;

  const run = async (action: (token: string) => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const token = (await requireSession())?.token;
      if (!token) throw new Error('The dashboard is locked — the proposal was not touched.');
      await action(token);
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : 'Proposal action failed.');
    } finally {
      setBusy(false);
    }
  };

  const compileLatest = (): void => {
    const turn = completedTurns.at(-1)!;
    void run(async (token) => {
      const next = await importProposal({
        composerRef: composerSession.composerRef,
        turnId: turn.turnId,
        ...(revision ? { proposalRef: revision.proposalRef, expectedPreviousHash: revision.contentHash } : {}),
      }, token);
      setRevision(next);
      setOutcome(`Compiled immutable revision ${next.revision}.`);
    });
  };

  const decide = (decision: ProposalDecision): void => {
    if (!revision) return;
    void run(async (token) => {
      setRevision(await decideProposalRevision(revision.proposalRef, revision.revision, {
        expectedHash: revision.contentHash,
        expectedApprovalRevision: 0,
        decision,
        idempotencyKey: `proposal:${revision.contentHash}:${decision}`,
      }, token));
      setOutcome(`Exact revision ${decision}.`);
    });
  };

  const launch = (): void => {
    if (!revision) return;
    void run(async (token) => {
      const result = await launchProposalRevision(revision.proposalRef, revision.revision, {
        expectedHash: revision.contentHash,
        idempotencyKey: `launch:${revision.contentHash}`,
      }, token);
      setOutcome(result.waitingHuman
        ? `Run ${result.runRef} created and waiting for human review.`
        : `Governed run ${result.runRef} started.`);
    });
  };

  return (
    <>
      {proposalReady ? (
        <div className="control-proposal-banner" data-testid="composer-proposal-banner" role="status">
          <span>
            {revision
              ? 'The conversation emitted a proposal. Recompile to capture the latest revision, then review and launch.'
              : 'The conversation is ready — a plan proposal was emitted. Review it to route this idea into the governed pipeline.'}
          </span>
          <button
            type="button"
            className="mc-btn"
            onClick={() => {
              if (detailsRef.current) {
                detailsRef.current.open = true;
                detailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          >
            Review &amp; launch
          </button>
        </div>
      ) : null}
    <details className="control-proposal-review" data-testid="composer-proposal-review" ref={detailsRef}>
      <summary>Review compiled proposal{revision ? ` · revision ${revision.revision}` : ''}</summary>
      <div className="control-proposal-review__body">
        <p className="control-help">
          Proposal blocks are treated as untrusted data and validated on the server. Approval and launch bind to one exact hash.
        </p>
        <button type="button" className="mc-btn" disabled={busy} onClick={compileLatest}>
          {revision ? 'Compile latest completed turn as new revision' : 'Compile latest completed turn'}
        </button>
        {revision ? <ProposalCard revision={revision} busy={busy} onDecision={decide} onLaunch={launch} /> : (
          <p className="control-help">No validated proposal is linked to this conversation yet.</p>
        )}
        {outcome ? <p role="status" className="control-proposal-review__outcome">{outcome}</p> : null}
      </div>
    </details>
    </>
  );
}
