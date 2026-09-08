export type SpendGrantProvisionOutcome =
  | { kind: 'ready' }
  | { kind: 'tokenless-already-live'; grantRef: string | null };
