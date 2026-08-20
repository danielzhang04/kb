/**
 * Agent Platform section (Wave-1 U0) — the extension point every later Agent Platform unit builds on.
 *
 * The section is a grid of panel tiles (title + description); clicking one swaps the body to that
 * panel's own render, mirroring the layer-panel tab-body swap in `App.tsx#LayerPanels` but as a
 * grid of cards rather than a tab bar. Tiles come entirely from
 * {@link AGENT_PLATFORM_PANELS} — auto-discovered from `agentPlatform/panels/*.panel.tsx`, so a new
 * panel is ONE new entry file (plus its own stylesheet) and no edit here — see
 * `agentPlatform/registry.ts` for the procedure and the house rules.
 *
 * Empty-registry safe: with no panels the section renders a plain placeholder instead of throwing.
 */
import { useState } from 'react';
import { AGENT_PLATFORM_PANELS } from './agentPlatform/registry';
import type { AgentPlatformPanel } from './agentPlatform/types';
import '../styles/views/agentPlatform.css';

export function AgentPlatform({
  /** Injectable for tests (the empty-registry case); production always uses the discovered set. */
  panels = AGENT_PLATFORM_PANELS,
}: {
  panels?: AgentPlatformPanel[];
} = {}): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = panels.find((p) => p.id === openId) ?? null;

  return (
    <section className="ap" aria-label="Agent Platform view">
      <header className="ap__header">
        <h2 className="ap__title">Agent Platform</h2>
        <p className="ap__note">
          Panels register themselves by file drop — one file per panel, no shared file edited.
        </p>
      </header>

      {active ? (
        <div className="ap__body">
          <button type="button" className="ap__back" onClick={() => setOpenId(null)}>
            ← All panels
          </button>
          <h3 className="ap__body-title">{active.title}</h3>
          {active.render()}
        </div>
      ) : panels.length === 0 ? (
        <p className="ap__empty">
          No panels registered yet. Add one at <code>src/views/agentPlatform/panels/</code>.
        </p>
      ) : (
        <div className="ap__grid">
          {panels.map((p) => (
            <button
              key={p.id}
              type="button"
              className="ap__tile"
              onClick={() => setOpenId(p.id)}
            >
              <span className="ap__tile-title">{p.title}</span>
              <span className="ap__tile-desc">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
