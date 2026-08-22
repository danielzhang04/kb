import { useState } from 'react';
import type { EntityBuilderRequest, EntityDetail } from '../../server/entities/contracts.ts';
import { useSession } from '../lib/sessionContext';

export function EntityBuilderForm({ kind, detail, onSaved, onCancel }: {
  kind: 'agent' | 'workflow';
  detail: EntityDetail;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const config = detail.details.builder;
  const [value, setValue] = useState<EntityBuilderRequest>(() => config?.value ?? { humanName: detail.summary.humanName, purpose: detail.brief.purpose, model: '', profile: '', tools: [], skills: [], connectors: [], filesystemRoots: [] });
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
    <fieldset><legend>Tools</legend>{config.tools.map((item) => <label key={item}><input type="checkbox" checked={value.tools.includes(item)} onChange={() => toggle('tools', item)} />{item}</label>)}</fieldset>
    <fieldset><legend>Skills</legend>{config.skills.map((item) => <label key={item}><input type="checkbox" checked={value.skills.includes(item)} onChange={() => toggle('skills', item)} />{item}</label>)}</fieldset>
    <fieldset><legend>Connectors</legend>{config.connectors.map((grant) => <label key={grant.server}><input type="checkbox" checked={value.connectors.some((item) => item.server === grant.server)} onChange={() => toggleConnector(grant.server)} />{grant.server}: {grant.tools.join(', ') || 'no tools'}</label>)}</fieldset>
    <fieldset><legend>Filesystem roots</legend>{config.filesystemRoots.map((item) => <label key={item}><input type="checkbox" checked={value.filesystemRoots.includes(item)} onChange={() => toggle('filesystemRoots', item)} />{item}</label>)}</fieldset>
    <div><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save for review'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
    {error ? <p role="status">{error}</p> : null}
  </form>;
}
