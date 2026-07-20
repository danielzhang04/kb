/** One primary entry into Composer. Artifact choices belong inside the workspace, after exploration. */
export function NewMenu({ onCreate, disabled = false }: { onCreate: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div className="mc-new">
      <button type="button" className="mc-new__trigger" onClick={onCreate} disabled={disabled}>
        <span className="mc-new__plus mc-mono" aria-hidden="true">+</span>
        <span className="mc-new__label">New</span>
      </button>
    </div>
  );
}
