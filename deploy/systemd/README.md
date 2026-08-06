# kb systemd user units

These units assume the VM layout from the migration runbook: clone at `~/kb`,
the canonical ops worktree at `~/kb-dashboard-ops`, and secrets/configuration in
`~/.config/kb/env`. The environment file is outside git, owned by `kb`, mode
0600. It supplies the session secret, credential store, and the existing
`DASHBOARD_REPO_ROOT` / `DASHBOARD_DURABLE_REPO_ROOT` paths; do not put them in
unit files.

The service runs the same daemon entry PM2 used (`dashboard/server/pm2Entry.ts`).
Build the SPA before enabling it:

```sh
cd ~/kb/dashboard
npm run build
mkdir -p ~/.config/systemd/user
install -m 644 ~/kb/deploy/systemd/kb-dashboard.service ~/.config/systemd/user/
install -m 644 ~/kb/deploy/systemd/kb-codex-runner.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kb-dashboard.service
```

Enable lingering once, as an administrator, so the `kb` user manager survives
reboot without an interactive login:

```sh
sudo loginctl enable-linger kb
```

Check the daemon and its journald output with:

```sh
systemctl --user status kb-dashboard
journalctl --user -u kb-dashboard
journalctl --user -u kb-dashboard -f
```

`kb-codex-runner.service` is an optional manual, one-shot equivalent of the
dashboard's detached queue pickup: `systemctl --user start kb-codex-runner`.
There is intentionally no timer: dashboard writes directly spawn the runner
when a card needs immediate pickup. There is also no tunnel unit; the SSH local
forward belongs on the desktop, and there is no keep-awake unit on a cloud VM.
