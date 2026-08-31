/**
 * The canonical contract-decode error, raised by strict decoders across api/v1, auth, deploy, inbox,
 * health, learnings, placement, reconciliation, schedules and write. Its `field: detail` message and
 * `field` property are the stable shape those decoders' callers read — never change them.
 *
 * Previously defined in `write/durableManifest.ts`; moved here (the shared-primitives home) and
 * re-exported from durableManifest so existing importers are byte-untouched.
 */
export class ContractDecodeError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`${field}: ${detail}`);
    this.name = 'ContractDecodeError';
    this.field = field;
  }
}
