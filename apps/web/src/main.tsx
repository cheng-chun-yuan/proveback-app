import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

async function boot() {
  // mock 模式:先啟動 MSW,確保第一個請求就被攔截
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
