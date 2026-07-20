/**
 * D2.5 — CodeMirror 6 markdown editor + governed save.
 *
 * Edits KB/skill markdown in-browser and saves through the **governed** path
 * (`server/write/governedSave.ts`) — never a raw write. The component itself holds no session-minting
 * or git logic; it POSTs `{ relpath, content }` (bearer session token attached) to the governed-save
 * endpoint and renders whatever outcome comes back, including a 401 (no/invalid session), a 400 (path
 * escape — should never happen from this UI, which only ever opens paths the KB browser gave it), or a
 * 500 (routing failure, e.g. a blocked `sync_skills` hook on drift). `save` is injectable so tests
 * never need a real server, a real WebAuthn session, or a real git checkout.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { basicSetup, EditorView } from 'codemirror';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';

export interface SaveOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
  target?: 'durable' | 'coordination';
}

export type SaveFn = (
  relpath: string,
  content: string,
  sessionToken: string | undefined,
) => Promise<SaveOutcome>;

/** Default save: POST to the governed-save endpoint. No route is wired by this file (a later task's
 *  job to mount `governedSave.save` behind it) — a 404 just surfaces as an ordinary failed-save
 *  outcome, same as any other server error. */
export const defaultSave: SaveFn = async (relpath, content, sessionToken) => {
  const res = await fetch('/api/write/save', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({ relpath, content }),
  });
  await invalidateSessionOnGovernedAuthFailure(res);
  let body: SaveOutcome | undefined;
  try {
    body = (await res.json()) as SaveOutcome;
  } catch {
    /* non-JSON body — fall through to the status-derived outcome below */
  }
  if (!res.ok) {
    return { ok: false, status: res.status, reason: body?.reason ?? `${res.status} ${res.statusText}` };
  }
  return body ?? { ok: true };
};

export interface EditorProps {
  /** Repo-relative path of the file being edited (as returned by the read-only KB browser). */
  relpath: string;
  initialContent?: string;
  sessionToken?: string;
  save?: SaveFn;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/** CodeMirror 6 markdown editor bound to `relpath`, with a Save action through the governed path. */
export function Editor({
  relpath,
  initialContent = '',
  sessionToken,
  save = defaultSave,
}: EditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const state = EditorState.create({
      doc: initialContent,
      extensions: [basicSetup, markdown()],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    setStatus('idle');
    setError(null);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Remount only when the target file changes; `initialContent` seeds the doc once per mount, not
    // on every keystroke (CodeMirror owns the doc thereafter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relpath]);

  const onSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    setStatus('saving');
    setError(null);
    const content = view.state.doc.toString();
    const outcome = await save(relpath, content, sessionToken);
    if (outcome.ok) {
      setStatus('saved');
    } else {
      setStatus('error');
      setError(outcome.reason ?? `save failed${outcome.status ? ` (${outcome.status})` : ''}`);
    }
  }, [relpath, save, sessionToken]);

  return (
    <section className="editor" aria-label="Editor">
      <header className="editor__toolbar">
        <span className="editor__path">{relpath}</span>
        <button type="button" onClick={onSave} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && (
          <span className="editor__status editor__status--ok" role="status">
            Saved
          </span>
        )}
        {status === 'error' && (
          <span className="editor__status editor__status--error" role="alert">
            {error}
          </span>
        )}
      </header>
      <div className="editor__surface" ref={hostRef} data-testid="editor-surface" />
    </section>
  );
}
