import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { TooltipProvider } from './components/ui'
import {
  AuthProvider,
  KeyboardShortcutsProvider,
  ThemeProvider,
  WebSocketProvider,
} from './contexts'
import './index.css'

// Initialize i18n
import './lib/i18n'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <WebSocketProvider>
              <KeyboardShortcutsProvider>
                <TooltipProvider>
                  <App />
                </TooltipProvider>
              </KeyboardShortcutsProvider>
            </WebSocketProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
