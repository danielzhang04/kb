import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntityDetail as EntityDetailDto, EntityGroup } from '../../server/entities/contracts.ts';
import { EntityCard } from '../entity/EntityCard';
import { EntityDetail } from '../entity/EntityDetail';
import { EntityBuilderForm } from '../entity/EntityBuilderForm';
import { humanizeEntityId } from '../entity/humanizeEntityId';
import { persistEntityLayout, readEntityLayout, type EntityLayout } from '../entity/entityLayout';
import { fetchEntityDetail, fetchEntityList } from '../lib/entityClient';
import { useSession } from '../lib/sessionContext';
import type { NavTarget } from '../nav/stack';
import { RunDetail } from './RunDetail';
import { WorkflowDetailBody, WorkflowTechnicalDetails } from './WorkflowDetail';
import '../styles/views/entity.css';
import '../styles/views/workflows.css';

export interface WorkflowsProps {
  filter?: 'attention';
  focusWorkflowId?: string | null;
  focusRunRef?: string | null;
  onOpenWorkflow?: (id: string) => void;
  onOpenRun?: (runRef: string) => void;
  onBack?: () => void;
  onNavigate?: (target: NavTarget) => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onOpenTerminal?: (workflow: { id: string }) => void;
}

export function Workflows({
  filter: rosterFilter,
  focusWorkflowId = null,
  focusRunRef = null,
  onOpenWorkflow,
  onOpenRun,
  onBack,
  onNavigate,
  activeSectionId,
  onSectionChange,
  onOpenTerminal,
}: WorkflowsProps = {}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchEntityList>> | null>(null);
  const [listError, setListError] = useState(false);
  const [detail, setDetail] = useState<EntityDetailDto | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<EntityLayout>(() => readEntityLayout('workflows'));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const openId = focusWorkflowId ?? localOpen;

  const loadList = useCallback(() => {
    setListError(false);
    void fetchEntityList('workflows').then(setList).catch(() => setListError(true));
  }, []);
  const loadDetail = useCallback((id: string) => {
    setDetail(null);
    setDetailError(false);
    setParameters({});
    void fetchEntityDetail('workflows', id).then(setDetail).catch(() => setDetailError(true));
  }, []);
  useEffect(loadList, [loadList]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [loadDetail, openId]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (list?.groups ?? []).map((group): EntityGroup => ({
      ...group,
      items: group.items.filter((item) => (rosterFilter !== 'attention' || item.gatedRunCount > 0)
        && (item.humanName.toLowerCase().includes(needle) || item.ref.id.toLowerCase().includes(needle))),
    })).filter((group) => group.items.length > 0);
  }, [list, rosterFilter, search]);

  if (focusRunRef) return <RunDetail runRef={focusRunRef} onBack={onBack} backLabel="Workflows" onNavigate={onNavigate} />;

  const open = (id: string): void => { setLocalOpen(id); onOpenWorkflow?.(id); };
  const close = (): void => { setLocalOpen(null); setEditing(false); if (focusWorkflowId) onBack?.(); };
  const changeLayout = (next: EntityLayout): void => { setLayout(next); persistEntityLayout('workflows', next); };
  const launch = async (): Promise<void> => {
    if (!detail || launching) return;
    const missing = (detail.details.workflow?.parameters ?? []).filter((name) => !(parameters[name] ?? '').trim());
    if (missing.length > 0) {
      setLaunchStatus(`Run refused: provide required parameters: ${missing.map(humanizeEntityId).join(', ')}.`);
      return;
    }
    setLaunching(true);
    setLaunchStatus(null);
    try {
      const active = session ?? await requireSession();
      if (!active) throw new Error('session-required');
      const response = await fetch(`/api/workflows/${encodeURIComponent(detail.summary.ref.id)}/launch`, {
        method: 'POST',
        headers: { authorization: `Bearer ${active.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: `workflow-launch:${detail.summary.ref.id}:${crypto.randomUUID()}`, parameters }),
      });
      const body = await response.json() as { run?: { runRef?: string }; runRef?: string; error?: string };
      const runRef = body.run?.runRef ?? body.runRef;
      if (!response.ok) setLaunchStatus(body.error ?? 'Launch refused');
      else if (runRef) { onOpenRun?.(runRef); onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: runRef } }); }
      else setLaunchStatus('Launch accepted');
    } catch {
      setLaunchStatus('Launch unavailable');
    } finally {
      setLaunching(false);
    }
  };

  const requiredParameters = detail?.details.workflow?.parameters ?? [];

  return <section className="code-view entity-roster" aria-label="Workflows view">
    <header className="page-header"><div><p className="page-eyebrow">Automation</p><h2>Workflows</h2></div></header>
    <div className="entity-roster-controls">
      <input aria-label="Search workflows" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflows" />
      <button type="button" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}>Grid</button>
      <button type="button" aria-pressed={layout === 'list'} onClick={() => changeLayout('list')}>List</button>
    </div>
    {listError ? <div className="entity-row" role="status">Workflows unavailable <button type="button" onClick={loadList}>Retry</button></div> : null}
    {!list && !listError ? <p role="status">Loading workflows…</p> : null}
    <div className={`entity-card-groups entity-card-groups--${layout}`}>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return <section key={group.id} className="entity-card-group">
          <button type="button" className="entity-card-group__toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed((value) => { const next = new Set(value); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{group.label} <span className="mc-mono">{group.items.length}</span></button>
          {!isCollapsed ? <div className="entity-card-grid">{group.items.map((summary) => <EntityCard key={`${summary.ref.type}:${summary.ref.id}`} summary={summary} onOpen={() => open(summary.ref.id)} />)}</div> : null}
        </section>;
      })}
    </div>
    {openId ? <EntityDetail
      entity={{ kind: 'workflow', id: openId }} eyebrow="Workflow" title={humanizeEntityId(openId)}
      status={detail ? { label: detail.summary.status === 'needs-you' ? 'Needs you' : humanizeEntityId(detail.summary.status), tone: detail.summary.status === 'failed' ? 'error' : detail.summary.status === 'needs-you' ? 'warn' : detail.summary.status === 'running' ? 'running' : 'idle' } : undefined}
      facts={detail ? [{ label: 'Model', value: detail.summary.modelLabel }, { label: 'Host', value: detail.summary.host === 'vm' ? 'VM' : 'Desktop' }, { label: 'Last activity', value: detail.summary.temporalLabel, mono: true }] : []}
      sections={detail ? [
        { id: 'live', label: 'Live', count: detail.summary.gatedRunCount, attention: detail.summary.gatedRunCount > 0, render: () => <WorkflowDetailBody detail={detail} onOpenRun={onOpenRun} onNavigate={onNavigate} /> },
        { id: 'brief', label: 'Brief', render: () => <WorkflowDetailBody detail={detail} surface="brief" onOpenRun={onOpenRun} onNavigate={onNavigate} /> },
      ] : [{ id: 'live', label: 'Live', render: () => detailError ? <p role="status">Workflow detail unavailable <button type="button" onClick={() => loadDetail(openId)}>Retry</button></p> : <p role="status">Loading workflow…</p> }]}
      activeSectionId={activeSectionId} onSectionChange={onSectionChange}
      actions={detail ? <>
        {requiredParameters.map((name) => <label key={name}>{humanizeEntityId(name)}<input value={parameters[name] ?? ''} onChange={(event) => setParameters((value) => ({ ...value, [name]: event.target.value }))} /></label>)}
        <button type="button" disabled={launching} onClick={() => void launch()}>{launching ? 'Starting…' : 'Run now'}</button>
        <button type="button" onClick={() => onNavigate?.({ view: 'schedules', section: 'new', scheduleOwner: detail.summary.ref })}>Schedule</button>
        <button type="button" onClick={() => setEditing((value) => !value)}>Edit</button>
        <button type="button" onClick={() => onOpenTerminal?.({ id: openId })}>Open terminal</button>
        {launchStatus ? <span role="status">{launchStatus}</span> : null}
      </> : null}
      editorContent={editing && detail ? <EntityBuilderForm kind="workflow" detail={detail} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); loadDetail(openId); loadList(); }} /> : undefined}
      overlay onClose={close} detailsContent={detail ? <WorkflowTechnicalDetails detail={detail} /> : undefined}
    /> : null}
  </section>;
}
