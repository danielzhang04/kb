# Always-on dashboard (systemd)

On the Linux VM the dashboard is supervised by the `kb-dashboard.service` user
unit in `deploy/systemd/`; it replaces the former Windows process supervisor and
logon resurrection.

Install/enable it with the commands in [deploy/systemd/README.md](../deploy/systemd/README.md).
After a source update, build the SPA with `npm run build` in `dashboard/`, then
run `systemctl --user restart kb-dashboard`.

Useful checks:

```sh
systemctl --user status kb-dashboard
journalctl --user -u kb-dashboard -f
```

The dashboard is still loopback-only on port 5317. The desktop SSH local-forward
remains a desktop concern; there is intentionally no VM tunnel unit. Card pickup
uses a detached POSIX runner process, replacing `schtasks`; the cloud VM has no
keep-awake service.
