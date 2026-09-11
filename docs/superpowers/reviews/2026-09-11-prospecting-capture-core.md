# Durable capture core review

Verified development and independent review response model: `claude-opus-5`.
The final independent review (`p23-final-review-15`) returned READY after lease,
replay, transaction, snapshot ownership and error-handling repairs.

Root verification: 76 combined capture, funding and person-import tests passed after
the final reserved-domain cleanup (30.80 seconds). The 31 focused tests are included
in that count. Fourteen CLI tests separately passed with ordinary temporary storage;
the CLI and browser integration remain separate, unaccepted work.

The service durably binds capture tasks to saved intake, limits each session to 32
tasks and each task to three attempts, fences expired leases, and verifies owned
snapshot bytes on both receipt replay and later reads. Private query, URL and text
remain desktop-local. No capture grants qualification, source confirmation, approval
or sending authority. An operator-provided URL is not independent browser evidence.

Known limits: task caps are per session; unknown crash orphans are preserved and need
future bounded maintenance. Packet export can fail after a committed lease; that
lease must expire before reclaim. Browser relay and deterministic manifest compiler
integration remain required. No actual browser capture or real campaign was used
to establish this core acceptance.
