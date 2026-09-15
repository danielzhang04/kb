# Offline tester-plan preview

`POST /api/figment/plan-preview/tester` is an authenticated, same-origin control that builds one fresh local plan for fixed creator `creator-001` and fixed stage `tester`. It accepts no body or client path, prompt, command, model, or budget input.

The server invokes only the checked-in `orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage tester --skip-pin-verify` with a fresh server-owned `_private/figment-plan-preview/tester-*` directory. The process has a 10-second timeout and 16 KiB stdout/stderr ceiling. Its output is removed after every success or failure.

The response contains only the offline/non-promotable label, fixed creator and stage, run count, declared ceiling, and manifest SHA-256. It never returns a planned argv, prompt, workflow, raw plan, checkpoint, approval, or execution control. This creates no pod, calls no provider, and cannot replace an accepted checkpoint or operator approval.
