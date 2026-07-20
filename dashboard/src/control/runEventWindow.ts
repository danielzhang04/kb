/**
 * arc-3 fix — the Activity stream's event window.
 *
 * The cockpit used to call `listRunEvents(runRef, 0, 500)` once. `after` is the START of the cursor and
 * the server filters `cursor > after` then `slice(0, limit)`, so that single call returns the OLDEST 500
 * events. A 5,000-event run therefore printed "5000 events" on its grid card and "Activity stream 500"
 * on its tab, showing the beginning of the run with no hint the tail was missing — the opposite of what
 * an operator watching a run needs.
 *
 * There is no descending or tail-anchored route, and inventing one is not on the table. But the existing
 * endpoint is a forward cursor pager, and paging it forward to exhaustion while keeping only the last
 * {@link RUN_EVENT_WINDOW} events yields the TAIL from the API as it already stands. `MAX_EVENT_PAGE` on
 * the server is 1,000, so a 5,000-event run costs five requests.
 *
 * Paging is bounded by {@link RUN_EVENT_MAX_PAGES}, because an unbounded client loop against a run that
 * is still emitting is a hang. When that bound is hit the window is NOT the tail, and `complete: false`
 * says so — callers must report that honestly rather than presenting a middle slice as "most recent".
 */
import { listRunEvents, type OperationalEventDto } from './controlClient';

/** How many events the Activity stream renders. The tail, not the head. */
export const RUN_EVENT_WINDOW = 500;

/** Server-side `MAX_EVENT_PAGE`. Asking for more is rejected as invalid, so this is the ceiling. */
export const RUN_EVENT_PAGE = 1_000;

/** Bound on the forward walk: 50 × 1,000 = 50,000 events before the cockpit gives up and says so. */
export const RUN_EVENT_MAX_PAGES = 50;

export interface RunEventWindow {
  /**
   * At most {@link RUN_EVENT_WINDOW} events, oldest-first within the window. These are the MOST RECENT
   * events when `complete` is true, and an arbitrary interior slice when it is false.
   */
  events: OperationalEventDto[];
  /**
   * How many events the walk actually saw. When `complete` is true this is the run's true event count
   * and therefore agrees with `RunMetadataDto.eventCount` on the grid card. When false it is a lower
   * bound ("at least this many").
   */
  seen: number;
  /** True when the walk reached the end of the run's events, so `events` really is the tail. */
  complete: boolean;
}

export type ListRunEvents = (
  runRef: string,
  after: number,
  limit: number,
  token: string,
) => Promise<OperationalEventDto[]>;

/**
 * Walk the run's events forward and keep the last {@link RUN_EVENT_WINDOW}.
 *
 * `fetchPage` is injectable so this is testable with a literal fixture and no fetch mock.
 */
export async function loadRunEventWindow(
  runRef: string,
  token: string,
  fetchPage: ListRunEvents = listRunEvents,
): Promise<RunEventWindow> {
  let after = 0;
  let seen = 0;
  let events: OperationalEventDto[] = [];

  for (let page = 0; page < RUN_EVENT_MAX_PAGES; page += 1) {
    const batch = await fetchPage(runRef, after, RUN_EVENT_PAGE, token);
    seen += batch.length;
    if (batch.length > 0) {
      // Keep only the tail: the window never grows past RUN_EVENT_WINDOW no matter how long the run is.
      events = [...events, ...batch].slice(-RUN_EVENT_WINDOW);
      after = batch[batch.length - 1].cursor;
    }
    // A short page means the cursor is exhausted — this is the end of the run's events.
    if (batch.length < RUN_EVENT_PAGE) return { events, seen, complete: true };
  }

  return { events, seen, complete: false };
}
