import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import './figment.css';

type ReviewState = 'unreviewed' | 'stale' | 'approved' | 'unknown';
type MachineGateState = 'current' | 'stale' | null;
type Tab = 'creators' | 'assets' | 'plans' | 'records' | 'research';
interface RecordRow { path: string; type: string; creator: string | null; reviewState: ReviewState; machineGateState: MachineGateState; schema: string | null; }
interface ResearchArtifact { area: 'research' | 'book'; name: string; bytes: number; modifiedAt: string; }
interface TesterPreview { schema: 'figment/plan-preview@1'; offlinePreview: true; notPromotable: true; creator: 'creator-001'; stage: 'tester'; runCount: number; declaredCeilingUsd: number; manifestSha256: string; }
interface DeclaredReference { creator: string; name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string; }
interface GeneratedInput { name: string; bytes: number; sha256: string; width: number; height: number; sourceReference: string; sourceSha256: string; generatedOn: string | null; reviewStatus: string; visualReview: Record<string, string>; }
interface Projection {
  schema: 'figment/hub@1'; available: boolean;
  creators: Array<{ id: string; persona: 'valid' | 'malformed'; loraTier: string | null; loraTrigger: string | null; accountTiers: string[] }>;
  creatorsTruncated: boolean; records: RecordRow[]; recordsTruncated: boolean;
  plans: { items: Array<{ path: string; creator: string; variant: string | null; stages: Array<{ name: string; runCount: number; declaredCeilingUsd: number | null }>; declaredCeilingUsd: number }>; truncated: boolean };
  research: { available: boolean; artifacts: ResearchArtifact[]; truncated: boolean };
  references: { items: DeclaredReference[]; truncated: boolean };
  generatedInputs: { available: boolean; items: GeneratedInput[]; truncated: boolean };
  diagnostic: { status: 'not-configured' } | { status: 'unavailable'; reason: string } | { status: 'diagnostic-not-promotable'; dryRun: boolean | null; podId: string | null; artifacts: Array<{ name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string }>; artifactsTruncated: boolean };
}

const states = new Set<ReviewState>(['unreviewed', 'stale', 'approved', 'unknown']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const bounded = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 512;
const safeArtifactName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/.test(name) && name !== '.' && name !== '..' && !name.includes('..');
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function valid(value: unknown): Projection | null {
  if (!object(value) || value.schema !== 'figment/hub@1' || typeof value.available !== 'boolean' || !bounded(value.creators) || typeof value.creatorsTruncated !== 'boolean' || !bounded(value.records) || typeof value.recordsTruncated !== 'boolean' || !object(value.plans) || !bounded(value.plans.items) || typeof value.plans.truncated !== 'boolean' || !object(value.research) || typeof value.research.available !== 'boolean' || !bounded(value.research.artifacts) || typeof value.research.truncated !== 'boolean' || !object(value.references) || !bounded(value.references.items) || typeof value.references.truncated !== 'boolean' || !object(value.generatedInputs) || typeof value.generatedInputs.available !== 'boolean' || !bounded(value.generatedInputs.items) || typeof value.generatedInputs.truncated !== 'boolean' || !object(value.diagnostic)) return null;
  if (!value.creators.every((row) => object(row) && string(row.id) && (row.persona === 'valid' || row.persona === 'malformed') && nullableString(row.loraTier) && nullableString(row.loraTrigger) && bounded(row.accountTiers) && row.accountTiers.every(string))) return null;
  if (!value.records.every((row) => object(row) && string(row.path) && string(row.type) && nullableString(row.creator) && nullableString(row.schema) && states.has(row.reviewState as ReviewState) && (row.machineGateState === null || row.machineGateState === 'current' || row.machineGateState === 'stale'))) return null;
  if (!value.plans.items.every((plan) => object(plan) && string(plan.path) && string(plan.creator) && nullableString(plan.variant) && finite(plan.declaredCeilingUsd) && bounded(plan.stages) && plan.stages.every((stage) => object(stage) && string(stage.name) && finite(stage.runCount) && (stage.declaredCeilingUsd === null || finite(stage.declaredCeilingUsd))))) return null;
  if (!value.research.artifacts.every((row) => object(row) && (row.area === 'research' || row.area === 'book') && string(row.name) && finite(row.bytes) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt)))) return null;
  if (!value.references.items.every((row) => object(row) && string(row.creator) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt)))) return null;
  if (!value.generatedInputs.items.every((row) => object(row) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.sourceReference) && sha256(row.sourceSha256) && nullableString(row.generatedOn) && string(row.reviewStatus) && object(row.visualReview) && Object.values(row.visualReview).every(string))) return null;
  const d = value.diagnostic;
  if (!(d.status === 'not-configured' || d.status === 'unavailable' && string(d.reason) || d.status === 'diagnostic-not-promotable' && (typeof d.dryRun === 'boolean' || d.dryRun === null) && nullableString(d.podId) && typeof d.artifactsTruncated === 'boolean' && bounded(d.artifacts) && d.artifacts.every((row) => object(row) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt))))) return null;
  return value as unknown as Projection;
}

