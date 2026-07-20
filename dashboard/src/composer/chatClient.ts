/**
 * Compatibility entry point for Composer's browser stream. Workspace identity is now the opaque
 * `composerRef`; raw provider/CLI session ids never cross this module.
 */
export { defaultComposerStream } from './workspaceClient';
export type { ComposerStreamFn, ComposerStreamOutcome } from './workspaceClient';
