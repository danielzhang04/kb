/**
 * The controller cookie every PTY surface needs, and the ONE client path that obtains it.
 *
 * `/api/pty` and `/api/pty/sessions` resolve a BROWSER principal — the operator session AND a live
 * `kb_browser_session` ref cookie — and refuse with 428 `browser-session-required` when the cookie is
 * missing. `POST /api/auth/browser-session` is the only route that ever mints that cookie, and on the
 * always-on tailnet deployment it is the only one that CAN: tailnet auth is ambient, so no assertion is
 * ever verified and the WebAuthn sign-in mint path never runs. Nothing in the client called it, so no
 * browser on that deployment could open a terminal at all — every upgrade 428'd and the operator read
 * "Disconnected — the connection failed. Reattach to continue." forever.
 *
 * Two properties this module exists to hold:
 *
 *  - It is called immediately BEFORE a PTY request, not once at app bootstrap. The cookie lives 30 days
 *    but the server-side ref does not: a daemon restart empties the ref store, so a cookie that worked
 *    an hour ago is dead now. A bootstrap-only mint would leave the tab bricked until a manual reload;
 *    asking again per connection attempt is what makes the operator's Reattach heal the browser.
 *  - Concurrent callers (the workspace listing plus every mounted console) share ONE in-flight request.
 *    Settled results are deliberately NOT cached: a cached success is precisely the thing that would
 *    survive the restart it must notice. A repeat POST that presents a live cookie is a 204 `unchanged`
 *    that mints nothing, so asking again costs one empty response — never a mint per keystroke, because
 *    nothing on a keystroke path calls this.
 *
 * The single retry: a browser holding a ref the daemon no longer knows is refused 401, and it cannot
 * drop the cookie itself — `kb_browser_session` is HttpOnly, so no script may clear it. The route
 * answers that refusal with an EXPIRING (value-less, `Max-Age=0`) cookie, so by the time this retries
 * the browser presents nothing and takes the clean mint path. EXACTLY one retry: a second 401 is a real
 * refusal, reported as itself and never looped on.
 */
export type FetchLike = typeof fetch;

/** The one route that mints the ref. Same-origin; the cookie is set by the response, never by script. */
export const BROWSER_SESSION_ROUTE = '/api/auth/browser-session';

/**
 * Why a browser session could not be obtained. `unreachable` is the transport failing to deliver a
 * request at all — the SERVER never spoke, so it is not a statement about this browser's credential.
 */
export type BrowserSessionRefusal = 'refused' | 'unavailable' | 'unreachable';

export type BrowserSessionOutcome = { ok: true } | { ok: false; reason: BrowserSessionRefusal };

/** The one sentence an operator is shown per refusal. A refusal is always SHOWN, never swallowed. */
export function browserSessionMessage(reason: BrowserSessionRefusal): string {
  switch (reason) {
    case 'refused':
      return 'This browser could not start a terminal session. Reload the page, and sign in again if it keeps failing.';
    case 'unavailable':
      return 'The dashboard could not record a browser session for this terminal. Try again in a moment.';
    default:
      return 'The dashboard could not reach its authentication service.';
  }
}

/** One POST. A transport failure is `null` — distinct from any status the server actually returned. */
async function postBrowserSession(fetchImpl: FetchLike): Promise<Response | null> {
  try {
    return await fetchImpl(BROWSER_SESSION_ROUTE, {
      method: 'POST',
      // Explicit, though same-origin is the default: the whole point of the call is the cookie jar.
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    });
  } catch {
    return null;
  }
}

/** A server status mapped onto the closed refusal set. 503 is the ref store; anything else is a refusal. */
function refusalFor(status: number): BrowserSessionRefusal {
  return status === 503 ? 'unavailable' : 'refused';
}

async function mintBrowserSession(fetchImpl: FetchLike): Promise<BrowserSessionOutcome> {
  const first = await postBrowserSession(fetchImpl);
  if (first === null) return { ok: false, reason: 'unreachable' };
  if (first.ok) return { ok: true };
  if (first.status !== 401) return { ok: false, reason: refusalFor(first.status) };
  // 401 = the ref this browser presented was refused. The refusal carried the expiring cookie, so this
  // second call presents no ref and mints. ONE retry: no loop is armed by any answer to it.
  const second = await postBrowserSession(fetchImpl);
  if (second === null) return { ok: false, reason: 'unreachable' };
  if (second.ok) return { ok: true };
  return { ok: false, reason: refusalFor(second.status) };
}

let inFlight: Promise<BrowserSessionOutcome> | null = null;

/**
 * Obtain (or confirm) this browser's session ref. Concurrent callers join the one in-flight request;
 * once it settles the next caller asks again, which is how a restarted daemon is ever noticed.
 */
export function ensureBrowserSession(fetchImpl: FetchLike = fetch): Promise<BrowserSessionOutcome> {
  if (inFlight !== null) return inFlight;
  const attempt = mintBrowserSession(fetchImpl).finally(() => {
    inFlight = null;
  });
  inFlight = attempt;
  return attempt;
}