function validTesterPreview(value: unknown): TesterPreview | null {
  return object(value) && value.schema === 'figment/plan-preview@1' && value.offlinePreview === true && value.notPromotable === true && value.creator === 'creator-001' && value.stage === 'tester' && finite(value.runCount) && value.runCount >= 1 && value.runCount <= 8 && finite(value.declaredCeilingUsd) && value.declaredCeilingUsd <= 50 && sha256(value.manifestSha256) ? value as unknown as TesterPreview : null;
}

function bytes(value: number): string { return value < 1024 ? `${value} B` : value < 1048576 ? `${Math.round(value / 1024)} KB` : `${(value / 1048576).toFixed(1)} MB`; }
function approval(state: ReviewState): string { return state === 'approved' ? 'Approved' : state === 'stale' ? 'Stale' : state === 'unreviewed' ? 'Unreviewed' : 'Approval unknown'; }
function diagnostic(d: Projection['diagnostic']): string { return d.status === 'diagnostic-not-promotable' ? 'Diagnostic evidence — not promotable' : d.status === 'not-configured' ? 'No diagnostic root configured' : `Diagnostic evidence unavailable: ${d.reason.replaceAll('-', ' ')}`; }
function requestOptions(token?: string): RequestInit { return token ? { headers: { authorization: `Bearer ${token}` } } : {}; }
function artifactPath(artifact: ResearchArtifact): string | null {
  if (!safeArtifactName(artifact.name)) return null;
  return artifact.area === 'book' ? `orgs/figment/research/book/${artifact.name}` : `orgs/figment/research/${artifact.name}`;
}
function resolveArticleLink(current: string, href: string, known: ReadonlySet<string>): string | null {
  if (href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) return null;
  try {
    const base = `https://figment.local/${current.slice(0, current.lastIndexOf('/') + 1)}`;
    const resolved = new URL(href, base);
    return resolved.origin === 'https://figment.local' && known.has(resolved.pathname.slice(1)) ? resolved.pathname.slice(1) : null;
  } catch { return null; }
}

