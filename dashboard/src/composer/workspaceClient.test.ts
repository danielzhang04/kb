import { describe, expect, it, vi } from 'vitest';
import { createComposerSession } from './workspaceClient';

describe('createComposerSession', () => {
  it('persists an agent selection through the existing Composer session API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      session: {
        composerRef: 'cw-agent', title: 'Agent · fyt-runner', state: 'open', sourceComposerRef: null,
        agent: { id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'hash' },
        createdAt: 'now', updatedAt: 'now', turns: [],
      },
    }), { status: 201 }));

    const session = await createComposerSession('token', { title: 'Agent · fyt-runner', agentId: 'fyt-runner' }, fetchMock);

    expect(session.agent).toEqual({ id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'hash' });
    expect(fetchMock).toHaveBeenCalledWith('/api/composer/sessions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'Agent · fyt-runner', agentId: 'fyt-runner' }),
    }));
  });
});
