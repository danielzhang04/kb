import { useCallback, useEffect, useMemo, useState } from 'react';
import { SESSION_INVALIDATED_EVENT, type Session } from '../lib/authClient';
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
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
}

/** Secondary, exact-revision review for proposals emitted by completed Composer turns. */
export function ProposalReviewPanel({
  composerSession,
  sessionToken,
  onRequestSession,
}: ProposalReviewPanelProps): React.JSX.Element | null {
  const completedTurns = useMemo(
    () => composerSession.turns.filter((turn) => turn.state === 'complete'),
    [composerSession.turns],
  );
  const [localToken, setLocalToken] = useState(sessionToken);
  const [revision, setRevision] = useState<ProposalRevisionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => { if (sessionToken) setLocalToken(sessionToken); }, [sessionToken]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);

  const resolveToken = useCallback(async (): Promise<string | null> => {
    if (sessionToken ?? localToken) return sessionToken ?? localToken ?? null;
    const unlocked = await onRequestSession?.();
    if (!unlocked) return null;
    setLocalToken(unlocked.token);
    return unlocked.token;
  }, [localToken, onRequestSession, sessionToken]);

  const refresh = useCallback(async (token: string): Promise<void> => {
    const items = await listProposalRevisions(composerSession.composerRef, token);
    const latest = items.sort((a, b) => b.revision - a.revision)[0];
    setRevision(latest ? await getProposalRevision(latest.proposalRef, latest.revision, token) : null);
  }, [composerSession.composerRef]);

  useEffect(() => {
    const token = sessionToken ?? localToken;
    if (!token || completedTurns.length === 0) return;
    let alive = true;
    refresh(token).catch(() => { if (alive) setRevision(null); });
    return () => { alive = false; };
  }, [completedTurns.length, localToken, refresh, sessionToken]);

  if (completedTurns.length === 0) return null;

  const run = async (action: (token: string) => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const token = await resolveToken();
      if (!token) throw new Error('Unlock dashboard to review a proposal.');
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
    <details className="control-proposal-review" data-testid="composer-proposal-review">
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
  );
}