function CopyPath({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => { const clipboard = navigator.clipboard; if (clipboard) void clipboard.writeText(path).then(() => setCopied(true)).catch(() => undefined); };
  return <button type="button" className="figment__copy" title={path} aria-label={`Copy record path ${path}`} onClick={copy}>{copied ? 'Copied' : 'Copy path'}</button>;
}

function Creators({ rows, truncated }: { rows: Projection['creators']; truncated: boolean }): React.JSX.Element {
  if (!rows.length) return <p className="figment__empty">No creator personas are recorded.</p>;
  return <><div className="figment__grid">{rows.map((c) => <article className="figment__card" key={c.id}><h2>{c.id}</h2><p><span className={`figment__badge figment__badge--${c.persona}`}>{c.persona === 'valid' ? 'Persona record' : 'Malformed persona record'}</span></p><dl><dt>LoRA tier</dt><dd>{c.loraTier ?? 'Not set'}</dd><dt>Persona LoRA trigger</dt><dd>{c.loraTrigger ?? 'Not recorded in persona'}</dd><dt>Account tiers</dt><dd>{c.accountTiers.join(', ') || 'None recorded'}</dd></dl></article>)}</div>{truncated ? <p className="figment__notice">The creator list reached its safe display limit.</p> : null}</>;
}

function Records({ rows, truncated }: { rows: RecordRow[]; truncated: boolean }): React.JSX.Element {
  if (!rows.length) return <p className="figment__empty">No driver, run, gate, or accepted-checkpoint records are available.</p>;
  return <><div className="figment__records">{rows.map((r) => <article className="figment__record" key={r.path}><div><h2>{r.type.replaceAll('-', ' ')}</h2><p>{r.creator ?? 'Shared Figment record'}{r.schema ? ` · ${r.schema}` : ''}</p><code className="figment__record-path">{r.path}</code></div><div className="figment__evidence"><span className={`figment__badge figment__badge--${r.reviewState}`}>{approval(r.reviewState)}</span>{r.machineGateState ? <span className={`figment__badge figment__badge--machine-${r.machineGateState}`}>Machine gate {r.machineGateState}</span> : null}<CopyPath path={r.path} /></div></article>)}</div>{truncated ? <p className="figment__notice">The record list reached its safe display limit.</p> : null}</>;
}

function Plans({ plans, token, fetchImpl }: { plans: Projection['plans']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [preview, setPreview] = useState<TesterPreview | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const generateTesterPreview = (): void => {
    setPending(true); setError(null); setPreview(null);
    void fetchImpl('/api/figment/plan-preview/tester', { ...requestOptions(token), method: 'POST' }).then(async (response) => {
      const payload: unknown = await response.json(); const decoded = response.ok ? validTesterPreview(payload) : null;
      if (decoded === null) throw new Error('The offline tester preview is unavailable.');
      setPreview(decoded);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'The offline tester preview is unavailable.')).finally(() => setPending(false));
  };
  return <><p className="figment__inert">Offline preview of existing plans. Declared ceilings are not live estimates and this page cannot start a run.</p><section className="figment__preview"><h2>Tester plan preview</h2><p>Builds a fresh, local-only tester plan for creator-001 with pin verification skipped. It cannot run a pod, create an approval, or promote a checkpoint.</p><button type="button" className="mc-btn" onClick={generateTesterPreview} disabled={pending}>{pending ? 'Building preview…' : 'Preview tester plan'}</button>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}{preview ? <p role="status">{preview.creator} · {preview.stage} · {preview.runCount} planned run{preview.runCount === 1 ? '' : 's'} · declared ${preview.declaredCeilingUsd.toFixed(2)} · manifest {preview.manifestSha256.slice(0, 12)}</p> : null}</section>{plans.items.length ? <div className="figment__plans">{plans.items.map((plan) => <article className="figment__plan" key={plan.path}><h2>{plan.creator}{plan.variant ? ` · ${plan.variant}` : ''}</h2><code className="figment__record-path">{plan.path}</code><p>Declared ceiling: ${plan.declaredCeilingUsd.toFixed(2)}</p><ul>{plan.stages.map((stage) => <li key={stage.name}><strong>{stage.name}</strong> · {stage.runCount} run{stage.runCount === 1 ? '' : 's'} · declared ${stage.declaredCeilingUsd?.toFixed(2) ?? 'unavailable'}</li>)}</ul></article>)}</div> : <p className="figment__empty">No frozen Figment plans are available.</p>}{plans.truncated ? <p className="figment__notice">The plan list reached its safe display limit.</p> : null}</>;
}

function DeclaredReferences({ references, token, fetchImpl }: { references: Projection['references']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const creators = [...new Set(references.items.map((item) => item.creator))]; const [creator, setCreator] = useState(creators[0] ?? ''); const [assets, setAssets] = useState<Array<{ name: string; url: string; width: number; height: number }>>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!creators.includes(creator)) setCreator(creators[0] ?? ''); }, [creator, creators.join('|')]);
  const selected = references.items.filter((item) => item.creator === creator);
  useEffect(() => {
    let live = true; const controllers: AbortController[] = []; const urls: string[] = []; let next = 0; const results: Array<{ name: string; url: string; width: number; height: number } | undefined> = new Array(selected.length);
    setAssets([]); setError(null);
    const load = async (): Promise<void> => { while (live && next < selected.length) { const index = next; next += 1; const asset = selected[index]; const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/reference-assets/${encodeURIComponent(asset.creator)}/${encodeURIComponent(asset.name)}?sha256=${asset.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error(response.status === 409 ? 'A declared reference changed before it could be viewed.' : 'A declared reference could not be read.'); const blob = await response.blob(); if (!live) return; const url = URL.createObjectURL(blob); urls.push(url); results[index] = { name: asset.name, url, width: asset.width, height: asset.height }; setAssets(results.filter((item): item is NonNullable<typeof item> => item !== undefined)); } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A declared reference could not be read.'); } } };
    void Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => load()));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [creator, fetchImpl, token, references]);
  if (!creators.length) return <section className="figment__references"><h2>Declared persona references</h2><p className="figment__empty">No declared persona references are available.</p></section>;
  return <section className="figment__references"><h2>Declared persona references</h2><p className="figment__inert">Declared inputs only. They do not associate a diagnostic with this creator and do not approve an identity or checkpoint.</p><label>Selected creator <select aria-label="Selected reference creator" value={creator} onChange={(event) => setCreator(event.target.value)}>{creators.map((id) => <option key={id} value={id}>{id}</option>)}</select></label><p className="figment__inert">Reference files: {selected.map((asset) => asset.name).join(', ')}</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets">{assets.map((asset) => <figure className="figment__asset" key={asset.name}><img src={asset.url} alt={`Declared reference ${creator} ${asset.name}`} /><figcaption>{asset.name} | {asset.width}x{asset.height}</figcaption></figure>)}</div>{references.truncated ? <p className="figment__notice">The declared reference list reached its safe review limit.</p> : null}</section>;
}

