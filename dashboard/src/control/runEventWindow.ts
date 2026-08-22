import { listRunEvents, type OperationalEventDto, type RunEventPage } from './controlClient';

/** The server route rejects pages above 250. */
export const RUN_EVENT_PAGE = 250;

/** The persisted store caps a run at 100,000 events, so this reaches that boundary without spinning. */
export const RUN_EVENT_MAX_PAGES = 400;

export interface RunEventWindow {
  /** Full replay in cursor order; this is intentionally not a head or tail sample. */
  events: OperationalEventDto[];
  /** Events actually observed. This is exact only when complete is true. */
  seen: number;
  /** False when the page bound or a non-advancing cursor prevented exhaustion. */
  complete: boolean;
}

export type ListRunEvents = (
  runRef: string,
  after: number,
  limit: number,
  token: string,
) => Promise<RunEventPage>;

/** Walk the canonical nextCursor chain once and retain the complete replay. */
export async function loadRunEventWindow(
  runRef: string,
  token: string,
  fetchPage: ListRunEvents = listRunEvents,
): Promise<RunEventWindow> {
  let after = 0;
  const events: OperationalEventDto[] = [];

  for (let page = 0; page < RUN_EVENT_MAX_PAGES; page += 1) {
    const pageResult = await fetchPage(runRef, after, RUN_EVENT_PAGE, token);
    events.push(...pageResult.items);
    if (pageResult.nextCursor === null) {
      return { events, seen: events.length, complete: true };
    }
    if (pageResult.nextCursor <= after) {
      return { events, seen: events.length, complete: false };
    }
    after = pageResult.nextCursor;
  }

  return { events, seen: events.length, complete: false };
}
