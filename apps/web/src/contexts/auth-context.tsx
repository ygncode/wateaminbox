import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  ApiRequestError,
  attemptTokenRefresh,
  clearAuthTokens,
  getAccessToken,
  getCurrentUser,
  initializeAuth,
  type RegisterRequest,
  type RegisterResponse,
  type TokenRefreshOutcome,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
  unsubscribeAllPush,
  updateCurrentUserProfile,
} from "../lib/api";
import { useChatStore } from "../stores/chat-store";
import {
  restoreSession,
  type SessionAttemptResult,
} from "../lib/session-restore";
import { useTranslation } from "react-i18next";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  gravatarUrl?: string;
  hasCustomAvatar: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * The API could not be reached, so whether the session is still valid is
   * unknown.
   *
   * Distinct from "not authenticated". A refresh cookie survives a deployment,
   * but the client cannot prove that until something answers, and treating the
   * silence as a rejection would send every user back to the login screen for
   * what is only a few seconds of downtime. Consumers must show a retry rather
   * than redirect while this is set.
   */
  authUnavailable: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    data: Omit<RegisterRequest, "companyName">,
  ) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (
    input: UpdateProfileRequest,
  ) => Promise<UpdateProfileResponse>;
  clearError: () => void;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined,
);

export interface AuthProviderProps {
  children: React.ReactNode;
}

interface ApiUser {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string;
  gravatarUrl?: string;
  hasCustomAvatar?: boolean;
}

function mapApiUser(apiUser: ApiUser): AuthUser {
  return {
    id: apiUser.id,
    email: apiUser.email,
    name: apiUser.name || apiUser.email.split("@")[0],
    avatarUrl: apiUser.avatarUrl,
    gravatarUrl: apiUser.gravatarUrl,
    hasCustomAvatar: Boolean(apiUser.hasCustomAvatar),
  };
}

const EMPTY_STATE: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  authUnavailable: false,
};

/**
 * Whether an error proves the session is gone, as opposed to merely proving the
 * API could not be reached.
 *
 * Only the server refusing the credentials is evidence about the session. A
 * network failure, a timeout, or a 5xx from a container that is still starting
 * says nothing, and clearing tokens on those is what turned an ordinary
 * deployment into a mass sign-out.
 */
function isAuthRejection(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

const UNAVAILABLE_STATE: AuthState = { ...EMPTY_STATE, authUnavailable: true };

/**
 * Raised when the session cannot be restored because the API refused it.
 *
 * Modelled as an `ApiRequestError` so the `401`/`403` checks that already exist
 * keep working. The alternative - reporting the outcome like a boolean - left
 * nothing for the callers to react to, and a rejected session has to clear the
 * query cache and the chat store, not just stop loading.
 */
function sessionExpiredError(): ApiRequestError {
  return new ApiRequestError(
    401,
    "SESSION_EXPIRED",
    "Your session has expired. Please sign in again.",
  );
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const [state, setState] = React.useState<AuthState>({
    ...EMPTY_STATE,
    isLoading: true,
  });

  const loadIdentity = React.useCallback(async () => {
    const attemptLoad = async (): Promise<SessionAttemptResult> => {
      let outcome: TokenRefreshOutcome | null = null;
      if (!getAccessToken()) outcome = await attemptTokenRefresh();

      if (!getAccessToken()) {
        // "rejected" means the server refused the cookie. Anything else means
        // no answer arrived, which is retried rather than treated as a logout.
        return outcome === "rejected" ? "rejected" : "unavailable";
      }

      try {
        const apiUser = await getCurrentUser();
        setState({
          user: mapApiUser(apiUser),
          isAuthenticated: true,
          isLoading: false,
          error: null,
          authUnavailable: false,
        });
        return "loaded";
      } catch (error) {
        // A 5xx or a dropped connection while reading the profile is no more
        // evidence about the session than the same failure on the refresh.
        return isAuthRejection(error) ? "rejected" : "unavailable";
      }
    };

    const verdict = await restoreSession(attemptLoad);
    if (verdict === "rejected") throw sessionExpiredError();
    if (verdict === "unverified") setState(UNAVAILABLE_STATE);
  }, []);

  React.useEffect(() => {
    initializeAuth();
    loadIdentity().catch((error) => {
      if (isAuthRejection(error)) {
        clearAuthTokens();
        setState(EMPTY_STATE);
        return;
      }
      setState(UNAVAILABLE_STATE);
    });
  }, [loadIdentity]);

  const login = React.useCallback(async (email: string, password: string) => {
    setState((previous) => ({ ...previous, isLoading: true, error: null }));
    try {
      const response = await apiLogin({ email, password });
      setState({
        user: mapApiUser(response.user),
        isAuthenticated: true,
        isLoading: false,
        error: null,
        authUnavailable: false,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("auth.loginFailed", "Login failed");
      setState((previous) => ({
        ...previous,
        isLoading: false,
        error: message,
      }));
      throw error;
    }
  }, []);

  const register = React.useCallback(
    async (
      data: Omit<RegisterRequest, "companyName">,
    ): Promise<RegisterResponse> => {
      setState((previous) => ({ ...previous, isLoading: true, error: null }));
      try {
        const response = await apiRegister(data);
        setState((previous) => ({
          ...previous,
          isLoading: false,
          error: null,
        }));
        return response;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("auth.registrationFailed", "Registration failed");
        setState((previous) => ({
          ...previous,
          isLoading: false,
          error: message,
        }));
        throw error;
      }
    },
    [],
  );

  const logout = React.useCallback(async () => {
    setState((previous) => ({ ...previous, isLoading: true }));
    try {
      await unsubscribeAllPush().catch(() => undefined);
      await apiLogout();
    } catch {
      // Local logout must still complete if the server is unavailable.
    } finally {
      clearAuthTokens();
      queryClient.clear();
      useChatStore.getState().reset();
      setState(EMPTY_STATE);
    }
  }, [queryClient]);

  const refreshSession = React.useCallback(async () => {
    setState((previous) => ({ ...previous, isLoading: true }));
    try {
      await loadIdentity();
    } catch (error) {
      if (!isAuthRejection(error)) {
        setState(UNAVAILABLE_STATE);
        return;
      }
      clearAuthTokens();
      queryClient.clear();
      useChatStore.getState().reset();
      setState(EMPTY_STATE);
    }
  }, [loadIdentity, queryClient]);

  const updateProfile = React.useCallback(
    async (input: UpdateProfileRequest) => {
      const response = await updateCurrentUserProfile(input);
      if (response.emailVerificationRequired) {
        clearAuthTokens();
        queryClient.clear();
        useChatStore.getState().reset();
        setState(EMPTY_STATE);
      } else {
        setState((previous) => ({
          ...previous,
          user: mapApiUser(response.user),
          error: null,
        }));
      }
      return response;
    },
    [queryClient],
  );

  const clearError = React.useCallback(() => {
    setState((previous) => ({ ...previous, error: null }));
  }, []);

  const value = React.useMemo(
    () => ({
      ...state,
      login,
      register,
      logout,
      refreshSession,
      updateProfile,
      clearError,
    }),
    [state, login, register, logout, refreshSession, updateProfile, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
