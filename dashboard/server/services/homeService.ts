// P6 W2 [P6-C42, design:435] — the pure home service extracted from `registerHomeRoutes`'s `GET /api/home`
// handler (`home/routes.ts` `projectHome(ports, …)`). It composes the D13 Home projection through the
// injected `projectHome` port and applies the `"<revision>"` ETag/304 the route sends today, so W6.2's
// Home adapter has a service to be thin over. W2 only BUILDS the service + its test. No route file edited.

import type { ServiceReply } from './scheduleService.ts';

/** A Home projection result: any shape carrying the `revision` the ETag is built from. */
export interface HomeProjection {
  readonly revision: string;
  readonly [key: string]: unknown;
}

/** The composition surface the handler drives; injected so a Home test reaches no real store/`gh`/tree. */
export interface HomeServicePort {
  /** `projectHome(ports, nowIso)` — the shipped D13 projection, injected as one call. */
  projectHome(nowIso: string): Promise<HomeProjection>;
}

/**
 * GET /api/home. Projects Home, then returns `304` when `ifNoneMatch` equals the `"<revision>"` ETag, or
 * `200` with the projection and that ETag otherwise — byte-identical to the route's `sendRevisioned`.
 */
export async function readHome(port: HomeServicePort, nowIso: string, ifNoneMatch: string | undefined): Promise<ServiceReply> {
  const value = await port.projectHome(nowIso);
  const etag = `"${value.revision}"`;
  if (ifNoneMatch === etag) return { status: 304, etag };
  return { status: 200, etag, body: value };
}
