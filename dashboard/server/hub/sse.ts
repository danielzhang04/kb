/**
 * Server-Sent Events transport. Subscribes each `/events` client to the bus and writes one SSE
 * frame per {@link HubEvent}. Read-only push; no client→server channel here. Origin/Host validation
 * is enforced by the hub scope's `onRequest` guard (see {@link registerHub}) before this handler runs.
 */
import type { FastifyInstance } from 'fastify';
import type { EventBus, HubEvent } from './bus.ts';

export function registerSse(app: FastifyInstance, bus: EventBus): void {
  app.get('/events', (req, reply) => {
    // Take over the raw socket; Fastify will not try to serialize/send a reply.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeat proxy buffering so deltas land live.
      'X-Accel-Buffering': 'no',
    });
    // An initial comment flushes headers and proves the subscription is live to the client.
    reply.raw.write(': connected\n\n');

    const unsubscribe = bus.subscribe((event: HubEvent) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.channel}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const close = (): void => {
      unsubscribe();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
  });
}
