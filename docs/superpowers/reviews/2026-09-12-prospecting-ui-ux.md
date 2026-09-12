# Prospecting review-app UX review

The review app now presents campaign setup as explicit local saves. Operators choose existing
sender-profile and mailbox records, complete the structured campaign form, then save the campaign
transaction. Research intake is saved separately: saving it persists criteria and does not require
capture first. The saved intake can remain pending while capture, import, or another configured
workflow runs outside the UI. Refresh shows saved results; the page does not imply that creation
launched work.

The interface keeps manual review boundaries visible: edits save local revisions, feedback records
a correction request, and Mark ready records a human decision after its displayed prerequisites.
Repeated or conflicting advanced fields are refused with a fixed, actionable message. The grouped
setup/checklist approach adapts the clear staging found in the official [HubSpot](https://knowledge.hubspot.com/campaigns/create-campaigns), [Mailchimp](https://mailchimp.com/help/create-and-send-regular-email/), and [Apollo](https://knowledge.apollo.io/hc/en-us/articles/4409231193101-Create-a-Sequence) guidance; it does not copy their branding or workflow claims.

Recovery stores only an opaque creation UUID in session storage. A lost response can be checked
against the authenticated status endpoint and bind only the verified saved campaign. No form text
is stored for reload recovery, so reload loses unsaved text; on the same page, buffered research
text is retained through a status check.

Verification: the final review-app state suite passed 72 tests, and the final HTML assertion passed.
Independent recovery/backend review passed its scoped checks. Chrome covered all five views in both
themes at 390, 852 and 1366 pixels without horizontal overflow; it also exercised reload and
same-page recovery, invalid-research zero-POST/focus behavior, research double-click, and scope
cache switch/refresh behavior. Final DOM geometry at 1366 confirmed paired controls have equal
40-pixel top alignment and height. The earlier reviewed screenshot supplies the visual record;
post-repair screenshot calls timed out in the daemon, so no newer capture is claimed. The final
source was reloaded in the existing Chrome session and the ready state, theme control, and recovery
checks remained correct. The full Python run reported 2168 passes and one sandbox-only `taskkill`
teardown failure; the unchanged isolated launcher test passed with desktop escalation. UX
verification is complete. Commit and publication remain pending.
