import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

async function boot() {
  // Mock mode: start MSW first so the very first request is intercepted
  if (import.meta.env.VITE_MOCK === '1') await (await import('./mock/browser')).startMock();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
void boot();
