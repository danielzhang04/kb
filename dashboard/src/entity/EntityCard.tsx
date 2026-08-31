import type { EntitySummary } from '../../server/control/p2Contracts.ts';
import { humanizeEntityId } from './humanizeEntityId';

const STATUS_LABEL: Record<EntitySummary['status'], string> = {
  running: 'Running',
  'needs-you': 'Needs you',
  failed: 'Failed',
  idle: 'Idle',
  scheduled: 'Scheduled',
};

export function EntityCard({ summary, onOpen }: { summary: EntitySummary; onOpen: () => void }): React.JSX.Element {
  return <button type="button" className="entity-card" data-testid="entity-card" data-entity-kind={summary.ref.type} data-entity-id={summary.ref.id} onClick={onOpen}>
    <span className="entity-card__name">{humanizeEntityId(summary.ref.id)}</span>
    <span className={`entity-card__status entity-card__status--${summary.status}`}>{STATUS_LABEL[summary.status]}</span>
    <span className="entity-card__model">{summary.modelLabel}</span>
    <span className="entity-card__temporal mc-mono">{summary.temporalLabel}</span>
    <span className="entity-card__host">{summary.host === 'vm' ? 'VM' : 'Desktop'}</span>
    {summary.gatedRunCount > 0 ? <span className="entity-card__gates mc-mono" data-testid="entity-card-gates">{summary.gatedRunCount}</span> : null}
  </button>;
}
