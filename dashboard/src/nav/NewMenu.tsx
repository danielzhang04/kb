/**
 * [+ New ▾] menu (U2.5) — pinned at the top of the sidebar, above the first hairline divider. Every
 * entry is actionable. Short visible hints distinguish the outcome: plan an idea, quick-launch a task,
 * register a workflow/skill/project artifact, or declare an agent.
 *
 * Keyboard: the trigger toggles the menu; Escape closes it and returns focus to the trigger; an outside
 * click closes it. `role="menu"` / `role="menuitem"` so it reads as a menu to assistive tech.
 */
import { useEffect, useRef, useState } from 'react';
import { NEW_MENU_ENTRIES, type NewMenuEntry } from './config';

export function NewMenu({ onCreate }: { onCreate: (id: NewMenuEntry['id']) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on an outside click (mousedown so it fires before a re-open toggle).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className="mc-new"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="mc-new__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mc-new__plus mc-mono" aria-hidden="true">
          +
        </span>
        <span className="mc-new__label">New</span>
        <span className="mc-new__caret mc-mono" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <ul className="mc-new__menu" role="menu" aria-label="Create new">
          {NEW_MENU_ENTRIES.map((entry) => {
            // Outcome hints stay visible for enabled entries; the fallback preserves disabled-entry clarity.
            const hint = entry.hint ?? (entry.enabled ? undefined : 'Composer');
            return (
              <li key={entry.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`mc-new__item${entry.enabled ? '' : ' mc-new__item--disabled'}`}
                  disabled={!entry.enabled}
                  title={hint}
                  onClick={() => {
                    if (!entry.enabled) return;
                    onCreate(entry.id);
                    close();
                  }}
                >
                  <span className="mc-new__item-label">{entry.label}</span>
                  {hint ? <span className="mc-new__item-hint">{hint}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
