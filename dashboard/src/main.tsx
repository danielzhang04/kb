import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerSwFromWindow } from './lib/registerSw';
import './styles/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the PWA service worker (D0.10). No-ops off a secure context, so a localhost-http dev boot
// never installs one; it also never rejects, so a registration failure can't take down the SPA.
void registerSwFromWindow();
