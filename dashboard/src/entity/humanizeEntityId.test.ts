import { describe, expect, it } from 'vitest';
import { humanizeEntityId } from './humanizeEntityId';

describe('humanizeEntityId', () => {
  it('preserves API CLI CPU FYT GPU KB MCP PR PTY RAM SSE VM WSL', () => {
    expect(humanizeEntityId('api_cli_cpu_fyt-gpu-kb_mcp-pr_pty_ram-sse_vm_wsl')).toBe(
      'API CLI CPU FYT GPU KB MCP PR PTY RAM SSE VM WSL',
    );
  });
});
