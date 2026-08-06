/**
 * Command palette (U4) — Raycast-style centered overlay opened with Ctrl/Cmd+K. It NAVIGATES and it
 * shortcuts to governed surfaces; it is NEVER a bypass. Running a command only changes the active view —
 * no command here issues a verify/launch/stop network request. Governed controls stay WebAuthn-gated on
 * their own surfaces (the emergency-stop shortcut opens Sentinel, where those controls live).
 *
 * Interaction: focus is trapped in the input while open (the list uses aria-activedescendant so the
 * input keeps focus); Arrow keys move the selection (left-border accent = the shared selection
 * language); Enter runs the selected command; Esc or an outside click closes it and restores focus to
 * whatever was focused before it opened. Soon/future destinations render greyed and are non-actionable
 * (visible so the operator learns the map, but Enter/click is inert).
 *
 * Rendered in a portal on document.body so it layers above the sidebar and everything else. Solid
 * bg-elevated panel, hairline border, one overlay shadow — no backdrop blur, no glass.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ALL_COMMANDS, filterCommands, type PaletteCommand } from './paletteModel';
import '../styles/palette.css';

const LISTBOX_ID = 'mc-palette-listbox';
const optionId = (cmd: PaletteCommand): string => `mc-palette-opt-${cmd.id}`;

export function CommandPalette({
  open,
  onClose,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  /** Run a command. The host maps the command's `target` to a view change — nothing else. */
  onRun: (cmd: PaletteCommand) => void;
}): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // The element focused before the palette opened — restored on close.
  const restoreRef = useRef<Element | null>(null);

  const results = useMemo(() => filterCommands(ALL_COMMANDS, query), [query]);

  // Keep the selection in range as the result set shrinks/grows.
  useEffect(() => {
    setSelected((s) => (results.length === 0 ? 0 : Math.min(s, results.length - 1)));
  }, [results.length]);

  // On open: reset query/selection, remember the previously focused element, focus the input.
  // On close: restore focus to where it was.
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement;
      setQuery('');
      setSelected(0);
      // Focus after paint so the portal input exists.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    // Restore focus to where it was — but only if nothing else claimed it. If a command intentionally
    // moved focus elsewhere (the stop shortcut → the pinned floor), the palette must not steal it back.
    const prev = restoreRef.current;
    const activeNow = document.activeElement;
    if ((activeNow === document.body || activeNow === null) && prev instanceof HTMLElement) {
      prev.focus();
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const run = (cmd: PaletteCommand): void => {
    if (cmd.disabled) return; // soon/future rows are inert
    onRun(cmd);
    onClose();
  };

  const onInputKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (results.length === 0 ? 0 : (s + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (results.length === 0 ? 0 : (s - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[selected];
      if (cmd) run(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // Focus is trapped: the input is the only focusable stop while open.
      e.preventDefault();
    }
  };

  const active = results[selected];
  let lastKind: PaletteCommand['kind'] | null = null;

  return createPortal(
    <div
      className="mc-palette__backdrop"
      // Outside click closes. mousedown so it beats a re-open toggle; the panel stops propagation.
      onMouseDown={onClose}
    >
      <div
        className="mc-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="mc-palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label="Search commands and destinations"
          placeholder="Go to… or act — type a destination or command"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <ul className="mc-palette__list" role="listbox" id={LISTBOX_ID} aria-label="Commands">
          {results.length === 0 ? (
            <li className="mc-palette__empty" role="presentation">
              No matching command.
            </li>
          ) : (
            results.map((cmd, i) => {
              const header =
                cmd.kind !== lastKind ? (cmd.kind === 'navigate' ? 'Navigate' : 'Act') : null;
              lastKind = cmd.kind;
              const isSel = i === selected;
              return (
                <li key={cmd.id} role="presentation">
                  {header ? (
                    <span className="mc-palette__group" role="presentation">
                      {header}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    id={optionId(cmd)}
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={cmd.disabled || undefined}
                    data-testid={`palette-cmd-${cmd.id}`}
                    className={`mc-palette__opt${isSel ? ' mc-palette__opt--selected' : ''}${
                      cmd.disabled ? ' mc-palette__opt--disabled' : ''
                    }`}
                    // Keep focus in the input (don't blur to the button on click).
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => run(cmd)}
                  >
                    <span className="mc-palette__opt-icon mc-mono" aria-hidden="true">
                      {cmd.icon}
                    </span>
                    <span className="mc-palette__opt-label">{cmd.label}</span>
                    {cmd.hint ? <span className="mc-palette__opt-hint mc-mono">{cmd.hint}</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
