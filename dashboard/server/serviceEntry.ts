/**
 * systemd service entry for the dashboard daemon.
 *
 * The user-level `kb-dashboard.service` starts this module directly, so it boots the daemon
 * unconditionally instead of relying on `index.ts`'s executed-directly guard.
 *
 * Direct runs keep using `node server/index.ts` / `npm start`; systemd targets this file.
 * No top-level await: the service entry is loaded as a regular Node module.
 */
import { start } from './index.ts';
import { installShutdownHandlers } from './shutdown.ts';

start()
  .then((app) => {
    installShutdownHandlers(app);
    const addr = app.server.address();
    const shown = typeof addr === 'string' || addr === null ? String(addr) : `http://${addr.address}:${addr.port}`;
    // eslint-disable-next-line no-console
    console.log(`kb dashboard daemon listening (systemd) on ${shown}`);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
