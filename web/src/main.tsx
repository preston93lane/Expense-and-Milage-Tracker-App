import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './app.css';

import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

const theme = createTheme({
  primaryColor: 'cyan',
  primaryShade: 8,
  defaultRadius: 'md',
  fontFamily: 'Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif',
  fontFamilyMonospace: 'Cascadia Mono, Consolas, ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: { fontFamily: 'Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif' },
  components: {
    Checkbox: { defaultProps: { radius: 'sm' } },
    Badge: { defaultProps: { radius: 'sm' } },
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" limit={4} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
