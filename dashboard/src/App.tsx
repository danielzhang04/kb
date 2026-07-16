/**
 * Control-view landing shell (v0). An empty read-only observatory shell; the fleet
 * strip, registries, timeline, and Code-view toggle are populated by later D0 tasks.
 */
export function App() {
  return (
    <div className="control-shell">
      <header className="control-shell__header">
        <h1>kb Mission Control</h1>
        <span className="control-shell__badge">v0 · read-only observatory</span>
      </header>
      <main className="control-shell__body">
        <p>Control view. Fleet projection loads here once the Plane-A/Plane-B indexers land.</p>
      </main>
    </div>
  );
}
