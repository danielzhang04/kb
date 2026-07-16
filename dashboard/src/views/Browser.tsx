/**
 * Read-only KB file browser view. A directory tree on the left, the selected file on the right:
 * markdown files are rendered (safely — see src/lib/markdown.ts), other files shown as plain text,
 * plus the file's `git log --follow` history. All data comes from the GET-only /api/kb/* routes;
 * there is no write path here.
 */
import { useCallback, useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

interface TreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
}
interface Commit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function Browser() {
  const [subpath, setSubpath] = useState('');
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [history, setHistory] = useState<Commit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback((path: string) => {
    setError(null);
    getJson<{ path: string; entries: TreeEntry[] }>(`/api/kb/tree?path=${encodeURIComponent(path)}`)
      .then((r) => {
        setSubpath(r.path);
        setEntries(r.entries);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const openFile = useCallback((path: string) => {
    setError(null);
    setSelected(path);
    getJson<{ path: string; content: string }>(`/api/kb/file?path=${encodeURIComponent(path)}`)
      .then((r) => setContent(r.content))
      .catch((e: unknown) => setError(String(e)));
    getJson<{ path: string; commits: Commit[] }>(`/api/kb/history?path=${encodeURIComponent(path)}`)
      .then((r) => setHistory(r.commits))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    loadTree('');
  }, [loadTree]);

  const isMarkdown = selected?.endsWith('.md') ?? false;

  return (
    <div className="kb-browser">
      <nav className="kb-browser__tree">
        <div className="kb-browser__crumbs">/{subpath}</div>
        <ul>
          {subpath !== '' && (
            <li>
              <button onClick={() => loadTree(parentOf(subpath))}>..</button>
            </li>
          )}
          {entries.map((e) => (
            <li key={e.path}>
              {e.type === 'dir' ? (
                <button onClick={() => loadTree(e.path)}>{e.name}/</button>
              ) : (
                <button onClick={() => openFile(e.path)}>{e.name}</button>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <section className="kb-browser__content">
        {error && <p className="kb-browser__error">{error}</p>}
        {selected && (
          <>
            <h2 className="kb-browser__filename">{selected}</h2>
            {isMarkdown ? (
              // Safe: renderMarkdown escapes all HTML before transforming — no raw injection.
              <div
                className="kb-browser__markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            ) : (
              <pre className="kb-browser__raw">{content}</pre>
            )}
            <details className="kb-browser__history">
              <summary>History ({history.length})</summary>
              <ul>
                {history.map((c) => (
                  <li key={c.hash}>
                    <code>{c.hash.slice(0, 8)}</code> {c.subject} — {c.author}, {c.date}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  );
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
