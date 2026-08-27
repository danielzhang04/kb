import { useState } from 'react';
import type { EntityBuilderRequest, EntityDetail } from '../../server/entities/contracts.ts';
import { useSession } from '../lib/sessionContext';

function initialBuilderValue(detail: EntityDetail): EntityBuilderRequest {
  // The server owns this initial selection, including any profile defaults. The client never
  // broadens capabilities when the catalog does not provide a selection.
  return detail.details.builder?.value ?? {
    humanName: detail.summary.humanName,
    purpose: detail.brief.purpose,
    model: '',
    profile: '',
    tools: [],
    skills: [],
    connectors: [],
    filesystemRoots: [],
  };
}

export function EntityBuilderForm({ kind, detail, onSaved, onCancel }: {
  kind: 'agent' | 'workflow';
  detail: EntityDetail;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const config = detail.details.builder;
  const [value, setValue] = useState<EntityBuilderRequest>(() => initialBuilderValue(detail));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!config) return <p role="status">Editor choices unavailable.</p>;

  const update = (field: keyof EntityBuilderRequest, next: string): void => setValue((current) => ({ ...current, [field]: next }));
  const toggle = (field: 'tools' | 'skills' | 'filesystemRoots', item: string): void => setValue((current) => ({
    ...current, [field]: current[field].includes(item) ? current[field].filter((value) => value !== item) : [...current[field], item],
  }));
  const toggleConnector = (server: string): void => setValue((current) => ({
    ...current,
    connectors: current.connectors.some((grant) => grant.server === server)
      ? current.connectors.filter((grant) => grant.server !== server)
      : [...current.connectors, config.connectors.find((grant) => grant.server === server)!],
  }));
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const active = session ?? await requireSession();
      if (!active) throw new Error('Session required');
      const response = await fetch(`/api/${kind === 'agent' ? 'agents' : 'workflows'}/${encodeURIComponent(detail.summary.ref.id)}`, {
        method: 'PUT', headers: { authorization: `Bearer ${active.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...value, expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: `${kind}-edit:${detail.summary.ref.id}:${crypto.randomUUID()}` }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Edit refused');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Edit unavailable');
    } finally { setBusy(false); }
  };

  return <form className="entity-builder" aria-label={`Edit ${kind}`} onSubmit={(event) => void submit(event)}>
    <label>Name<input value={value.humanName} onChange={(event) => update('humanName', event.target.value)} /></label>
    <label>Purpose<textarea value={value.purpose} onChange={(event) => update('purpose', event.target.value)} /></label>
    <label>Model<select value={value.model} onChange={(event) => update('model', event.target.value)}>{config.models.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label>Profile<select value={value.profile} onChange={(event) => update('profile', event.target.value)}>{config.profiles.map((item) => <option key={item}>{item}</option>)}</select></label>
    {kind === 'workflow' && detail.summary.ref.type === 'workflow' ? <label>Project<select value={detail.summary.ref.project} disabled>{config.projects.map((item) => <option key={item}>{item}</option>)}</select></label> : null}
    <section className="entity-builder__capabilities" aria-labelledby="entity-builder-capabilities">
      <div>
        <h3 id="entity-builder-capabilities">Capabilities</h3>
        <p className="entity-note">Give this {kind} only what it needs. Fewer capabilities mean leaner context and a smaller blast radius, and you can add more later.</p>
      </div>
      <fieldset>
        <legend>Tools</legend>
        <p className="entity-note">Actions this {kind} can take in the workspace.</p>
        {config.tools.map((item) => <label key={item}><input type="checkbox" checked={value.tools.includes(item)} onChange={() => toggle('tools', item)} />{item}</label>)}
        {value.tools.length === 0 ? <p className="entity-note">No tools selected — this {kind} cannot take tool actions until you add some.</p> : null}
      </fieldset>
      <fieldset>
        <legend>Skills</legend>
        <p className="entity-note">Reusable instructions and methods this {kind} can load.</p>
        {config.skills.map((item) => <label key={item}><input type="checkbox" checked={value.skills.includes(item)} onChange={() => toggle('skills', item)} />{item}</label>)}
        {config.skills.length === 0 ? <p className="entity-note">No skills are available yet.</p> : null}
      </fieldset>
      <fieldset>
        <legend>Connectors</legend>
        <p className="entity-note">External services this {kind} may call.</p>
        {config.connectors.map((grant) => <label key={grant.server}><input type="checkbox" checked={value.connectors.some((item) => item.server === grant.server)} onChange={() => toggleConnector(grant.server)} />{grant.server}: {grant.tools.join(', ') || 'no tools'}</label>)}
        {config.connectors.length === 0 ? <p className="entity-note">No connectors are configured yet.</p> : null}
      </fieldset>
      <fieldset>
        <legend>Filesystem roots</legend>
        <p className="entity-note">Workspace locations this {kind} is allowed to access.</p>
        {config.filesystemRoots.map((item) => <label key={item}><input type="checkbox" checked={value.filesystemRoots.includes(item)} onChange={() => toggle('filesystemRoots', item)} />{item}</label>)}
        {config.filesystemRoots.length === 0 ? <p className="entity-note">No filesystem roots are available.</p> : null}
      </fieldset>
    </section>
    <div className="entity-builder__actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save as proposal'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
    <p className="entity-note entity-builder__save-note">Saved changes go to your Inbox for approval before they take effect.</p>
    {error ? <p role="status">{error}</p> : null}
  </form>;
}
