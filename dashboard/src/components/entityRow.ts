/**
 * spec §2 — the two mechanics every clickable row that names an entity needs, once, in one place.
 *
 * `EntityName` owns a copy-the-id BUTTON. A row whose whole surface is a `<button>` therefore cannot
 * host one: nesting buttons is invalid DOM, and — the part that actually bites the operator — a click
 * on "copy" would bubble into the row handler and navigate away from the thing they just copied.
 *
 * So a row that renders an `EntityName` is a `div[role="button"]` (see {@link entityRowProps}) and
 * guards its own activation with {@link isEntityCopyClick}. Keyboard activation is preserved
 * explicitly, because that is what `<button>` was giving us for free.
 */

/** True when the event originated inside an `EntityName` copy affordance, which owns that click. */
export function isEntityCopyClick(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.entity-name__copy') !== null;
}

/**
 * The props that make a non-`button` element behave like one. Spread onto the row element; keep the
 * row's own `className` / `data-testid` / `aria-*` alongside.
 */
export function entityRowProps(onActivate: () => void): {
  role: 'button';
  tabIndex: 0;
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: (event) => {
      if (isEntityCopyClick(event.target)) return;
      onActivate();
    },
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (isEntityCopyClick(event.target)) return;
      event.preventDefault();
      onActivate();
    },
  };
}
