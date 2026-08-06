import { describe, expect, it, vi } from 'vitest';
import { postAgentMessage } from './agentMessages';

describe('postAgentMessage', () => {
  it('posts the governed message with its bearer token and returns the server delivery state', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ delivery: 'queued' }), { status: 202 }));

    await expect(postAgentMessage('run / 1', 'agent / 1', 'Please continue.', 'token-1', request as typeof fetch))
      .resolves.toEqual({ delivery: 'queued' });
    expect(request).toHaveBeenCalledWith('/api/control/runs/run%20%2F%201/agents/agent%20%2F%201/messages', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer token-1',
      },
      body: JSON.stringify({ message: 'Please continue.' }),
    });
  });
});
