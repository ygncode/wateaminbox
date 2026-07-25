import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { TooltipProvider } from "./components/ui";
import {
  AuthProvider,
  KeyboardShortcutsProvider,
  ThemeProvider,
} from "./contexts";
import { NotificationProvider } from "./contexts/NotificationProvider";
import { PusherProvider } from "./contexts/PusherProvider";
import "./index.css";

// Initialize i18n
import "./lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <ThemeProvider>
              <PusherProvider>
                <NotificationProvider>
                  <KeyboardShortcutsProvider>
                    <TooltipProvider>
                      <App />
                    </TooltipProvider>
                  </KeyboardShortcutsProvider>
                </NotificationProvider>
              </PusherProvider>
            </ThemeProvider>
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
