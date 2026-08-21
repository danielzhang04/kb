import { useEffect, useState } from 'react';
import { fetchHealth } from '../lib/healthClient.ts';
import type { HealthResponse, HealthRow } from '../../server/health/service.ts';
import '../styles/views/health.css';

function valueFor(row: HealthRow): string {
  if (row.kind === 'fleet') return `${row.value.status} · ${row.value.role ?? 'no role'}`;
  if (row.kind === 'mcp') return row.value.tools.join(', ') || 'no configured tools';
  if (row.kind === 'usage') return typeof row.value === 'number' ? String(row.value) : `${row.value.steps} steps · ${row.value.mix}`;
  if (row.kind === 'unavailable') return row.value.reason;
  return row.value;
}

export function Health({ response }: { response?: HealthResponse } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (response) return;
    let cancelled = false;
    fetchHealth().then((next) => {
      if (!cancelled) setFetched(next);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [response]);

  const health = response ?? fetched;
  if (!health) return <main className="v-health" aria-label="Health"><h1>Health</h1><p>{error ? 'Health is unavailable.' : 'Loading health.'}</p></main>;

  return (
    <main className="v-health" aria-label="Health">
      <h1>Health</h1>
      {health.sections.map((section) => (
        <section className="v-health__section" aria-label={section.label} key={section.id}>
          <h2>{section.label}</h2>
          <div className="v-health__rows">
            {section.rows.map((row) => (
              <div className="v-health__row" data-testid={`health-row-${row.key}`} key={row.key}>
                <span className="v-health__label">{row.label}</span>
                <span className="v-health__value">{valueFor(row)}</span>
                <span className="v-health__source">Source: {row.source}</span>
                <time className="v-health__observed" dateTime={row.observedAt}>{row.observedAt}</time>
              </div>
            ))}
          </div>
          {section.id === 'stop' ? <div className="v-health__stop-slot" data-testid="health-stop-slot" /> : null}
        </section>
      ))}
    </main>
  );
}
