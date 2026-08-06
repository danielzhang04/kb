import type { FetchLike } from './controlClient';

export type AgentMessageResult = { delivery: 'live' | 'queued' } | { offline: true };

/** The route intentionally accepts only the operator's text; delivery is server-decided. */
export async function postAgentMessage(
  runRef: string, agentId: string, message: string, token: string, fetchImpl?: FetchLike,
): Promise<AgentMessageResult> {
  const request = fetchImpl ?? fetch;
  const response = await request(`/api/control/runs/${encodeURIComponent(runRef)}/agents/${encodeURIComponent(agentId)}/messages`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  const body = await response.json().catch(() => ({})) as { delivery?: unknown; error?: unknown };
  if (response.status === 409 && body.error === 'agent-message-delivery-unavailable') return { offline: true };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The message was refused.');
  if (body.delivery === 'live' || body.delivery === 'queued') return { delivery: body.delivery };
  throw new Error('The message response did not say whether it was delivered.');
}
