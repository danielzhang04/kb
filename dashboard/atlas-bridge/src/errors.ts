export type BridgeErrorCode =
  | 'bridge_disabled'
  | 'session_required'
  | 'capability_unavailable'
  | 'capability_negotiation_failed'
  | 'invalid_arguments'
  | 'path_not_readable'
  | 'dashboard_error'
  | 'dashboard_unavailable'
  | 'response_too_large'
  | 't3_requires_dashboard'
  | 'review_profile_refused';

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export const SESSION_MESSAGE = 'say: Atlas, unlock kb';

export function sessionRequired(): BridgeError {
  return new BridgeError('session_required', SESSION_MESSAGE, false);
}