function DiagnosticAssets({ diagnostic, token, fetchImpl }: { diagnostic: Projection['diagnostic']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Array<{ name: string; url: string; width: number; height: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (diagnostic.status !== 'diagnostic-not-promotable' || !diagnostic.artifacts.length) { setAssets([]); setError(null); return; }
    let live = true; let next = 0; const controllers: AbortController[] = []; const urls: string[] = [];
    const results: Array<{ name: string; url: string; width: number; height: number } | undefined> = new Array(diagnostic.artifacts.length);
    setAssets([]); setError(null);
    const load = async (): Promise<void> => {
      while (live && next < diagnostic.artifacts.length) {
        const index = next; next += 1; const artifact = diagnostic.artifacts[index]; const controller = new AbortController(); controllers.push(controller);
        try {
          const response = await fetchImpl(`/api/figment/diagnostic-assets/${encodeURIComponent(artifact.name)}?sha256=${artifact.sha256}`, { ...requestOptions(token), signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 409 ? 'A listed diagnostic asset changed before it could be reviewed.' : 'A listed diagnostic asset could not be read.');
          const blob = await response.blob(); if (!live) return;
          const url = URL.createObjectURL(blob); urls.push(url); results[index] = { name: artifact.name, url, width: artifact.width, height: artifact.height };
          setAssets(results.filter((item): item is NonNullable<typeof item> => item !== undefined));
        } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A listed diagnostic asset could not be read.'); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, diagnostic.artifacts.length) }, () => load()));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [diagnostic, fetchImpl, token]);
  if (diagnostic.status !== 'diagnostic-not-promotable') return <p className="figment__empty">No diagnostic assets are available for review.</p>;
  if (!diagnostic.artifacts.length) return <p className="figment__empty">This diagnostic record lists no reviewable PNG assets.</p>;
  return <><p className="figment__inert">Diagnostic assets only. They are not promotable and do not approve identity, quality, or a checkpoint.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets">{assets.map((asset) => <figure className="figment__asset" key={asset.name}><img src={asset.url} alt={`Diagnostic asset ${asset.name}`} /><figcaption>{asset.name} · {asset.width}×{asset.height}</figcaption></figure>)}</div>{diagnostic.artifactsTruncated ? <p className="figment__notice">The diagnostic asset list reached its safe review limit.</p> : null}</>;
}

const generatedObservationLabels: Record<string, string> = {
  identity: 'Identity',
  clothing: 'Clothing',
  adult_presentation: 'Adult presentation',
  realism: 'Realism',
  coverage: 'Coverage',
  independent_findings: 'Independent observation',
  independent_observation: 'Independent observation',
};

function generatedObservationLabel(name: string): string {
  return generatedObservationLabels[name] ?? name.replaceAll('_', ' ');
}

function GeneratedInputs({ generated, token, fetchImpl }: { generated: Projection['generatedInputs']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Array<{ name: string; url: string }>>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!generated.available || !generated.items.length) { setAssets([]); return; } let live = true; const controllers: AbortController[] = []; const urls: string[] = []; let next = 0; const results: Array<{ name: string; url: string } | undefined> = new Array(generated.items.length); setAssets([]); setError(null); const load = async (): Promise<void> => { while (live && next < generated.items.length) { const index = next++; const item = generated.items[index]; const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/generated-input-assets/${encodeURIComponent(item.name)}?sha256=${item.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error('A listed generated input changed before it could be viewed.'); const url = URL.createObjectURL(await response.blob()); if (!live) { URL.revokeObjectURL(url); return; } urls.push(url); results[index] = { name: item.name, url }; setAssets(results.filter((row): row is { name: string; url: string } => row !== undefined)); } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A generated input could not be read.'); } } }; void Promise.all(Array.from({ length: Math.min(3, generated.items.length) }, () => load())); return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); }; }, [generated, token, fetchImpl]);
  if (!generated.available) return <></>;
  return <section className="figment__references"><h2>Generated-input experiments: creator-001 (unapproved)</h2><p className="figment__inert">These creator-001 experiments use g01 as the provisional seed; g02 and g07 remain comparators. Immutable provenance snapshots and recorded review declarations only. They may not reflect later independent review. These are not accepted references, identity proof, training data, or approvals.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets figment__generated-assets">{assets.map((asset) => { const item = generated.items.find((row) => row.name === asset.name); return item ? <figure className="figment__asset figment__generated-asset" key={item.name}><img src={asset.url} alt={`Generated input experiment ${item.name}`} /><figcaption><strong>{item.name}</strong><span>{item.width}x{item.height} · Generated on: {item.generatedOn ?? 'not recorded'}</span><dl className="figment__generated-observations"><dt>Recorded observations</dt><dd><strong>Status</strong>: {item.reviewStatus}</dd>{Object.entries(item.visualReview).map(([label, observation]) => <dd key={label}><strong>{generatedObservationLabel(label)}</strong>: {observation}</dd>)}</dl><details><summary>Source and hashes</summary><dl><dt>Declared source</dt><dd>{item.sourceReference}</dd><dt>Source SHA-256</dt><dd>{item.sourceSha256}</dd><dt>Output SHA-256</dt><dd>{item.sha256}</dd></dl></details></figcaption></figure> : null; })}</div>{generated.truncated ? <p className="figment__notice">The generated-input list reached its safe review limit.</p> : null}</section>;
}

function Assets({ diagnostic, references, generatedInputs, token, fetchImpl }: { diagnostic: Projection['diagnostic']; references: Projection['references']; generatedInputs: Projection['generatedInputs']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  return <><DeclaredReferences references={references} token={token} fetchImpl={fetchImpl} /><GeneratedInputs generated={generatedInputs} token={token} fetchImpl={fetchImpl} /><DiagnosticAssets diagnostic={diagnostic} token={token} fetchImpl={fetchImpl} /></>;
}

function Research({ research, token, fetchImpl }: { research: Projection['research']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [article, setArticle] = useState<{ path: string; content: string | null }>({ path: '', content: null });
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const known = new Set(research.artifacts.flatMap((artifact) => { const path = artifactPath(artifact); return path ? [path] : []; }));
  const invalidateRequest = (): void => {
    request.current.controller?.abort();
    request.current = { generation: request.current.generation + 1, controller: null };
  };
  useEffect(() => () => invalidateRequest(), []);
  const open = (path: string): void => {
    if (!known.has(path)) { setError('This item is outside the listed Figment research artifacts.'); return; }
    invalidateRequest();
    const controller = new AbortController();
    const generation = request.current.generation + 1;
    request.current = { generation, controller };
    setArticle({ path, content: null }); setError(null);
    void fetchImpl(`/api/kb/file?path=${encodeURIComponent(path)}`, { ...requestOptions(token), signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('research file unavailable');
      const payload: unknown = await response.json();
      if (!object(payload) || payload.path !== path || !string(payload.content)) throw new Error('invalid research file response');
      if (request.current.generation === generation && !controller.signal.aborted) setArticle({ path, content: payload.content });
    }).catch(() => {
      if (request.current.generation === generation && !controller.signal.aborted) setError('This research artifact could not be read.');
    });
  };
  const followLink = (event: React.MouseEvent<HTMLElement>): void => {
    const anchor = (event.target as Element).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href || /^https?:\/\//i.test(href) || href.startsWith('#') || /^mailto:/i.test(href)) return;
    event.preventDefault();
    const target = article.path ? resolveArticleLink(article.path, href, known) : null;
    if (target === null) { setError('This link is not a listed Figment research artifact.'); return; }
    open(target);
  };
  if (!research.available) return <p className="figment__empty">Research records are unavailable.</p>;
  if (article.path) return <section className="figment__reader" aria-label="Research reader"><button type="button" className="figment__back" onClick={() => { invalidateRequest(); setArticle({ path: '', content: null }); setError(null); }}>Back to research index</button><p className="figment__reader-path">{article.path}</p>{error ? <div className="figment__reader-error" role="alert"><p>{error}</p><button type="button" className="mc-btn" onClick={() => open(article.path)}>Retry</button></div> : article.content === null ? <p role="status">Loading research artifact…</p> : <article className="figment__reader-content" onClick={followLink} dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content, { tables: true }) }} />}</section>;
  if (!research.artifacts.length) return <p className="figment__empty">No research or book artifacts are recorded.</p>;
  return <><div className="figment__records">{research.artifacts.map((a) => { const path = artifactPath(a); return <article className="figment__record" key={`${a.area}/${a.name}`}><div><h2>{a.name}</h2><p>{a.area === 'book' ? 'Book artifact' : 'Research artifact'} · {bytes(a.bytes)}</p></div>{path ? <button type="button" className="figment__open" onClick={() => open(path)}>Read</button> : <span className="figment__inert">Unavailable filename</span>}<time dateTime={a.modifiedAt}>{new Date(a.modifiedAt).toLocaleDateString()}</time></article>; })}</div>{research.truncated ? <p className="figment__notice">The artifact list reached its safe display limit.</p> : null}</>;
}

export function FigmentWorkspace({ token, fetchImpl = fetch }: { token?: string; fetchImpl?: typeof fetch }): React.JSX.Element {
  const [projection, setProjection] = useState<Projection | null>(null); const [error, setError] = useState(false); const [refresh, setRefresh] = useState(0); const [tab, setTab] = useState<Tab>('creators');
  useEffect(() => { let live = true; setError(false); setProjection(null); void fetchImpl('/api/figment', requestOptions(token)).then(async (response) => { if (!response.ok) throw new Error('figment unavailable'); const decoded = valid(await response.json()); if (!decoded) throw new Error('invalid figment projection'); if (live) setProjection(decoded); }).catch(() => { if (live) setError(true); }); return () => { live = false; }; }, [fetchImpl, refresh, token]);
  if (!projection) return <main className="figment" aria-label="Figment workspace"><h1>Figment</h1><p role="status">{error ? 'Figment records are unavailable.' : 'Loading Figment records…'}</p>{error ? <button type="button" className="mc-btn" onClick={() => setRefresh((v) => v + 1)}>Retry</button> : null}</main>;
  if (!projection.available) return <main className="figment" aria-label="Figment workspace"><h1>Figment</h1><p className="figment__empty">The Figment project records are unavailable.</p></main>;
  return <main className="figment" aria-label="Figment workspace"><header className="figment__header"><div><h1>Figment</h1><p>Read-only project evidence. Machine-gate state does not approve a checkpoint.</p></div><p className={`figment__diagnostic figment__diagnostic--${projection.diagnostic.status}`}>{diagnostic(projection.diagnostic)}</p></header><div className="figment__tabs" role="tablist" aria-label="Figment workspace sections">{([['creators', 'Creators'], ['assets', 'Asset review'], ['plans', 'Frozen plans'], ['records', 'Runs & review'], ['research', 'Research']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'figment__tab figment__tab--active' : 'figment__tab'} onClick={() => setTab(id)}>{label}</button>)}</div><section role="tabpanel" className="figment__panel">{tab === 'creators' ? <Creators rows={projection.creators} truncated={projection.creatorsTruncated} /> : tab === 'assets' ? <Assets diagnostic={projection.diagnostic} references={projection.references} generatedInputs={projection.generatedInputs} token={token} fetchImpl={fetchImpl} /> : tab === 'plans' ? <Plans plans={projection.plans} token={token} fetchImpl={fetchImpl} /> : tab === 'records' ? <Records rows={projection.records} truncated={projection.recordsTruncated} /> : <Research research={projection.research} token={token} fetchImpl={fetchImpl} />}</section></main>;
}
