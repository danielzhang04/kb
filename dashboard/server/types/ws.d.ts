// Ambient declaration for the `ws` package, used only by hub/security tests as a WebSocket CLIENT
// (the global undici WebSocket cannot set custom Origin/Host headers needed for the upgrade-guard
// tests). `ws` ships no bundled types and we intentionally add no new npm dep (@types/ws), so this
// minimal surface — exactly what the tests use — stands in. Runtime `ws` arrives transitively via
// @fastify/websocket.
declare module 'ws' {
  class WebSocket {
    constructor(address: string, options?: Record<string, unknown>);
    readonly readyState: number;
    readonly OPEN: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: unknown): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }
  export default WebSocket;
}
