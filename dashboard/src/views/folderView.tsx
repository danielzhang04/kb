/**
 * Shared read-only folder browser — the common "explorer" surface behind BOTH the Files view
 * (root = whole KB) and the Projects view (root = a single org subtree). Extracted here so the two
 * views share ONE folder-view design language instead of duplicating a tree + reader.
 *
 * Two panes: a lazily-expanding directory tree on the left (VS-Code activity-explorer pattern —
 * chevrons, indent guides, active node = the single left-border accent), and the selected file's
 * rendered content on the right (markdown rendered-first at reading width, other files as plain
 * text) plus its `git log --follow` history. All data comes from the GET-only /api/kb/* routes
 * (server/kb/routes.ts); there is deliberately NO write path here (read-only per ordering law 1).
 * Inline editing is a post-merge concern — this component never mutates the KB.
 */
import { useCallback, useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { getJson } from '../lib/http.ts';
import '../styles/views/folder.css';

// `getJson` now lives in `../lib/http.ts`; re-exported here so existing importers (Projects.tsx) are
// byte-untouched.
export { getJson };

export interface TreeEntry {
  name: string;
  /** POSIX-style relpath from the repo root (forward slashes). */
  path: string;
  type: 'dir' | 'file';
}
export interface Commit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}
interface TreeListing {
  path: string;
  entries: TreeEntry[];
}


// Endpoint URL builders — exported so views (and tests) share the exact query shape.
export const treeUrl = (path: string): string => `/api/kb/tree?path=${encodeURIComponent(path)}`;
export const fileUrl = (path: string): string => `/api/kb/file?path=${encodeURIComponent(path)}`;
export const historyUrl = (path: string): string => `/api/kb/history?path=${encodeURIComponent(path)}`;

export interface FolderViewProps {
  /** Subtree root: '' = the whole KB (Files); 'orgs/<name>' = one project (Projects). */
  root?: string;
  /** Placeholder shown in the content pane before any file is selected. */
  emptyHint?: string;
}

/**
 * A confined, read-only two-pane folder browser rooted at `root`. Directories load their children
 * lazily on first expand; the selected file renders on the right. Changing `root` resets the view.
 */
export function FolderView({ root = '', emptyHint = 'Select a file to read it.' }: FolderViewProps): React.JSX.Element {
  // dirPath -> its loaded children. The root's children live under the `root` key.
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [history, setHistory] = useState<Commit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback((path: string) => {
    getJson<TreeListing>(treeUrl(path))
      .then((r) => setChildren((c) => ({ ...c, [path]: r.entries })))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  // Reset and reload whenever the root changes (Projects swaps root when a project is opened).
  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    setSelected(null);
    setContent('');
    setHistory([]);
    setError(null);
    loadDir(root);
  }, [root, loadDir]);

  const toggleDir = useCallback(
    (path: string, isOpen: boolean, loaded: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(path);
        else next.add(path);
        return next;
      });
      if (!isOpen && !loaded) loadDir(path);
    },
    [loadDir],
  );

  const openFile = useCallback((path: string) => {
    setError(null);
    setSelected(path);
    getJson<{ path: string; content: string }>(fileUrl(path))
      .then((r) => setContent(r.content))
      .catch((e: unknown) => setError(String(e)));
    getJson<{ path: string; commits: Commit[] }>(historyUrl(path))
      .then((r) => setHistory(r.commits))
      .catch(() => setHistory([]));
  }, []);

  // Recursively render the entries under `dirPath`. `depth` drives the indent guide only.
  const renderNodes = (dirPath: string, depth: number): React.JSX.Element | null => {
    const entries = children[dirPath];
    if (!entries) return null;
    return (
      <ul className="v-folder__list">
        {entries.map((e) => {
          if (e.type === 'dir') {
            const isOpen = expanded.has(e.path);
            const loaded = e.path in children;
            return (
              <li key={e.path} className="v-folder__node">
                <button
                  type="button"
                  className="v-folder__row v-folder__row--dir"
                  aria-expanded={isOpen}
                  onClick={() => toggleDir(e.path, isOpen, loaded)}
                >
                  <span className="v-folder__chevron" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="v-folder__name">{e.name}</span>
                </button>
                {isOpen && <div className="v-folder__children">{renderNodes(e.path, depth + 1)}</div>}
              </li>
            );
          }
          const isSel = selected === e.path;
          return (
            <li key={e.path} className="v-folder__node">
              <button
                type="button"
                className={'v-folder__row v-folder__row--file' + (isSel ? ' v-folder__row--active' : '')}
                aria-current={isSel ? 'true' : undefined}
                onClick={() => openFile(e.path)}
              >
                <span className="v-folder__chevron v-folder__chevron--spacer" aria-hidden="true" />
                <span className="v-folder__name">{e.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  const isMarkdown = selected?.endsWith('.md') ?? false;

  return (
    <div className="v-folder">
      <nav className="v-folder__tree" aria-label="File tree">
        {error && <p className="v-folder__error">{error}</p>}
        {renderNodes(root, 0)}
      </nav>
      <section className="v-folder__content">
        {!selected && <div className="v-folder__placeholder">{emptyHint}</div>}
        {selected && (
          <article className="v-folder__doc">
            <header className="v-folder__doc-head">
              <span className="v-folder__doc-path mc-mono">{selected}</span>
            </header>
            {isMarkdown ? (
              // Safe: renderMarkdown escapes all HTML before transforming — no raw injection.
              <div
                className="v-folder__markdown"
                data-testid="folder-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            ) : (
              <pre className="v-folder__raw">{content}</pre>
            )}
            <details className="v-folder__history">
              <summary>History ({history.length})</summary>
              <ul className="v-folder__history-list">
                {history.map((c) => (
                  <li key={c.hash}>
                    <code className="mc-mono">{c.hash.slice(0, 8)}</code> {c.subject} — {c.author}, {c.date}
                  </li>
                ))}
              </ul>
            </details>
          </article>
        )}
      </section>
    </div>
  );
}
