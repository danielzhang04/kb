import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import './HygieneReport.css';

interface Finding { path: string; kind: string; size: number; detail: string; proposal: string }
interface Report { generated_at: string; root: string; dryRun: true; findings: Finding[]; summary: { total: number; by_kind: Record<string, number> } }
type Response = { available: true; report: Report } | { available: false; reason: string };

function HygieneReportBody(): React.JSX.Element {
  const [response, setResponse] = useState<Response | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/hygiene/report')
      .then((result) => { if (!result.ok) throw new Error(String(result.status)); return result.json() as Promise<Response>; })
      .then((value) => { if (!cancelled) setResponse(value); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return <p className="ap-hygiene__empty">Report unavailable — nothing was changed.</p>;
  if (response === null) return <p className="ap-hygiene__empty">Reading hygiene report…</p>;
  if (!response.available) {
    return <p className="ap-hygiene__empty" data-testid="ap-hygiene-not-generated">No report has been generated. Run: <code>python scripts/hygiene_sweep.py</code></p>;
  }
  const groups = Object.entries(response.report.summary.by_kind).sort(([a], [b]) => a.localeCompare(b));
  const grouped = new Map(groups.map(([kind]) => [kind, response.report.findings.filter((finding) => finding.kind === kind)]));
  return (
    <div className="ap-hygiene" aria-label="Hygiene Report panel">
      <p className="ap-hygiene__banner">DRY-RUN — nothing was or will be deleted; proposals need a human.</p>
      <p className="ap-hygiene__summary">{response.report.summary.total} finding{response.report.summary.total === 1 ? '' : 's'} · generated {response.report.generated_at}</p>
      {groups.map(([kind, count]) => (
        <section className="ap-hygiene__group" key={kind}>
          <h3 className="ap-hygiene__heading">{kind} ({count})</h3>
          <ul className="ap-hygiene__findings">
            {(grouped.get(kind) ?? []).map((finding) => <li key={`${finding.kind}:${finding.path}:${finding.detail}`} className="ap-hygiene__finding"><code>{finding.path}</code><span>{finding.detail}</span><em>{finding.proposal}</em></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'hygiene-report',
  title: 'Hygiene Report',
  description: 'Dry-run candidates for human review; this panel never cleans or deletes.',
  render: () => <HygieneReportBody />,
};

export { HygieneReportBody };
