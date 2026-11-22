import '@fontsource-variable/inter';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { ReauthProvider } from './components/ReauthProvider';
import { initI18n } from './i18n';
import { createAppRouter } from './router';

initI18n();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (401, 403, 404…) are answers, not glitches: no retry.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

const router = createAppRouter(queryClient);

// The service worker serves the offline page and receives push notifications (production only:
// in development, Vite's live reload and a cached shell do not mix).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReauthProvider>
        <RouterProvider router={router} />
      </ReauthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
