/**
 * U10 — a read-only inbox of deterministic transcript-mined ADD candidates.
 * This panel cannot accept proposals or write memory: review is deliberately
 * separate from Dream's future trusted intake path.
 */
import type { AgentPlatformPanel } from '../types';
import { useReadPanel } from '../../../lib/useReadPanel';
import '../../../styles/views/agentPlatformProposedLessons.css';

type Confidence = 'high' | 'med' | 'low';
interface ProposalEntry {
  lesson: string;
  confidence: Confidence;
  evidence: string;
  sourceSession: string;
  file: string;
}
interface ProposalResponse { entries: ProposalEntry[]; }

function ProposedLessonsBody(): React.JSX.Element {
  const { data, state } = useReadPanel<ProposalResponse>('/api/lessons/proposals');
  // A body that is not the shape we asked for is not evidence of proposals — read it as none.
  const entries = Array.isArray(data?.entries) ? data.entries : [];

  // `idle` cannot occur here (the url is a constant), but it is folded into the loading branch so a
  // future gate on this panel can never fall through to the "no proposals yet" line.
  if (state === 'loading' || state === 'idle') return <p className="ap-lessons__note">Reading mined proposals…</p>;
  if (state === 'unavailable') {
    return <p className="ap-lessons__error" data-testid="ap-lessons-unavailable">Proposals could not be read just now. Nothing was changed.</p>;
  }
  if (entries.length === 0) {
    return <p className="ap-lessons__empty" data-testid="ap-lessons-empty">No mined proposals yet — run the miner.</p>;
  }
  return (
    <div className="ap-lessons" aria-label="Proposed Lessons panel">
      <p className="ap-lessons__note">Candidate ADDs only — a human or dream.py must accept one into memory.</p>
      <ul className="ap-lessons__list">
        {entries.map((entry, index) => (
          <li className="ap-lessons__entry" key={`${entry.file}:${index}`} data-testid={`ap-lessons-entry-${index}`}>
            <p className="ap-lessons__lesson">{entry.lesson}</p>
            <dl className="ap-lessons__meta">
              <div><dt>confidence</dt><dd className={`ap-lessons__confidence ap-lessons__confidence--${entry.confidence}`}>{entry.confidence}</dd></div>
              <div><dt>evidence</dt><dd><code>{entry.evidence}</code></dd></div>
              <div><dt>source session</dt><dd><code>{entry.sourceSession}</code></dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'proposed-lessons',
  order: 90,
  title: 'Proposed Lessons',
  description: 'Candidate ADD lessons mined from transcripts; review-only, never written to memory.',
  render: () => <ProposedLessonsBody />,
};

export { ProposedLessonsBody };
