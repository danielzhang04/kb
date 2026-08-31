import { useCallback, useEffect, useMemo, useState } from 'react';
import { SYSTEM_ENTITY_GROUP_ID, type EntityDetail as EntityDetailDto, type EntityGroup } from '../../server/entities/contracts.ts';
import { EntityCard } from '../entity/EntityCard';
import { EntityDetail } from '../entity/EntityDetail';
import { EntityBuilderForm } from '../entity/EntityBuilderForm';
import { humanizeEntityId } from '../entity/humanizeEntityId';
import { fetchAgentDetail, fetchAgentList } from '../lib/agentClient';
import { useSession } from '../lib/sessionContext';
import type { NavTarget } from '../nav/stack';
import { AgentDetailBody } from './AgentDetail';
import '../styles/views/agents.css';
import '../styles/views/entity.css';

function DetailValues({ detail }: { detail: EntityDetailDto }): React.JSX.Element {
  const values: Array<[string, string]> = [
    ['Source', detail.details.sourcePath],
    ['Revision', detail.details.sourceRevision],
    ['Tools', detail.details.tools.join(', ') || 'None declared'],
    ['Declared ceiling', detail.details.declaredCeiling],
    ['Replaces', detail.details.replaces.join(', ') || 'None'],
    ['Builds on', detail.details.buildsOn.join(', ') || 'None'],
    ['Knowledge', detail.details.knowledgeSources.join(', ') || 'None'],
    ['Skills', detail.details.skills.join(', ') || 'None'],
    ['Schemas', detail.details.schemas.join(', ') || 'None'],
    ['Lineage', detail.details.lineage.join(', ') || 'None'],
    ['Grades', detail.details.grades.join(', ') || 'None'],
    ['IDs', detail.details.ids.join(', ') || 'None'],
  ];
  return <dl className="entity-technical-list">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mc-mono">{value}</dd></div>)}</dl>;
}

function launchRefusalMessage(error: string | undefined): string {
  if (error === 'agent-not-launchable') return "This agent isn't activated to run yet.";
  if (error === 'no-complete-placement') return 'No host is available to run this right now.';
  return error ?? 'Launch refused';
}

export interface AgentsProps {
  filter?: 'attention';
  focusAgentId?: string | null;
  onOpenAgent?: (id: string) => void;
  onBack?: () => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  onOpenTerminal?: (agent: { id: string }) => void;
}

