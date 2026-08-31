import { useEffect, useState } from 'react';
import { fetchHealth, type HealthFetch } from '../lib/healthClient.ts';
import type { HealthResponse, HealthRow } from '../../server/health/service.ts';
import { StopControls } from './stopControls.tsx';
import '../styles/views/health.css';

/** One fixed labelled field inside a `.v-health__value-fragment` — see `styles/views/health.css`. */
function field(label: string, data: string): React.JSX.Element {
  return (
    <span className="v-health__value-field">
      <span className="v-health__value-field-label">{label}</span>
      <span className="v-health__value-field-data">{data}</span>
    </span>
  );
}

/**
 * P5 W6.2 [P5-C37, P5-C43]: `MachineRow`'s cpu/memory/disk/uptime keys and the `DaemonRow`/`ReleaseRow`/
 * `DeployRow` kinds all carry OBJECT values (§3.5) — each renders as a fixed set of labelled fragments,
 * never a raw object. Returns `null` for every row `valueFor` already renders as plain text.
 */
function objectValueFor(row: HealthRow): React.JSX.Element[] | null {
  if (row.kind === 'machine' && typeof row.value === 'object') {
    if ('load1' in row.value) return [field('load1', String(row.value.load1)), field('load5', String(row.value.load5)), field('load15', String(row.value.load15))];
    if ('seconds' in row.value) return [field('uptime', `${row.value.seconds}s`)];
    return [field('used', String(row.value.used)), field('total', String(row.value.total)), field('unit', row.value.unit)];
  }
  if (row.kind === 'daemon') {
    return [
      field('unit', row.value.unit), field('pid', String(row.value.mainPid)),
      field('root', row.value.loadedRoot), field('children', String(row.value.childCount)),
    ];
  }
  if (row.kind === 'release') {
    return [
      field('sha', row.value.sha.slice(0, 8)), field('digest', row.value.archiveSha256.slice(0, 8)),
      field('activated', row.value.activatedAt), field('rollback', row.value.rollbackAvailable ? 'available' : 'unavailable'),
    ];
  }
  if (row.kind === 'deploy') {
    const fields = [
      field('ref', row.value.deploymentRef), field('state', row.value.state),
      field('target', row.value.targetCommit.slice(0, 8)), field('previous', row.value.previousCommit.slice(0, 8)),
    ];
    return row.value.error ? [...fields, field('error', row.value.error)] : fields;
  }
  return null;
}

function valueFor(row: HealthRow): React.ReactNode {
  const objectFields = objectValueFor(row);
  if (objectFields) return <span className="v-health__value-fragment">{objectFields}</span>;
  if (row.kind === 'fleet') return `${row.value.status} · ${row.value.role ?? 'no role'}`;
  if (row.kind === 'mcp') return row.value.tools.join(', ') || 'no configured tools';
  if (row.kind === 'usage') return typeof row.value === 'number' ? String(row.value) : `${row.value.steps} steps · ${row.value.mix}`;
  if (row.kind === 'unavailable') return row.value.reason;
  if (row.kind === 'integrity') return row.value.code;
  // The only kinds left once `objectValueFor` returns null for every object-valued row above: MachineRow
  // 'daemon-platform' and the P1 `deferred` MCP availability rows, both plain strings.
  return typeof row.value === 'string' ? row.value : null;
}

export function Health({ response, fetchImpl = fetch }: { response?: HealthResponse; fetchImpl?: HealthFetch } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (response) return;
    let cancelled = false;
    setError(false);
    fetchHealth(fetchImpl).then((next) => {
      if (!cancelled) setFetched(next);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [fetchImpl, response, retryTick]);

  const health = response ?? fetched;
  if (!health) return <main className="v-health" aria-label="Health"><h1>Health</h1><p>{error ? 'Health is unavailable.' : 'Loading health.'}</p>{error ? <button type="button" onClick={() => setRetryTick((value) => value + 1)}>Retry Health</button> : null}</main>;

  return (
    <main className="v-health" aria-label="Health">
      <h1>Health</h1>
      {health.sections.map((section) => (
        <section className="v-health__section" aria-label={section.label} key={section.id}>
          <h2>{section.label}</h2>
          <div className="v-health__rows">
            {section.rows.map((row) => (
              <div className="v-health__row" data-testid={`health-row-${row.key}`} key={row.key}
                {...(row.kind === 'fleet' ? { 'data-raw-id': row.key.slice('agent:'.length) } : {})}
                {...(row.kind === 'deploy' ? { id: row.key } : {})}>
                <span className="v-health__label">{row.label}</span>
                <span className="v-health__value">{valueFor(row)}</span>
                <span className="v-health__source">Source: {row.source}</span>
                <time className="v-health__observed" dateTime={row.observedAt}>{row.observedAt}</time>
              </div>
            ))}
          </div>
          {section.id === 'stop' ? <div className="v-health__stop-slot" data-testid="health-stop-slot"><StopControls /></div> : null}
        </section>
      ))}
    </main>
  );
}
