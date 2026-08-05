/**
 * spec §2 — the single renderer for "how an entity's identity shows up in primary UI text".
 *
 * Every list row, header, and detail title that names a card/run/workflow/agent/task must go through
 * this component rather than printing a raw id: operators read human `displayName`s, not opaque hashes,
 * and a short stable `#ordinal` (`shortRef`) gives them something nameable in conversation ("run #42")
 * without colliding across entities of the same kind. The canonical `id` still exists — for correlating
 * with logs, queue filenames, API calls — but only ever behind the `title` tooltip and the copy button;
 * it must never appear as visible text content, under any prop combination.
 *
 * Server DTOs carrying `displayName` + `shortRef` land in a follow-up task; this component is written
 * against that contract now so every call site converges on one look before the wiring lands.
 */
import { useEffect, useRef, useState } from 'react';

export type EntityKind = 'card' | 'run' | 'workflow' | 'agent' | 'task';

export interface EntityNameProps {
  kind: EntityKind;
  /** Canonical id — NEVER rendered as text content. Lives in `title` + the copy affordance only. */
  id: string;
  displayName: string;
  shortRef: number;
  /** Smaller/dimmer variant for secondary rows (e.g. a nested list under a detail view). */
  muted?: boolean;
}

/** The slice of the Clipboard API this component calls — resolved at click time (not module load) so
 * environments without it (older browsers, insecure contexts, jsdom under test) degrade to a no-op
 * instead of throwing, and tests can inject a fake by defining `navigator.clipboard` before the click. */
interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

function resolveClipboard(): ClipboardLike | null {
  if (typeof navigator === 'undefined') return null;
  const clipboard = (navigator as Navigator & { clipboard?: ClipboardLike }).clipboard;
  return clipboard && typeof clipboard.writeText === 'function' ? clipboard : null;
}

/** How long the "copied" glyph/label stays up before reverting to the idle copy affordance. */
const COPIED_RESET_MS = 1500;

export function EntityName({ kind, id, displayName, shortRef, muted }: EntityNameProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    };
  }, []);

  function handleCopy(): void {
    const clipboard = resolveClipboard();
    if (!clipboard) return;
    clipboard.writeText(id).then(
      () => {
        setCopied(true);
        if (resetTimer.current !== null) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      },
      () => {
        // Clipboard permission denied or unavailable mid-flight — the id is still reachable via the
        // title tooltip, so this fails silently rather than surfacing an error for a non-critical action.
      },
    );
  }

  return (
    <span className={`entity-name${muted ? ' entity-name--muted' : ''}`} title={id} data-testid="entity-name">
      <span className="entity-name__label">{displayName}</span>
      <span className="mc-badge mc-mono entity-name__ref" data-testid="entity-name-ref">
        #{shortRef}
      </span>
      <button
        type="button"
        className={`entity-name__copy${copied ? ' entity-name__copy--copied' : ''}`}
        onClick={handleCopy}
        aria-label={copied ? `Copied ${kind} id` : `Copy ${kind} id`}
        data-testid="entity-name-copy"
      >
        <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
    </span>
  );
}
