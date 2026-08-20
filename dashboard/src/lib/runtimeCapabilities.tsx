import { createContext, useContext } from 'react';

export interface ClientRuntimeCapabilities {
  pty: boolean;
  localTranscripts: boolean;
}

// Isolated panel tests retain their desktop behavior unless they explicitly exercise a missing
// capability. The authenticated app always supplies the server response through the provider.
const RuntimeCapabilitiesContext = createContext<ClientRuntimeCapabilities>({
  pty: true,
  localTranscripts: true,
});

export const RuntimeCapabilitiesProvider = RuntimeCapabilitiesContext.Provider;

export function useRuntimeCapabilities(): ClientRuntimeCapabilities {
  return useContext(RuntimeCapabilitiesContext);
}
