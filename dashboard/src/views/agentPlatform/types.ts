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
  /** Stable, unique id. Doubles as the sort key for the grid and as the React key. */
  id: string;
  /** Tile heading. */
  title: string;
  /** One-line tile subtitle: what the panel shows. */
  description: string;
  /** The panel body, rendered when its tile is opened. */
  render: () => React.JSX.Element;
}
