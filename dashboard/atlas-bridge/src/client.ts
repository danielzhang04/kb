import { BridgeError, sessionRequired } from './errors.js';
import { redactValue, safeLog, type SafeLogger } from './redact.js';
import { IndexStreamExtractor, type IndexProjection } from './index-stream.js';
import type { Adapter, DashboardMode, FamilyCapability, NegotiatedCapabilities, SessionNotification, V1Envelope } from './types.js';
import type { BridgeConfig } from './config.js';

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly requireSession?: boolean;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

interface ProbeResult {
  readonly available: boolean;
  readonly envelope?: V1Envelope;
  readonly body?: unknown;
  readonly reason?: string;
  readonly transportFailure?: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;
const SCHEDULE_WATERMARK = /^schedules:\d+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;
const PROBE_PREFIX_BYTES = 4096;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function expiresAtMs(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new BridgeError('invalid_arguments', 'invalid Atlas session notification');
}

function unavailable(reason: string): FamilyCapability {
  return { read: 'unavailable', mutation: 'unavailable', reason };
}

export class DashboardClient {
  private session?: { token: string; expiresAt: number };
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private sessionGeneration = 0;
  private negotiated?: NegotiatedCapabilities;
  private negotiation?: Promise<NegotiatedCapabilities>;

  constructor(
    readonly config: BridgeConfig,
    private readonly logger?: SafeLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  setSession(notification: SessionNotification): void {
    if (typeof notification.token !== 'string' || notification.token.length < 8 || notification.token.length > 16_384) {
      throw new BridgeError('invalid_arguments', 'invalid Atlas session notification');
    }
    const expiresAt = expiresAtMs(notification.expiresAt);
    if (expiresAt <= Date.now() + 30_000) {
      throw new BridgeError('invalid_arguments', 'invalid Atlas session notification');
    }
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    const generation = ++this.sessionGeneration;
    this.session = { token: notification.token, expiresAt };
    this.negotiated = undefined;
    this.negotiation = undefined;
    this.sessionTimer = setTimeout(() => {
      if (this.sessionGeneration !== generation) return;
      this.session = undefined;
      this.negotiated = undefined;
      this.negotiation = undefined;
      this.sessionTimer = undefined;
    }, expiresAt - Date.now());
    this.sessionTimer.unref?.();
    safeLog(this.logger, 'atlas session refreshed', { expiresAt });
  }

  private usableToken(): string | undefined {
    if (!this.session) return undefined;
    if (Date.now() >= this.session.expiresAt) {
      this.session = undefined;
      this.negotiated = undefined;
      this.negotiation = undefined;
      return undefined;
    }
    return this.session.token;
  }

  private url(path: string): URL {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new BridgeError('invalid_arguments', 'dashboard path must be relative to the pinned origin');
    }
    const url = new URL(path, this.config.origin);
    if (url.origin !== this.config.origin) {
      throw new BridgeError('invalid_arguments', 'dashboard origin mismatch');
    }
    return url;
  }

