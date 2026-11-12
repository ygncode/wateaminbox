import { DirectionProvider } from "@radix-ui/react-direction";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { TooltipProvider } from "./components/ui";
import {
  AuthProvider,
  KeyboardShortcutsProvider,
  ThemeProvider,
  WorkspaceProvider,
} from "./contexts";
import { NotificationProvider } from "./contexts/NotificationProvider";
import { RealtimeProvider } from "./contexts/RealtimeProvider";
import "./index.css";
import { installChunkLoadRecovery } from "./lib/chunk-load-recovery";
import { isRtlLanguage } from "./lib/i18n";

// Initialize i18n
import "./lib/i18n";

installChunkLoadRecovery();

function LanguageDirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const dir = isRtlLanguage(i18n.language) ? "rtl" : "ltr";
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}

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
            <WorkspaceProvider>
              <ThemeProvider>
                <RealtimeProvider>
                  <NotificationProvider>
                    <KeyboardShortcutsProvider>
                      <LanguageDirectionProvider>
                        <TooltipProvider>
                          <App />
                        </TooltipProvider>
                      </LanguageDirectionProvider>
                    </KeyboardShortcutsProvider>
                  </NotificationProvider>
                </RealtimeProvider>
              </ThemeProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
