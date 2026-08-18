/**
 * U10 — a read-only inbox of deterministic transcript-mined ADD candidates.
 * This panel cannot accept proposals or write memory: review is deliberately
 * separate from Dream's future trusted intake path.
 */
import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
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
type LoadState = 'loading' | 'ready' | 'unavailable';

function ProposedLessonsBody(): React.JSX.Element {
  const [entries, setEntries] = useState<ProposalEntry[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/lessons/proposals')
      .then((response) => {
        if (!response.ok) throw new Error(`proposal request failed (${response.status})`);
        return response.json() as Promise<ProposalResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setEntries(Array.isArray(data.entries) ? data.entries : []);
          setState('ready');
        }
      })
      .catch(() => { if (!cancelled) setState('unavailable'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <p className="ap-lessons__note">Reading mined proposals…</p>;
  if (state === 'unavailable') {
    return <p className="ap-lessons__error" data-testid="ap-lessons-unavailable">Proposals are unavailable — the daemon did not answer. Nothing was changed.</p>;
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
  title: 'Proposed Lessons',
  description: 'Candidate ADD lessons mined from transcripts; review-only, never written to memory.',
  render: () => <ProposedLessonsBody />,
};

export { ProposedLessonsBody };