  private async decode(response: Response, controller: AbortController): Promise<unknown> {
    if (response.status === 204 || response.status === 304) return undefined;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > this.config.maxResponseBytes) {
      controller.abort();
      throw new BridgeError('response_too_large', 'dashboard response exceeded the bridge limit');
    }
    if (!response.body) return undefined;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > this.config.maxResponseBytes) {
        await reader.cancel();
        controller.abort();
        throw new BridgeError('response_too_large', 'dashboard response exceeded the bridge limit');
      }
      chunks.push(Buffer.from(next.value));
    }
    const text = Buffer.concat(chunks, bytes).toString('utf8');
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async request(path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const token = this.usableToken();
    const mode = this.negotiated?.dashboardMode;
    if (options.requireSession !== false && !token && mode === 'win32-desktop') throw sessionRequired();
    if (options.idempotencyKey && !IDEMPOTENCY_KEY.test(options.idempotencyKey)) {
      throw new BridgeError('invalid_arguments', 'idempotency_key must be 16-128 safe characters');
    }
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path), {
        method: options.method ?? 'GET', headers, body, signal: controller.signal, redirect: 'error',
      });
      if (response.status === 401) throw sessionRequired();
      const decoded = await this.decode(response, controller);
      if (response.status >= 400) {
        safeLog(this.logger, 'dashboard request failed', { path, status: response.status });
      }
      return { status: response.status, headers: response.headers, body: decoded };
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      safeLog(this.logger, 'dashboard request unavailable', { path, error: error instanceof Error ? error.name : 'unknown' });
      throw new BridgeError('dashboard_unavailable', 'dashboard request unavailable', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private validateV1(body: unknown, expectedKind: string): V1Envelope {
    const item = object(body);
    if (!item || item.apiVersion !== 'v1') {
      throw new BridgeError('capability_negotiation_failed', 'dashboard returned an unsupported API envelope');
    }
    if (item.kind !== expectedKind || !object(item.meta) || !Object.hasOwn(item, 'data')) {
      throw new BridgeError('capability_negotiation_failed', 'dashboard returned an unexpected v1 envelope');
    }
    return item as unknown as V1Envelope;
  }

  private async probeV1(path: string, kind: string): Promise<ProbeResult> {
    return this.probe(path, kind);
  }

  private async probeLegacy(path: string): Promise<ProbeResult> {
    return this.probe(path);
  }

  private async probe(path: string, expectedKind?: string): Promise<ProbeResult> {
    const token = this.usableToken();
    if (!token && this.negotiated?.dashboardMode === 'win32-desktop') return { available: false, reason: 'session unavailable' };
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path), {
        method: 'GET', headers, signal: controller.signal, redirect: 'error',
      });
      if (response.status < 200 || response.status >= 300) {
        await this.cancelBody(response, controller);
        return { available: false, reason: `HTTP ${response.status}` };
      }
      if (!expectedKind) {
        await this.cancelBody(response, controller);
        return { available: true };
      }
      if (!response.body) return { available: false, reason: 'missing v1 envelope' };
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (bytes < PROBE_PREFIX_BYTES) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value.subarray(0, PROBE_PREFIX_BYTES - bytes));
        chunks.push(chunk);
        bytes += chunk.byteLength;
        const candidate = Buffer.concat(chunks, bytes).toString('utf8');
        if (/"apiVersion"\s*:\s*"v1"/.test(candidate)
          && new RegExp(`"kind"\\s*:\\s*"${expectedKind}"`).test(candidate)) break;
      }
      const prefix = Buffer.concat(chunks, bytes).toString('utf8');
      await reader.cancel().catch(() => undefined);
      controller.abort();

      let envelope: V1Envelope | undefined;
      try {
        envelope = this.validateV1(JSON.parse(prefix), expectedKind);
      } catch {
        const headerVersion = response.headers.get('x-api-version') ?? response.headers.get('api-version');
        const headerKind = response.headers.get('x-api-kind') ?? response.headers.get('api-kind');
        const versionOk = headerVersion === 'v1' || /"apiVersion"\s*:\s*"v1"/.test(prefix);
        const kindOk = headerKind === expectedKind
          || new RegExp(`"kind"\\s*:\\s*"${expectedKind}"`).test(prefix);
        if (!versionOk || !kindOk) return { available: false, reason: 'unsupported v1 envelope' };
        const watermark = prefix.match(/"watermark"\s*:\s*"([^"\\]{1,128})"/)?.[1];
        envelope = { apiVersion: 'v1', kind: expectedKind, data: undefined, meta: watermark ? { watermark } : {} };
      }
      return { available: true, envelope };
    } catch (error) {
      return this.failedProbe(error);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async cancelBody(response: Response, controller: AbortController): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // The controller abort below is the fallback for an already-locked or failed stream.
    }
    controller.abort();
  }

  private failedProbe(error: unknown): ProbeResult {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { available: false, reason: 'transport timeout', transportFailure: true };
    }
    if (error instanceof BridgeError && error.code === 'dashboard_unavailable') {
      return { available: false, reason: 'transport unavailable', transportFailure: true };
    }
    return { available: false, reason: 'transport unavailable', transportFailure: true };
  }

  private family(v1: ProbeResult, legacy: ProbeResult, metadataOk: boolean, mutation = true): FamilyCapability {
    if (v1.transportFailure) return unavailable(v1.reason ?? 'transport unavailable');
    if (v1.available) {
      return {
        read: 'v1',
        mutation: mutation && metadataOk && this.config.mutationsEnabled ? 'v1' : 'unavailable',
        ...(!metadataOk && mutation ? { reason: 'v1 mutation metadata unavailable' } : {}),
      };
    }
    if (legacy.transportFailure) return unavailable(legacy.reason ?? 'transport unavailable');
    if (legacy.available) {
      return { read: 'legacy', mutation: mutation && this.config.mutationsEnabled ? 'legacy' : 'unavailable' };
    }
    return unavailable(legacy.reason ?? v1.reason ?? 'read probe failed');
  }

  private async negotiateNow(): Promise<NegotiatedCapabilities> {
    const context = await this.request('/api/auth/context', { requireSession: false });
    let dashboardMode: DashboardMode;
    if (context.status === 404) {
      dashboardMode = 'legacy';
    } else if (context.status >= 200 && context.status < 300) {
      const mode = object(context.body)?.mode;
      if (mode !== 'win32-desktop' && mode !== 'tailnet') {
        throw new BridgeError('capability_negotiation_failed', 'dashboard authentication mode is unsupported');
      }
      dashboardMode = mode;
    } else {
      throw new BridgeError('capability_negotiation_failed', 'dashboard authentication context is unavailable');
    }
    this.negotiated = { dashboardMode, runtime: undefined, families: {} };
    if (!this.usableToken() && dashboardMode === 'win32-desktop') throw sessionRequired();

    const runtimeProbe = await this.probeLegacy('/api/runtime/capabilities');
    const runtime: unknown = runtimeProbe.available
      ? { available: true }
      : { unavailable: true, reason: runtimeProbe.reason ?? 'probe failed' };

    const [healthV1, agentsV1, workflowsV1, runsV1, schedulesV1, inboxV1] = await Promise.all([
      this.probeV1('/api/v1/health', 'health'),
      this.probeV1('/api/v1/agents', 'agent-list'),
      this.probeV1('/api/v1/workflows', 'workflow-list'),
      this.probeV1('/api/v1/runs', 'run-list'),
      this.probeV1('/api/v1/schedules', 'schedule-list'),
      this.probeV1('/api/v1/inbox', 'inbox'),
    ]);
    void healthV1;

    const [agentsLegacy, workflowsLegacy, runsLegacy, schedulesLegacy, inboxLegacy, repoLegacy,
      brainLegacy, analyticsLegacy, traceLegacy, terminalsLegacy] = await Promise.all([
      this.probeLegacy('/api/agents'),
      this.probeLegacy('/api/workflows'),
      this.probeLegacy('/api/control/runs'),
      this.probeLegacy('/api/schedules'),
      this.probeLegacy('/api/inbox'),
      this.probeLegacy('/api/kb/tree?path='),
      this.probeLegacy('/api/brain/search?q=atlas-bridge-probe&k=1'),
      this.probeLegacy('/api/index'),
      this.probeLegacy('/api/trace'),
      this.probeLegacy('/api/pty/sessions'),
    ]);

    const hasSourceWatermark = (probe: ProbeResult): boolean =>
      typeof probe.envelope?.meta.watermark === 'string' && HEX64.test(probe.envelope.meta.watermark);
    const families: Record<string, FamilyCapability> = {
      agents: this.family(agentsV1, agentsLegacy, hasSourceWatermark(agentsV1)),
      workflows: this.family(workflowsV1, workflowsLegacy, hasSourceWatermark(workflowsV1)),
      workflow_launch: workflowsV1.transportFailure
        ? unavailable(workflowsV1.reason ?? 'transport unavailable')
        : workflowsV1.available
        ? {
            read: 'v1',
            mutation: !runsV1.transportFailure && runsV1.available && hasSourceWatermark(workflowsV1) && hasSourceWatermark(runsV1)
              && this.config.mutationsEnabled ? 'v1' : 'unavailable',
            ...(!(!runsV1.transportFailure && runsV1.available && hasSourceWatermark(workflowsV1) && hasSourceWatermark(runsV1))
              ? { reason: 'v1 mutation metadata unavailable' } : {}),
          }
        : workflowsLegacy.transportFailure
          ? unavailable(workflowsLegacy.reason ?? 'transport unavailable')
          : workflowsLegacy.available
          ? { read: 'legacy', mutation: this.config.mutationsEnabled ? 'legacy' : 'unavailable' }
          : unavailable(workflowsLegacy.reason ?? 'workflow launch route unavailable'),
      runs: this.family(runsV1, runsLegacy, hasSourceWatermark(runsV1), false),
      inbox: this.family(inboxV1, inboxLegacy, true, false),
      schedules: this.family(schedulesV1, schedulesLegacy,
        typeof schedulesV1.envelope?.meta.watermark === 'string'
          && SCHEDULE_WATERMARK.test(schedulesV1.envelope.meta.watermark)),
      repo: repoLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(repoLegacy.reason ?? 'probe failed'),
      search: brainLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(brainLegacy.reason ?? 'probe failed'),
      analytics: analyticsLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(analyticsLegacy.reason ?? 'probe failed'),
      grades: analyticsLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(analyticsLegacy.reason ?? 'probe failed'),
      traces: traceLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(traceLegacy.reason ?? 'probe failed'),
      terminals: terminalsLegacy.available ? { read: 'legacy', mutation: 'unavailable' } : unavailable(terminalsLegacy.reason ?? 'probe failed'),
      agent_launch: agentsLegacy.available
        ? { read: 'legacy', mutation: this.config.mutationsEnabled ? 'legacy' : 'unavailable' }
        : unavailable(agentsLegacy.reason ?? 'legacy agent launch route unavailable'),
      human_response: runsV1.transportFailure
        ? unavailable(runsV1.reason ?? 'transport unavailable')
        : runsV1.available
        ? {
            read: 'v1',
            mutation: hasSourceWatermark(runsV1) && this.config.mutationsEnabled ? 'v1' : 'unavailable',
            ...(!hasSourceWatermark(runsV1) ? { reason: 'v1 mutation metadata unavailable' } : {}),
          }
        : runsLegacy.transportFailure
          ? unavailable(runsLegacy.reason ?? 'transport unavailable')
          : runsLegacy.available
          ? { read: 'legacy', mutation: this.config.mutationsEnabled ? 'legacy' : 'unavailable' }
          : unavailable(runsLegacy.reason ?? 'run read route unavailable'),
      run_control: runsLegacy.available
        ? { read: 'legacy', mutation: this.config.mutationsEnabled ? 'legacy' : 'unavailable' }
        : unavailable(runsLegacy.reason ?? 'legacy control route unavailable'),
    };
    const capabilities = { dashboardMode, runtime, families } satisfies NegotiatedCapabilities;
    this.negotiated = capabilities;
    safeLog(this.logger, 'dashboard capabilities negotiated', { dashboardMode, families });
    return capabilities;
  }

  async capabilities(): Promise<NegotiatedCapabilities> {
    if (this.negotiated && Object.keys(this.negotiated.families).length > 0) return this.negotiated;
    this.negotiation ??= this.negotiateNow().finally(() => { this.negotiation = undefined; });
    return this.negotiation;
  }

  async adapter(family: string, mutation = false): Promise<Exclude<Adapter, 'unavailable'>> {
    const capabilities = await this.capabilities();
    const selected = capabilities.families[family]?.[mutation ? 'mutation' : 'read'] ?? 'unavailable';
    if (selected === 'unavailable') {
      throw new BridgeError('capability_unavailable', `${family} ${mutation ? 'mutation' : 'read'} is unavailable`);
    }
    return selected;
  }

  async v1(path: string, kind: string, options: RequestOptions = {}): Promise<V1Envelope> {
    const response = await this.request(path, options);
    if (response.status < 200 || response.status >= 300) {
      throw new BridgeError('dashboard_error', `dashboard request failed with HTTP ${response.status}`, response.status >= 500, response.status);
    }
    return this.validateV1(response.body, kind);
  }

  async legacy(path: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.request(path, options);
    if (response.status < 200 || response.status >= 300) {
      throw new BridgeError('dashboard_error', `dashboard request failed with HTTP ${response.status}`, response.status >= 500, response.status);
    }
    return redactValue(response.body);
  }

  async legacyIndex(rowLimit: number, summaryKeys: ReadonlySet<string>): Promise<IndexProjection> {
    const token = this.usableToken();
    if (!token && this.negotiated?.dashboardMode === 'win32-desktop') throw sessionRequired();
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetchImpl(this.url('/api/index'), {
        method: 'GET', headers, signal: controller.signal, redirect: 'error',
      });
      if (response.status === 401) throw sessionRequired();
      if (response.status < 200 || response.status >= 300) {
        await this.cancelBody(response, controller);
        throw new BridgeError('dashboard_error', `dashboard request failed with HTTP ${response.status}`, response.status >= 500);
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > this.config.maxIndexBytes) {
        await this.cancelBody(response, controller);
        throw new BridgeError('response_too_large', 'dashboard index exceeded the index limit');
      }
      if (!response.body) throw new BridgeError('dashboard_error', 'dashboard index response is empty');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const extractor = new IndexStreamExtractor(rowLimit, this.config.maxResultBytes, summaryKeys);
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > this.config.maxIndexBytes) {
          await reader.cancel().catch(() => undefined);
          controller.abort();
          throw new BridgeError('response_too_large', 'dashboard index exceeded the index limit');
        }
        extractor.push(decoder.decode(next.value, { stream: true }));
      }
      extractor.push(decoder.decode());
      return redactValue(extractor.finish()) as unknown as IndexProjection;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      safeLog(this.logger, 'dashboard index unavailable', { error: error instanceof Error ? error.name : 'unknown' });
      throw new BridgeError('dashboard_unavailable', 'dashboard index unavailable', true);
    } finally {
      clearTimeout(timer);
      await reader?.cancel().catch(() => undefined);
      controller.abort();
    }
  }

  async watchLegacy(path: string, after: number, limit: number, waitMs: number): Promise<unknown> {
    const token = this.usableToken();
    if (!token && this.negotiated?.dashboardMode === 'win32-desktop') throw sessionRequired();
    const headers = new Headers({ Accept: 'text/event-stream', 'Last-Event-ID': String(after) });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    const frames: unknown[] = [];
    let cursor = after;
    let buffered = '';
    let bytes = 0;
    try {
      const response = await this.fetchImpl(this.url(path), { headers, signal: controller.signal, redirect: 'error' });
      if (response.status === 401) throw sessionRequired();
      if (!response.ok || !response.body) throw new BridgeError('dashboard_error', `dashboard stream failed with HTTP ${response.status}`);
      const reader = response.body.getReader();
      while (frames.length < limit) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > this.config.maxResponseBytes) throw new BridgeError('response_too_large', 'dashboard stream exceeded the bridge limit');
        buffered += Buffer.from(next.value).toString('utf8');
        let split = buffered.indexOf('\n\n');
        while (split >= 0 && frames.length < limit) {
          const wire = buffered.slice(0, split);
          buffered = buffered.slice(split + 2);
          const id = wire.match(/^id:\s*(\d+)$/m)?.[1];
          const data = wire.match(/^data:\s*(.*)$/m)?.[1];
          if (id) cursor = Math.max(cursor, Number(id));
          if (data) {
            try { frames.push(redactValue(JSON.parse(data))); } catch { frames.push(redactValue(data)); }
          }
          split = buffered.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        throw new BridgeError('dashboard_unavailable', 'dashboard stream unavailable', true);
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    return { events: frames, cursor };
  }
}

export function sourceRevision(value: unknown): string | undefined {
  const item = object(value);
  for (const key of ['sourceRevision', 'sourceHash', 'etag']) {
    if (typeof item?.[key] === 'string' && (HEX64.test(item[key] as string) || (item[key] as string).length > 0)) {
      return item[key] as string;
    }
  }
  return undefined;
}
