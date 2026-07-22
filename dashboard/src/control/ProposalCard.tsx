import type { ProposalDecision, ProposalRevisionDto, ResolvedAgentAssignmentDto } from './controlClient';
import { ProposalDiff } from './ProposalDiff';
import './control.css';

export interface ProposalCardProps {
  revision: ProposalRevisionDto;
  busy?: boolean;
  onDecision?: (decision: ProposalDecision) => void | Promise<void>;
  onLaunch?: () => void | Promise<void>;
}

function logicalAssignment(assignment: ResolvedAgentAssignmentDto | null | undefined): string {
  return assignment ? `${assignment.agentId} · ${assignment.profileId}` : 'unassigned';
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

export function ProposalCard({ revision, busy = false, onDecision, onLaunch }: ProposalCardProps) {
  const { proposal, approval } = revision;
  const decided = approval !== null;
  const approved = approval?.decision === 'approved';

  return (
    <article className="control-proposal mc-panel" aria-label={`Proposal ${proposal.title}`}>
      <header className="control-proposal__head">
        <div>
          <p className="control-eyebrow">Compiled proposal · revision {revision.revision}</p>
          <h2>{proposal.title}</h2>
          <p>{proposal.summary}</p>
        </div>
        <span className={`control-state control-state--${approval?.decision ?? 'review'}`}>
          {approval?.decision ?? 'needs review'}
        </span>
      </header>

      <dl className="control-facts">
        <div><dt>Project</dt><dd className="mc-mono">{proposal.project}</dd></div>
        <div><dt>Manager executor</dt><dd className="mc-mono">{proposal.manager.runtime} · {proposal.manager.model}</dd></div>
        <div><dt>Logical assignment</dt><dd className="mc-mono">{logicalAssignment(proposal.manager.assignment)}</dd></div>
        <div><dt>Exact hash</dt><dd><code title={revision.contentHash}>{shortHash(revision.contentHash)}</code></dd></div>
        <div><dt>Governance</dt><dd>{proposal.governanceRefs.join(', ')}</dd></div>
      </dl>

      <section aria-labelledby={`proposal-${proposal.proposalId}-stages`}>
        <h3 id={`proposal-${proposal.proposalId}-stages`}>Stages ({proposal.stages.length})</h3>
        <ol className="control-proposal__stages">
          {proposal.stages.map((stage) => (
            <li key={stage.id}>
              <div className="control-proposal__stage-head">
                <strong>{stage.title}</strong>
                <span className={`mc-badge mc-badge--${stage.riskTier.toLowerCase()}`}>{stage.riskTier}</span>
              </div>
              <span>Executor <span className="mc-mono">{stage.worker.runtime} · {stage.worker.model}</span></span>
              <span>Logical assignment <span className="mc-mono">{logicalAssignment(stage.assignment)}</span></span>
              <span>{stage.action} → {stage.target}</span>
              <span>{stage.dependsOn.length ? `After ${stage.dependsOn.join(', ')}` : 'No dependencies'}</span>
              {stage.humanGates.length ? <span>{stage.humanGates.length} human gate(s)</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {revision.diff ? <ProposalDiff diff={revision.diff} /> : (
        <p className="control-diff__empty">Diff is unavailable after reload; review the complete immutable snapshot and exact hash.</p>
      )}

      <p className="control-proposal__chat-note">
        Continue planning in Composer to change this proposal. Any material change creates a new hash and requires a new review.
      </p>
      <div className="control-actions" aria-label="Proposal actions">
        <button type="button" className="mc-btn mc-btn--primary" disabled={busy || decided || !onDecision} onClick={() => void onDecision?.('approved')}>
          Approve exact revision
        </button>
        <button type="button" className="mc-btn" disabled={busy || decided || !onDecision} onClick={() => void onDecision?.('changes-requested')}>
          Request changes
        </button>
        <button type="button" className="mc-btn" disabled={busy || decided || !onDecision} onClick={() => void onDecision?.('rejected')}>
          Reject
        </button>
        <button type="button" className="mc-btn mc-btn--primary" disabled={busy || !approved || !onLaunch} onClick={() => void onLaunch?.()}>
          Start governed run
        </button>
      </div>
    </article>
  );
}
