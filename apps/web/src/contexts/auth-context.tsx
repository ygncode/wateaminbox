import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  attemptTokenRefresh,
  clearAuthTokens,
  getAccessToken,
  getCurrentUser,
  initializeAuth,
  type RegisterRequest,
  type RegisterResponse,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
  unsubscribeAllPush,
  updateCurrentUserProfile,
} from "../lib/api";
import { useChatStore } from "../stores/chat-store";

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
};

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<AuthState>({
    ...EMPTY_STATE,
    isLoading: true,
  });

  const loadIdentity = React.useCallback(async () => {
    if (!getAccessToken()) await attemptTokenRefresh();
    if (!getAccessToken()) {
      setState(EMPTY_STATE);
      return;
    }

    const apiUser = await getCurrentUser();
    setState({
      user: mapApiUser(apiUser),
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  }, []);

  React.useEffect(() => {
    initializeAuth();
    loadIdentity().catch(() => {
      clearAuthTokens();
      setState(EMPTY_STATE);
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
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
          error instanceof Error ? error.message : "Registration failed";
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
    } catch {
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
