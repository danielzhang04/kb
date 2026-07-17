/**
 * Projects — every project (org) in the KB as a folder-style landing grid; click a project to browse
 * that org's subtree in place. Shares the Files design language via the same FolderView component.
 *
 * Data: the GET-only kb tree endpoint scoped to `orgs/`. The landing grid lists one card per org
 * directory. Cheap, honest metadata is read straight from each org's own tree listing — presence of
 * STATE.md / _index.md and a child count — never invented. If an org's subtree can't be listed, its
 * card still renders (name only). Read-only throughout.
 */
import { useEffect, useState } from 'react';
import { FolderView, getJson, treeUrl, type TreeEntry } from './folderView';
import '../styles/views/projects.css';

interface OrgMeta {
  name: string;
  path: string;
  hasState: boolean;
  hasIndex: boolean;
  /** Number of top-level entries in the org, or null when the subtree couldn't be listed. */
  entryCount: number | null;
}

interface TreeListing {
  path: string;
  entries: TreeEntry[];
}

export function Projects(): React.JSX.Element {
  const [orgs, setOrgs] = useState<OrgMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OrgMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<TreeListing>(treeUrl('orgs'))
      .then(async (r) => {
        const dirs = r.entries.filter((e) => e.type === 'dir');
        const metas = await Promise.all(
          dirs.map(async (d): Promise<OrgMeta> => {
            try {
              const sub = await getJson<TreeListing>(treeUrl(d.path));
              const names = sub.entries.map((e) => e.name);
              return {
                name: d.name,
                path: d.path,
                hasState: names.includes('STATE.md'),
                hasIndex: names.includes('_index.md'),
                entryCount: sub.entries.length,
              };
            } catch {
              // Degrade gracefully: the card still renders with just the project name.
              return { name: d.name, path: d.path, hasState: false, hasIndex: false, entryCount: null };
            }
          }),
        );
        if (!cancelled) setOrgs(metas);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Folder-browse of a single project, with a breadcrumb back to the grid.
  if (open) {
    return (
      <div className="v-projects">
        <nav className="v-projects__breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="v-projects__crumb-back" onClick={() => setOpen(null)}>
            Projects
          </button>
          <span className="v-projects__crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="v-projects__crumb-current mc-mono">{open.name}</span>
        </nav>
        <FolderView root={open.path} emptyHint={`Browse ${open.name} — select a file to read it.`} />
      </div>
    );
  }

  return (
    <div className="v-projects">
      <header className="v-projects__header">
        <h1 className="v-projects__title">Projects</h1>
        <p className="v-projects__subtitle">Every project in the knowledge base.</p>
      </header>

      {error && <p className="v-projects__error">{error}</p>}
      {!orgs && !error && <div className="v-projects__loading">Loading projects…</div>}
      {orgs && orgs.length === 0 && <div className="v-projects__empty">No projects found under orgs/.</div>}

      {orgs && orgs.length > 0 && (
        <ul className="v-projects__grid">
          {orgs.map((o) => (
            <li key={o.path}>
              <button type="button" className="v-projects__card" onClick={() => setOpen(o)}>
                <span className="v-projects__card-name mc-mono">{o.name}</span>
                <span className="v-projects__card-meta">
                  {o.hasIndex && <span className="v-projects__tag">_index.md</span>}
                  {o.hasState && <span className="v-projects__tag">STATE.md</span>}
                  {o.entryCount !== null && (
                    <span className="v-projects__count mc-num">{o.entryCount} items</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
