// W6.2 must enforce Run read-scope authorization before route registration writes any SSE headers.
import type { RunEventPage } from './p2Contracts.ts';
import type { ReplayRunEventsInput, RunEventService } from './runEventService.ts';

type RunEvent = RunEventPage['items'][number];

export interface RunEventSseFrame {
  id: number;
  event: 'run-event';
  data: string;
  wire: string;
}

export interface ReplayRunEventStreamInput extends ReplayRunEventsInput {
  lastEventId?: string | null;
}

export interface RunEventStreamReplay {
  page: RunEventPage;
  frames: RunEventSseFrame[];
}

export interface RunEventStream {
  replay(input: ReplayRunEventStreamInput): Promise<RunEventStreamReplay>;
}

function lastAcceptedCursor(value: string | null | undefined): number {
  if (value == null || value.trim() === '') return 0;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}

function frameFor(item: RunEvent): RunEventSseFrame {
  const data = JSON.stringify(item);
  return { id: item.cursor, event: 'run-event', data, wire: `id: ${item.cursor}\nevent: run-event\ndata: ${data}\n\n` };
}

export function createRunEventStream(service: RunEventService): RunEventStream {
  return {
    async replay(input) {
      const { lastEventId, ...request } = input;
      const afterCursor = Math.max(request.afterCursor ?? 0, lastAcceptedCursor(lastEventId));
      const page = await service.replay({ ...request, afterCursor });
      return { page, frames: page.items.map(frameFor) };
    },
  };
}
