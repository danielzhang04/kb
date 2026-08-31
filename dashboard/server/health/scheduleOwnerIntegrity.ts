import type { RunnableRef, Schedule } from '../control/p2Contracts.ts';
import type { ScheduleOwnerIntegrityRow } from '../home/contracts.ts';

function ownerKey(owner: RunnableRef): string {
  return `${owner.type}:${owner.id}`;
}

/** Detects schedule owners that no longer have exactly one declared runnable. */
export function projectScheduleOwnerIntegrity(
  schedules: readonly Schedule[],
  declaredOwners: readonly RunnableRef[],
  now: () => string,
): ScheduleOwnerIntegrityRow[] {
  const declarationCounts = new Map<string, number>();
  for (const owner of declaredOwners) {
    const key = ownerKey(owner);
    declarationCounts.set(key, (declarationCounts.get(key) ?? 0) + 1);
  }

  return [...schedules]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((schedule) => {
      const key = ownerKey(schedule.owner);
      const count = declarationCounts.get(key) ?? 0;
      if (count === 1) return [];
      return [{
        kind: 'integrity' as const,
        key: `schedule-owner:${schedule.id}` as const,
        value: { status: 'error' as const, code: 'schedule-owner-unresolvable' as const, owner: schedule.owner },
        observedAt: now(),
        source: 'schedule-store' as const,
      }];
    });
}
