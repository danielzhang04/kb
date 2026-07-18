@echo off
:: kb PTY host launcher (D3.1i). Registered by the human gate (scripts/register_pty_host.md) as a
:: Windows scheduled task running as kb-fleet at logon (schtasks cannot set "Start in", so this wrapper
:: sets the cwd). The repo root is REQUIRED: the preamble's relative `scripts/preamble.py`, the STOP-file
:: reads, and buildChildEnv's PATH all resolve against it. hostMain.ts runs its OWN fail-closed boot gates
:: (preamble FIRST under STOP/API-key/budget, own-SID == kb-fleet, peer.sid, token file) before it listens.
cd /d C:\Users\danie\kb
"C:\Program Files\nodejs\node.exe" dashboard\server\pty\hostMain.ts
