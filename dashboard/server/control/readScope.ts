/**
 * The ONE place cross-subject reach is decided, in a leaf module so every caller can import it.
 *
 * It lived in `control/routes.ts` with a hand-copied duplicate in `services/runReadService.ts` (whose own
 * comment said it was reproduced only to avoid importing the whole route module). A third caller —
 * `artifactFilesRoute.ts`, which must repeat the run read route's ownership check before scoping a
 * run-scoped download — could not import either without a cycle, and a third copy of an authorization
 * predicate is how the three drift apart. So it is defined here, once, and imported everywhere.
 *
 * Only a verified operator reads all subjects. The scope is derived from the verified session subject
 * alone: no header, query parameter or body field can select it.
 */
import { OPERATOR_SUBJECT } from '../auth/mode.ts';
import type { ReadScope } from './store.ts';

export function readScopeForSubject(sub: string | null | undefined): ReadScope {
  return sub === OPERATOR_SUBJECT ? 'all-subjects' : 'own-subject';
}
