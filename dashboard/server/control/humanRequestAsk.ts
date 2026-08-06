/**
 * spec §3b — the plain-language rendering of a Human Request, owned server-side.
 *
 * A control-plane request carries whatever text the machine that filed it had to hand: a launch
 * traceback, a refusal code, a policy sentence. Putting that in front of an operator as THE ask is the
 * defect this module exists to remove — the live Inbox showed six parked runs whose "ask" was a
 * TUI-era boot traceback, which says what broke but never what the human can do about it.
 *
 * So exactly one place turns (kind, title, prompt) into ONE sentence that says what happened and what
 * the operator can do, and the raw text is demoted to `technicalDetail`. It lives next to the DTO
 * builder in `routes.ts#humanRequestDisplay` because that is the only place the mapping is applied;
 * a second copy anywhere would be a second vocabulary for the same events.
 *
 * The map is deliberately pattern-first and kind-second: `kind` is coarse (an `intervention` covers a
 * boot failure, an exhausted budget and a stranded wake-me alike), so a recognized machine pattern in
 * the title/prompt wins, then the request kind, and an unrecognized pattern falls back to a truthful
 * generic that still names the run. It never guesses a cause it cannot see.
 */
import type { HumanRequest } from './types.ts';

export interface HumanRequestAsk {
  /** One plain sentence: what happened + what you can do. Never raw error text. */
  ask: string;
  /** The machine's own words — traceback, refusal code, policy prose. Null when there were none. */
  technicalDetail: string | null;
}

/** The identifying slice of a request. Typed structurally so callers can pass a stored or public one. */
export type AskSource = Pick<HumanRequest, 'kind' | 'title' | 'prompt'>;

interface AskPattern {
  id: string;
  match: RegExp;
  ask: (runName: string) => string;
}

/**
 * Recognized machine patterns, in priority order. Each maps to one sentence of the form
 * "<what happened>. <what you can do>." — and every "what you can do" is an action this dashboard
 * actually offers (open the run, answer the gate there, or archive it).
 */
const PATTERNS: AskPattern[] = [
  {
    id: 'boot-failure',
    match: /\b(?:boot|bootstrap|start(?:up|ing)?|spawn|launch)\b[^.]{0,40}\b(?:fail(?:ed|ure)?|error|refused|could not|couldn't|unable)\b|\b(?:fail(?:ed|ure)?|could not|couldn't|unable to)\b[^.]{0,40}\b(?:boot|start|spawn|launch)\b/i,
    ask: (runName) => `${runName} never got started — its agent failed to boot, so no work has run. Open the run to start it again, or archive it if it is obsolete.`,
  },
  {
    id: 'budget-exhausted',
    match: /\bbudget\b|\bspend(?:ing)? (?:cap|limit)\b|\bdaily cap\b|\bout of (?:budget|funds)\b|\bcost ceiling\b/i,
    ask: (runName) => `${runName} stopped because the spend allowed for it is used up. Open the run to approve more spend, or archive it to let it go.`,
  },
  {
    id: 'canonical-integration-incomplete',
    match: /\bcanonical\b|\bintegration (?:incomplete|stranded|did not complete)\b|\blineage (?:push|local)\b/i,
    ask: (runName) => `A step of ${runName} finished but its result was never filed, so the run is parked mid-way. Open the run to file it and resume, or archive the run.`,
  },
  {
    id: 'credential-refusal',
    match: /\bcredential\b|\bsecret\b|\bapi key\b|\btoken\b|\bpermission\b|\bnot allowed\b|\brefus(?:ed|al)\b|\bunauthori[sz]ed\b|\bforbidden\b/i,
    ask: (runName) => `${runName} asked to do something the rules do not let it do on its own. Open the run to decide whether to allow it, or archive the run.`,
  },
  {
    id: 'stranded-cadence',
    match: /\bwake[- ]?me\b|\bcadence\b|\bstranded\b|\bno runner\b|\brunner (?:offline|is not)\b/i,
    ask: (runName) => `An agent on ${runName} asked for you by name and is waiting. Open the run to answer it, or archive the run if it no longer matters.`,
  },
];

/** Kind-level fallbacks: coarser than a pattern, still far better than printing the raw prompt. */
const BY_KIND: Record<HumanRequest['kind'], (runName: string) => string> = {
  approval: (runName) => `${runName} needs your sign-off before it can go any further. Open the run to approve or turn it down.`,
  review: (runName) => `A finished step of ${runName} is waiting for your review. Open the run to accept it or send it back.`,
  input: (runName) => `${runName} is waiting for an answer from you before it can carry on. Open the run to answer it.`,
  intervention: (runName) => `${runName} stopped and needs a person to look at it. Open the run to see where it stopped, or archive it.`,
  'governance-refusal': (runName) => `${runName} was refused on governance grounds and is parked. Open the run to decide what happens next, or archive it.`,
};

/**
 * The plain-language ask for one request, plus the raw text it replaced.
 *
 * `runName` is the run's display name (`naming.ts`) — the ask names the run because that is the thing
 * the operator recognizes and the thing the deep link opens. `technicalDetail` keeps BOTH the machine
 * title and its prompt when they differ, so nothing the request carried is lost, only demoted.
 */
export function askForHumanRequest(request: AskSource, runName: string): HumanRequestAsk {
  const haystack = `${request.title}\n${request.prompt}`;
  const pattern = PATTERNS.find((candidate) => candidate.match.test(haystack));
  const ask = pattern
    ? pattern.ask(runName)
    : BY_KIND[request.kind]?.(runName)
      // Unknown kind AND unknown pattern: say only what is certainly true, and name the run.
      ?? `${runName} needs your attention. Open the run to see what it is waiting for.`;
  const detail = [request.title, request.prompt]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value, index, all) => value !== '' && all.indexOf(value) === index)
    .join('\n\n');
  return { ask, technicalDetail: detail === '' ? null : detail };
}
