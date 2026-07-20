/**
 * PM2 entry for the dashboard daemon.
 *
 * PM2's fork mode does not execute the script as the main module — its ProcessContainerFork
 * require()s it, so `process.argv[1]` points at PM2's container and index.ts's run-directly
 * guard (correctly) stays cold. Pointing pm2.config.cjs at index.ts therefore yields a process
 * that sits "online" without ever listening. This module boots unconditionally instead.
 *
 * Direct runs keep using `node server/index.ts` / `npm start`; only PM2 targets this file.
 * No top-level await: require() cannot load an ESM graph that uses TLA, and PM2 loads us via require().
 */
import { start } from './index.ts';
import { installShutdownHandlers } from './shutdown.ts';

start()
  .then((app) => {
    installShutdownHandlers(app);
    const addr = app.server.address();
    const shown = typeof addr === 'string' || addr === null ? String(addr) : `http://${addr.address}:${addr.port}`;
    // eslint-disable-next-line no-console
    console.log(`kb dashboard daemon listening (pm2) on ${shown}`);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
