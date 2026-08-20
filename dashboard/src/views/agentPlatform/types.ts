/**
 * Agent Platform — the panel contract (U0).
 *
 * A panel is one self-contained tile on the Agent Platform section: a card in the grid (title +
 * description) that opens into whatever `render()` returns. The contract is deliberately tiny — a
 * panel owns its own data-fetching, its own state and its own markup, so panels never coordinate
 * through shared module state and a later panel can never break an earlier one.
 *
 * See `registry.ts` for how a panel file becomes a live tile (file drop only — no shared-file edit).
 */

export interface AgentPlatformPanel {
  /** Stable, unique id. The React key, and the grid's tie-breaking sort key. */
  id: string;
  /**
   * READING ORDER on the grid — lower first, ties broken by `id` (U12).
   *
   * Alphabetical-by-id put "Autonomy Ladder" before "Watch agents run" and buried "Agent Management"
   * next to "Brain Search": an ordering that is deterministic but says nothing about what to open
   * first. `order` lets the section read top-to-bottom the way an operator actually works — what is
   * running now, then who is allowed to do what, then the read-only forensics.
   *
   * OPTIONAL, and it stays optional: a panel that omits it sorts AFTER every panel that sets one,
   * alphabetically among its peers. So the zero-edit registration procedure is unchanged — drop a
   * file in and it appears, at the end, without anyone having to renumber a list. Values are spaced
   * (10, 20, 30…) so a panel can be slotted between two others without touching either.
   */
  order?: number;
  /** Tile heading. */
  title: string;
  /** One-line tile subtitle: what the panel shows. */
  description: string;
  /** A sidebar-owned panel is rendered by its own top-level destination, not the Platform grid. */
  placement?: 'agent-platform' | 'sidebar';
  /** The panel body, rendered when its tile is opened. */
  render: () => React.JSX.Element;
}
