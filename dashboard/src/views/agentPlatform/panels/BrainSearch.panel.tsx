import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AgentPlatformPanel } from '../types';
import '../../../styles/views/agentPlatformBrainSearch.css';

interface BrainResult {
  source_path: string;
  heading_path: string[];
  score: number;
  start_line: number;
  end_line: number;
  snippet: string;
}

type SearchResponse = { query: string; k: number; results: BrainResult[] } | { available: false; reason: string };
type SearchState = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Every reason `scripts/brain/brain_query.py` can emit, spelled as the thing the operator has to do.
 *
 * There is NO "brain service": the CLI is a fresh process per query over a local index file, so a
 * failure is never "the service is down" and the panel must not say it is. The three index reasons
 * differ only in WHY the index is unusable — all three end in "rebuild it" — and the fallback names
 * the failure without inventing a cause.
 */
const UNAVAILABLE_REASON: Record<string, string> = {
  'index-not-built': 'Index not built on this machine — run the indexer.',
  'model-mismatch': 'The index was built with a different embedding model — rebuild it.',
  'index-format-error': 'The index is in an unreadable format — rebuild it.',
};

const UNAVAILABLE_FALLBACK = 'Search failed — nothing was read. Nothing was changed.';

function BrainSearchBody(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>('idle');
  const [results, setResults] = useState<BrainResult[]>([]);
  const [reason, setReason] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setState('loading');
    setReason(null);
    try {
      const response = await fetch(`/api/brain/search?q=${encodeURIComponent(q)}&k=8`);
      if (!response.ok) throw new Error('brain search request failed');
      const body = await response.json() as SearchResponse;
      if (!('results' in body)) {
        setResults([]);
        setReason(body.reason);
        setState('unavailable');
        return;
      }
      setResults(body.results);
      setState('ready');
    } catch {
      setResults([]);
      setReason('query-failed');
      setState('unavailable');
    }
  }

  return (
    <div className="ap-brainsearch">
      <form className="ap-brainsearch__form" data-testid="ap-brainsearch-form" onSubmit={submit}>
        <label className="ap-brainsearch__label" htmlFor="ap-brainsearch-query">Search the brain</label>
        <div className="ap-brainsearch__controls">
          <input
            id="ap-brainsearch-query"
            className="ap-brainsearch__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask about the local knowledge base"
          />
          <button className="ap-brainsearch__button" type="submit" disabled={state === 'loading'}>Search</button>
        </div>
      </form>
      {state === 'idle' ? <p className="ap-brainsearch__note">Searches the local index only; nothing is sent to a service.</p> : null}
      {state === 'loading' ? <p className="ap-brainsearch__note" data-testid="ap-brainsearch-loading">Searching… Every query starts a fresh process and reloads the embedding model, which measures about 10-20 seconds.</p> : null}
      {state === 'unavailable' ? (
        <p className="ap-brainsearch__unavailable" data-testid="ap-brainsearch-unavailable">
          {(reason !== null ? UNAVAILABLE_REASON[reason] : undefined) ?? UNAVAILABLE_FALLBACK}
        </p>
      ) : null}
      {state === 'ready' && results.length === 0 ? <p className="ap-brainsearch__note" data-testid="ap-brainsearch-empty">No matching chunks were found.</p> : null}
      {state === 'ready' && results.length > 0 ? (
        <ol className="ap-brainsearch__results">
          {results.map((result, index) => (
            <li className="ap-brainsearch__result" data-testid={`ap-brainsearch-result-${index}`} key={`${result.source_path}:${result.start_line}:${index}`}>
              <div className="ap-brainsearch__meta">
                <span className="ap-brainsearch__path">{result.source_path}</span>
                <span className="ap-brainsearch__score">{result.score.toFixed(4)}</span>
              </div>
              <p className="ap-brainsearch__heading">{result.heading_path.join(' > ') || 'No heading'}</p>
              <p className="ap-brainsearch__snippet">{result.snippet}</p>
              <p className="ap-brainsearch__lines">lines {result.start_line}–{result.end_line}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'brain-search',
  order: 60,
  title: 'Brain Search',
  description: 'Ranked local knowledge-base chunks from the semantic index.',
  render: () => <BrainSearchBody />,
};
