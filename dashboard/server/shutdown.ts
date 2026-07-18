import type { FastifyInstance } from 'fastify';
import { drainVibeProcesses } from './vibe/session.ts';

/**
 * Give Fastify's onClose hooks (including the live Claude child drain) a chance to run under PM2 or
 * direct-terminal shutdown. Returns an uninstall function for embedders/tests.
 */
export function installShutdownHandlers(app: FastifyInstance): () => void {
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    // Signal live children before app.close waits for their streaming HTTP requests. The write
    // surface's preClose hook repeats this idempotently for non-signal close paths.
    drainVibeProcesses();
    void app.close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return () => {
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  };
}
