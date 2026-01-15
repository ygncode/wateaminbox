import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Error Boundary component for catching and handling React errors
 * Displays a user-friendly error screen instead of crashing the app
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error in development
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  onReset: () => void;
}

/**
 * Default error fallback UI component
 */
export function ErrorFallback({
  error,
  errorInfo,
  onReset,
}: ErrorFallbackProps) {
  const navigate = useNavigate();

  const handleGoHome = () => {
    onReset();
    navigate("/chat");
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary p-4">
      <div className="max-w-md w-full bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8 text-center">
        {/* Error Icon */}
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-red-600 dark:text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Error Title */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-2 text-balance">
          Something went wrong
        </h1>

        {/* Error Description */}
        <p className="text-gray-600 dark:text-dark-text-secondary mb-6">
          We're sorry, but something unexpected happened. Please try refreshing
          the page or going back to the home screen.
        </p>

        {/* Error Details (dev only) */}
        {process.env.NODE_ENV === "development" && error && (
          <details className="text-left mb-6 bg-gray-50 dark:bg-dark-secondary rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-2">
              Error Details
            </summary>
            <div className="mt-2 text-xs">
              <p className="font-mono text-red-600 dark:text-red-400 break-all mb-2">
                {error.message}
              </p>
              {errorInfo && (
                <pre className="font-mono text-gray-600 dark:text-dark-text-tertiary whitespace-pre-wrap break-all max-h-40 overflow-auto">
                  {errorInfo.componentStack}
                </pre>
              )}
            </div>
          </details>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            onClick={handleGoHome}
            className="dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
          >
            Go to Home
          </Button>
          <Button
            onClick={handleRefresh}
            className="bg-whatsapp-green-a11y-button hover:bg-whatsapp-green-a11y-button/90 text-white"
          >
            Refresh Page
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook-based error boundary wrapper for use with Suspense
 * Use this when you need to programmatically trigger error recovery
 */
interface ErrorBoundaryContextValue {
  reset: () => void;
}

const ErrorBoundaryContext = React.createContext<
  ErrorBoundaryContextValue | undefined
>(undefined);

export function useErrorBoundary() {
  const context = React.useContext(ErrorBoundaryContext);
  if (!context) {
    throw new Error("useErrorBoundary must be used within an ErrorBoundary");
  }
  return context;
}

/**
 * Provider wrapper that exposes error boundary controls via context
 */
export function ErrorBoundaryProvider({
  children,
  onError,
}: {
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}) {
  const [key, setKey] = React.useState(0);

  const reset = React.useCallback(() => {
    setKey((prev) => prev + 1);
  }, []);

  return (
    <ErrorBoundaryContext.Provider value={{ reset }}>
      <ErrorBoundary key={key} onError={onError}>
        {children}
      </ErrorBoundary>
    </ErrorBoundaryContext.Provider>
  );
}
