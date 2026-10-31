import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppDialogsProvider } from './components/AppDialogs';
import { AppToastProvider } from './components/AppToasts';
import { PwaUpdateManager } from './components/PwaUpdateManager';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppDialogsProvider>
        <AppToastProvider>
          <PwaUpdateManager />
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppToastProvider>
      </AppDialogsProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
