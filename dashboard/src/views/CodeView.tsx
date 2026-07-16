/**
 * Code view (D0.9 stub). Option B's "Code view one toggle away" — the VS-Code-like editor + terminal
 * are v1/v2 surfaces (D2 CodeMirror governed-save, D3 PTY) that land only behind their security gates
 * (ordering law 1/7). In v0 this is an intentional placeholder so the toggle has a destination; it
 * exposes no write, launch, or terminal capability.
 */
export function CodeView(): React.JSX.Element {
  return (
    <section className="code-view" aria-label="Code view">
      <h2 className="code-view__title">Code view</h2>
      <p className="code-view__note">
        The editor and terminal arrive with the v1/v2 waves, behind their WebAuthn + threat-review
        gates. Nothing to edit, run, or steer here yet.
      </p>
    </section>
  );
}