export function Agents({
  filter: rosterFilter,
  focusAgentId = null,
  onOpenAgent,
  onBack,
  activeSectionId,
  onSectionChange,
  onNavigate,
  onOpenTerminal,
}: AgentsProps = {}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchAgentList>> | null>(null);
  const [listError, setListError] = useState(false);
  const [detail, setDetail] = useState<EntityDetailDto | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set([SYSTEM_ENTITY_GROUP_ID]));
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const openId = focusAgentId ?? localOpen;

  const loadList = useCallback(() => {
    setListError(false);
    void fetchAgentList().then(setList).catch(() => setListError(true));
  }, []);
  const loadDetail = useCallback((id: string) => {
    setDetail(null);
    setDetailError(false);
    void fetchAgentDetail(id).then(setDetail).catch(() => setDetailError(true));
  }, []);

  useEffect(loadList, [loadList]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [loadDetail, openId]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (list?.groups ?? []).map((group): EntityGroup => ({
      ...group,
      items: group.items.filter((item) => (rosterFilter !== 'attention' || item.gatedRunCount > 0)
        && (item.humanName.toLowerCase().includes(needle) || item.ref.id.toLowerCase().includes(needle))),
    })).filter((group) => group.items.length > 0).sort((left, right) => Number(left.id === SYSTEM_ENTITY_GROUP_ID) - Number(right.id === SYSTEM_ENTITY_GROUP_ID));
  }, [list, rosterFilter, search]);

  const open = (id: string): void => {
    if (onOpenAgent) onOpenAgent(id);
    else setLocalOpen(id);
  };
  const close = (): void => {
    setLocalOpen(null);
    setEditing(false);
    if (focusAgentId) onBack?.();
  };
  const launch = async (): Promise<void> => {
    if (!detail || launching || detail.details.launchable === false) return;
    setLaunching(true);
    setLaunchStatus(null);
    try {
      const active = session ?? await requireSession();
      if (!active) throw new Error('session-required');
      const response = await fetch(`/api/agents/${encodeURIComponent(detail.summary.ref.id)}/launch`, {
        method: 'POST',
        headers: { authorization: `Bearer ${active.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: `agent-launch:${detail.summary.ref.id}:${crypto.randomUUID()}` }),
      });
      const body = await response.json() as { run?: { runRef?: string }; runRef?: string; error?: string };
      const runRef = body.run?.runRef ?? body.runRef;
      if (!response.ok) setLaunchStatus(launchRefusalMessage(body.error));
      else if (runRef) onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: runRef } });
      else setLaunchStatus('Launch accepted');
    } catch {
      setLaunchStatus('Launch unavailable');
    } finally {
      setLaunching(false);
    }
  };

  return <section className="entity-roster" aria-label="Agents">
    <header className="page-header"><div><p className="page-eyebrow">Fleet</p><h2>Agents</h2></div></header>
    <div className="entity-roster-controls">
      <input aria-label="Search agents" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agents" />
    </div>
    {listError ? <div className="entity-row" role="status">Agents unavailable <button type="button" onClick={loadList}>Retry</button></div> : null}
    {!list && !listError ? <p role="status">Loading agents…</p> : null}
    <div className="entity-card-groups entity-card-groups--grid">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return <section key={group.id} className="entity-card-group">
          <button type="button" className="entity-card-group__toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed((value) => {
            const next = new Set(value); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
          })}>{group.label} <span className="mc-mono">{group.items.length}</span></button>
          {!isCollapsed ? <div className="entity-card-grid">{group.items.map((summary) => <EntityCard key={summary.ref.id} summary={summary} onOpen={() => open(summary.ref.id)} />)}</div> : null}
        </section>;
      })}
    </div>
    {openId ? <EntityDetail
      entity={{ kind: 'agent', id: openId }}
      eyebrow="Agent"
      title={humanizeEntityId(openId)}
      status={detail ? { label: detail.summary.status === 'needs-you' ? 'Needs you' : humanizeEntityId(detail.summary.status), tone: detail.summary.status === 'failed' ? 'error' : detail.summary.status === 'needs-you' ? 'warn' : detail.summary.status === 'running' ? 'running' : 'idle' } : undefined}
      facts={detail ? [{ label: 'Model', value: detail.summary.modelLabel }, { label: 'Host', value: detail.summary.host === 'vm' ? 'VM' : 'Desktop' }, { label: 'Last activity', value: detail.summary.temporalLabel, mono: true }] : []}
      sections={detail ? [
        { id: 'live', label: 'Live', count: detail.summary.gatedRunCount, attention: detail.summary.gatedRunCount > 0, render: () => <AgentDetailBody detail={detail} onNavigate={onNavigate} /> },
        { id: 'brief', label: 'Brief', render: () => <AgentDetailBody detail={detail} surface="brief" onNavigate={onNavigate} /> },
      ] : [{ id: 'live', label: 'Live', render: () => detailError ? <p role="status">Agent detail unavailable <button type="button" onClick={() => loadDetail(openId)}>Retry</button></p> : <p role="status">Loading agent…</p> }]}
      activeSectionId={activeSectionId}
      onSectionChange={onSectionChange}
      actions={detail ? <>
        <button type="button" disabled={launching || detail.details.launchable === false} onClick={() => void launch()}>{launching ? 'Starting…' : detail.details.launchable === false ? 'Not activated' : 'Run now'}</button>
        {detail.details.launchable === false ? <span className="entity-detail__action-note">This agent is declared but not activated to run — set <code>runner-bound: true</code> in its file to enable.</span> : null}
        <button type="button" onClick={() => onNavigate?.({ view: 'schedules', section: 'new', scheduleOwner: detail.summary.ref })}>Schedule</button>
        <button type="button" onClick={() => setEditing((value) => !value)}>Edit</button>
        <button type="button" onClick={() => onOpenTerminal?.({ id: openId })}>Open terminal</button>
        {launchStatus ? <span role="status">{launchStatus}</span> : null}
      </> : null}
      editorContent={editing && detail ? <EntityBuilderForm kind="agent" detail={detail} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); loadDetail(openId); loadList(); }} /> : undefined}
      overlay
      onClose={close}
      detailsContent={detail ? <DetailValues detail={detail} /> : undefined}
    /> : null}
  </section>;
}
