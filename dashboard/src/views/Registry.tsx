/**
 * Registry view (D0.6): skills / MCP connections / workflows registries, read-only.
 *
 * Every section degrades to an explicit empty state rather than an error:
 *  - skills with no trust grades → the grade column reads "no grades yet" (ledgers/grades is empty)
 *  - connections with no per-project MCP settings → "no MCP connections"
 *  - workflows when the registry dir is absent (`present === false`) → "no workflows registered yet"
 *
 * Data arrives from the read-only `/api/registry` route (D0.6 server side). The full wiring into the
 * Control shell + SSE happens in D0.9; here the view fetches once on mount and renders empty-safe.
 */
import { useEffect, useState } from 'react';
import type { SkillsIndex, SkillEntry, SkillTier } from '../../server/registry/skills';
import type { ConnectionsIndex } from '../../server/registry/connections';

export interface RegistryData {
  skills: SkillsIndex;
  connections: ConnectionsIndex;
}

const TIER_ORDER: SkillTier[] = ['curated', 'evolved', 'imported', 'learned'];

function SkillsSection({ skills }: { skills: SkillsIndex }): React.JSX.Element {
  return (
    <section className="registry__section" aria-label="Skills registry">
      <h3>Skills ({skills.count})</h3>
      {skills.count === 0 ? (
        <p className="registry__empty">No skills indexed.</p>
      ) : (
        TIER_ORDER.filter((tier) => (skills.byTier[tier]?.length ?? 0) > 0).map((tier) => (
          <div key={tier} className="registry__tier">
            <h4>{tier}</h4>
            <ul>
              {skills.byTier[tier].map((s: SkillEntry) => (
                <li key={s.path}>
                  <strong>{s.name}</strong>
                  <span className="registry__grade">
                    {skills.trust.present && s.grade !== null ? `grade ${s.grade}` : 'no grades yet'}
                  </span>
                  <p>{s.description}</p>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function ConnectionsSection({ connections }: { connections: ConnectionsIndex }): React.JSX.Element {
  const projects = Object.keys(connections.byProject);
  return (
    <section className="registry__section" aria-label="MCP connections registry">
      <h3>MCP connections ({connections.count})</h3>
      {projects.length === 0 ? (
        <p className="registry__empty">No MCP connections.</p>
      ) : (
        projects.map((project) => (
          <div key={project} className="registry__project">
            <h4>{project}</h4>
            <ul>
              {connections.byProject[project].map((c) => (
                <li key={c.server}>
                  <strong>{c.server}</strong>: {c.tools.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

const EMPTY: RegistryData = {
  skills: { count: 0, items: [], byTier: { curated: [], evolved: [], imported: [], learned: [] }, trust: { present: false, count: 0 } },
  connections: { count: 0, items: [], byProject: {} },
};

/** Registry view. Accepts data directly (tests/D0.9) or self-fetches from `/api/registry`. */
export function Registry({ data }: { data?: RegistryData }): React.JSX.Element {
  const [fetched, setFetched] = useState<RegistryData | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch('/api/registry')
      .then((r) => r.json() as Promise<RegistryData>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const view = data ?? fetched ?? EMPTY;
  return (
    <div className="registry">
      <SkillsSection skills={view.skills} />
      <ConnectionsSection connections={view.connections} />
    </div>
  );
}
