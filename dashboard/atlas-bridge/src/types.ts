export type DashboardMode = 'win32-desktop' | 'tailnet' | 'legacy';
export type Adapter = 'v1' | 'legacy' | 'unavailable';

export interface FamilyCapability {
  readonly read: Adapter;
  readonly mutation: Adapter;
  readonly reason?: string;
}

export interface NegotiatedCapabilities {
  readonly dashboardMode: DashboardMode;
  readonly runtime: unknown;
  readonly families: Readonly<Record<string, FamilyCapability>>;
}

export interface SessionNotification {
  readonly token: string;
  readonly expiresAt: string | number;
}

// Mirrored from dashboard/server/api/v1/envelope.ts:5-27 and contracts.ts:106-138.
// Only the bridge validation vocabulary is copied; this package imports no dashboard server code.
export interface V1Envelope {
  readonly apiVersion: 'v1';
  readonly kind: string;
  readonly data: unknown;
  readonly meta: { readonly etag?: string; readonly watermark?: string; readonly nextCursor?: string };
  readonly actions?: readonly {
    readonly rel: 'self' | 'events' | 'claim' | 'renew' | 'report' | 'respond' | 'arm'
      | 'disarm' | 'cancel' | 'confirm' | 'deploy' | 'abort' | 'acknowledge' | 'inspect' | 'pull' | 'retry';
    readonly href: string;
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  }[];
}
