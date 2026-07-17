/**
 * Atlas panel (D3.5) — a static stub for a FUTURE layer. It renders (so the layer set is complete and the
 * nav is exercised end-to-end) but carries no data source yet: it is explicitly labelled as a future
 * layer, mirroring the greyed Atlas nav stub. No fetch, no write path.
 */
import '../../styles/views/panels.css';

export function Atlas(): React.JSX.Element {
  return (
    <div className="v-panel v-panel--atlas" aria-label="Atlas panel">
      <div className="v-panel__header">
        <h2 className="v-panel__title">
          Atlas <span className="v-panel__soon">future layer</span>
        </h2>
        <span className="v-panel__note">
          The Atlas intelligence layer is not built yet. This panel is a placeholder so the layer set is
          complete; there is nothing to view or steer here until a later wave.
        </span>
      </div>
      <p className="v-panel__empty">Atlas arrives in a later wave.</p>
    </div>
  );
}
