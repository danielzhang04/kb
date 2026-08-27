import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AtlasKbBridge } from './bridge.js';
import { DashboardClient } from './client.js';
import { configFromEnv } from './config.js';
import { BridgeError } from './errors.js';
import { safeLog } from './redact.js';
import { AtlasSessionNotificationSchema } from './session.js';

async function main(): Promise<void> {
  const config = configFromEnv();
  if (!config.enabled) throw new BridgeError('bridge_disabled', 'ATLAS_KB_BRIDGE_ENABLED=1 is required');
  const logger = (event: string, fields?: Record<string, unknown>): void => {
    process.stderr.write(`${JSON.stringify({ event, ...fields })}\n`);
  };
  const client = new DashboardClient(config, logger);
  const bridge = new AtlasKbBridge(client);
  const server = new Server(
    { name: 'kb-atlas-bridge', version: '0.1.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: 'READ tools are instant. MUTATION tools require host-owned voice confirmation.',
    },
  );
  server.setNotificationHandler(AtlasSessionNotificationSchema, async (notification) => {
    client.setSession(notification.params);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: bridge.tools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await bridge.callTool(request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, result }) }] };
    } catch (error) {
      const bridgeError = error instanceof BridgeError
        ? error
        : new BridgeError('dashboard_error', 'kb bridge request failed');
      safeLog(logger, 'kb tool failed', { tool: request.params.name, code: bridgeError.code });
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, error: { code: bridgeError.code, message: bridgeError.message, retryable: bridgeError.retryable } }),
        }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const bridgeError = error instanceof BridgeError ? error : new BridgeError('dashboard_error', 'kb bridge failed to start');
  process.stderr.write(`${JSON.stringify({ event: 'kb bridge stopped', code: bridgeError.code, message: bridgeError.message })}\n`);
  process.exitCode = 1;
});
