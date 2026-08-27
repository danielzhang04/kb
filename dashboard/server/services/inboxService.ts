// P6 W2 [design:435] — the pure inbox service extracted from `registerInboxRoutes`'s `GET /api/inbox`
// handler (`inbox/routes.ts`). It decodes `?refresh=<source>` through the shipped closed decoder,
// invalidates only the named source, then composes the four-source Inbox through the injected `readInbox`
// port. The refusal it reproduces is `400 bad-refresh` on any other `refresh` value. W6.2 makes the route
// a thin caller; W2 only BUILDS the service + its characterization test. No route file edited.

import { ContractDecodeError } from '../write/durableManifest.ts';
import type { P5InboxSourceKind } from '../inbox/project.ts';
import type { ServiceReply } from './scheduleService.ts';

/** The four source kinds `?refresh=` accepts; `400` on any other value [P5-C31]. Owned here (not
 *  `inbox/routes.ts`) so this service does not depend upward on its own route module. */
const P5_REFRESH_SOURCES: readonly P5InboxSourceKind[] = ['deployment', 'assetPull', 'pr', 'escalation'];
export function decodeP5InboxRefreshParam(value: unknown): P5InboxSourceKind | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && (P5_REFRESH_SOURCES as readonly string[]).includes(value)) {
    return value as P5InboxSourceKind;
  }
  throw new ContractDecodeError('refresh', 'deployment | assetPull | pr | escalation');
}

/** The invalidation + composition surface the handler drives; injected so tests reach no real `gh`/tree. */
export interface InboxServicePort {
  invalidatePr(): void;
  invalidateBudget(source: 'deployment' | 'assetPull'): void;
  /** `readInbox(ports, repoRoot)` — the shipped four-source composition, injected as one call. */
  readInbox(): Promise<unknown>;
}

/**
 * GET /api/inbox. `refreshParam` is the raw `?refresh=` query value. A bad value is `400 bad-refresh`
 * with the decoder's own reason; `pr` invalidates the PR cache, `deployment`/`assetPull` invalidate their
 * budget slot, and `escalation` re-reads the store (no invalidation). Then the composed Inbox is returned.
 */
export async function readInboxRoute(port: InboxServicePort, refreshParam: unknown): Promise<ServiceReply> {
  let refresh: 'deployment' | 'assetPull' | 'pr' | 'escalation' | null;
  try {
    refresh = decodeP5InboxRefreshParam(refreshParam);
  } catch (error: unknown) {
    const reason = error instanceof ContractDecodeError ? error.message : 'refresh must be deployment | assetPull | pr | escalation';
    return { status: 400, body: { error: 'bad-refresh', reason } };
  }
  if (refresh === 'pr') port.invalidatePr();
  else if (refresh === 'deployment' || refresh === 'assetPull') port.invalidateBudget(refresh);
  return { status: 200, body: await port.readInbox() };
}
