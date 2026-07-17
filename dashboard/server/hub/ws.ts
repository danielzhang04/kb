/**
 * Read-only WebSocket transport for live tails. Subscribes each `/ws` client to the bus and pushes
 * one JSON message per {@link HubEvent}.
 *
 * Origin/Host validation happens twice, defense-in-depth: the hub scope's `onRequest` guard rejects
 * a bad upgrade BEFORE the handshake completes (ordering law 4 — validate on every WS upgrade), and
 * this handler re-checks and policy-closes (1008) if it is ever reached without the scope guard
 * (e.g. registered standalone). No client→server commands are honored — this is a read channel.
 */
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { EventBus, HubEvent } from './bus.ts';
import { assertOrigin } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';

export async function registerReadWs(
  app: FastifyInstance,
  bus: EventBus,
  opts: { allowedOrigins?: AllowedOrigins } = {},
): Promise<void> {
  await app.register(fastifyWebsocket);

  app.get('/ws', { websocket: true }, (socket, req) => {
    // Defensive re-check: only meaningful when this route is mounted without the scope guard.
    if (opts.allowedOrigins !== undefined) {
      const result = assertOrigin(req, opts.allowedOrigins);
      if (!result.ok) {
        socket.close(1008, result.reason ?? 'forbidden');
        return;
      }
    }

    const unsubscribe = bus.subscribe((event: HubEvent) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });

    socket.on('close', () => unsubscribe());
    socket.on('error', () => unsubscribe());
  });
}
